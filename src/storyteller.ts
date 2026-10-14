/**
 * Storyteller orchestrator — URL in, narrated explainer video out, with no browser and no prompts.
 *
 * This is the headless twin of the StoryStudio flow: ingest → LLM storyboard → nano-banana-pro /
 * Flux images (+ infographics) → Seedance animated scenes → ElevenLabs narration → optional region
 * highlights → image localization → `StorytellerExplainer` render → poster baked as frame 0.
 *
 * Design rules it obeys, all learned the hard way in this repo:
 * - **No silent fallbacks.** Every stage either succeeds or writes the real error into
 *   `runs/<runId>/run.json` and rethrows. Nothing is quietly substituted (no placeholder images, no
 *   Pollinations, no synthetic timestamps).
 * - **Checkpoint everything.** run.json is written on every transition so an agent that cannot block
 *   on a multi-minute render can poll `storyteller_status` and survive a restart.
 * - **Per-run paths.** Assets and audio land under `runs/<runId>/`, never in a shared directory.
 * - **Absolute asset urls.** Everything the renderer loads goes through the ephemeral asset server.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ingestUrl, ingestPdf } from './lib/ingest';
import { generateContextAwareStoryboard, generateVideosForManifest } from './lib/contextEngine';
import { isUsableImageRef, resolveManifestImageAssets } from './lib/assetCatalogManager';
import { synthesizePerSceneSpeech } from './lib/elevenlabsTts';
import { isGroundingDinoAvailable } from './lib/groundingDinoClient';
import { generateRegionFocusEvents } from './lib/regionSync';
import { startPublicServer, type PublicServer } from './lib/assetServer';
import { localizeManifestImages } from './lib/localizeImages';
import {
  assertRenderablePayload,
  buildRenderPayload,
  renderExplainer,
  sceneDurations,
  sceneMidpoints,
  type RenderPayload,
} from './lib/renderPayload';
import {
  bakePosterAsFirstFrame,
  exec,
  hasAudioStream,
  listRunRecords,
  makeRunId,
  measureMeanVolumeDb,
  pickPosterFrame,
  probeDurationSeconds,
  readRunRecord,
  writeJson,
} from './lib/runKit';
import {
  FORMATS,
  loadStorytellerConfig,
  resolveTargetUrl,
  type StorytellerConfig,
} from './lib/storytellerConfig';

import type { ArticleData, ImageStylePreset, SceneAudio, StoryboardManifest } from './types/storyboard';

export type StorytellerStatus =
  | 'queued'
  | 'ingesting'
  | 'storyboarding'
  | 'images'
  | 'video'
  | 'voice'
  | 'regions'
  | 'localizing'
  | 'rendering'
  | 'poster'
  | 'done'
  | 'failed';

export interface StorytellerRequest {
  url?: string;
  style?: string;
  aspect?: keyof typeof FORMATS;
  voice?: boolean;
  voiceId?: string;
  speed?: number;
  research?: boolean;
  focusTopics?: string[];
  videoScenes?: boolean;
  videoMaxScenes?: number;
  regionHighlights?: boolean;
  musicTrackId?: string;
  runId?: string;
  /** Stop AFTER this stage and return a partial run — lets plumbing be verified without paying for later stages. */
  until?: StorytellerStatus;
}

export interface StorytellerRun {
  runId: string;
  runDir: string;
  status: StorytellerStatus;
  url: string;
  title?: string;
  style: string;
  aspect: string;
  startedAt: string;
  updatedAt: string;
  sceneCount?: number;
  animatedScenes?: number;
  imageModel?: string;
  videoModel?: string;
  videoPath?: string;
  posterPath?: string;
  durationSeconds?: number;
  meanVolumeDb?: number | null;
  warnings: string[];
  corrections: string[];
  log: string[];
  error?: string;
  /** True when the run stopped early at `--until` (a partial verification run, not a failure). */
  partial?: boolean;
}

const FPS = 30;

