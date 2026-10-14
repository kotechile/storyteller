/**
 * Live test of the OmniCast MCP server.
 *
 * Speaks real MCP over stdio using the SDK's own client, which is what actually proves the server
 * works: if any part of the pipeline leaked a `console.log` to stdout, the JSON-RPC framing would
 * break and this would fail with a parse error rather than passing.
 *
 * Free by default (no LLM or render spend — it only calls read-only tools). Pass `--generate` to run
 * the full acceptance test, which invokes omnicast_generate for real (costs Claude credits and takes
 * ~100s).
 *
 * Run: npx tsx scripts/test-mcp-server.ts [--generate] [url]
 */
import path from 'path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const parsePayload = (result: unknown): Record<string, unknown> => {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const first = content.find((c) => c.type === 'text');
  if (!first?.text) return {};
  try {
    return JSON.parse(first.text) as Record<string, unknown>;
  } catch {
    return { _raw: first.text };
  }
};

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  // Spawn from a NEUTRAL cwd on purpose: `hermes mcp add` has no --cwd, so the real deployment
  // inherits an arbitrary directory. This proves the server relocates itself to the project root
  // (finds .env, prompts/brag/, runs/) instead of depending on where it was launched.
  const neutralCwd = os.tmpdir();
  const transport = new StdioClientTransport({
    command: path.join(root, 'node_modules', '.bin', 'tsx'),
    args: [path.join(root, 'mcp', 'server.mts')],
    cwd: neutralCwd,
    stderr: 'pipe',
  });
  console.log(`     spawning server with cwd=${neutralCwd} (project root is ${root})`);

  const stderrLines: string[] = [];
  transport.stderr?.on('data', (d) => stderrLines.push(String(d)));

  const client = new Client({ name: 'omnicast-test', version: '1.0.0' });

  console.log('[1] connect + tools/list');
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`     discovered: ${names.join(', ')}`);
  for (const expected of ['omnicast_generate', 'omnicast_status', 'omnicast_publish', 'omnicast_list_runs', 'omnicast_defaults']) {
    check(`tool "${expected}" is exposed`, names.includes(expected));
  }
  check('every tool has a description', tools.every((t) => (t.description ?? '').length > 20));
  check(
    'generate advertises its optional inputs',
    Object.keys(((tools.find((t) => t.name === 'omnicast_generate')?.inputSchema as { properties?: object })?.properties) ?? {}).length >= 13,
  );
  // The three per-call overrides added on request — assert them by name, since a silently-dropped
  // arg in the schema would mean the caller's value is discarded without any error.
  const genProps = Object.keys(
    ((tools.find((t) => t.name === 'omnicast_generate')?.inputSchema as { properties?: object })?.properties) ?? {},
  );
  for (const arg of ['musicTrackId', 'model', 'voiceId']) {
    check(`generate accepts "${arg}" per call`, genProps.includes(arg));
  }

  console.log('\n[2] omnicast_defaults (read-only)');
  const defaults = parsePayload(await client.callTool({ name: 'omnicast_defaults', arguments: {} }));
  console.log(`     ${JSON.stringify(defaults.defaults)}`);
  check('defaults report a model', typeof defaults.bragModel === 'string' && (defaults.bragModel as string).length > 0, String(defaults.bragModel));
  check('defaults report the tone list', Array.isArray(defaults.tones) && (defaults.tones as string[]).length === 7);
  check('defaults report max concurrency', typeof defaults.maxConcurrentRuns === 'number');
  // The set-piece for relocation: spawned from os.tmpdir(), the server must have chdir'd to the
  // project root, otherwise .env (and therefore the model + keys) would not have loaded at all.
  check('server relocated itself to the project root', defaults.projectRoot === root, `${String(defaults.projectRoot)} (expected ${root})`);
  const defaultsBlock = (defaults.defaults ?? {}) as Record<string, unknown>;
  if (defaultsBlock.mode === 'both' || defaultsBlock.mode === 'explainer') {
    // The real-world case: .env sets OMNICAST_DEFAULT_MODE=both, which no unattended run can honour.
    check('defaults warn that the configured default mode is unimplemented', typeof defaults.warning === 'string', String(defaults.warning).slice(0, 90));
  } else {
    check('defaults carry no spurious mode warning', defaults.warning === undefined);
  }

  console.log('\n[3] omnicast_list_runs (read-only)');
  const runs = parsePayload(await client.callTool({ name: 'omnicast_list_runs', arguments: { limit: 3 } }));
  const list = (runs.runs ?? []) as Record<string, unknown>[];
  console.log(`     ${list.length} run(s); newest: ${list[0]?.runId ?? '(none)'} status=${list[0]?.status ?? '-'}`);
  check('list_runs returns an array', Array.isArray(runs.runs));
  check('the earlier end-to-end run is visible', list.some((r) => r.status === 'done'));

  console.log('\n[4] omnicast_status on the finished run');
  const doneRunId = String(list.find((r) => r.status === 'done')?.runId ?? '');
  if (doneRunId) {
    const status = parsePayload(await client.callTool({ name: 'omnicast_status', arguments: { runId: doneRunId } }));
    check('status resolves the run', status.runId === doneRunId, String(status.status));
    check('status reports the video path', typeof status.videoPath === 'string', String(status.videoPath));
    check('status reports key concepts', Array.isArray(status.keyConcepts) && (status.keyConcepts as string[]).length >= 2);
  } else {
    check('a done run exists to query', false, 'no completed run found');
  }

  console.log('\n[5] error paths must fail loudly, not silently succeed');
  const bogus = await client.callTool({ name: 'omnicast_status', arguments: { runId: 'no-such-run-xyz' } });
  check('unknown runId is an error result', (bogus as { isError?: boolean }).isError === true, (parsePayload(bogus)._raw as string | undefined)?.slice(0, 70) ?? '');
  const pub = await client.callTool({ name: 'omnicast_publish', arguments: { runId: doneRunId || 'x' } });
  check('publish honestly reports not-implemented', (pub as { isError?: boolean }).isError === true && /not implemented/i.test(String(parsePayload(pub)._raw ?? '')));

  // An unimplemented mode must be rejected BEFORE it is queued: with OMNICAST_DEFAULT_MODE=both in
  // .env, a late failure means every no-arg call silently burns a queue slot first.
  const countRuns = async (): Promise<number> =>
    Number(parsePayload(await client.callTool({ name: 'omnicast_list_runs', arguments: { limit: 50 } })).count ?? -1);
  const runsBefore = await countRuns();
  const both = await client.callTool({ name: 'omnicast_generate', arguments: { url: 'https://example.com', mode: 'both' } });
  check(
    'an unimplemented mode is rejected fast',
    (both as { isError?: boolean }).isError === true && /not implemented/i.test(String(parsePayload(both)._raw ?? '')),
    String(parsePayload(both)._raw ?? '').slice(0, 80),
  );
  check('the rejected call queued nothing', (await countRuns()) === runsBefore, `run count ${runsBefore} unchanged`);

  console.log('\n[6] input schema validation is actually enforced');
  // NOTE: MCP reports bad input as an error RESULT, not a thrown exception — so assert on isError.
  // `list_runs` is the right probe: with no validation it would quietly succeed (Array.slice(0,'abc')
  // coerces to 0 and returns []), so a passing isError here is real evidence, not a tautology.
  const invalidLimit = await client.callTool({ name: 'omnicast_list_runs', arguments: { limit: 'abc' as unknown as number } });
  const invalidRaw = String(parsePayload(invalidLimit)._raw ?? JSON.stringify(parsePayload(invalidLimit)));
  check('an argument of the wrong type is rejected', (invalidLimit as { isError?: boolean }).isError === true, invalidRaw.slice(0, 100));

  const invalidFormat = await client.callTool({ name: 'omnicast_generate', arguments: { format: 'widescreen' as unknown as 'vertical' } });
  check('an invalid enum value is rejected', (invalidFormat as { isError?: boolean }).isError === true, String(parsePayload(invalidFormat)._raw ?? '').slice(0, 100));

  // ── optional: the full acceptance test ──
  if (process.argv.includes('--generate')) {
    const url = process.argv.find((a) => a.startsWith('http')) ?? 'https://en.wikipedia.org/wiki/Retrieval-augmented_generation';
    console.log(`\n[7] FULL acceptance test — omnicast_generate ${url}`);
    const started = Date.now();
    const gen = parsePayload(await client.callTool({ name: 'omnicast_generate', arguments: { url, tone: 'polished', durationSeconds: 18 } }));
    const runId = String(gen.runId);
    check('generate returned a runId immediately', /^\d{4}-\d{2}-\d{2}-/.test(runId), runId);
    check('generate did not block on the render', Date.now() - started < 15_000, `${Date.now() - started}ms`);

    let status = 'unknown';
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = parsePayload(await client.callTool({ name: 'omnicast_status', arguments: { runId } }));
      status = String(s.status);
      process.stdout.write(`     [${Math.round((Date.now() - started) / 1000)}s] ${status}\n`);
      if (status === 'done' || status === 'failed') {
        if (status === 'done') {
          check('generate produced a video via MCP', typeof s.videoPath === 'string', String(s.videoPath));
          check('video has a poster', typeof s.posterPath === 'string');
        } else {
          check('run did not fail', false, String(s.error));
        }
        break;
      }
    }
    check('run reached a terminal state', status === 'done' || status === 'failed', status);
  } else {
    console.log('\n[7] skipped — pass --generate for the full acceptance test (costs Claude credits)');
  }

  await client.close();
  const noise = stderrLines.join('').split('\n').filter((l) => l.includes('[omnicast-mcp]')).slice(0, 3);
  console.log(`\nserver stderr (sample): ${noise.length ? noise.join(' | ').slice(0, 200) : '(none)'}`);
  console.log(`\n${failures === 0 ? '✅ MCP server verification PASSED' : `❌ MCP server verification FAILED (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ test crashed:', err);
  process.exit(1);
});
