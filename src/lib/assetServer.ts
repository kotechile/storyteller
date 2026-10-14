/**
 * A tiny static file server for renders.
 *
 * WHY THIS EXISTS: `staticFile()` does not work in this project. Verified directly — a file that has
 * lived in `public/` since August (`public/image.png`) 404s from Remotion's render server, as do
 * freshly added files, with or without `--bundle-cache=false`. The explainer pipeline hit the same
 * wall long ago and works around it by serving audio over HTTP from the Vite dev server on :3001
 * (see src/lib/audioSync.ts usage and the project notes).
 *
 * A promo needs image, music AND sfx assets, so rather than depend on a dev server being up (it
 * won't be, in an MCP-driven unattended run), the orchestrator starts this server for the duration
 * of the render and tears it down after. Assets are then referenced as absolute http URLs, which
 * Remotion loads happily.
 *
 * Serves `public/` as its root, so every asset path is the public-relative path — the same strings
 * the compiler already produces (`runs/<id>/captures/hero.png`, `brag/music/x.mp3`, …).
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
};

export interface PublicServer {
  /** e.g. http://127.0.0.1:49321 — no trailing slash. */
  baseUrl: string;
  port: number;
  /** Absolute URL for a public-relative path. */
  url: (relativePath: string) => string;
  /** Number of requests served — recorded in the run log as evidence assets were actually fetched. */
  requestCount: () => number;
  /** Paths that were requested but missing — a 404 here is a real bug worth surfacing. */
  missing: () => string[];
  close: () => Promise<void>;
}

/** Starts a static server rooted at `publicDir` on an ephemeral port. */
export async function startPublicServer(publicDir: string): Promise<PublicServer> {
  const root = path.resolve(publicDir);
  if (!fs.existsSync(root)) {
    throw new Error(`[assetServer] public dir does not exist: ${root}`);
  }

  let served = 0;
  const missing: string[] = [];

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('method not allowed');
      return;
    }

    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\/+/, ''));
    const resolved = path.resolve(root, requestPath);

    // Traversal guard: never serve outside the public root.
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      res.writeHead(403).end('forbidden');
      return;
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      missing.push(requestPath || '/');
      res.writeHead(404).end('not found');
      return;
    }

    served++;
    const stat = fs.statSync(resolved);
    const type = MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream';

    // Chromium issues Range requests for media; without 206 support audio can silently not play.
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(resolved, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(resolved).pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    port,
    url: (relativePath: string) => `${baseUrl}/${String(relativePath).replace(/^\/+/, '')}`,
    requestCount: () => served,
    missing: () => missing,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
