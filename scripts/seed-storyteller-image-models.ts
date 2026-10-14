/**
 * Seeds the Supabase `llm_used_for` rows that route the Storyteller image/video pipeline.
 *
 * Why this exists: `resolveImageModel` / `resolveVideoModel` read ONLY this junction table. Any
 * role without a row used to fall through to a hardcoded `pollinations-flux` / `runway-gen3`
 * default with an empty API key — a provider that is not configured here, so the stage either
 * failed deep inside a provider client or (historically) produced off-model output. Those
 * fallbacks are gone; a missing row now throws and names itself. This script creates the rows.
 *
 * Routing rule (verified 2026-10-13):
 *   - infographics / diagrams / charts / text  -> nano-banana-pro            (kie.ai)
 *   - photographic scenes                      -> flux-2/pro-text-to-image  (kie.ai)
 *   - animated scenes (image_to_video, text_to_video) -> bytedance/seedance-2-mini (kie.ai)
 *
 * Idempotent and verified by read-back. Retuning = one row edit in Supabase, no redeploy.
 *
 * Run: npx tsx scripts/seed-storyteller-image-models.ts
 */
import 'dotenv/config';
import { getSupabaseClient } from '../src/lib/supabaseClient';

type ImageRole = { used_for: string; model_name_like: string; why: string };

const IMAGE_ROLES: ImageRole[] = [
  {
    used_for: 'image_infographic',
    model_name_like: 'nano-banana-pro',
    why: 'infographics, diagrams, charts, rendered text — the default for every non-photographic style preset',
  },
  {
    used_for: 'image_realistic',
    model_name_like: 'flux-2/pro-text-to-image',
    why: 'photographic scenes (stylePreset "photo-realistic") — Flux 2 is good at realism, poor at infographics',
  },
  {
    used_for: 'image_generation',
    model_name_like: 'nano-banana-pro',
    why: 'back-compat alias: any caller that still asks for a generic image role must not miss',
  },
];

const VIDEO_ROLES: ImageRole[] = [
  {
    used_for: 'video_generation',
    model_name_like: 'seedance-2-mini',
    why: 'animated scenes — back-compat alias for the diagram_creator video role',
  },
];

/** find the model row (by fuzzy model_name) and point `used_for` at it. */
async function seedRole(
  client: any,
  table: 'llm_models_image' | 'llm_models_video',
  fkColumn: 'llm_image_id' | 'llm_video_id',
  role: ImageRole,
): Promise<void> {
  const { data: model, error: modelErr } = await client
    .from(table)
    .select('id, model_name, provider, api_keys_id, is_active')
    .ilike('model_name', `%${role.model_name_like}%`)
    .limit(1)
    .maybeSingle();
  if (modelErr) throw new Error(`[seed] ${table} lookup failed: ${modelErr.message}`);
  if (!model) throw new Error(`[seed] No ${table} row matching model_name~"${role.model_name_like}". Create it in Supabase first.`);
  if (!model.api_keys_id) throw new Error(`[seed] ${table} row "${model.model_name}" has no api_keys_id — it can never resolve a key.`);
  if (model.is_active === false) console.warn(`[seed] WARNING: "${model.model_name}" is is_active=false but will still be routed.`);

  // prove the key row actually holds a key before we route traffic at it
  const { data: keyRow, error: keyErr } = await client
    .from('api_keys')
    .select('id, key_value')
    .eq('id', model.api_keys_id)
    .maybeSingle();
  if (keyErr) throw new Error(`[seed] api_keys lookup failed: ${keyErr.message}`);
  if (!keyRow?.key_value) throw new Error(`[seed] api_keys.id=${model.api_keys_id} (behind "${model.model_name}") has no key_value.`);

  const { data: existing, error: findErr } = await client
    .from('llm_used_for')
    .select('id, llm_image_id, llm_video_id')
    .eq('used_for', role.used_for)
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(`[seed] llm_used_for lookup failed: ${findErr.message}`);

  if (existing?.id) {
    const currentFk = (existing as any)[fkColumn];
    if (currentFk === model.id) {
      console.log(`[seed] ${role.used_for} already -> ${model.model_name} (id=${model.id}). No change.`);
    } else {
      const { error } = await client.from('llm_used_for').update({ [fkColumn]: model.id }).eq('id', existing.id);
      if (error) throw new Error(`[seed] llm_used_for update failed: ${error.message}`);
      console.log(`[seed] Repointed ${role.used_for}: ${currentFk ?? '(none)'} -> ${model.model_name} (id=${model.id}).`);
    }
  } else {
    const { error } = await client
      .from('llm_used_for')
      .insert({ used_for: role.used_for, llm_models_id: null, [fkColumn]: model.id });
    if (error) throw new Error(`[seed] llm_used_for insert failed: ${error.message}`);
    console.log(`[seed] Inserted ${role.used_for} -> ${model.model_name} (id=${model.id}).`);
  }

  // ── read-back: the row we just wrote is the row the resolver will read ──
  const { data: verify, error: verifyErr } = await client
    .from('llm_used_for')
    .select(`used_for, ${fkColumn}, ${table}(model_name, provider)`)
    .eq('used_for', role.used_for)
    .limit(1)
    .maybeSingle();
  if (verifyErr) throw new Error(`[seed] read-back failed: ${verifyErr.message}`);
  const verifiedModel = (verify as any)?.[table]?.model_name ?? '(unresolved)';
  if (verifiedModel !== model.model_name) {
    throw new Error(`[seed] read-back mismatch for ${role.used_for}: expected "${model.model_name}", got "${verifiedModel}"`);
  }
  console.log(`[seed]   ✓ read-back OK: ${role.used_for} -> ${verifiedModel} (provider: ${(verify as any)[table].provider})`);
  console.log(`[seed]   why: ${role.why}`);
}

async function main(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('[seed] Supabase client unavailable — check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');

  console.log('[seed] Image roles:');
  for (const role of IMAGE_ROLES) await seedRole(client, 'llm_models_image', 'llm_image_id', role);

  console.log('[seed] Video roles:');
  for (const role of VIDEO_ROLES) await seedRole(client, 'llm_models_video', 'llm_video_id', role);

  console.log('[seed] Done.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
