import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { CameraInstruction } from '../../types/storyboard';

interface CameraRigProps {
  children: React.ReactNode;
  camera?: CameraInstruction;
  fps?: number;
  /** Optional frame offset — camera motion starts at this frame within the scene */
  activeFrame?: number;
}

export const CameraRig: React.FC<CameraRigProps> = ({
  children,
  camera,
  activeFrame: activeFrameProp,
}) => {
  const frame = useCurrentFrame();
  const activeFrame = activeFrameProp !== undefined ? activeFrameProp : 0;

  if (!camera || camera.preset === 'static') {
    return <div style={{ width: '100%', height: '100%' }}>{children}</div>;
  }

  const duration = camera.durationFrames || 90;

  // Camera motion starts at activeFrame and ends at activeFrame + duration
  const localFrame = Math.max(0, frame - activeFrame);
  const progress = Math.min(localFrame / duration, 1);
  const intensity = camera.intensity ?? 0.5;

  let transform = 'none';
  let filter = 'none';
  let transformOrigin = 'center center';

  switch (camera.preset) {
    case 'slow_dolly_in': {
      const scale = interpolate(progress, [0, 1], [1.0, 1.0 + intensity * 0.2]);
      transform = `scale(${scale})`;
      transformOrigin = 'center center';
      break;
    }
    case 'macro_focus_pull': {
      const blur = interpolate(progress, [0, 0.3, 0.7, 1], [0, 8, 8, 0]) * intensity;
      const scale = interpolate(progress, [0, 1], [1.0, 1.05]);
      filter = `blur(${blur}px)`;
      transform = `scale(${scale})`;
      break;
    }
    case 'dutch_angle': {
      const rotation = interpolate(progress, [0, 0.2, 0.8, 1], [0, -3, -3, 0]) * intensity;
      transform = `rotate(${rotation}deg)`;
      break;
    }
    case 'crane_up': {
      const translateY = interpolate(progress, [0, 1], [0, -15]) * intensity;
      transform = `translateY(${translateY}%)`;
      break;
    }
    case 'push_to_element': {
      // Eased dolly toward center (simulates focus on a specific element)
      const ease = interpolate(progress, [0, 1], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      const scale = interpolate(ease, [0, 1], [1.0, 1.0 + intensity * 0.25]);
      const translateX = interpolate(ease, [0, 1], [0, -2 * intensity]);
      const translateY = interpolate(ease, [0, 1], [0, -2 * intensity]);
      transform = `scale(${scale}) translate(${translateX}%, ${translateY}%)`;
      transformOrigin = 'center center';
      break;
    }
    case 'pan_across': {
      // Smooth horizontal pan: starts left, sweeps right
      const ease = interpolate(progress, [0, 1], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      const panX = interpolate(ease, [0, 1], [-8 * intensity, 8 * intensity]);
      transform = `translateX(${panX}%)`;
      break;
    }
    case 'parallax_reveal': {
      // Background shifts one way, creates subtle depth illusion
      const ease = interpolate(progress, [0, 1], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      const scale = interpolate(ease, [0, 1], [0.98, 1.0 + intensity * 0.08]);
      const shiftX = interpolate(ease, [0, 1], [3 * intensity, 0]);
      const shiftY = interpolate(ease, [0, 1], [2 * intensity, 0]);
      transform = `scale(${scale}) translate(${shiftX}%, ${shiftY}%)`;
      transformOrigin = 'center center';
      break;
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform,
        filter,
        transformOrigin,
        transition: 'none',
      }}
    >
      {children}
    </div>
  );
};
