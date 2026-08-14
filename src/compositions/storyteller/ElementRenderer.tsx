import React from 'react';
import { interpolate, useCurrentFrame, staticFile, OffthreadVideo } from 'remotion';
import { CanvasElement, RegionFocusEvent, DetectedRegion, AnnotationConfig, AnimationStrategy } from '../../types/storyboard';
import { HighlightOverlay } from './HighlightOverlay';
import { TransparentImageCutout } from './TransparentImageCutout';
import { PointerLaser } from './PointerLaser';
import { getAsset } from '../../lib/assetLibrary';

interface ElementRendererProps {
  element: CanvasElement;
  allSceneElements?: CanvasElement[];
  currentTimeMs: number;
  fps: number;
  sceneRegionEvents?: RegionFocusEvent[];
  sceneDetectedRegions?: DetectedRegion[];
  /** Original image dimensions from Grounding DINO, for precise coordinate mapping */
  sceneImageWidth?: number;
  sceneImageHeight?: number;
  annotationConfig?: AnnotationConfig;
  /** Scene animation strategy (from StoryboardScene.animationStrategy) */
  animationStrategy?: AnimationStrategy;
  /** Whiteboard drawing mode — enables wipe-right and typewriter effects */
  whiteboardMode?: boolean;
  /** Overall drawing progress 0-1 for the entire scene (whiteboard mode) */
  drawingProgress?: number;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

/**
 * Computes the effective animation progress [0, 1] for an element
 * based on its enterAnimation delay + duration.
 */
function useAnimProgress(delayFrames: number, animDuration: number): number {
  const frame = useCurrentFrame();
  if (frame < delayFrames) return 0;
  const elapsed = frame - delayFrames;
  if (elapsed >= animDuration) return 1;
  return elapsed / animDuration;
}

export const ElementRenderer: React.FC<ElementRendererProps> = ({
  element,
  allSceneElements = [],
  currentTimeMs,
  fps,
  sceneRegionEvents,
  sceneDetectedRegions,
  sceneImageWidth,
  sceneImageHeight,
  annotationConfig,
  whiteboardMode = false,
}) => {
  const frame = useCurrentFrame();

  const delayFrames = element.enterAnimation?.delay ?? 0;
  const animDuration = element.enterAnimation?.duration ?? 15;
  const animType = element.enterAnimation?.type || 'fade_in';

  // Standard opacity + transform (fade_in, slide_up, scale_in, zoom_in)
  let opacity = 0;
  let transform = 'none';

  if (frame >= delayFrames) {
    const animProgress = Math.min((frame - delayFrames) / animDuration, 1);
    opacity = interpolate(animProgress, [0, 1], [0, 1], { extrapolateRight: 'clamp' });

    if (animType === 'slide_up') {
      const translateY = interpolate(animProgress, [0, 1], [25, 0], { extrapolateRight: 'clamp' });
      transform = `translateY(${translateY}px)`;
    } else if (animType === 'scale_in' || animType === 'zoom_in') {
      const scale = interpolate(animProgress, [0, 1], [0.85, 1.0], { extrapolateRight: 'clamp' });
      transform = `scale(${scale})`;
    }
  }

  // draw_in / wipe_right: use raw progress for stroke/clip-path
  const drawProgress = useAnimProgress(delayFrames, animDuration);

  // Highlight overlay
  if (element.type === 'highlight_overlay') {
    if (frame < delayFrames) return null;
    return <HighlightOverlay element={element} currentTimeMs={currentTimeMs} fps={fps} annotationConfig={annotationConfig} />;
  }

  // ── Connector (SVG arrow with draw-in animation) ──
  if (element.type === 'connector') {
    const isDashed = element.connectorStyle === 'dashed';
    const hasArrow = element.connectorStyle !== 'line';

    const fromEl = allSceneElements.find((e) => e.id === element.fromElementId);
    const toEl = allSceneElements.find((e) => e.id === element.toElementId);

    let startX = element.x;
    let startY = element.y + element.height / 2;
    let endX = element.x + element.width;
    let endY = element.y + element.height / 2;

    if (fromEl && toEl) {
      const fromCenter = { x: fromEl.x + fromEl.width / 2, y: fromEl.y + fromEl.height / 2 };
      const toCenter = { x: toEl.x + toEl.width / 2, y: toEl.y + toEl.height / 2 };

      const deltaY = toCenter.y - fromCenter.y;
      const deltaX = toCenter.x - fromCenter.x;

      if (deltaY > 12) {
        if (deltaX < -10) {
          startX = fromEl.x + 2;
        } else if (deltaX > 10) {
          startX = fromEl.x + fromEl.width - 2;
        } else {
          startX = fromCenter.x;
        }
        startY = fromEl.y + fromEl.height + (fromEl.content ? 6.5 : 1.5);
        endX = toCenter.x;
        endY = toEl.y - 2.0;
      } else if (deltaX > 12) {
        startX = fromEl.x + fromEl.width;
        startY = fromCenter.y;
        endX = toEl.x;
        endY = toCenter.y;
      } else if (deltaX < -12) {
        startX = fromEl.x;
        startY = fromCenter.y;
        endX = toEl.x + toEl.width;
        endY = toCenter.y;
      } else {
        startX = fromCenter.x;
        startY = fromCenter.y;
        endX = toCenter.x;
        endY = toCenter.y;
      }
    } else {
      if (fromEl) {
        startX = fromEl.x + fromEl.width;
        startY = fromEl.y + fromEl.height / 2;
      }
      if (toEl) {
        endX = toEl.x;
        endY = toEl.y + toEl.height / 2;
      }
    }

    const midX = (startX + endX) / 2;
    let midY = (startY + endY) / 2;

    if (fromEl && toEl && (toEl.y - fromEl.y) > 12) {
      midY = startY + (endY - startY) * 0.55;
    }

    // Convert percentages (0-100) to 1920x1080 viewBox coordinates
    const startX_px = startX * 19.2;
    const startY_px = startY * 10.8;
    const endX_px = endX * 19.2;
    const endY_px = endY * 10.8;

    const dx = endX_px - startX_px;
    const dy = endY_px - startY_px;
    const dist = Math.hypot(dx, dy);

    let lineStartX = startX_px;
    let lineStartY = startY_px;
    let lineEndX = endX_px;
    let lineEndY = endY_px;

    if (dist > 30) {
      const uX = dx / dist;
      const uY = dy / dist;
      lineStartX = startX_px + uX * 8;
      lineStartY = startY_px + uY * 8;
      lineEndX = endX_px - uX * 22;
      lineEndY = endY_px - uY * 22;
    }

    // Approximate path length for draw-in animation
    const pathLength = dist > 0 ? dist : 1;

    // Connector label fade-in: start when line is ~70% drawn
    const labelProgress = drawProgress > 0.7
      ? (drawProgress - 0.7) / 0.3
      : 0;

    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: element.zIndex || 2,
          opacity,
          transform,
          pointerEvents: 'none',
        }}
      >
        <svg
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
          viewBox="0 0 1920 1080"
          preserveAspectRatio="none"
        >
          <defs>
            <marker
              id={`arrowhead_${element.id}`}
              markerUnits="userSpaceOnUse"
              markerWidth="18"
              markerHeight="14"
              refX="18"
              refY="7"
              orient="auto"
            >
              <polygon points="0 0, 18 7, 0 14" fill="#2563eb" />
            </marker>
          </defs>
          <line
            x1={lineStartX}
            y1={lineStartY}
            x2={lineEndX}
            y2={lineEndY}
            stroke="#2563eb"
            strokeWidth="5"
            strokeDasharray={isDashed ? '10,10' : `${pathLength}`}
            strokeDashoffset={
              drawProgress < 1 && animType === 'draw_in'
                ? pathLength * (1 - drawProgress)
                : '0'
            }
            markerEnd={hasArrow && drawProgress >= 0.95 ? `url(#arrowhead_${element.id})` : undefined}
          />
        </svg>

