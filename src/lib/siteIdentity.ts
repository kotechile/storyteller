/**
 * Site identity extraction — the URL-based replacement for /brag's "read styles.css" step.
 *
 * Upstream brag reads `index.html` + a stylesheet from the project directory. This pipeline only
 * has a URL, so the same signals are scraped from the served HTML: brand colours, fonts, og:image
 * and title.
 *
 * Design rule: this NEVER silently invents brand colours. If nothing is found it returns neutral
 * defaults AND records a warning, which the caller forwards into the planning prompt so Claude knows
 * the palette is a guess rather than the product's real identity.
 */

export interface SiteIdentity {
  url: string;
  title: string;
  ogImage?: string;
  themeColor?: string;
  accent?: string;
  background?: string;
  text?: string;
  displayFont?: string;
  bodyFont?: string;
  /** Non-empty when the identity is partly or wholly guessed. Forward these to the operator/plan. */
  warnings: string[];
  /** True when no brand signal at all was found. */
  usedDefaults: boolean;
}

export interface SiteIdentityDefaults {
  background: string;
  accent: string;
  text: string;
  displayFont: string;
  bodyFont: string;
}

export const NEUTRAL_IDENTITY: SiteIdentityDefaults = {
  background: '#0b0b0f',
  accent: '#ff5c39',
  text: '#ffffff',
  displayFont: 'Outfit',
  bodyFont: 'Inter',
};

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

/** Brand-ish CSS custom property names, most-specific first. */
const ACCENT_VARS = ['--brand-color', '--brand', '--accent-color', '--accent', '--primary-color', '--primary', '--main-color', '--color-primary'];
const BG_VARS = ['--background', '--bg', '--surface', '--background-color', '--color-background'];
const TEXT_VARS = ['--foreground', '--text', '--text-color', '--color-text', '--body-color'];

const isValidColor = (v: string): boolean => {
  const s = v.trim();
  if (!s || s.length > 40) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return true;
  if (/^(rgb|hsl)a?\([\d\s.,%/-]+\)$/i.test(s)) return true;
  if (/^oklch\([\d\s.,%/-]+\)$/i.test(s)) return true;
  if (/^[a-z]{3,20}$/i.test(s)) return true; // named colours
  return false;
};

/** First declared value for any of `names`, e.g. `--accent: #f60;` */
function firstCustomProp(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(`${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}\\s*:\\s*([^;}"']+)`, 'i');
    const m = html.match(re);
    const value = m?.[1]?.trim();
    if (value && isValidColor(value)) return value;
  }
  return undefined;
}

function metaContent(html: string, matcher: RegExp): string | undefined {
  const m = html.match(matcher);
  return m?.[1]?.trim() || undefined;
}

/**
 * Pulls font families out of Google Fonts links and inline declarations.
 * `family=Fraunces:wght@400;700&family=Inter` → ['Fraunces', 'Inter']
 */
function extractFonts(html: string): string[] {
  const found = new Set<string>();

  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'>]+)/gi)) {
    const query = decodeURIComponent(m[1]).replace(/\+/g, ' ');
    for (const fam of query.split('&')) {
      if (!fam.toLowerCase().startsWith('family=')) continue;
      const name = fam.slice(7).split(':')[0].trim();
      if (name && name.length < 40) found.add(name);
    }
  }

  // Sort into display (h1-h3) then body order of appearance — a decent proxy for role.
  const decls = [...html.matchAll(/font-family\s*:\s*([^;}"']+)/gi)]
    .map((m) => m[1].split(',')[0].replace(/["']/g, '').trim())
    .filter((f) => f && !/^(inherit|initial|unset|revert)$/i.test(f) && !/^(sans-serif|serif|monospace|system-ui)$/i.test(f));

  for (const d of decls) found.add(d);
  return [...found].filter((f) => f.length < 40);
}

/** Fetches and parses a URL's brand signals. Never throws for "nothing found" — it warns instead. */
export async function extractSiteIdentity(url: string, timeoutMs = 20_000): Promise<SiteIdentity> {
  const warnings: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let html = '';
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) {
      warnings.push(`Fetch returned HTTP ${res.status}; using neutral defaults.`);
    } else {
      html = await res.text();
    }
  } catch (err) {
    warnings.push(`Could not fetch the page (${(err as Error).message}); using neutral defaults.`);
  } finally {
    clearTimeout(timer);
  }

  if (!html) {
    return { url, title: '', warnings, usedDefaults: true };
  }

  const title =
    metaContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    metaContent(html, /<title[^>]*>([^<]+)<\/title>/i) ||
    '';

  const ogImage = metaContent(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const themeColor = metaContent(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);

  const accent = firstCustomProp(html, ACCENT_VARS);
  const background = firstCustomProp(html, BG_VARS);
  const text = firstCustomProp(html, TEXT_VARS);

  const fonts = extractFonts(html);

  if (!accent) {
    warnings.push(
      themeColor
        ? 'No explicit brand colour variable found; falling back to <meta theme-color>.'
        : 'No brand colour signal found (no CSS custom properties, no theme-color). Palette is a GUESS.',
    );
  }
  if (fonts.length === 0) {
    warnings.push('No font declarations found; using the pipeline default stack. Typography is a GUESS.');
  }

  const usedDefaults = !accent && !themeColor && !fonts.length;

  return {
    url,
    title,
    ogImage,
    themeColor,
    accent: accent ?? themeColor,
    background,
    text,
    displayFont: fonts[0],
    bodyFont: fonts[1] ?? fonts[0],
    warnings,
    usedDefaults,
  };
}

/** Merges extracted identity over neutral defaults, preserving the warnings. */
export function resolveIdentity(identity: SiteIdentity): SiteIdentityDefaults & { warnings: string[] } {
  return {
    background: identity.background ?? NEUTRAL_IDENTITY.background,
    accent: identity.accent ?? NEUTRAL_IDENTITY.accent,
    text: identity.text ?? NEUTRAL_IDENTITY.text,
    displayFont: identity.displayFont ?? NEUTRAL_IDENTITY.displayFont,
    bodyFont: identity.bodyFont ?? NEUTRAL_IDENTITY.bodyFont,
    warnings: identity.warnings,
  };
}
