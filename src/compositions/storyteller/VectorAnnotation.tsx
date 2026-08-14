import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

interface VectorAnnotationProps {
  /** Bounding box relative to parent (0-100%) */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Whether the annotation is currently active */
  active: boolean;
  /** Visual style */
  style?: "glow" | "border" | "spotlight";
  /** Optional label shown above the box */
  label?: string;
  /** Border color (hex, default #3b82f6) */
  color?: string;
  /** Border width in px (default 2.5) */
  borderWidth?: number;
}

const DEFAULT_COLOR = "#3b82f6";
const DEFAULT_BORDER_WIDTH = 2.5;

/** Parse hex color to RGB components */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

export const VectorAnnotation: React.FC<VectorAnnotationProps> = ({
  boundingBox,
  active,
  style = "glow",
  label,
  color = DEFAULT_COLOR,
  borderWidth = DEFAULT_BORDER_WIDTH,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const rgb = hexToRgb(color) || hexToRgb(DEFAULT_COLOR)!;

  // Pulsing opacity for glow effect
  const pulse = interpolate(
    Math.sin((frame / fps) * Math.PI * 2),
    [-1, 1],
    [0.6, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  if (!active) return null;

  if (style === "spotlight") {
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.55)",
            zIndex: 20,
            pointerEvents: "none",
            clipPath: `polygon(
              0% 0%, 0% 100%,
              ${boundingBox.x}% 100%,
              ${boundingBox.x}% ${boundingBox.y}%,
              ${boundingBox.x + boundingBox.width}% ${boundingBox.y}%,
              ${boundingBox.x + boundingBox.width}% ${boundingBox.y + boundingBox.height}%,
              ${boundingBox.x}% ${boundingBox.y + boundingBox.height}%,
              ${boundingBox.x}% 100%,
              100% 100%, 100% 0%
            )`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${boundingBox.x}%`,
            top: `${boundingBox.y}%`,
            width: `${boundingBox.width}%`,
            height: `${boundingBox.height}%`,
            border: `${borderWidth + 0.5}px solid ${color}`,
            borderRadius: 8,
            boxShadow: `0 0 24px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.5 * pulse})`,
            zIndex: 21,
            pointerEvents: "none",
          }}
        />
      </>
    );
  }

  if (style === "border") {
    return (
      <div
        style={{
          position: "absolute",
          left: `${boundingBox.x}%`,
          top: `${boundingBox.y}%`,
          width: `${boundingBox.width}%`,
          height: `${boundingBox.height}%`,
          border: `${borderWidth + 0.5}px dashed ${color}`,
          borderRadius: 8,
          boxShadow: `0 0 16px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.4 * pulse})`,
          zIndex: 20,
          pointerEvents: "none",
        }}
      >
        {label && (
          <span
            style={{
              position: "absolute",
              top: -22,
              left: 4,
              backgroundColor: color,
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 4,
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        )}
      </div>
    );
  }

  // Default: "glow" style
  return (
    <div
      style={{
        position: "absolute",
        left: `${boundingBox.x}%`,
        top: `${boundingBox.y}%`,
        width: `${boundingBox.width}%`,
        height: `${boundingBox.height}%`,
        border: `${borderWidth}px solid ${color}`,
        borderRadius: 10,
        backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.08 * pulse})`,
        boxShadow: `
          0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.4 * pulse}),
          inset 0 0 12px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.1 * pulse})
        `,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      {label && (
        <span
          style={{
            position: "absolute",
            top: -24,
            left: 4,
            backgroundColor: color,
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            boxShadow: `0 2px 8px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
