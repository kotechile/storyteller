/**
 * brag-plan-kie.ts — runs /brag Step 2 (plan + storyboard) on kie.ai's claude-opus-5-5.
 *
 * Why this exists: /brag is an agent workflow. The agent here (Hermes, on a much smaller model)
 * should not be the one deciding the creative angle, so the planning step is delegated to Opus over
 * kie.ai — the same model /brag expects, at reseller cost instead of first-party Opus pricing.
 *
 * Faithfulness: the prompt is built from /brag's OWN reference files read off disk — SKILL.md's
 * creative laws, references/step-2-plan.md (rubric + output format), references/tones.md, and
 * references/step-3-compose.md (the brief template). Nothing is reconstructed from memory, so the
 * plan matches the installed skill rather than a paraphrase of it.
 *
 * Opus is a text API: it cannot run a CLI. It produces brag-plan.md and composition-brief.md;
 * the HyperFrames build/check/render steps are executed by the agent.
 *
 * Usage:
 *   npx tsx scripts/brag-plan-kie.ts --url <url> --out <brag-output-dir> [--tone polished]
 *                                    [--format vertical] [--duration 20] [--model claude-opus-5-5]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { callClaude } from '../src/lib/kieClaude';
import { ingestUrl } from '../src/lib/ingest';
import { extractSiteIdentity, resolveIdentity } from '../src/lib/siteIdentity';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const url = argv.find((a) => a.startsWith('http'));
const outDir = opt('--out');
const tone = opt('--tone') ?? 'polished';
const format = (opt('--format') ?? 'vertical') as 'vertical' | 'landscape' | 'square';
const duration = Number(opt('--duration') ?? 20);
const model = opt('--model') ?? 'claude-opus-5-5';
/** brag defaults voice OFF; narration is opt-in there and uses Kokoro, not ElevenLabs. */
const voice = argv.includes('--voice');
const music = !argv.includes('--no-music');
const sfx = !argv.includes('--no-sfx');

const DIMS = { vertical: '1080x1920', landscape: '1920x1080', square: '1080x1080' } as const;

if (!url || !outDir) {
  console.error('Usage: npx tsx scripts/brag-plan-kie.ts --url <url> --out <brag-output-dir> [--tone polished]');
  process.exit(1);
}
if (duration < 15 || duration > 25) {
  console.error(`--duration must be 15-25 (brag's window); got ${duration}`);
  process.exit(1);
}

// .env may set OMNICAST_BRAG_SKILL_DIR with a literal leading "~", which Node does not expand
// (unlike a shell) — expand it here, or the skill's own reference files cannot be read.
const skillDir = ((): string => {
  const raw = process.env.OMNICAST_BRAG_SKILL_DIR;
  if (!raw) return path.join(os.homedir(), '.hermes', 'skills', 'brag');
  return raw.replace(/^~(?=\/|$)/, os.homedir());
})();
const readSkill = (rel: string): string => {
  const p = path.join(skillDir, rel);
  if (!fs.existsSync(p)) throw new Error(`brag skill file missing: ${p}`);
  return fs.readFileSync(p, 'utf8');
};

// ── Source material ───────────────────────────────────────────────────────
console.log(`\n[1/3] Ingesting ${url}`);
const article = await ingestUrl(url);
const identity = resolveIdentity(await extractSiteIdentity(url));
console.log(`      "${article.title}" — ${article.wordCount} words, ${article.assets.length} asset(s)`);
for (const w of identity.warnings) console.log(`      identity warning: ${w}`);