function applyOverrides(cfg: StorytellerConfig, req: StorytellerRequest): StorytellerConfig {
  return {
    ...cfg,
    style: (req.style ? (req.style as StorytellerConfig['style']) : cfg.style),
    aspect: req.aspect ?? cfg.aspect,
    voice: {
      ...cfg.voice,
      enabled: req.voice ?? cfg.voice.enabled,
      voiceId: req.voiceId ?? cfg.voice.voiceId,
      speed: req.speed ?? cfg.voice.speed,
    },
    storyboard: {
      ...cfg.storyboard,
      research: req.research ?? cfg.storyboard.research,
      focusTopics: req.focusTopics ?? cfg.storyboard.focusTopics,
    },
    video: {
      ...cfg.video,
      enabled: req.videoScenes ?? cfg.video.enabled,
      maxScenes: req.videoMaxScenes ?? cfg.video.maxScenes,
    },
    regionHighlights: req.regionHighlights ?? cfg.regionHighlights,
    music: { trackId: req.musicTrackId ?? cfg.music.trackId },
  };
}

/** Image elements that still have no usable reference (skips text_to_video scenes by design). */
function collectImageProblems(manifest: StoryboardManifest): string[] {
  const problems: string[] = [];
  for (const scene of manifest.scenes) {
    if ((scene as any).animationStrategy === 'text_to_video') continue; // the video IS the visual
    for (const el of ((scene.layout?.elements || []) as any[])) {
      if (el.type !== 'image') continue;
      const src = el.sourceAssetId;
      if (!isUsableImageRef(src)) problems.push(`scene ${scene.sceneNumber}: no usable image (${src || 'empty'})`);
      else if (/pollinations/i.test(String(src))) problems.push(`scene ${scene.sceneNumber}: pollinations reference (provider removed)`);
    }
  }
  return problems;
}

function countUnresolvedImages(manifest: StoryboardManifest): number {
  return collectImageProblems(manifest).filter((p) => p.includes('no usable image')).length;
}

/**
 * Demotes animated scenes beyond the cost cap. Deterministic (scene order) and recorded — a silently
 * dropped animation would look like a generation failure later.
 */
function capAnimatedScenes(manifest: StoryboardManifest, maxScenes: number, note: (m: string) => void): StoryboardManifest {
  if (maxScenes <= 0) return manifest;
  const animated = manifest.scenes.filter((s) => {
    const a = (s as any).animationStrategy;
    return a === 'image_to_video' || a === 'text_to_video';
  });
  if (animated.length <= maxScenes) return manifest;

  const keep = new Set(animated.slice(0, maxScenes).map((s) => s.sceneNumber));
  const demoted: number[] = [];
  for (const scene of manifest.scenes) {
    const a = (scene as any).animationStrategy;
    if ((a === 'image_to_video' || a === 'text_to_video') && !keep.has(scene.sceneNumber)) {
      (scene as any).animationStrategy = 'static';
      demoted.push(scene.sceneNumber);
    }
  }
  note(`video cap ${maxScenes}: demoted scene(s) ${demoted.join(', ')} from animated to static to stay inside the budget`);
  return manifest;
}

/**
 * Narrative audio can outlast its scene (reading pace ≠ speaking pace), and a `<Sequence>` clips it
 * mid-sentence with no error. Lengthen the scene instead of truncating the sentence.
 */
function fitScenesToAudio(
  manifest: StoryboardManifest,
  sceneAudio: SceneAudio[],
  note: (m: string) => void,
  corrections: string[],
): StoryboardManifest {
  const byScene = new Map(sceneAudio.map((sa) => [sa.sceneNumber, sa]));
  for (const scene of manifest.scenes) {
    const sa = byScene.get(scene.sceneNumber);
    if (!sa?.durationSeconds) continue;
    const current = Number(scene.duration) || 0;
    if (sa.durationSeconds > current + 0.15) {
      const next = Number((sa.durationSeconds + 0.1).toFixed(2));
      corrections.push(`scene ${scene.sceneNumber}: duration ${current}s → ${next}s to fit ${sa.durationSeconds.toFixed(2)}s of narration`);
      note(`scene ${scene.sceneNumber}: extended ${current}s → ${next}s so narration is not clipped`);
      scene.duration = next;
    }
  }
  return manifest;
}

