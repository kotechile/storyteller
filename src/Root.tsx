import React from "react";
import "./index.css";
import { Composition } from "remotion";
import { loadFont } from "@remotion/google-fonts/Outfit";

import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_FPS,
} from "./config";

import { TitleCard, TitleCardSchema } from "./compositions/TitleCard";
import { LowerThird, LowerThirdSchema } from "./compositions/LowerThird";
import { KineticText, KineticTextSchema } from "./compositions/KineticText";
import {
  TransparentOverlay,
  TransparentOverlaySchema,
} from "./compositions/TransparentOverlay";
import { CallToAction, CallToActionSchema } from "./compositions/CallToAction";

import { ExplainerStoryComposition } from "./compositions/storyteller/ExplainerStoryComposition";
import { explainerCompositionSchema } from "./types/storyboard";

loadFont();

// ── Load latest pipeline output for Remotion Studio preview ──
// Falls back to minimal placeholder if pipeline hasn't been run yet.
function loadPipelineDefaults(): any {
  try {
    const data = require("./lib/latestStory.json");
    if (data?.manifest) {
      return {
        articleUrl: data.articleUrl || "",
        manifest: data.manifest,
        sceneAudio: data.sceneAudio || undefined,
        bgMusicUrl: data.bgMusicUrl || undefined,
        sfxCues: data.sfxCues || undefined,
      };
    }
  } catch {}
  return null;
}
const pipelineProps = loadPipelineDefaults();

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Primary: Storyteller Explainer Composition */}
      <Composition
        id="StorytellerExplainer"
        component={ExplainerStoryComposition}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        durationInFrames={5400}
        schema={explainerCompositionSchema}
        calculateMetadata={async ({ props }: { props: any }) => {
          let durationSeconds = 45;

          // Per-scene audio: sum of ElevenLabs-reported durations
          if (props.sceneAudio && props.sceneAudio.length > 0) {
            const total = props.sceneAudio.reduce(
              (acc: number, sa: any) => acc + (Number(sa.durationSeconds) || 0),
              0
            );
            if (total > 0) durationSeconds = total;
          }
          // Fallback: sum scene durations from manifest
          else if (props.manifest?.scenes?.length > 0) {
            const total = props.manifest.scenes.reduce(
              (acc: number, s: any) => acc + (Number(s.duration) || 12),
              0
            );
            if (total > 0) durationSeconds = total;
          }
          const frames = Math.max(Math.ceil((durationSeconds + 4 + 3) * DEFAULT_FPS), 120);
          return {
            durationInFrames: isNaN(frames) ? 120 : frames,
          };
        }}
        defaultProps={pipelineProps || {
          articleUrl: "",
          manifest: {
            meta: {
              title: "Pipeline not yet run — use CLI to generate",
              targetDuration: 60,
              stylePreset: "whiteboard" as const,
            },
            scenes: [],
          },
          sceneAudio: undefined,
        }}
      />

      {/* Supporting Compositions */}
      <Composition
        id="TitleCard"
        component={TitleCard}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        durationInFrames={150}
        schema={TitleCardSchema}
        defaultProps={{
          titleText: "Transform Your Content into Cinematic Explainer Videos",
          subtitleText:
            "OmniCast converts articles, PDFs, and text into studio-quality video stories — narrated, asset-rich, and ready to publish.",
          titleColor: "#111827",
          subtitleColor: "#6b7280",
          backgroundColor: "#ffffff",
        }}
      />
      <Composition
        id="LowerThird"
        component={LowerThird}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        durationInFrames={150}
        schema={LowerThirdSchema}
        defaultProps={{
          primaryName: "Jorge Fernandez",
          secondaryTitle: "Software Architect & Founder",
          textColor: "#111827",
          accentColor: "#6366f1",
          panelColor: "#f8fafc",
        }}
      />
      <Composition
        id="KineticText"
        component={KineticText}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        durationInFrames={150}
        schema={KineticTextSchema}
        defaultProps={{
          text: "The Future of Automated Video",
          textColor: "#111827",
          accentColor: "#6366f1",
          backgroundColor: "#ffffff",
        }}
      />
      <Composition
        id="TransparentOverlay"
        component={TransparentOverlay}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        durationInFrames={150}
        schema={TransparentOverlaySchema}
        defaultProps={{
          badgeText: "Pro",
          categoryText: "Video Pipeline",
          badgeColor: "#6366f1",
          textColor: "#111827",
          borderColor: "#e5e7eb",
          playSoundEffect: false,
        }}
      />
      <Composition
        id="CallToAction"
        component={CallToAction}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        durationInFrames={150}
        schema={CallToActionSchema}
        defaultProps={{
          buttonText: "Try Now",
          subText: "Get started in seconds",
          buttonColor: "#10B981",
          buttonTextColor: "#F9FAFB",
          textColor: "#111827",
          backgroundColor: "rgba(249, 250, 251, 0.06)",
        }}
      />
    </>
  );
};
