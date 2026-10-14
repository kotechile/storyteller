import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { ExplainerStoryComposition } from '../../compositions/storyteller/ExplainerStoryComposition';
import { sampleStoryboardManifest } from '../../lib/sampleData';
import { StoryboardManifest, CameraInstruction, ImageStylePreset, SceneAudio, AnnotationConfig, CanvasElement } from '../../types/storyboard';
import { LightingPreset } from '../../compositions/storyteller/BackgroundRenderer';
import { ingestUrl, ingestPdf } from '../../lib/ingest';
import { generateContextAwareStoryboard, generateVideosForManifest, ContentContext } from '../../lib/contextEngine';
import { animateImage, generateVideo } from '../../lib/imageToVideo';
import { MusicTrack, getTrackSourceById, saveCustomBrowserTrack, getTrackList } from '../../lib/musicLibrary';
import { loadVoiceLibrary, addCustomVoice, resolveVoiceId, VoiceEntry } from '../../lib/voiceLibrary';
import { proposeTopicAngles, TopicAngle, generateYouTubeThumbnailPrompt, generateYouTubeDescription, YouTubeDescriptionResult } from '../../lib/narrativeEngine';
import { generateRegionFocusEvents } from '../../lib/regionSync';
import { isGroundingDinoAvailable } from '../../lib/groundingDinoClient';
import { CanvasEditor } from './CanvasEditor';
import { Timeline } from './Timeline';
import { formatManifestAsText, cleanManifestForJson } from '../../lib/storyboardExporter';
import { VoiceSelectionModal } from './VoiceSelectionModal';
import {
  Film,
  Camera,
  Palette,
  Music,
  Mic,
  RotateCw,
  RefreshCw,
  Upload,
  Wand2,
  Target,
  Image as ImageIcon,
  FileText,
  SlidersHorizontal,
  MessageSquare,
  Type,
  ArrowLeft,
  Download,
  Check,
  X,
  FileUp,
  FolderOpen,
  Loader2,
  Copy,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Cpu,
  ListOrdered,
  PenTool,
  Boxes,
  Clock,
  BarChart3,
  Sparkles
} from 'lucide-react';

const triggerConfetti = () => {
  try {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = Array.from({ length: 80 }).map(() => ({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.8) * 12,
      color: ['#6366F1', '#EC4899', '#10B981', '#F59E0B', '#3B82F6'][Math.floor(Math.random() * 5)],
      size: Math.random() * 8 + 4,
    }));
    let frames = 0;
    const anim = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.3;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      });
      frames++;
      if (frames < 90) requestAnimationFrame(anim);
      else canvas.remove();
    };
    anim();
  } catch {}
};

type WizardStep = 'import' | 'edit';

interface DirectorState {
  camera: CameraInstruction;
  lighting: LightingPreset;
}

export type StyleCategory =
  | 'The Analytic Styles (For Data & Tech)'
  | 'The Creative & Organic Styles (For Process & Strategy)'
  | 'The Vintage & Textured Styles (For History & Guides)'
  | 'Cinematic & Photographic';

export interface StylePresetOption {
  id: ImageStylePreset;
  name: string;
  category: StyleCategory;
  description: string;
  badge?: string;
  iconName: 'Cpu' | 'ListOrdered' | 'PenTool' | 'Boxes' | 'Clock' | 'BarChart3' | 'Sparkles' | 'Camera' | 'Palette' | 'FileText';
}

export const STYLE_CATEGORIES: StyleCategory[] = [
  'The Analytic Styles (For Data & Tech)',
  'The Creative & Organic Styles (For Process & Strategy)',
  'The Vintage & Textured Styles (For History & Guides)',
  'Cinematic & Photographic',
];

export const STYLE_PRESETS: StylePresetOption[] = [
  // 1. The Analytic Styles (For Data & Tech)
  {
    id: 'technical-blueprint',
    name: 'Technical Blueprint',
    category: 'The Analytic Styles (For Data & Tech)',
    description: 'Monochromatic grids with fine lines, cross-sections, and precise geometric callouts.',
    badge: 'Blueprint',
    iconName: 'Cpu',
  },
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    category: 'The Analytic Styles (For Data & Tech)',
    description: 'High-contrast layouts using a 3-color palette, solid block backgrounds, and bold typography.',
    badge: 'Minimal',
    iconName: 'Boxes',
  },
  {
    id: 'corporate-dashboard',
    name: 'Corporate Dashboard',
    category: 'The Analytic Styles (For Data & Tech)',
    description: 'Clean, professional grids featuring corporate colors (blues, teals, grays) with flat iconography.',
    badge: 'Executive',
    iconName: 'BarChart3',
  },

  // 2. The Creative & Organic Styles (For Process & Strategy)
  {
    id: 'whiteboard-sketch',
    name: 'Whiteboard Sketch',
    category: 'The Creative & Organic Styles (For Process & Strategy)',
    description: 'Hand-drawn shapes, scribbled arrows, and handwritten text resembling a live brainstorming session.',
    badge: 'Brainstorm',
    iconName: 'PenTool',
  },
  {
    id: 'dotted-notebook',
    name: 'Dotted Notebook',
    category: 'The Creative & Organic Styles (For Process & Strategy)',
    description: 'Organic, casual illustrations and flowcharts rendered on grid or dot-matrix paper.',
    badge: 'Notebook',
    iconName: 'FileText',
  },
  {
    id: 'pop-art-vector',
    name: 'Pop Art / Vector',
    category: 'The Creative & Organic Styles (For Process & Strategy)',
    description: 'Vibrant, saturated colors with heavy outlines, flat shading, and playful, stylized character graphics.',
    badge: 'Pop Art',
    iconName: 'Sparkles',
  },

  // 3. The Vintage & Textured Styles (For History & Guides)
  {
    id: 'retro-technical',
    name: 'Retro Technical',
    category: 'The Vintage & Textured Styles (For History & Guides)',
    description: 'Muted tones (cream, sepia, navy) with vintage textures, looking like an old user manual or field guide.',
    badge: 'Vintage',
    iconName: 'Clock',
  },
  {
    id: 'chalkboard',
    name: 'Chalkboard',
    category: 'The Vintage & Textured Styles (For History & Guides)',
    description: 'High-contrast white or colored chalk aesthetics layered over a dark, textured slate background.',
    badge: 'Chalk',
    iconName: 'Palette',
  },

  // 4. Cinematic & Photographic
  {
    id: 'photo-realistic',
    name: 'Cinematic 35mm Photography',
    category: 'Cinematic & Photographic',
    description: 'Filmic 35mm photography with natural lighting, shallow depth of field, and authentic human context.',
    badge: 'Cinematic',
    iconName: 'Camera',
  },
];

const renderStylePresetIcon = (iconName: string, className = 'w-4 h-4') => {
  switch (iconName) {
    case 'Cpu':
      return <Cpu className={className} />;
    case 'ListOrdered':
      return <ListOrdered className={className} />;
    case 'PenTool':
      return <PenTool className={className} />;
    case 'Boxes':
      return <Boxes className={className} />;
    case 'Clock':
      return <Clock className={className} />;
    case 'BarChart3':
      return <BarChart3 className={className} />;
    case 'Sparkles':
      return <Sparkles className={className} />;
    case 'Camera':
      return <Camera className={className} />;
    case 'Palette':
      return <Palette className={className} />;
    default:
      return <Palette className={className} />;
  }
};

const formatTimecode = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

// ── Header Stepper Component ──

