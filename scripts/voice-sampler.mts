/**
 * Render one line of narration in several ElevenLabs voices so a choice can be made by ear.
 *
 * Picking a voice from a table of adjectives is guesswork: "Clear, Engaging Educator" and "Steady
 * Broadcaster" both read fine and sound nothing alike on an infographic explainer. This writes one
 * MP3 per voice with the SAME sentence, so the comparison is like-for-like.
 *
 *   npx tsx scripts/voice-sampler.mts [--out <dir>] [voiceId ...]
 */
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { getApiKey } from '../src/lib/supabaseClient';

config();

const SENTENCE =
  'A ninety percent efficient furnace still wastes ten cents of every dollar, and that gap is what decides whether a heat pump ever pays for itself.';

const DEFAULT_VOICES: Array<[string, string]> = [
  ['c6SfcYrb2t09NHXiT80T', 'Jarnathan (current)'],
  ['onwK4e9ZLuTAKqWW03F9', 'Daniel - Steady Broadcaster'],
  ['Xb7hH8MSUJpSbSDYk0k2', 'Alice - Clear, Engaging Educator'],
  ['JBFqnCBsd6RMkjVDRZzb', 'George - Warm Storyteller'],
  ['douDhHvfoViWmZth0cUX', 'Peter - Youthful, Expressive'],
];

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : '/tmp/voice-samples';
const requested = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));

const voices: Array<[string, string]> = requested.length
  ? requested.map((id) => [id, id] as [string, string])
  : DEFAULT_VOICES;

const key = await getApiKey('elevenlabs');
if (!key) {
  console.error('No ElevenLabs key resolved from Supabase.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const speed = Number(process.env.STORYTELLER_VOICE_SPEED ?? 0.95);

for (const [id, label] of voices) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: SENTENCE,
      model_id: process.env.STORYTELLER_TTS_MODEL ?? 'eleven_multilingual_v2',
      voice_settings: {
        stability: Number(process.env.STORYTELLER_VOICE_STABILITY ?? 0.5),
        similarity_boost: Number(process.env.STORYTELLER_VOICE_SIMILARITY ?? 0.75),
        speed,
      },
    }),
  });

  if (!res.ok) {
    console.error(`${label} (${id}) → HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
    continue;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(outDir, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${id.slice(0, 6)}.mp3`);
  fs.writeFileSync(file, buf);
  console.log(`${file}  ${(buf.length / 1024).toFixed(0)} KB  (${label})`);
}
