import React from 'react';
import { useCurrentFrame } from 'remotion';
import { StoryboardScene } from '../../types/storyboard';
import { BackgroundRenderer } from './BackgroundRenderer';
import { ElementRenderer } from './ElementRenderer';
import { autoOptimizeSceneLayout } from '../../lib/layoutEngine';

interface SceneCanvasProps {
  scene: StoryboardScene;
  fps: number;
}

export const SceneCanvas: React.FC<SceneCanvasProps> = ({ scene, fps }) => {
  const frame = useCurrentFrame();
  const currentTimeMs = (frame / fps) * 1000;

  // Auto-optimize canvas element layout to fit screen perfectly
  const optimizedElements = autoOptimizeSceneLayout(scene.layout?.elements || []);

  // Sort canvas elements by zIndex
  const sortedElements = [...optimizedElements].sort(
    (a, b) => (a.zIndex || 0) - (b.zIndex || 0)
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background Layer */}
      {scene.layout?.background && <BackgroundRenderer background={scene.layout.background} />}

      {/* Render Elements by zIndex */}
      {sortedElements.map((element) => (
        <ElementRenderer
          key={element.id}
          element={element}
          allSceneElements={sortedElements}
          currentTimeMs={currentTimeMs}
          fps={fps}
        />
      ))}
    </div>
  );
};
