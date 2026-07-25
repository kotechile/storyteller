import { interpolate, Easing } from "remotion";

// Premium, minimal spring configs to keep visual aesthetic consistent and fluid
export const SPRINGS = {
  snappy: { damping: 12, stiffness: 150, mass: 0.5 },
  smooth: { damping: 18, stiffness: 100 },
  gentle: { damping: 20, stiffness: 80 },
  bouncy: { damping: 10, stiffness: 100 },
} as const;

// Easing curves for smooth non-linear interpolation transitions
export const EASINGS = {
  easeIn: Easing.bezier(0.4, 0, 1, 1),
  easeOut: Easing.bezier(0, 0, 0.2, 1),
  easeInOut: Easing.bezier(0.4, 0, 0.2, 1),
  elastic: Easing.bezier(0.175, 0.885, 0.32, 1.275), // subtle overshoot
  anticipate: Easing.bezier(0.6, -0.28, 0.735, 0.045), // pull-back before push
} as const;

/**
 * Standard interpolation wrapper with clean defaults (clamps by default).
 */
export const interpolateClamp = (
  frame: number,
  input: [number, number],
  output: [number, number],
  options?: {
    easing?: (t: number) => number;
    extrapolateLeft?: "clamp" | "identity" | "extend";
    extrapolateRight?: "clamp" | "identity" | "extend";
  }
) => {
  return interpolate(frame, input, output, {
    easing: options?.easing,
    extrapolateLeft: options?.extrapolateLeft ?? "clamp",
    extrapolateRight: options?.extrapolateRight ?? "clamp",
  });
};
