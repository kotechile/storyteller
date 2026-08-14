import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { CanvasElement } from '../../types/storyboard';

interface HighlightOverlayProps {
  element: CanvasElement;
  currentTimeMs: number;
  fps: number;
  annotationConfig?: {
    highlightColor?: string;
    highlightBorderWidth?: number;
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

export const HighlightOverlay: React.FC<HighlightOverlayProps> = ({ element, annotationConfig }) => {
  const frame = useCurrentFrame();

  const delayFrames = element.enterAnimation?.delay ?? 0;
  const animDuration = element.enterAnimation?.duration ?? 10;

  const activeFrames = frame - delayFrames;
  if (activeFrames < 0) {
    return null;
  }

  const stayFrames = 45; // 1.5s active highlight window
  const fadeOutFrames = 15;

  let opacity = 0;
  if (activeFrames <= animDuration) {
    opacity = interpolate(activeFrames, [0, animDuration], [0, 1], { extrapolateRight: 'clamp' });
  } else if (activeFrames <= animDuration + stayFrames) {
    opacity = 1;
  } else if (activeFrames <= animDuration + stayFrames + fadeOutFrames) {
    opacity = interpolate(
      activeFrames,
      [animDuration + stayFrames, animDuration + stayFrames + fadeOutFrames],
      [1, 0],
      { extrapolateRight: 'clamp' }
    );
  } else {
    return null; // Highlight completed its active focus window
  }

  const style = element.highlightOverlay?.style || 'glow';
  const highlightColor = annotationConfig?.highlightColor || '#ef4444';
  const borderWidth = annotationConfig?.highlightBorderWidth ?? 3;
  const rgb = hexToRgb(highlightColor) || { r: 239, g: 68, b: 68 };

  // Glowing border encircling the complete card frame (image cutout + caption badge + margins)
  const padX = 2.0;
  const padYTop = 3.5;
  const padYBottom = element.content ? 8.5 : 3.5;

  const overlayLeft = Math.max(0, element.x - padX);
  const overlayTop = Math.max(0, element.y - padYTop);
  const overlayWidth = element.width + padX * 2;
  const overlayHeight = element.height + padYTop + padYBottom;

  if (style === 'dim_others') {
    return (
      <>
        {/* Darkening background */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
            opacity,
            zIndex: element.zIndex || 5,
            pointerEvents: 'none',
          }}
        />
        {/* Highlight target box */}
        <div
          style={{
            position: 'absolute',
            left: `${overlayLeft}%`,
            top: `${overlayTop}%`,
            width: `${overlayWidth}%`,
            height: `${overlayHeight}%`,
            border: `${borderWidth}px solid ${highlightColor}`,
            borderRadius: 16,
            boxShadow: `0 0 30px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`,
            zIndex: (element.zIndex || 5) + 1,
            opacity,
            pointerEvents: 'none',
          }}
        />
      </>
    );
  }

  if (style === 'border') {
    return (
      <div
        style={{
          position: 'absolute',
          left: `${overlayLeft}%`,
          top: `${overlayTop}%`,
          width: `${overlayWidth}%`,
          height: `${overlayHeight}%`,
          border: `${borderWidth}px dashed ${highlightColor}`,
          borderRadius: 16,
          boxShadow: `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`,
          opacity,
          zIndex: element.zIndex || 5,
          pointerEvents: 'none',
        }}
      />
    );
  }

  // Default "glow" style
  return (
    <div
      style={{
        position: 'absolute',
        left: `${overlayLeft}%`,
        top: `${overlayTop}%`,
        width: `${overlayWidth}%`,
        height: `${overlayHeight}%`,
        border: `${borderWidth}px solid ${highlightColor}`,
        borderRadius: 16,
        backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.10)`,
        boxShadow: `0 0 30px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5), inset 0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
        opacity,
        zIndex: element.zIndex || 5,
        pointerEvents: 'none',
      }}
    />
  );
};
