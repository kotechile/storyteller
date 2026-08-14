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
}

export const VectorAnnotation: React.FC<VectorAnnotationProps> = ({
  boundingBox,
  active,
  style = "glow",
  label,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Pulsing opacity for glow effect
  const pulse = interpolate(
    Math.sin((frame / fps) * Math.PI * 2), // 2Hz pulse
    [-1, 1],
    [0.6, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  if (!active) return null;

  if (style === "spotlight") {
    return (
      <>
        {/* Dim overlay covering the entire image */}
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
        {/* Bright border around the spotlight region */}
        <div
          style={{
            position: "absolute",
            left: `${boundingBox.x}%`,
            top: `${boundingBox.y}%`,
            width: `${boundingBox.width}%`,
            height: `${boundingBox.height}%`,
            border: "3px solid #3b82f6",
            borderRadius: 8,
            boxShadow: `0 0 24px rgba(59, 130, 246, ${0.5 * pulse})`,
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
          border: "3px dashed #f59e0b",
          borderRadius: 8,
          boxShadow: `0 0 16px rgba(245, 158, 11, ${0.4 * pulse})`,
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
              backgroundColor: "#f59e0b",
              color: "#0f172a",
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
        border: "2.5px solid #3b82f6",
        borderRadius: 10,
        backgroundColor: `rgba(59, 130, 246, ${0.08 * pulse})`,
        boxShadow: `
          0 0 20px rgba(59, 130, 246, ${0.4 * pulse}),
          inset 0 0 12px rgba(59, 130, 246, ${0.1 * pulse})
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
            backgroundColor: "#3b82f6",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(59, 130, 246, 0.4)",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
