/**
 * Video metadata — the title, description and tags a finished explainer is published under.
 *
 * Why this is a separate, gated stage instead of "just use the article title": the pipeline used to
 * ship `run.title = article.title`, which is accurate and unclickable. `generateYouTubeDescription()`
 * in narrativeEngine already asks the planner model for a "catchy SEO title", but on its own it is
 * unsafe to ship:
 *
 *  - it **silently falls back** to the article title and a boilerplate description when the LLM call
 *    fails (no throw, no marker), so a generic title would ride along unnoticed;
 *  - its chapter timestamps come from `scene.duration`, which is the pre-narration estimate — the
 *    real per-scene durations live in `sceneAudio`;
 *  - nothing enforces YouTube's hard limits (100 code points / 5000 bytes / 500 tag chars), and
 *    nothing checks that the title's claims actually appear in the narration.
 *
 * So this module reuses that generator and then GATES it: limits enforced in code, every clamp and
 * repair reported, and a promise check that refuses a title selling something the video never says.
 *
 * Pure-ish: the only I/O is the model call. It never writes files — the orchestrator owns artifacts.
 */
import { generateYouTubeDescription } from './narrativeEngine';

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  /** The primary search phrase the title leads with. */
  keyword: string;
  timestamps: Array<{ time: string; title: string }>;
  /** True when the model returned its boilerplate fallback instead of a real title. */
  usedFallback: boolean;
  warnings: string[];
  corrections: string[];
}

export interface MetadataInput {
  manifest: { scenes: Array<{ sceneNumber: number; narration?: string; duration?: number; layout?: { elements?: Array<{ type: string; content?: string }> } }> };
  articleTitle: string;
  articleUrl?: string;
  sceneAudio: Array<{ sceneNumber: number; durationSeconds?: number }>;
  /** Seed search phrases from config (STORYTELLER_KEYWORDS). May be empty. */
  seedKeywords?: string[];
  titleMaxChars?: number;
}

const YOUTUBE_TITLE_MAX = 100;
const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
const YOUTUBE_TAGS_MAX_CHARS = 500;

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','than','that','this','these','those','with','without','from','into','onto','for','of','on','in','to','is','are','was','were','be','been','being','it','its','as','at','by','how','why','what','when','where','which','who','whom','your','you','we','our','their','his','her','they','them','can','could','should','would','will','not','no','yes','all','any','more','most','less','least','new','now','just','only','also','very','much','many','one','two','three','about','after','before','over','under','between','through','during','because','so','up','down','out','off','again','further','once','here','there','both','each','few','other','some','such','own','same','too','do','does','did','doing','have','has','had','having',
]);

