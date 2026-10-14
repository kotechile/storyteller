/**
 * One promo scene. Every visual property is derived from useCurrentFrame() + interpolate() so the
 * render is reproducible frame-for-frame (no CSS transitions/animations — Remotion would flicker).
 *
 * Reading discipline from the brag creative laws: text enters FAST (0.3-0.6s), then HOLDS fully
 * visible for its reading floor. The reveals were computed in src/lib/bragStoryboard.ts and arrive
 * here as `scene.lines[].delayFrames` so the manifest preview and this renderer never disagree.
 */
import React from 'react';
import { Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { BragRenderMeta, BragSceneMeta } from '../../lib/bragStoryboard';
import { bragLayoutFor } from '../../lib/bragStoryboard';
import type { TransitionMood } from '../../types/brag';

export interface BragSceneViewProps {
  scene: BragSceneMeta;
  brag: BragRenderMeta;
  index: number;
  total: number;
  /** Exact frame length of this scene's <Sequence>. */
  durationInFrames: number;
  /** The outgoing mood of the PREVIOUS scene, which governs how this one enters. */
  incomingMood: TransitionMood;
  /**
   * ALREADY-RESOLVED visual URL (absolute http(s) or data:). Must be resolved by the caller against
   * the assets base URL — passing the raw public-relative path here makes the browser resolve it
   * against Remotion's own render server (localhost:3000), which 404s. That mistake cost a full
   * debugging cycle; keep the resolution in one place (BragPromo.resolveSrc).
   */
  visualSrc?: string;
}

/** How long the scene-level fade runs, by transition mood. `hard`/`chaotic` deliberately cut. */
const FADE_FRAMES: Record<TransitionMood, number> = {
  clean: 8,
  soft: 16,
  dramatic: 12,
  hard: 0,
  chaotic: 0,
};

export const BragSceneView: React.FC<BragSceneViewProps> = ({
  scene,
  brag,
  index,
  total,
  durationInFrames,
  incomingMood,
  visualSrc,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const layout = bragLayoutFor(brag.format);

  const isHook = index === 0;
  const isOutro = index === total - 1;

  // ── scene-level entrance/exit ──────────────────────────────────────────────
  const inFrames = Math.min(FADE_FRAMES[incomingMood], Math.floor(durationInFrames / 3));
  const outFrames = Math.min(FADE_FRAMES[scene.transitionMood], Math.floor(durationInFrames / 3));

  const sceneOpacity = Math.min(
    inFrames > 0 ? interpolate(frame, [0, inFrames], [0, 1], { extrapolateRight: 'clamp' }) : 1,
    outFrames > 0
      ? interpolate(frame, [durationInFrames - outFrames, durationInFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1,
  );

  const dramaticScale =
    incomingMood === 'dramatic'
      ? interpolate(frame, [0, Math.max(1, inFrames)], [0.96, 1], { extrapolateRight: 'clamp' })
      : 1;

  // Background glow breathes in with the scene, using the accent — never a flat colour wash.
  // Kept low: it should read as atmosphere, not as a visible blob behind the text.
  const glow = interpolate(frame, [0, Math.max(1, Math.round(durationInFrames * 0.4))], [0, 0.15], {
    extrapolateRight: 'clamp',
  });

  // ── pct → px helpers ───────────────────────────────────────────────────────
  const pxX = (pct: number): number => (width * pct) / 100;
  const pxY = (pct: number): number => (height * pct) / 100;

  const headlineSize = Math.max(26, Math.round(width * (isHook ? 0.093 : isOutro ? 0.082 : 0.07)));
  const bodySize = Math.max(22, Math.round(width * 0.04));
  const captionSize = Math.max(18, Math.round(width * 0.019));

  const visualEnter = interpolate(frame, [0, Math.max(1, inFrames + 6)], [0, 1], { extrapolateRight: 'clamp' });

  const hasVisual = Boolean(visualSrc);
  const align = brag.format === 'landscape' ? 'flex-start' : 'center';

  /**
   * Layout: when the scene HAS a visual, the text sits in the lower band beneath it. When it does
   * not (a typographic scene), reserving that band leaves ~60% of a vertical frame empty — so the
   * text block becomes full-height and centres instead. Same numbers, no dead space.
   */
  const textBlockStyle: React.CSSProperties = hasVisual
    ? { position: 'absolute', left: pxX(layout.textLeft), top: pxY(layout.textTop), width: pxX(layout.textWidth) }
    : {
        position: 'absolute',
        left: pxX(layout.textLeft),
        top: 0,
        width: pxX(layout.textWidth),
        height: '100%',
        justifyContent: 'center',
      };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: sceneOpacity,
        transform: `scale(${dramaticScale})`,
        fontFamily: brag.fonts.display,
      }}
    >
      {/* accent glow — the palette's personality, kept low so it never fights the text */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 42%, ${brag.palette.accent} 0%, transparent 68%)`,
          opacity: glow,
        }}
      />

      {/* ── the visual: real UI, a source image, or nothing (pure typography) ── */}
      {visualSrc && (
        <div
          style={{
            position: 'absolute',
            left: pxX(layout.visual.x),
            top: pxY(layout.visual.y),
            width: pxX(layout.visual.width),
            height: pxY(layout.visual.height),
            opacity: visualEnter,
            transform: `scale(${0.97 + 0.03 * visualEnter})`,
            borderRadius: Math.round(width * 0.014),
            overflow: 'hidden',
            // A framed panel means a slow/failed remote image reads as an empty frame, never a void.
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${brag.palette.accent}33`,
            boxShadow: `0 ${Math.round(height * 0.008)}px ${Math.round(height * 0.03)}px rgba(0,0,0,0.45)`,
          }}
        >
          {/* objectFit: contain — cropping the UI would defeat "show the thing" */}
          <Img
            src={visualSrc}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      )}

      {/* ── text block ── */}
      <div
        style={{
          ...textBlockStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: align,
          textAlign: brag.format === 'landscape' ? 'left' : 'center',
        }}
      >
        {scene.isConceptScene && (
          <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(width * 0.014), marginBottom: Math.round(height * 0.012) }}>
            <div
              style={{
                width: pxX(6) * (isHook ? 1 : 1),
                height: Math.max(3, Math.round(height * 0.0035)),
                background: brag.palette.accent,
                transformOrigin: 'left center',
                transform: `scaleX(${interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })})`,
              }}
            />
            <div
              style={{
                fontSize: captionSize,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: brag.palette.accent,
                fontWeight: 600,
                opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' }),
              }}
            >
              Key concept
            </div>
          </div>
        )}

        {scene.lines.map((line, lineIndex) => {
          const progress = interpolate(
            frame,
            [line.delayFrames, line.delayFrames + line.enterFrames],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );

          // Entrance motion by tone: slide / scale / slam / plain fade.
          const enter = brag.typography.enterSeconds;
          const isSlide = enter <= 0.5;
          const translateY = isSlide ? (1 - progress) * Math.round(height * 0.018) : 0;
          const scale =
            brag.tone === 'chaotic' || brag.tone === 'cinematic'
              ? 0.9 + 0.1 * progress
              : 1;

          const isHeadline = lineIndex === 0;
          const size = isHeadline ? headlineSize : bodySize;
          const emphasisesName = isOutro && (line.text.includes(brag.appName) || isHeadline);

          return (
            <div
              key={`line_${lineIndex}`}
              style={{
                // Fast-in, then hold: only the entrance interpolates; the rest of the interval is
                // fully opaque, which is what keeps text readable at speed.
                opacity: progress,
                transform: `translateY(${translateY}px) scale(${scale})`,
                fontSize: size,
                fontWeight: isHeadline ? brag.typography.weight : Math.max(400, brag.typography.weight - 200),
                lineHeight: isHeadline ? 1.08 : 1.3,
                letterSpacing: brag.typography.letterSpacing,
                textTransform: brag.typography.textTransform,
                color: emphasisesName ? brag.palette.accent : brag.palette.text,
                textShadow: '0 2px 24px rgba(0,0,0,0.55)',
                marginTop: lineIndex === 0 ? 0 : Math.round(height * 0.006),
                maxWidth: '100%',
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>

      {/*
        `scene.interaction` describes a simulated gesture (a cursor click, a swipe). It currently
        drives sound design (see src/lib/bragSfx.ts) and is preserved in the props for a future
        cursor layer — it is deliberately NOT printed on screen, because narrating a click in a
        20-second promo reads as filler.
      */}
    </div>
  );
};
