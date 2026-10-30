/**
 * Render-payload assembly and the render spawn for `StorytellerExplainer`, usable without a Vite
 * dev server.
 *
 * The logic here used to live only inside the `/api/render-video` endpoint in `vite.config.ts`,
 * which made it unreachable for an unattended (MCP/cron) run. Two rules it preserves:
 *
 * - `StorytellerExplainer` declares `schema={explainerCompositionSchema}`, so the payload must be
 *   exactly the documented props — no internal bookkeeping fields. The composition computes its own
 *   scene boundaries from `sceneAudio` via `alignStoryboardWithTimestamps`.
 * - Every asset url handed to Remotion must be ABSOLUTE. A public-relative path is resolved by the
 *   renderer against its own bundle server (the port in the error is the tell).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import type { ExplainerCompositionProps, SceneAudio, StoryboardManifest } from '../types/storyboard';
import { framesFor, probeDurationSeconds } from './runKit';

export interface RenderPayload extends ExplainerCompositionProps {
  fps: number;
}

export interface RenderResult {
  videoPath: string;
  propsPath: string;
  logPath: string;
  durationSeconds: number | null;
}

/** Sum of the durations the composition will actually use, in order. */
export function sceneDurations(manifest: StoryboardManifest, sceneAudio: SceneAudio[] = []): number[] {
  const byScene = new Map(sceneAudio.map((sa) => [sa.sceneNumber, sa.durationSeconds]));
  return (manifest.scenes || []).map(
    (s) => Number(byScene.get(s.sceneNumber)) || Number(s.duration) || 12,
  );
}

/** Cumulative start time of each scene, used for poster midpoints. */
export function sceneMidpoints(manifest: StoryboardManifest, sceneAudio: SceneAudio[] = []): number[] {
  const durations = sceneDurations(manifest, sceneAudio);
  const midpoints: number[] = [];
  let cumulative = 0;
  for (const d of durations) {
    midpoints.push(cumulative + d / 2);
    cumulative += d;
  }
  return midpoints;
}

export function buildRenderPayload(args: {
  manifest: StoryboardManifest;
  sceneAudio?: SceneAudio[];
  /** REQUIRED in practice: the base url of the asset server serving `public/`. */
  audioBaseUrl: string;
  fps?: number;
  bgMusicUrl?: string;
  camera?: unknown;
  lighting?: unknown;
  annotationConfig?: unknown;
  logoUrl?: string;
  articleUrl?: string;
}): RenderPayload {
  const sceneAudio = args.sceneAudio || [];

  const payload: RenderPayload = {
    manifest: args.manifest,
    sceneAudio,
    fps: args.fps ?? 30,
    audioBaseUrl: args.audioBaseUrl,
    bgMusicUrl: args.bgMusicUrl || undefined,
    camera: args.camera as ExplainerCompositionProps['camera'],
    lighting: typeof args.lighting === 'string' ? args.lighting : undefined,
    annotationConfig: args.annotationConfig as ExplainerCompositionProps['annotationConfig'],
    logoUrl: args.logoUrl || undefined,
    articleUrl: args.articleUrl || undefined,
  };
  return payload;
}

/**
 * Refuses a payload that would render a broken video. Run BEFORE spawning: a render that dies at
 * 60% wastes minutes and tells you less than these assertions do.
 */
