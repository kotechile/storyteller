/**
 * Phase 1 verification: config resolution + the kie.ai Claude client, including the trap.
 *
 * Run: npx tsx scripts/verify-phase1.ts
 */
import 'dotenv/config';
import { resolveLlmModel } from '../src/lib/supabaseClient';
import { loadOmnicastConfig, resolveTargetUrl, FORMATS } from '../src/lib/runtimeConfig';
import { callClaude, callClaudeJson, KieClaudeError } from '../src/lib/kieClaude';
import { z } from 'zod';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function main(): Promise<void> {
  // ── 1. runtimeConfig ───────────────────────────────────────────────────────
  console.log('\n[1] runtimeConfig');
  const cfg = loadOmnicastConfig();
  check('defaultFormat is a valid format', cfg.defaultFormat in FORMATS, cfg.defaultFormat);
  check('defaultMode is promo', cfg.defaultMode === 'promo', cfg.defaultMode);
  check('brag model configured', cfg.brag.model.length > 0, cfg.brag.model);
  check('opus timeout >= 180s', cfg.brag.timeoutMs >= 180_000, `${cfg.brag.timeoutMs}ms`);
  check('defaultDurationSeconds in brag window', cfg.defaultDurationSeconds >= 15 && cfg.defaultDurationSeconds <= 25, String(cfg.defaultDurationSeconds));
  check('bragSkillDir expanded', !cfg.paths.bragSkillDir.startsWith('~'), cfg.paths.bragSkillDir);

  // zero-arg URL resolution must fail LOUDLY when nothing is configured
  let urlErr = '';
  try {
    resolveTargetUrl(undefined, { ...cfg, defaultUrl: '' });
  } catch (e) {
    urlErr = (e as Error).message;
  }
  check('resolveTargetUrl throws with guidance when no url', /OMNICAST_DEFAULT_URL/.test(urlErr));
  check('resolveTargetUrl rejects a non-url', (() => {
    try {
      resolveTargetUrl('not a url', cfg);
      return false;
    } catch {
      return true;
    }
  })());

  // malformed enum must throw, not silently default
  let enumErr = '';
  try {
    loadOmnicastConfig({ ...process.env, OMNICAST_DEFAULT_FORMAT: 'widescreen' } as NodeJS.ProcessEnv);
  } catch (e) {
    enumErr = (e as Error).message;
  }
  check('invalid OMNICAST_DEFAULT_FORMAT throws', /widescreen/.test(enumErr));

  // ── 2. Supabase task-role resolution ───────────────────────────────────────
  console.log('\n[2] resolveLlmModel via Supabase llm_models.used_for');
  for (const role of [undefined, 'brag_planning', 'storyboard_planning', 'art_director', 'vision_analysis'] as const) {
    const resolved = await resolveLlmModel(role);
    console.log(`     role=${String(role).padEnd(20)} → ${resolved.modelName} (${resolved.provider}) key=${!!resolved.apiKey}`);
  }
  const brag = await resolveLlmModel('brag_planning');
  check('brag_planning resolves to the kie.ai Claude row', brag.modelName === 'claude-opus-5-5' && brag.provider === 'kie.ai', `${brag.modelName}/${brag.provider}`);
  check('brag_planning has an API key', !!brag.apiKey);

  // ── 3. the client: real call + JSON mode ───────────────────────────────────
  console.log('\n[3] callClaudeJson (real call, ~90s on opus)');
  const t0 = Date.now();
  const { value, model } = await callClaudeJson({
    messages: [
      {
        role: 'user',
        content:
          'Return JSON only: {"appName": "<name of the company that makes the Claude models>", "concepts": ["<2 short strings>"]}',
      },
    ],
    parse: (raw) =>
      z.object({ appName: z.string().min(2), concepts: z.array(z.string()).min(2) }).parse(raw),
  });
  check('callClaudeJson returned valid JSON', !!value.appName && value.concepts.length >= 2, `${model} in ${Date.now() - t0}ms :: ${JSON.stringify(value)}`);

  // ── 4. THE TRAP: a provider error arriving as HTTP 200 must THROW ──────────
  console.log('\n[4] HTTP-200 error body must throw (fallbacks disabled for the test)');
  const savedFallbacks = process.env.OMNICAST_BRAG_MODEL_FALLBACKS;
  process.env.OMNICAST_BRAG_MODEL_FALLBACKS = ''; // empty → no fallback models
  try {
    let threw: unknown = null;
    try {
      await callClaude({ messages: [{ role: 'user', content: 'hi' }], model: '__definitely-not-a-model__', transportRetries: 0, timeoutMs: 30_000 });
    } catch (e) {
      threw = e;
    }
    check('bogus model throws instead of returning "The page does not exist"', threw instanceof KieClaudeError, threw ? (threw as Error).message.split('\n')[0] : 'DID NOT THROW — the trap is unhandled!');
    if (threw instanceof KieClaudeError) {
      check('error carries the raw provider body', /page does not exist|Provider error/i.test(JSON.stringify(threw.attempts)));
    }
  } finally {
    if (savedFallbacks === undefined) delete process.env.OMNICAST_BRAG_MODEL_FALLBACKS;
    else process.env.OMNICAST_BRAG_MODEL_FALLBACKS = savedFallbacks;
  }

  console.log(`\n${failures === 0 ? '✅ Phase 1 verification PASSED' : `❌ Phase 1 verification FAILED (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ verification crashed:', err);
  process.exit(1);
});
