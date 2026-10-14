/**
 * brag-voice.mts — generates the /brag voiceover with ElevenLabs and emits ready-to-paste
 * HyperFrames <audio> elements plus the music ducking lane.
 *
 * Why ElevenLabs and not brag's default: /brag mandates Kokoro via `npx hyperframes tts`
 * ("intentionally single-provider"). The choice here is deliberate — the project already has
 * ElevenLabs configured with a specific voice (OMNICAST_VOICE_ID) and speed, and matching the
 * Remotion pipeline's voice was the explicit request.
 *
 * Reuses `synthesizePerSceneSpeech` rather than hand-rolling the API call: it already handles auth,
 * model selection (eleven_multilingual_v2 — the only one returning audio_base64 + alignment), and
 * word-level timestamps. Files land in the repo's public/ dir, so they are copied into the
 * composition's assets/vo/ afterwards.
 *
 * The guard the Remotion version lacked: every line is measured against ITS OWN scene duration, so a
 * line that would be clipped mid-sentence is reported instead of silently truncated by a <Sequence>.
 *
 * Usage: npx tsx scripts/brag-voice.mts --out <brag-output-dir> [--voice-id <id>] [--speed 0.95]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { synthesizePerSceneSpeech } from '../src/lib/elevenlabsTts';

interface LineSpec {
  scene: number;
  start: number;
  sceneSeconds: number;
  text: string;
}
interface VoSpec {
  voiceId: string;
  speed: number;
  lines: LineSpec[];
}

const argv = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const outDir = opt('--out');

// Ask ElevenLabs which voices this key can actually use, resolved through the SAME path the
// synthesizer uses (Supabase api_keys first, env second). Guessing a voice id wastes a run.
if (argv.includes('--list-voices')) {
  const { getApiKey } = await import('../src/lib/supabaseClient');
  const key = await getApiKey('elevenlabs');
  if (!key) {
    console.error('No ElevenLabs key found in Supabase api_keys or ELEVENLABS_API_KEY.');
    process.exit(1);
  }
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string; category?: string }[];
    detail?: { message?: string };
  };
  if (!data.voices) {
    console.error(`ElevenLabs replied (HTTP ${res.status}):`, JSON.stringify(data).slice(0, 400));
    process.exit(1);
  }
  console.log(`${data.voices.length} voice(s) available to this key:`);
  for (const v of data.voices) console.log(`  ${v.voice_id}  |  ${v.name}${v.category ? `  |  ${v.category}` : ''}`);
  process.exit(0);
}

if (!outDir) {
  console.error('Usage: npx tsx scripts/brag-voice.mts --out <brag-output-dir> [--voice-id <id>] [--speed 0.95]');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(path.join(outDir, 'voiceover.json'), 'utf8')) as VoSpec;
const voiceId = opt('--voice-id') ?? spec.voiceId;
const speed = Number(opt('--speed') ?? spec.speed);
const compDir = path.join(outDir, 'composition');
const publicDir = path.join(process.cwd(), 'public');

console.log(`\nvoice: ${voiceId} · speed ${speed} · ${spec.lines.length} line(s)`);
for (const l of spec.lines) {
  const words = l.text.trim().split(/\s+/).length;
  console.log(`  scene ${l.scene}: ${words} words into ${l.sceneSeconds}s — "${l.text}"`);
}

console.log('\nGenerating with ElevenLabs…');
const results = await synthesizePerSceneSpeech(
  spec.lines.map((l) => ({ sceneNumber: l.scene, narration: l.text })),
  { voiceId, speed },
);

// Copy the generated audio into the composition and measure it for real.
const voDir = path.join(compDir, 'assets', 'vo');
fs.mkdirSync(voDir, { recursive: true });

const rows: { scene: number; start: number; sceneSeconds: number; file: string; dur: number; slack: number }[] = [];
for (const spec_line of spec.lines) {
  const produced = results.find((r) => r.sceneNumber === spec_line.scene);
  if (!produced || !produced.audioUrl) {
    throw new Error(
      `[brag-voice] Scene ${spec_line.scene} produced no audio (audioUrl=${produced?.audioUrl ?? 'missing'}). ` +
        'ElevenLabs returned nothing — check ELEVENLABS_API_KEY / api_keys(provider="elevenlabs"). ' +
        'Refusing to build a composition whose narration is silently missing.',
    );
  }
  const src = path.join(publicDir, produced.audioUrl.replace(/^\/+/, ''));
  if (!fs.existsSync(src)) throw new Error(`[brag-voice] Expected audio at ${src} but it is not there.`);

  const ext = path.extname(src) || '.mp3';
  const destRel = `assets/vo/vo_${spec_line.scene}${ext}`;
  fs.copyFileSync(src, path.join(compDir, destRel));

  // ffprobe rather than the API's own number: this is the duration the renderer will actually see.
  const dur = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], {
      encoding: 'utf8',
    }).trim(),
  );

  rows.push({
    scene: spec_line.scene,
    start: spec_line.start,
    sceneSeconds: spec_line.sceneSeconds,
    file: destRel,
    dur,
    slack: spec_line.sceneSeconds - dur,
  });
}

console.log('\n=== measurement (ffprobe) ===');
let overflow = 0;
for (const r of rows) {
  const flag = r.slack < 0.15 ? (r.slack < 0 ? '❌ OVERFLOWS' : '⚠️  tight') : '✅';
  if (r.slack < 0.15) overflow++;
  console.log(
    `  scene ${r.scene}: ${r.dur.toFixed(2)}s of ${r.sceneSeconds}s (slack ${r.slack.toFixed(2)}s) ${flag}`,
  );
}

console.log('\n=== paste into index.html (voiceover track) ===');
for (const r of rows) {
  console.log(
    `<audio\n  id="vo-${r.scene}"\n  class="clip"\n  src="${r.file}"\n  data-start="${r.start}"\n  data-duration="${r.dur.toFixed(2)}"\n  data-track-index="3"\n  data-volume="1"\n></audio>`,
  );
}

console.log('\n=== music ducking lane (clip-local t, absolute gain; lane wins over data-volume) ===');
// Music element spans the whole video (0 -> 19s), so clip-local t == absolute time here.
// Base level is deliberately low (0.10, down from 0.17) and dips to 0.05 for each spoken line.
const BASE = 0.1;
const DUCK = 0.05;
const RAMP = 0.18;
const points: { t: number; v: number }[] = [{ t: 0, v: 0 }];
points.push({ t: 0.5, v: BASE });
for (const r of rows) {
  const end = r.start + r.dur;
  points.push({ t: Math.max(0, r.start - RAMP), v: BASE });
  points.push({ t: r.start + RAMP, v: DUCK });
  points.push({ t: Math.max(0, end - RAMP), v: DUCK });
  points.push({ t: Math.min(19, end + RAMP), v: BASE });
}
const last = rows[rows.length - 1];
// Fade to silence under the final hold, per the plan's outro.
points.push({ t: Math.min(19, last.start + last.dur + 0.4), v: BASE });
points.push({ t: 17.5, v: BASE * 0.6 });
points.push({ t: 19, v: 0 });
const dedup = points.filter((p, i, a) => i === 0 || p.t > a[i - 1].t).sort((a, b) => a.t - b.t);
console.log(JSON.stringify({ version: 1, lanes: [{ target: 'volume', points: dedup.map((p) => ({ t: Number(p.t.toFixed(2)), v: Number(p.v.toFixed(3)) })) }] }));

console.log(
  `\n${overflow === 0 ? '✅ every line fits its scene' : `❌ ${overflow} line(s) do not fit — shorten the script or lengthen the scene`}`,
);
process.exit(overflow === 0 ? 0 : 1);
