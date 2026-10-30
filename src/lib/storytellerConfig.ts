/**
 * Storyteller runtime configuration — every knob for the unattended URL → explainer run, read from
 * `.env` exactly once.
 *
 * Pure: no node builtins and no dotenv import (entrypoints load `.env` first), so this module is
 * safe to import from the MCP child, the CLI, or a Vite-bundled caller.
 *
 * Deliberately enum values THROW rather than silently defaulting: a typo in STORYTELLER_STYLE must be
 * loud, not a silently-wrong video.
 */

export const FORMATS = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
} as const;
export type AspectName = keyof typeof FORMATS;

/** Style presets the image router understands (see `imageRoleForStyle`). */
export const STYLE_PRESETS = [
  'photo-realistic',
  'illustration',
  'flat-vector',
  'infographic',
  'whiteboard',
] as const;
export type StoryStyleName = (typeof STYLE_PRESETS)[number];

const str = (v: string | undefined, dflt = ''): string => (v ?? dflt).trim();
const bool = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined || v.trim() === '' ? dflt : /^(1|true|yes|on)$/i.test(v.trim());
const num = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return v === undefined || v.trim() === '' || Number.isNaN(n) ? dflt : n;
};
const list = (v: string | undefined): string[] =>
  str(v).split(',').map((x) => x.trim()).filter(Boolean);
const expandHome = (p: string): string => {
  if (!p.startsWith('~')) return p;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return home ? home + p.slice(1) : p;
};

function assertIn<T extends string>(label: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`[storytellerConfig] ${label}="${value}" is invalid. Expected one of: ${allowed.join(', ')}.`);
}

export interface StorytellerConfig {
  /** Target when the caller supplies no url. Blank means "url is required". */
  defaultUrl: string;
  style: StoryStyleName;
  aspect: AspectName;
  resolution: '1K' | '2K' | '4K';

  voice: {
    enabled: boolean;
    voiceId: string;
    speed: number;
    modelId: string;
    /**
     * ElevenLabs voice settings. These were previously hidden in the library as hardcoded fallbacks
     * (0.5 / 0.75), so they could not be tuned without a code change; they are now configurable and
     * default to those same values so nothing changes silently.
     */
    stability: number;
    similarityBoost: number;
  };
  music: { trackId: string };
  captions: boolean;
  /**
   * Burned-in caption size in px at 1080p.
   *
   * 32 was too small to read on a phone at arm's length, which is where most of these videos are
   * watched: the caption bar sat at roughly 3% of frame height. 44 keeps a 10-word chunk to two
   * lines inside the 85% bar and stays legible on a 5-inch screen.
   */
  captionFontSize: number;

  /**
   * Render quality. The first published render came out at 720 kbps with `yuvj420p` — a full-range
   * JPEG colour space — which YouTube re-encoded into mush on text-heavy infographics. These are
   * explicit rather than Remotion defaults so the settings that produced a video are reproducible.
   */
  render: {
    /** x264 constant-quality factor; lower is better. 17 is visually lossless-ish for flat graphics. */
    crf: number;
    /** x264 speed/compression trade-off. `slow` costs render time and buys sharpness on text. */
    preset: string;
    /** Output scale. 2 renders 4K (3840x2160), which nudges YouTube onto VP9/AV1 instead of AVC. */
    scale: number;
  };

  storyboard: { research: boolean; focusTopics: string[]; recommendedSceneCount: number };

  video: {
    enabled: boolean;
    /** Cost guard: max scenes to animate with Seedance (~80 credits and up to 20 min of queue each). */
    maxScenes: number;
  };
  /** Reference model names — used to detect config drift, not to select the model. */
  expected: { videoModel: string; imageInfographicModel: string; imageRealisticModel: string };

  /** Title / description / tags generation (no upload — publishing is not wired). */
  metadata: { enabled: boolean; titleMaxChars: number; keywords: string[] };

  regionHighlights: boolean;
  concurrency: number;
  paths: { runsDir: string; publicDir: string };
  apiBaseUrl: string;
}

