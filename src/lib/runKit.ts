/**
 * Small, run-agnostic helpers shared by the unattended pipelines: process exec, media probes,
 * poster selection/baking, and the run.json store.
 *
 * These are deliberately dependency-free (child_process + fs + ffmpeg/ffprobe) so an MCP child
 * process can use them with no dev server and no browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const RUN_MANIFEST = 'run.json';

export function nowIso(): string {
  return new Date().toISOString();
}

/** Timestamped run id (`YYYY-MM-DD-HHmmss`). The MCP layer mints it so it can answer immediately. */
export function makeRunId(): string {
  const d = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Runs a command, capturing output. Rejects with the tail of stderr on failure. */
export function exec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; combined?: boolean } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? process.cwd(), env: { ...process.env, ...opts.env } });
    let out = '';
    let err = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    child.stdout?.on('data', (d) => { out += String(d); });
    child.stderr?.on('data', (d) => { err += String(d); });
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      // Most tools write their report to stderr (ffmpeg's -af volumedetect, for one), so callers that
      // parse a report rather than a payload ask for the combined streams.
      if (code === 0) resolve(opts.combined ? out + err : out);
      else reject(new Error(`${cmd} ${args.slice(0, 4).join(' ')}… exited ${code}\n${(err || out).slice(-2500)}`));
    });
  });
}

/** ffprobe duration in seconds, or null when it cannot be read. */
export async function probeDurationSeconds(file: string): Promise<number | null> {
  try {
    const out = await exec('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    const v = Number(out.trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** True when the file actually carries an audio STREAM (not evidence that it carries sound). */
export async function hasAudioStream(file: string): Promise<boolean> {
  try {
    const out = await exec('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Mean volume in dBFS. A stream existing proves nothing: a silent narration track reads ≈ −91 dB
 * while a real one measured −29.7 dB. Use this to prove narration actually landed.
 */
export async function measureMeanVolumeDb(file: string): Promise<number | null> {
  try {
    const out = await exec('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { combined: true });
    const m = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export async function probeVideoSize(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const out = await exec('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
    ]);
    const [w, h] = out.trim().split(',').map(Number);
    return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null;
  } catch {
    return null;
  }
}

/** Frame count at `fps` for a duration, as an integer. */
export function framesFor(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

/**
 * Picks the poster from the *settled* midpoint of each scene (entrance motion finished, all text
 * on screen), scored by detail — a flat frame compresses tiny and loses. Ties go to the earlier
 * scene, so the choice is deterministic.
 */
export async function pickPosterFrame(
  videoPath: string,
  sceneMidpoints: number[],
  outDir: string,
  posterName = 'poster.jpg',
): Promise<{ file: string; atSeconds: number }> {
  fs.mkdirSync(outDir, { recursive: true });
  let best: { file: string; atSeconds: number; score: number } | null = null;

  for (const [i, midpoint] of sceneMidpoints.entries()) {
    if (!Number.isFinite(midpoint) || midpoint < 0) continue;
    const candidate = path.join(outDir, `candidate_${i}.png`);
    try {
      await exec('ffmpeg', ['-v', 'error', '-ss', String(midpoint), '-i', videoPath, '-frames:v', '1', '-y', candidate]);
    } catch {
      continue;
    }
    if (!fs.existsSync(candidate)) continue;
    const score = fs.statSync(candidate).size;
    if (!best || score > best.score) best = { file: candidate, atSeconds: midpoint, score };
  }

  if (!best) throw new Error(`[runKit] Could not extract any poster candidate from ${videoPath}`);

  const poster = path.join(outDir, posterName);
  await exec('ffmpeg', ['-v', 'error', '-i', best.file, '-q:v', '2', '-y', poster]);
  return { file: poster, atSeconds: best.atSeconds };
}

/**
 * Bakes a poster in as frame 0 so thumbnail/preview surfaces show a designed frame.
 *
 * Re-encoding fails in ways nobody notices until playback, so the result is VERIFIED (duration
 * within tolerance, audio preserved); on failure the original video is kept and a warning returned.
 * NO `-loop 1`: a looping still is an infinite input and `concat` then never terminates.
 */
export async function bakePosterAsFirstFrame(
  videoPath: string,
  posterFile: string,
  opts: { width: number; height: number; fps?: number },
): Promise<{ videoPath: string; warning?: string }> {
  const fps = opts.fps ?? 30;
  const before = await probeDurationSeconds(videoPath);
  const hadAudio = await hasAudioStream(videoPath);
  const baked = videoPath.replace(/\.mp4$/, '.poster.mp4');
  const expectedFrames = before ? framesFor(before, fps) + 1 : undefined;

  try {
    await exec('ffmpeg', [
      '-v', 'error',
      '-framerate', String(fps), '-i', posterFile,
      '-i', videoPath,
      '-filter_complex',
      `[0:v]scale=${opts.width}:${opts.height},setsar=1,format=yuv420p[p];[1:v]trim=start=0.033334,setpts=PTS-STARTPTS,format=yuv420p[v];[p][v]concat=n=2:v=1:a=0[outv]`,
      '-map', '[outv]',
      ...(hadAudio ? ['-map', '1:a', '-c:a', 'copy'] : []),
      '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      ...(expectedFrames ? ['-frames:v', String(expectedFrames)] : []),
      '-y', baked,
    ]);
  } catch (err) {
    return { videoPath, warning: `Poster bake failed, keeping the unbaked video: ${(err as Error).message.split('\n')[0]}` };
  }

  const after = await probeDurationSeconds(baked);
  const audioOk = !hadAudio || (await hasAudioStream(baked));
  const durationOk = before === null || after === null || Math.abs(after - before) < 0.15;
  if (!durationOk || !audioOk) {
    try { fs.unlinkSync(baked); } catch { /* keep going */ }
    return {
      videoPath,
      warning: `Poster bake verification failed (duration ${before}s → ${after}s, audio preserved: ${audioOk}); kept the unbaked video.`,
    };
  }

  fs.renameSync(baked, videoPath);
  return { videoPath };
}

// ── run.json store ────────────────────────────────────────────────────────────

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function readRunRecord<T extends { runId: string }>(runDir: string): T | null {
  return readJson<T>(path.join(runDir, RUN_MANIFEST));
}

/** Finds a run by exact or unambiguous-prefix id. */
export function findRunRecord<T extends { runId: string }>(runsDir: string, runId: string): T | null {
  const exact = readRunRecord<T>(path.resolve(runsDir, runId));
  if (exact) return exact;
  if (!fs.existsSync(runsDir)) return null;
  const candidates = fs.readdirSync(runsDir).filter((d) => d.startsWith(runId));
  if (candidates.length === 1) return readRunRecord<T>(path.resolve(runsDir, candidates[0]));
  return null;
}

export function listRunRecords<T extends { runId: string; startedAt?: string }>(runsDir: string, limit = 20): T[] {
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .map((d) => readRunRecord<T>(path.join(runsDir, d)))
    .filter((r): r is T => Boolean(r))
    .sort((a, b) => String(b.startedAt || b.runId).localeCompare(String(a.startedAt || a.runId)))
    .slice(0, limit);
}
