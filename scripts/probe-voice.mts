/**
 * Prove the ElevenLabs path end-to-end WITHOUT paying for a video: resolve the key the pipeline uses
 * (Supabase api_keys → provider=elevenlabs), synthesize one sentence with the configured voice, and
 * report what came back.
 *
 * This is the check that separates three failures which all look alike from the storyboard stage:
 *   - key missing/invalid        → 400 invalid_api_key
 *   - key lacks a permission     → 401 missing_permissions (name is in the body)
 *   - voice id not on account    → 400/404 naming the voice
 *
 *   npx tsx scripts/probe-voice.mts [voiceId]
 */
import { config } from 'dotenv';
import { getApiKey } from '../src/lib/supabaseClient';

config();

const voiceId = process.argv[2] ?? process.env.STORYTELLER_VOICE_ID ?? 'c6SfcYrb2t09NHXiT80T';
const modelId = process.env.STORYTELLER_TTS_MODEL ?? 'eleven_multilingual_v2';

const key = await getApiKey('elevenlabs');
if (!key) {
  console.error('No ElevenLabs key resolved from Supabase (api_keys, provider=elevenlabs).');
  process.exit(1);
}
console.log(`key from Supabase: ${key.slice(0, 6)}… (${key.length} chars) · voice ${voiceId} · model ${modelId}`);

const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
  method: 'POST',
  headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: 'A ninety percent efficient furnace still wastes ten cents of every dollar.',
    model_id: modelId,
  }),
});

console.log(`HTTP ${res.status}`);
if (!res.ok) {
  console.error((await res.text()).slice(0, 300));
  process.exit(1);
}

const body = (await res.json()) as {
  audio_base64?: string;
  alignment?: { characters?: string[] };
};
const bytes = Buffer.from(body.audio_base64 ?? '', 'base64');
console.log(`audio_base64: ${(bytes.length / 1024).toFixed(0)} KB`);
console.log(`characters aligned: ${body.alignment?.characters?.length ?? 0}`);

if (bytes.length < 5_000) {
  console.error('Audio is implausibly small — treat as a failure, not a short clip.');
  process.exit(1);
}
if (!body.alignment?.characters?.length) {
  console.error('No alignment returned: captions would fall back to estimated timing.');
  process.exit(1);
}
console.log('OK — voice, key and timestamps all verified.');
