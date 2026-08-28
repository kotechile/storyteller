import React, { useRef, useState, useEffect } from 'react';
import { StoryboardManifest } from '../../types/storyboard';
import { Play, Pause, Film, Layers } from 'lucide-react';

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

const formatFrameTime = (frames: number, fps: number): string => {
  const totalSecs = frames / fps;
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.floor(totalSecs % 60);
  const f = Math.floor(frames % fps);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${f.toString().padStart(2, '0')}`;
};

const formatTimecodeHeader = (secs: number): string => {
  const mins = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

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
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    const el = timelineContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totalDuration = Math.max(1, manifest.scenes.reduce((acc, s) => acc + (s.duration || 10), 0));
  const LABEL_W = 120;
  const availableWidth = Math.max(100, containerWidth - LABEL_W);
  const pixelsPerSecond = availableWidth / totalDuration;
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

  const totalElements = manifest.scenes.reduce((acc, s) => acc + (s.layout?.elements?.length || 0), 0);

  return (
    <div
      ref={timelineContainerRef}
      className="w-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col"
    >
      {/* ═══ Transport Controls Header ═══ */}
      <div className="h-10 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors shadow-sm shadow-indigo-600/30 cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <div className="text-xs font-mono font-medium text-slate-300 bg-slate-950 px-3 py-1 rounded-md border border-slate-800/80 flex items-center gap-1.5">
            <span className="text-slate-100">{formatFrameTime(currentFrame, fps)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400">{formatFrameTime(totalFrames, fps)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
          <span className="flex items-center gap-1"><Film className="w-3.5 h-3.5 text-indigo-400" /> {manifest.scenes.length} Scenes</span>
          <span className="text-slate-700">•</span>
          <span className="flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-slate-400" /> {totalElements} Elements</span>
          <span className="text-slate-700">•</span>
          <span className="font-mono">{totalDuration.toFixed(1)}s Total</span>
        </div>
      </div>

      {/* ═══ Tracks Area ═══ */}
      <div className="relative h-21 flex bg-slate-950">
        {/* Track Label */}
        <div className="w-[120px] shrink-0 bg-slate-900 border-r border-slate-800 z-20 flex flex-col">
          <div className="h-7 border-b border-slate-800 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center bg-slate-950">
            Timecode
          </div>
          <div className="h-14 px-3 text-xs font-bold text-slate-200 flex items-center gap-1.5 bg-slate-900">
            <Film className="w-3.5 h-3.5 text-indigo-400" /> SCENES
          </div>
        </div>

        {/* Scrollable Tracks */}
        <div
          ref={scrollRef}
          onClick={handleTimelineClick}
          className="flex-1 relative overflow-hidden cursor-pointer select-none"
        >
          <div style={{ width: `${availableWidth}px` }} className="relative h-full">
            {/* Timecode Ruler */}
            <div className="h-7 bg-slate-950 border-b border-slate-800 relative">
              {Array.from({ length: Math.ceil(totalDuration / 5) + 1 }).map((_, i) => {
                const sec = i * 5;
                const px = sec * pixelsPerSecond;
                return (
                  <div
                    key={`tick-${sec}`}
                    style={{ left: `${px}px` }}
                    className="absolute bottom-1 text-[10px] font-mono text-slate-400 -translate-x-1/2 pointer-events-none"
                  >
                    {formatTimecodeHeader(sec)}
                  </div>
                );
              })}
              {/* Minor ticks every 1 second */}
              {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, i) => {
                if (i % 5 === 0) return null;
                const px = i * pixelsPerSecond;
                return (
                  <div
                    key={`tick-minor-${i}`}
                    style={{ left: `${px}px` }}
                    className="absolute top-3 bottom-0 w-px bg-slate-800 pointer-events-none"
                  />
                );
              })}
            </div>

            {/* Scene Blocks Track (h-14) */}
            <div className="h-14 relative bg-slate-950 flex items-center">
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
                      left: `${leftPx}px`,
                      width: `${Math.max(12, widthPx - 2)}px`,
                    }}
                    className={`absolute h-12 rounded-lg px-2.5 py-1.5 flex flex-col justify-center border-r border-slate-800/80 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-950/90 border border-indigo-500 shadow-md shadow-indigo-900/30 ring-1 ring-indigo-500/50'
                        : 'bg-slate-800/60 border border-slate-800 hover:bg-slate-700/60 hover:border-slate-700'
                    }`}
                    title={`Scene ${scene.sceneNumber}: ${scene.narration}`}
                  >
                    <div className="flex items-center justify-between gap-1 overflow-hidden">
                      <span className={`text-[11px] font-bold font-mono truncate ${isSelected ? 'text-indigo-300' : 'text-slate-200'}`}>
                        Scene {scene.sceneNumber}
                      </span>
                      <span className="text-[10px] font-mono font-medium text-slate-400 bg-slate-950/80 px-1.5 py-0.5 rounded shrink-0">
                        {scene.duration}s
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate leading-none mt-0.5">
                      {scene.narration}
                    </p>

                    {/* Resize handle on right */}
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
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-indigo-500/40 rounded-r-lg"
                    />
                  </div>
                );
              })}
            </div>

            {/* Vertical Playhead Line */}
            <div
              style={{ left: `${playheadPx}px` }}
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none shadow-[0_0_8px_rgba(244,63,94,0.8)]"
            >
              <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[7px] border-t-rose-500 -ml-[4px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
