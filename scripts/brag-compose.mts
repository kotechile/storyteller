/**
 * brag-compose.mts — authors the HyperFrames composition with a configurable text model.
 *
 * /brag Step 3 hands the storyboard to HyperFrames and lets it decide composition structure,
 * animation mechanics and timing. This script does that hand-off, because the composition
 * HTML is where the design quality actually comes from.
 *
 * Provider is selectable (`--provider kie.ai | deepseek`) so a reseller outage on one upstream does
 * not block the workflow. kie.ai serves claude-opus-5-5; deepseek serves deepseek-v4-pro.
 *
 * The contract is NOT reconstructed from memory: it comes from the scaffolded project's own
 * AGENTS.md plus `npx hyperframes docs data-attributes`, and the scaffold index.html is passed as
 * the starting point so the runtime wiring stays exactly as the framework expects.
 *
 * The model cannot run the CLI, so the loop is: model writes -> `npm run check` -> agent feeds errors back.
 *
 * Usage: npx tsx scripts/brag-compose.mts --out <brag-output-dir> [--provider deepseek] [--model <alias>]
 *                                          [--feedback <check-output.txt>]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { callText, type TextProvider } from '../src/lib/textModel';

const argv = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const outDir = opt('--out');
/** kie.ai (claude-opus-5-5) or deepseek (deepseek-v4-pro). */
const provider = (opt('--provider') ?? 'kie.ai') as TextProvider;
/** Omit to use the provider's default model. */
const model = opt('--model');
const feedbackFile = opt('--feedback');

if (!outDir) {
  console.error('Usage: npx tsx scripts/brag-compose-kie.mts --out <brag-output-dir> [--feedback <check-output.txt>]');
  process.exit(1);
}

const compDir = path.join(outDir, 'composition');
const plan = fs.readFileSync(path.join(outDir, 'brag-plan.md'), 'utf8');
const brief = fs.existsSync(path.join(outDir, 'composition-brief.md'))
  ? fs.readFileSync(path.join(outDir, 'composition-brief.md'), 'utf8')
  : '(composition brief missing)';
const contract = fs.readFileSync(path.join(compDir, 'AGENTS.md'), 'utf8');
const scaffold = fs.readFileSync(path.join(compDir, 'index.html'), 'utf8');

// Make the real page captures available to the composition on a relative path.
const srcDir = path.join(outDir, 'source');
const assetsDir = path.join(compDir, 'assets', 'source');
fs.mkdirSync(assetsDir, { recursive: true });
const shots: string[] = [];
if (fs.existsSync(srcDir)) {
  for (const f of fs.readdirSync(srcDir).filter((x) => /\.(png|jpe?g|webp)$/i.test(x))) {
    fs.copyFileSync(path.join(srcDir, f), path.join(assetsDir, f));
    shots.push(`assets/source/${f}`);
  }
}
console.log(`composition dir: ${compDir}`);
console.log(`real page captures available: ${shots.join(', ') || '(none)'}`);

// Enumerate the audio actually on disk so the composition can only reference real paths.
// The SFX bundle holds 262 files; list the ones that suit this plan (quiet ticks, switches,
// keypresses, soft impacts/bells) and cap the list rather than dumping all of them into the prompt.
const assetsRoot = path.join(compDir, 'assets');
const musicDir = path.join(assetsRoot, 'music');
const musicFiles = fs.existsSync(musicDir)
  ? fs.readdirSync(musicDir).filter((f) => /\.(mp3|wav|m4a)$/i.test(f))
  : [];

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

const sfxRoot = path.join(assetsRoot, 'sfx');
const allSfx = fs.existsSync(sfxRoot)
  ? walk(sfxRoot)
      .filter((f) => /\.(ogg|wav|mp3)$/i.test(f))
      .map((f) => path.relative(assetsRoot, f).split(path.sep).join('/'))
  : [];
const PREFERRED = /sfx\/interface\/|impactBell|impactSoft|impactPlate|ui\/click|ui\/switch|ui\/rollover|keyboard\/keypress-0[0-2]/;
const preferredSfx = allSfx.filter((f) => PREFERRED.test(f));
const sfxFiles = (preferredSfx.length >= 10 ? preferredSfx : allSfx).slice(0, 70);
console.log(`audio available: ${musicFiles.length} music track(s), ${allSfx.length} sfx (offering ${sfxFiles.length} to the model)`);

// The authoritative attribute reference, straight from the CLI rather than from memory.
let docs = '';
try {
  docs = execFileSync('npx', ['--yes', 'hyperframes', 'docs', 'data-attributes'], {
    cwd: compDir,
    encoding: 'utf8',
    timeout: 180_000,
  });
  console.log(`fetched hyperframes data-attributes docs (${docs.length} chars)`);
} catch (err) {
  console.log(`⚠️  could not fetch hyperframes docs: ${String(err).split('\n')[0]}`);
}

const feedback = feedbackFile && fs.existsSync(feedbackFile) ? fs.readFileSync(feedbackFile, 'utf8') : '';

