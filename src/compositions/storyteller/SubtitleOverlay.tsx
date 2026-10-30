import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import { SubtitleConfig, WordTimestamp } from '../../types/storyboard';

interface SubtitleOverlayProps {
  /** Per-scene word timestamps (times relative to scene start = 0) */
  wordTimestamps: WordTimestamp[];
  /** Full narration text for this scene (fallback if no wordTimestamps) */
  narration: string;
  /** Subtitle style configuration */
  config?: SubtitleConfig;
  /** Composition FPS for frame-to-second conversion */
  fps: number;
  /** Scene duration in seconds — used for fallback chunking when no timestamps */
  sceneDurationSec: number;
}

/** A chunk of words that fits in ~1-2 lines */
interface SubtitleChunk {
  words: WordTimestamp[];
  startSec: number;
  endSec: number;
}

/**
 * SubtitleOverlay renders synchronized subtitles positioned above the bottom edge.
 * With TTS timestamps: groups words into 1-2 line chunks, auto-advances,
 * highlights the current spoken word.
 * Without timestamps: splits narration into ~10-word chunks and advances
 * based on elapsed time within the scene, with estimated word highlighting.
 */
export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  wordTimestamps,
  narration,
  config,
  fps,
  sceneDurationSec,
}) => {
  const frame = useCurrentFrame();
  const currentTimeSec = frame / fps;

  const fontSize = config?.fontSize ?? 44;
  const color = config?.color ?? '#FFFFFF';
  const backgroundColor = config?.backgroundColor ?? 'rgba(0, 0, 0, 0.65)';
  const highlightActiveWord = config?.highlightActiveWord !== false;
  const activeWordColor = config?.activeWordColor ?? '#FFD700';

  const hasTimestamps = wordTimestamps && wordTimestamps.length > 0;

  // ── Mode 1: Word-level timestamps from TTS ──

  const ttsChunks: SubtitleChunk[] = useMemo(() => {
    if (!hasTimestamps) return [];
    const MAX_WORDS_PER_CHUNK = 10;
    const result: SubtitleChunk[] = [];
    for (let i = 0; i < wordTimestamps.length; i += MAX_WORDS_PER_CHUNK) {
      const slice = wordTimestamps.slice(i, i + MAX_WORDS_PER_CHUNK);
      result.push({
        words: slice,
        startSec: slice[0].start,
        endSec: slice[slice.length - 1].end,
      });
    }
    return result;
  }, [wordTimestamps, hasTimestamps]);

  const activeTtsChunkIndex = useMemo(() => {
    if (ttsChunks.length === 0) return -1;
    const idx = ttsChunks.findIndex(
      (chunk) => currentTimeSec >= chunk.startSec && currentTimeSec <= chunk.endSec
    );
    if (idx >= 0) return idx;
    for (let i = 0; i < ttsChunks.length; i++) {
      if (currentTimeSec < ttsChunks[i].startSec) return i;
    }
    return ttsChunks.length - 1;
  }, [ttsChunks, currentTimeSec]);

  // ── Mode 2: Fallback — time-based chunking from raw narration ──

  const fallbackChunks = useMemo(() => {
    if (hasTimestamps) return [];
    const words = narration.split(/\s+/);
    if (words.length === 0) return [];
    const MAX_WORDS_PER_CHUNK = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < words.length; i += MAX_WORDS_PER_CHUNK) {
      chunks.push(words.slice(i, i + MAX_WORDS_PER_CHUNK));
    }
    return chunks;
  }, [narration, hasTimestamps]);

  const activeFallbackIndex = useMemo(() => {
    if (fallbackChunks.length === 0 || sceneDurationSec <= 0) return 0;
    const chunkDuration = sceneDurationSec / fallbackChunks.length;
    const idx = Math.floor(currentTimeSec / chunkDuration);
    return Math.min(idx, fallbackChunks.length - 1);
  }, [fallbackChunks, currentTimeSec, sceneDurationSec]);

  // Estimated word index within the fallback chunk
  const estimatedWordIndex = useMemo(() => {
    if (fallbackChunks.length === 0 || activeFallbackIndex < 0) return -1;
    const chunk = fallbackChunks[activeFallbackIndex];
    if (chunk.length === 0) return -1;
    const chunkDuration = sceneDurationSec / fallbackChunks.length;
    const timeInChunk = currentTimeSec - activeFallbackIndex * chunkDuration;
    const wordDuration = chunkDuration / chunk.length;
    return Math.min(Math.floor(timeInChunk / wordDuration), chunk.length - 1);
  }, [fallbackChunks, activeFallbackIndex, currentTimeSec, sceneDurationSec]);

  // ── Shared subtitle bar style ──

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '2%',
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-end',
    pointerEvents: 'none',
    zIndex: 1000,
  };

  const barStyle: React.CSSProperties = {
    backgroundColor,
    padding: '12px 36px 14px 36px',
    borderRadius: 12,
    maxWidth: '85%',
    textAlign: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '0.35em',
  };

  // ── Fallback mode: time-based chunking with estimated word highlight ──

  if (!hasTimestamps && fallbackChunks.length > 0) {
    const chunkWords = fallbackChunks[activeFallbackIndex];

    return (
      <div style={containerStyle}>
        <div style={barStyle}>
          {chunkWords.map((word, idx) => {
            const isActive = highlightActiveWord && idx === estimatedWordIndex;
            return (
              <span
                key={`fb-${activeFallbackIndex}-${idx}`}
                style={{
                  color: isActive ? activeWordColor : color,
                  fontSize,
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontWeight: isActive ? 700 : 600,
                  lineHeight: 1.4,
                  letterSpacing: '-0.01em',
                  textShadow: isActive
                    ? '0 0 12px rgba(255,215,0,0.5)'
                    : '0 1px 3px rgba(0,0,0,0.3)',
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Timestamped mode ──

  if (hasTimestamps && activeTtsChunkIndex >= 0) {
    const activeChunk = ttsChunks[activeTtsChunkIndex];
    const activeWordIdx = activeChunk.words.findIndex(
      (wt) => currentTimeSec >= wt.start && currentTimeSec < wt.end
    );

    return (
      <div style={containerStyle}>
        <div style={barStyle}>
          {activeChunk.words.map((wt, idx) => {
            const isActive = highlightActiveWord && idx === activeWordIdx;
            return (
              <span
                key={`tts-${activeTtsChunkIndex}-${idx}`}
                style={{
                  color: isActive ? activeWordColor : color,
                  fontSize,
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontWeight: isActive ? 700 : 600,
                  lineHeight: 1.4,
                  letterSpacing: '-0.01em',
                  textShadow: isActive
                    ? '0 0 12px rgba(255,215,0,0.5)'
                    : '0 1px 3px rgba(0,0,0,0.3)',
                }}
              >
                {wt.word}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
};