const sourceDir = path.join(outDir, 'source');
const captures = fs.existsSync(sourceDir)
  ? fs.readdirSync(sourceDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
  : [];

const assetList = article.assets
  .map((a, i) => `  ${i + 1}. ${a.url}${a.altText ? ` — alt: "${a.altText}"` : ''}${a.classification ? ` [${a.classification}]` : ''}`)
  .join('\n') || '  (none extracted)';

// ── Prompt, built from the skill's own files ──────────────────────────────
const prompt = `You are executing the /brag skill's Step 2 (Plan and storyboard) for a launch video.

You are the planner only. Write two markdown documents and nothing else. Do not describe what you
would do; produce the documents.

# INPUT
- Product / page URL: ${url}
- Page title: ${article.title}
- Word count: ${article.wordCount}
- EXCERPT: ${article.excerpt || '(none)'}
- Format: ${format} (${DIMS[format]})
- Tone preset: ${tone}
- Target duration: ${duration} seconds (HARD window: 15-25s; scene durations MUST sum to between 15 and 25)
- Audio: voiceover ${voice ? 'ENABLED' : 'DISABLED'}, music ${music ? 'enabled' : 'disabled'}, sfx ${sfx ? 'enabled' : 'disabled'}

IMPORTANT SOURCE NOTE: this input is a live web page, not a project directory. There is no source
tree to read. The "real UI / show the thing" material is therefore the captured screenshots of the
page (listed below) plus the page's own copy. Do not invent product claims that the page does not
make — see the grounding rule in the compose reference.

Screenshots captured from the live page and available to the composition (in \`<output-dir>/source/\`):
${captures.length ? captures.map((c) => `  · ${c}`).join('\n') : '  (none — you must plan around typographic scenes only)'}

Images found in the page markup:
${assetList}

PAGE TEXT (this is the product's actual copy — quote it, do not paraphrase reality):
"""
${article.textContent.slice(0, 30000)}
"""

Site identity signals detected from the live page (these are measurements, not guesses):
- background: ${identity.background}
- text: ${identity.text}
- accent: ${identity.accent}
- display font: ${identity.displayFont}
- body font: ${identity.bodyFont}
${identity.warnings.length ? identity.warnings.map((w) => `- WARNING to state in the plan: ${w}`).join('\n') : '- (no identity warnings)'}

# THE /brag CREATIVE LAWS (verbatim from the skill — obey all of them)
${readSkill('SKILL.md').split('## Creative laws')[1]?.split('## Tone system')[0] ? '## Creative laws' + readSkill('SKILL.md').split('## Creative laws')[1] : readSkill('SKILL.md')}

# PLANNING RULES AND OUTPUT FORMAT (verbatim from the skill — your documents must match this structure)
${readSkill('references/step-2-plan.md')}

# TONE PRESETS AVAILABLE (pick and justify; the preset is '${tone}')
${readSkill('references/tones.md')}

# THE COMPOSITION BRIEF TEMPLATE (your second document must follow this structure)
${readSkill('references/step-3-compose.md').split('## Create the composition brief')[1]?.split('The brief is the boundary')[0] ?? ''}

# YOUR OUTPUT
Produce exactly two documents, in this order, separated by the exact delimiter lines shown.
Do not wrap them in code fences. Do not add any other commentary before, between, or after.

===BEGIN BRAG-PLAN.MD===
(the complete <output-dir>/brag-plan.md, following the step-2-plan.md structure exactly,
 including the planning rubric answers, the angle, the hook, the storyboard with per-scene
 durations that sum to between 15 and 25 seconds, the visual identity section, the audio
 direction section, and the share copy draft. Where a value was measured, use the measured
 value above; where it is a guess, say so explicitly.)
===END BRAG-PLAN.MD===

===BEGIN COMPOSITION-BRIEF.MD===
(the complete <output-dir>/composition-brief.md, following the brief template structure above.
 Use these exact paths where the template asks for them:
   - composition directory: ${outDir}/composition/
   - rendered video: ${outDir}/brag.mp4
   - source material: the screenshots in ${outDir}/source/ and the page copy above
 The storyboard summary must match the storyboard in the plan you just wrote.)
===END COMPOSITION-BRIEF.MD===
`;

console.log(`\n[2/3] Planning with ${model} via kie.ai (prompt ${prompt.length} chars)…`);
const result = await callClaude({ messages: [{ role: 'user', content: prompt }], model, maxTokens: 16000, temperature: 0.5 });
console.log(
  `      ok in ${(result.latencyMs / 1000).toFixed(1)}s (upstream: ${result.upstreamModel ?? result.requestedModel}, ` +
    `${result.creditsConsumed ?? '?'} credits, ${result.text.length} chars)`,
);

// ── Split and write ───────────────────────────────────────────────────────
const grab = (begin: string, end: string): string => {
  const b = result.text.indexOf(begin);
  const e = result.text.indexOf(end);
  if (b < 0 || e < 0 || e < b) return '';
  return result.text.slice(b + begin.length, e).trim();
};

const planMd = grab('===BEGIN BRAG-PLAN.MD===', '===END BRAG-PLAN.MD===');
const briefMd = grab('===BEGIN COMPOSITION-BRIEF.MD===', '===END COMPOSITION-BRIEF.MD===');

if (!planMd) {
  // No silent fallback: keep the raw response so the failure is inspectable rather than mysterious.
  fs.writeFileSync(path.join(outDir, 'plan-raw-response.txt'), result.text);
  throw new Error(`[brag-plan-kie] The model did not return the expected BRAG-PLAN delimiter. Raw response saved to ${outDir}/plan-raw-response.txt`);
}
if (!briefMd) console.warn('      ⚠️  composition-brief came back empty — the raw response is saved for inspection');

fs.writeFileSync(path.join(outDir, 'brag-plan.md'), planMd + '\n');
if (briefMd) fs.writeFileSync(path.join(outDir, 'composition-brief.md'), briefMd + '\n');

// The plan gate: scene durations must sum into brag's window. Parse them rather than trusting the model.
const sceneSeconds = [...planMd.matchAll(/^###\s+Scene\s+\d+.*?—\s*([\d.]+)\s*s/gm)].map((m) => Number(m[1]));
const total = sceneSeconds.reduce((a, b) => a + b, 0);

console.log(`\n[3/3] wrote ${outDir}/brag-plan.md${briefMd ? ` + composition-brief.md` : ''}`);
console.log(`      scenes parsed: ${sceneSeconds.length} [${sceneSeconds.join('s, ')}s] → total ${total.toFixed(1)}s`);
if (sceneSeconds.length === 0) console.warn('      ⚠️  could not parse scene durations — check the plan formatting');
else if (total < 15 || total > 25) console.warn(`      ⚠️  total ${total.toFixed(1)}s is OUTSIDE brag's 15-25s window — fix before composing`);
else console.log(`      ✅ total ${total.toFixed(1)}s is inside brag's 15-25s window`);
