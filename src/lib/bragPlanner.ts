/**
 * bragPlanner — turns a URL's evidence into a BragPlan using Claude (kie.ai).
 *
 * This is the heart of the ported `/brag` creative system: prompts/brag/*.md holds the rubric, the
 * tone presets and the creative laws; this module feeds them the evidence and then *enforces the
 * laws in code*. The model gets creative freedom over story, angle and wording; it does NOT get to
 * decide whether the video is readable, whether it shows the real thing, or whether it leaks a
 * secret onto screen.
 *
 * Gate philosophy (matching this project's "no silent fallbacks" rule): a plan that breaks a law is
 * rejected with a precise, repairable message. One repair round is allowed, quoting the exact
 * violations. If it still fails, we throw rather than render something wrong.
 */
import fs from 'fs';
import path from 'path';
import {
  bragPlanSchema,
  sceneReadFloor,
  requiredReadSeconds,
  type BragPlan,
  type BragScene,
  type BragTone,
} from '../types/brag';
import type { ArticleData } from '../types/storyboard';
import { callClaudeJson, type ChatMessage } from './kieClaude';
import { resolveTone, TONE_PRESETS } from './tonePresets';
import { FORMATS, loadOmnicastConfig, type FormatName } from './runtimeConfig';
import type { SiteIdentity } from './siteIdentity';

// ─────────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureRef {
  /** Stable id the plan must use in `visualRef`. */
  id: string;
  /** Absolute path on disk. */
  file: string;
  /** Human label, e.g. "hero / above the fold". */
  label: string;
}

export interface PlanBragOptions {
  /** Preset name or freeform direction. */
  tone?: string;
  format?: FormatName;
  durationSeconds?: number;
  focusTopics?: string[];
  /** Real UI screenshots available for `visualSource: "screenshot"`. */
  captures?: CaptureRef[];
  /** Overrides OMNICAST_BRAG_MODEL. */
  model?: string;
  onProgress?: (msg: string) => void;
}

export interface BragPlanResult {
  plan: BragPlan;
  /** The alias that answered (may be a fallback). */
  model: string;
  /** Non-fatal notes: clipped durations, guesses, redactions. */
  warnings: string[];
  /** Gates that fired and were auto-corrected. */
  corrections: string[];
  promptChars: number;
}

const PROMPT_DIR = path.join(process.cwd(), 'prompts', 'brag');

function loadPrompt(file: string): string {
  const full = path.join(PROMPT_DIR, file);
  if (!fs.existsSync(full)) {
    throw new Error(
      `[bragPlanner] Missing prompt file ${full}. This is repo data and must exist — ` +
        'prompts/brag/ is required, not optional.',
    );
  }
  return fs.readFileSync(full, 'utf-8');
}

