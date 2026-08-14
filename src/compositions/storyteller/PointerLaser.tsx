import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

interface PointerLaserProps {
  /** Current target position relative to parent (0-100%) */
  targetX: number;
  targetY: number;
  /** Previous target position (for smooth transition) */
  prevX?: number;
  prevY?: number;
  /** Whether the pointer is visible */
  active: boolean;
  /** Relative frame index since transition started */
  activeFrame?: number;
  /** Transition duration in frames (1 = instant) */
  transitionFrames?: number;
  /** Pointer dot color (hex, default #ef4444) */
  color?: string;
}

const DEFAULT_POINTER_COLOR = "#ef4444";

/** Parse hex color to RGB components */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

export const PointerLaser: React.FC<PointerLaserProps> = ({
  targetX,
  targetY,
  prevX = targetX,
  prevY = targetY,
  active,
  activeFrame: inputActiveFrame,
  transitionFrames = 15,
  color = DEFAULT_POINTER_COLOR,
}) => {
  const frame = useCurrentFrame();

  if (!active) return null;

  const currentAnimFrame = inputActiveFrame !== undefined ? inputActiveFrame : frame;
  const rgb = hexToRgb(color) || hexToRgb(DEFAULT_POINTER_COLOR)!;

  const progress = Math.min(Math.max(currentAnimFrame, 0) / transitionFrames, 1);

  const currentX = interpolate(progress, [0, 1], [prevX, targetX], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const currentY = interpolate(progress, [0, 1], [prevY, targetY], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Scale pulse on arrival
  const scale = interpolate(
    Math.sin(frame * 0.3) * 0.5 + 0.5,
    [0, 1],
    [0.85, 1.15],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        position: "absolute",
        left: `${currentX}%`,
        top: `${currentY}%`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        zIndex: 30,
        pointerEvents: "none",
      }}
    >
      {/* Outer glow ring */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
          border: `2px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
          boxShadow: `0 0 18px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: "none",
        }}
      >
        {/* Inner white dot */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            boxShadow: `0 0 6px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`,
          }}
        />
      </div>
    </div>
  );
};
