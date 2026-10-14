/**
 * Phase 0 probe v2 — kie.ai Claude, against the REAL contract.
 *
 * Discovered from docs.kie.ai:
 *   POST https://api.kie.ai/claude/v1/messages      (verified 200 on 2026-10-11)
 *   auth:  Authorization: Bearer <key>   (x-api-key: Bearer <key> also accepted)
 *   response: { role, content:[{type:'text',text}], model, usage, stop_reason, credits_consumed }
 *   `model` must exactly match the alias documented for that model page.
 *
 * VERIFIED: claude-opus-5-5 → HTTP 200, upstream model "claude-opus-5-5", ~75s cold latency.
 * NOTE: do NOT use /api/v1/claude/v1/messages (404) — that path only appears in mirror docs.
 *
 * Run: npx tsx scripts/probe-kie-claude.ts
 */
import 'dotenv/config';
import { getApiKey } from '../src/lib/supabaseClient';

const ENDPOINT = 'https://api.kie.ai/claude/v1/messages';

const MODELS = [
  'claude-opus-5-5',      // VERIFIED 200 — the alias the redesign asked for
  'claude-sonnet-5',      // existing Supabase row
  '__definitely-not-a-model__', // harvest the error body for the valid alias list
];

async function probe(model: string, apiKey: string): Promise<void> {
  const t0 = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'reply with the single word: ok' }],
      }),
    });
    const raw = await res.text();
    let summary = raw.slice(0, 400).replace(/\s+/g, ' ');
    try {
      const j = JSON.parse(raw);
      const text = j?.content?.find?.((c: any) => c.type === 'text')?.text;
      summary = `upstreamModel=${j.model} text=${JSON.stringify(text ?? j.error ?? j.message ?? j)} credits=${j.credits_consumed}`;
    } catch {
      /* keep raw slice */
    }
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${model.padEnd(18)} HTTP ${res.status} ${String(Date.now() - t0).padStart(6)}ms :: ${summary}`);
  } catch (err) {
    console.log(`ERR  ${model.padEnd(18)} threw after ${Date.now() - t0}ms :: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.KIE_API_KEY || (await getApiKey('kie.ai'));
  if (!apiKey) throw new Error('No kie.ai key in KIE_API_KEY or Supabase api_keys.');
  console.log(`[probe] POST ${ENDPOINT} (stream=false)\n`);
  for (const m of MODELS) {
    await probe(m, apiKey);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

main();
