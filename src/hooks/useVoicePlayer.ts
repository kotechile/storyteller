import { useState, useRef, useEffect, useCallback } from 'react';

export function useVoicePlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  const togglePlay = useCallback((id: string, audioUrl: string) => {
    if (!audioUrl) return;

    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    } else {
      audioRef.current = new Audio();
    }

    audioRef.current.src = audioUrl;
    
    audioRef.current.play().catch(error => {
      console.error("Audio playback blocked or failed:", error);
      setPlayingId(null);
    });
    
    setPlayingId(id);

    audioRef.current.onended = () => {
      setPlayingId(null);
    };
  }, [playingId]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlayingId(null);
  }, []);

  return { playingId, togglePlay, stopAudio };
}
