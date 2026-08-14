import fs from 'fs';
import path from 'path';

// ==========================================
// Music Track Types
// ==========================================

export interface MusicTrack {
  id: string;
  filename: string;       // Local filename if uploaded, empty if URL-based
  name: string;
  artist: string;
  genre: string;
  mood: string;
  bpm: number;
  durationSeconds: number;
  source: 'url' | 'local'; // 'url' = remote URL, 'local' = file in public/music/
  url: string;             // Remote URL or empty if local
  description: string;
}

export interface MusicLibrary {
  tracks: MusicTrack[];
}

const DEFAULT_BROWSER_TRACKS: MusicTrack[] = [
  {
    id: 'system-architecture',
    filename: 'System_Architecture.mp3',
    name: 'System Architecture Theme',
    artist: 'OmniCast Music',
    genre: 'Corporate Ambient',
    mood: 'Focused & Technological',
    bpm: 110,
    durationSeconds: 180,
    source: 'local',
    url: '',
    description: 'Tech explainer theme for system architecture videos',
  },
  {
    id: 'ambient-tech',
    filename: '',
    name: 'Tech Ambient Stream',
    artist: 'Digital Audio',
    genre: 'Electronic Ambient',
    mood: 'Calm & Modern',
    bpm: 95,
    durationSeconds: 200,
    source: 'url',
    url: 'https://assets.mixkit.co/music/preview/mixkit-tech-house-vibes-130.mp3',
    description: 'Sleek background beats for tutorial walkthroughs',
  },
];

function getMusicDir(): string {
  if (typeof process !== 'undefined' && typeof process.cwd === 'function' && path && typeof path.join === 'function') {
    return path.join(process.cwd(), 'public', 'music');
  }
  return 'public/music';
}

function getTracksJsonPath(): string {
  if (typeof process !== 'undefined' && typeof process.cwd === 'function' && path && typeof path.join === 'function') {
    return path.join(getMusicDir(), 'tracks.json');
  }
  return 'public/music/tracks.json';
}

// ==========================================
// Library Operations
// ==========================================

/**
 * Loads the full music library from public/music/tracks.json.
 * Also scans the directory for any .mp3 files not yet in the manifest
 * and auto-registers them as local tracks.
 */
