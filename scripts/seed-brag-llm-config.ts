/**
 * Seeds the Supabase config-as-data rows that put brag's creative work on Claude (kie.ai).
 *
 * Two mechanisms exist in this schema and we deliberately populate BOTH:
 *
 *  1. `llm_models.used_for` — a plain text column. resolveLlmModel() filters client-side on
 *     [task_role, purpose, use_for, used_for] via substring match, so setting
 *     used_for='brag_planning' makes resolveLlmModel('brag_planning') return this model with NO
 *     resolver code change. Every existing row has used_for=null, which is precisely why task
 *     roles are currently ignored for text LLMs and everything falls back to is_default.
 *  2. `llm_used_for` — the FK junction consulted by resolveImageModel/resolveVideoModel.
 *     Kept in sync so text/image/video roles all read the same way.
 *
 * Idempotent and verified by read-back. Retuning the model later is one row edit in Supabase.
 *
 * Run: npx tsx scripts/seed-brag-llm-config.ts
 */
import 'dotenv/config';
import { getSupabaseClient } from '../src/lib/supabaseClient';

const MODEL_NAME = process.env.OMNICAST_BRAG_MODEL || 'claude-opus-5-5';
const DISPLAY_NAME = 'Claude Opus 5.5 (kie.ai)';
const PROVIDER = 'kie.ai';
const USED_FOR = 'brag_planning';

async function main(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('[seed] Supabase client unavailable — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');

  const { data: keyRow, error: keyErr } = await client
    .from('api_keys')
    .select('id, provider')
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (keyErr) throw new Error(`[seed] api_keys lookup failed: ${keyErr.message}`);
  if (!keyRow?.id) throw new Error(`[seed] No api_keys row for provider "${PROVIDER}".`);
  console.log(`[seed] Reusing api_keys.id=${keyRow.id} (provider=${PROVIDER})`);

  // ── 1) the model row ────────────────────────────────────────────────────────
  // is_default MUST stay false: a true here would hijack EVERY default-resolution path app-wide.
  const { data: existing, error: findErr } = await client
    .from('llm_models')
    .select('id, name, model_name, provider, is_active, is_default, used_for')
    .eq('model_name', MODEL_NAME)
    .maybeSingle();
  if (findErr) throw new Error(`[seed] llm_models lookup failed: ${findErr.message}`);

  let modelId = existing?.id as string | undefined;

  if (modelId) {
    console.log(`[seed] llm_models row present: ${MODEL_NAME} (id=${modelId})`);
    if (existing?.is_default) {
      throw new Error('[seed] This row has is_default=true — it would affect ALL default model resolution. Aborting.');
    }
    if (existing?.used_for !== USED_FOR) {
      const { error } = await client
        .from('llm_models')
        .update({ used_for: USED_FOR, is_active: true })
        .eq('id', modelId);
      if (error) throw new Error(`[seed] llm_models update failed: ${error.message}`);
      console.log(`[seed] Set used_for="${USED_FOR}" on existing row.`);
    }
  } else {
    const { data: inserted, error: insErr } = await client
      .from('llm_models')
      .insert({
        name: DISPLAY_NAME,          // NOT NULL in this schema
        model_name: MODEL_NAME,
        provider: PROVIDER,
        api_keys_id: keyRow.id,
        is_active: true,
        is_default: false,
        used_for: USED_FOR,
      })
      .select('id')
      .single();
    if (insErr) throw new Error(`[seed] llm_models insert failed: ${insErr.message}`);
    modelId = inserted!.id as string;
    console.log(`[seed] Inserted llm_models: "${DISPLAY_NAME}" / ${MODEL_NAME} (id=${modelId}, used_for=${USED_FOR})`);
  }

  // ── 2) the junction row (parity with image/video roles) ─────────────────────
  const { data: mapping, error: mapFindErr } = await client
    .from('llm_used_for')
    .select('id, llm_models_id')
    .eq('used_for', USED_FOR)
    .maybeSingle();
  if (mapFindErr) throw new Error(`[seed] llm_used_for lookup failed: ${mapFindErr.message}`);

  if (mapping) {
    if (mapping.llm_models_id !== modelId) {
      const { error } = await client.from('llm_used_for').update({ llm_models_id: modelId }).eq('id', mapping.id);
      if (error) throw new Error(`[seed] llm_used_for update failed: ${error.message}`);
      console.log(`[seed] Repointed llm_used_for("${USED_FOR}").`);
    } else {
      console.log(`[seed] llm_used_for("${USED_FOR}") already correct.`);
    }
  } else {
    const { error } = await client.from('llm_used_for').insert({ llm_models_id: modelId, used_for: USED_FOR });
    if (error) throw new Error(`[seed] llm_used_for insert failed: ${error.message}`);
    console.log(`[seed] Inserted llm_used_for("${USED_FOR}").`);
  }

  // ── 3) read back and assert ────────────────────────────────────────────────
  const { data: verify, error: verifyErr } = await client
    .from('llm_models')
    .select('id, name, model_name, provider, is_active, is_default, used_for, api_keys_id')
    .eq('model_name', MODEL_NAME)
    .maybeSingle();
  if (verifyErr) throw new Error(`[seed] read-back failed: ${verifyErr.message}`);
  console.log('[seed] Read-back:', JSON.stringify(verify));

  if (verify?.used_for !== USED_FOR) throw new Error('[seed] VERIFICATION FAILED: used_for not set.');
  if (verify?.is_default !== false) throw new Error('[seed] VERIFICATION FAILED: is_default must be false.');
  if (verify?.api_keys_id !== keyRow.id) throw new Error('[seed] VERIFICATION FAILED: api_keys_id mismatch.');

  console.log(`[seed] ✅ ${USED_FOR} → ${verify.model_name} (${verify.provider}, is_default=false)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