const StepperIndicator: React.FC<{ step: WizardStep }> = ({ step }) => {
  const steps = [
    { key: 'import' as WizardStep, label: '1. Import Content' },
    { key: 'edit' as WizardStep, label: '2. Edit & Render Storyboard' },
  ];
  const idx = steps.findIndex((x) => x.key === step);

  return (
    <div className="flex items-center gap-3">
      {steps.map((st, i) => (
        <React.Fragment key={st.key}>
          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                i <= idx
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/40 ring-2 ring-indigo-500/20'
                  : 'bg-slate-800 text-slate-500 border border-slate-700'
              }`}
            >
              {i < idx ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : i + 1}
            </div>
            <span
              className={`text-xs font-semibold transition-colors ${
                i === idx ? 'text-slate-100 font-bold' : i < idx ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {st.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`w-8 h-0.5 rounded-full transition-colors ${
                i < idx ? 'bg-indigo-600' : 'bg-slate-800'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

function parseCaptionBg(raw: string | undefined): { hex: string; alpha: number } {
  if (!raw) return { hex: '#000000', alpha: 0.65 };
  const m = raw.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([0-9.]+))?/);
  if (m) {
    const hex = '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
    return { hex, alpha: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  }
  if (raw.startsWith('#')) return { hex: raw, alpha: 1 };
  return { hex: '#000000', alpha: 0.65 };
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

export const StoryStudio: React.FC = () => {
  const [step, setStep] = useState<WizardStep>('import');

  // Input states
  const [urlInput, setUrlInput] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<ImageStylePreset>('photo-realistic');
  const [selectedMusicId, setSelectedMusicId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warningFallback, setWarningFallback] = useState(false);
  const [importMode, setImportMode] = useState<'url' | 'pdf'>('url');
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [bypassCache, setBypassCache] = useState(false);
  const [manifest, setManifest] = useState<StoryboardManifest>(sampleStoryboardManifest);
  const [_contextInfo, setContextInfo] = useState<ContentContext | null>(null);
  const [selectedScene, setSelectedScene] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [showScenePanel, setShowScenePanel] = useState(true);
  const [topicAngles, setTopicAngles] = useState<TopicAngle[]>([]);
  const [selectedTopicIndices, setSelectedTopicIndices] = useState<Set<number>>(new Set());
  const [pendingArticle, setPendingArticle] = useState<any>(null);
  const [_actualWordTimestamps, setActualWordTimestamps] = useState<any[]>([]);
  const [sceneAudio, setSceneAudio] = useState<SceneAudio[]>([]);
  const [regeneratingVoiceIdx, setRegeneratingVoiceIdx] = useState<number | 'all' | null>(null);
  const [regeneratingImageIdx, setRegeneratingImageIdx] = useState<number | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [videoGenStatus, setVideoGenStatus] = useState<Record<number, 'generating' | 'ready' | 'failed'>>({});

  const playerRef = useRef<PlayerRef>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const totalTimelineSeconds = Math.max(1, manifest.scenes.reduce((acc, s) => acc + (s.duration || 10), 0));
  const calculatedTotalFrames = Math.max(Math.round(totalTimelineSeconds * 30), 150);

  const [director, setDirector] = useState<DirectorState>({
    camera: { preset: 'static', intensity: 0.5, durationFrames: 90 },
    lighting: 'flat',
  });

  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [voices, setVoices] = useState<VoiceEntry[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('thomas_louis');
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  // Render & Export
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [renderUrl, setRenderUrl] = useState('');
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderFrameInfo, setRenderFrameInfo] = useState('');
  const [showExportControls, setShowExportControls] = useState(false);
  const [renderOutputName, setRenderOutputName] = useState('generated_video');
  const [renderOutputDir, setRenderOutputDir] = useState('');
  const [showRenderDialog, setShowRenderDialog] = useState(false);

  // Grounding DINO detection state
  const [isDetectingRegions, setIsDetectingRegions] = useState(false);

  // YouTube Thumbnail Generator state
  const [isThumbnailModalOpen, setIsThumbnailModalOpen] = useState(false);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [thumbnailData, setThumbnailData] = useState<{ imagePrompt: string; overlayText: string; imageUrl: string } | null>(null);

  // YouTube Description & Chapters state
  const [isDescriptionModalOpen, setIsDescriptionModalOpen] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [descriptionData, setDescriptionData] = useState<YouTubeDescriptionResult | null>(null);

  const handleGenerateThumbnail = async () => {
    setIsThumbnailModalOpen(true);
    setIsGeneratingThumbnail(true);
    try {
      const title = manifest?.meta?.title || 'Explainer Video';
      const result = await generateYouTubeThumbnailPrompt(manifest, title, selectedStyle);
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: result.imagePrompt, stylePreset: 'photo-realistic' }),
      });
      const data = await res.json();
      const imageUrl = data.imageUrl;
      if (!imageUrl) throw new Error('Thumbnail generation returned no image');
      setThumbnailData({ imagePrompt: result.imagePrompt, overlayText: result.overlayText, imageUrl });
    } catch (err: any) {
      console.error('[ThumbnailGen] Error:', err);
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  const handleGenerateDescription = async () => {
    setIsDescriptionModalOpen(true);
    setIsGeneratingDescription(true);
    try {
      const title = manifest?.meta?.title || 'Explainer Video';
      const result = await generateYouTubeDescription(manifest, title, urlInput);
      setDescriptionData(result);
    } catch (err: any) {
      console.error('[DescriptionGen] Error:', err);
    } finally {
      setIsGeneratingDescription(false);
    }
  };

  useEffect(() => {
    setMusicTracks(getTrackList());
    setVoices(loadVoiceLibrary());

    fetch('/latest_manifest.json?_=' + Date.now())
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const m = data.manifest || data;
        if (m?.scenes?.length) {
          const sa: SceneAudio[] = data.sceneAudio?.length
            ? data.sceneAudio
            : m.scenes.map((scene: any) => ({
                sceneNumber: scene.sceneNumber,
                audioUrl: '',
                durationSeconds: scene.duration || 10,
                wordTimestamps: [],
              }));
          setManifest(m);
          setSceneAudio(sa);
          setActualWordTimestamps(sa.flatMap((s: any) => s.wordTimestamps || []));
          if (!data.sceneAudio?.length) {
            resyncSceneDurations(m).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  const activeVoice = useMemo(() => {
    return voices.find((v) => v.id === selectedVoiceId || v.voiceId === selectedVoiceId) || voices[0] || {
      id: 'thomas_louis',
      voiceId: 'GBv7mTt0atIp3Br8iCJU',
      name: 'Thomas Louis',
      description: 'Authoritative, clear, and engaging male narration voice',
      gender: 'male',
    };
  }, [voices, selectedVoiceId]);

  const handleAddCustomVoice = (voiceId: string, name: string) => {
    const added = addCustomVoice(voiceId, name, 'Custom ElevenLabs Voice');
    const updated = loadVoiceLibrary();
    setVoices(updated);
    setSelectedVoiceId(added.id);
  };

  const handleFileUploadMusic = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        const newTrack = saveCustomBrowserTrack(file.name.replace(/\.[^/.]+$/, ''), dataUrl);
        setMusicTracks(getTrackList());
        setSelectedMusicId(newTrack.id);
      }
    };
    reader.readAsDataURL(file);
  };

  // Playhead sync loop
  useEffect(() => {
    let animId: number;
    const updatePlayhead = () => {
      if (playerRef.current) {
        try {
          const frame = playerRef.current.getCurrentFrame();
          const playing = playerRef.current.isPlaying();
          setCurrentFrame(frame);
          setIsPlaying(playing);
        } catch (err) {}
      }
      animId = requestAnimationFrame(updatePlayhead);
    };
    animId = requestAnimationFrame(updatePlayhead);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Annotation style config
  const [annotationConfig, setAnnotationConfig] = useState<AnnotationConfig>({
    highlightColor: '#3b82f6',
    highlightBorderWidth: 2.5,
    pointerColor: '#3b82f6',
    showHighlights: true,
    showPointer: true,
    showTitle: true,
    subtitle: { enabled: true, fontSize: 32, color: '#FFFFFF', backgroundColor: 'rgba(0, 0, 0, 0.65)', highlightActiveWord: true, activeWordColor: '#FFD700' },
  });
  const [showCaptionSettings, setShowCaptionSettings] = useState(false);

  const playerInputProps = useMemo(
    () => ({
      manifest,
      sceneAudio: sceneAudio.length > 0 ? sceneAudio : undefined,
      bgMusicUrl: getTrackSourceById(selectedMusicId),
      camera: director.camera,
      lighting: director.lighting,
      annotationConfig,
      logoUrl: logoUrl || undefined,
      audioBaseUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
    }),
    [manifest, selectedMusicId, director.camera, director.lighting, sceneAudio, annotationConfig, logoUrl]
  );

  // Sync selectedScene with playhead
  useEffect(() => {
    if (!manifest?.scenes?.length || isPlaying) return;
    let accumulatedSecs = 0;
    const currentSec = currentFrame / 30;

    for (let i = 0; i < manifest.scenes.length; i++) {
      const duration = manifest.scenes[i].duration || 10;
      if (currentSec >= accumulatedSecs && currentSec < accumulatedSecs + duration) {
        if (selectedScene !== i) {
          setSelectedScene(i);
        }
        break;
      }
      accumulatedSecs += duration;
    }
  }, [currentFrame, manifest.scenes, isPlaying, selectedScene]);

  const hasValidInput = Boolean(urlInput.trim() || pdfFile);

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrlInput(text);
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  };

  const handleGenerate = async () => {
    if (!hasValidInput) return;
    setIsProcessing(true);
    setError(null);
    setStatusMsg('Analyzing content...');
    setTopicAngles([]);
    setSelectedTopicIndices(new Set());

    try {
      const isPdf = importMode === 'pdf' || urlInput.toLowerCase().endsWith('.pdf');
      const article = pdfFile
        ? await ingestPdf(URL.createObjectURL(pdfFile))
        : isPdf
        ? await ingestPdf(urlInput)
        : await ingestUrl(urlInput);

      setStatusMsg('Finding key topics...');
      const angles = await proposeTopicAngles(article);

      if (angles.length >= 2) {
        setTopicAngles(angles);
        setPendingArticle(article);
        setStatusMsg('');
        setIsProcessing(false);
        return;
      }

      await generateWithTopics(article, []);
    } catch (err: any) {
      setError(err.message || 'Failed to generate storyboard.');
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  const persistState = (m: any, sa?: SceneAudio[]) => {
    try {
      const payload = { manifest: m, sceneAudio: sa || [] };
      localStorage.setItem('omnicast_last_state', JSON.stringify(payload));
    } catch {}
    fetch('/api/save-manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: m, sceneAudio: sa || [] }),
    }).catch(() => {});
  };

  const generateWithTopics = async (article: any, focusTopics: string[]) => {
    setIsProcessing(true);
    setError(null);
    setStatusMsg('Building storyboard...');
    setTopicAngles([]);
    try {
      const result = await generateContextAwareStoryboard(article, {
        stylePreset: selectedStyle,
        bypassCache,
        voiceId: resolveVoiceId(selectedVoiceId),
        focusTopics: focusTopics.length > 0 ? focusTopics : undefined,
      });
      setManifest(result.manifest);
      setContextInfo(result.context);
      setWarningFallback(result.usedFallback);
      setSelectedScene(0);

      const scenes = result.manifest.scenes.map((s) => ({
        sceneNumber: s.sceneNumber,
        narration: s.narration,
      }));
      setStatusMsg('Generating per-scene voiceover...');
      fetch('/api/generate-tts-per-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes, voiceId: resolveVoiceId(selectedVoiceId) }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (data.sceneAudio && data.sceneAudio.length > 0) {
            setSceneAudio(data.sceneAudio);
            const updatedScenes = result.manifest.scenes.map((scene) => {
              const sa = data.sceneAudio.find(
                (sa: SceneAudio) => sa.sceneNumber === scene.sceneNumber
              );
              return sa ? { ...scene, duration: sa.durationSeconds } : scene;
            });
            const finalManifest = { ...result.manifest, scenes: updatedScenes };
            setManifest(finalManifest);
            const allTimestamps = data.sceneAudio.flatMap((sa: SceneAudio) => sa.wordTimestamps);
            setActualWordTimestamps(allTimestamps);
            persistState(finalManifest, data.sceneAudio);
            generateVideosInBackground(finalManifest, data.sceneAudio);
          }
        })
        .catch((err) => console.warn('[TTS] Per-scene synthesis failed:', err));

      setStep('edit');
    } catch (err: any) {
      setError(err.message || 'Failed to generate storyboard.');
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
      setPendingArticle(null);
    }
  };

  const regenerateSceneVoice = async (sceneIdx: number) => {
    const scene = manifest.scenes[sceneIdx];
    if (!scene) return;
    setRegeneratingVoiceIdx(sceneIdx);
    setStatusMsg(`Generating voiceover for Scene ${scene.sceneNumber}...`);
    try {
      const res = await fetch('/api/generate-tts-per-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenes: [{ sceneNumber: scene.sceneNumber, narration: scene.narration }],
          voiceId: resolveVoiceId(selectedVoiceId),
        }),
      });
      const data = await res.json();
      if (data.sceneAudio && data.sceneAudio.length > 0) {
        const newSa = data.sceneAudio[0] as SceneAudio;
        const filtered = sceneAudio.filter((sa) => sa.sceneNumber !== scene.sceneNumber);
        const merged = [...filtered, newSa].sort((a, b) => a.sceneNumber - b.sceneNumber);
        const updated = {
          ...manifest,
          scenes: manifest.scenes.map((sc, i) =>
            i === sceneIdx ? { ...sc, duration: newSa.durationSeconds } : sc
          ),
        };
        setSceneAudio(merged);
        setManifest(updated);
        persistState(updated, merged);
        setStatusMsg(`Voiceover updated for Scene ${scene.sceneNumber}!`);
        setTimeout(() => setStatusMsg(''), 3000);
      }
    } catch (err: any) {
      console.warn('[TTS] Single-scene regenerate failed:', err);
      setError(`Voice generation failed for Scene ${scene.sceneNumber}: ${err.message || err}`);
    } finally {
      setRegeneratingVoiceIdx(null);
    }
  };

  // Scene Manipulation Helpers
  const handleAddScene = () => {
    const newSceneNum = manifest.scenes.length + 1;
    const newScene = {
      sceneNumber: newSceneNum,
      duration: 10,
      narration: `Scene ${newSceneNum} narration...`,
      visualPrompt: 'Clean graphic illustration',
      layout: {
        background: { type: 'solid' as const, value: '#090d16' },
        clearCanvas: true,
        elements: [
          {
            id: `title-new-${Date.now()}`,
            type: 'text' as const,
            content: `Scene ${newSceneNum}`,
            x: 10,
            y: 20,
            width: 500,
            height: 100,
            zIndex: 1,
            fontSize: 48,
            fontWeight: 'bold',
            fill: '#FFFFFF',
          },
        ],
      },
      syncHints: [],
      animationStrategy: 'image_to_video' as const,
    };
    const updatedScenes = [...manifest.scenes, newScene].map((sc, i) => ({ ...sc, sceneNumber: i + 1 }));
    const newManifest = {
      ...manifest,
      scenes: updatedScenes,
      meta: { ...manifest.meta, targetDuration: updatedScenes.reduce((acc, s) => acc + (s.duration || 10), 0) },
    };
    setManifest(newManifest);
    persistState(newManifest, sceneAudio);
    setSelectedScene(updatedScenes.length - 1);
  };

  const handleInsertScene = (insertIdx: number) => {
    const newSceneNum = insertIdx + 1;
    const newScene = {
      sceneNumber: newSceneNum,
      duration: 10,
      narration: `Inserted scene narration...`,
      visualPrompt: 'Clean graphic illustration',
      layout: {
        background: { type: 'solid' as const, value: '#090d16' },
        clearCanvas: true,
        elements: [
          {
            id: `title-ins-${Date.now()}`,
            type: 'text' as const,
            content: `Scene ${newSceneNum}`,
            x: 10,
            y: 20,
            width: 500,
            height: 100,
            zIndex: 1,
            fontSize: 48,
            fontWeight: 'bold',
            fill: '#FFFFFF',
          },
        ],
      },
      syncHints: [],
      animationStrategy: 'image_to_video' as const,
    };
    const updated = [...manifest.scenes];
    updated.splice(insertIdx, 0, newScene);
    const reindexed = updated.map((sc, i) => ({ ...sc, sceneNumber: i + 1 }));
    const newManifest = {
      ...manifest,
      scenes: reindexed,
      meta: { ...manifest.meta, targetDuration: reindexed.reduce((acc, s) => acc + (s.duration || 10), 0) },
    };
    setManifest(newManifest);
    persistState(newManifest, sceneAudio);
    setSelectedScene(insertIdx);
  };

  const handleCustomImageUpload = (sceneIdx: number, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;
      const newScenes = manifest.scenes.map((sc, i) => {
        if (i !== sceneIdx) return sc;
        const elements = sc.layout?.elements || [];
        const hasImage = elements.some((el) => el.type === 'image');
        const newElements: CanvasElement[] = hasImage
          ? elements.map((el) => (el.type === 'image' ? { ...el, sourceAssetId: dataUrl, content: dataUrl } : el))
          : [...elements, { id: `img_${Date.now()}`, type: 'image' as const, sourceAssetId: dataUrl, content: dataUrl, x: 0, y: 0, width: 1920, height: 1080, zIndex: 1 }];
        return {
          ...sc,
          layout: {
            ...sc.layout,
            background: { type: 'solid' as const, value: '#090d16' },
            elements: newElements,
          },
        };
      });
      const newManifest = { ...manifest, scenes: newScenes };
      setManifest(newManifest);
      persistState(newManifest, sceneAudio);
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteScene = (sceneIdx: number) => {
    if (manifest.scenes.length <= 1) return;
    const updated = manifest.scenes.filter((_, i) => i !== sceneIdx).map((sc, i) => ({ ...sc, sceneNumber: i + 1 }));
    const newManifest = {
      ...manifest,
      scenes: updated,
      meta: { ...manifest.meta, targetDuration: updated.reduce((acc, s) => acc + (s.duration || 10), 0) },
    };
    setManifest(newManifest);
    persistState(newManifest, sceneAudio);
    setSelectedScene(Math.max(0, Math.min(selectedScene, updated.length - 1)));
  };

  const handleMoveScene = (sceneIdx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? sceneIdx - 1 : sceneIdx + 1;
    if (targetIdx < 0 || targetIdx >= manifest.scenes.length) return;
    const updated = [...manifest.scenes];
    const [moved] = updated.splice(sceneIdx, 1);
    updated.splice(targetIdx, 0, moved);
    const reindexed = updated.map((sc, i) => ({ ...sc, sceneNumber: i + 1 }));
    const newManifest = {
      ...manifest,
      scenes: reindexed,
      meta: { ...manifest.meta, targetDuration: reindexed.reduce((acc, s) => acc + (s.duration || 10), 0) },
    };
    setManifest(newManifest);
    persistState(newManifest, sceneAudio);
    setSelectedScene(targetIdx);
  };

  const handleDuplicateScene = (sceneIdx: number) => {
    const sc = manifest.scenes[sceneIdx];
    if (!sc) return;
    const dupScene = JSON.parse(JSON.stringify(sc));
    const updated = [...manifest.scenes];
    updated.splice(sceneIdx + 1, 0, dupScene);
    const reindexed = updated.map((s, i) => ({ ...s, sceneNumber: i + 1 }));
    const newManifest = {
      ...manifest,
      scenes: reindexed,
      meta: { ...manifest.meta, targetDuration: reindexed.reduce((acc, s) => acc + (s.duration || 10), 0) },
    };
    setManifest(newManifest);
    persistState(newManifest, sceneAudio);
    setSelectedScene(sceneIdx + 1);
  };

  const regenerateSceneImage = async (sceneIdx: number) => {
    const scene = manifest.scenes[sceneIdx];
    if (!scene) return;
    const elements = scene.layout?.elements || [];
    const imgIdx = elements.findIndex((el) => el.type === 'image');
    if (imgIdx < 0) {
      setError(`Scene ${scene.sceneNumber} has no image element to regenerate.`);
      return;
    }
    const element = elements[imgIdx];
    const detailedPrompt =
      element.imageDescription || element.content || element.sourceAssetId || scene.narration || 'concept';
    const childTexts = elements
      .filter((el) => el.type === 'text' && (el as any).content)
      .map((el) => (el as any).content as string);

    const isImageToVideo = scene.animationStrategy === 'image_to_video';

    setRegeneratingImageIdx(sceneIdx);
    setStatusMsg(isImageToVideo
      ? `Regenerating image + video for Scene ${scene.sceneNumber}...`
      : `Regenerating image for Scene ${scene.sceneNumber}...`);
    try {
      const proxyRes = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: detailedPrompt,
          stylePreset: selectedStyle,
          infographicLabels: childTexts,
        }),
      });
      if (!proxyRes.ok) throw new Error(`Image proxy returned ${proxyRes.status}`);
      const json = await proxyRes.json();
      const imageUrl = json.imageUrl;
      if (!imageUrl) throw new Error('Image generation returned no URL');

      let videoUrl: string | undefined;
      if (isImageToVideo) {
        setVideoGenStatus((prev) => ({ ...prev, [scene.sceneNumber]: 'generating' }));
        try {
          const vidResult = await animateImage({
            imageUrl,
            prompt: detailedPrompt,
            duration: Math.min(Math.round(scene.duration || 5), 15),
            motionStrength: 0.3,
          });
          videoUrl = vidResult.videoUrl;
          setVideoGenStatus((prev) => ({ ...prev, [scene.sceneNumber]: 'ready' }));
        } catch (vidErr: any) {
          console.warn('[ImageGen] Video re-animation failed:', vidErr.message);
          setVideoGenStatus((prev) => ({ ...prev, [scene.sceneNumber]: 'failed' }));
        }
      }

      const newScenes = manifest.scenes.map((sc, i) => {
        if (i !== sceneIdx) return sc;
        const newElements = [...(sc.layout?.elements || [])];
        newElements[imgIdx] = { ...newElements[imgIdx], sourceAssetId: imageUrl, videoUrl };
        return { ...sc, layout: { ...sc.layout, elements: newElements } };
      });
      const newManifest = { ...manifest, scenes: newScenes };
      setManifest(newManifest);
      persistState(newManifest, sceneAudio);
      setStatusMsg(isImageToVideo
        ? `Image + video updated for Scene ${scene.sceneNumber}!`
        : `Image updated for Scene ${scene.sceneNumber}!`);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err: any) {
      console.warn('[ImageGen] Single-scene regenerate failed:', err);
      setError(`Image generation failed for Scene ${scene.sceneNumber}: ${err.message || err}`);
    } finally {
      setRegeneratingImageIdx(null);
    }
  };

  const regenerateSceneVideo = async (sceneIdx: number) => {
    const scene = manifest.scenes[sceneIdx];
    if (!scene) return;
    const strategy = scene.animationStrategy;
    if (strategy !== 'image_to_video' && strategy !== 'text_to_video') return;

    const imgEl = (scene.layout?.elements || []).find((el) => el.type === 'image') as any;
    const prompt = imgEl?.imageDescription || scene.narration || 'cinematic scene';

    setVideoGenStatus((prev) => ({ ...prev, [scene.sceneNumber]: 'generating' }));
    setStatusMsg(`Generating video for Scene ${scene.sceneNumber}...`);
    try {
      let videoUrl: string | undefined;
      if (strategy === 'image_to_video') {
        const imageUrl = imgEl?.sourceAssetId;
        if (!imageUrl || imageUrl.startsWith('data:')) {
          throw new Error("This scene's image is not a hosted URL — regenerate the image first.");
        }
        const result = await animateImage({ imageUrl, prompt, duration: Math.min(Math.round(scene.duration || 5), 15), motionStrength: 0.3 });
        videoUrl = result.videoUrl;
      } else {
        const result = await generateVideo({ prompt, duration: Math.min(Math.round(scene.duration || 10), 15) });
        videoUrl = result.videoUrl;
      }
      if (!videoUrl) throw new Error('Video generation returned no URL');

      const newScenes = manifest.scenes.map((sc, i) => {
        if (i !== sceneIdx) return sc;
        const newElements = [...(sc.layout?.elements || [])];
        const imgIdx = newElements.findIndex((el) => el.type === 'image');
        if (imgIdx >= 0) newElements[imgIdx] = { ...newElements[imgIdx], videoUrl };
        return { ...sc, layout: { ...sc.layout, elements: newElements } };
      });
      const newManifest = { ...manifest, scenes: newScenes };
      setManifest(newManifest);
      persistState(newManifest, sceneAudio);
      setVideoGenStatus((prev) => ({ ...prev, [scene.sceneNumber]: 'ready' }));
      setStatusMsg(`Video updated for Scene ${scene.sceneNumber}!`);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err: any) {
      console.warn('[VideoGen] Single-scene regenerate failed:', err);
      setVideoGenStatus((prev) => ({ ...prev, [scene.sceneNumber]: 'failed' }));
      setError(`Video generation failed for Scene ${scene.sceneNumber}: ${err.message || err}`);
    }
  };

  const regenerateAllVoices = async () => {
    setRegeneratingVoiceIdx('all');
    setStatusMsg('Synthesizing voiceover for all scenes with ElevenLabs...');
    const scenes = manifest.scenes.map((s) => ({
      sceneNumber: s.sceneNumber,
      narration: s.narration,
    }));
    try {
      const res = await fetch('/api/generate-tts-per-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes, voiceId: resolveVoiceId(selectedVoiceId) }),
      });
      const data = await res.json();
      if (data.sceneAudio && data.sceneAudio.length > 0) {
        setSceneAudio(data.sceneAudio);
        const updatedScenes = manifest.scenes.map((scene) => {
          const sa = data.sceneAudio.find((sa: SceneAudio) => sa.sceneNumber === scene.sceneNumber);
          return sa ? { ...scene, duration: sa.durationSeconds } : scene;
        });
        setManifest({ ...manifest, scenes: updatedScenes });
        const allTimestamps = data.sceneAudio.flatMap((sa: SceneAudio) => sa.wordTimestamps);
        setActualWordTimestamps(allTimestamps);
        persistState({ ...manifest, scenes: updatedScenes }, data.sceneAudio);
        setStatusMsg('Successfully regenerated voiceover for all scenes!');
        setTimeout(() => setStatusMsg(''), 3000);
      }
    } catch (err: any) {
      console.warn('[TTS] Regenerate all failed:', err);
      setError(`Failed to regenerate voices: ${err.message || err}`);
    } finally {
      setRegeneratingVoiceIdx(null);
    }
  };

  const confirmTopics = () => {
    if (!pendingArticle) return;
    const indices = Array.from(selectedTopicIndices);
    const topics =
      indices.length > 0 ? indices.map((i) => topicAngles[i].label) : topicAngles.map((a) => a.label);
    generateWithTopics(pendingArticle, topics);
  };

  const handleGenerateVideos = async () => {
    setIsProcessing(true);
    setStatusMsg('Generating AI videos for video scenes...');
    const videoSceneNums = manifest.scenes
      .filter((s: any) => s.animationStrategy === 'image_to_video' || s.animationStrategy === 'text_to_video')
      .map((s: any) => s.sceneNumber);

    const initial: Record<number, 'generating' | 'ready' | 'failed'> = {};
    videoSceneNums.forEach((n) => { initial[n] = 'generating'; });
    setVideoGenStatus(initial);

    try {
      const updatedManifest = await generateVideosForManifest(
        manifest,
        (msg) => setStatusMsg(msg),
        (sceneNum, status) => {
          setVideoGenStatus((prev) => ({
            ...prev,
            [sceneNum]: status === 'completed' ? 'ready' : status === 'failed' ? 'failed' : 'generating',
          }));
        },
      );
      setManifest(updatedManifest);
      persistState(updatedManifest, sceneAudio);
      setStatusMsg('Video generation complete!');
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err: any) {
      console.warn('[VideoGen] Failed:', err);
      setError(`Video generation failed: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const generateVideosInBackground = async (m: StoryboardManifest, sa: SceneAudio[]) => {
    const videoScenes = m.scenes.filter(
      (s: any) => s.animationStrategy === 'image_to_video' || s.animationStrategy === 'text_to_video'
    );
    if (videoScenes.length === 0) return;

    const initial: Record<number, 'generating' | 'ready' | 'failed'> = {};
    videoScenes.forEach((s: any) => { initial[s.sceneNumber] = 'generating'; });
    setVideoGenStatus((prev) => ({ ...prev, ...initial }));

    try {
      const updated = await generateVideosForManifest(
        m,
        undefined,
        (sceneNum, status) => {
          setVideoGenStatus((prev) => ({
            ...prev,
            [sceneNum]: status === 'completed' ? 'ready' : status === 'failed' ? 'failed' : 'generating',
          }));
        },
      );
      setManifest(updated);
      persistState(updated, sa);
    } catch (err) {
      console.warn('[StoryStudio] Background video generation failed:', err);
    }
  };

  const handleRenderMp4 = async () => {
    setIsRendering(true);
    setRenderError('');
    setRenderUrl('');
    setRenderProgress(0);
    setRenderFrameInfo('Starting render process...');
    let cancelled = false;

    try {
      const res = await fetch('/api/render-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manifest,
          sceneAudio,
          bgMusicUrl: getTrackSourceById(selectedMusicId) || undefined,
          camera: director.camera,
          lighting: director.lighting,
          annotationConfig,
          logoUrl: logoUrl || undefined,
          outputFilename: renderOutputName,
          outputDir: renderOutputDir || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success || cancelled) {
        setRenderError(data.error || 'Render failed to start');
        setIsRendering(false);
        return;
      }

      const poll = setInterval(async () => {
        if (cancelled) {
          clearInterval(poll);
          return;
        }
        try {
          const sr = await fetch('/api/render-status?_=' + Date.now());
          const sd = await sr.json();
          if (sd.percent !== undefined) setRenderProgress(sd.percent);
          if (sd.renderedFrames && sd.totalFrames) {
            setRenderFrameInfo(`Frame ${sd.renderedFrames} / ${sd.totalFrames}`);
          }
          if (sd.done) {
            clearInterval(poll);
            setIsRendering(false);
            if (sd.success === false) {
              setRenderError(sd.error || 'Render process failed. Check server logs.');
            } else {
              setRenderProgress(100);
              if (sd.outputUrl) {
                setRenderUrl(`${sd.outputUrl}?t=${Date.now()}`);
              } else {
                setRenderUrl('');
                setRenderFrameInfo(`Saved to ${sd.path || 'your chosen folder'}`);
              }
              setShowExportControls(true);
              triggerConfetti();
            }
          }
        } catch {}
      }, 1500);

      const safety = setTimeout(() => {
        clearInterval(poll);
        if (!cancelled) setIsRendering(false);
      }, 600000);
      return () => {
        cancelled = true;
        clearInterval(poll);
        clearTimeout(safety);
      };
    } catch (err: any) {
      if (!cancelled) {
        setRenderError(err.message || 'Render request failed');
        setIsRendering(false);
      }
    }
  };

  const triggerGroundingDino = async () => {
    setIsDetectingRegions(true);
    try {
      const available = await isGroundingDinoAvailable();
      if (!available) {
        alert('Grounding DINO backend is not reachable on http://localhost:8001.');
        setIsDetectingRegions(false);
        return;
      }

      const updatedScenes = [...manifest.scenes];
      let totalEvents = 0;

      for (let i = 0; i < updatedScenes.length; i++) {
        const scene = updatedScenes[i];
        const sa = sceneAudio.find((s) => s.sceneNumber === scene.sceneNumber);
        const imageElement = scene.layout?.elements?.find((el) => el.type === 'image');
        let imageUrl = imageElement?.sourceAssetId || imageElement?.content;

        if (imageUrl) {
          if (
            imageUrl.startsWith('/') ||
            (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:'))
          ) {
            imageUrl = `${window.location.origin}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
          }

          const wordTimestamps = sa?.wordTimestamps || [];
          const { detectedRegions, regionFocusEvents, imageWidth, imageHeight } =
            await generateRegionFocusEvents(scene, wordTimestamps, imageUrl);

          scene.detectedRegions = detectedRegions;
          scene.regionFocusEvents = regionFocusEvents;
          scene.detectedImageWidth = imageWidth;
          scene.detectedImageHeight = imageHeight;
          totalEvents += regionFocusEvents.length;
        }
      }

      const updatedManifest = { ...manifest, scenes: updatedScenes };
      setManifest(updatedManifest);
      persistState(updatedManifest, sceneAudio);
      alert(`Grounding DINO completed! Generated ${totalEvents} region highlight events.`);
    } catch (err: any) {
      alert('Grounding DINO detection error: ' + (err?.message || 'Unknown error'));
    } finally {
      setIsDetectingRegions(false);
    }
  };

  const resyncSceneDurations = async (targetManifest?: StoryboardManifest) => {
    const currentManifest = targetManifest || manifest;
    if (!currentManifest?.scenes?.length) return;

    const existingAudio: SceneAudio[] = sceneAudio;

    const probed = await Promise.all(
      currentManifest.scenes.map(async (scene) => {
        const existing = existingAudio.find((sa) => sa.sceneNumber === scene.sceneNumber);
        const url = existing?.audioUrl || `scene_${scene.sceneNumber}.mp3`;
        const dur = url ? await probeAudioDuration(url) : 0;
        return {
          sceneNumber: scene.sceneNumber,
          audioUrl: url,
          durationSeconds: dur > 0 ? dur : (existing?.durationSeconds || scene.duration || 10),
          wordTimestamps: existing?.wordTimestamps || ([] as any[]),
        };
      })
    );

    const valid = probed.filter((p) => p.durationSeconds > 0);
    const audioToUse = valid.length > 0 ? valid : probed;

    setSceneAudio(audioToUse);
    const updated = sequentialAlign(currentManifest.scenes, audioToUse);
    const totalDuration = Math.round(
      updated.reduce((acc: number, s: any) => acc + (s.duration || 10), 0)
    );
    setManifest({
      ...currentManifest,
      meta: {
        ...currentManifest.meta,
        targetDuration: totalDuration,
      },
      scenes: updated,
    });
  };

  function probeAudioDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      const timeout = setTimeout(() => resolve(0), 3000);
      audio.addEventListener(
        'loadedmetadata',
        () => {
          clearTimeout(timeout);
          resolve(audio.duration);
        },
        { once: true }
      );
      audio.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          resolve(0);
        },
        { once: true }
      );
      audio.src = `/${url}?t=${Date.now()}`;
    });
  }

  function sequentialAlign(scenes: any[], audio: SceneAudio[]) {
    let currentStart = 0;
    return scenes.map((scene) => {
      const sa = audio.find((s) => s.sceneNumber === scene.sceneNumber);
      const duration = sa?.durationSeconds || scene.duration || 10;
      const startTime = currentStart;
      const endTime = startTime + duration;
      currentStart = endTime;

      const elements = zeroPrimaryImageDelay(scene.layout?.elements || []);
      return { ...scene, duration, layout: { ...scene.layout, elements } };
    });
  }

  function zeroPrimaryImageDelay(elements: any[]) {
    const firstImageIdx = elements.findIndex((e: any) => e.type === 'image');
    return elements.map((el: any, i: number) => {
      if (el.type === 'image' && i === firstImageIdx) {
        return {
          ...el,
          enterAnimation: {
            type: el.enterAnimation?.type || 'fade_in',
            duration: el.enterAnimation?.duration || 10,
            delay: 0,
          },
        };
      }
      return el;
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* ═══ Header Navbar ═══ */}
      <header
        style={{ paddingTop: '16px', paddingBottom: '16px', minHeight: '68px' }}
        className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 px-6 shadow-lg flex items-center justify-between"
      >
        <div className="max-w-[1700px] w-full mx-auto flex items-center justify-between">
          {/* Left: Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-600 flex items-center justify-center text-white font-black text-base shadow-lg shadow-indigo-600/30">
              O
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold text-white tracking-tight">OmniCast</span>
              <span className="bg-indigo-950/90 text-indigo-400 border border-indigo-800/60 text-[11px] px-2.5 py-0.5 rounded-full font-semibold">
                Studio Pro
              </span>
            </div>
          </div>

          {/* Center: Stepper */}
          <StepperIndicator step={step} />

          {/* Right: Header Actions */}
          <div className="flex items-center gap-3">
            {step === 'import' && (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/latest_manifest.json?_=' + Date.now());
                    if (!res.ok) return;
                    const data = await res.json();
                    const m = data.manifest || data;
                    if (!m?.scenes?.length) return;
                    setManifest(m);
                    await resyncSceneDurations(m);
                    setStep('edit');
                  } catch {}
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-800 hover:bg-slate-900 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                <span>Saved Projects</span>
              </button>
            )}

            {step === 'edit' && (
              <>
                <button
                  type="button"
                  onClick={() => setStep('import')}
                  style={{ paddingLeft: '1rem', paddingRight: '1rem', height: '36px', marginTop: '4px', marginBottom: '4px' }}
                  className="h-9 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Import</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRenderDialog(true)}
                  disabled={isRendering}
                  style={{ paddingLeft: '1rem', paddingRight: '1rem', height: '36px', marginTop: '4px', marginBottom: '4px' }}
                  className="h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
                >
                  {isRendering ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Rendering...</span>
                    </>
                  ) : (
                    <>
                      <Film className="w-4 h-4" />
                      <span>Render Video</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ═══ Main Content ═══ */}
      <main className={`flex-1 w-full mx-auto p-4 sm:p-6 flex flex-col items-center justify-center ${step === 'import' ? 'min-h-[calc(100vh-65px)] relative overflow-hidden' : 'max-w-[1700px]'}`}>
        {/* STEP 1: IMPORT CONTENT */}
        {step === 'import' && (
          <div className="w-full max-w-2xl md:max-w-3xl flex flex-col items-center justify-center my-auto relative px-4">
            {/* Subtle Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[450px] bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none" />

            {/* Main Card Container */}
            <div
              className="relative w-full bg-slate-900/80 border border-slate-800/90 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col gap-8"
              style={{ padding: '2.5rem' }}
            >
              {/* Header Section */}
              <div className="text-center flex flex-col items-center gap-3">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner">
                  {/* Lucide Sparkles Icon */}
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.286L13 21l-2.286-6.857L5 12l5.714-2.286L13 3z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Create an Explainer Video</h1>
                <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                  Import an article URL or upload a document to automatically generate your storyboard.
                </p>
              </div>

              {error && (
                <div className="p-4 bg-rose-950/80 border border-rose-800 text-rose-200 rounded-xl text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <X className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{error}</span>
                  </div>
                  <button onClick={() => setError(null)} className="text-rose-400 hover:text-white cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {warningFallback && (
                <div className="p-4 bg-amber-950/80 border border-amber-800 text-amber-200 rounded-xl text-xs flex items-center gap-2">
                  <span>⚠️ <strong>No LLM API key configured.</strong> Using template content.</span>
                </div>
              )}

              {/* Mode Selector Tabs (Taller Tab Bar) */}
              <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-950/70 border border-slate-800 rounded-xl h-14 items-center">
                <button
                  type="button"
                  onClick={() => setImportMode('url')}
                  className={`h-11 flex items-center justify-center gap-2 px-5 text-sm font-semibold rounded-lg transition cursor-pointer ${
                    importMode === 'url'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>Article URL</span>
                </button>

                <button
                  type="button"
                  onClick={() => setImportMode('pdf')}
                  className={`h-11 flex items-center justify-center gap-2 px-5 text-sm font-semibold rounded-lg transition cursor-pointer ${
                    importMode === 'pdf'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>PDF Document</span>
                </button>
              </div>

              {/* Input Group */}
              {importMode === 'url' ? (
                <div className="flex flex-col gap-2">
                  <label className="block text-xs font-semibold tracking-wider text-slate-300 uppercase">
                    Content Source URL
                  </label>
                  <div className="relative">
                    <input
                      type="url"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://example.com/blog-or-article"
                      className="w-full h-12 pl-4 pr-11 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                      onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                    />
                    <button
                      type="button"
                      onClick={handlePasteClipboard}
                      title="Paste"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="block text-xs font-semibold tracking-wider text-slate-300 uppercase">
                    Upload PDF Document
                  </label>
                  <label className="w-full min-h-[140px] border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-xl p-8 text-center flex flex-col items-center justify-center bg-slate-950/60 transition-colors cursor-pointer">
                    {pdfFile ? (
                      <div className="text-center flex flex-col gap-1">
                        <span className="font-semibold text-slate-100 text-sm block">{pdfFile.name}</span>
                        <span className="text-xs text-slate-400">{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    ) : (
                      <div className="text-center text-slate-400 flex flex-col gap-2">
                        <FileUp className="w-8 h-8 mx-auto text-indigo-400/80" />
                        <span className="text-xs font-medium block text-slate-300">Click to upload or drag & drop PDF</span>
                        <span className="text-[11px] text-slate-500 block">Maximum file size 25MB</span>
                      </div>
                    )}
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {/* Creative Customizations (Visual Style Presets, Music, Narrator) */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 flex flex-col gap-5 animate-in fade-in duration-300">
                <div className="border-b border-slate-800 pb-2.5 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Palette className="w-3.5 h-3.5 text-indigo-400" />
                    Style Presets & Customizations
                  </h3>
                  <span className="text-[11px] text-slate-500 font-medium">
                    {STYLE_PRESETS.length} presets
                  </span>
                </div>

                {/* Visual Style Preset Selector & Cards Grid */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                      Visual Aesthetic Style:
                    </label>
                    <select
                      value={selectedStyle === 'whiteboard' ? 'whiteboard-sketch' : selectedStyle}
                      onChange={(e) => setSelectedStyle(e.target.value as ImageStylePreset)}
                      className="h-8 px-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-medium text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer w-full sm:w-[260px]"
                    >
                      {STYLE_CATEGORIES.map((category) => (
                        <optgroup key={category} label={category} className="bg-slate-900 text-indigo-300 font-semibold">
                          {STYLE_PRESETS.filter((p) => p.category === category).map((p) => (
                            <option key={p.id} value={p.id} className="bg-slate-950 text-slate-200 font-normal">
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* Auto-Diagram Intelligence Explainer Callout */}
                  <div className="px-3 py-2 bg-gradient-to-r from-indigo-950/40 via-blue-950/30 to-purple-950/20 border border-indigo-500/20 rounded-xl flex items-start gap-2 text-[11px] text-slate-300">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-indigo-200">Dynamic Diagram Engine: </span>
                      <span className="text-slate-300">
                        Choose your visual aesthetic above. The AI will automatically select the ideal diagram format (Timelines, Workflows, Flowcharts, Modular Hubs, Data Viz, Schematics) per scene based on the narration.
                      </span>
                    </div>
                  </div>

                  {/* Active Preset Highlight Banner */}
                  {(() => {
                    const activePreset =
                      STYLE_PRESETS.find(
                        (p) => p.id === selectedStyle || (p.id === 'whiteboard-sketch' && selectedStyle === 'whiteboard')
                      ) || STYLE_PRESETS[0];
                    return (
                      <div className="p-3 bg-indigo-950/20 border border-indigo-900/40 rounded-xl flex items-start gap-2.5 text-xs text-slate-300">
                        <span className="mt-0.5 text-indigo-400 shrink-0">
                          {renderStylePresetIcon(activePreset.iconName, 'w-4 h-4')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-indigo-200">{activePreset.name}</span>
                            {activePreset.badge && (
                              <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-indigo-950/80 border border-indigo-800/80 text-indigo-300">
                                {activePreset.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-400 text-[11px] mt-0.5">{activePreset.description}</p>
                          <span className="text-indigo-400/80 block text-[10px] mt-1 font-medium">
                            ✨ Auto-diagrams active: Each scene layout will adapt dynamically based on narration.
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-slate-800/80">
                  {/* Background Music */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                        <Music className="w-3.5 h-3.5 text-indigo-400" /> Music Track
                      </label>
                      <label className="text-[11px] font-semibold text-indigo-400 hover:underline cursor-pointer">
                        + Upload
                        <input type="file" accept="audio/*" onChange={handleFileUploadMusic} className="hidden" />
                      </label>
                    </div>
                    <select
                      value={selectedMusicId}
                      onChange={(e) => setSelectedMusicId(e.target.value)}
                      className="w-full h-10 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-slate-200 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="">No Music</option>
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.genre})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Voice Selection */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-indigo-400" /> Narrator Voice
                    </label>
                    <div className="flex items-center justify-between p-2.5 bg-slate-950 border border-slate-800 rounded-xl h-10">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/30">
                          {activeVoice.name.charAt(0)}
                        </div>
                        <div className="truncate">
                          <span className="font-bold text-slate-100 text-xs">{activeVoice.name}</span>
                          <span className="text-[11px] text-slate-400 ml-1.5 hidden md:inline">({activeVoice.description})</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsVoiceModalOpen(true)}
                        className="px-2.5 py-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Option Checkbox */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={bypassCache}
                  onChange={(e) => setBypassCache(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 transition cursor-pointer"
                />
                <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Bypass Cache / Force Fresh Generation
                </span>
              </label>

              {/* Topic Angles Selection (if topics generated) */}
              {topicAngles.length > 0 && (
                <div className="bg-indigo-950/40 border border-indigo-800/80 rounded-xl p-5 flex flex-col gap-3 w-full">
                  <h3 className="text-xs font-bold text-indigo-200 flex items-center gap-1.5 uppercase tracking-wider">
                    <Target className="w-4 h-4 text-indigo-400" /> What should the video focus on?
                  </h3>
                  <div className="flex flex-col gap-2">
                    {topicAngles.map((a, i) => {
                      const isSelected = selectedTopicIndices.size === 0 || selectedTopicIndices.has(i);
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            const next = new Set(selectedTopicIndices);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            setSelectedTopicIndices(next);
                          }}
                          className={`p-3 rounded-xl border cursor-pointer flex items-start gap-3 transition-all ${
                            isSelected
                              ? 'bg-slate-900 border-indigo-500 text-slate-100 shadow-sm'
                              : 'bg-slate-950/60 border-slate-800 text-slate-400 opacity-60'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center text-[10px] font-bold ${
                              isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            {isSelected ? '✓' : ''}
                          </div>
                          <div>
                            <div className="text-xs font-semibold">{a.label}</div>
                            <div className="text-[11px] text-slate-400">{a.description}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={confirmTopics}
                    className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-md transition-colors cursor-pointer"
                  >
                    Continue with Selection
                  </button>
                </div>
              )}

              {/* Actions */}
              {!topicAngles.length && (
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={isProcessing || !hasValidInput}
                    className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Generating... {statusMsg}</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                        <span>Generate Storyboard</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch('/latest_manifest.json?_=' + Date.now());
                        if (!res.ok) return;
                        const data = await res.json();
                        const m = data.manifest || data;
                        if (!m?.scenes?.length) return;
                        setManifest(m);
                        await resyncSceneDurations(m);
                        setStep('edit');
                      } catch {}
                    }}
                    className="w-full h-10 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 rounded-xl transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>Open Saved Storyboard</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: EDIT & RENDER STORYBOARD */}
        {step === 'edit' && (
          <div className="relative w-full space-y-4">
            {/* UI Locking Overlay during rendering */}
            {isRendering && (
              <div className="absolute inset-0 z-30 bg-slate-950/70 backdrop-blur-sm rounded-2xl flex items-center justify-center p-6">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl text-center space-y-4">
                  <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mx-auto" />
                  <h3 className="text-base font-bold text-white">Rendering Video... {renderProgress}%</h3>
                  <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="bg-indigo-600 h-full transition-all duration-300"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 font-mono">{renderFrameInfo}</p>
                </div>
              </div>
            )}

            {/* High-Level 2-Column Structure (gap-3: 12px / 3pt gap) */}
            <div className="flex flex-col lg:flex-row gap-3 items-start w-full">
              {/* Left Column: Player Canvas, Director Toolbar, Timeline */}
              <div className="flex-1 w-full min-w-0 flex flex-col gap-4">
                {/* Director Control Toolbar (Two-Tier Redesign - Moved ABOVE Video Box) */}
                <div className="flex flex-col gap-3 w-full">
                  {/* Row 1: Director & Generation Settings */}
                  <div className="h-11 flex items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-xl px-4 w-full">
                    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                      {/* Camera Motion */}
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-slate-400 flex items-center gap-1 shrink-0">
                          <Camera className="w-3.5 h-3.5 text-indigo-400" /> Camera:
                        </label>
                        <select
                          value={director.camera.preset}
                          onChange={(e) =>
                            setDirector({ ...director, camera: { ...director.camera, preset: e.target.value as any } })
                          }
                          title="Select camera motion preset (Static, Dolly In, Focus Pull, Dutch Angle)"
                          className="h-8 w-[140px] bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-indigo-500 font-medium cursor-pointer"
                        >
                          <option value="static">Static</option>
                          <option value="slow_dolly_in">Dolly In</option>
                          <option value="macro_focus_pull">Focus Pull</option>
                          <option value="dutch_angle">Dutch Angle</option>
                        </select>
                      </div>

                      {/* Lighting */}
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-slate-400 flex items-center gap-1 shrink-0">
                          <Palette className="w-3.5 h-3.5 text-indigo-400" /> Lighting:
                        </label>
                        <select
                          value={director.lighting}
                          onChange={(e) => setDirector({ ...director, lighting: e.target.value as LightingPreset })}
                          title="Select lighting mood preset (Flat, Golden Hour, Studio Key, Dramatic)"
                          className="h-8 w-[140px] bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-indigo-500 font-medium cursor-pointer"
                        >
                          <option value="flat">Flat</option>
                          <option value="golden_hour">Golden Hour</option>
                          <option value="studio_key">Studio Key</option>
                          <option value="dramatic_shadows">Dramatic</option>
                        </select>
                      </div>

                      {/* Audio */}
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-slate-400 flex items-center gap-1 shrink-0">
                          <Music className="w-3.5 h-3.5 text-indigo-400" /> Track:
                        </label>
                        <select
                          value={selectedMusicId}
                          onChange={(e) => setSelectedMusicId(e.target.value)}
                          title="Select background audio music track"
                          className="h-8 w-[140px] bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-indigo-500 font-medium cursor-pointer"
                        >
                          <option value="">No Music</option>
                          {musicTracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Voice */}
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-slate-400 flex items-center gap-1 shrink-0">
                          <Mic className="w-3.5 h-3.5 text-indigo-400" /> Voice:
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsVoiceModalOpen(true)}
                          title="Choose narrator voice profile"
                          className="h-8 w-[140px] bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 hover:bg-slate-800 font-medium flex items-center justify-between transition-colors cursor-pointer"
                        >
                          <span className="truncate">{activeVoice.name.split(' ')[0]}</span>
                          <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                        </button>
                      </div>

                      {/* Visual Style Preset */}
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-slate-400 flex items-center gap-1 shrink-0">
                          <Palette className="w-3.5 h-3.5 text-indigo-400" /> Style:
                        </label>
                        <select
                          value={selectedStyle === 'whiteboard' ? 'whiteboard-sketch' : selectedStyle}
                          onChange={(e) => setSelectedStyle(e.target.value as ImageStylePreset)}
                          title="Select visual style preset for image generation"
                          className="h-8 w-[170px] bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-indigo-500 font-medium cursor-pointer"
                        >
                          {STYLE_CATEGORIES.map((category) => (
                            <optgroup key={category} label={category} className="bg-slate-900 text-indigo-300 font-semibold">
                              {STYLE_PRESETS.filter((p) => p.category === category).map((p) => (
                                <option key={p.id} value={p.id} className="bg-slate-950 text-slate-200 font-normal">
                                  {p.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Toggle Badges */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setAnnotationConfig((prev) => ({
                            ...prev,
                            subtitle: { ...(prev.subtitle || {}), enabled: !prev.subtitle?.enabled },
                          }))
                        }
                        title="Toggle subtitle caption overlay on video"
                        style={{ paddingLeft: '0.875rem', paddingRight: '0.875rem', height: '32px' }}
                        className={`h-8 text-xs rounded-lg border font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                          annotationConfig.subtitle?.enabled
                            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Captions</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAnnotationConfig((prev) => ({ ...prev, showTitle: !prev.showTitle }))}
                        title="Toggle scene title text overlay on video"
                        style={{ paddingLeft: '0.875rem', paddingRight: '0.875rem', height: '32px' }}
                        className={`h-8 text-xs rounded-lg border font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                          annotationConfig.showTitle !== false
                            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
                        }`}
                      >
                        <Type className="w-3.5 h-3.5" />
                        <span>Title</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowCaptionSettings((v) => !v)}
                        title="Customize caption font size, text color, highlight color, and opacity"
                        style={{ paddingLeft: '0.875rem', paddingRight: '0.875rem', height: '32px' }}
                        className={`h-8 text-xs rounded-lg border font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                          showCaptionSettings
                            ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/30'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-300'
                        }`}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        <span>Caption Style</span>
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Primary Actions & Metadata (Uniform 150px Width Buttons & Tooltips) */}
                  <div className="h-12 flex items-center justify-between gap-3 bg-slate-900/60 border border-slate-800/80 rounded-xl px-4 w-full">
                    {/* Left / Generation Actions */}
                    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
                      {/* Primary CTA */}
                      <button
                        type="button"
                        onClick={() => handleGenerateVideos()}
                        disabled={isProcessing}
                        title="Generate AI video motion clips for all scenes using context prompts"
                        style={{ width: '150px', height: '36px' }}
                        className="h-9 w-[150px] bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>{isProcessing ? 'Generating...' : 'Generate Videos'}</span>
                      </button>

                      {/* Secondary CTAs (Uniform 150px width, h-9 height, font-semibold & tooltips) */}
                      <button
                        type="button"
                        onClick={() => triggerGroundingDino()}
                        disabled={isDetectingRegions}
                        title="Analyze canvas elements and sync layout bounding regions with audio hints"
                        style={{ width: '150px', height: '36px' }}
                        className="h-9 w-[150px] bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 whitespace-nowrap shadow-sm"
                      >
                        <Target className="w-3.5 h-3.5 text-violet-400" />
                        <span>{isDetectingRegions ? 'Syncing...' : 'Detect Regions'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => regenerateAllVoices()}
                        disabled={regeneratingVoiceIdx !== null}
                        title="Regenerate text-to-speech voiceovers for all scenes in the storyboard"
                        style={{ width: '150px', height: '36px' }}
                        className="h-9 w-[150px] bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 whitespace-nowrap shadow-sm"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                        <span>{regeneratingVoiceIdx === 'all' ? 'Regenerating...' : 'Voice (All)'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleGenerateThumbnail()}
                        title="Generate a custom high-converting cover thumbnail for your video"
                        style={{ width: '150px', height: '36px' }}
                        className="h-9 w-[150px] bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 whitespace-nowrap shadow-sm"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-rose-400" />
                        <span>Thumbnail</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleGenerateDescription()}
                        title="Generate AI summary, chapter timestamps, and description for publishing"
                        style={{ width: '150px', height: '36px' }}
                        className="h-9 w-[150px] bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 whitespace-nowrap shadow-sm"
                      >
                        <FileText className="w-3.5 h-3.5 text-sky-400" />
                        <span>Description</span>
                      </button>
                    </div>

                    {/* Right / Metadata Input */}
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="text"
                        value={logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                        placeholder="Logo URL (optional)"
                        className="w-52 h-9 px-3 bg-slate-950 border border-slate-800 rounded-lg text-xs placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans text-slate-200"
                      />
                    </div>
                  </div>
                </div>

                {/* Caption Style Settings Popover */}
                {showCaptionSettings && (
                  <div className="relative z-50">
                    <div className="absolute top-2 right-0 w-[320px] bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl text-slate-200">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" /> Caption Style Settings
                        </span>
                        <button onClick={() => setShowCaptionSettings(false)} className="text-slate-400 hover:text-slate-200 text-xs cursor-pointer">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <label className="flex items-center justify-between text-xs text-slate-300">
                        Font size (px)
                        <input
                          type="number" min={20} max={64}
                          value={annotationConfig.subtitle?.fontSize ?? 32}
                          onChange={(e) => setAnnotationConfig((prev) => ({ ...prev, subtitle: { ...(prev.subtitle || {}), fontSize: Number(e.target.value) || 32 } }))}
                          className="w-16 px-2 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100"
                        />
                      </label>

                      <label className="flex items-center justify-between text-xs text-slate-300">
                        Text color
                        <input
                          type="color"
                          value={annotationConfig.subtitle?.color ?? '#FFFFFF'}
                          onChange={(e) => setAnnotationConfig((prev) => ({ ...prev, subtitle: { ...(prev.subtitle || {}), color: e.target.value } }))}
                          className="w-10 h-7 bg-slate-950 border border-slate-800 rounded-md cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between text-xs text-slate-300">
                        Active word color
                        <input
                          type="color"
                          value={annotationConfig.subtitle?.activeWordColor ?? '#FFD700'}
                          onChange={(e) => setAnnotationConfig((prev) => ({ ...prev, subtitle: { ...(prev.subtitle || {}), activeWordColor: e.target.value } }))}
                          className="w-10 h-7 bg-slate-950 border border-slate-800 rounded-md cursor-pointer"
                        />
                      </label>

                      <div className="flex items-center justify-between text-xs text-slate-300">
                        Background
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={parseCaptionBg(annotationConfig.subtitle?.backgroundColor).hex}
                            onChange={(e) => setAnnotationConfig((prev) => ({ ...prev, subtitle: { ...(prev.subtitle || {}), backgroundColor: hexToRgba(e.target.value, parseCaptionBg(prev.subtitle?.backgroundColor).alpha) } }))}
                            className="w-10 h-7 bg-slate-950 border border-slate-800 rounded-md cursor-pointer"
                          />
                          <input
                            type="range" min={0} max={100}
                            value={Math.round(parseCaptionBg(annotationConfig.subtitle?.backgroundColor).alpha * 100)}
                            onChange={(e) => setAnnotationConfig((prev) => ({ ...prev, subtitle: { ...(prev.subtitle || {}), backgroundColor: hexToRgba(parseCaptionBg(prev.subtitle?.backgroundColor).hex, Number(e.target.value) / 100) } }))}
                            className="w-[70px] accent-indigo-600"
                            title="Background opacity"
                          />
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={annotationConfig.subtitle?.highlightActiveWord !== false}
                          onChange={(e) => setAnnotationConfig((prev) => ({ ...prev, subtitle: { ...(prev.subtitle || {}), highlightActiveWord: e.target.checked } }))}
                          className="w-4 h-4 accent-indigo-600 rounded"
                        />
                        Highlight active word
                      </label>
                    </div>
                  </div>
                )}

                {/* Main Video Canvas Container */}
                <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-slate-800 w-full">
                  <Player
                    ref={playerRef}
                    component={ExplainerStoryComposition}
                    durationInFrames={calculatedTotalFrames}
                    fps={30}
                    compositionWidth={1920}
                    compositionHeight={1080}
                    style={{ width: '100%', height: '100%' }}
                    acknowledgeRemotionLicense
                    inputProps={playerInputProps}
                  />

                  <CanvasEditor
                    elements={manifest.scenes[selectedScene]?.layout?.elements || []}
                    selectedElementId={selectedElementId}
                    onSelectElement={(elemId) => setSelectedElementId(elemId)}
                    onUpdateElementPosition={(elemId, patch) => {
                      setManifest((prev) => ({
                        ...prev,
                        scenes: prev.scenes.map((sc, idx) =>
                          idx === selectedScene
                            ? {
                                ...sc,
                                layout: {
                                  ...sc.layout,
                                  elements: (sc.layout?.elements || []).map((el) =>
                                    el.id === elemId ? { ...el, ...patch } : el
                                  ),
                                },
                              }
                            : sc
                        ),
                      }));
                    }}
                  />
                </div>

                {/* Timeline Container (Exact 100% width match) */}
                <Timeline
                  manifest={manifest}
                  selectedScene={selectedScene}
                  onSelectScene={(idx) => {
                    setSelectedScene(idx);
                    setSelectedElementId(null);
                    const startSec = manifest.scenes
                      .slice(0, idx)
                      .reduce((a, s) => a + (s.duration || 10), 0);
                    const targetFrame = Math.round(startSec * 30);
                    setCurrentFrame(targetFrame);
                    playerRef.current?.seekTo(targetFrame);
                  }}
                  onUpdateSceneDuration={(sceneIdx, newDuration) => {
                    const ns = manifest.scenes.map((sc, i) =>
                      i === sceneIdx ? { ...sc, duration: newDuration } : sc
                    );
                    const newTargetDur = ns.reduce((acc, sc) => acc + (sc.duration || 10), 0);
                    setManifest({
                      ...manifest,
                      scenes: ns,
                      meta: { ...manifest.meta, targetDuration: newTargetDur },
                    });
                  }}
                  currentFrame={currentFrame}
                  totalFrames={calculatedTotalFrames}
                  fps={30}
                  onSeek={(frame) => {
                    setCurrentFrame(frame);
                    playerRef.current?.seekTo(frame);
                  }}
                  isPlaying={isPlaying}
                  onTogglePlay={() => {
                    if (playerRef.current?.isPlaying()) {
                      playerRef.current.pause();
                    } else {
                      playerRef.current?.play();
                    }
                  }}
                  selectedElementId={selectedElementId}
                  onSelectElement={(elementId, sceneIdx) => {
                    setSelectedScene(sceneIdx);
                    setSelectedElementId(elementId);
                  }}
                />
              </div>

              {/* Right Column: Scenes List Sidebar (Tightened 3pt Max Gaps) */}
              {showScenePanel && (
                <div
                  style={{ padding: '8px' }}
                  className="w-[420px] shrink-0 bg-slate-900/40 border border-slate-800 rounded-2xl flex flex-col h-[calc(100vh-6.5rem)] shadow-xl overflow-hidden"
                >
                  {/* Dedicated Header Card */}
                  <div
                    style={{ padding: '8px 10px', marginBottom: '8px' }}
                    className="bg-slate-900/90 border border-slate-800 rounded-xl flex items-center justify-between shadow-sm shrink-0"
                  >
                    <div className="flex items-center gap-2">
                      <Film className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Storyboard Scenes ({manifest.scenes.length})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAddScene}
                        style={{ paddingLeft: '0.75rem', paddingRight: '0.75rem', height: '28px' }}
                        className="h-7 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm shrink-0 whitespace-nowrap"
                        title="Add a new scene at the end"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Scene</span>
                      </button>
                      <button
                        onClick={() => setShowScenePanel(false)}
                        className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        title="Close panel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Scrollable Card Body Container (gap-2: 8px max inter-card gap) */}
                  <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1 pb-1">
                    {manifest.scenes.map((scene, idx) => {
                      const isSelected = selectedScene === idx;
                      const imgElement = scene.layout?.elements?.find((el) => el.type === 'image');
                      const thumbUrl = imgElement?.sourceAssetId || imgElement?.content;
                      const formattedDuration = formatTimecode(scene.duration || 10);

                      return (
                        <div
                          key={scene.sceneNumber}
                          onClick={() => {
                            setSelectedScene(idx);
                            const startSec = manifest.scenes
                              .slice(0, idx)
                              .reduce((a, s) => a + (s.duration || 10), 0);
                            playerRef.current?.seekTo(Math.round(startSec * 30));
                          }}
                          style={{ padding: '10px 12px' }}
                          className={`bg-slate-900/90 border rounded-xl space-y-2.5 transition-colors shadow-sm cursor-pointer ${
                            isSelected
                              ? 'border-indigo-500 ring-1 ring-indigo-500/30 bg-slate-900 shadow-md'
                              : 'border-slate-800 hover:border-slate-700/80'
                          }`}
                        >
                          {/* A. Card Header */}
                          <div className="flex items-center justify-between">
                            {/* Left Meta */}
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                                Scene {String(scene.sceneNumber).padStart(2, '0')}
                              </span>
                              <span className="text-[11px] font-medium text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                                {scene.animationStrategy === 'text_to_video'
                                  ? 'Text to Video'
                                  : scene.animationStrategy === 'image_to_video'
                                  ? 'Image to Video'
                                  : scene.layout?.clearCanvas
                                  ? 'AI Image'
                                  : 'Diagram'}
                              </span>
                            </div>

                            {/* Right Meta */}
                            <div className="flex items-center gap-2 text-slate-400 text-xs" onClick={(e) => e.stopPropagation()}>
                              <span className="font-mono text-slate-400 text-xs bg-slate-950 px-2 py-0.5 rounded border border-slate-800 mr-0.5">
                                {formattedDuration}
                              </span>

                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveScene(idx, 'up')}
                                className="p-1 hover:text-slate-200 transition-colors disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer"
                                title="Move Scene Up"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                disabled={idx === manifest.scenes.length - 1}
                                onClick={() => handleMoveScene(idx, 'down')}
                                className="p-1 hover:text-slate-200 transition-colors disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer"
                                title="Move Scene Down"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDuplicateScene(idx)}
                                className="p-1 hover:text-indigo-300 transition-colors cursor-pointer"
                                title="Duplicate Scene"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                disabled={manifest.scenes.length <= 1}
                                onClick={() => handleDeleteScene(idx)}
                                className="p-1 hover:text-rose-400 transition-colors disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer"
                                title="Delete Scene"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* B. Card Body (2-Column Grid) */}
                          <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
                            {/* Thumbnail Column */}
                            <div className="w-[100px] h-[68px] rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0 relative group">
                              {thumbUrl && !thumbUrl.startsWith('data:') ? (
                                <img src={thumbUrl} alt={`Scene ${scene.sceneNumber}`} className="w-full h-full object-cover" />
                              ) : (
                                <div className="flex flex-col items-center justify-center text-slate-600">
                                  {scene.animationStrategy === 'text_to_video' || scene.animationStrategy === 'image_to_video' ? (
                                    <Film className="w-5 h-5 text-slate-600 opacity-60" />
                                  ) : (
                                    <ImageIcon className="w-5 h-5 text-slate-600 opacity-60" />
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Script Column */}
                            <textarea
                              value={scene.narration}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                const newNarration = e.target.value;
                                const newScenes = manifest.scenes.map((sc, i) =>
                                  i === idx ? { ...sc, narration: newNarration } : sc
                                );
                                const newManifest = { ...manifest, scenes: newScenes };
                                setManifest(newManifest);
                                persistState(newManifest, sceneAudio);
                              }}
                              placeholder="Script / Narration text..."
                              className="w-full h-[68px] p-2 bg-slate-950/60 border border-slate-800/80 rounded-lg text-xs leading-relaxed text-slate-300 resize-none focus:border-indigo-500 focus:outline-none overflow-y-auto font-sans"
                            />
                          </div>

                          {/* C. Card Footer Actions */}
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60 flex-wrap" style={{ marginTop: '12px' }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInsertScene(idx + 1);
                              }}
                              style={{ paddingLeft: '10px', paddingRight: '10px', height: '28px', marginTop: '2px', marginBottom: '2px' }}
                              className="h-7 text-[11px] font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-md transition flex items-center gap-1 cursor-pointer border border-slate-700/50"
                              title="Insert scene after this scene"
                            >
                              <Plus className="w-3 h-3 text-indigo-400" />
                              <span>Insert</span>
                            </button>

                            <button
                              type="button"
                              disabled={regeneratingVoiceIdx !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                regenerateSceneVoice(idx);
                              }}
                              style={{ paddingLeft: '10px', paddingRight: '10px', height: '28px', marginTop: '2px', marginBottom: '2px' }}
                              className={`h-7 text-[11px] font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-md transition flex items-center gap-1 border border-slate-700/50 ${
                                regeneratingVoiceIdx === idx ? 'opacity-60 cursor-wait' : ''
                              }`}
                              title="Regenerate voiceover for this scene"
                            >
                              <Mic className="w-3 h-3 text-amber-400" />
                              <span>{regeneratingVoiceIdx === idx ? 'Generating...' : 'Voice'}</span>
                            </button>

                            <button
                              type="button"
                              disabled={regeneratingImageIdx !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                regenerateSceneImage(idx);
                              }}
                              style={{ paddingLeft: '10px', paddingRight: '10px', height: '28px', marginTop: '2px', marginBottom: '2px' }}
                              className={`h-7 text-[11px] font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-md transition flex items-center gap-1 border border-slate-700/50 ${
                                regeneratingImageIdx === idx ? 'opacity-60 cursor-wait' : ''
                              }`}
                              title="Regenerate image"
                            >
                              <RefreshCw className="w-3 h-3 text-emerald-400" />
                              <span>{regeneratingImageIdx === idx ? 'Generating...' : 'Re-Image'}</span>
                            </button>

                            {(scene.animationStrategy === 'text_to_video' || scene.animationStrategy === 'image_to_video') && (
                              <button
                                type="button"
                                disabled={videoGenStatus[scene.sceneNumber] === 'generating'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  regenerateSceneVideo(idx);
                                }}
                                style={{ paddingLeft: '10px', paddingRight: '10px', height: '28px', marginTop: '2px', marginBottom: '2px' }}
                                className={`h-7 text-[11px] font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-md transition flex items-center gap-1 border border-slate-700/50 ${
                                  videoGenStatus[scene.sceneNumber] === 'generating' ? 'opacity-60 cursor-wait' : ''
                                }`}
                                title="Regenerate video motion"
                              >
                                <Wand2 className="w-3 h-3 text-purple-400" />
                                <span>{videoGenStatus[scene.sceneNumber] === 'generating' ? 'Generating...' : 'Video'}</span>
                              </button>
                            )}

                            <label
                              style={{ paddingLeft: '10px', paddingRight: '10px', height: '28px', marginTop: '2px', marginBottom: '2px' }}
                              className="h-7 text-[11px] font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-md transition flex items-center gap-1 cursor-pointer border border-slate-700/50"
                            >
                              <Upload className="w-3 h-3 text-sky-400" />
                              <span>Upload</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleCustomImageUpload(idx, file);
                                }}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {!showScenePanel && (
                <button
                  onClick={() => setShowScenePanel(true)}
                  className="fixed right-6 bottom-6 z-40 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-xs font-bold transition-all cursor-pointer border border-indigo-400/30"
                >
                  <Film className="w-4 h-4" />
                  <span>Show Scenes ({manifest.scenes.length})</span>
                </button>
              )}
            </div>

            {/* Render error banner */}
            {renderError && (
              <div className="bg-rose-950/80 border border-rose-800 text-rose-200 rounded-xl p-4 flex items-center justify-between text-xs font-medium">
                <span>⚠️ {renderError}</span>
                <button onClick={() => setRenderError('')} className="text-rose-400 hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Export completion banner */}
            {showExportControls && renderUrl && (
              <div className="bg-slate-900 border border-emerald-800/80 rounded-xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Check className="w-5 h-5 text-emerald-400" />
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Render Complete! Your video is ready.
                      </h3>
                      <p className="text-xs text-slate-400">Download your MP4 video or export storyboard metadata.</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowExportControls(false)}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>

                <div className="flex flex-wrap gap-2.5 pt-1">
                  <a
                    href={renderUrl}
                    download="omnicast_explainer.mp4"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-4 h-4" /> Download MP4 Video
                  </a>
                  <button
                    onClick={() => {
                      const textContent = formatManifestAsText(manifest, sceneAudio);
                      const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `storyboard_script.txt`;
                      a.click();
                    }}
                    className="px-3.5 py-2 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Export Script (.txt)
                  </button>
                  <button
                    onClick={() => {
                      const jsonObj = cleanManifestForJson(manifest, sceneAudio);
                      const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: 'application/json;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `storyboard_clean.json`;
                      a.click();
                    }}
                    className="px-3.5 py-2 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Export Manifest (.json)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Render Destination Dialog */}
      {showRenderDialog && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Film className="w-5 h-5 text-indigo-400" /> Render Video
              </h3>
              <button onClick={() => setShowRenderDialog(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Choose output options for rendering your high-resolution MP4 video with custom voiceovers and background music.
            </p>

            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-semibold">
              Destination folder
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={renderOutputDir}
                  onChange={(e) => setRenderOutputDir(e.target.value)}
                  placeholder="out (default)"
                  className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch('/api/pick-folder');
                      const j = await r.json();
                      if (j.folder) setRenderOutputDir(j.folder);
                    } catch (e) { console.warn('[Render] Folder picker failed:', e); }
                  }}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer"
                >
                  Browse…
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-semibold">
              Output filename
              <input
                type="text"
                value={renderOutputName}
                onChange={(e) => setRenderOutputName(e.target.value)}
                placeholder="generated_video"
                autoFocus
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-[10px] text-slate-500 font-normal">.mp4 is appended automatically if omitted.</span>
            </label>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowRenderDialog(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowRenderDialog(false); handleRenderMp4(); }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-md shadow-indigo-600/30 cursor-pointer"
              >
                Start Render
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Selection Modal */}
      <VoiceSelectionModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        voices={voices}
        selectedVoiceId={selectedVoiceId}
        onSelectVoice={(id) => setSelectedVoiceId(id)}
        onAddCustomVoice={handleAddCustomVoice}
      />

      {/* YouTube Thumbnail Preview Modal */}
      {isThumbnailModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-rose-400" /> YouTube Click-Bait Thumbnail
                </h3>
                <p className="text-xs text-slate-400">AI-optimized high-CTR thumbnail teaser concept.</p>
              </div>
              <button onClick={() => setIsThumbnailModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {isGeneratingThumbnail ? (
              <div className="py-12 text-center flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-rose-500 animate-spin" />
                <div className="text-sm font-semibold text-white">Generating Viral Thumbnail...</div>
              </div>
            ) : thumbnailData ? (
              <div className="space-y-4">
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-slate-800 shadow-xl">
                  {thumbnailData.imageUrl ? (
                    <img src={thumbnailData.imageUrl} alt="YouTube Thumbnail" className="w-full h-full object-cover" />
                  ) : null}
                  <div className="absolute bottom-4 left-4 bg-rose-600 text-white px-4 py-2 rounded-lg font-black text-xl tracking-wider uppercase border-2 border-white shadow-lg">
                    {thumbnailData.overlayText}
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">AI Prompt:</div>
                  <p className="text-xs text-slate-300 italic">{thumbnailData.imagePrompt}</p>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={handleGenerateThumbnail}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCw className="w-3.5 h-3.5" /> Regenerate Concept
                  </button>

                  <a
                    href={thumbnailData.imageUrl}
                    download="youtube_thumbnail.jpg"
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-4 h-4" /> Download Thumbnail
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* YouTube Description Preview Modal */}
      {isDescriptionModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 text-slate-100 max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                  <FileText className="w-5 h-5 text-sky-400" /> YouTube Description & Chapters
                </h3>
                <p className="text-xs text-slate-400">SEO description with timestamps ready for copy-paste.</p>
              </div>
              <button onClick={() => setIsDescriptionModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {isGeneratingDescription ? (
              <div className="py-12 text-center flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
                <div className="text-sm font-semibold text-white">Generating YouTube Copy & Timestamps...</div>
              </div>
            ) : descriptionData ? (
              <div className="space-y-4 overflow-y-auto pr-1 flex-1">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Suggested YouTube Title:</div>
                  <div className="text-sm font-bold text-white">{descriptionData.title}</div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Full Video Description:</label>
                  <textarea
                    readOnly
                    value={descriptionData.description}
                    className="w-full h-56 p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-mono leading-relaxed outline-none resize-none"
                  />
                </div>

                <div className="flex justify-between items-center pt-2">
                  <button
                    onClick={handleGenerateDescription}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCw className="w-3.5 h-3.5" /> Regenerate Copy
                  </button>

                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(descriptionData.description);
                      alert('YouTube description copied to clipboard!');
                    }}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-4 h-4" /> Copy Description
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