/** Banned title shapes: these read as clickbait and (worse) promise claims the video can't keep. */
const BANNED_TITLE_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /you\s+won'?t\s+believe/i, why: 'banned phrase "you won\'t believe"' },
  { re: /\bshocking\b|\binsane\b|\bcrazy\b|\bmind[- ]?blowing\b/i, why: 'hype adjective' },
  { re: /\b(secret|truth)\s+(revealed|exposed)\b/i, why: 'banned phrase "secret/truth revealed"' },
  { re: /\b(before|act)\s+(it'?s|now)\s+too\s+late\b/i, why: 'banned urgency phrase' },
  { re: /\b(100|guaranteed|never)\s*%\b/i, why: 'unverifiable certainty claim' },
  { re: /\bthis\s+one\s+(trick|weird)\b/i, why: 'banned phrase "this one trick"' },
  { re: /\bwill\s+change\s+your\s+life\b/i, why: 'banned promise' },
];

/** Count code points, not UTF-16 units — YouTube's limit is code points. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/**
 * Framing words carry no claim: a title may say "explained" without the narration saying it.
 * Without this, a correct title gets rejected for the word it uses to introduce the topic.
 */
const FRAMING_WORDS = new Set([
  'explained','explainer','explaining','guide','tutorial','breakdown','overview','basics','intro','introduction','video','exploring','understanding','simply','clearly',
]);

function significantWords(text: string): string[] {
  const words = text
    .toLowerCase()
    // Hyphens and apostrophes are SEPARATORS, matching normaliseForMatch() below. Keeping
    // "retrieval-augmented" as one token made it unmatchable against a corpus containing
    // "retrieval augmented", and rejected a correct title (measured).
    .replace(/[-']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !FRAMING_WORDS.has(w));
  return [...new Set(words)];
}

function normaliseForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * The promise check: a title may only sell what the video actually says.
 *
 * Returns the significant title words that never appear in the narration/scene text. Coverage is
 * required at 60% (a title legitimately adds connective framing) — below that the title is a claim
 * the video does not support.
 */
export function unmatchedTitleWords(title: string, corpus: string): { unmatched: string[]; coverage: number } {
  const words = significantWords(title);
  if (words.length === 0) return { unmatched: [], coverage: 1 };
  const haystack = normaliseForMatch(corpus);
  const unmatched = words.filter((w) => !haystack.includes(` ${w}`) && !haystack.includes(`${w} `));
  return { unmatched, coverage: (words.length - unmatched.length) / words.length };
}

/** Enforce YouTube's title limit, reporting the clamp rather than shortening silently. */
export function clampTitle(title: string, maxChars = YOUTUBE_TITLE_MAX): { title: string; warning?: string } {
  const limit = Math.min(maxChars, YOUTUBE_TITLE_MAX);
  const clean = title.replace(/\s+/g, ' ').trim();
  if (codePointLength(clean) <= limit) return { title: clean };
  const cut = [...clean].slice(0, limit - 1).join('').trimEnd();
  return {
    title: `${cut}…`,
    warning: `Title was ${codePointLength(clean)} characters and was truncated to ${codePointLength(cut) + 1} to fit YouTube's ${limit}-character limit.`,
  };
}

/** Sanitise tags to YouTube's rules: no commas, no angle brackets, deduped, inside a total budget. */
export function sanitiseTags(tags: string[], extras: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let budget = YOUTUBE_TAGS_MAX_CHARS;

  for (const raw of [...tags, ...extras]) {
    const tag = String(raw || '').replace(/[<>,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (tag.length < 2) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    // +1 for the separating comma YouTube counts.
    if (tag.length + 1 > budget) continue;
    seen.add(key);
    out.push(tag);
    budget -= tag.length + 1;
  }
  return out;
}

function formatTimestamp(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Chapter timestamps from the REAL narration durations, not the storyboard's pre-TTS estimate.
 * Falls back to the manifest duration only for a scene with no audio (voice disabled).
 */
export function buildTimestamps(input: MetadataInput): Array<{ time: string; title: string }> {
  const audioByScene = new Map(input.sceneAudio.map((sa) => [sa.sceneNumber, Number(sa.durationSeconds) || 0]));
  let elapsed = 0;
  return input.manifest.scenes.map((scene) => {
    const time = formatTimestamp(elapsed);
    const label =
      (scene.layout?.elements || []).find((e) => e.type === 'text' && e.content)?.content ||
      scene.narration ||
      `Scene ${scene.sceneNumber}`;
    const oneLine = String(label).replace(/\s+/g, ' ').trim();
    const title = oneLine.length > 48 ? `${oneLine.slice(0, 45).trimEnd()}…` : oneLine;
    elapsed += audioByScene.get(scene.sceneNumber) || Number(scene.duration) || 10;
    return { time, title };
  });
}

/** Is this the generator's boilerplate fallback (model failed) rather than a real title? */
function looksLikeFallback(title: string, description: string, articleTitle: string): boolean {
  const sameTitle = title.trim().toLowerCase() === articleTitle.trim().toLowerCase();
  const boilerplate = /In this video, we (unpack|break down)/i.test(description) || /^🎬/.test(description.trim());
  return sameTitle && boilerplate;
}

export async function generateVideoMetadata(input: MetadataInput): Promise<VideoMetadata> {
  const warnings: string[] = [];
  const corrections: string[] = [];
  const titleMax = input.titleMaxChars ?? YOUTUBE_TITLE_MAX;

  const generated = await generateYouTubeDescription(
    input.manifest as any,
    input.articleTitle,
    input.articleUrl,
  );

  const usedFallback = looksLikeFallback(generated.title, generated.description, input.articleTitle);
  if (usedFallback) {
    warnings.push(
      'metadata: the model returned its boilerplate title/description fallback — the title is the source article title, not an optimised one.',
    );
  }

  // ── keyword: the phrase the title should lead with ───────────────────────────
  const seed = (input.seedKeywords || []).map((k) => k.trim()).filter(Boolean);
  const derived =
    significantWords(input.articleTitle).slice(0, 2).join(' ') || input.articleTitle.trim().toLowerCase();
  const keyword = (seed[0] || generated.tags?.[0] || derived).trim();
  if (!keyword) warnings.push('metadata: could not derive a primary keyword.');

  // ── title: banned shapes, then limits ───────────────────────────────────────
  let title = (generated.title || input.articleTitle).replace(/\s+/g, ' ').trim();

  for (const { re, why } of BANNED_TITLE_PATTERNS) {
    if (re.test(title)) {
      corrections.push(`title: removed a ${why} ("${title}")`);
      // Neutralise rather than reject the whole title: strip the offending fragment's hype.
      title = title.replace(re, '').replace(/\s*[.!?]{1,}\s*$/, '').replace(/\s{2,}/g, ' ').trim();
    }
  }
  const letters = title.replace(/[^A-Za-z]/g, '');
  const upper = title.replace(/[^A-Z]/g, '');
  if (letters.length >= 12 && upper.length / letters.length > 0.5) {
    const fixed = title.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
    corrections.push(`title: re-cased an ALL-CAPS title ("${title}" → "${fixed}")`);
    title = fixed;
  }

  // ── promise check: the title may not sell what the video never says ─────────
  const corpus = [
    ...input.manifest.scenes.map((s) => s.narration || ''),
    ...input.manifest.scenes.flatMap((s) => (s.layout?.elements || []).map((e) => e.content || '')),
  ].join(' ');
  const promise = unmatchedTitleWords(title, corpus);
  if (promise.coverage < 0.6) {
    corrections.push(
      `title: the generated title ("${title}") is only ${Math.round(promise.coverage * 100)}% supported by the narration ${promise.unmatched.length ? `(unmatched: ${promise.unmatched.join(', ')})` : ''} — replaced with an honest title`,
    );
    const honest = `${input.articleTitle}`.replace(/\s+[|:–—-]\s+.*$/, '').trim();
    title = honest ? `${honest} — explained` : title;
    const retry = unmatchedTitleWords(title, corpus);
    if (retry.coverage < 0.6) {
      warnings.push(`title: even the fallback title is only ${Math.round(retry.coverage * 100)}% supported by the narration — review before publishing.`);
    }
  }

  const clamped = clampTitle(title, titleMax);
  if (clamped.warning) warnings.push(`metadata: ${clamped.warning}`);
  title = clamped.title;

  // ── description: real timestamps, keyword, source credit, byte budget ───────
  const timestamps = buildTimestamps(input);
  let description = (generated.description || '').trim();

  const missingChapters = timestamps.length > 0 && !new RegExp(timestamps[0].time.replace(':', '\\:')).test(description);
  if (missingChapters) {
    const chapters = timestamps.map((t) => `${t.time} - ${t.title}`).join('\n');
    description = `${description}\n\n📌 TIMESTAMPS:\n${chapters}`.trim();
    corrections.push('description: chapters were missing or on the wrong timings — rebuilt from the real narration durations');
  }
  const keywordPhrase = normaliseForMatch(keyword); // ' retrieval augmented generation '
  if (keyword && keywordPhrase.trim() && !normaliseForMatch(description).includes(keywordPhrase)) {
    description = `${description}\n\nKeywords: ${keyword}`.trim();
    corrections.push(`description: primary keyword "${keyword}" was absent from the title/description — appended`);
  }
  if (input.articleUrl && !description.includes(input.articleUrl)) {
    description = `${description}\n\nSource: ${input.articleUrl}`.trim();
  }

  const bytes = Buffer.byteLength(description, 'utf8');
  if (bytes > YOUTUBE_DESCRIPTION_MAX_BYTES) {
    const chars = [...description];
    while (Buffer.byteLength(chars.join(''), 'utf8') > YOUTUBE_DESCRIPTION_MAX_BYTES) chars.pop();
    description = chars.join('').trimEnd();
    warnings.push(`metadata: description exceeded YouTube's ${YOUTUBE_DESCRIPTION_MAX_BYTES}-byte limit and was truncated (the source credit may have been cut).`);
  }

  const tags = sanitiseTags(generated.tags || [], [keyword, ...(input.seedKeywords || [])]);

  return { title, description, tags, keyword, timestamps, usedFallback, warnings, corrections };
}
