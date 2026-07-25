import fs from 'fs';
import path from 'path';
import { getApiKey } from './supabaseClient';
import { WordTimestamp } from '../types/storyboard';

export interface ElevenLabsTtsOptions {
  voiceId?: string; // Default: '21m00Tcm4TlvDq8ikWAM' (Rachel) or custom voice
  modelId?: string; // Default: 'eleven_multilingual_v2'
  stability?: number;
  similarityBoost?: number;
}

export interface TtsSynthesisResult {
  audioBuffer: ArrayBuffer | null;
  audioUrl?: string;
  wordTimestamps: WordTimestamp[];
  durationSeconds: number;
}

/**
 * Synthesizes narration text using ElevenLabs API with word-level timestamps.
 * Dynamically resolves API key from Supabase `api_keys` table.
 * Saves output audio MP3 file to public/narration.mp3 and out/narration.mp3.
 */
export async function synthesizeElevenLabsSpeech(
  text: string,
  options: ElevenLabsTtsOptions = {}
): Promise<TtsSynthesisResult> {
  const apiKey = await getApiKey('elevenlabs');
  const voiceId = options.voiceId || '21m00Tcm4TlvDq8ikWAM'; // Default Rachel voice
  const modelId = options.modelId || 'eleven_multilingual_v2';

  if (!apiKey) {
    console.warn('[ElevenLabsTTS] No ElevenLabs API key found in Supabase or ENV. Generating fallback timestamps.');
    return generateFallbackTimestamps(text);
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: options.stability ?? 0.5,
            similarity_boost: options.similarityBoost ?? 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ElevenLabsTTS] Synthesis API error:', errText);
      return generateFallbackTimestamps(text);
    }

    const json = await response.json();
    if (json.alignment) {
      const wordTimestamps = extractWordTimestampsFromAlignment(
        json.alignment.characters,
        json.alignment.character_start_times_seconds,
        json.alignment.character_end_times_seconds
      );

      const totalDuration =
        wordTimestamps.length > 0 ? wordTimestamps[wordTimestamps.length - 1].end : text.split(' ').length * 0.4;

      let audioUrl: string | undefined = undefined;

      if (json.audio_base64) {
        const buf = Buffer.from(json.audio_base64, 'base64');
        saveAudioToDisk(buf);
        audioUrl = 'narration.mp3';
      }

      return {
        audioBuffer: json.audio_base64 ? Buffer.from(json.audio_base64, 'base64').buffer : null,
        audioUrl,
        wordTimestamps,
        durationSeconds: totalDuration,
      };
    }
  } catch (err) {
    console.error('[ElevenLabsTTS] Exception during TTS synthesis:', err);
  }

  return generateFallbackTimestamps(text);
}

function saveAudioToDisk(buf: Buffer) {
  try {
    const publicPath = path.join(process.cwd(), 'public', 'narration.mp3');
    const outPath = path.join(process.cwd(), 'out', 'narration.mp3');
    fs.mkdirSync(path.dirname(publicPath), { recursive: true });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(publicPath, buf);
    fs.writeFileSync(outPath, buf);
    console.log(`[ElevenLabsTTS] Audio saved successfully to public/narration.mp3`);
  } catch (err) {
    console.warn('[ElevenLabsTTS] Error saving audio to disk:', err);
  }
}

/**
 * Converts character-level timestamps from ElevenLabs into word-level timestamps.
 */
function extractWordTimestampsFromAlignment(
  chars: string[],
  starts: number[],
  ends: number[]
): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  let currentWord = '';
  let wordStart = -1;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const startTime = starts[i];
    const endTime = ends[i];

    if (/\s/.test(char)) {
      if (currentWord.trim().length > 0) {
        words.push({
          word: currentWord.trim(),
          start: wordStart,
          end: endTime,
        });
        currentWord = '';
        wordStart = -1;
      }
    } else {
      if (wordStart === -1) wordStart = startTime;
      currentWord += char;
    }
  }

  if (currentWord.trim().length > 0 && wordStart !== -1) {
    words.push({
      word: currentWord.trim(),
      start: wordStart,
      end: ends[ends.length - 1] || wordStart + 0.3,
    });
  }

  return words;
}

/**
 * Fallback word-level timestamp estimator when API key is unconfigured.
 */
export function generateFallbackTimestamps(text: string, estimatedWordsPerMinute = 150): TtsSynthesisResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const secondsPerWord = 60 / estimatedWordsPerMinute;
  const wordTimestamps: WordTimestamp[] = [];

  let currentTime = 0.2; // Small initial padding

  for (const word of words) {
    const pauseMultiplier = /[.,;!?]/.test(word) ? 1.4 : 1.0;
    const duration = secondsPerWord * pauseMultiplier;

    wordTimestamps.push({
      word,
      start: parseFloat(currentTime.toFixed(3)),
      end: parseFloat((currentTime + duration).toFixed(3)),
    });

    currentTime += duration;
  }

  return {
    audioBuffer: null,
    audioUrl: undefined,
    wordTimestamps,
    durationSeconds: parseFloat(currentTime.toFixed(3)),
  };
}
