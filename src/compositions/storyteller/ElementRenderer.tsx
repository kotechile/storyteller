import React from 'react';
import { interpolate, useCurrentFrame, staticFile } from 'remotion';
import { CanvasElement } from '../../types/storyboard';
import { HighlightOverlay } from './HighlightOverlay';
import { TransparentImageCutout } from './TransparentImageCutout';
import { getAsset } from '../../lib/assetLibrary';

interface ElementRendererProps {
  element: CanvasElement;
  allSceneElements?: CanvasElement[];
  currentTimeMs: number;
  fps: number;
}

export const ElementRenderer: React.FC<ElementRendererProps> = ({
  element,
  allSceneElements = [],
  currentTimeMs,
  fps,
}) => {
  const frame = useCurrentFrame();

  const delayFrames = element.enterAnimation?.delay ?? 0;
  const animDuration = element.enterAnimation?.duration ?? 15;

  let opacity = 0;
  let transform = 'none';

  if (frame >= delayFrames) {
    const animProgress = Math.min((frame - delayFrames) / animDuration, 1);
    opacity = interpolate(animProgress, [0, 1], [0, 1], { extrapolateRight: 'clamp' });

    const animType = element.enterAnimation?.type || 'fade_in';
    if (animType === 'slide_up') {
      const translateY = interpolate(animProgress, [0, 1], [25, 0], { extrapolateRight: 'clamp' });
      transform = `translateY(${translateY}px)`;
    } else if (animType === 'scale_in' || animType === 'zoom_in') {
      const scale = interpolate(animProgress, [0, 1], [0.85, 1.0], { extrapolateRight: 'clamp' });
      transform = `scale(${scale})`;
    }
  }

  if (element.type === 'highlight_overlay') {
    if (frame < delayFrames) return null;
    return <HighlightOverlay element={element} currentTimeMs={currentTimeMs} fps={fps} />;
  }

  // Dynamic Directional Vector Connector linking source to destination elements
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
        // Flowing downward (fromEl above toEl)
        // Tree Branching: Left arrows branch off source left corner, Right arrows off right corner
        if (deltaX < -10) {
          startX = fromEl.x + 2; // Left bottom corner of source card
        } else if (deltaX > 10) {
          startX = fromEl.x + fromEl.width - 2; // Right bottom corner of source card
        } else {
          startX = fromCenter.x; // Center bottom
        }
        startY = fromEl.y + fromEl.height + (fromEl.content ? 6.5 : 1.5); // Starts cleanly below source caption badge!
        endX = toCenter.x;
        endY = toEl.y - 2.0; // Stops cleanly above destination card
      } else if (deltaX > 12) {
        // Flowing left to right
        startX = fromEl.x + fromEl.width; // right edge
        startY = fromCenter.y;
        endX = toEl.x; // left edge
        endY = toCenter.y;
      } else if (deltaX < -12) {
        // Flowing right to left
        startX = fromEl.x; // left edge
        startY = fromCenter.y;
        endX = toEl.x + toEl.width; // right edge
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

    let midX = (startX + endX) / 2;
    let midY = (startY + endY) / 2;

    if (fromEl && toEl && (toEl.y - fromEl.y) > 12) {
      // Downward flow: position floating label badge 55% down the open gap between bottom of source caption and top of child card
      midY = startY + (endY - startY) * 0.55;
    }

    // Convert percentages (0-100) to 1920x1080 viewBox coordinates so 1 unit X = 1 unit Y
    const startX_px = startX * 19.2;
    const startY_px = startY * 10.8;
    const endX_px = endX * 19.2;
    const endY_px = endY * 10.8;

    // Calculate direction vector to pad line ends so arrowhead tip stops cleanly outside cards
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
      lineStartX = startX_px + uX * 8; // 8px gap outside source element
      lineStartY = startY_px + uY * 8;
      lineEndX = endX_px - uX * 22; // 22px gap before destination element so arrowhead tip doesn't overlap image
      lineEndY = endY_px - uY * 22;
    }

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
            strokeDasharray={isDashed ? '10,10' : undefined}
            markerEnd={hasArrow ? `url(#arrowhead_${element.id})` : undefined}
          />
        </svg>

        {/* Floating Connector Label */}
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
            }}
          >
            {element.content || element.label}
          </div>
        )}
      </div>
    );
  }

  // Frameless Hybrid Image Element (Photorealistic Pictures & 3D Vectors)
  if (element.type === 'image') {
    let rawAsset = element.sourceAssetId || 'money';
    let imageSrc = rawAsset;
    let resolvedSvgHtml: string | null = null;

    // Check if rawAsset is a real photo PNG/JPG file path or URL
    const isLocalFilePath = rawAsset.includes('/') || rawAsset.endsWith('.png') || rawAsset.endsWith('.jpg') || rawAsset.endsWith('.jpeg') || rawAsset.endsWith('.webp');

    if (isLocalFilePath) {
      imageSrc = rawAsset.startsWith('http') || rawAsset.startsWith('data:') ? rawAsset : staticFile(rawAsset);
    } else if (rawAsset.startsWith('asset:')) {
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

    return (
      <div
        style={{
          position: 'absolute',
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.width}%`,
          height: `${element.height}%`,
          zIndex: element.zIndex || 1,
          opacity,
          transform,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px',
          overflow: 'visible',
          pointerEvents: opacity === 0 ? 'none' : 'auto',
        }}
      >
        {/* Inline Graphic / Picture Asset */}
        <div
          style={{
            flex: 1,
            width: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            filter: 'drop-shadow(0 8px 16px rgba(15, 23, 42, 0.08))',
          }}
        >
          {resolvedSvgHtml ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
              dangerouslySetInnerHTML={{
                __html: resolvedSvgHtml.replace(
                  /<svg([^>]*)>/i,
                  '<svg$1 preserveAspectRatio="xMidYMid meet" style="max-width:100%; max-height:100%; object-fit:contain;">'
                ),
              }}
            />
          ) : (
            <TransparentImageCutout src={imageSrc} />
          )}
        </div>

        {/* Presentation Caption */}
        {element.content && (
          <div
            style={{
              marginTop: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1.5px solid #cbd5e1',
              borderRadius: '8px',
              padding: '4px 10px',
              fontSize: '14px',
              fontWeight: 800,
              color: '#0f172a',
              textAlign: 'center',
              lineHeight: 1.25,
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              maxWidth: '120%',
              boxShadow: '0 4px 10px rgba(15, 23, 42, 0.05)',
              flexShrink: 0,
            }}
          >
            {element.content}
          </div>
        )}
      </div>
    );
  }

  if (element.type === 'text') {
    const dynamicTitleFontSize = Math.max(22, Math.min(38, Math.round(element.width * 0.65 + element.height * 0.4)));

    return (
      <div
        style={{
          position: 'absolute',
          left: `${element.x}%`,
          top: `${element.y}%`,
          width: `${element.width}%`,
          height: `${element.height}%`,
          zIndex: element.zIndex || 10,
          opacity,
          transform,
          fontFamily: 'Inter, system-ui, sans-serif',
          display: 'flex',
          alignItems: 'center',
          pointerEvents: opacity === 0 ? 'none' : 'auto',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            border: '2.5px solid #3b82f6',
            borderRadius: '14px',
            padding: '10px 24px',
            boxShadow: '0 8px 20px -3px rgba(59, 130, 246, 0.18)',
            fontSize: `${dynamicTitleFontSize}px`,
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.01em',
          }}
        >
          {element.content}
        </div>
      </div>
    );
  }

  return null;
};
