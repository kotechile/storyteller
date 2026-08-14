import React from 'react';
import { SceneBackground } from '../../types/storyboard';

export type LightingPreset = 'golden_hour' | 'studio_key' | 'dramatic_shadows' | 'flat';

interface BackgroundRendererProps {
  background: SceneBackground;
  lighting?: LightingPreset;
}

export const BackgroundRenderer: React.FC<BackgroundRendererProps> = ({
  background,
  lighting = 'flat',
}) => {
  const lightingOverlays: Record<LightingPreset, React.CSSProperties> = {
    flat: {},
    golden_hour: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(135deg, rgba(255, 200, 100, 0.15) 0%, rgba(255, 150, 50, 0.05) 100%)',
      pointerEvents: 'none',
      zIndex: 100,
    },
    studio_key: {
      position: 'absolute',
      inset: 0,
      background: 'radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.06) 100%)',
      pointerEvents: 'none',
      zIndex: 100,
    },
    dramatic_shadows: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35) 100%)',
      pointerEvents: 'none',
      zIndex: 100,
    },
  };

  const renderBaseBackground = () => {
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

  return (
    <>
      {renderBaseBackground()}
      {lighting !== 'flat' && <div style={lightingOverlays[lighting]} />}
    </>
  );
};
