import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { ExplainerCompositionProps, CanvasElement } from "../../types/storyboard";
import { alignStoryboardWithTimestamps } from "../../lib/audioSync";
import {
  sampleStoryboardManifest,
  sampleWordTimestamps,
} from "../../lib/sampleData";
import { SceneCanvas } from "./SceneCanvas";

export const ExplainerStoryComposition: React.FC<ExplainerCompositionProps> = ({
  manifest = sampleStoryboardManifest,
  wordTimestamps = sampleWordTimestamps,
  audioUrl = "narration.mp3",
}) => {
  const { fps } = useVideoConfig();

  const { alignedManifest, sceneBoundaries } = alignStoryboardWithTimestamps(
    manifest,
    wordTimestamps,
    fps,
  );

  const audioSrc =
    audioUrl.startsWith("http") || audioUrl.startsWith("data:")
      ? audioUrl
      : staticFile(audioUrl || "narration.mp3");

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
      {/* Voiceover Audio */}
      {audioSrc && <Audio src={audioSrc} />}

      {/* Render Scenes via Sequence with Persistent Whiteboard Accumulation */}
      {alignedManifest.scenes.map((scene, index) => {
        const boundary = sceneBoundaries[index];
        if (!boundary) return null;

        // Whiteboard Persistence: Accumulate drawn elements (images, text, connectors) from previous scenes.
        // EXCLUDE previous highlight_overlays so glows fade away when new images arrive!
        const accumulatedElementsMap = new Map<string, CanvasElement>();

        for (let i = 0; i <= index; i++) {
          const currentScene = alignedManifest.scenes[i];
          if (currentScene.layout?.elements) {
            // Check if current scene has connectors linking back to accumulated elements from previous scenes
            const hasIncomingConnectorsToPast = currentScene.layout.elements.some((e) => {
              if (e.type === 'connector') {
                return (e.fromElementId && accumulatedElementsMap.has(e.fromElementId)) ||
                       (e.toElementId && accumulatedElementsMap.has(e.toElementId));
              }
              return false;
            });

            // Automatic Canvas Clearing for Standalone Centerpieces & Chapter Transitions:
            // If clearCanvas is explicitly set OR if a new scene (i > 0) is standalone (has no connectors linking to past scene elements),
            // wipe past diagram elements so the new scene starts on a fresh, clean whiteboard!
            const isStandaloneScene = i > 0 && !hasIncomingConnectorsToPast;
            if (currentScene.layout.clearCanvas || currentScene.layout.canvasMode === 'clear_canvas' || isStandaloneScene) {
              accumulatedElementsMap.clear();
            }

            // Check if current scene introduces a title text element
            const hasNewTitle = currentScene.layout.elements.some((e) => e.type === 'text');
            if (hasNewTitle && i > 0) {
              // Clear previous scene title text elements so title boxes never overlap or superimpose!
              for (const [key, existingEl] of accumulatedElementsMap.entries()) {
                if (existingEl.type === 'text') {
                  accumulatedElementsMap.delete(key);
                }
              }
            }

            for (const el of currentScene.layout.elements) {
              // Deduplication & Overlap Prevention: If a new element occupies the same location or replaces an existing ID/concept, prune the old element!
              for (const [existingId, existingEl] of accumulatedElementsMap.entries()) {
                const isSameLocation = el.type === 'image' && existingEl.type === 'image' && Math.abs(existingEl.x - el.x) < 6 && Math.abs(existingEl.y - el.y) < 6;
                const isSameId = existingId === el.id;
                const isExplicitReplace = el.replacesElementId === existingId;

                if ((isSameLocation && !isSameId) || isExplicitReplace) {
                  accumulatedElementsMap.delete(existingId);
                  // Prune any old connectors attached to the pruned element
                  for (const [connKey, connEl] of accumulatedElementsMap.entries()) {
                    if (
                      connEl.type === 'connector' &&
                      (connEl.fromElementId === existingId || connEl.toElementId === existingId)
                    ) {
                      accumulatedElementsMap.delete(connKey);
                    }
                  }
                }
              }

              if (el.replacesElementId) {
                const replacedId = el.replacesElementId;
                accumulatedElementsMap.delete(replacedId);

                // Prune any old connectors attached to the replaced element!
                for (const [key, existingEl] of accumulatedElementsMap.entries()) {
                  if (
                    existingEl.type === 'connector' &&
                    (existingEl.fromElementId === replacedId || existingEl.toElementId === replacedId)
                  ) {
                    accumulatedElementsMap.delete(key);
                  }
                }
              }

              if (i < index) {
                // Ignore old highlight overlays from past scenes
                if (el.type === 'highlight_overlay') continue;

                // Keep past images, text, and connectors permanently visible on whiteboard
                accumulatedElementsMap.set(el.id, {
                  ...el,
                  enterAnimation: {
                    type: el.enterAnimation?.type || 'fade_in',
                    duration: 0,
                    delay: 0,
                  },
                });
              } else {
                // Current scene elements include active highlight overlays
                accumulatedElementsMap.set(el.id, el);
              }
            }
          }
        }

        const persistentScene = {
          ...scene,
          layout: {
            ...scene.layout,
            elements: Array.from(accumulatedElementsMap.values()),
          },
        };

        return (
          <Sequence
            key={scene.sceneNumber}
            from={boundary.startFrame}
            durationInFrames={boundary.durationInFrames}
            name={`Scene ${scene.sceneNumber}`}
          >
            <SceneCanvas scene={persistentScene} fps={fps} />
          </Sequence>
        );
      })}
    </div>
  );
};
