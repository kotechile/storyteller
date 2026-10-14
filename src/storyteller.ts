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
import { getOrGenerateConceptImage, isUsableImageRef, normalizeImageRef, resolveManifestImageAssets } from './lib/assetCatalogManager';
import { synthesizePerSceneSpeech } from './lib/elevenlabsTts';
import { isGroundingDinoAvailable } from './lib/groundingDinoClient';
import { generateRegionFocusEvents } from './lib/regionSync';
import { startPublicServer, type PublicServer } from './lib/assetServer';
import { localizeManifestImages } from './lib/localizeImages';
import {
  assertRenderablePayload,
  buildRenderPayload,
  renderExplainer,
  expectedFrameCount,
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
  readJson,
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
  stability?: number;
  similarityBoost?: number;
  research?: boolean;
  focusTopics?: string[];
  videoScenes?: boolean;
  videoMaxScenes?: number;
  regionHighlights?: boolean;
  musicTrackId?: string;
  runId?: string;
  /** Stop AFTER this stage and return a partial run — lets plumbing be verified without paying for later stages. */
  until?: StorytellerStatus;
  /**
   * Reuse the artifacts already written to runs/<runId>/ (article, storyboard, images, video,
   * narration) and redo only localization + render + poster. A long run WILL get interrupted
   * (a 6-minute video renders for tens of minutes); re-paying for images and a Seedance queue
   * because a render was killed is not acceptable.
   */
  resume?: boolean;
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
      stability: req.stability ?? cfg.voice.stability,
      similarityBoost: req.similarityBoost ?? cfg.voice.similarityBoost,
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

/**
 * Manifest to resume from: strategies/layout come from the PRE-video artifact, video assets are
 * grafted on from the POST-video one. The post-video artifact is a mutated copy — the cost cap may
 * have rewritten scene strategies in it — so resuming from it directly can resurrect a scene the cap
 * made unrenderable.
 */
function loadResumeManifest(runDir: string): StoryboardManifest | null {
  const images =
    readJson<StoryboardManifest>(path.join(runDir, 'storyboard.images.json')) ??
    readJson<StoryboardManifest>(path.join(runDir, 'storyboard.json'));
  const video = readJson<StoryboardManifest>(path.join(runDir, 'storyboard.video.json'));
  if (!images && !video) return null;
  if (!images || !video) return (images ?? video)!;

  for (const scene of images.scenes) {
    const v = video.scenes.find((s) => s.sceneNumber === scene.sceneNumber) as any;
    if (!v) continue;
    for (const el of ((scene.layout?.elements || []) as any[])) {
      const ve = ((v.layout?.elements || []) as any[]).find((e) => e.id === el.id);
      if (ve?.videoUrl) el.videoUrl = ve.videoUrl;
      if (ve?.sourceAssetId && !el.sourceAssetId) el.sourceAssetId = ve.sourceAssetId;
    }
  }
  return images;
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

function hasImageElement(scene: any): boolean {
  return (scene.layout?.elements || []).some((e: any) => e.type === 'image' && isUsableImageRef(e.sourceAssetId));
}

function hasVideoElement(scene: any): boolean {
  return (scene.layout?.elements || []).some((e: any) => Boolean(e.videoUrl));
}

/**
 * Enforces the Seedance cost cap — but ONLY by demoting `image_to_video` scenes.
 *
 * Measured trap: demoting a `text_to_video` scene to `static` leaves the scene with NO visual at all,
 * because those scenes deliberately carry no image element (the video *is* the visual). The result is
 * an unrenderable scene that fails the image gate. So a `text_to_video` scene is left animated and the
 * cap is reported as best-effort — the alternative silently drops a scene's visual.
 */
function capAnimatedScenes(manifest: StoryboardManifest, maxScenes: number, note: (m: string) => void): StoryboardManifest {
  if (maxScenes <= 0) return manifest;

  const i2v = manifest.scenes.filter((s) => (s as any).animationStrategy === 'image_to_video');
  const t2v = manifest.scenes.filter((s) => (s as any).animationStrategy === 'text_to_video');
  if (i2v.length + t2v.length <= maxScenes) return manifest;

  // text_to_video scenes are not demotable, so they claim the budget first (in scene order).
  const budget = Math.max(0, maxScenes - t2v.length);
  const keep = new Set(i2v.slice(0, budget).map((s) => s.sceneNumber));
  const demoted: number[] = [];
  for (const scene of i2v) {
    if (!keep.has(scene.sceneNumber)) {
      (scene as any).animationStrategy = 'static'; // keeps its still image — always renderable
      demoted.push(scene.sceneNumber);
    }
  }
  if (demoted.length) note(`video cap ${maxScenes}: demoted image_to_video scene(s) ${demoted.join(', ')} to static (they keep their still image)`);
  if (t2v.length > maxScenes) {
    note(`video cap ${maxScenes}: ${t2v.length} text_to_video scene(s) cannot be demoted without generating images they don't have — cap exceeded, kept animated`);
  }
  return manifest;
}

/**
 * Gives every scene a visual before rendering. A scene with neither an image nor a video renders as a
 * blank frame — the failure this whole pipeline is built to avoid. Two cases:
 *  - a demoted/static scene with no still → generate one (cheap: nano-banana-pro, not Seedance);
 *  - a `text_to_video` scene with no video and no plan to generate one (e.g. resumed run) → demote to
 *    static and generate a still, recorded as a correction.
 */
async function fillMissingVisuals(
  manifest: StoryboardManifest,
  style: ImageStylePreset,
  opts: { willAnimateVideos: boolean },
  note: (m: string) => void,
  corrections: string[],
): Promise<StoryboardManifest> {
  for (const scene of manifest.scenes) {
    if (hasImageElement(scene) || hasVideoElement(scene)) continue;

    const strategy = (scene as any).animationStrategy;
    if (strategy === 'text_to_video' && opts.willAnimateVideos) continue; // the video will fill this

    const imageEl = ((scene.layout?.elements || []) as any[]).find((e) => e.type === 'image');
    const el =
      imageEl ||
      ({
        id: `static_fill_${scene.sceneNumber}`,
        type: 'image',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 1,
        imageDescription: scene.narration || 'Explanatory diagram',
      } as any);
    if (!imageEl) {
      scene.layout = scene.layout || ({ background: { type: 'solid', value: '#ffffff' }, elements: [] } as any);
      (scene.layout.elements as any[]).unshift(el);
    }

    const conceptName = el.id || `scene_${scene.sceneNumber}`;
    note(`scene ${scene.sceneNumber}: no visual (strategy was "${strategy}") — generating a still so the scene is not blank`);
    const result = await getOrGenerateConceptImage(
      conceptName,
      el.imageDescription || scene.narration || 'technical diagram infographic',
      style,
      false,
    );
    // normalizeImageRef: the catalog hands back 'generated_assets/x.png'; the renderer needs a
    // root-relative (then asset-server-absolute) reference.
    el.sourceAssetId = normalizeImageRef(result.imageUrl);
    if (strategy === 'text_to_video') {
      (scene as any).animationStrategy = 'static';
      corrections.push(`scene ${scene.sceneNumber}: text_to_video → static (no video generated on this run; a still was generated instead)`);
    }
  }
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
    if (run.status !== 'failed') run.error = undefined; // a new attempt must not inherit the previous failure
    writeJson(path.join(runDir, 'run.json'), run);
    onProgress?.(run);
  };
  const NOTE_LOG_CAP = 400;
  const note = (msg: string): void => {
    run.log.push(`${new Date().toISOString()} ${msg}`);
    if (run.log.length > NOTE_LOG_CAP) run.log.splice(0, run.log.length - NOTE_LOG_CAP);
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

  // ── resume: reuse whatever the previous attempt already paid for ──────────────
  const resumed = {
    article: req.resume ? readJson<ArticleData>(path.join(runDir, 'article.json')) : null,
    manifest: req.resume ? loadResumeManifest(runDir) : null,
    sceneAudio: (req.resume ? readJson<SceneAudio[]>(path.join(runDir, 'scene_audio.json')) : null) ?? [],
  };
  if (req.resume) {
    note(
      resumed.manifest
        ? `resume: reusing storyboard (${resumed.manifest.scenes.length} scenes)${resumed.sceneAudio.length ? ` + ${resumed.sceneAudio.length} narration track(s)` : ''} — paid stages will not run again`
        : 'resume: no usable storyboard artifact found — running the full pipeline',
    );
  }

  let server: PublicServer | null = null;

  try {
    note(`run ${runId} — url=${url} style=${cfg.style} aspect=${cfg.aspect} voice=${cfg.voice.enabled}`);
    save();

    // ── 1. ingest ──────────────────────────────────────────────────────────────
    setStatus('ingesting');
    const isPdf = url.toLowerCase().endsWith('.pdf');
    const article: ArticleData = resumed.article ?? (isPdf ? await ingestPdf(url) : await ingestUrl(url));
    run.title = article.title;
    note(`ingested "${article.title}" (${article.wordCount} words, ${article.assets.length} article image asset(s))${resumed.article ? ' [reused]' : ''}`);
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
    if (resumed.manifest) {
      storyboardResult = { manifest: resumed.manifest, context: undefined, usedFallback: false } as any;
    } else {
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
    const unresolvedBefore = resumed.manifest ? 0 : countUnresolvedImages(manifest);
    if (resumed.manifest) {
      note('images: reused from the resumed storyboard artifact');
    } else if (unresolvedBefore > 0) {
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
    if (cfg.video.enabled && resumed.manifest) {
      run.animatedScenes = manifest.scenes.filter((s) => Boolean((s.layout?.elements || []).find((e: any) => e.videoUrl))).length;
      note(`video: reused from the resumed artifact (${run.animatedScenes} animated scene(s))`);
    } else if (cfg.video.enabled) {
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
    // Last line of defence before rendering: no scene may be visual-less.
    manifest = await fillMissingVisuals(manifest, cfg.style as unknown as ImageStylePreset, { willAnimateVideos: false }, note, run.corrections);
    if (stopAfter('video')) return run;

    // ── 5. narration ──────────────────────────────────────────────────────────
    let sceneAudio: SceneAudio[] = resumed.sceneAudio;
    if (cfg.voice.enabled && sceneAudio.length > 0) {
      note(`voice: reused ${sceneAudio.length} narration track(s) from the resumed artifact`);
      // The artifact holds the pre-fit durations (it was written before narration), so re-apply the
      // fit here to keep the manifest and the rendered props consistent.
      manifest = fitScenesToAudio(manifest, sceneAudio, note, run.corrections);
    } else if (cfg.voice.enabled) {
      setStatus('voice');
      sceneAudio = await synthesizePerSceneSpeech(
        manifest.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
        {
          voiceId: cfg.voice.voiceId,
          speed: cfg.voice.speed,
          modelId: cfg.voice.modelId,
          stability: cfg.voice.stability,
          similarityBoost: cfg.voice.similarityBoost,
        },
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

    // kie.ai caps a generated clip at 15s. A scene whose narration runs longer therefore shows the
    // clip's LAST FRAME for the remainder (measured: a 15s clip inside a 75s scene → ~60s of freeze,
    // which reads as a still image). The provider cap cannot be papered over here, so it is recorded:
    // either the narration is shortened or the clip is tiled in the renderer (OffthreadVideo has no
    // `loop` prop), and both are deliberate choices, not silent behaviour.
    const CLIP_CAP_SECONDS = 15;
    for (const scene of manifest.scenes) {
      const hasVideo = ((scene.layout?.elements || []) as any[]).some((e) => Boolean(e.videoUrl));
      if (!hasVideo) continue;
      const narration = sceneAudio.find((sa) => sa.sceneNumber === scene.sceneNumber)?.durationSeconds
        ?? Number(scene.duration)
        ?? 0;
      if (narration > CLIP_CAP_SECONDS + 1) {
        warn(
          `scene ${scene.sceneNumber}: animated clip is capped at ${CLIP_CAP_SECONDS}s by the provider but the scene runs ${narration.toFixed(1)}s — ` +
            `the clip's last frame holds for ~${(narration - CLIP_CAP_SECONDS).toFixed(0)}s`,
        );
      }
    }

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
    const propsPath = path.join(runDir, 'storyboard_props.json');
    let lastRenderHeartbeat = 0;

    // An interrupted run is common here: a 6-minute video renders for minutes and the process can be
    // killed. Re-rendering it to redo a poster would be wasteful, so reuse a render that is at least
    // as new as the props it was made from — and say so, loudly.
    let reusedRender = false;
    if (req.resume && fs.existsSync(videoPath)) {
      const videoMtime = fs.statSync(videoPath).mtimeMs;
      const propsMtime = fs.existsSync(propsPath) ? fs.statSync(propsPath).mtimeMs : 0;
      const expected = expectedFrameCount(payload) / (payload.fps || 30);
      const actual = await probeDurationSeconds(videoPath);
      // The composition adds a title card ON TOP of the narration, so a healthy render is a little
      // LONGER than the summed scene audio (measured: 367.5s of narration → 373.95s). The original
      // ±5s window rejected that real render and sent it down a destructive re-render path.
      const shapeOk = actual !== null && actual >= expected - 1 && actual <= expected + 30;
      if (videoMtime >= propsMtime && shapeOk) {
        reusedRender = true;
        note(`resume: reusing the existing render (${actual?.toFixed(2)}s) — poster + verification still run`);
        warn(`reused a pre-existing render for this run; delete runs/${runId}/final.mp4 to force a re-render`);
        run.videoPath = videoPath;
        run.durationSeconds = actual ?? undefined;
      } else {
        note(`resume: existing render rejected (duration ${actual?.toFixed(2)}s vs expected ~${expected.toFixed(2)}s, mtime ${videoMtime >= propsMtime ? 'ok' : 'older than props'}) — re-rendering`);
      }
    }

    const result = reusedRender
      ? { videoPath, propsPath, logPath: path.join(runDir, 'render.log'), durationSeconds: run.durationSeconds ?? null }
      : await renderExplainer(payload, {
          videoPath,
          propsPath,
          logPath: path.join(runDir, 'render.log'),
          onProgress: (line) => {
            const m = /rendering (\d+)\/(\d+)/.exec(line);
            if (!m) return;
            const pct = Number(m[1]) / Number(m[2]);
            // Throttled: saving on every frame grew run.json to 1.1 MB (11k log lines). A 5% cadence
            // still leaves a fresh timestamp, which is what makes an interrupted render detectable.
            if (pct - lastRenderHeartbeat >= 0.05) {
              lastRenderHeartbeat = pct;
              note(line);
              save();
            }
          },
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
    // NOTE: no `-v error` here. ffmpeg prints the PSNR summary at INFO level on stderr, so suppressing
    // it made this check a silent no-op that could never flag a static "animated" scene.
    const psnr = await exec('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { combined: true });
    const m = /average:(\d+(?:\.\d+)?|inf)/.exec(psnr);
    if (!m) return `motion check could not read a PSNR for scene ${sceneNumber}`;
    const avg = Number(m[1]);
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
      case '--stability': req.stability = Number(next()); break;
      case '--similarity': req.similarityBoost = Number(next()); break;
      case '--research': req.research = true; break;
      case '--no-video': req.videoScenes = false; break;
      case '--video-max': req.videoMaxScenes = Number(next()); break;
      case '--regions': req.regionHighlights = true; break;
      case '--run-id': req.runId = next(); break;
      case '--until': req.until = next() as StorytellerStatus; break;
      case '--resume': req.resume = true; break;
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
  --stability <n>     ElevenLabs voice stability 0–1 (default 0.5)
  --similarity <n>    ElevenLabs similarity boost 0–1 (default 0.75)
  --research          Allow external research during storyboard planning
  --no-video          Skip Seedance animated scenes
  --video-max <n>     Cap animated scenes (cost guard)
  --regions           Run region detection (needs the :8001 backend)
  --run-id <id>       Reuse/continue a specific run id
  --until <stage>     Stop after a stage (ingesting|storyboarding|images|video|voice) — cheap verification
  --resume            Reuse runs/<run-id>/ artifacts and redo only localize+render+poster
                      (with --run-id: finish an interrupted run without re-paying for images/video)
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
