import React from 'react';
import { useCurrentFrame } from 'remotion';
import { StoryboardScene, CameraInstruction, AnnotationConfig, CanvasElement } from '../../types/storyboard';
import { BackgroundRenderer, LightingPreset } from './BackgroundRenderer';
import { ElementRenderer } from './ElementRenderer';
import { CameraRig } from './CameraRig';
import { autoOptimizeSceneLayout } from '../../lib/layoutEngine';

interface SceneCanvasProps {
  scene: StoryboardScene;
  fps: number;
  camera?: CameraInstruction;
  lighting?: LightingPreset;
  annotationConfig?: AnnotationConfig;
}

/**
 * Computes effective delays for elements based on revealTimeSeconds and sequencing mode.
 * 
 * Sequencing modes:
 * - 'immediate' (default): Elements use their own delay, all animate concurrently.
 * - 'staggered': Elements appear one at a time in z-index order, each offset by staggerOffset frames.
 * - 'progressive': Like staggered, but earlier elements persist (accumulate).
 */
function computeEffectiveAnimation(
  elements: CanvasElement[],
  _fps: number,
): CanvasElement[] {
  // Sort by zIndex for sequencing
  const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  // Determine sequencing mode from the first element that has it set
  const sequencingMode = sorted.find(
    (e) => e.enterAnimation?.sequencing
  )?.enterAnimation?.sequencing || 'immediate';
  const staggerOffset = sorted.find(
    (e) => e.enterAnimation?.staggerOffset
  )?.enterAnimation?.staggerOffset || 10;

  if (sequencingMode === 'immediate') {
    // Use the already-computed enterAnimation.delay from audioSync
    // (which includes the 0.5s clamp for primary scene images).
    // Do NOT recompute from revealTimeSeconds — audioSync already did that.
    return elements;
  }

  // Staggered / Progressive: cascade delays on top of audioSync-computed delays
  return sorted.map((el, index) => {
    const cascadeDelay = index * staggerOffset;
    // Use audioSync's already-computed delay as the base
    const baseDelay = el.enterAnimation?.delay || 0;

    // Use the later of: cascade position or TTS-aligned reveal delay
    const effectiveDelay = Math.max(cascadeDelay, baseDelay);

    return {
      ...el,
      enterAnimation: {
        type: el.enterAnimation?.type || 'fade_in',
        duration: el.enterAnimation?.duration || 15,
        delay: effectiveDelay,
        sequencing: sequencingMode,
        staggerOffset,
      },
    };
  });
}

export const SceneCanvas: React.FC<SceneCanvasProps> = ({
  scene,
  fps,
  camera: globalCamera,
  lighting,
  annotationConfig,
}) => {
  const frame = useCurrentFrame();
  const currentTimeMs = (frame / fps) * 1000;

  // Per-scene camera overrides composition-level camera
  const sceneCamera = scene.camera || globalCamera;

  // Animation strategy defaults to 'static' (current behavior) for backward compat
  const strategy = scene.animationStrategy || 'static';
  const isProgrammatic = strategy === 'programmatic';

  // Optimize layout — skip for text_to_video scenes (cinematic, no diagram layout)
  const isTextToVideo = strategy === 'text_to_video';
  const isImageToVideo = strategy === 'image_to_video';
  const rawElements = scene.layout?.elements || [];
  const optimizedElements = (isTextToVideo || isImageToVideo)
    ? rawElements
        .filter((el: any) => el.type === 'image') // Only keep images for video scenes
        .map((el: any) =>
          // text_to_video renders edge-to-edge: force full-screen regardless of the LLM layout
          // (otherwise a 40%x28% hub box crops the 16:9 video via objectFit:'cover').
          isTextToVideo
            ? { ...el, x: 0, y: 0, width: 100, height: 100, zIndex: 1 }
            : el
        )
    : autoOptimizeSceneLayout(rawElements, annotationConfig);

  // Compute effective animations with sequencing
  const processedElements = isProgrammatic
    ? computeEffectiveAnimation(optimizedElements, fps)
    : optimizedElements;

  // Sort by z-index
  const sortedElements = [...processedElements].sort(
    (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
  );

  // Whiteboard mode: compute overall drawing progress (0-1) for the scene
  const manifestMeta = (scene as unknown as { meta?: { stylePreset?: string } }).meta;
  const sceneStylePreset = (scene as unknown as { stylePreset?: string }).stylePreset;
  const isWhiteboard = manifestMeta?.stylePreset === 'whiteboard' ||
    manifestMeta?.stylePreset === 'whiteboard-sketch' ||
    manifestMeta?.stylePreset === 'dotted-notebook' ||
    manifestMeta?.stylePreset === 'flowcharts-whiteboard' ||
    manifestMeta?.stylePreset === 'chalkboard' ||
    manifestMeta?.stylePreset === 'chalk-drawing' ||
    sceneStylePreset === 'whiteboard' ||
    sceneStylePreset === 'whiteboard-sketch' ||
    sceneStylePreset === 'dotted-notebook' ||
    sceneStylePreset === 'flowcharts-whiteboard' ||
    sceneStylePreset === 'chalkboard' ||
    sceneStylePreset === 'chalk-drawing';
  const totalDelayFrames = isProgrammatic
    ? sortedElements.length > 0
      ? Math.max(...sortedElements.map((e) => e.enterAnimation?.delay || 0)) +
        (sortedElements[sortedElements.length - 1]?.enterAnimation?.duration || 15)
      : 0
    : 0;
  const drawingProgress = totalDelayFrames > 0
    ? Math.min(frame / totalDelayFrames, 1)
    : 1;

  return (
    <CameraRig camera={sceneCamera} fps={fps}>
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {scene.layout?.background && (
          <BackgroundRenderer background={scene.layout.background} lighting={lighting} />
        )}
        {sortedElements.map((element) => (
          <ElementRenderer
            key={element.id}
            element={element}
            allSceneElements={sortedElements}
            currentTimeMs={currentTimeMs}
            fps={fps}
            sceneRegionEvents={scene.regionFocusEvents}
            sceneDetectedRegions={scene.detectedRegions}
            sceneImageWidth={scene.detectedImageWidth}
            sceneImageHeight={scene.detectedImageHeight}
            annotationConfig={annotationConfig}
            animationStrategy={strategy}
            whiteboardMode={isWhiteboard}
            drawingProgress={drawingProgress}
          />
        ))}
      </div>
    </CameraRig>
  );
};