export function assertRenderablePayload(payload: RenderPayload, opts: { voiceExpected: boolean }): void {
  const problems: string[] = [];
  const raw = JSON.stringify(payload);

  if (!payload.manifest?.scenes?.length) problems.push('manifest has no scenes');
  if (/pollinations/i.test(raw)) problems.push('payload references pollinations (removed provider)');

  for (const scene of payload.manifest?.scenes || []) {
    // text_to_video scenes are deliberately image-less: the video IS the visual.
    const isTextToVideo = (scene as any).animationStrategy === 'text_to_video';
    for (const el of ((scene.layout?.elements || []) as any[])) {
      const src = el.sourceAssetId;
      if (el.type !== 'image' || isTextToVideo || typeof src !== 'string' || !src) continue;
      if (src.startsWith('data:')) {
        problems.push(`scene ${scene.sceneNumber}: a base64 data URL survived localization (Remotion cannot decode it)`);
      } else if (!/^https?:\/\//i.test(src)) {
        problems.push(`scene ${scene.sceneNumber}: relative image path "${src.slice(0, 60)}" — must be absolute for the renderer`);
      }
    }
  }

  if (opts.voiceExpected) {
    const missing = (payload.sceneAudio || []).filter((sa) => !sa.audioUrl || !sa.durationSeconds);
    if (missing.length) {
      problems.push(`narration requested but ${missing.length} scene(s) have no audio (silent-video bug): ${missing.map((m) => m.sceneNumber).join(', ')}`);
    }
  }

  if (problems.length) {
    throw new Error(`[renderPayload] Refusing to render:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * Renders `StorytellerExplainer`. Resolves on a verified output file; rejects with the tail of the
 * render log on any failure (a 2xx-free promise is not evidence the video exists).
 */
export async function renderExplainer(
  payload: RenderPayload,
  opts: {
    videoPath: string;
    propsPath?: string;
    logPath?: string;
    onProgress?: (line: string) => void;
    /**
     * Encoder settings. Explicit because the first published render defaulted into 720 kbps +
     * `yuvj420p` (full-range JPEG colour), which YouTube re-encoded into soft text. 1080p text-heavy
     * graphics need constant-quality, a sharp x264 preset, a PNG frame source and a broadcast colour
     * space; the pixel format must be limited-range `yuv420p` or players stretch the contrast.
     */
    quality?: { crf?: number; preset?: string; scale?: number };
  },
): Promise<RenderResult> {
  const projectRoot = process.cwd();
  const propsPath = opts.propsPath || path.join(path.dirname(opts.videoPath), 'storyboard_props.json');
  const logPath = opts.logPath || path.join(path.dirname(opts.videoPath), 'render.log');

  fs.mkdirSync(path.dirname(opts.videoPath), { recursive: true });
  fs.writeFileSync(propsPath, JSON.stringify(payload, null, 2));

  // Render to a TEMPORARY name and only move it into place after it verifies. Deleting the target
  // first (the original behaviour) means an interrupted or failing render destroys a good previous
  // video — measured: a verified 50 MB, 6-minute render was lost to a killed re-render.
  const tempOutput = opts.videoPath.replace(/\.mp4$/, '.rendering.mp4');
  try { fs.unlinkSync(tempOutput); } catch { /* nothing to remove */ }

  const localBin = path.join(projectRoot, 'node_modules', '.bin', 'remotion');
  const cmd = fs.existsSync(localBin) ? localBin : 'npx';
  const args = [
    'render', 'src/index.ts', 'StorytellerExplainer', tempOutput,
    `--props=${propsPath}`, '--codec=h264', '--concurrency=1',
    // Quality: without these Remotion picked settings that produced a 720 kbps yuvj420p file.
    `--crf=${opts.quality?.crf ?? 17}`,
    `--x264-preset=${opts.quality?.preset ?? 'medium'}`,
    '--pixel-format=yuv420p',
    '--color-space=bt709',
    '--image-format=png',
    ...(opts.quality?.scale && opts.quality.scale !== 1 ? [`--scale=${opts.quality.scale}`] : []),
  ];

  const logStream = fs.createWriteStream(logPath);
  // Record the encoder settings in the log: "why does this render look soft" is answerable only if
  // the settings that produced it are on disk next to the video.
  logStream.write(`[render] ${cmd} ${args.join(' ')}\n`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: projectRoot, stdio: 'pipe' });
    child.stdout?.on('data', (chunk) => {
      logStream.write(chunk);
      const text = String(chunk);
      const match = /Rendered\s+(\d+)\/(\d+)/i.exec(text);
      if (match) opts.onProgress?.(`rendering ${match[1]}/${match[2]}`);
    });
    child.stderr?.on('data', (chunk) => logStream.write(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      logStream.end(`\n[render] exit code: ${code}\n`);
      if (code === 0) resolve();
      else {
        const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-2000) : '';
        reject(new Error(`[renderPayload] remotion render exited ${code}. Last log lines:\n${tail}`));
      }
    });
  });

  if (!fs.existsSync(tempOutput) || fs.statSync(tempOutput).size === 0) {
    throw new Error(`[renderPayload] render exited 0 but produced no file at ${tempOutput}`);
  }
  // Verified — now it is safe to displace any previous render for this run.
  fs.renameSync(tempOutput, opts.videoPath);

  return {
    videoPath: opts.videoPath,
    propsPath,
    logPath,
    durationSeconds: await probeDurationSeconds(opts.videoPath),
  };
}

/** Expected frame count for a payload — used when baking a poster. */
export function expectedFrameCount(payload: RenderPayload): number {
  const total = (payload.sceneAudio || []).reduce((a, sa) => a + (Number(sa.durationSeconds) || 0), 0);
  const fallback = (payload.manifest?.scenes || []).reduce((a, s) => a + (Number(s.duration) || 12), 0);
  return framesFor(total || fallback, payload.fps || 30);
}