const prompt = `You are authoring a HyperFrames composition (HTML) that implements a /brag launch video.

Write the COMPLETE final \`index.html\` for the project. Output only that file, inside the delimiter
lines shown at the end. No commentary, no other files.

# THE COMPOSITION CONTRACT (from this project's own AGENTS.md — obey exactly)
${contract}

# THE AUTHORITATIVE data-* ATTRIBUTE REFERENCE (from \`hyperframes docs data-attributes\`)
${docs || '(docs unavailable — follow AGENTS.md Key Rules exactly and use only the attributes shown in the scaffold)'}

# THE SCAFFOLD index.html — KEEP ITS RUNTIME WIRING
Start from this and keep the framework wiring intact (the root element's data-composition-id,
data-resolution, the GSAP script tag, and the paused timeline registered on window.__timelines).
Replace the placeholder content with the real composition:
\`\`\`html
${scaffold}
\`\`\`

# THE CREATIVE CONTRACT — brag-plan.md (the storyboard, copy, timings and tone are FIXED here)
${plan}

# THE COMPOSITION BRIEF — what HyperFrames owns
${brief}

# REAL MATERIAL AVAILABLE ON DISK (relative to index.html; use at least one — the brag law
# "show the thing" requires real page material, not abstract filler)
${shots.length ? shots.map((s) => `- ${s}`).join('\n') : '- (no captures available — use the page copy and its figures typographically)'}
The page's own figures and category names (from the plan) are real product copy and may be shown
verbatim. Do NOT invent per-category dollar amounts: the source gives only $16,800.00 (gross) and
$2,549.60 (total deductions) — the Fees/Refunds/Chargebacks rows carry no amounts.

# REAL AUDIO FILES ON DISK (relative to index.html). Only reference paths from this list —
# never invent a path, and never fetch media remotely.
Music (pick exactly one as the bed; it is a 120 BPM upbeat business track, so keep it LOW and
treat it as a quiet bed, not a driver):
${musicFiles.length ? musicFiles.map((f) => `- assets/music/${f}`).join('\n') : '- (no music files present — omit the music element)'}

SFX (choose filenames whose names match the motion; the plan wants quiet ledger ticks for the
journal rows and exactly ONE soft confirm chime at the "Variance $0.00" moment):
${sfxFiles.length ? sfxFiles.map((f) => `- assets/${f}`).join('\n') : '- (no sfx files present — omit the SFX layer)'}

# HARD REQUIREMENTS
- Canvas is PORTRAIT 1080x1920. Total duration 19 seconds, matching the plan's 4 scenes
  (3.5s / 5s / 5.5s / 5s) exactly.
- Every timed visual element needs class="clip" plus data-start and data-duration. Scene 1 starts at 0.
- One paused GSAP root timeline registered on window.__timelines, seeked such that the render is
  deterministic. NO Date.now(), NO Math.random(), NO network requests, NO CSS keyframe animations
  that the timeline cannot seek — all motion must be driven by the GSAP timeline so it is seek-safe.
- Use the plan's exact copy. Where the plan marks a line as needing to settle, hold it.
- Currency figures use tabular figures so columns align.
- Include the audio layer using the real files listed above, placed on their own tracks with the
  plan's volumes and timings.
- Terminate the timeline cleanly at 19s (no trailing empty time).
- Do NOT add a caption/subtitle track, a progress bar, or a watermark. They are not in the plan.
${feedback ? `\n# PREVIOUS ATTEMPT FAILED THE CHECK — FIX THESE EXACTLY\nThis is a repair round. The composition you wrote before was rejected by \`npm run check\`.\nHere is its verbatim output:\n\n${feedback}\n\nFix every error. Do not change the creative direction, copy, or timings to work around a check failure.` : ''}

===BEGIN INDEX.HTML===
(the complete index.html)
===END INDEX.HTML===
`;

// Model-aware budgets. A REASONING model (DeepSeek Pro) spends max_tokens on hidden reasoning before
// it writes anything, so it needs a huge budget and a long timeout — and even then it can run past
// 15 minutes. A fast chat model (DeepSeek Flash) needs neither: this task is artifact generation
// against a fully-specified contract, not an open-ended reasoning problem.
const isReasoning = /(^|[-_])pro$|reasoner|thinking/i.test(model ?? '');
const maxTokens = isReasoning ? 64000 : provider === 'deepseek' ? 16000 : 18000;
const timeoutMs = isReasoning ? 900_000 : 300_000;
console.log(`\nAuthoring with ${model ?? '(provider default)'} via ${provider} (prompt ${prompt.length} chars, max_tokens ${maxTokens}, timeout ${timeoutMs / 1000}s${isReasoning ? ', reasoning model' : ''})${feedback ? ' [REPAIR ROUND]' : ''}…`);
const result = await callText({ provider, model, messages: [{ role: 'user', content: prompt }], maxTokens, temperature: 0.4, timeoutMs });
console.log(
  `ok in ${(result.latencyMs / 1000).toFixed(1)}s (upstream: ${result.upstreamModel ?? result.requestedModel}, ` +
    `${result.creditsConsumed ?? '?'} credits, ${result.text.length} chars)`,
);

const begin = '===BEGIN INDEX.HTML===';
const end = '===END INDEX.HTML===';
const b = result.text.indexOf(begin);
const e = result.text.indexOf(end);
if (b < 0 || e < 0 || e < b) {
  fs.writeFileSync(path.join(outDir, 'compose-raw-response.txt'), result.text);
  throw new Error(`[brag-compose-kie] No INDEX.HTML delimiter in the response — raw saved to ${outDir}/compose-raw-response.txt`);
}

let html = result.text.slice(b + begin.length, e).trim();
// The model sometimes wraps the file in a fence despite instructions; unwrap it rather than shipping it.
html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');

fs.writeFileSync(path.join(compDir, 'index.html'), html + '\n');
console.log(`\nwrote ${compDir}/index.html (${html.length} chars)`);