export function loadMusicLibrary(): MusicLibrary {
  if (typeof window !== 'undefined' || !fs || typeof fs.existsSync !== 'function') {
    return { tracks: DEFAULT_BROWSER_TRACKS };
  }

  ensureMusicDir();

  let library: MusicLibrary = { tracks: DEFAULT_BROWSER_TRACKS };

  // Load the manifest
  try {
    const tracksJsonPath = getTracksJsonPath();
    if (fs.existsSync(tracksJsonPath)) {
      const raw = fs.readFileSync(tracksJsonPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.tracks && Array.isArray(parsed.tracks)) {
        library = parsed;
      }
    }
  } catch (err) {
    console.warn('[MusicLibrary] Failed to parse tracks.json, using fallback library:', err);
  }

  // Scan for loose .mp3 files and auto-register them
  try {
    const musicDir = getMusicDir();
    const files = fs.readdirSync(musicDir);
    const existingFilenames = new Set(library.tracks.map(t => t.filename).filter(Boolean));

    for (const file of files) {
      if (file.endsWith('.mp3') && !existingFilenames.has(file) && file !== 'tracks.json') {
        const id = file.replace(/\.mp3$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const name = file.replace(/\.mp3$/i, '').replace(/[-_]/g, ' ');
        library.tracks.push({
          id,
          filename: file,
          name,
          artist: 'Uploaded',
          genre: 'Custom',
          mood: 'Custom',
          bpm: 100,
          durationSeconds: 180,
          source: 'local',
          url: '',
          description: `User-uploaded track: ${name}`,
        });
      }
    }
  } catch (_err) {
    // Directory might not exist yet — that's fine
  }

  return library;
}

/**
 * Returns the URL/path that Remotion should use to play this track.
 * - For local files: returns a path usable with staticFile('music/filename.mp3')
 * - For URL-based tracks: returns the URL directly
 */
export function getTrackSource(track: MusicTrack): string {
  if (track.source === 'local' && track.filename) {
    return `music/${track.filename}`;
  }
  return track.url;
}

/**
 * Saves an uploaded MP3 buffer to public/music/ and registers it in the manifest.
 */
export function saveUploadedTrack(
  filename: string,
  buffer: Buffer,
  metadata?: { name?: string; artist?: string; genre?: string; mood?: string }
): MusicTrack {
  ensureMusicDir();

  // Sanitize filename
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(getMusicDir(), safeName);

  // Write file
  fs.writeFileSync(filePath, buffer);

  // Create track entry
  const id = safeName.replace(/\.mp3$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const track: MusicTrack = {
    id,
    filename: safeName,
    name: metadata?.name || safeName.replace(/\.mp3$/i, '').replace(/[-_]/g, ' '),
    artist: metadata?.artist || 'Uploaded',
    genre: metadata?.genre || 'Custom',
    mood: metadata?.mood || 'Custom',
    bpm: 100,
    durationSeconds: 180,
    source: 'local',
    url: '',
    description: `User-uploaded track`,
  };

  // Add to manifest
  const library = loadMusicLibrary();
  // Replace existing entry with same filename if present
  const existingIdx = library.tracks.findIndex(t => t.filename === safeName);
  if (existingIdx >= 0) {
    library.tracks[existingIdx] = track;
  } else {
    library.tracks.push(track);
  }
  fs.writeFileSync(getTracksJsonPath(), JSON.stringify({ tracks: library.tracks }, null, 2));

  console.log(`[MusicLibrary] Saved uploaded track: ${safeName}`);
  return track;
}

const LOCAL_MUSIC_STORAGE_KEY = 'omnicast_custom_music_v1';

/**
 * Loads custom music tracks stored in browser localStorage.
 */
export function getCustomBrowserTracks(): MusicTrack[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_MUSIC_STORAGE_KEY);
    if (raw) {
      const parsed: MusicTrack[] = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[MusicLibrary] Error loading custom browser tracks:', err);
  }
  return [];
}

/**
 * Saves a custom uploaded audio track (Data URL or Object URL) into browser localStorage.
 */
export function saveCustomBrowserTrack(name: string, dataUrl: string, artist = 'Uploaded Track'): MusicTrack {
  const safeName = name.trim() || 'Uploaded Audio';
  const id = `custom_track_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const track: MusicTrack = {
    id,
    filename: '',
    name: safeName,
    artist,
    genre: 'Custom',
    mood: 'User Selected',
    bpm: 100,
    durationSeconds: 180,
    source: 'url',
    url: dataUrl,
    description: `Custom uploaded music: ${safeName}`,
  };

  if (typeof window !== 'undefined') {
    try {
      const existing = getCustomBrowserTracks();
      const updated = [track, ...existing];
      localStorage.setItem(LOCAL_MUSIC_STORAGE_KEY, JSON.stringify(updated));
      console.log(`[MusicLibrary] Registered custom browser track '${safeName}' (${id}) to localStorage.`);
    } catch (err) {
      console.warn('[MusicLibrary] Error saving custom track to localStorage:', err);
    }
  }

  return track;
}

/**
 * Resolves a track ID to its play URL/path for Remotion Player.
 */
export function getTrackSourceById(id: string): string {
  if (!id) return '';
  const tracks = getTrackList();
  const matched = tracks.find((t) => t.id === id);
  if (!matched) return '';
  return getTrackSource(matched);
}

/**
 * Returns a human-readable list of tracks combining built-in presets and user-uploaded custom tracks.
 */
export function getTrackList(): MusicTrack[] {
  const baseTracks = loadMusicLibrary().tracks;
  const customTracks = getCustomBrowserTracks();
  const existingIds = new Set(baseTracks.map((t) => t.id));
  const uniqueCustoms = customTracks.filter((t) => !existingIds.has(t.id));
  return [...baseTracks, ...uniqueCustoms];
}

/**
 * Finds a track by its ID.
 */
export function findTrackById(id: string): MusicTrack | undefined {
  return getTrackList().find(t => t.id === id);
}

// ==========================================
// Helpers
// ==========================================

function ensureMusicDir() {
  const musicDir = getMusicDir();
  if (fs && typeof fs.existsSync === 'function' && !fs.existsSync(musicDir)) {
    fs.mkdirSync(musicDir, { recursive: true });
  }
}

/**
 * Checks if the given source is a local file path (for staticFile resolution)
 * or a remote URL.
 */
export function isLocalTrack(track: MusicTrack): boolean {
  return track.source === 'local';
}

export function isRemoteTrack(track: MusicTrack): boolean {
  return track.source === 'url';
}
