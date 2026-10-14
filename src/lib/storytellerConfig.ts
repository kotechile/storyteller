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

  voice: { enabled: boolean; voiceId: string; speed: number; modelId: string };
  music: { trackId: string };
  captions: boolean;

  storyboard: { research: boolean; focusTopics: string[]; recommendedSceneCount: number };

  video: {
    enabled: boolean;
    /** Cost guard: max scenes to animate with Seedance (~80 credits and up to 20 min of queue each). */
    maxScenes: number;
  };
  /** Reference model names — used to detect config drift, not to select the model. */
  expected: { videoModel: string; imageInfographicModel: string; imageRealisticModel: string };

  regionHighlights: boolean;
  concurrency: number;
  paths: { runsDir: string; publicDir: string };
  publish: { enabled: boolean; privacy: 'private' | 'unlisted' | 'public' };
  apiBaseUrl: string;
}

export function loadStorytellerConfig(env: NodeJS.ProcessEnv = process.env): StorytellerConfig {
  const privacyRaw = str(env.STORYTELLER_YOUTUBE_PRIVACY || env.OMNICAST_YOUTUBE_PRIVACY, 'unlisted');
  if (privacyRaw !== 'private' && privacyRaw !== 'unlisted' && privacyRaw !== 'public') {
    throw new Error(`[storytellerConfig] YOUTUBE privacy="${privacyRaw}" is invalid. Expected private, unlisted or public.`);
  }

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
    },
    music: { trackId: str(env.STORYTELLER_MUSIC_TRACK) },
    captions: bool(env.STORYTELLER_CAPTIONS, true),

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
    publish: {
      enabled: bool(env.STORYTELLER_PUBLISH, false),
      privacy: privacyRaw,
    },
    apiBaseUrl: str(env.STORYTELLER_API_BASE_URL),
  };
}

/** Resolves the effective URL, or explains exactly which env var to set. */
export function resolveTargetUrl(requested: string | undefined, cfg: StorytellerConfig): string {
  const url = str(requested) || cfg.defaultUrl;
  if (!url) {
    throw new Error(
      '[storyteller] No URL supplied. Pass `url` in the request (MCP `storyteller_generate`, or ' +
        '`npm run storyteller -- --url <url>`) or set STORYTELLER_DEFAULT_URL in .env for argument-free runs.',
    );
  }
  if (!/^https?:\/\//i.test(url) && !url.toLowerCase().endsWith('.pdf')) {
    throw new Error(`[storyteller] "${url}" is not an http(s) URL or a .pdf path.`);
  }
  return url;
}
