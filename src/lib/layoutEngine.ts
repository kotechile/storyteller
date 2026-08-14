import { CanvasElement, AnnotationConfig } from '../types/storyboard';

/**
 * Smart Canvas Layout Engine
 * Enforces canvas safe zones, zero title collisions, and 6-8% outer border margins.
 * When subtitles are enabled, reserves bottom 12% of canvas for the subtitle bar.
 * Highlight overlays scale proportionally with their target images.
 */
export function autoOptimizeSceneLayout(elements: CanvasElement[], annotationConfig?: AnnotationConfig): CanvasElement[] {
  const showTitle = annotationConfig?.showTitle !== false;
  const subtitlesEnabled = annotationConfig?.subtitle?.enabled === true;

  // Title-ON mode: image at x:6, y:14, w:88, h:84.6. Reduce proportionally for subtitles.
  const IMAGE_HEIGHT = subtitlesEnabled ? 70 : 84.6;
  const IMAGE_WIDTH = subtitlesEnabled ? Math.round(88 * (70 / 84.6)) : 88;
  const IMAGE_X = subtitlesEnabled ? Math.round((100 - IMAGE_WIDTH) / 2) : 6;

  // Full-screen mode (Title OFF): leave bottom 12% for subtitle bar
  const FULLSCREEN_HEIGHT = subtitlesEnabled ? 88 : 100;

  // Save original image positions BEFORE clamping (for proportional highlight alignment)
  const originalImages = new Map<string, { x: number; y: number; width: number; height: number }>();
  elements.forEach((el) => {
    if (el.type === 'image') {
      originalImages.set(el.id, { x: el.x, y: el.y, width: el.width, height: el.height });
    }
  });

  // Step 1: Clamp image and text elements to canvas safe zones
  const clampedElements = elements.map((el) => {
    if (el.type === 'text') {
      const isTitle = el.id.includes('title') || el.y < 15;
      if (isTitle) {
        return { ...el, x: 6, y: 4, width: Math.min(el.width, 58), height: Math.min(el.height, 10) };
      }
      const safeY = Math.max(68, Math.min(el.y, 82));
      return { ...el, x: Math.max(6, Math.min(el.x, 94 - el.width)), y: safeY, width: Math.min(el.width, 42), height: Math.min(el.height, 12) };
    }

    if (el.type === 'image') {
      if (!showTitle) {
        return { ...el, x: 0, y: 0, width: 100, height: FULLSCREEN_HEIGHT };
      }
      return { ...el, x: IMAGE_X, y: 14, width: IMAGE_WIDTH, height: IMAGE_HEIGHT };
    }

    return el;
  });

  // Step 2: Scale highlight overlays proportionally with their target images
  return clampedElements.map((el) => {
    if (el.type !== 'highlight_overlay') return el;

    // Find the target image — by sourceAssetId, or fallback to any image
    const targetId = el.sourceAssetId;
    const targetImage = targetId
      ? clampedElements.find((t) => t.id === targetId)
      : clampedElements.find((t) => t.type === 'image');

    if (!targetImage) return el;

    const orig = originalImages.get(targetImage.id);
    if (!orig) return el;

    // Compute relative position within the original image
    const relX = orig.width > 0 ? (el.x - orig.x) / orig.width : 0;
    const relY = orig.height > 0 ? (el.y - orig.y) / orig.height : 0;
    const relW = orig.width > 0 ? el.width / orig.width : 0;
    const relH = orig.height > 0 ? el.height / orig.height : 0;

    // Apply to new image position
    return {
      ...el,
      x: targetImage.x + relX * targetImage.width,
      y: targetImage.y + relY * targetImage.height,
      width: relW * targetImage.width,
      height: relH * targetImage.height,
    };
  });
}
