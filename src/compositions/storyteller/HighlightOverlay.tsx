import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { CanvasElement } from '../../types/storyboard';

interface HighlightOverlayProps {
  element: CanvasElement;
  currentTimeMs: number;
  fps: number;
}

export const HighlightOverlay: React.FC<HighlightOverlayProps> = ({ element }) => {
  const frame = useCurrentFrame();

  const delayFrames = element.enterAnimation?.delay ?? 0;
  const animDuration = element.enterAnimation?.duration ?? 10;

  // Highlight pulse & auto-fade window:
  // Fades in over animDuration (10 frames), stays active for stayFrames (45 frames / 1.5s), then smoothly fades out
  // so ONLY the currently active/appearing box has a highlight glow at a time!
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
            border: '3px solid #3b82f6',
            borderRadius: 16,
            boxShadow: '0 0 30px rgba(59, 130, 246, 0.8)',
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
          border: '4px dashed #f59e0b',
          borderRadius: 16,
          boxShadow: '0 0 20px rgba(245, 158, 11, 0.5)',
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
        border: '3px solid #3b82f6',
        borderRadius: 16,
        backgroundColor: 'rgba(59, 130, 246, 0.10)',
        boxShadow: '0 0 30px rgba(59, 130, 246, 0.5), inset 0 0 20px rgba(59, 130, 246, 0.15)',
        opacity,
        zIndex: element.zIndex || 5,
        pointerEvents: 'none',
      }}
    />
  );
};
