import React, { useRef, useMemo, useState, useEffect } from 'react';
import { StoryboardManifest, CanvasElement } from '../../types/storyboard';

// ── Types ──

interface TimelineProps {
  manifest: StoryboardManifest;
  selectedScene: number;
  onSelectScene: (sceneIdx: number) => void;
  onUpdateSceneDuration: (sceneIdx: number, newDuration: number) => void;
  currentFrame: number;
  totalFrames: number;
  fps: number;
  onSeek: (frame: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  selectedElementId: string | null;
  onSelectElement: (elementId: string, sceneIdx: number) => void;
}

interface ElementTimelineEntry {
  element: CanvasElement;
  sceneIndex: number;
  sceneNumber: number;
  globalStartSec: number;
  globalEndSec: number;
  label: string;
  icon: string;
  color: string;
}

// ── Design Tokens (Deep Blue-Gray NLE theme) ──

const T = {
  bg: '#0F172A',
  surface: '#1E293B',
  surfaceHover: '#334155',
  border: '#334155',
  borderStrong: '#475569',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  accent: '#6366F1',
  accentGlow: 'rgba(99, 102, 241, 0.25)',
  accentBorder: '#818CF8',
  playhead: '#F43F5E',
  playheadGlow: 'rgba(244, 63, 94, 0.6)',
  sceneBg: '#1E293B',
  sceneSelected: '#312E81',
  sceneBorder: '#475569',
  imageColor: '#38BDF8',
  textColor: '#A78BFA',
  connectorColor: '#FBBF24',
  highlightColor: '#34D399',
} as const;

// ── Helpers ──

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatFrameTime(frames: number, fps: number): string {
  const s = frames / fps;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor(frames % fps);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`;
}

function getElementIcon(type: string): string {
  switch (type) {
    case 'image': return '🖼';
    case 'text': return '📝';
    case 'connector': return '↗️';
    case 'highlight_overlay': return '💡';
    default: return '●';
  }
}

function getElementColor(type: string): string {
  switch (type) {
    case 'image': return T.imageColor;
    case 'text': return T.textColor;
    case 'connector': return T.connectorColor;
    case 'highlight_overlay': return T.highlightColor;
    default: return T.textMuted;
  }
}

function buildElementTimeline(manifest: StoryboardManifest): {
  entries: ElementTimelineEntry[];
  totalDuration: number;
} {
  const entries: ElementTimelineEntry[] = [];
  let accumulatedSec = 0;

  for (let si = 0; si < manifest.scenes.length; si++) {
    const scene = manifest.scenes[si];
    const dur = scene.duration || 10;
    const sceneStart = accumulatedSec;
    const sceneEnd = accumulatedSec + dur;

    for (const el of scene.layout?.elements || []) {
      if (el.type === 'connector') continue; // connectors are auto-positioned
      const label = el.content || el.label || el.id;
      entries.push({
        element: el,
        sceneIndex: si,
        sceneNumber: scene.sceneNumber,
        globalStartSec: sceneStart,
        globalEndSec: sceneEnd,
        label: label.length > 28 ? label.substring(0, 26) + '…' : label,
        icon: getElementIcon(el.type),
        color: getElementColor(el.type),
      });
    }

    accumulatedSec += dur;
  }

  return { entries, totalDuration: Math.max(1, accumulatedSec) };
}

// ── Component ──

export const Timeline: React.FC<TimelineProps> = ({
  manifest,
  selectedScene,
  onSelectScene,
  onUpdateSceneDuration,
  currentFrame,
  totalFrames,
  fps = 30,
  onSeek,
  isPlaying,
  onTogglePlay,
  selectedElementId,
  onSelectElement,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { entries, totalDuration } = useMemo(
    () => buildElementTimeline(manifest),
    [manifest]
  );

  // ── Pixel-based timeline width — auto-scale to fit all scenes in view ──
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  useEffect(() => {
    const el = timelineContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  
  const LABEL_W = 120;
  const availableWidth = Math.max(100, containerWidth - LABEL_W);
  // Fit exact duration into available width
  const pixelsPerSecond = availableWidth / Math.max(totalDuration, 1);
  const timelinePx = availableWidth;
  const playheadPx = (currentFrame / fps) * pixelsPerSecond;

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const scrollLeft = scrollRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const secAtClick = clickX / pixelsPerSecond;
    const frame = Math.round(Math.max(0, Math.min(totalDuration, secAtClick)) * fps);
    onSeek(frame);
  };

  // ── Layout constants ──
  const HEADER_H = 30;
  const SCENE_TRACK_H = 44;

  const totalRowsHeight = HEADER_H + SCENE_TRACK_H;
  const viewportHeight = totalRowsHeight;

  return (
    <div
      ref={timelineContainerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: T.bg,
        borderRadius: '10px',
        border: `1px solid ${T.border}`,
        overflow: 'hidden',
        width: '100%',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
      }}
    >
      {/* ═══ Controls Header ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          backgroundColor: T.surface,
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Play/Pause */}
          <button
            type="button"
            onClick={onTogglePlay}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: isPlaying ? '#EF4444' : T.accent,
              color: '#FFF',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          {/* Timecode Display */}
          <div style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace', fontSize: '12px', color: T.textDim }}>
            <span style={{ color: T.text, fontWeight: 700, fontSize: '14px' }}>
              {formatFrameTime(currentFrame, fps)}
            </span>
            <span style={{ margin: '0 6px', opacity: 0.4 }}>/</span>
            <span>{formatFrameTime(totalFrames, fps)}</span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: T.textDim }}>
          {manifest.scenes.length} scenes · {entries.length} elements · {totalDuration.toFixed(0)}s
        </div>
      </div>

      {/* ═══ Timeline Grid ═══ */}
      <div
        style={{
          position: 'relative',
          height: `${viewportHeight}px`,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        {/* ── Frozen Left Labels Column ── */}
        <div
          style={{
            width: `${LABEL_W}px`,
            flexShrink: 0,
            backgroundColor: T.bg,
            borderRight: `1px solid ${T.borderStrong}`,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Corner cell (above time ruler) */}
          <div
            style={{
              height: `${HEADER_H}px`,
              borderBottom: `1px solid ${T.border}`,
              padding: '6px 12px',
              fontSize: '10px',
              fontWeight: 700,
              color: T.textDim,
              display: 'flex',
              alignItems: 'center',
              letterSpacing: '0.04em',
              backgroundColor: T.surface,
            }}
          >
            #
          </div>

          {/* Scene track label */}
          <div
            style={{
              height: `${SCENE_TRACK_H}px`,
              borderBottom: `1px solid ${T.border}`,
              padding: '10px 12px',
              fontSize: '11px',
              fontWeight: 700,
              color: T.text,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: T.surface,
            }}
          >
            <span style={{ fontSize: '13px' }}>🎬</span> SCENES
          </div>
        </div>

        {/* ── Scrollable Timeline Content ── */}
        <div
          ref={scrollRef}
          onClick={handleTimelineClick}
          style={{
            flex: 1,
            overflow: 'hidden',
            position: 'relative',
            cursor: 'crosshair',
          }}
        >
          <div style={{ width: `${timelinePx}px`, minHeight: `${totalRowsHeight}px`, position: 'relative' }}>
            {/* ── Time Ruler (sticky top) ── */}
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 15,
                height: `${HEADER_H}px`,
                backgroundColor: T.surface,
                borderBottom: `1px solid ${T.border}`,
                display: 'flex',
                alignItems: 'flex-end',
              }}
            >
              {Array.from({ length: Math.ceil(totalDuration / 5) + 1 }).map((_, i) => {
                const sec = i * 5;
                const px = sec * pixelsPerSecond;
                return (
                  <div
                    key={`tick-${sec}`}
                    style={{
                      position: 'absolute',
                      left: `${px}px`,
                      bottom: '4px',
                      fontSize: '9px',
                      fontFamily: '"JetBrains Mono", monospace',
                      color: T.textDim,
                      transform: 'translateX(-50%)',
                      pointerEvents: 'none',
                    }}
                  >
                    {formatTime(sec)}
                  </div>
                );
              })}
              {/* Minor ticks every 1s */}
              {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, i) => {
                if (i % 5 === 0) return null;
                const px = i * pixelsPerSecond;
                return (
                  <div
                    key={`tick-minor-${i}`}
                    style={{
                      position: 'absolute',
                      left: `${px}px`,
                      top: '60%',
                      height: '40%',
                      width: '1px',
                      backgroundColor: T.border,
                      pointerEvents: 'none',
                    }}
                  />
                );
              })}
            </div>

            {/* ── Scene Track (sticky below ruler) ── */}
            <div
              style={{
                position: 'sticky',
                top: `${HEADER_H}px`,
                zIndex: 14,
                height: `${SCENE_TRACK_H}px`,
                backgroundColor: T.bg,
                borderBottom: `1px solid ${T.borderStrong}`,
                display: 'flex',
                alignItems: 'center',
                padding: '2px 0',
              }}
            >
              {manifest.scenes.map((scene, idx) => {
                const leftPx = manifest.scenes
                  .slice(0, idx)
                  .reduce((a, s) => a + (s.duration || 10) * pixelsPerSecond, 0);
                const widthPx = (scene.duration || 10) * pixelsPerSecond;
                const isSelected = selectedScene === idx;

                return (
                  <div
                    key={scene.sceneNumber}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectScene(idx);
                    }}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      width: `${widthPx - 3}px`,
                      height: '34px',
                      backgroundColor: isSelected ? T.sceneSelected : T.sceneBg,
                      border: isSelected ? `2px solid ${T.accentBorder}` : `1px solid ${T.sceneBorder}`,
                      borderRadius: '7px',
                      padding: '4px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'background 0.12s, border-color 0.12s',
                    }}
                    title={`Scene ${scene.sceneNumber}: ${scene.narration.substring(0, 80)}`}
                  >
                    <div
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        color: isSelected ? '#A5B4FC' : T.text,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {scene.sceneNumber}
                      <span style={{ fontWeight: 400, opacity: 0.5, marginLeft: '4px' }}>
                        {scene.duration}s
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '9px',
                        color: T.textDim,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginTop: '1px',
                      }}
                    >
                      {scene.narration.substring(0, 40)}
                    </div>
                    {/* Drag handle — right edge */}
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const startX = e.clientX;
                        const startDur = scene.duration || 10;
                        const handleMove = (ev: MouseEvent) => {
                          const dx = ev.clientX - startX;
                          const newDur = Math.max(2, Math.round((startDur + dx / pixelsPerSecond) * 10) / 10);
                          onUpdateSceneDuration(idx, newDur);
                        };
                        const handleUp = () => {
                          document.removeEventListener('mousemove', handleMove);
                          document.removeEventListener('mouseup', handleUp);
                        };
                        document.addEventListener('mousemove', handleMove);
                        document.addEventListener('mouseup', handleUp);
                      }}
                      style={{
                        position: 'absolute',
                        right: 0, top: 0, bottom: 0,
                        width: '8px',
                        cursor: 'ew-resize',
                        backgroundColor: 'transparent',
                        borderLeft: isSelected ? `2px solid ${T.accentBorder}` : 'none',
                        borderRadius: '0 7px 7px 0',
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* ── Red Playhead ── */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${playheadPx}px`,
                width: '2px',
                backgroundColor: T.playhead,
                zIndex: 30,
                pointerEvents: 'none',
                boxShadow: `0 0 10px ${T.playheadGlow}`,
              }}
            >
              {/* Playhead triangle handle */}
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '6px solid transparent',
                  borderRight: '6px solid transparent',
                  borderTop: `8px solid ${T.playhead}`,
                  marginLeft: '-5px',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
