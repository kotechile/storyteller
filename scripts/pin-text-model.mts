/**
 * Pin a text model to one or more planner roles, and prove the resolver agrees.
 *
 * Text models resolve by filtering `llm_models` client-side on [task_role, purpose, use_for, used_for]
 * and falling back to `is_default`. That makes routing a DATA change: setting `used_for` on a row is
 * enough, no redeploy. It also means a wrong `used_for` silently does nothing, which is why this script
 * reads back and re-runs the resolver instead of trusting the UPDATE.
 *
 * Deliberately never touches `is_default`: promoting a row to default hijacks every role app-wide,
 * including ones this change has no business touching.
 *
 *   npx tsx scripts/pin-text-model.mts <model_name> <role> [role ...]
 *   npx tsx scripts/pin-text-model.mts claude-sonnet-5 storyboard_planning art_director
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { resolveLlmModel } from '../src/lib/supabaseClient';

config();

const [modelName, ...roles] = process.argv.slice(2);
if (!modelName || roles.length === 0) {
  console.error('usage: pin-text-model.mts <model_name> <role> [role ...]');
  process.exit(1);
}

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const usedFor = `[${roles.join(',')}]`;
const { error } = await sb.from('llm_models').update({ used_for: usedFor }).eq('model_name', modelName);
if (error) {
  console.error(`UPDATE failed: ${error.message}`);
  process.exit(1);
}

const { data: rows } = await sb
  .from('llm_models')
  .select('model_name,provider,used_for,is_default')
  .eq('model_name', modelName);

console.log(`wrote used_for="${usedFor}" on ${modelName}`);
for (const r of rows ?? []) {
  console.log(`  read back: ${(r as any).model_name} · ${(r as any).provider} · used_for=${(r as any).used_for} · is_default=${(r as any).is_default}`);
}
if (!rows?.length) {
  console.error('  model_name did not match any row — nothing was pinned.');
  process.exit(1);
}

console.log('\nresolver check:');
let failures = 0;
for (const role of roles) {
  const cfg = (await resolveLlmModel(role)) as unknown as Record<string, unknown>;
  const resolved = String(cfg?.model ?? cfg?.modelName ?? cfg?.name ?? '?');
  const provider = String(cfg?.provider ?? '?');
  const ok = resolved === modelName;
  if (!ok) failures++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${role.padEnd(24)} → ${resolved} (${provider})`);
}
process.exit(failures === 0 ? 0 : 1);
