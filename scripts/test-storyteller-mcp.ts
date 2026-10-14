/**
 * Deterministic checks for the Storyteller MCP server, through a REAL MCP client over stdio.
 *
 * Spawns `mcp/storyteller.mts` from a NEUTRAL cwd (os.tmpdir()) on purpose: the server must relocate
 * itself to the project root, and spawning it from the repo would mask that bug entirely.
 *
 * Cost-free by construction: nothing here generates an image or a render. The one `generate` call
 * uses `until: "ingesting"`, which stops after the (free) fetch and before any paid stage.
 *
 * Run: npm run mcp:test:storyteller
 */
import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
const SERVER = path.join(PROJECT_ROOT, 'mcp', 'storyteller.mts');

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function parseText(result: any): any {
  const text = result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main(): Promise<void> {
  console.log(`[mcp-test] spawning ${SERVER} from cwd=${os.tmpdir()}\n`);
  const transport = new StdioClientTransport({
    command: TSX,
    args: [SERVER],
    cwd: os.tmpdir(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'storyteller-mcp-test', version: '1.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  console.log(`[mcp-test] tools: ${names.join(', ')}\n`);
  for (const expected of ['storyteller_generate', 'storyteller_status', 'storyteller_list_runs', 'storyteller_defaults']) {
    check(`tool ${expected} is exposed`, names.includes(expected));
  }
  check('exactly 4 tools', names.length === 4, `got ${names.length}: ${names.join(', ')}`);

  // ── defaults: also proves the server relocated to the project root ─────────────
  const defaults = parseText(await client.callTool({ name: 'storyteller_defaults', arguments: {} }));
  check('defaults.projectRoot is the repo', defaults?.projectRoot === PROJECT_ROOT, `got ${defaults?.projectRoot}`);
  check('defaults lists styles', Array.isArray(defaults?.styles) && defaults.styles.includes('infographic'));
  check('defaults lists aspects', Array.isArray(defaults?.aspects) && defaults.aspects.includes('16:9'));
  check('defaults expose the expected video model', Boolean(defaults?.expectedModels?.videoModel), JSON.stringify(defaults?.expectedModels));
  check('defaults report voice on', defaults?.defaults?.voice === true);
  check('defaults report the infographic-style default', defaults?.defaults?.style === 'infographic', `got ${defaults?.defaults?.style}`);

  // ── list_runs answers without a run ────────────────────────────────────────────
  const list = parseText(await client.callTool({ name: 'storyteller_list_runs', arguments: { limit: 3 } }));
  check('list_runs returns an array', Array.isArray(list?.runs));

  // ── status for a missing run is a clean error, not a crash ─────────────────────
  const missing = await client.callTool({ name: 'storyteller_status', arguments: { runId: 'no-such-run-id' } });
  check('status on an unknown run reports isError', missing?.isError === true);
  check('status error names the run', String(parseText(missing)).includes('no-such-run-id'));

  // ── generate with no url and no default must fail fast (not queue work) ────────
  const cfg = (await import('../src/lib/storytellerConfig')).loadStorytellerConfig();
  if (!cfg.defaultUrl) {
    const noUrl = await client.callTool({ name: 'storyteller_generate', arguments: {} });
    check('generate without a url fails fast', noUrl?.isError === true, String(parseText(noUrl)).slice(0, 120));
  } else {
    console.log('ℹ️  STORYTELLER_DEFAULT_URL is set — skipping the missing-url check');
  }

  // ── a real (free) enqueue: stops after ingest, before any paid stage ───────────
  const started = Date.now();
  const gen = await client.callTool({
    name: 'storyteller_generate',
    arguments: { url: 'https://example.com', until: 'ingesting' },
  });
  const elapsed = Date.now() - started;
  const genBody = parseText(gen);
  check('generate returns a runId', typeof genBody?.runId === 'string', JSON.stringify(genBody).slice(0, 160));
  check('generate returns promptly (non-blocking)', elapsed < 5000, `took ${elapsed}ms`);

  if (genBody?.runId) {
    // The run is asynchronous: poll briefly until it reaches a terminal state.
    let status: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      status = parseText(await client.callTool({ name: 'storyteller_status', arguments: { runId: genBody.runId } }));
      if (['done', 'failed'].includes(String(status?.status)) || status?.partial) break;
    }
    check('the enqueued run reaches a terminal/partial state', Boolean(status?.status), JSON.stringify(status).slice(0, 200));
    check('the partial run stopped after ingest', status?.partial === true && status?.status === 'ingesting', `status=${status?.status} partial=${status?.partial}`);
    check('the run recorded a title from ingestion', typeof status?.title === 'string' && status.title.length > 0, `title=${status?.title}`);
    check('run.json exists on disk', Boolean(status?.runDir));
  }

  await client.close();
  console.log(`\n[mcp-test] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[mcp-test] fatal:', err);
  process.exit(1);
});
