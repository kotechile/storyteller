/**
 * bragStoryboard — compiles a BragPlan into the repo's existing StoryboardManifest, plus the
 * brag-specific render metadata the BragPromo composition needs.
 *
 * Why two outputs instead of stuffing everything into the manifest:
 *   `storyboardManifestSchema` (src/types/storyboard.ts:436) pins `meta.stylePreset` to a closed
 *   enum and `meta` to a fixed shape. Extending it would change the contract the *existing*
 *   explainer renderer validates against — an unacceptable risk for an additive feature. So the
 *   manifest carries what the shared timing/audio machinery needs (durations, narration, elements,
 *   sync hints) and `brag` carries the promo's own semantics (palette, tone, text reveals).
 *
 * Reveal timing is computed ONCE, here, and written into both outputs, so the manifest preview and
 * the BragPromo renderer can never disagree about when a line lands.
 */
import type { BragPlan, BragScene, BragTone, TransitionMood, VisualSource } from '../types/brag';
import { requiredReadSeconds } from '../types/brag';
import type { CanvasElement, StoryboardManifest, StoryboardScene, StoryStylePreset, SyncHint } from '../types/storyboard';
import { TONE_PRESETS } from './tonePresets';
import { FORMATS, type FormatName } from './runtimeConfig';
import type { CaptureRef } from './bragPlanner';

export interface BragLineReveal {
  text: string;
  /** Frames from the start of the scene at which this line begins entering. */
  delayFrames: number;
  /** Frames the entrance animation runs for. */
  enterFrames: number;
  /** Frames the line sits fully visible after entering — the reading hold. */
  holdFrames: number;
}

export interface BragSceneMeta {
  /** 1-based, matching the manifest's sceneNumber. */
  sceneNumber: number;
  name: string;
  seconds: number;
  onScreen: string;
  lines: BragLineReveal[];
  visualSource: VisualSource;
  /** Resolved src the renderer can load (URL, staticFile path, or file path). */
  visualSrc?: string;
  visualLabel?: string;
  sequential?: string | null;
  interaction?: string | null;
  sfxMoment?: string | null;
  transitionMood: TransitionMood;
  isConceptScene: boolean;
}

export interface BragRenderMeta {
  appName: string;
  tone: BragTone;
  palette: { background: string; accent: string; text: string };
  fonts: { display: string; body: string };
  typography: { weight: number; letterSpacing: string; textTransform: 'none' | 'uppercase'; enterSeconds: number };
  /** The two lines the composition treats as the signature beats. */
  hookText: string;
  outroText: string;
  shareCopy: string;
  keyConcepts: string[];
  angle: string;
  format: FormatName;
  width: number;
  height: number;
  captions: boolean;
  scenes: BragSceneMeta[];
}

export interface BragCompileOptions {
  format: FormatName;
  fps?: number;
  captions?: boolean;
  /** 0-based brag scene index → resolved visual src (the orchestrator resolves assets/captures). */
  visualSources?: Record<number, string>;
  /** Human labels for resolved visuals, for debugging/manifest readability. */
  visualLabels?: Record<number, string>;
  /** Overrides the palette (e.g. from site identity) when the plan's colours are unusable. */
  palette?: { background?: string; accent?: string; text?: string };
  /** meta.stylePreset for the shared schema; must come from its enum. */
  stylePreset?: StoryStylePreset;
}

export interface BragCompileResult {
  manifest: StoryboardManifest;
  brag: BragRenderMeta;
  warnings: string[];
}

