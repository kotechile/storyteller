import { CanvasElement } from '../types/storyboard';

/**
 * Smart Canvas Layout Engine
 * Enforces canvas safe zones, zero title collisions, and 6-8% outer border margins.
 */
export function autoOptimizeSceneLayout(elements: CanvasElement[]): CanvasElement[] {
  // Safe Zone Constants (Percentage of 1920x1080 canvas)
  const LEFT_MARGIN = 6;
  const RIGHT_MARGIN = 94;
  const BOTTOM_MARGIN = 92;

  // Step 1: Clamp elements to canvas safe zones
  const clampedElements = elements.map((el) => {
    if (el.type === 'text') {
      return {
        ...el,
        x: Math.max(LEFT_MARGIN, Math.min(el.x, 30)),
        y: Math.max(4, Math.min(el.y, 8)),
        width: Math.min(el.width, 58),
        height: Math.min(el.height, 10),
      };
    }

    if (el.type === 'image') {
      // Clamp Y to start cleanly below title (Y >= 16%)
      const safeY = Math.max(16, el.y);
      const safeHeight = Math.min(el.height, BOTTOM_MARGIN - safeY);

      // Clamp X to fit within left and right margins (6% <= X <= 94%)
      const safeX = Math.max(LEFT_MARGIN, Math.min(el.x, RIGHT_MARGIN - el.width));
      const safeWidth = Math.min(el.width, RIGHT_MARGIN - safeX);

      return {
        ...el,
        x: safeX,
        y: safeY,
        width: safeWidth,
        height: safeHeight,
      };
    }

    return el;
  });

  // Step 2: Align highlight overlays with target image positions
  return clampedElements.map((el) => {
    if (el.type === 'highlight_overlay' && el.sourceAssetId) {
      const target = clampedElements.find((t) => t.id === el.sourceAssetId);
      if (target) {
        return {
          ...el,
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        };
      }
    }
    return el;
  });
}
