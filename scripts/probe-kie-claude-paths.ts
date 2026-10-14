/**
 * Path discovery for kie.ai's Claude endpoint (Phase 0 continued).
 *
 * The documented-looking path (/claude) returns Spring's "No message available" 404, which means
 * the route is not mapped at all — so find where it actually lives before writing a client.
 *
 * Run: npx tsx scripts/probe-kie-claude-paths.ts
 */
import 'dotenv/config';
import { getApiKey } from '../src/lib/supabaseClient';

const HOST = 'https://api.kie.ai';
const PATHS = [
  '/claude',
  '/claude/v1/messages',
  '/claude/chat/completions',
  '/api/v1/claude',
  '/api/v1/claude/v1/messages',
  '/api/v1/claude/chat/completions',
  '/api/v1/messages',
  '/v1/messages',
  '/api/v1/chat/completions',
  '/claude/messages',
];

const model = process.argv[2] || 'claude-opus-5-5';

async function main(): Promise<void> {
  const apiKey = process.env.KIE_API_KEY || (await getApiKey('kie.ai'));
  if (!apiKey) throw new Error('no kie.ai key');

  const body = JSON.stringify({
    model,
    max_tokens: 32,
    messages: [{ role: 'user', content: 'reply with the single word: ok' }],
  });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'x-api-key': `Bearer ${apiKey}`,
  };

  for (const p of PATHS) {
    for (const method of ['POST', 'GET'] as const) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${HOST}${p}`, {
          method,
          headers,
          body: method === 'POST' ? body : undefined,
        });
        const text = (await res.text()).slice(0, 260).replace(/\s+/g, ' ');
        console.log(`${method} ${p.padEnd(34)} ${res.status} ${String(Date.now() - t0).padStart(5)}ms :: ${text}`);
        if (res.status !== 404) break; // a mapped route is what we are hunting for
      } catch (err) {
        console.log(`${method} ${p.padEnd(34)} ERR :: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

main();
