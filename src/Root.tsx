import React from "react";
import "./index.css";
import { Composition } from "remotion";
import { loadFont } from "@remotion/google-fonts/Outfit";

import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_FPS,
  DEFAULT_DURATION_IN_FRAMES,
  COLORS,
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
import { sampleStoryboardManifest, sampleWordTimestamps } from "./lib/sampleData";

loadFont();

// Load latest generated story if present on disk
let initialManifest = sampleStoryboardManifest;
let initialWordTimestamps = sampleWordTimestamps;
let initialAudioUrl = "narration.mp3";

try {
  const latestStory = require('./lib/latestStory.json');
  if (latestStory && latestStory.manifest) {
    initialManifest = latestStory.manifest;
    if (latestStory.wordTimestamps) initialWordTimestamps = latestStory.wordTimestamps;
    if (latestStory.audioUrl) initialAudioUrl = latestStory.audioUrl;
  }
} catch {
  // Use sample fallback if latestStory.json not found
}

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
        schema={explainerCompositionSchema}
        calculateMetadata={async ({ props }: { props: any }) => {
          let durationSeconds = 45;
          if (props.wordTimestamps && props.wordTimestamps.length > 0) {
            const lastWord = props.wordTimestamps[props.wordTimestamps.length - 1];
            durationSeconds = lastWord.end + 1.5;
          } else if (props.manifest?.scenes) {
            durationSeconds = props.manifest.scenes.reduce(
              (acc: number, s: any) => acc + (s.duration || 4),
              0
            );
          }
          return {
            durationInFrames: Math.max(Math.ceil(durationSeconds * DEFAULT_FPS), 120),
          };
        }}
        defaultProps={{
          articleUrl: "https://giniloh.com/smart-ways-to-invest-an-extra-500-a-day/",
          manifest: initialManifest,
          wordTimestamps: initialWordTimestamps,
          audioUrl: initialAudioUrl,
        }}
      />

      {/* 1. Minimal Title Card */}
      <Composition
        id="title-card"
        component={TitleCard}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        schema={TitleCardSchema}
        defaultProps={{
          titleText: "MOTION GRAPHICS ENGINE",
          subtitleText: "Clean, Programmatic & Minimal",
          titleColor: COLORS.text.primaryDark,
          subtitleColor: COLORS.text.secondaryDark,
          backgroundColor: COLORS.background.light,
        }}
      />

      {/* 2. Responsive Lower Third */}
      <Composition
        id="lower-third"
        component={LowerThird}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        schema={LowerThirdSchema}
        defaultProps={{
          primaryName: "Alex Mercer",
          secondaryTitle: "Creative Director",
          textColor: COLORS.text.primaryLight,
          accentColor: COLORS.text.accentGreen,
          panelColor: COLORS.background.dark,
        }}
      />

      {/* 3. Kinetic Staggered Text */}
      <Composition
        id="kinetic-text"
        component={KineticText}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        schema={KineticTextSchema}
        defaultProps={{
          text: "CREATIVE PROGRAMMATIC VIDEO PRODUCTION ENGINE",
          textColor: COLORS.text.primaryDark,
          accentColor: COLORS.text.accentBlue,
          backgroundColor: COLORS.background.light,
        }}
      />

      {/* 4. Glass Transparent Overlay */}
      <Composition
        id="transparent-overlay"
        component={TransparentOverlay}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        schema={TransparentOverlaySchema}
        defaultProps={{
          badgeText: "Live Demo Render",
          categoryText: "ProRes 4444",
          badgeColor: "rgba(17, 24, 39, 0.8)",
          textColor: "#F9FAFB",
          borderColor: "#F59E0B",
          playSoundEffect: false,
        }}
      />

      {/* 5. Call to Action */}
      <Composition
        id="call-to-action"
        component={CallToAction}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
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
