import React from 'react';
import { SceneBackground } from '../../types/storyboard';

interface BackgroundRendererProps {
  background: SceneBackground;
}

export const BackgroundRenderer: React.FC<BackgroundRendererProps> = ({ background }) => {
  if (background.type === 'gradient') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: background.value,
        }}
      />
    );
  }

  if (background.type === 'solid') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: background.value,
        }}
      />
    );
  }

  // Default: Whiteboard Dot-Grid Canvas
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#f8fafc',
        backgroundImage: 'radial-gradient(#cbd5e1 1.5px, transparent 1.5px)',
        backgroundSize: '28px 28px',
      }}
    />
  );
};
