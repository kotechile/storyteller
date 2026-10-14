/**
 * OmniCast orchestrator — URL in, promo video out.
 *
 * This is the single entry point shared by the CLI (`npm run omnicast`) and the MCP server
 * (mcp/server.ts). It is built for unattended use: every parameter is optional, every default comes
 * from `loadOmnicastConfig()`, and the whole run is checkpointed to `runs/<runId>/run.json` so a
 * multi-minute render can be observed (and resumed) by an agent that cannot block on it.
 *
 * Failure policy, per this project's rules: no silent fallbacks. Every stage either succeeds or
 * writes the real error into run.json and rethrows. Nothing is quietly substituted.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ingestUrl, ingestPdf } from './lib/ingest';
import { extractSiteIdentity, resolveIdentity, type SiteIdentity } from './lib/siteIdentity';
import { captureSite, type CaptureRef } from './lib/siteCapture';
import { planBrag, type BragPlanResult } from './lib/bragPlanner';
import { bragPlanToStoryboard, capturesToVisualSources, articleAssetsToVisualSources } from './lib/bragStoryboard';
import { buildBragAudioPlan, type BragAudioPlan } from './lib/bragSfx';
import { loadOmnicastConfig, resolveTargetUrl, type FormatName, type OmnicastConfig, type OmnicastMode } from './lib/runtimeConfig';
import type { ArticleData } from './types/storyboard';
import type { BragPlan } from './types/brag';
import type { BragPromoProps } from './types/bragPromo';
import { getOrGenerateConceptImage } from './lib/assetCatalogManager';
import { startPublicServer } from './lib/assetServer';

export interface OmnicastRequest {
  /** Defaults to OMNICAST_DEFAULT_URL. */
  url?: string;
  mode?: OmnicastMode;
  tone?: string;
  format?: FormatName;
  durationSeconds?: number;
  voice?: boolean;
  /** ElevenLabs voice id. Defaults to OMNICAST_VOICE_ID, then the built-in default voice. */
  voiceId?: string;
  /** Claude alias for the brag planning pass. Defaults to OMNICAST_BRAG_MODEL. */
  model?: string;
  /** Bundled brag track id. Defaults to OMNICAST_MUSIC_TRACK, then a track chosen from the tone. */
  musicTrackId?: string;
  music?: boolean;
  sfx?: boolean;
  captions?: boolean;
  publish?: boolean;
  /** Validate publishing end-to-end (auth + metadata) but do not upload. Consumes no quota. */
  publishDryRun?: boolean;
  /** Reuse an existing run directory instead of making a new timestamped one. */
  runId?: string;
}

export type OmnicastStatus =
  | 'queued'
  | 'ingesting'
  | 'capturing'
  | 'planning'
  | 'assets'
  | 'audio'
  | 'rendering'
  | 'poster'
  | 'publishing'
  | 'done'
  | 'failed';

export interface OmnicastRun {
  runId: string;
  runDir: string;
  status: OmnicastStatus;
  url: string;
  mode: OmnicastMode;
  tone: string;
  format: FormatName;
  durationSeconds: number;
  startedAt: string;
  updatedAt: string;
  /** Claude alias that produced the plan (may be a configured fallback). */
  model?: string;
  title?: string;
  plan?: BragPlan;
  shareCopy?: string;
  videoPath?: string;
  posterPath?: string;
  propsPath?: string;
  youtubeUrl?: string;
  /** Non-fatal notes: guesses, skipped captures, corrections. Surfaced to the operator. */
  warnings: string[];
  corrections: string[];
  error?: string;
  log: string[];
}

const RUN_MANIFEST = 'run.json';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Timestamped run id (`YYYY-MM-DD-HHmmss`). Exported so the MCP layer can create the id (and hand it
 * back to the caller) before the pipeline has started.
 */
export function makeRunId(): string {
  const d = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function timestampId(): string {
  return makeRunId();
}

function readRunFile(runDir: string): OmnicastRun | null {
  const full = path.join(runDir, RUN_MANIFEST);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf-8')) as OmnicastRun;
  } catch {
    return null;
  }
}