export async function runStoryteller(
  req: StorytellerRequest = {},
  onProgress?: (run: StorytellerRun) => void,
): Promise<StorytellerRun> {
  const cfg = applyOverrides(loadStorytellerConfig(), req);
  const url = resolveTargetUrl(req.url, cfg);
  const runId = req.runId ?? makeRunId();
  const runDir = path.resolve(cfg.paths.runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const run: StorytellerRun = readRunRecord<StorytellerRun>(runDir) ?? {
    runId,
    runDir,
    status: 'queued',
    url,
    style: cfg.style,
    aspect: cfg.aspect,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    warnings: [],
    corrections: [],
    log: [],
  };

  const save = (): void => {
    run.updatedAt = new Date().toISOString();
    writeJson(path.join(runDir, 'run.json'), run);
    onProgress?.(run);
  };
  const note = (msg: string): void => {
    run.log.push(`${new Date().toISOString()} ${msg}`);
    console.log(`[storyteller:${runId}] ${msg}`);
  };
  const warn = (msg: string): void => {
    run.warnings.push(msg);
    note(`WARNING ${msg}`);
  };
  const setStatus = (status: StorytellerStatus): void => {
    run.status = status;
    save();
  };
  /** Honour `--until`: stop cleanly after a stage instead of paying for later ones. */
  const stopAfter = (stage: StorytellerStatus): boolean => {
    if (req.until !== stage) return false;
    run.partial = true;
    note(`stopped after "${stage}" (--until) — partial verification run, nothing was rendered`);
    save();
    return true;
  };

  let server: PublicServer | null = null;

  try {
    note(`run ${runId} — url=${url} style=${cfg.style} aspect=${cfg.aspect} voice=${cfg.voice.enabled}`);
    save();

    // ── 1. ingest ──────────────────────────────────────────────────────────────
    setStatus('ingesting');
    const isPdf = url.toLowerCase().endsWith('.pdf');
    const article: ArticleData = isPdf ? await ingestPdf(url) : await ingestUrl(url);
    run.title = article.title;
    note(`ingested "${article.title}" (${article.wordCount} words, ${article.assets.length} article image asset(s))`);
    writeJson(path.join(runDir, 'article.json'), article);
    if (stopAfter('ingesting')) return run;

    // ── 2. storyboard ─────────────────────────────────────────────────────────
    setStatus('storyboarding');
    const storyboardOptions = {
      stylePreset: cfg.style as unknown as ImageStylePreset,
      focusTopics: cfg.storyboard.focusTopics.filter((t) => t.toLowerCase() !== 'all'),
      allowExternalResearch: cfg.storyboard.research,
      recommendedSceneCount: cfg.storyboard.recommendedSceneCount || undefined,
      bypassCache: true,
    } as any;

    // The planner occasionally returns malformed JSON (measured: "Expected double-quoted property
    // name in JSON at position 9587") and the engine's repair pass can fail too. That is transient
    // model flakiness, not a config error, and it happens BEFORE any image is paid for — so one
    // clean retry is worth it. Any other error propagates untouched: no invented storyboard, no
    // cached substitute.
    let storyboardResult: Awaited<ReturnType<typeof generateContextAwareStoryboard>>;
    try {
      storyboardResult = await generateContextAwareStoryboard(article, storyboardOptions);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/Failed to parse LLM JSON|Unexpected token|JSON at position/i.test(message)) throw err;
      warn(`planner returned malformed JSON — retrying the storyboard stage once (${message.split('\n')[0]})`);
      setStatus('storyboarding');
      storyboardResult = await generateContextAwareStoryboard(article, storyboardOptions);
      note('storyboard retry succeeded');
    }
    const { manifest: rawManifest, context } = storyboardResult;
    let manifest: StoryboardManifest = rawManifest;
    run.sceneCount = manifest.scenes.length;
    note(`storyboard: ${manifest.scenes.length} scenes (contentType=${context?.contentType})`);
    writeJson(path.join(runDir, 'storyboard.json'), manifest);
    if (stopAfter('storyboarding')) return run;

    // ── 3. images (nano-banana-pro / Flux 2, routed by style) ─────────────────
    setStatus('images');
    // generateContextAwareStoryboard() ALREADY ran resolveManifestImageAssets and paid for these
    // images. Resolving again with bypassCache=true would regenerate every one of them, so only
    // resolve when something is genuinely unresolved.
    const unresolvedBefore = countUnresolvedImages(manifest);
    if (unresolvedBefore > 0) {
      note(`images: ${unresolvedBefore} element(s) unresolved after the storyboard stage — running the resolution pass`);
      manifest = await resolveManifestImageAssets(manifest, article.assets, cfg.style as unknown as ImageStylePreset, true);
    } else {
      note('images: already resolved by the storyboard stage (no regeneration)');
    }
    const imageProblems = collectImageProblems(manifest);
    if (imageProblems.length) {
      throw new Error(`[storyteller] image stage produced unusable assets:\n  - ${imageProblems.join('\n  - ')}`);
    }
    note('images resolved');
    writeJson(path.join(runDir, 'storyboard.images.json'), manifest);
    if (stopAfter('images')) return run;

    // ── 4. animated scenes (Seedance) ─────────────────────────────────────────
    if (cfg.video.enabled) {
      setStatus('video');
      manifest = capAnimatedScenes(manifest, cfg.video.maxScenes, note);
      manifest = await generateVideosForManifest(
        manifest,
        (msg) => note(`video: ${msg}`),
        (sceneNumber, status) => note(`video: scene ${sceneNumber} ${status}`),
      );
      run.animatedScenes = manifest.scenes.filter((s) => Boolean((s.layout?.elements || []).find((e: any) => e.videoUrl))).length;
      note(`animated scenes with a video asset: ${run.animatedScenes}`);
      writeJson(path.join(runDir, 'storyboard.video.json'), manifest);
    } else {
      note('video scenes disabled (STORYTELLER_VIDEO_SCENES=0)');
    }
    if (stopAfter('video')) return run;

    // ── 5. narration ──────────────────────────────────────────────────────────
    let sceneAudio: SceneAudio[] = [];
    if (cfg.voice.enabled) {
      setStatus('voice');
      sceneAudio = await synthesizePerSceneSpeech(
        manifest.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
        { voiceId: cfg.voice.voiceId, speed: cfg.voice.speed, modelId: cfg.voice.modelId },
      );
      const silent = sceneAudio.filter((sa) => !sa.audioUrl);
      if (silent.length) {
        throw new Error(
          `[storyteller] narration requested but ${silent.length} scene(s) produced no audio ` +
            `(scenes ${silent.map((s) => s.sceneNumber).join(', ')}). A silent video claiming to be narrated is not acceptable.`,
        );
      }
      manifest = fitScenesToAudio(manifest, sceneAudio, note, run.corrections);
      writeJson(path.join(runDir, 'scene_audio.json'), sceneAudio);
      note(`narration: ${sceneAudio.length} scene(s), ${sceneAudio.reduce((a, sa) => a + (sa.wordTimestamps?.length || 0), 0)} word timestamps`);
    } else {
      note('narration disabled (STORYTELLER_VOICE=0)');
    }
    if (stopAfter('voice')) return run;

    // ── 6. region highlights (optional; needs the EasyOCR/DINO backend) ───────
    if (cfg.regionHighlights) {
      setStatus('regions');
      const available = await isGroundingDinoAvailable();
      if (!available) {
        throw new Error(
          '[storyteller] STORYTELLER_REGION_HIGHLIGHTS=1 but the detection backend is not reachable on :8001. ' +
            'Start `backend/main.py`, or set STORYTELLER_REGION_HIGHLIGHTS=0.',
        );
      }
      let withRegions = 0;
      for (const scene of manifest.scenes) {
        const sa = sceneAudio.find((a) => a.sceneNumber === scene.sceneNumber);
        const imageEl = (scene.layout?.elements || []).find((e: any) => e.type === 'image') as any;
        try {
          const result = await generateRegionFocusEvents(scene, sa?.wordTimestamps || [], imageEl?.sourceAssetId);
          (scene as any).detectedRegions = result.detectedRegions;
          (scene as any).regionFocusEvents = result.regionFocusEvents;
          (scene as any).detectedImageWidth = result.imageWidth;
          (scene as any).detectedImageHeight = result.imageHeight;
          if (result.regionFocusEvents.length) withRegions++;
        } catch (err) {
          warn(`region detection failed for scene ${scene.sceneNumber}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      note(`region highlights: ${withRegions} scene(s) with focus events`);
    }

    // ── 7. serve public/ + localize every remote image ────────────────────────
    setStatus('localizing');
    server = await startPublicServer(cfg.paths.publicDir);
    note(`asset server: ${server.baseUrl}`);
    const localized = await localizeManifestImages(manifest, {
      runId,
      publicDir: cfg.paths.publicDir,
      baseUrl: server.baseUrl,
    });
    for (const w of localized.warnings) warn(w);
    manifest = localized.manifest;
    note(`localized ${localized.localized} image(s)`);

    const size = FORMATS[cfg.aspect];

    // ── 8. render ─────────────────────────────────────────────────────────────
    setStatus('rendering');
    const payload: RenderPayload = buildRenderPayload({
      manifest,
      sceneAudio,
      audioBaseUrl: server.baseUrl,
      fps: FPS,
      bgMusicUrl: undefined,
      articleUrl: url,
      annotationConfig: {
        showTitle: true,
        // Word-synced captions matter for silent autoplay; they need the ElevenLabs timestamps.
        subtitle: cfg.captions && cfg.voice.enabled
          ? {
              enabled: true,
              fontSize: 32,
              color: '#FFFFFF',
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              highlightActiveWord: true,
              activeWordColor: '#FFD700',
            }
          : { enabled: false },
      },
    });
    assertRenderablePayload(payload, { voiceExpected: cfg.voice.enabled });

    const videoPath = path.join(runDir, 'final.mp4');
    const result = await renderExplainer(payload, {
      videoPath,
      propsPath: path.join(runDir, 'storyboard_props.json'),
      logPath: path.join(runDir, 'render.log'),
      onProgress: (line) => { if (/rendering \d+\/\d+/.test(line)) note(line); },
    });
    run.videoPath = result.videoPath;
    run.durationSeconds = result.durationSeconds ?? undefined;
    note(`render complete: ${path.basename(result.videoPath)} (${run.durationSeconds?.toFixed(2)}s)`);

    // ── 9. poster + bake as frame 0 ───────────────────────────────────────────
    setStatus('poster');
    const midpoints = sceneMidpoints(manifest, sceneAudio);
    const poster = await pickPosterFrame(result.videoPath, midpoints, path.join(runDir, 'poster'), 'poster.jpg');
    run.posterPath = poster.file;
    const baked = await bakePosterAsFirstFrame(result.videoPath, poster.file, { width: size.width, height: size.height, fps: FPS });
    if (baked.warning) warn(baked.warning);
    note(`poster from t=${poster.atSeconds.toFixed(2)}s`);

    // ── 10. verify what actually landed ──────────────────────────────────────
    const finalDuration = await probeDurationSeconds(baked.videoPath);
    const hasAudio = await hasAudioStream(baked.videoPath);
    if (cfg.voice.enabled) {
      if (!hasAudio) throw new Error('[storyteller] rendered video has no audio stream, but narration was requested');
      run.meanVolumeDb = await measureMeanVolumeDb(baked.videoPath);
      if (run.meanVolumeDb !== null && run.meanVolumeDb < -60) {
        throw new Error(`[storyteller] audio stream present but effectively silent (mean ${run.meanVolumeDb} dB) — narration did not land`);
      }
    }
    const animatedWithVideo = manifest.scenes.filter((s) => Boolean((s.layout?.elements || []).find((e: any) => e.videoUrl)));
    const motionProblem = cfg.video.enabled && animatedWithVideo.length > 0 && (await assertSceneMoves(baked.videoPath, manifest, sceneAudio));
    if (motionProblem) warn(motionProblem);

    run.durationSeconds = finalDuration ?? run.durationSeconds;
    note(`verified: ${finalDuration?.toFixed(2)}s, audio stream: ${hasAudio}, mean volume: ${run.meanVolumeDb ?? 'n/a'} dB`);

    setStatus('done');
    return run;
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err);
    run.status = 'failed';
    note(`FAILED: ${run.error}`);
    save();
    throw err;
  } finally {
    if (server) {
      note(`asset server served ${server.requestCount()} request(s); ${server.missing().length} missing path(s)`);
      for (const missing of server.missing()) warn(`asset 404: ${missing}`);
      await server.close().catch(() => undefined);
      save();
    }
  }
}

/**
 * Proves an "animated" scene actually moves. A scene can carry a `videoUrl` and still render as a
 * still frame (a `<Sequence>` clipping, a filter stripping it), so compare two frames 1 s apart and
 * report the difference instead of trusting the manifest.
 */
async function assertSceneMoves(
  videoPath: string,
  manifest: StoryboardManifest,
  sceneAudio: SceneAudio[],
): Promise<string | null> {
  const animated = manifest.scenes.filter((s) => Boolean((s.layout?.elements || []).find((e: any) => e.videoUrl)));
  if (!animated.length) return null;

  const durations = sceneDurations(manifest, sceneAudio);
  const sceneNumber = animated[0].sceneNumber;
  const index = manifest.scenes.findIndex((s) => s.sceneNumber === sceneNumber);
  const start = durations.slice(0, index).reduce((a, b) => a + b, 0);
  const at = start + Math.min(1.5, durations[index] / 3);

  const tmpDir = path.join(path.dirname(videoPath), 'motion-check');
  fs.mkdirSync(tmpDir, { recursive: true });
  const a = path.join(tmpDir, 'a.png');
  const b = path.join(tmpDir, 'b.png');
  try {
    await exec('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', videoPath, '-frames:v', '1', '-y', a]);
    await exec('ffmpeg', ['-v', 'error', '-ss', String(at + 1), '-i', videoPath, '-frames:v', '1', '-y', b]);
    const psnr = await exec('ffmpeg', ['-v', 'error', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-']);
    const m = /average:(\d+(?:\.\d+)?|inf)/.exec(psnr);
    const avg = m ? Number(m[1]) : NaN;
    if (Number.isFinite(avg) && avg > 45) {
      return `scene ${sceneNumber} claims a video asset but frames 1s apart are identical (PSNR ${avg} dB) — the animation did not render`;
    }
    return null;
  } catch (err) {
    return `motion check could not run for scene ${sceneNumber}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── run access for the MCP layer ──────────────────────────────────────────────

export function readRun(runId: string, runsDir?: string): StorytellerRun | null {
  return readRunRecord<StorytellerRun>(path.resolve(runsDir ?? loadStorytellerConfig().paths.runsDir, runId));
}

export function listRuns(limit = 20, runsDir?: string): StorytellerRun[] {
  return listRunRecords<StorytellerRun>(path.resolve(runsDir ?? loadStorytellerConfig().paths.runsDir), limit);
}

export { makeRunId, randomUUID };

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): StorytellerRequest {
  const req: StorytellerRequest = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string | undefined => argv[++i];
    switch (arg) {
      case '--url': req.url = next(); break;
      case '--style': req.style = next(); break;
      case '--aspect': req.aspect = next() as keyof typeof FORMATS; break;
      case '--voice': req.voice = true; break;
      case '--no-voice': req.voice = false; break;
      case '--speed': req.speed = Number(next()); break;
      case '--research': req.research = true; break;
      case '--no-video': req.videoScenes = false; break;
      case '--video-max': req.videoMaxScenes = Number(next()); break;
      case '--regions': req.regionHighlights = true; break;
      case '--run-id': req.runId = next(); break;
      case '--until': req.until = next() as StorytellerStatus; break;
      case '--help': printUsage(); process.exit(0); break;
      default:
        if (arg.startsWith('http') && !req.url) req.url = arg;
        break;
    }
  }
  return req;
}

function printUsage(): void {
  console.log(`
Storyteller — URL → narrated explainer video (nano-banana-pro + Seedance), unattended.

  npm run storyteller -- --url <url> [options]

Options (all optional; defaults come from .env via src/lib/storytellerConfig.ts):
  --url <url|pdf>     Target. Defaults to STORYTELLER_DEFAULT_URL.
  --style <preset>    photo-realistic | illustration | flat-vector | infographic | whiteboard
  --aspect <ratio>    16:9 | 9:16 | 1:1
  --voice | --no-voice          Narration (ElevenLabs)
  --speed <n>         Narration speed (0.7–1.2)
  --research          Allow external research during storyboard planning
  --no-video          Skip Seedance animated scenes
  --video-max <n>     Cap animated scenes (cost guard)
  --regions           Run region detection (needs the :8001 backend)
  --run-id <id>       Reuse/continue a specific run id
  --until <stage>     Stop after a stage (ingesting|storyboarding|images|video|voice) — cheap verification
`);
}

if (require.main === module) {
  runStoryteller(parseArgs(process.argv.slice(2)))
    .then((run) => {
      console.log(`\n✅ ${run.runId}: ${run.videoPath}`);
      if (run.warnings.length) console.log(`⚠️  ${run.warnings.length} warning(s) — see runs/${run.runId}/run.json`);
    })
    .catch((err) => {
      console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
