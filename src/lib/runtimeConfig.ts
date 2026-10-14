/**
 * OmniCast runtime configuration — the single source of truth for every default.
 *
 * Why this file exists: an MCP tool call arrives with the *minimum* information (often just a URL,
 * sometimes literally nothing). Every blank the caller leaves must be filled here, from `.env`,
 * so the pipeline is truly zero-argument.
 *
 * Deliberately free of node builtins (no `fs`/`os`/`path`) and of `import 'dotenv/config'`, so this
 * module is safe to import from either the Node CLI/MCP side or the Vite browser bundle. Node
 * entrypoints are responsible for loading `.env` before calling in.
 */

export const FORMATS = {
  vertical: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
} as const;

export type FormatName = keyof typeof FORMATS;

export type OmnicastMode = 'promo' | 'explainer' | 'both';

const str = (v: string | undefined, dflt = ''): string => (v ?? dflt).trim();
const bool = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined || v.trim() === '' ? dflt : /^(1|true|yes|on)$/i.test(v.trim());
const num = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return v === undefined || v.trim() === '' || Number.isNaN(n) ? dflt : n;
};
const list = (v: string | undefined): string[] =>
  str(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Expands a leading `~` without importing `os`. */
const expandHome = (p: string): string => {
  if (!p.startsWith('~')) return p;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return home ? home + p.slice(1) : p;
};

const assertFormat = (v: string): FormatName => {
  if (v in FORMATS) return v as FormatName;
  throw new Error(
    `[runtimeConfig] OMNICAST_DEFAULT_FORMAT="${v}" is invalid. Expected one of: ${Object.keys(FORMATS).join(', ')}.`,
  );
};

const assertMode = (v: string): OmnicastMode => {
  if (v === 'promo' || v === 'explainer' || v === 'both') return v;
  throw new Error(
    `[runtimeConfig] OMNICAST_DEFAULT_MODE="${v}" is invalid. Expected one of: promo, explainer, both.`,
  );
};

export interface OmnicastConfig {
  /** Target when the caller supplies no url. Blank means "url is required". */
  defaultUrl: string;
  defaultMode: OmnicastMode;
  defaultTone: string;
  defaultFormat: FormatName;
  defaultDurationSeconds: number;
  defaultStyle: string;

  voice: { enabled: boolean; speed: number; voiceId: string };
  music: { enabled: boolean; trackId: string };
  sfx: { enabled: boolean };
  /** Burned-in word-level captions. Needs narration timestamps, so it is only useful with voice. */
  captions: boolean;

  capture: { enabled: boolean; chromePath: string; timeoutMs: number };

  /** Claude (kie.ai) configuration for the brag creative layer. */
  brag: { model: string; modelFallbacks: string[]; maxTokens: number; timeoutMs: number; temperature: number };

  youtube: {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    privacy: 'private' | 'unlisted' | 'public';
    categoryId: string;
    madeForKids: boolean;
    defaultTags: string[];
  };

  paths: { runsDir: string; bragSkillDir: string; publicDir: string };

  concurrency: number;
}

/**
 * Reads (`OMNICAST_*`) configuration from the environment.
 *
 * Throws on malformed *enum* values rather than quietly substituting a default — a typo in
 * `OMNICAST_DEFAULT_FORMAT` should be loud, not a silently-wrong video.
 */
export function loadOmnicastConfig(env: NodeJS.ProcessEnv = process.env): OmnicastConfig {
  const privacyRaw = str(env.OMNICAST_YOUTUBE_PRIVACY || env.YOUTUBE_PRIVACY, 'unlisted');
  if (privacyRaw !== 'private' && privacyRaw !== 'unlisted' && privacyRaw !== 'public') {
    throw new Error(
      `[runtimeConfig] YOUTUBE_PRIVACY="${privacyRaw}" is invalid. Expected private, unlisted or public.`,
    );
  }

  return {
    defaultUrl: str(env.OMNICAST_DEFAULT_URL),
    defaultMode: assertMode(str(env.OMNICAST_DEFAULT_MODE, 'promo')),
    defaultTone: str(env.OMNICAST_DEFAULT_TONE, 'default'),
    defaultFormat: assertFormat(str(env.OMNICAST_DEFAULT_FORMAT, 'vertical')),
    defaultDurationSeconds: num(env.OMNICAST_DEFAULT_DURATION, 20),
    defaultStyle: str(env.OMNICAST_DEFAULT_STYLE, 'photo-realistic'),

    voice: {
      enabled: bool(env.OMNICAST_VOICE, false),
      speed: num(env.OMNICAST_VOICE_SPEED, 0.95),
      voiceId: str(env.OMNICAST_VOICE_ID),
    },
    music: { enabled: bool(env.OMNICAST_MUSIC, true), trackId: str(env.OMNICAST_MUSIC_TRACK) },
    sfx: { enabled: bool(env.OMNICAST_SFX, true) },
    captions: bool(env.OMNICAST_CAPTIONS, false),

    capture: {
      enabled: bool(env.OMNICAST_CAPTURE, true),
      chromePath: str(env.OMNICAST_CHROME_PATH),
      timeoutMs: num(env.OMNICAST_CAPTURE_TIMEOUT_MS, 45_000),
    },

    brag: {
      model: str(env.OMNICAST_BRAG_MODEL, 'claude-opus-5-5'),
      modelFallbacks: list(env.OMNICAST_BRAG_MODEL_FALLBACKS) || ['claude-sonnet-5'],
      // claude-opus-5-5 measured ~92s cold; allow generous headroom.
      maxTokens: num(env.OMNICAST_BRAG_MAX_TOKENS, 8192),
      timeoutMs: num(env.OMNICAST_BRAG_TIMEOUT_MS, 240_000),
      temperature: num(env.OMNICAST_BRAG_TEMPERATURE, 1),
    },

    youtube: {
      enabled: bool(env.OMNICAST_PUBLISH, false),
      clientId: str(env.YOUTUBE_CLIENT_ID),
      clientSecret: str(env.YOUTUBE_CLIENT_SECRET),
      refreshToken: str(env.YOUTUBE_REFRESH_TOKEN),
      privacy: privacyRaw,
      categoryId: str(env.YOUTUBE_CATEGORY_ID, '28'),
      madeForKids: bool(env.YOUTUBE_MADE_FOR_KIDS, false),
      defaultTags: list(env.YOUTUBE_DEFAULT_TAGS),
    },

    paths: {
      runsDir: str(env.OMNICAST_RUNS_DIR, 'runs'),
      bragSkillDir: expandHome(str(env.OMNICAST_BRAG_SKILL_DIR, '~/.hermes/skills/brag')),
      publicDir: str(env.OMNICAST_PUBLIC_DIR, 'public'),
    },

    concurrency: num(env.OMNICAST_CONCURRENCY, 1),
  };
}

/** Resolves the effective URL for a run, or explains exactly which env var to set. */
export function resolveTargetUrl(requested: string | undefined, cfg: OmnicastConfig): string {
  const url = str(requested) || cfg.defaultUrl;
  if (!url) {
    throw new Error(
      '[omnicast] No URL supplied. Pass `url` in the request (MCP `omnicast_generate`, or ' +
        '`npm run omnicast -- --url <url>`) or set OMNICAST_DEFAULT_URL in .env for fully ' +
        'argument-free runs.',
    );
  }
  if (!/^https?:\/\//i.test(url) && !url.toLowerCase().endsWith('.pdf')) {
    throw new Error(`[omnicast] "${url}" is not an http(s) URL or a .pdf path.`);
  }
  return url;
}
