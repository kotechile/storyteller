import React from 'react';
import { SceneCanvas } from './SceneCanvas';
import { StoryboardScene } from '../../types/storyboard';

export const StoryScene: React.FC<{ scene: StoryboardScene; fps?: number }> = ({ scene, fps = 30 }) => {
  return <SceneCanvas scene={scene} fps={fps} />;
};
