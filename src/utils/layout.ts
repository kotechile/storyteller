import { useVideoConfig } from "remotion";
import { DESIGN_REFERENCE_WIDTH } from "../config";

/**
 * Hook to scale layout dimensions dynamically relative to the base design reference width (1920).
 * Changing composition resolution (e.g. to 4K 3840x2160) will seamlessly scale all sizes.
 */
export const useLayoutScale = () => {
  const { width } = useVideoConfig();
  const scale = width / DESIGN_REFERENCE_WIDTH;

  // Calculates proportional pixels for layouts, padding, margins, borders, fonts
  const px = (size: number): number => size * scale;

  // Helper for inline styles returning string with 'px'
  const pxStr = (size: number): string => `${px(size)}px`;

  return { scale, px, pxStr };
};

/**
 * Hook to scale frames based on the current frame rate (FPS).
 * This ensures timings specified in seconds remain visually constant if FPS changes.
 */
export const useTime = () => {
  const { fps } = useVideoConfig();

  // Converts real-world seconds to frames
  const sec = (seconds: number): number => Math.round(seconds * fps);

  // Converts frames to real-world seconds
  const toSec = (frames: number): number => frames / fps;

  return { sec, toSec, fps };
};
