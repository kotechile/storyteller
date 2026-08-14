export interface VoiceEntry {
  id: string;
  voiceId: string;
  name: string;
  description: string;
  gender: 'male' | 'female';
  isCustom?: boolean;
  audioUrl?: string;
  tags?: string[];
}

export const DEFAULT_VOICES: VoiceEntry[] = [
  {
    id: 'rachel',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel (Default)',
    description: 'Calm, clear, and professional female voice',
    gender: 'female',
    audioUrl: 'https://cdn.elevenlabs.io/voices/21m00Tcm4TlvDq8ikWAM/preview.mp3',
    tags: ['Professional', 'Calm', 'Corporate'],
  },
  {
    id: 'adam',
    voiceId: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    description: 'Deep, warm, conversational male voice',
    gender: 'male',
    audioUrl: 'https://cdn.elevenlabs.io/voices/pNInz6obpgDQGcFmaJgB/preview.mp3',
    tags: ['Conversational', 'Warm', 'Narration'],
  },
  {
    id: 'antoni',
    voiceId: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni',
    description: 'Friendly, energetic narration male voice',
    gender: 'male',
    audioUrl: 'https://cdn.elevenlabs.io/voices/ErXwobaYiN019PkySvjV/preview.mp3',
    tags: ['Energetic', 'Friendly', 'Tech'],
  },
  {
    id: 'bella',
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella',
    description: 'Soft, engaging storytelling female voice',
    gender: 'female',
    audioUrl: 'https://cdn.elevenlabs.io/voices/EXAVITQu4vr4xnSDxMaL/preview.mp3',
    tags: ['Storytelling', 'Soft', 'Creative'],
  },
  {
    id: 'josh',
    voiceId: 'TxGEqnHWrfWFTfGW9XjX',
    name: 'Josh',
    description: 'Energetic young male voice',
    gender: 'male',
    audioUrl: 'https://cdn.elevenlabs.io/voices/TxGEqnHWrfWFTfGW9XjX/preview.mp3',
    tags: ['Young', 'Upbeat', 'Casual'],
  },
];

const LOCAL_STORAGE_KEY = 'omnicast_custom_voices_v1';

/**
 * Loads all voices combining default presets and user-saved custom Voice IDs from localStorage.
 */
export function loadVoiceLibrary(): VoiceEntry[] {
  if (typeof window === 'undefined') return DEFAULT_VOICES;

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const customVoices: VoiceEntry[] = JSON.parse(raw);
      if (Array.isArray(customVoices) && customVoices.length > 0) {
        return [...DEFAULT_VOICES, ...customVoices];
      }
    }
  } catch (err) {
    console.warn('[VoiceLibrary] Error loading custom voices from localStorage:', err);
  }

  return DEFAULT_VOICES;
}

/**
 * Saves a new custom ElevenLabs Voice ID entry into localStorage.
 */
export function addCustomVoice(voiceId: string, name: string, description = 'User custom ElevenLabs voice', gender: 'male' | 'female' = 'male'): VoiceEntry {
  const cleanVoiceId = voiceId.trim();
  const safeName = name.trim() || `Custom Voice (${cleanVoiceId.substring(0, 6)})`;
  const id = `custom_${cleanVoiceId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

  const newEntry: VoiceEntry = {
    id,
    voiceId: cleanVoiceId,
    name: safeName,
    description,
    gender,
    isCustom: true,
  };

  if (typeof window !== 'undefined') {
    try {
      const existingVoices = loadVoiceLibrary().filter((v) => v.isCustom && v.voiceId !== cleanVoiceId);
      const updatedCustoms = [...existingVoices, newEntry];
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedCustoms));
      console.log(`[VoiceLibrary] Registered custom voice '${safeName}' (${cleanVoiceId}) to localStorage.`);
    } catch (err) {
      console.warn('[VoiceLibrary] Error saving custom voice to localStorage:', err);
    }
  }

  return newEntry;
}

/**
 * Resolves a Voice ID code from a voice entry ID or returns default Rachel voiceId.
 */
export function resolveVoiceId(idOrVoiceId: string): string {
  const library = loadVoiceLibrary();
  const matched = library.find((v) => v.id === idOrVoiceId || v.voiceId === idOrVoiceId);
  if (matched) return matched.voiceId;
  return idOrVoiceId.trim() || '21m00Tcm4TlvDq8ikWAM';
}