/** Colour sanity: a plan can return "none" or an empty string and we must not paint with it. */
const isUsableColor = (v: string | undefined): v is string => !!v && v.trim().length > 0 && /^(#|rgb|hsl|oklch|[a-z]+)/i.test(v.trim());

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BragLayout {
  visual: Box;
  textTop: number;
  textLeft: number;
  textWidth: number;
  textHeight: number;
}

/**
 * Percentage-box layout, exported so the compiler and the BragPromo renderer cannot disagree about
 * where things sit. Values are 0-100% of the canvas (see CanvasElement), so one set works in any
 * aspect ratio.
 */
export function bragLayoutFor(format: FormatName): BragLayout {
  if (format === 'vertical') {
    return { visual: { x: 7, y: 20, width: 86, height: 36 }, textTop: 63, textLeft: 8, textWidth: 84, textHeight: 26 };
  }
  if (format === 'square') {
    return { visual: { x: 12, y: 14, width: 76, height: 36 }, textTop: 56, textLeft: 10, textWidth: 80, textHeight: 30 };
  }
  // landscape
  return { visual: { x: 52, y: 12, width: 42, height: 74 }, textTop: 30, textLeft: 6, textWidth: 42, textHeight: 44 };
}

/** @deprecated internal alias kept for readability at call sites */
const layoutFor = bragLayoutFor;

/**
 * Computes the reveal schedule for a scene's lines.
 *
 * Lines that appear together share a start (staggered by a few frames for polish). Lines that appear
 * one-by-one (the plan's `sequential`/`revealHoldSeconds`) each wait for the previous line's reading
 * time, which is what keeps a fast beat grid from making text unreadable.
 */
export function computeLineReveals(scene: BragScene, tone: BragTone, fps: number): BragLineReveal[] {
  const preset = TONE_PRESETS[tone];
  const enterFrames = Math.max(1, Math.round(preset.enterSeconds * fps));
  const sequential = Boolean(scene.sequential) || typeof scene.revealHoldSeconds === 'number';

  let cursor = Math.round(enterFrames * 0.5);
  return scene.text.map((text, i) => {
    const holdFrames = Math.round(requiredReadSeconds(text) * preset.holdBias * fps);
    const reveal: BragLineReveal = { text, delayFrames: cursor, enterFrames, holdFrames };
    // Next line: either straight after this one's entrance (simultaneous) or after it has been read.
    cursor += sequential ? holdFrames : Math.round(fps * 0.15) + (i === 0 ? 0 : 0);
    return reveal;
  });
}

/** True when this scene is one of the ones teaching the plan's key concepts. */
function isConceptScene(scene: BragScene, keyConcepts: string[]): boolean {
  const words = keyConcepts.flatMap((c) => c.toLowerCase().split(/\s+/)).filter((w) => w.length > 4);
  const haystack = [...scene.text, scene.name, scene.onScreen].join(' ').toLowerCase();
  return words.some((w) => haystack.includes(w));
}

export function bragPlanToStoryboard(plan: BragPlan, opts: BragCompileOptions): BragCompileResult {
  const fps = opts.fps ?? 30;
  const format = opts.format;
  const size = FORMATS[format];
  const warnings: string[] = [];
  const visualSources = opts.visualSources ?? {};
  const box = layoutFor(format);

  const background = isUsableColor(opts.palette?.background) ? opts.palette!.background! : plan.visualIdentity.background;
  const accent = isUsableColor(opts.palette?.accent) ? opts.palette!.accent! : plan.visualIdentity.accent;
  const text = isUsableColor(opts.palette?.text) ? opts.palette!.text! : plan.visualIdentity.text;

  if (!isUsableColor(plan.visualIdentity.background) && !isUsableColor(opts.palette?.background)) {
    warnings.push(`Plan returned an unusable background colour ("${plan.visualIdentity.background}"); using the neutral default.`);
  }

  const scenes: StoryboardScene[] = [];
  const sceneMetas: BragSceneMeta[] = [];

  plan.storyboard.forEach((scene, index) => {
    const sceneNumber = index + 1;
    const tone = plan.tone.preset;
    const preset = TONE_PRESETS[tone];
    const reveals = computeLineReveals(scene, tone, fps);

    const visualSrc = visualSources[index];
    if (!visualSrc && (scene.visualSource === 'screenshot' || scene.visualSource === 'article_asset')) {
      warnings.push(
        `Scene ${sceneNumber} ("${scene.name}") wanted a ${scene.visualSource} visual but nothing was resolved for it — ` +
          'the composition will fall back to typography for this scene.',
      );
    }

    const elements: CanvasElement[] = [];
    let zIndex = 10;

    if (visualSrc) {
      elements.push({
        id: `sc${sceneNumber}_visual`,
        type: 'image',
        sourceAssetId: visualSrc,
        content: scene.name,
        revealSyncPhrase: reveals[0]?.text ?? scene.name,
        x: box.visual.x,
        y: box.visual.y,
        width: box.visual.width,
        height: box.visual.height,
        zIndex: 1,
        enterAnimation: {
          type: preset.textEnter === 'slam' ? 'zoom_in' : preset.textEnter === 'scale' ? 'scale_in' : 'fade_in',
          duration: Math.max(8, Math.round(preset.enterSeconds * fps)),
          delay: 0,
        },
      });
    }

    const lineHeight = scene.text.length > 0 ? Math.min(box.textHeight / scene.text.length, 8) : 0;
    reveals.forEach((reveal, lineIndex) => {
      elements.push({
        id: `sc${sceneNumber}_text_${lineIndex}`,
        type: 'text',
        content: reveal.text,
        revealSyncPhrase: reveal.text,
        x: box.textLeft,
        y: box.textTop + lineIndex * lineHeight,
        width: box.textWidth,
        height: lineHeight || 8,
        zIndex: zIndex++,
        enterAnimation: {
          type: preset.textEnter === 'slide' ? 'slide_up' : preset.textEnter === 'slam' ? 'scale_in' : 'fade_in',
          duration: reveal.enterFrames,
          delay: reveal.delayFrames,
          sequencing: scene.sequential ? 'staggered' : 'immediate',
        },
      });
    });

    const syncHints: SyncHint[] = reveals.map((reveal, lineIndex) => ({
      text: reveal.text,
      triggerAction: 'reveal',
      targetElementId: `sc${sceneNumber}_text_${lineIndex}`,
    }));

    scenes.push({
      sceneNumber,
      // Narration is only consumed when OMNICAST_VOICE=1; the plan's on-screen lines are the
      // closest thing it has to a spoken script, so use them rather than inventing copy here.
      narration: scene.text.length > 0 ? scene.text.join(' ') : scene.onScreen,
      duration: scene.seconds,
      layout: {
        background: { type: 'solid', value: background },
        clearCanvas: true,
        canvasMode: 'clear_canvas',
        elements,
      },
      syncHints,
    });

    sceneMetas.push({
      sceneNumber,
      name: scene.name,
      seconds: scene.seconds,
      onScreen: scene.onScreen,
      lines: reveals,
      visualSource: scene.visualSource,
      visualSrc,
      visualLabel: opts.visualLabels?.[index] ?? scene.visualRef ?? undefined,
      sequential: scene.sequential ?? null,
      interaction: scene.interaction ?? null,
      sfxMoment: scene.sfxMoment ?? null,
      transitionMood: scene.transitionMood,
      isConceptScene: isConceptScene(scene, plan.keyConcepts),
    });
  });

  const manifest: StoryboardManifest = {
    meta: {
      title: plan.appName,
      targetDuration: plan.durationSeconds,
      stylePreset: opts.stylePreset ?? 'cinematic',
      primaryColor: accent,
      fontFamily: plan.visualIdentity.displayFont,
    },
    scenes,
  };

  const brag: BragRenderMeta = {
    appName: plan.appName,
    tone: plan.tone.preset,
    palette: { background, accent, text },
    fonts: { display: plan.visualIdentity.displayFont, body: plan.visualIdentity.bodyFont },
    typography: {
      weight: TONE_PRESETS[plan.tone.preset].weight,
      letterSpacing: TONE_PRESETS[plan.tone.preset].letterSpacing,
      textTransform: TONE_PRESETS[plan.tone.preset].textTransform,
      enterSeconds: TONE_PRESETS[plan.tone.preset].enterSeconds,
    },
    hookText: plan.hook,
    outroText: plan.outro,
    shareCopy: plan.shareCopy,
    keyConcepts: plan.keyConcepts,
    angle: plan.angle,
    format,
    width: size.width,
    height: size.height,
    captions: opts.captions ?? false,
    scenes: sceneMetas,
  };

  return { manifest, brag, warnings };
}

/** Convenience: total seconds implied by the compiled manifest (used for metadata assertions). */
export function manifestDurationSeconds(manifest: StoryboardManifest): number {
  return manifest.scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

/** Builds the visual-source map from capture refs, so callers don't hand-roll the index math. */
export function capturesToVisualSources(
  plan: BragPlan,
  captures: CaptureRef[],
  publicPrefix: string,
): { sources: Record<number, string>; labels: Record<number, string>; warnings: string[] } {
  const byId = new Map(captures.map((c) => [c.id, c]));
  const sources: Record<number, string> = {};
  const labels: Record<number, string> = {};
  const warnings: string[] = [];

  plan.storyboard.forEach((scene, index) => {
    if (scene.visualSource !== 'screenshot') return;
    const capture = scene.visualRef ? byId.get(scene.visualRef) : undefined;
    if (!capture) {
      warnings.push(
        `Scene ${index + 1} referenced screenshot "${scene.visualRef ?? '(none)'}" which was not captured.`,
      );
      return;
    }
    sources[index] = `${publicPrefix}${capture.file.replace(/^.*[\\/]/, '')}`;
    labels[index] = capture.label;
  });

  return { sources, labels, warnings };
}

/** Maps article assets (remote URLs) onto their scenes — the `article_asset` path. */
export function articleAssetsToVisualSources(
  plan: BragPlan,
  assets: { id: string; url: string; altText?: string }[],
): { sources: Record<number, string>; labels: Record<number, string>; warnings: string[] } {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const byUrl = new Map(assets.map((a) => [a.url, a]));
  const sources: Record<number, string> = {};
  const labels: Record<number, string> = {};
  const warnings: string[] = [];

  plan.storyboard.forEach((scene, index) => {
    if (scene.visualSource !== 'article_asset') return;
    const ref = scene.visualRef ?? '';
    const asset = byId.get(ref) ?? byUrl.get(ref);
    if (!asset) {
      warnings.push(`Scene ${index + 1} referenced source image "${ref || '(none)'}" which was not found in the ingested assets.`);
      return;
    }
    sources[index] = asset.url;
    labels[index] = asset.altText ?? asset.id;
  });

  return { sources, labels, warnings };
}
