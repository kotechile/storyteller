/**
 * List the ElevenLabs voices this account can actually use, with their ids.
 *
 * The voice lives in `.env` as STORYTELLER_VOICE_ID, but the key the pipeline authenticates with is
 * resolved from Supabase (`getApiKey('elevenlabs')`), NOT from ELEVENLABS_API_KEY in `.env` — which is
 * stale/invalid on this machine. Reading the key through the same path the pipeline uses is the only
 * way to see the list the next run will really be able to speak with.
 *
 * Note: this needs the key to carry the `voices_read` permission. The key resolved from Supabase on
 * this machine only has TTS permissions, so the API answers 401 `missing_permissions` — grant
 * voices_read in ElevenLabs if you want the list from the CLI, otherwise copy the id from
 * Voices → ⋯ → Copy voice ID in the dashboard.
 *
 *   npx tsx scripts/list-voices.mts
 */
import { config } from 'dotenv';
import { getApiKey } from '../src/lib/supabaseClient';

config();

const key = await getApiKey('elevenlabs');
if (!key) {
  console.error('No ElevenLabs key resolved from Supabase (api_keys table, provider=elevenlabs).');
  process.exit(1);
}

const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
if (!res.ok) {
  console.error(`ElevenLabs responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}

const body = (await res.json()) as {
  voices?: Array<{ voice_id: string; name: string; category?: string; labels?: Record<string, string> }>;
};

const voices = body.voices ?? [];
console.log(`${voices.length} voice(s) available on this account:\n`);
for (const v of voices) {
  const labels = v.labels ? Object.entries(v.labels).slice(0, 3).map(([k, val]) => `${k}=${val}`).join(' ') : '';
  console.log(`  ${v.voice_id.padEnd(24)} ${(v.name ?? '').padEnd(26)} ${(v.category ?? '').padEnd(12)} ${labels}`);
}

const configured = process.env.STORYTELLER_VOICE_ID ?? '(unset)';
console.log(`\nCurrently configured: STORYTELLER_VOICE_ID=${configured}`);
if (voices.length && !voices.some((v) => v.voice_id === configured)) {
  console.log('  ^ that id is NOT in the list above — the next run will fail at the TTS stage.');
}