export function loadStorytellerConfig(env: NodeJS.ProcessEnv = process.env): StorytellerConfig {
  return {
    defaultUrl: str(env.STORYTELLER_DEFAULT_URL),
    style: assertIn('STORYTELLER_STYLE', str(env.STORYTELLER_STYLE, 'infographic'), STYLE_PRESETS),
    aspect: assertIn('STORYTELLER_ASPECT', str(env.STORYTELLER_ASPECT, '16:9'), Object.keys(FORMATS) as AspectName[]),
    resolution: assertIn('STORYTELLER_IMAGE_RESOLUTION', str(env.STORYTELLER_IMAGE_RESOLUTION, '2K'), ['1K', '2K', '4K'] as const),

    voice: {
      enabled: bool(env.STORYTELLER_VOICE, true),
      voiceId: str(env.STORYTELLER_VOICE_ID || env.OMNICAST_VOICE_ID, 'c6SfcYrb2t09NHXiT80T'),
      speed: num(env.STORYTELLER_VOICE_SPEED || env.OMNICAST_VOICE_SPEED, 0.95),
      // eleven_turbo_v2_5 does NOT return audio_base64 from /with-timestamps.
      modelId: str(env.STORYTELLER_TTS_MODEL, 'eleven_multilingual_v2'),
      // Defaults match the library's previous hardcoded fallbacks exactly.
      stability: num(env.STORYTELLER_VOICE_STABILITY, 0.5),
      similarityBoost: num(env.STORYTELLER_VOICE_SIMILARITY, 0.75),
    },
    music: { trackId: str(env.STORYTELLER_MUSIC_TRACK) },
    captions: bool(env.STORYTELLER_CAPTIONS, true),
    captionFontSize: num(env.STORYTELLER_CAPTION_FONT_SIZE, 44),

    render: {
      crf: num(env.STORYTELLER_RENDER_CRF, 17),
      // `medium` is the default trade: `slow` buys a few percent of compression for ~1.5x render
      // time, which is real money on a 6-minute unattended render.
      preset: str(env.STORYTELLER_RENDER_PRESET, 'medium'),
      scale: num(env.STORYTELLER_RENDER_SCALE, 1),
    },

    storyboard: {
      // Replaces the interactive CLI prompts: neither may block an unattended run.
      research: bool(env.STORYTELLER_RESEARCH, false),
      focusTopics: list(env.STORYTELLER_FOCUS_TOPICS),
      recommendedSceneCount: num(env.STORYTELLER_SCENE_COUNT, 0),
    },

    video: {
      enabled: bool(env.STORYTELLER_VIDEO_SCENES, true),
      maxScenes: num(env.STORYTELLER_VIDEO_MAX_SCENES, 4),
    },
    expected: {
      videoModel: str(env.STORYTELLER_VIDEO_MODEL, 'bytedance/seedance-2-mini'),
      imageInfographicModel: str(env.STORYTELLER_IMAGE_INFOGRAPHIC_MODEL, 'nano-banana-pro'),
      imageRealisticModel: str(env.STORYTELLER_IMAGE_REALISTIC_MODEL, 'flux-2/pro-text-to-image'),
    },

    regionHighlights: bool(env.STORYTELLER_REGION_HIGHLIGHTS, false),
    concurrency: num(env.STORYTELLER_CONCURRENCY, 1),
    paths: {
      runsDir: str(env.STORYTELLER_RUNS_DIR || env.OMNICAST_RUNS_DIR, 'runs'),
      publicDir: expandHome(str(env.STORYTELLER_PUBLIC_DIR || env.OMNICAST_PUBLIC_DIR, 'public')),
    },
    metadata: {
      enabled: bool(env.STORYTELLER_METADATA, true),
      titleMaxChars: num(env.STORYTELLER_TITLE_MAX_CHARS, 100),
      keywords: list(env.STORYTELLER_KEYWORDS),
    },
    apiBaseUrl: str(env.STORYTELLER_API_BASE_URL),
  };
}

/**
 * Resolves the effective target, or explains exactly which env var to set.
 *
 * A target is either an http(s) URL or a document on this machine (`./notes.md`, `~/Downloads/x.pdf`,
 * `file:///…`). Local paths are validated for existence/extensions in `ingestLocalFile` — this gate
 * only has to reject the shapes that can never be either, so a blank string or an argument-looking
 * value fails here with the var named instead of surfacing as a confusing fetch error later.
 */
export function resolveTargetUrl(requested: string | undefined, cfg: StorytellerConfig): string {
  const url = str(requested) || cfg.defaultUrl;
  if (!url) {
    throw new Error(
      '[storyteller] No URL supplied. Pass `url` in the request (MCP `storyteller_generate`, or ' +
        '`npm run storyteller -- --url <url|file>`) or set STORYTELLER_DEFAULT_URL in .env for argument-free runs.',
    );
  }
  if (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url)) return url;

  const looksLikePath =
    url.startsWith('~') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../');
  const supportedExtension = /\.(pdf|txt|text|md|markdown|mdx|rst|csv|log|html?|xhtml|docx)$/i.test(url);

  if (looksLikePath || supportedExtension) return url;

  throw new Error(
    `[storyteller] "${url}" is not an http(s) URL or a readable file. Pass a URL, or a path to a ` +
      `.pdf / .md / .txt / .html / .docx (absolute, ~/…, or ./…).`,
  );
}