/** Finds a run by id. Also accepts an ambiguous id as long as it matches exactly one run. */
export function readRun(runId: string, runsDir?: string): OmnicastRun | null {
  const dir = runsDir ?? loadOmnicastConfig().paths.runsDir;
  const exact = readRunFile(path.join(dir, runId));
  if (exact) return exact;
  if (!fs.existsSync(dir)) return null;
  const candidates = fs.readdirSync(dir).filter((d) => d.startsWith(runId));
  if (candidates.length === 1) return readRunFile(path.join(dir, candidates[0]));
  return null;
}

export function listRuns(limit = 20, runsDir?: string): OmnicastRun[] {
  const dir = runsDir ?? loadOmnicastConfig().paths.runsDir;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((d) => readRunFile(path.join(dir, d)))
    .filter((r): r is OmnicastRun => Boolean(r))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

/** Runs a command, capturing output. Rejects with the tail of stderr on failure.
 *  Named `exec` (not `run`) because `run` is the OmnicastRun object inside the pipeline. */
function exec(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? process.cwd(), env: { ...process.env, ...opts.env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      err += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')}… exited ${code}\n${(err || out).slice(-2500)}`));
    });
  });
}

/** ffprobe duration in seconds, or null when it cannot be read. */
async function probeDurationSeconds(file: string): Promise<number | null> {
  try {
    const out = await exec('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]);
    const v = Number(out.trim());
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

async function hasAudioStream(file: string): Promise<boolean> {
  try {
    const out = await exec('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Picks the poster frame. brag asks for "the best frame", not an arbitrary one.
 *
 * The most trustworthy candidates are the *settled* midpoints of each scene (every line is fully
 * visible and the entrance motion is over), scored by detail — a flat/empty frame loses to one with
 * real content. Deterministic: ties resolve to the earlier scene.
 */
async function pickPosterFrame(videoPath: string, sceneMidpoints: number[], outDir: string): Promise<{ file: string; atSeconds: number }> {
  fs.mkdirSync(outDir, { recursive: true });
  let best: { file: string; atSeconds: number; score: number } | null = null;

  for (const [i, midpoint] of sceneMidpoints.entries()) {
    const candidate = path.join(outDir, `candidate_${i}.png`);
    try {
      await exec('ffmpeg', ['-v', 'error', '-ss', String(midpoint), '-i', videoPath, '-frames:v', '1', '-y', candidate]);
    } catch {
      continue;
    }
    if (!fs.existsSync(candidate)) continue;
    // PNG size is a cheap, dependency-free proxy for visual detail (flat frames compress tiny).
    const score = fs.statSync(candidate).size;
    if (!best || score > best.score) best = { file: candidate, atSeconds: midpoint, score };
  }

  if (!best) {
    throw new Error(`[omnicast] Could not extract any poster candidate from ${videoPath}.`);
  }

  const poster = path.join(outDir, 'brag.jpg');
  await exec('ffmpeg', ['-v', 'error', '-i', best.file, '-q:v', '2', '-y', poster]);
  return { file: poster, atSeconds: best.atSeconds };
}

/**
 * Bakes the poster in as frame 0 so players/thumbnails that use the first frame show it.
 *
 * Re-encoding can go wrong in ways that are invisible until someone watches the result, so the
 * output is VERIFIED (duration within tolerance, audio preserved). If verification fails we keep the
 * original video and say so, rather than shipping a subtly broken file.
 */
async function bakePosterAsFirstFrame(
  videoPath: string,
  posterFile: string,
  width: number,
  height: number,
  expectedFrames: number,
): Promise<{ videoPath: string; warning?: string }> {
  const before = await probeDurationSeconds(videoPath);
  const hadAudio = await hasAudioStream(videoPath);
  const baked = videoPath.replace(/\.mp4$/, '.poster.mp4');

  try {
    await exec('ffmpeg', [
      '-v', 'error',
      // NOTE: no `-loop 1` here. Looping the still creates an INFINITE image stream, and `concat`
      // with an infinite input never terminates — an earlier version of this command grew the output
      // past 75 MB before it was killed. A single image at `-framerate 30` is exactly one frame.
      '-framerate', '30', '-i', posterFile,
      '-i', videoPath,
      '-filter_complex',
      `[0:v]scale=${width}:${height},setsar=1,format=yuv420p[p];[1:v]trim=start=0.033334,setpts=PTS-STARTPTS,format=yuv420p[v];[p][v]concat=n=2:v=1:a=0[outv]`,
      '-map', '[outv]',
      ...(hadAudio ? ['-map', '1:a', '-c:a', 'copy'] : []),
      '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      // Hard bound on the output: belt-and-braces against any future filter misbehaviour.
      '-frames:v', String(expectedFrames),
      '-y', baked,
    ]);
  } catch (err) {
    return { videoPath, warning: `Poster bake failed, keeping the unbaked video: ${(err as Error).message.split('\n')[0]}` };
  }

  const after = await probeDurationSeconds(baked);
  const audioOk = !hadAudio || (await hasAudioStream(baked));
  const durationOk = before === null || after === null || Math.abs(after - before) < 0.15;

  if (!durationOk || !audioOk) {
    return {
      videoPath,
      warning:
        `Poster bake verification failed (duration ${before}s → ${after}s, audio preserved: ${audioOk}); ` +
        'kept the unbaked video. The poster JPG is still written.',
    };
  }

  fs.renameSync(baked, videoPath);
  return { videoPath };
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RunContext {
  cfg: OmnicastConfig;
  run: OmnicastRun;
  save: () => void;
  note: (msg: string) => void;
}
/**
 * Runs the whole pipeline. Writes progress into run.json after every transition so an MCP caller can
 * poll `omnicast_status` while this is still executing.
 */
export async function runOmnicast(
  req: OmnicastRequest = {},
  onProgress?: (run: OmnicastRun) => void,
): Promise<OmnicastRun> {
  const cfg = loadOmnicastConfig();
  const url = resolveTargetUrl(req.url, cfg);
  const mode: OmnicastMode = req.mode ?? cfg.defaultMode;
  const format: FormatName = req.format ?? cfg.defaultFormat;
  const tone = (req.tone ?? cfg.defaultTone).trim();
  const durationSeconds = Math.min(25, Math.max(15, req.durationSeconds ?? cfg.defaultDurationSeconds));

  const runId = req.runId ?? timestampId();
  const runDir = path.resolve(cfg.paths.runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const run: OmnicastRun = readRunFile(runDir) ?? {
    runId,
    runDir,
    status: 'queued',
    url,
    mode,
    tone,
    format,
    durationSeconds,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    warnings: [],
    corrections: [],
    log: [],
  };

  const save = (): void => {
    run.updatedAt = nowIso();
    fs.writeFileSync(path.join(runDir, RUN_MANIFEST), JSON.stringify(run, null, 2));
    onProgress?.(run);
  };
  const note = (msg: string): void => {
    run.log.push(`${nowIso()} ${msg}`);
    console.log(`[omnicast:${runId}] ${msg}`);
  };
  const setStatus = (status: OmnicastStatus): void => {
    run.status = status;
    save();
  };

  try {
    note(`run ${runId} — url=${url} mode=${mode} format=${format} tone=${tone} duration=${durationSeconds}s`);

    if (mode === 'explainer' || mode === 'both') {
      note('explainer mode is not wired for unattended runs yet (the existing CLI prompts interactively).');
      throw new Error(
        '[omnicast] mode "explainer"/"both" is not implemented for unattended use yet. The existing ' +
          'explainer CLI (src/generateStoryFromUrl.ts) asks interactive questions on stdin, so it cannot ' +
          'be driven from a tool call. Use mode "promo" (default), or run `npm run generate` manually.',
      );
    }

    // ── 1. ingest ────────────────────────────────────────────────────────────
    setStatus('ingesting');
    const isPdf = url.toLowerCase().endsWith('.pdf');
    const article: ArticleData = isPdf ? await ingestPdf(url) : await ingestUrl(url);
    run.title = article.title;
    note(`ingested "${article.title}" (${article.wordCount} words, ${article.assets.length} image asset(s))`);
    save();

    // ── 2. site identity ─────────────────────────────────────────────────────
    const identity: SiteIdentity = await extractSiteIdentity(url);
    const resolvedIdentity = resolveIdentity(identity);
    for (const w of identity.warnings) {
      note(`identity: ${w}`);
      run.warnings.push(w);
    }
    save();

    // ── 3. real-UI capture ───────────────────────────────────────────────────
    let captures: CaptureRef[] = [];
    if (cfg.capture.enabled && !isPdf) {
      setStatus('capturing');
      try {
        const result = await captureSite({
          url,
          outDir: path.join(runDir, 'captures'),
          format,
          chromePath: cfg.capture.chromePath || undefined,
          timeoutMs: cfg.capture.timeoutMs,
        });
        captures = result.captures;
        run.warnings.push(...result.warnings);
        for (const w of result.warnings) note(`capture: ${w}`);
        note(`captured ${captures.length} screenshot(s): ${captures.map((c) => c.id).join(', ')}`);
      } catch (err) {
        // A failed capture is not fatal (the source's own images may carry the video), but it is
        // never silent — the run records exactly what went wrong.
        const msg = `Real-UI capture failed: ${(err as Error).message}`;
        run.warnings.push(msg);
        note(msg);
      }
    } else {
      note('real-UI capture disabled (OMNICAST_CAPTURE=0 or PDF source)');
    }
    save();

    // ── 4. plan (Claude via kie.ai) ──────────────────────────────────────────
    setStatus('planning');
    const planResult: BragPlanResult = await planBrag(article, identity, {
      tone,
      format,
      durationSeconds,
      captures,
      // Per-call override, else OMNICAST_BRAG_MODEL (see src/lib/kieClaude.ts).
      model: req.model,
      onProgress: (m) => note(m),
    });
    const plan = planResult.plan;
    run.plan = plan;
    run.model = planResult.model;
    run.shareCopy = plan.shareCopy;
    run.warnings.push(...planResult.warnings);
    run.corrections.push(...planResult.corrections);
    note(`plan: ${plan.storyboard.length} scenes, ${plan.durationSeconds}s, ${plan.keyConcepts.length} concepts, tone=${plan.tone.preset}, model=${planResult.model}`);
    save();

    // ── 5. resolve visuals ───────────────────────────────────────────────────
    setStatus('assets');
    const visualSources: Record<number, string> = {};
    const visualLabels: Record<number, string> = {};

    // Captures must be copied under public/ — Remotion can only serve files from there.
    if (captures.length > 0) {
      const srcById = new Map(captures.map((c) => [c.id, c]));
      const publicCaptureDir = path.join(cfg.paths.publicDir, 'runs', runId, 'captures');
      fs.mkdirSync(publicCaptureDir, { recursive: true });
      for (const capture of captures) {
        fs.copyFileSync(capture.file, path.join(publicCaptureDir, `${capture.id}.png`));
      }
      const mapped = capturesToVisualSources(plan, captures, `runs/${runId}/captures/`);
      Object.assign(visualSources, mapped.sources);
      Object.assign(visualLabels, mapped.labels);
      for (const w of mapped.warnings) {
        // Only noisy if the plan actually referenced a screenshot id that was never captured.
        const unreferenced = captures.length > 0 && !/was not captured/.test(w);
        if (!unreferenced) note(`assets: ${w}`);
        run.warnings.push(w);
      }
      void srcById;
    }

    const assetMapped = articleAssetsToVisualSources(plan, article.assets);
    Object.assign(visualSources, assetMapped.sources);
    Object.assign(visualLabels, assetMapped.labels);
    run.warnings.push(...assetMapped.warnings);

    // Generated illustrations go through the existing asset pipeline (Supabase-configured model).
    for (const [index, scene] of plan.storyboard.entries()) {
      if (scene.visualSource !== 'generated') continue;
      const prompt = scene.onScreen || scene.text.join(' ') || plan.appName;
      const generated = await getOrGenerateConceptImage(scene.name, prompt, cfg.defaultStyle as never);
      visualSources[index] = generated.imageUrl;
      visualLabels[index] = `generated: ${scene.name}`;
      note(`assets: scene ${index + 1} generated image (${generated.fromCache ? 'cache' : 'fresh'})`);
    }

    for (const [index, scene] of plan.storyboard.entries()) {
      if (visualSources[index]) continue;
      if (scene.visualSource === 'typographic') {
        note(`assets: scene ${index + 1} is intentional typography (no image)`);
      } else {
        note(
          `assets: scene ${index + 1} wanted a "${scene.visualSource}" visual but none resolved — ` +
            'it will render as typography instead (see warnings above)',
        );
      }
    }
    save();

    // ── 6. compile to the renderer contract ──────────────────────────────────
    const compiled = bragPlanToStoryboard(plan, {
      format,
      fps: 30,
      captions: req.captions ?? cfg.captions,
      visualSources,
      visualLabels,
      palette: { background: resolvedIdentity.background, accent: resolvedIdentity.accent, text: resolvedIdentity.text },
    });
    run.warnings.push(...compiled.warnings);
    for (const w of compiled.warnings) note(`compile: ${w}`);

    // ── 7. audio plan (music + beat-aligned SFX) ─────────────────────────────
    setStatus('audio');
    const audioPlan: BragAudioPlan = buildBragAudioPlan({
      brag: compiled.brag,
      publicDir: cfg.paths.publicDir,
      // NOTE: `??` and `||` cannot be mixed without parentheses in JS — the outer `??` here means
      // "an explicit per-call id wins; otherwise fall back to the env default, treating '' as unset".
      trackId: req.musicTrackId ?? (cfg.music.trackId || undefined),
      musicEnabled: req.music ?? cfg.music.enabled,
      sfxEnabled: req.sfx ?? cfg.sfx.enabled,
    });
    run.warnings.push(...audioPlan.warnings);
    for (const w of audioPlan.warnings) note(`audio: ${w}`);
    note(
      audioPlan.music
        ? `music: ${audioPlan.music.trackId} (${audioPlan.music.tempo ? `${audioPlan.music.tempo.toFixed(1)} BPM` : 'no tempo'}, ${
            audioPlan.music.beatAligned ? 'beat-aligned' : 'even spacing'
          })`
        : 'music: none',
    );
    note(`sfx: ${audioPlan.sfx.length} cue(s)`);

    // ── 7b. narration (opt-in) ───────────────────────────────────────────────
    let sceneAudio = undefined as BragPromoProps['sceneAudio'];
    const voiceEnabled = req.voice ?? cfg.voice.enabled;
    if (voiceEnabled) {
      const { synthesizePerSceneSpeech } = await import('./lib/elevenlabsTts');
      sceneAudio = await synthesizePerSceneSpeech(
        compiled.manifest.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
        {
          // Previously these config values were never passed, so OMNICAST_VOICE_ID and
          // OMNICAST_VOICE_SPEED were dead settings and the library default voice always won.
          voiceId: req.voiceId ?? (cfg.voice.voiceId || undefined),
          speed: cfg.voice.speed,
        },
      );

      // synthesizePerSceneSpeech() SILENTLY falls back to empty audioUrl + estimated timestamps when
      // the ElevenLabs key is missing or rejected. Downstream that renders a silent video that claims
      // to be narrated, so treat it as a hard failure here (the CLI, at least, cannot warn).
      const silentScenes = sceneAudio.filter((sa) => !sa.audioUrl);
      if (silentScenes.length > 0) {
        throw new Error(
          `[omnicast] Voice was requested but no audio was produced for ${silentScenes.length} of ` +
            `${sceneAudio.length} scene(s) (scene ${silentScenes.map((s) => s.sceneNumber).join(', ')}). ` +
            'That means ElevenLabs returned no audio — usually a missing/invalid key in ' +
            "Supabase api_keys(provider='elevenlabs') or ELEVENLABS_API_KEY. Refusing to render a " +
            'video that claims to be narrated but is silent. Re-run with --no-voice to render without narration.',
        );
      }
      // Guard against silent truncation: a <Sequence> clips audio longer than its scene, which would
      // cut a sentence mid-word with no error anywhere.
      const overflows = sceneAudio
        .map((sa) => {
          const scene = compiled.brag.scenes.find((s) => s.sceneNumber === sa.sceneNumber);
          const over = (sa.durationSeconds || 0) - (scene?.seconds ?? 0);
          return over > 0.15 ? { scene: sa.sceneNumber, over, name: scene?.name ?? '?' } : null;
        })
        .filter((x): x is { scene: number; over: number; name: string } => x !== null);

      if (overflows.length > 0) {
        // A spoken sentence runs ~0.4-0.5s/word, but the planner budgets on-screen text for READING
        // (~0.3s/word) — so narration can outrun the scene it belongs to. The brag law is that narration
        // never extends the 15-25s WINDOW; within the window, though, scenes may be rebalanced, which is
        // what an editor would do. So absorb the overflow by lengthening the offending scenes and only
        // fail if that would push the video past the window. Never truncate a sentence mid-word.
        const BRAG_MAX_SECONDS = 25;
        const totalBefore = compiled.brag.scenes.reduce((n, s) => n + s.seconds, 0);
        const headroom = BRAG_MAX_SECONDS - totalBefore;
        // +0.1s per scene so the re-check below clears the guard's 0.15s tolerance rather than sitting on it.
        const needed = overflows.reduce((n, o) => n + o.over + 0.1, 0);

        if (needed > headroom) {
          throw new Error(
            '[omnicast] Narration does not fit the authored scene timing, and there is not enough room in ' +
              'the 15-25s window to lengthen the scenes without truncating a sentence mid-word:\n' +
              overflows.map((o) => `  · scene ${o.scene} "${o.name}" overflows by ${o.over.toFixed(2)}s`).join('\n') +
              `\nRebalancing needs +${needed.toFixed(2)}s but only ${headroom.toFixed(2)}s of headroom remains ` +
              `(total would be ${(totalBefore + needed).toFixed(2)}s, limit ${BRAG_MAX_SECONDS}s).\n` +
              'Fix: shorten that scene\'s narration, drop --voice, or request a shorter video.',
          );
        }

        for (const o of overflows) {
          const scene = compiled.brag.scenes.find((s) => s.sceneNumber === o.scene);
          if (!scene) continue;
          const extended = Math.round((scene.seconds + o.over + 0.1) * 100) / 100;
          note(
            `narration: scene ${o.scene} "${o.name}" lengthened ${scene.seconds}s → ${extended}s — the spoken ` +
              `line needed ${o.over.toFixed(2)}s more than the scene allowed`,
          );
          scene.seconds = extended;
          // Keep the manifest in step: the composition and the poster-bake frame count both read these.
          const mScene = compiled.manifest.scenes.find((s) => s.sceneNumber === o.scene);
          if (mScene) mScene.duration = extended;
          run.warnings.push(
            `Narration would have been truncated in scene ${o.scene} ("${o.name}"); the scene was lengthened ` +
              `by ${(o.over + 0.1).toFixed(2)}s instead. The copy is unchanged.`,
          );
        }
        note(
          `narration: scene timings rebalanced to protect the spoken lines — total ${totalBefore.toFixed(1)}s → ` +
            `${compiled.brag.scenes.reduce((n, s) => n + s.seconds, 0).toFixed(1)}s (brag window is 15-25s)`,
        );
      } else {
        note(`narration: ${sceneAudio.length} scene(s), all within their scene durations`);
      }
      // synthesizePerSceneSpeech() already writes each file into public/ under its audioUrl, so the
      // composition can serve them directly — no extra persistence step is needed here.
    } else {
      note('narration disabled (OMNICAST_VOICE=0)');
    }
    save();

    // ── 8. render ────────────────────────────────────────────────────────────
    setStatus('rendering');
    const propsPath = path.join(runDir, 'brag-props.json');
    const videoPath = path.join(runDir, 'brag.mp4');

    // staticFile() cannot serve this project's public/ (verified: a file present since August 404s),
    // so assets are served over HTTP for the duration of the render.
    const assetServer = await startPublicServer(cfg.paths.publicDir);
    note(`asset server: ${assetServer.baseUrl} → ${path.resolve(cfg.paths.publicDir)}`);

    const props: BragPromoProps = {
      manifest: compiled.manifest,
      brag: compiled.brag,
      sceneAudio,
      audio: audioPlan,
      captions: req.captions ?? cfg.captions,
      assetsBaseUrl: assetServer.baseUrl,
    };
    fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));
    run.propsPath = propsPath;

    note(`rendering BragPromo (${compiled.brag.width}x${compiled.brag.height}, ${compiled.brag.scenes.length} scenes)…`);
    save();

    try {
      await exec('npx', ['remotion', 'render', 'BragPromo', videoPath, `--props=${propsPath}`, '--codec=h264', `--concurrency=${cfg.concurrency}`, '--log=error']);
    } finally {
      const served = assetServer.requestCount();
      const missed = assetServer.missing();
      await assetServer.close();
      note(`asset server served ${served} request(s)`);
      if (missed.length > 0) {
        // A 404 during render means a visual or audio asset silently did not load — exactly the kind
        // of thing that must never pass unnoticed.
        const unique = [...new Set(missed)];
        run.warnings.push(`Asset server 404s during render: ${unique.slice(0, 8).join(', ')}${unique.length > 8 ? ` (+${unique.length - 8} more)` : ''}`);
        note(`⚠️  asset 404s: ${unique.join(', ')}`);
      }
    }

    if (!fs.existsSync(videoPath)) {
      throw new Error(`[omnicast] Remotion reported success but ${videoPath} does not exist.`);
    }
    note(`rendered ${videoPath}`);
    run.videoPath = videoPath;
    save();

    // ── 9. poster + bake as frame 0 ──────────────────────────────────────────
    setStatus('poster');
    let cursor = 0;
    const midpoints = compiled.brag.scenes.map((s) => {
      const mid = cursor + s.seconds / 2;
      cursor += s.seconds;
      return Number(mid.toFixed(3));
    });
    const poster = await pickPosterFrame(videoPath, midpoints, path.join(runDir, 'poster'));
    run.posterPath = poster.file;
    note(`poster: ${path.basename(poster.file)} from t=${poster.atSeconds}s`);

    const baked = await bakePosterAsFirstFrame(
      videoPath,
      poster.file,
      compiled.brag.width,
      compiled.brag.height,
      // Same per-scene rounding as Root.tsx's calculateMetadata, so the frame bound matches exactly.
      compiled.brag.scenes.reduce((acc, s) => acc + Math.max(Math.round(s.seconds * 30), 30), 0),
    );
    if (baked.warning) {
      run.warnings.push(baked.warning);
      note(baked.warning);
    } else {
      note('poster baked as frame 0');
    }
    save();

    // ── 10. share copy ───────────────────────────────────────────────────────
    const shareCopyPath = path.join(runDir, 'share-copy.txt');
    fs.writeFileSync(
      shareCopyPath,
      [
        plan.shareCopy,
        '',
        `# ${plan.appName} — ${plan.tone.preset}`,
        `# source: ${url}`,
        plan.keyConcepts.length ? `# concepts: ${plan.keyConcepts.join(' | ')}` : '',
        '',
      ].join('\n'),
    );
    note(`share copy: ${shareCopyPath}`);

    // ── 11. publish (opt-in) ─────────────────────────────────────────────────
    const shouldPublish = req.publish ?? cfg.youtube.enabled;
    if (shouldPublish) {
      setStatus('publishing');
      const { buildMetadata, uploadVideo } = await import('./lib/youtubePublisher');

      const metadata = buildMetadata({
        plan,
        privacy: cfg.youtube.privacy,
        categoryId: cfg.youtube.categoryId,
        madeForKids: cfg.youtube.madeForKids,
        defaultTags: cfg.youtube.defaultTags,
        isVertical: format === 'vertical',
        durationSeconds: plan.durationSeconds,
        sourceUrl: url,
      });
      // Any clamp (title/description/tags) is reported, not applied silently.
      for (const w of metadata.warnings) {
        run.warnings.push(`publish metadata: ${w}`);
        note(`publish metadata: ${w}`);
      }
      note(
        `publish: "${metadata.title}" (${metadata.privacyStatus}, ${metadata.tags.length} tags, ` +
          `category ${metadata.categoryId})${req.publishDryRun ? ' [DRY RUN]' : ''}`,
      );

      const result = await uploadVideo({
        videoPath,
        metadata,
        creds: {
          clientId: cfg.youtube.clientId,
          clientSecret: cfg.youtube.clientSecret,
          refreshToken: cfg.youtube.refreshToken,
        },
        thumbnailPath: run.posterPath,
        dryRun: req.publishDryRun,
        onProgress: (m) => note(`publish: ${m}`),
      });

      run.warnings.push(...result.warnings);
      for (const w of result.warnings) note(`publish: ${w}`);

      // A dry run must not look published, or a caller polling status will believe it went live.
      if (req.publishDryRun) {
        note('publish: dry run complete — nothing was uploaded and no quota was consumed');
      } else {
        run.youtubeUrl = result.watchUrl;
        note(
          `published: ${result.watchUrl}${result.isShort ? ` (Short: ${result.shortsUrl})` : ''} — ` +
            `read back as "${result.verified.title}" / ${result.verified.privacyStatus}` +
            `${result.thumbnailSet ? ' (thumbnail set)' : ''}`,
        );
      }
      save();
    }

    setStatus('done');
    note(`done in ${((Date.now() - Date.parse(run.startedAt)) / 1000).toFixed(1)}s — ${videoPath}`);
    save();
    return run;
  } catch (err) {
    run.status = 'failed';
    run.error = (err as Error).message;
    run.log.push(`${nowIso()} FAILED: ${run.error}`);
    save();
    throw err;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): OmnicastRequest {
  const req: OmnicastRequest = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i] ?? '';
    switch (a) {
      case '--url': req.url = next(); break;
      case '--mode': req.mode = next() as OmnicastMode; break;
      case '--tone': req.tone = next(); break;
      case '--format': req.format = next() as FormatName; break;
      case '--duration': req.durationSeconds = Number(next()); break;
      case '--run-id': req.runId = next(); break;
      case '--voice': req.voice = true; break;
      case '--no-voice': req.voice = false; break;
      case '--voice-id': req.voiceId = next(); break;
      case '--model': req.model = next(); break;
      case '--music-track': req.musicTrackId = next(); break;
      case '--no-music': req.music = false; break;
      case '--no-sfx': req.sfx = false; break;
      case '--captions': req.captions = true; break;
      case '--publish': req.publish = true; break;
      case '--no-publish': req.publish = false; break;
      case '--dry-run-publish': req.publish = true; req.publishDryRun = true; break;
      case '--help': case '-h': printUsage(); process.exit(0); break;
      default:
        if (a.startsWith('http') || a.endsWith('.pdf')) req.url = a;
        else console.warn(`[omnicast] ignoring unknown argument "${a}"`);
    }
  }
  return req;
}

function printUsage(): void {
  const cfg = loadOmnicastConfig();
  console.log(`OmniCast — URL to promo video

Usage:
  npm run omnicast -- [options] [url]

Options (all optional; defaults come from .env via src/lib/runtimeConfig.ts):
  --url <url>            source URL or .pdf      (default: OMNICAST_DEFAULT_URL)
  --mode <promo>         promo | explainer | both
  --tone <tone>          brag preset or freeform direction
  --format <format>      vertical | landscape | square
  --duration <seconds>   15-25
  --voice / --no-voice   ElevenLabs narration (off by default)
  --voice-id <id>        ElevenLabs voice id          (default: OMNICAST_VOICE_ID)
  --model <alias>        Claude model for the plan    (default: OMNICAST_BRAG_MODEL)
  --music-track <id>     bundled brag track id        (default: OMNICAST_MUSIC_TRACK, else by tone)
  --no-music             disable the music bed
  --no-sfx               disable sound effects
  --captions             burn in word-level captions
  --publish              publish to YouTube after render
  --dry-run-publish      validate auth + metadata without uploading (no quota used)
  --run-id <id>          reuse an existing run directory

Examples:
  npm run omnicast -- --url https://example.com/article --tone polished
  npm run omnicast                     # zero-arg run using .env defaults

Current defaults: mode=${cfg.defaultMode} format=${cfg.defaultFormat} tone=${cfg.defaultTone} duration=${cfg.defaultDurationSeconds}s ${
    cfg.defaultUrl ? `url=${cfg.defaultUrl}` : '(no default url set)'
  }
`);
}

// Only run when invoked directly (so mcp/server.ts can import runOmnicast without side effects).
const invokedDirectly = process.argv[1] && /omnicast\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  const req = parseArgs(process.argv.slice(2));
  runOmnicast(req)
    .then((run) => {
      console.log(`\n✅ ${run.videoPath}`);
      if (run.warnings.length) console.log(`⚠️  ${run.warnings.length} warning(s) — see ${path.join(run.runDir, RUN_MANIFEST)}`);
    })
    .catch((err) => {
      console.error(`\n❌ ${(err as Error).message}`);
      process.exit(1);
    });
}
