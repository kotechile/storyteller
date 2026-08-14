import fs from 'fs';
import path from 'path';
import { getApiKey } from './supabaseClient';
import { WordTimestamp, SceneAudio } from '../types/storyboard';
import { fetchWithRetry } from './ingest';

export interface ElevenLabsTtsOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number; // 0.7–1.2, slower = more deliberate
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
export function generateFallbackTimestamps(text: string, estimatedWordsPerMinute = 150): {
  audioBuffer: null;
  audioUrl: undefined;
  wordTimestamps: WordTimestamp[];
  durationSeconds: number;
} {
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

/**
 * Synthesizes narration PER SCENE — one ElevenLabs API call for each scene.
 * Each scene gets its own MP3 file and isolated word timestamps.
 * Scene duration = ElevenLabs-reported duration (deterministic, no character math).
 * 
 * This eliminates the fragile character-level alignment between scenes.
 * Image, audio, and scene sequence all share the same duration by construction.
 */
export async function synthesizePerSceneSpeech(
  scenes: Array<{ sceneNumber: number; narration: string }>,
  options: ElevenLabsTtsOptions = {}
): Promise<SceneAudio[]> {
  const apiKey = await getApiKey('elevenlabs');
  const voiceId = options.voiceId || '21m00Tcm4TlvDq8ikWAM';
  const modelId = options.modelId || 'eleven_multilingual_v2'; // Must support /with-timestamps + audio_base64

  if (!apiKey) {
    console.warn('[ElevenLabsTTS] No ElevenLabs API key found. Using fallback timestamps per scene.');
    return scenes.map((scene) => {
      const fallback = generateFallbackTimestamps(scene.narration);
      return {
        sceneNumber: scene.sceneNumber,
        audioUrl: '', // no audio file
        wordTimestamps: fallback.wordTimestamps,
        durationSeconds: fallback.durationSeconds,
      };
    });
  }

  const results: SceneAudio[] = [];

  // Process sequentially to respect ElevenLabs rate limits
  for (const scene of scenes) {
    const { sceneNumber, narration } = scene;

    if (!narration || narration.trim().length === 0) {
      results.push({
        sceneNumber,
        audioUrl: '',
        wordTimestamps: [],
        durationSeconds: 1.0,
      });
      continue;
    }

    console.log(`[ElevenLabsTTS] Synthesizing scene ${sceneNumber} (${narration.length} chars)...`);

    try {
      const response = await fetchWithRetry(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({
            text: narration,
            model_id: modelId,
            voice_settings: {
              stability: options.stability ?? 0.5,
              similarity_boost: options.similarityBoost ?? 0.75,
              speed: options.speed ?? 0.9,
            },
          }),
          signal: AbortSignal.timeout(120000),
        },
        3,
        2000
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[ElevenLabsTTS] Scene ${sceneNumber} synthesis error:`, errText);
        const fallback = generateFallbackTimestamps(narration);
        results.push({
          sceneNumber,
          audioUrl: '',
          wordTimestamps: fallback.wordTimestamps,
          durationSeconds: fallback.durationSeconds,
        });
        continue;
      }

      const json = await response.json();

      // Debug: log response keys to diagnose missing audio_base64
      if (!json.audio_base64) {
        console.warn(`[ElevenLabsTTS] Scene ${sceneNumber}: no audio_base64 in response. Keys:`, Object.keys(json).join(', '));
        console.warn(`[ElevenLabsTTS] Response snippet:`, JSON.stringify(json).substring(0, 300));
      }

      if (json.alignment) {
        const wordTimestamps = extractWordTimestampsFromAlignment(
          json.alignment.characters,
          json.alignment.character_start_times_seconds,
          json.alignment.character_end_times_seconds
        );

        const durationSeconds =
          wordTimestamps.length > 0
            ? wordTimestamps[wordTimestamps.length - 1].end + 0.3 // small tail padding
            : narration.split(' ').length * 0.4;

        // Save per-scene audio file with timestamp to bust browser cache
        const ts = Date.now();
        let sceneAudioUrl = `scene_${sceneNumber}_${ts}.mp3`;
        if (json.audio_base64) {
          try {
            const buf = Buffer.from(json.audio_base64, 'base64');
            const publicPath = path.join(process.cwd(), 'public', sceneAudioUrl);
            const outPath = path.join(process.cwd(), 'out', sceneAudioUrl);
            fs.mkdirSync(path.dirname(publicPath), { recursive: true });
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(publicPath, buf);
            fs.writeFileSync(outPath, buf);
          } catch (e) {
            console.warn(`[ElevenLabsTTS] Could not write MP3 file for scene ${sceneNumber}, falling back to data URL:`, e);
            sceneAudioUrl = `data:audio/mp3;base64,${json.audio_base64}`;
          }
        }

        results.push({
          sceneNumber,
          audioUrl: sceneAudioUrl,
          wordTimestamps,
          durationSeconds,
        });

        console.log(`[ElevenLabsTTS] Scene ${sceneNumber}: ${durationSeconds.toFixed(1)}s, ${wordTimestamps.length} words`);
      } else {
        const fallback = generateFallbackTimestamps(narration);
        results.push({
          sceneNumber,
          audioUrl: '',
          wordTimestamps: fallback.wordTimestamps,
          durationSeconds: fallback.durationSeconds,
        });
      }
    } catch (err) {
      console.error(`[ElevenLabsTTS] Scene ${sceneNumber} exception:`, err);
      const fallback = generateFallbackTimestamps(narration);
      results.push({
        sceneNumber,
        audioUrl: '',
        wordTimestamps: fallback.wordTimestamps,
        durationSeconds: fallback.durationSeconds,
      });
    }

    // Small delay between scenes to respect ElevenLabs rate limits
    if (scenes.indexOf(scene) < scenes.length - 1) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  return results;
}