        {/* Floating Connector Label — fades in after line is 70% drawn */}
        {(element.content || element.label) && (
          <div
            style={{
              position: 'absolute',
              top: `${midY}%`,
              left: `${midX}%`,
              transform: 'translate(-50%, -50%)',
              backgroundColor: '#ffffff',
              border: '2px solid #2563eb',
              borderRadius: '12px',
              padding: '4px 14px',
              fontSize: '14px',
              fontWeight: 800,
              color: '#1e40af',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.2)',
              whiteSpace: 'nowrap',
              opacity: labelProgress,
            }}
          >
            {element.content || element.label}
          </div>
        )}
      </div>
    );
  }

  // ── Image Element (static image, video, or SVG) ──
  if (element.type === 'image') {
    const rawAsset = element.sourceAssetId || element.imageDescription || element.content || 'concept';
    let imageSrc = rawAsset;
    let resolvedSvgHtml: string | null = null;

    // Check if rawAsset is a real photo PNG/JPG file path or URL
    const isLocalFilePath = rawAsset.includes('/') || rawAsset.endsWith('.png') || rawAsset.endsWith('.jpg') || rawAsset.endsWith('.jpeg') || rawAsset.endsWith('.webp');

    if (isLocalFilePath) {
      imageSrc = rawAsset.startsWith('http') || rawAsset.startsWith('data:') ? rawAsset : staticFile(rawAsset);
    } else {
      const resolvedAsset = getAsset(rawAsset);
      if (resolvedAsset && resolvedAsset.svgDataUrl) {
        imageSrc = resolvedAsset.svgDataUrl;
      }
    }

    if (imageSrc.startsWith('data:image/svg+xml;base64,')) {
      try {
        const base64Content = imageSrc.replace('data:image/svg+xml;base64,', '');
        resolvedSvgHtml = typeof window !== 'undefined'
          ? decodeURIComponent(escape(atob(base64Content)))
          : Buffer.from(base64Content, 'base64').toString('utf-8');
      } catch {
        resolvedSvgHtml = null;
      }
    } else if (imageSrc.startsWith('data:image/svg+xml;utf8,')) {
      resolvedSvgHtml = decodeURIComponent(imageSrc.replace('data:image/svg+xml;utf8,', ''));
    }

    const hasImageDimensions =
      sceneImageWidth && sceneImageHeight && sceneImageWidth > 0 && sceneImageHeight > 0;

    // Whiteboard wipe-right: clip-path animation
    const wipeClipPath = whiteboardMode && (animType === 'wipe_right' || animType === 'draw_in')
      ? `inset(0 ${(1 - drawProgress) * 100}% 0 0)`
      : undefined;

    // Video playback
    const hasVideo = !!element.videoUrl;

    return (
      <div
        style={{
          position: 'absolute',
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.width}%`,
          height: `${element.height}%`,
          zIndex: element.zIndex || 1,
          opacity: whiteboardMode && animType === 'wipe_right' ? 1 : opacity,
          transform,
          display: hasVideo ? 'block' : 'flex',
          flexDirection: hasVideo ? undefined : 'column',
          alignItems: hasVideo ? undefined : 'center',
          justifyContent: hasVideo ? undefined : 'center',
          padding: hasVideo ? '0px' : (hasImageDimensions || annotationConfig?.showTitle === false) ? '0px' : '4px',
          overflow: 'hidden',
          clipPath: wipeClipPath,
          pointerEvents: opacity === 0 ? 'none' : 'auto',
        }}
      >
        {/* Inline Graphic / Picture / Video Asset */}
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            ...(hasVideo || annotationConfig?.showTitle === false
              ? {}
              : { filter: 'drop-shadow(0 8px 16px rgba(15, 23, 42, 0.08))' }),
          }}
        >
          {hasVideo ? (
            <OffthreadVideo
              src={element.videoUrl!}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : resolvedSvgHtml ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                overflow: 'hidden',
              }}
              dangerouslySetInnerHTML={{
                __html: resolvedSvgHtml.replace(
                  /<svg([^>]*)>/i,
                  '<svg$1 preserveAspectRatio="none" style="width:100%; height:100%;">'
                ),
              }}
            />
          ) : (imageSrc.startsWith('http') || imageSrc.startsWith('data:') || imageSrc.startsWith('/')) ? (
            imageSrc.startsWith('data:image/') ? (
              // eslint-disable-next-line @remotion/warn-native-media-tag -- data: URLs require native <img> (Remotion <Img> fails on data: URLs)
              <img
                src={imageSrc}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: hasImageDimensions ? 'fill' : 'contain',
                  ...(annotationConfig?.showTitle === false
                    ? {}
                    : { filter: 'drop-shadow(0 8px 18px rgba(15, 23, 42, 0.12))' }),
                }}
              />
            ) : (
            <TransparentImageCutout
              src={imageSrc}
              preserveBackground
              style={{ width: '100%', height: '100%', objectFit: hasImageDimensions ? 'fill' : 'contain' }}
            />
            )
          ) : null}

          {/* Element-level Highlight Overlay */}
          {element.highlightOverlay && (
            <HighlightOverlay
              element={element}
              currentTimeMs={currentTimeMs}
              fps={fps}
              annotationConfig={annotationConfig}
            />
          )}

          {/* Region-level annotations — absolute overlay on image area */}
          {sceneRegionEvents && sceneRegionEvents.length > 0 && (() => {
            const currentTimeSec = currentTimeMs / 1000;
            const elementEvents = sceneRegionEvents
              .filter((ev) => ev.elementId === element.id)
              .sort((a, b) => a.startSeconds - b.startSeconds);

            const activeEvents = elementEvents.filter(
              (ev) =>
                currentTimeSec >= ev.startSeconds &&
                currentTimeSec <= ev.endSeconds
            );
            if (activeEvents.length === 0) return null;
            return activeEvents.map((activeEvent) => {
              const detectedRegion = sceneDetectedRegions?.find(
                (r) => r.id === activeEvent.regionId
              );
              if (!detectedRegion) return null;
              const bb = detectedRegion.boundingBox;
              const highlightColor = annotationConfig?.highlightColor || '#ef4444';
              const borderWidth = annotationConfig?.highlightBorderWidth ?? 3;
              const pointerColor = annotationConfig?.pointerColor || '#ef4444';
              const showHighlights = annotationConfig?.showHighlights !== false;
              const showPointer = annotationConfig?.showPointer !== false;
              const rgb = hexToRgb(highlightColor) || { r: 239, g: 68, b: 68 };
              
              const centerX = bb.x + bb.width / 2;
              const centerY = bb.y + bb.height / 2;

              // Find previous event for smooth gliding
              const activeIndex = elementEvents.findIndex((e) => e === activeEvent);
              const prevEvent = activeIndex > 0 ? elementEvents[activeIndex - 1] : null;
              let prevX = centerX;
              let prevY = centerY;

              if (prevEvent) {
                const prevDetectedRegion = sceneDetectedRegions?.find(
                  (r) => r.id === prevEvent.regionId
                );
                if (prevDetectedRegion) {
                  prevX = prevDetectedRegion.boundingBox.x + prevDetectedRegion.boundingBox.width / 2;
                  prevY = prevDetectedRegion.boundingBox.y + prevDetectedRegion.boundingBox.height / 2;
                }
              }

              const eventStartFrame = Math.round(activeEvent.startSeconds * fps);
              const eventActiveFrame = frame - eventStartFrame;

              return (
                <React.Fragment key={`${activeEvent.regionId}_${activeEvent.startSeconds}`}>
                  {showHighlights && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${bb.x}%`,
                        top: `${bb.y}%`,
                        width: `${bb.width}%`,
                        height: `${bb.height}%`,
                        border: `${borderWidth}px solid ${highlightColor}`,
                        borderRadius: 8,
                        boxShadow: `0 0 24px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`,
                        pointerEvents: 'none',
                        zIndex: 25,
                      }}
                    />
                  )}
                  {showPointer && (
                    <PointerLaser
                      targetX={centerX}
                      targetY={centerY}
                      prevX={prevX}
                      prevY={prevY}
                      active={true}
                      activeFrame={eventActiveFrame}
                      transitionFrames={15}
                      color={pointerColor}
                    />
                  )}
                </React.Fragment>
              );
            });
          })()}
        </div>
      </div>
    );
  }

  // ── Text Element ──
  if (element.type === 'text') {
    if (annotationConfig?.showTitle === false) {
      return null;
    }

    // Split title:subtitle if colon exists
    const rawContent = element.content || '';
    const colonIdx = rawContent.indexOf(':');
    const hasSubtitle = colonIdx > 0 && colonIdx < rawContent.length - 1;
    const title = hasSubtitle ? rawContent.substring(0, colonIdx).trim() : rawContent;
    const subtitle = hasSubtitle ? rawContent.substring(colonIdx + 1).trim() : '';

    // Whiteboard typewriter: show progressively more characters
    const displayedTitle = whiteboardMode
      ? title.substring(0, Math.ceil(title.length * drawProgress))
      : title;
    const displayedSubtitle = whiteboardMode && hasSubtitle
      ? subtitle.substring(0, Math.ceil(subtitle.length * Math.max(0, drawProgress - 0.3) / 0.7))
      : subtitle;

    return (
      <div
        style={{
          position: 'absolute',
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.width}%`,
          zIndex: element.zIndex || 10,
          opacity,
          transform,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          pointerEvents: 'none',
        }}
      >
        <span style={{
          fontSize: '44px',
          fontWeight: 700,
          color: '#0f172a',
          letterSpacing: '-0.5px',
          lineHeight: 1.15,
        }}>
          {displayedTitle}
          {whiteboardMode && drawProgress < 1 && drawProgress > 0 && (
            <span style={{ opacity: 0.6, animation: 'none' }}>|</span>
          )}
        </span>
        {hasSubtitle && (
          <span style={{
            fontSize: '20px',
            fontWeight: 400,
            color: '#64748b',
            lineHeight: 1.4,
            marginTop: '10px',
          }}>
            {displayedSubtitle}
          </span>
        )}
      </div>
    );
  }

  return null;
};