/** Serialises the gathered evidence into the prompt's input block. */
export function buildEvidenceBlock(
  article: ArticleData,
  identity: SiteIdentity,
  captures: CaptureRef[],
  opts: PlanBragOptions,
): string {
  const bodyLimit = 6000;
  const body =
    article.textContent.length > bodyLimit
      ? `${article.textContent.slice(0, bodyLimit)}\n… [truncated, ${article.textContent.length} chars total]`
      : article.textContent;

  const assets = article.assets.slice(0, 12).map((a) => ({
    id: a.id,
    url: a.url,
    alt: a.altText,
    caption: a.caption ?? null,
    classification: a.classification ?? 'unknown',
    size: `${a.width}x${a.height}`,
  }));

  return [
    '=== SOURCE ===',
    `Title: ${article.title}`,
    `Excerpt: ${article.excerpt}`,
    `Word count: ${article.wordCount}`,
    '',
    '=== SOURCE BODY ===',
    body,
    '',
    '=== SOURCE IMAGES (use the `id` in visualRef with visualSource "article_asset") ===',
    assets.length ? JSON.stringify(assets, null, 1) : '(none)',
    '',
    '=== REAL UI SCREENSHOTS (use the `id` in visualRef with visualSource "screenshot") ===',
    captures.length ? JSON.stringify(captures.map((c) => ({ id: c.id, label: c.label })), null, 1) : '(none captured)',
    '',
    '=== SITE IDENTITY ===',
    JSON.stringify(
      {
        title: identity.title,
        accent: identity.accent,
        background: identity.background,
        text: identity.text,
        displayFont: identity.displayFont,
        bodyFont: identity.bodyFont,
        themeColor: identity.themeColor,
        ogImage: identity.ogImage,
      },
      null,
      1,
    ),
    identity.warnings.length ? `IDENTITY WARNINGS (tell the operator about these in \`notes\`):\n- ${identity.warnings.join('\n- ')}` : '',
    '',
    '=== REQUEST ===',
    `Tone direction from the user: ${opts.tone?.trim() || '(none — you infer it)'}`,
    `Format: ${opts.format ?? 'vertical'} (fixed — do not deviate)`,
    `Target duration: ${opts.durationSeconds ?? 20} seconds (must land in 15-25)`,
    opts.focusTopics?.length ? `Focus on these topics where relevant: ${opts.focusTopics.join('; ')}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildBragPrompt(
  article: ArticleData,
  identity: SiteIdentity,
  captures: CaptureRef[],
  opts: PlanBragOptions,
): string {
  const tone = resolveTone(opts.tone);
  const preset = TONE_PRESETS[tone.preset];

  const toneDirection = tone.direction ? `The user asked for this direction: "${tone.direction}". Map it to the ${tone.preset} preset's pacing and structure, but keep the user's intent.` : '';
  const toneOverride = opts.tone?.trim() && !tone.direction ? `The user asked for the "${opts.tone.trim()}" preset directly.` : '';

  return [
    loadPrompt('creative-laws.md'),
    '',
    '---',
    '',
    '# Tone presets',
    loadPrompt('tones.md'),
    '',
    '---',
    '',
    `# Your assignment`,
    '',
    `Preferred preset for this run: **${tone.preset}** — ${preset.energy}.`,
    toneDirection,
    toneOverride,
    '',
    loadPrompt('plan.md'),
    '',
    '---',
    '',
    buildEvidenceBlock(article, identity, captures, opts),
  ]
    .filter((s) => s !== '')
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic gates — the brag laws, enforced in code
// ─────────────────────────────────────────────────────────────────────────────

const BANNED_SAAS = [
  'streamline your workflow',
  'streamline workflows',
  'unlock insights',
  'supercharge',
  'seamlessly integrate',
  'take it to the next level',
  'game-changer',
  'game changer',
  'revolutionize',
  'revolutionise',
  'cutting-edge solution',
  'empower your team',
  'leverage synergies',
  'best-in-class',
];

/** Patterns that must never reach a public video. */
const SECRET_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'email address', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { label: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { label: 'Supabase secret key', re: /\bsb_(secret|publishable)_[A-Za-z0-9_-]+/ },
  { label: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/i },
  { label: 'long opaque token', re: /\b[A-Za-z0-9_-]{40,}\b/ },
  { label: 'credential word', re: /\b(api[_-]?key|password|secret[_-]?key|private[_-]?key|access[_-]?token)\b/i },
  { label: 'internal hostname', re: /\bhttps?:\/\/(localhost|127\.0\.0\.1|10\.\d|192\.168\.|[a-z0-9-]+\.internal)\b/i },
];

export interface GateContext {
  captures: CaptureRef[];
  article: ArticleData;
  tone: BragTone;
  format: FormatName;
  durationSeconds: number;
}

/** All text a viewer would see or read aloud — the secret-scan surface. */
function visibleText(plan: BragPlan): string[] {
  return [
    plan.hook,
    plan.outro,
    plan.shareCopy,
    plan.angle,
    plan.youtube.title,
    plan.youtube.description,
    ...plan.keyMoments,
    ...plan.keyConcepts,
    ...plan.storyboard.flatMap((s) => [s.name, s.onScreen, s.sequential ?? '', s.interaction ?? '', ...s.text]),
  ].filter(Boolean);
}

/** Minimum seconds a scene needs so every line can actually be read (brag's reading floor). */
export function sceneMinSeconds(scene: BragScene, tone: BragTone): number {
  const preset = TONE_PRESETS[tone];
  if (scene.text.length === 0) return preset.enterSeconds;

  // Lines that appear one-by-one (or via an explicit hold) each need their own settled time;
  // lines that appear together can be read in parallel, so the longest one governs.
  const sequential = Boolean(scene.sequential) || typeof scene.revealHoldSeconds === 'number';
  const readSeconds = sequential
    ? scene.text.reduce((sum, line) => sum + requiredReadSeconds(line), 0)
    : sceneReadFloor(scene) + 0.3 * (scene.text.length - 1);

  return preset.enterSeconds + readSeconds * preset.holdBias;
}

/**
 * Returns a list of human-readable violations. Empty array == the plan is renderable.
 * Pure and dependency-free so it can be unit-tested without touching the network.
 */
export function validateBragPlan(plan: BragPlan, ctx: GateContext): string[] {
  const violations: string[] = [];
  const v = (msg: string): void => void violations.push(msg);

  // ── duration window ──
  if (plan.durationSeconds < 15 || plan.durationSeconds > 25) {
    v(`durationSeconds is ${plan.durationSeconds}; the brag law requires 15-25s.`);
  }
  const sceneSum = plan.storyboard.reduce((s, sc) => s + sc.seconds, 0);
  if (Math.abs(sceneSum - plan.durationSeconds) > 0.5) {
    v(`scene durations sum to ${sceneSum.toFixed(1)}s but durationSeconds is ${plan.durationSeconds}s.`);
  }

  // ── hook must be short (the first 2 seconds decide everything) ──
  const hookSeconds = plan.storyboard[0]?.seconds ?? 0;
  if (hookSeconds > 3) {
    v(`The hook scene is ${hookSeconds}s; it must be at most 3s to earn the next 20 seconds.`);
  }

  // ── key concepts: this pipeline promotes AND explains ──
  if (plan.keyConcepts.length < 2) {
    v(`Only ${plan.keyConcepts.length} keyConcepts given; at least 2 concepts must be named and explained.`);
  } else {
    const conceptWords = plan.keyConcepts.flatMap((c) => c.toLowerCase().split(/\s+/));
    const teachingScene = plan.storyboard.some((sc) =>
      sc.text.some((line) => conceptWords.filter((w) => w.length > 4).some((w) => line.toLowerCase().includes(w))),
    );
    if (!teachingScene) {
      v('No scene actually mentions a keyConcept — the video sells but never explains. At least one scene must teach them.');
    }
  }

  // ── show the thing ──
  const realSources = plan.storyboard.filter((sc) => sc.visualSource === 'screenshot' || sc.visualSource === 'article_asset');
  const anyRealAvailability = ctx.captures.length > 0 || ctx.article.assets.length > 0;
  if (realSources.length === 0) {
    if (anyRealAvailability) {
      v(
        `No scene shows real source material. Real screenshots (${ctx.captures.length}) and/or source images ` +
          `(${ctx.article.assets.length}) are available and at least one scene must use them.`,
      );
    } else if (!plan.storyboard.some((sc) => sc.visualSource === 'typographic')) {
      v('No real material is available and no typographic scene was written — the video would be abstract filler.');
    }
  }

  // ── visualRef must point at something real (a hallucinated ref renders nothing) ──
  const validCaptureIds = new Set(ctx.captures.map((c) => c.id));
  const validAssetIds = new Set(ctx.article.assets.map((a) => a.id));
  const validAssetUrls = new Set(ctx.article.assets.map((a) => a.url));
  for (const sc of plan.storyboard) {
    if (sc.visualSource === 'screenshot' && !validCaptureIds.has(sc.visualRef ?? '')) {
      v(
        `Scene "${sc.name}" uses visualSource "screenshot" with visualRef "${sc.visualRef ?? '(missing)'}" — ` +
          `not a captured screenshot. Valid ids: ${[...validCaptureIds].join(', ') || '(none)'}.`,
      );
    }
    if (sc.visualSource === 'article_asset' && !validAssetIds.has(sc.visualRef ?? '') && !validAssetUrls.has(sc.visualRef ?? '')) {
      v(
        `Scene "${sc.name}" uses visualSource "article_asset" with visualRef "${sc.visualRef ?? '(missing)'}" — ` +
          `not a source image. Valid ids: ${[...validAssetIds].join(', ') || '(none)'}.`,
      );
    }
  }

  // ── reading floor ──
  for (const sc of plan.storyboard) {
    const min = sceneMinSeconds(sc, ctx.tone);
    if (sc.seconds + 0.01 < min) {
      v(
        `Scene "${sc.name}" is ${sc.seconds}s but its ${sc.text.length} line(s) need ~${min.toFixed(1)}s to be read ` +
          `at the ${ctx.tone} tone's pace. Cut copy or lengthen the scene — do NOT speed it up.`,
      );
    }
    if (sc.text.length > 4) {
      v(`Scene "${sc.name}" carries ${sc.text.length} lines. A ${sc.seconds}s scene cannot land that many reads — cut to 3 or fewer.`);
    }
  }

  // ── generic SaaS language ──
  const copy = [plan.shareCopy, plan.hook, plan.outro, ...plan.storyboard.flatMap((s) => s.text)];
  for (const phrase of BANNED_SAAS) {
    if (copy.some((line) => line.toLowerCase().includes(phrase))) {
      v(`Banned generic SaaS language "${phrase}" appears in the copy. Use the source's own words.`);
    }
  }

  if (plan.storyboard.length < 3) v(`Only ${plan.storyboard.length} scenes; 3-8 are needed.`);
  if (plan.storyboard.length > 8) v(`${plan.storyboard.length} scenes is too many for a 15-25s video.`);

  return violations;
}

/**
 * Hard public-safety screen. These videos get published unattended, so anything that looks like a
 * credential, an internal host or personal data is rejected outright rather than styled nicely.
 */
export function assertNoSecrets(plan: BragPlan): string[] {
  const violations: string[] = [];
  for (const text of visibleText(plan)) {
    for (const { label, re } of SECRET_PATTERNS) {
      const m = text.match(re);
      if (m) {
        violations.push(
          `Possible ${label} in on-screen text: "${m[0].slice(0, 40)}${m[0].length > 40 ? '…' : ''}". ` +
            'Nothing sensitive may appear in a published video — substitute a plausible stand-in.',
        );
      }
    }
  }
  return violations;
}

/** Rescales scene durations so they sum exactly to the target, preserving each scene's share. */
function rescaleScenes(plan: BragPlan, corrections: string[]): void {
  const sum = plan.storyboard.reduce((s, sc) => s + sc.seconds, 0);
  if (sum <= 0 || Math.abs(sum - plan.durationSeconds) < 0.01) return;
  const factor = plan.durationSeconds / sum;
  corrections.push(`Rescaled ${plan.storyboard.length} scene durations by ${factor.toFixed(3)} to sum to ${plan.durationSeconds}s.`);
  for (const sc of plan.storyboard) {
    sc.seconds = Number((sc.seconds * factor).toFixed(2));
  }
  // Give any rounding remainder to the longest (non-hook) scene.
  const drift = plan.durationSeconds - plan.storyboard.reduce((s, sc) => s + sc.seconds, 0);
  if (Math.abs(drift) > 0.001) {
    const target = [...plan.storyboard].sort((a, b) => b.seconds - a.seconds)[0];
    target.seconds = Number((target.seconds + drift).toFixed(2));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The planner
// ─────────────────────────────────────────────────────────────────────────────

export async function planBrag(
  article: ArticleData,
  identity: SiteIdentity,
  opts: PlanBragOptions = {},
): Promise<BragPlanResult> {
  const cfg = loadOmnicastConfig();
  const tone = resolveTone(opts.tone);
  const format: FormatName = opts.format ?? cfg.defaultFormat;
  const durationSeconds = Math.min(25, Math.max(15, opts.durationSeconds ?? cfg.defaultDurationSeconds));
  const captures = opts.captures ?? [];

  // NOTE: identity warnings are deliberately NOT copied in here — the caller already records them
  // (and forwards them into the prompt). Seeding them again produced duplicate run warnings.
  const warnings: string[] = [];
  const corrections: string[] = [];

  const prompt = buildBragPrompt(article, identity, captures, opts);
  opts.onProgress?.(`Planning brag video with ${opts.model ?? cfg.brag.model} (prompt ${prompt.length} chars)…`);

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

  const ctx: GateContext = { captures, article, tone: tone.preset, format, durationSeconds };

  const runPass = async (msgs: ChatMessage[]) => {
    const { value, model } = await callClaudeJson({
      messages: msgs,
      model: opts.model,
      maxTokens: cfg.brag.maxTokens,
      temperature: cfg.brag.temperature,
      parse: (raw) => bragPlanSchema.parse(raw),
    });
    return { plan: value, model };
  };

  let { plan, model } = await runPass(messages);

  // Code wins on format — the model's guess is advisory.
  plan.format = { name: format, ...FORMATS[format] };

  // Deterministic corrections first (these are safe to fix without another round-trip).
  if (plan.durationSeconds < 15 || plan.durationSeconds > 25) {
    corrections.push(`durationSeconds ${plan.durationSeconds} clamped to ${durationSeconds} (brag law: 15-25s).`);
    plan.durationSeconds = durationSeconds;
  }
  rescaleScenes(plan, corrections);

  const allViolations = (): string[] => [...assertNoSecrets(plan), ...validateBragPlan(plan, ctx)];

  let violations = allViolations();

  if (violations.length > 0) {
    const violationCount = violations.length;
    opts.onProgress?.(`Plan failed ${violationCount} gate(s); issuing one repair round.`);
    console.warn(`[bragPlanner] Gate violations:\n  - ${violations.join('\n  - ')}`);

    const repaired = await runPass([
      ...messages,
      { role: 'assistant', content: JSON.stringify(plan) },
      {
        role: 'user',
        content:
          'Your plan failed validation. Fix ALL of the following and return the corrected JSON only ' +
          '(same schema, no prose, no markdown fences):\n\n' +
          violations.map((x, i) => `${i + 1}. ${x}`).join('\n') +
          '\n\nDo not return a plan that still contains any of these problems.',
      },
    ]);

    plan = repaired.plan;
    model = repaired.model;
    plan.format = { name: format, ...FORMATS[format] };
    if (plan.durationSeconds < 15 || plan.durationSeconds > 25) {
      plan.durationSeconds = durationSeconds;
    }
    rescaleScenes(plan, corrections);

    violations = allViolations();
    if (violations.length > 0) {
      throw new Error(
        `[bragPlanner] Plan still violates brag's laws after a repair round:\n  - ${violations.join('\n  - ')}\n\n` +
          'Refusing to render. Re-run, or pass a different --tone/--duration.',
      );
    }
    corrections.push(`Repaired ${violationCount} gate violation(s) via a second Claude pass.`);
  }

  if (plan.notes) warnings.push(`Planner notes: ${plan.notes}`);

  const sceneSum = plan.storyboard.reduce((s, sc) => s + sc.seconds, 0);
  opts.onProgress?.(
    `Plan ready: ${plan.storyboard.length} scenes, ${sceneSum.toFixed(1)}s, ` +
      `${plan.keyConcepts.length} concepts, tone=${plan.tone.preset}`,
  );

  return { plan, model, warnings, corrections, promptChars: prompt.length };
}
