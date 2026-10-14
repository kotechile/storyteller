/**
 * Image localization for unattended renders.
 *
 * Two problems this solves, both of which only show up when nobody is watching a browser:
 *
 * 1. Providers hand back `data:image/...;base64,...` (Gemini / nano-banana). Remotion's `<Img>`
 *    cannot decode a data URL (`EncodingError`), and kie.ai rejects base64 as `first_frame_url`
 *    (HTTP 500). So base64 must become a hosted file.
 * 2. kie.ai image results live on `tempfile.aiquickdraw.com` with a short TTL. A render that takes
 *    minutes hits expired URLs and dies with `delayRender() … not cleared after 28000ms` at ~40–50%.
 *    The URLs can still answer `curl` — it is a timeout, not a 404.
 *
 * Path convention: everything lands under `public/runs/<runId>/assets/` so concurrent or repeated
 * runs cannot collide (the previous behaviour wrote into a single shared `public/generated_assets/`).
 * `sourceAssetId` is rewritten to `/runs/<runId>/assets/<file>` — or to an ABSOLUTE url when a
 * `baseUrl` is supplied, which is what an unattended render driven by `src/lib/assetServer.ts`
 * should use: a public-relative path is resolved by Remotion against its OWN bundle server.
 *
 * Node-only (uses `fs`). Never import this from a browser bundle.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { StoryboardManifest } from '../types/storyboard';

export interface LocalizeOptions {
  /** Run id — scopes the output directory so runs cannot overwrite each other. */
  runId: string;
  /** Absolute or cwd-relative public dir. Defaults to `public`. */
  publicDir?: string;
  /** Asset-server base url (e.g. http://127.0.0.1:49321). When set, manifest paths are ABSOLUTE. */
  baseUrl?: string;
}

export interface LocalizeResult {
  /** Deep copy with rewritten `sourceAssetId`s — never mutate the caller's manifest. */
  manifest: StoryboardManifest;
  /** Every failure, in the caller's words: an image that did not localize is a shipping risk. */
  warnings: string[];
  localized: number;
  /** Hosted files written this call (absolute paths). */
  written: string[];
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/** Best-effort extension: content type first, then the URL, then png. */
function pickExtension(contentType: string | null, url: string): string {
  const fromMime = contentType ? EXT_BY_MIME[contentType.split(';')[0].trim().toLowerCase()] : undefined;
  if (fromMime) return fromMime;
  const fromUrl = /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.exec(url);
  if (fromUrl) return fromUrl[1].toLowerCase().replace('jpeg', 'jpg');
  return 'png';
}

export function runAssetsDir(opts: LocalizeOptions): string {
  return path.join(path.resolve(opts.publicDir || 'public'), 'runs', opts.runId, 'assets');
}

/** Public-facing path (or absolute url) for a file written by this module. */
export function assetUrlFor(filename: string, opts: LocalizeOptions): string {
  const rel = `/runs/${opts.runId}/assets/${filename}`;
  return opts.baseUrl ? `${opts.baseUrl.replace(/\/+$/, '')}${rel}` : rel;
}

/**
 * Writes one generated image to disk and returns its served path.
 *
 * Non-`data:` inputs are returned untouched (already hosted). A failed write returns the original
 * value AND a warning — never a silently-missing file.
 */
export function saveGeneratedImage(
  imageUrl: string,
  opts: LocalizeOptions,
): { path: string; warning?: string; written?: string } {
  if (!imageUrl.startsWith('data:image')) return { path: imageUrl };
  try {
    const dir = runAssetsDir(opts);
    fs.mkdirSync(dir, { recursive: true });
    const mime = /^data:(image\/[a-z0-9.+-]+);/i.exec(imageUrl)?.[1];
    const ext = EXT_BY_MIME[(mime || 'image/png').toLowerCase()] || 'png';
    const filename = `gen_${Date.now()}_${Math.floor(Math.random() * 100000)}.${ext}`;
    const absPath = path.join(dir, filename);
    fs.writeFileSync(absPath, Buffer.from(imageUrl.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''), 'base64'));
    return { path: assetUrlFor(filename, opts), written: absPath };
  } catch (err) {
    const warning = `Could not write generated image to disk: ${err instanceof Error ? err.message : String(err)}`;
    return { path: imageUrl, warning };
  }
}

/**
 * Downloads every remote `http(s)` image in the manifest into the run's asset dir and rewrites
 * `sourceAssetId`. Returns a deep copy; the input manifest is never mutated (image_to_video still
 * needs the ORIGINAL remote url as its `first_frame_url` — kie.ai cannot fetch localhost).
 */
export async function localizeManifestImages(
  manifest: StoryboardManifest,
  opts: LocalizeOptions,
): Promise<LocalizeResult> {
  const copy: StoryboardManifest = JSON.parse(JSON.stringify(manifest));
  const warnings: string[] = [];
  const written: string[] = [];
  let localized = 0;

  const dir = runAssetsDir(opts);
  fs.mkdirSync(dir, { recursive: true });

  for (const scene of copy.scenes || []) {
    for (const el of (scene.layout?.elements || []) as any[]) {
      if (el.type !== 'image') continue;

      // A base64 asset can reach this point when the generation-time write was skipped.
      if (typeof el.sourceAssetId === 'string' && el.sourceAssetId.startsWith('data:image')) {
        const saved = saveGeneratedImage(el.sourceAssetId, opts);
        el.sourceAssetId = saved.path;
        if (saved.written) written.push(saved.written);
        if (saved.warning) warnings.push(`scene ${scene.sceneNumber}: ${saved.warning}`);
        localized++;
        continue;
      }

      const src: string | undefined = el.sourceAssetId;

      // Already-local public asset (e.g. /generated_assets/x.png): served by the asset server, so
      // only the leading part needs making absolute — the renderer must not resolve it itself.
      if (typeof src === 'string' && src.startsWith('/') && !src.startsWith('//')) {
        el.sourceAssetId = opts.baseUrl ? `${opts.baseUrl.replace(/\/+$/, '')}${src}` : src;
        localized++;
        continue;
      }

      if (!src || !(src.startsWith('http://') || src.startsWith('https://'))) continue;

      try {
        const resp = await fetch(src, { signal: AbortSignal.timeout(60_000) });
        if (!resp.ok) {
          warnings.push(`scene ${scene.sceneNumber}: image ${src.substring(0, 70)}… returned HTTP ${resp.status} (expired?) — left as-is`);
          continue;
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        const filename = `img_${scene.sceneNumber}_${Date.now()}_${Math.floor(Math.random() * 100000)}.${pickExtension(resp.headers.get('content-type'), src)}`;
        const absPath = path.join(dir, filename);
        fs.writeFileSync(absPath, buf);
        el.sourceAssetId = assetUrlFor(filename, opts);
        written.push(absPath);
        localized++;
      } catch (err) {
        warnings.push(`scene ${scene.sceneNumber}: could not download ${src.substring(0, 70)}… — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { manifest: copy, warnings, localized, written };
}
