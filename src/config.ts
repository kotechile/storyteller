// Centralized Remotion configuration file.
// Changing width, height, or fps here will ripple throughout layout math and timing computations.

export const DESIGN_REFERENCE_WIDTH = 1920;
export const DESIGN_REFERENCE_HEIGHT = 1080;

// Global Default constants
export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;
export const DEFAULT_FPS = 30;
export const DEFAULT_DURATION_SECONDS = 5;
export const DEFAULT_DURATION_IN_FRAMES = DEFAULT_DURATION_SECONDS * DEFAULT_FPS;

// Color System - Minimal, Neutral, and Modular
export const COLORS = {
  background: {
    light: "#F9FAFB", // Slate-50
    dark: "#111827",  // Slate-900
    transparent: "transparent",
  },
  text: {
    primaryLight: "#F9FAFB",
    primaryDark: "#111827",
    secondaryLight: "#D1D5DB",
    secondaryDark: "#4B5563",
    accentGreen: "#10B981",  // Emerald 500
    accentBlue: "#3B82F6",   // Blue 500
    accentOrange: "#F59E0B", // Amber 500
  },
  border: {
    light: "#E5E7EB",
    dark: "#374151",
    accent: "#F59E0B",
  },
  overlay: {
    badgeBg: "rgba(17, 24, 39, 0.8)",
  }
} as const;

export type VideoResolution = {
  width: number;
  height: number;
};

export type VideoTiming = {
  fps: number;
  durationInFrames: number;
};
