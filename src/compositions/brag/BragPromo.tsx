/**
 * BragPromo — the vertical (or landscape/square) promo composition.
 *
 * Deliberately separate from ExplainerStoryComposition: the explainer renders a SceneCanvas-driven
 * slide deck for a long-form narration, while a promo is a 15-25s beat-driven piece where the text
 * IS the design. Sharing the composition would mean bending one to fit the other.
 *
 * What it does share: the timing engine (alignStoryboardWithTimestamps) and the subtitle renderer.
 * Timing authority stays with the authored brag plan — audioSync gives `scene.duration` priority, so
 * the authored 20 seconds survives whether or not narration exists.
 */
import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { assertBragProps, type BragPromoProps } from '../../types/bragPromo';
import { alignStoryboardWithTimestamps } from '../../lib/audioSync';
import { BragSceneView } from './BragSceneView';
import { SubtitleOverlay } from '../storyteller/SubtitleOverlay';
import type { SubtitleConfig } from '../../types/storyboard';

export const BragPromo: React.FC<BragPromoProps> = (props) => {
  // Throws with a precise message rather than rendering a black video (see types/bragPromo.ts).
  assertBragProps(props);
  const { manifest, brag } = props;
  const sceneAudio = props.sceneAudio ?? [];
  const audio = props.audio ?? null;
  const captions = props.captions ?? brag.captions;

  const { fps, durationInFrames, width, height } = useVideoConfig();
  const frame = useCurrentFrame();

  const { sceneBoundaries } = alignStoryboardWithTimestamps(manifest, sceneAudio, fps);

  /** Local asset paths resolve against an HTTP server that serves public/ (staticFile() is broken
   *  here — see the note on BragPromoProps.assetsBaseUrl). Remote/data URLs pass through untouched. */
  const assetsBase = (props.assetsBaseUrl ?? 'http://localhost:3001').replace(/\/+$/, '');
  const resolveSrc = (p: string): string =>
    /^(https?:|data:|blob:)/i.test(p) ? p : `${assetsBase}/${p.replace(/^\/+/, '')}`;

  const music = audio?.music ?? null;
  const musicVolume = (frame: number): number => {
    if (!music) return 0;
    const fadeInFrames = Math.round(music.fadeInSeconds * fps);
    const fadeOutFrames = Math.round(music.fadeOutSeconds * fps);
    const peak = music.volume;
    const rising = fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, peak], { extrapolateRight: 'clamp' })
      : peak;
    const falling = fadeOutFrames > 0
      ? interpolate(frame, [durationInFrames - fadeOutFrames, durationInFrames], [peak, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : peak;
    return Math.min(rising, falling);
  };

  const captionConfig: SubtitleConfig = {
    enabled: true,
    fontSize: Math.max(20, Math.round(width * 0.036)),
    color: brag.palette.text,
    backgroundColor: 'rgba(0,0,0,0.55)',
    highlightActiveWord: true,
    activeWordColor: brag.palette.accent,
  };

  return (
    <AbsoluteFill style={{ backgroundColor: brag.palette.background, overflow: 'hidden' }}>
      {/* ── music bed ── */}
      {music && <Audio src={resolveSrc(music.file)} volume={musicVolume} />}

      {/* ── sound effects, placed on the beat grid ── */}
      {audio?.sfx.map((cue, idx) => {
        const fromFrame = Math.max(0, Math.round(cue.fromSeconds * fps));
        if (fromFrame >= durationInFrames) return null;
        return (
          <Sequence
            key={`sfx_${idx}_${cue.intent}`}
            from={fromFrame}
            durationInFrames={Math.max(1, Math.round(cue.durationSeconds * fps))}
            name={`SFX: ${cue.intent}`}
          >
            <Audio src={resolveSrc(cue.file)} volume={cue.volume} />
          </Sequence>
        );
      })}

      {/* ── scenes ── */}
      {brag.scenes.map((scene, index) => {
        const boundary = sceneBoundaries.find((b) => b.sceneNumber === scene.sceneNumber);
        if (!boundary) {
          // A missing boundary means the manifest and brag metadata drifted apart; that is a bug,
          // not something to paper over.
          throw new Error(
            `[BragPromo] No timing boundary for scene ${scene.sceneNumber} ("${scene.name}"). ` +
              'manifest and brag metadata came from different compiles.',
          );
        }

        const previousMood = index === 0 ? 'clean' : brag.scenes[index - 1].transitionMood;
        const sa = sceneAudio.find((s) => s.sceneNumber === scene.sceneNumber);

        return (
          <Sequence
            key={`scene_${scene.sceneNumber}`}
            from={boundary.startFrame}
            durationInFrames={boundary.durationInFrames}
            name={`Scene ${scene.sceneNumber}: ${scene.name}`}
          >
            {sa?.audioUrl && <Audio src={resolveSrc(sa.audioUrl)} volume={1} />}
            <BragSceneView
              scene={scene}
              brag={brag}
              index={index}
              total={brag.scenes.length}
              durationInFrames={boundary.durationInFrames}
              incomingMood={previousMood}
              visualSrc={scene.visualSrc ? resolveSrc(scene.visualSrc) : undefined}
            />
            {captions && sa?.wordTimestamps?.length ? (
              <SubtitleOverlay
                wordTimestamps={sa.wordTimestamps}
                narration={scene.lines.map((l) => l.text).join(' ')}
                config={captionConfig}
                fps={fps}
                sceneDurationSec={scene.seconds}
              />
            ) : null}
          </Sequence>
        );
      })}

      {/* ── a hairline progress bar: signals "short video" and gives the eye a finish line ── */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: Math.max(3, Math.round(height * 0.004)),
          width: `${Math.min(100, (frame / Math.max(1, durationInFrames)) * 100)}%`,
          backgroundColor: brag.palette.accent,
          opacity: 0.9,
        }}
      />
    </AbsoluteFill>
  );
};
