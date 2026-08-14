import React from "react";
import {
  Audio,
  Sequence,
  useVideoConfig,
  interpolate,
  useCurrentFrame,
  Img,
} from "remotion";
import {
  ExplainerCompositionProps,
  SceneAudio,
} from "../../types/storyboard";
import { alignStoryboardWithTimestamps } from "../../lib/audioSync";
import { sampleStoryboardManifest } from "../../lib/sampleData";
import { SceneCanvas } from "./SceneCanvas";
import { SubtitleOverlay } from "./SubtitleOverlay";
import { TitleCardScene } from "./TitleCardScene";
import { generateSfxCues, SFX_MAP } from "../../lib/sfxEngine";

/** Opening title card duration: 4 seconds at 30fps */
const TITLE_CARD_FRAMES = 120;
/** Closing logo card duration: 3 seconds at 30fps */
const CLOSING_LOGO_FRAMES = 90;

/** Closing logo card — full-screen centered logo with fade-in */
const ClosingLogoCard: React.FC<{ logoUrl: string; durationInFrames: number }> = ({
  logoUrl,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 25], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = Math.min(fadeIn, fadeOut);
  const scale = interpolate(frame, [0, 30], [0.85, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#0f172a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <Img
        src={logoUrl}
        style={{
          width: "30%",
          maxHeight: "40%",
          objectFit: "contain",
          transform: `scale(${scale})`,
          filter: "drop-shadow(0 4px 20px rgba(99, 102, 241, 0.3))",
        }}
      />
    </div>
  );
};

export const ExplainerStoryComposition: React.FC<ExplainerCompositionProps> = ({
  manifest = sampleStoryboardManifest,
  sceneAudio,
  bgMusicUrl,
  sfxCues: inputSfxCues,
  camera,
  lighting,
  annotationConfig,
  logoUrl,
  audioBaseUrl,
}) => {
  const { fps } = useVideoConfig();

  const resolvedSceneAudio: SceneAudio[] = sceneAudio || [];

  const { alignedManifest, sceneBoundaries } = alignStoryboardWithTimestamps(
    manifest,
    resolvedSceneAudio,
    fps,
  );

  const resolveAudioSrc = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") || url.startsWith("blob:")) {
      return url;
    }
    const cleanPath = url.replace(/^\//, "");
    const base = audioBaseUrl || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3001');
    return `${base}/${cleanPath}`;
  };

  const sfxCues =
    inputSfxCues || generateSfxCues(alignedManifest, sceneBoundaries);

  const rawTitle = manifest.meta?.title || "";
  const titleSceneData = alignedManifest.scenes.find((s: any) => s.sceneNumber === 0);
  const titleSubtitle = titleSceneData?.narration || "";

  const titleCardDuration = sceneBoundaries[0]?.durationInFrames || TITLE_CARD_FRAMES;

  // Compute where the closing logo starts (after all content scenes)
  const totalContentFrames = sceneBoundaries.length > 0
    ? sceneBoundaries[sceneBoundaries.length - 1].startFrame + sceneBoundaries[sceneBoundaries.length - 1].durationInFrames
    : 0;
  const closingLogoStart = totalContentFrames;

  // Filter out Scene 0 (title card) from regular scene rendering
  const contentScenes = alignedManifest.scenes.filter((s: any) => s.sceneNumber !== 0);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#0f172a",
        fontFamily: "Inter, system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background Music Layer */}
      {bgMusicUrl && (
        <Audio
          src={resolveAudioSrc(bgMusicUrl)}
          volume={0.15}
        />
      )}

      {/* Opening Title Card (Scene 0) — Prominently reveals company logo */}
      <Sequence from={0} durationInFrames={titleCardDuration} name="Title Card">
        <TitleCardScene
          title={rawTitle}
          subtitle={titleSubtitle}
          durationInFrames={titleCardDuration}
          logoUrl={logoUrl}
        />
      </Sequence>

      {/* Sound Effects Engine Layer — aligned with scene boundaries */}
      {sfxCues.map((cue, idx) => {
        const soundUrl = SFX_MAP[cue.soundType];
        if (!soundUrl) return null;
        const fromFrame = Math.round((cue.startSeconds || 0) * fps);
        const durationFrames = Math.max(
          Math.round((cue.durationSeconds || 0.4) * fps),
          1,
        );
        return (
          <Sequence
            key={`sfx_${cue.soundType}_${idx}`}
            from={fromFrame}
            durationInFrames={durationFrames}
            name={`SFX: ${cue.soundType}`}
          >
            <Audio src={resolveAudioSrc(soundUrl) || soundUrl} volume={cue.volume || 0.3} />
          </Sequence>
        );
      })}

      {/* Render Content Scenes */}
      {contentScenes.map((scene: any, index: number) => {
        // Map back to original sceneBoundaries index
        const origIdx = alignedManifest.scenes.indexOf(scene);
        const boundary = sceneBoundaries[origIdx];
        if (!boundary) return null;

        const sa = resolvedSceneAudio.find(
          (s) => s.sceneNumber === scene.sceneNumber
        );
        if (!sa || !sa.audioUrl) {
          console.warn(`[Audio] Scene ${scene.sceneNumber}: no audio (sa=${!!sa}, audioUrl="${sa?.audioUrl || 'none'}")`);
        }

        const audioSrc = resolveAudioSrc(sa?.audioUrl);
        console.log(`[Audio] Scene ${scene.sceneNumber}: audioUrl="${sa?.audioUrl}", resolved="${audioSrc}", timestamps=${sa?.wordTimestamps?.length || 0}`);
        const sceneDurationSec = boundary.durationInFrames / fps;

        return (
          <Sequence
            key={scene.sceneNumber}
            from={boundary.startFrame}
            durationInFrames={boundary.durationInFrames}
            name={`Scene ${scene.sceneNumber}`}
          >
            {audioSrc && <Audio src={audioSrc} volume={1} />}
            <SceneCanvas
              scene={scene}
              fps={fps}
              camera={camera}
              lighting={lighting as any}
              annotationConfig={annotationConfig}
            />
            {annotationConfig?.subtitle?.enabled && (
              <SubtitleOverlay
                wordTimestamps={sa?.wordTimestamps || []}
                narration={scene.narration}
                config={annotationConfig.subtitle}
                fps={fps}
                sceneDurationSec={sceneDurationSec}
              />
            )}
          </Sequence>
        );
      })}

      {/* Closing Logo Card — after all content */}
      {logoUrl && closingLogoStart > 0 && (
        <Sequence
          from={closingLogoStart}
          durationInFrames={CLOSING_LOGO_FRAMES}
          name="Closing Logo"
        >
          <ClosingLogoCard logoUrl={logoUrl} durationInFrames={CLOSING_LOGO_FRAMES} />
        </Sequence>
      )}
    </div>
  );
};
