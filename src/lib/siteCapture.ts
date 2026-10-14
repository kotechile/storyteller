/**
 * Real-UI capture — the URL-based answer to brag's "Show the thing" law.
 *
 * Upstream brag recreates a working-app moment from source files. With only a URL, the honest
 * equivalent is a real screenshot of the live page: a redrawn approximation of a product's UI is
 * exactly the "abstract filler" the creative laws forbid.
 *
 * Uses `puppeteer-core` against the system Chrome so we do not download a second 300MB browser.
 * Node-only (imported by the orchestrator), and it fails loudly rather than returning nothing:
 * a promo that silently loses its real-UI scene is worse than a failed build.
 */
import fs from 'fs';
import path from 'path';
import type { FormatName } from './runtimeConfig';

export interface CaptureRef {
  /** Stable id the plan references in `visualRef`. */
  id: string;
  /** Absolute path on disk. */
  file: string;
  /** Human label, e.g. "hero / above the fold". */
  label: string;
  /** Bytes on disk — used to flag a suspiciously blank capture. */
  bytes: number;
}

export interface CaptureOptions {
  url: string;
  outDir: string;
  format: FormatName;
  /** Explicit Chrome binary; otherwise auto-detected. */
  chromePath?: string;
  timeoutMs?: number;
  /** How many extra full-page crops to take below the fold. */
  scrollCrops?: number;
  /** Plain-language interaction to attempt, e.g. "cursor clicks the primary CTA". */
  interactions?: string[];
}

export interface CaptureResult {
  captures: CaptureRef[];
  warnings: string[];
}

/** Blank-page heuristic: a real page at 1080x1920 compresses far larger than this. */
const BLANK_BYTES = 15_000;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function resolveChromePath(explicit?: string): string {
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`[siteCapture] OMNICAST_CHROME_PATH="${explicit}" does not exist.`);
    }
    return explicit;
  }
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      '[siteCapture] No Chrome/Chromium binary found. Real-UI capture needs one.\n' +
        `  Tried:\n    ${CHROME_CANDIDATES.join('\n    ')}\n` +
        '  Fix: install Google Chrome, or set OMNICAST_CHROME_PATH in .env, or run with ' +
        'OMNICAST_CAPTURE=0 (the promo will then rely on the source\'s own images).',
    );
  }
  return found;
}

/** Viewport per format — the capture must match the canvas it will be shown in. */
function viewportFor(format: FormatName, scale = 1): { width: number; height: number; deviceScaleFactor: number } {
  if (format === 'vertical') return { width: 540, height: 960, deviceScaleFactor: 2 * scale };
  if (format === 'square') return { width: 720, height: 720, deviceScaleFactor: 2 * scale };
  return { width: 1280, height: 720, deviceScaleFactor: 2 * scale };
}

/**
 * Launches Chrome, captures the page, and returns the files.
 *
 * `puppeteer-core` is a devDependency and is imported dynamically so that (a) it never enters a
 * browser bundle, and (b) a missing install produces an actionable error instead of a bundling
 * crash.
 */
export async function captureSite(opts: CaptureOptions): Promise<CaptureResult> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const chromePath = resolveChromePath(opts.chromePath);
  const warnings: string[] = [];
  fs.mkdirSync(opts.outDir, { recursive: true });

  let puppeteer: typeof import('puppeteer-core');
  try {
    puppeteer = await import('puppeteer-core');
  } catch {
    throw new Error(
      '[siteCapture] `puppeteer-core` is not installed, so real-UI capture cannot run.\n' +
        '  Fix: npm install --save-dev puppeteer-core\n' +
        '  Or run with OMNICAST_CAPTURE=0 to build the promo from the source\'s own images instead.',
    );
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  });

  const captures: CaptureRef[] = [];

  try {
    const page = await browser.newPage();
    const vp = viewportFor(opts.format);
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor });

    const response = await page.goto(opts.url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    if (!response) {
      warnings.push(`No HTTP response object for ${opts.url}; the page may not have loaded properly.`);
    } else if (!response.ok()) {
      warnings.push(`Navigation returned HTTP ${response.status()} for ${opts.url}.`);
    }

    // Give client-rendered pages a beat to paint something real.
    await new Promise((r) => setTimeout(r, 800));

    const write = async (name: string, label: string, el?: unknown): Promise<CaptureRef | null> => {
      const file = path.join(opts.outDir, `${name}.png`);
      if (el) {
        await (el as { screenshot: (o: { path: string }) => Promise<unknown> }).screenshot({ path: file });
      } else {
        await page.screenshot({ path: file });
      }
      if (!fs.existsSync(file)) {
        warnings.push(`Capture "${name}" produced no file.`);
        return null;
      }
      const bytes = fs.statSync(file).size;
      if (bytes < BLANK_BYTES) {
        warnings.push(
          `Capture "${name}" is only ${bytes} bytes — it is probably blank (a real page at this ` +
            'viewport compresses much larger). It will still be used; check the render.',
        );
      }
      return { id: name, file, label, bytes };
    };

    const hero = await write('shot_hero', 'hero / above the fold');
    if (hero) captures.push(hero);

    // Below-the-fold crops: scroll one viewport at a time and shoot each position.
    const scrollCount = opts.scrollCrops ?? 2;
    for (let i = 1; i <= scrollCount; i++) {
      const y = vp.height * i;
      const moved = await page.evaluate((top: number) => {
        window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
        return window.scrollY;
      }, y);
      if (typeof moved === 'number' && moved < y * 0.5 && i === 1) {
        // Page is shorter than one extra viewport — nothing more to capture, and saying so is better
        // than writing three identical frames.
        warnings.push('Page is shorter than two viewports; only one scroll crop was taken.');
        break;
      }
      await new Promise((r) => setTimeout(r, 700));
      const shot = await write(`shot_scroll${i}`, `page, ${i} viewport(s) down`);
      if (shot) captures.push(shot);
    }

    // Best-effort simulated interaction. Never fatal: a missed click is common (cookie banners,
    // A/B-tested copy) and is reported rather than hidden.
    for (const [i, interaction] of (opts.interactions ?? []).entries()) {
      const wantSwipe = /swipe|drag/.test(interaction.toLowerCase());
      if (wantSwipe) {
        warnings.push(`Interaction "${interaction}" needs a swipe gesture, which is not automated yet; skipped.`);
        continue;
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
      await new Promise((r) => setTimeout(r, 300));

      const clicked = await page.evaluate(() => {
        const labels = ['get started', 'try', 'sign up', 'start', 'demo', 'launch', 'open'];
        const candidates = Array.from(document.querySelectorAll('a,button')) as HTMLElement[];
        const target = candidates.find((el) => {
          const text = (el.innerText || '').trim().toLowerCase();
          const visible = el.offsetParent !== null;
          return visible && text.length > 0 && text.length < 40 && labels.some((l) => text.includes(l));
        });
        if (target) {
          target.click();
          return (target.innerText || '').trim();
        }
        return null;
      });

      if (!clicked) {
        warnings.push(`No clickable element matching "${interaction}" was found; interaction capture skipped.`);
        continue;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const shot = await write(`shot_action${i + 1}`, `after clicking "${clicked}"`);
      if (shot) captures.push(shot);
    }

    if (captures.length === 0) {
      throw new Error(`[siteCapture] No screenshots were produced for ${opts.url} — nothing to show in the video.`);
    }
  } finally {
    await browser.close();
  }

  return { captures, warnings };
}
