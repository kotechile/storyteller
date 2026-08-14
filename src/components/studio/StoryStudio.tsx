import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { ExplainerStoryComposition } from '../../compositions/storyteller/ExplainerStoryComposition';
import { sampleStoryboardManifest } from '../../lib/sampleData';
import { StoryboardManifest, CameraInstruction, ImageStylePreset, SceneAudio, AnnotationConfig } from '../../types/storyboard';
import { LightingPreset } from '../../compositions/storyteller/BackgroundRenderer';
import { ingestUrl, ingestPdf } from '../../lib/ingest';
import { generateContextAwareStoryboard, generateVideosForManifest, ContentContext } from '../../lib/contextEngine';
import { MusicTrack, getTrackSourceById, saveCustomBrowserTrack, getTrackList } from '../../lib/musicLibrary';
import { loadVoiceLibrary, addCustomVoice, resolveVoiceId, VoiceEntry } from '../../lib/voiceLibrary';
import { proposeTopicAngles, TopicAngle, generateYouTubeThumbnailPrompt, generateYouTubeDescription, YouTubeDescriptionResult } from '../../lib/narrativeEngine';
import { generateRegionFocusEvents } from '../../lib/regionSync';
import { isGroundingDinoAvailable } from '../../lib/groundingDinoClient';
import { CanvasEditor } from './CanvasEditor';
import { Timeline } from './Timeline';
import { formatManifestAsText, cleanManifestForJson } from '../../lib/storyboardExporter';
import { VoiceSelectionModal } from './VoiceSelectionModal';

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

// ── Types ──

type WizardStep = 'import' | 'edit';

interface DirectorState {
  camera: CameraInstruction;
  lighting: LightingPreset;
}

// ── Step Indicator Component ──

const StepIndicator: React.FC<{ step: WizardStep }> = ({ step }) => {
  const steps = [
    { key: 'import' as WizardStep, label: '1. Import Content' },
    { key: 'edit' as WizardStep, label: '2. Edit & Render Storyboard' },
  ];
  const idx = steps.findIndex((x) => x.key === step);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', paddingTop: '48px', paddingBottom: '36px', paddingLeft: '16px', paddingRight: '16px' }}>
      {steps.map((st, i) => (
        <React.Fragment key={st.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 700,
                backgroundColor: i <= idx ? '#4F46E5' : '#F1F5F9',
                color: i <= idx ? '#FFFFFF' : '#94A3B8',
                boxShadow: i <= idx ? '0 4px 10px rgba(79, 70, 229, 0.25)' : 'none',
              }}
            >
              {i < idx ? '✓' : i + 1}
            </div>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: i === idx ? '#0F172A' : '#94A3B8',
              }}
            >
              {st.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                width: '64px',
                height: '2px',
                borderRadius: '9999px',
                backgroundColor: i < idx ? '#4F46E5' : '#E2E8F0',
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// ── Main Component ──

export const StoryStudio: React.FC = () => {
  const [step, setStep] = useState<WizardStep>('import');

  // Input states for Screen 1
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
  const [contextInfo, setContextInfo] = useState<ContentContext | null>(null);
  const [selectedScene, setSelectedScene] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [showScenePanel, setShowScenePanel] = useState(true);
  const [topicAngles, setTopicAngles] = useState<TopicAngle[]>([]);
  const [selectedTopicIndices, setSelectedTopicIndices] = useState<Set<number>>(new Set());
  const [pendingArticle, setPendingArticle] = useState<any>(null);
  const [actualWordTimestamps, setActualWordTimestamps] = useState<any[]>([]);
  const [sceneAudio, setSceneAudio] = useState<SceneAudio[]>([]);
  const [regeneratingVoiceIdx, setRegeneratingVoiceIdx] = useState<number | 'all' | null>(null);
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
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('rachel');

  // Voice Selection Modal State
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  // Render & Export states (integrated in Screen 2)
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [renderUrl, setRenderUrl] = useState('');
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderFrameInfo, setRenderFrameInfo] = useState('');
  const [showExportControls, setShowExportControls] = useState(false);

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
      const encPrompt = encodeURIComponent(result.imagePrompt);
      const imageUrl = `https://image.pollinations.ai/prompt/${encPrompt}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
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

    // Auto-restore saved storyboard state from disk on mount
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
          if (data.sceneAudio?.length) {
            // Keep existing sceneAudio intact
          } else {
            resyncSceneDurations(m).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  const activeVoice = useMemo(() => {
    return voices.find((v) => v.id === selectedVoiceId || v.voiceId === selectedVoiceId) || voices[0] || {
      id: 'rachel',
      voiceId: '21m00Tcm4TlvDq8ikWAM',
      name: 'Rachel (Default)',
      description: 'Calm, clear, and professional female voice',
      gender: 'female',
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

  // RAF loop for real-time playhead sync
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
  });

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

  // Auto-sync selectedScene with playhead
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

  // Progressive Disclosure Check
  const hasValidInput = Boolean(urlInput.trim() || pdfFile);

  // ── Handlers ──

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
            // Auto-generate videos (image_to_video / text_to_video) in background
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

    // Mark all video scenes as generating
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

  // Auto-trigger video generation in the background after the storyboard is ready.
  // Does NOT block the UI — runs silently and updates the manifest as videos finish.
  const generateVideosInBackground = async (m: StoryboardManifest, sa: SceneAudio[]) => {
    const videoScenes = m.scenes.filter(
      (s: any) => s.animationStrategy === 'image_to_video' || s.animationStrategy === 'text_to_video'
    );
    if (videoScenes.length === 0) return;

    console.log(`[StoryStudio] Auto-generating videos for ${videoScenes.length} video scene(s) in background...`);
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
      console.log('[StoryStudio] Background video generation complete.');
    } catch (err) {
      console.warn('[StoryStudio] Background video generation failed (non-fatal):', err);
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
              const freshUrl = `/out/generated_video.mp4?t=${Date.now()}`;
              setRenderUrl(freshUrl);
              setShowExportControls(true);
              // Trigger celebratory confetti effect
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

    // Preserve existing sceneAudio (timestamped URLs + word timestamps) from state
    const existingAudio: SceneAudio[] = sceneAudio;

    const probed = await Promise.all(
      currentManifest.scenes.map(async (scene) => {
        const existing = existingAudio.find((sa) => sa.sceneNumber === scene.sceneNumber);
        // Use the ACTUAL audioUrl from state (timestamped), fall back only if missing
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
    const audioToUse =
      valid.length > 0
        ? valid
        : probed;

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
    <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', color: '#0F172A', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Header Navigation */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #E2E8F0', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontWeight: 900, fontSize: '18px', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)' }}>
            O
          </div>
          <div>
            <span style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.02em', color: '#0F172A' }}>OmniCast</span>
            <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', backgroundColor: '#EEF2FF', color: '#4338CA', borderRadius: '9999px', border: '1px solid #E0E7FF' }}>
              Studio Pro
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {step === 'edit' && (
            <>
              <button
                onClick={() => setStep('import')}
                style={{ padding: '8px 16px', backgroundColor: '#FFFFFF', color: '#334155', fontSize: '14px', fontWeight: 600, borderRadius: '12px', border: '1px solid #CBD5E1', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
              >
                ← Back to Import
              </button>
              <button
                onClick={handleRenderMp4}
                disabled={isRendering}
                style={{ padding: '8px 24px', backgroundColor: '#4F46E5', color: '#FFFFFF', fontSize: '14px', fontWeight: 600, borderRadius: '12px', border: 'none', cursor: isRendering ? 'not-allowed' : 'pointer', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)', opacity: isRendering ? 0.6 : 1 }}
              >
                {isRendering ? 'Rendering MP4...' : '🎬 Render Video'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Step Progress Bar */}
      <StepIndicator step={step} />

      <main style={{ maxWidth: step === 'edit' ? '1600px' : '760px', margin: '0 auto', padding: step === 'edit' ? '0 24px 48px' : '0 16px 80px' }}>
        {/* ─── STEP 1: IMPORT CONTENT ─── */}
        {step === 'import' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: '32px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                Create an Explainer Video
              </h1>
              <p style={{ fontSize: '15px', color: '#64748B', maxWidth: '520px', margin: '0 auto', lineHeight: '1.6' }}>
                Paste an article URL or upload a PDF document. We'll automatically build an interactive scene storyboard and AI narration.
              </p>
            </div>

            {error && (
              <div style={{ padding: '16px', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '16px', color: '#B91C1C', fontSize: '14px' }}>
                {error}
              </div>
            )}

            {warningFallback && (
              <div style={{ padding: '16px', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '16px', color: '#92400E', fontSize: '14px' }}>
                ⚠️ <strong>No LLM API key configured.</strong> Using template content.
              </div>
            )}

            {/* Input Card */}
            <div style={{ backgroundColor: '#FFFFFF', borderRadius: '24px', padding: '28px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)', border: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  1. Content Source
                </label>
                <div style={{ display: 'flex', backgroundColor: '#F1F5F9', padding: '4px', borderRadius: '12px', gap: '4px' }}>
                  {(['url', 'pdf'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setImportMode(mode)}
                      style={{
                        padding: '6px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, border: 'none', cursor: 'pointer',
                        backgroundColor: importMode === mode ? '#FFFFFF' : 'transparent',
                        color: importMode === mode ? '#312E81' : '#64748B',
                        boxShadow: importMode === mode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      }}
                    >
                      {mode === 'url' ? '🌐 Article URL' : '📄 PDF File'}
                    </button>
                  ))}
                </div>
              </div>

              {importMode === 'url' ? (
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/blog-or-article"
                  style={{ width: '100%', padding: '14px 18px', backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '14px', fontSize: '16px', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                />
              ) : (
                <label style={{ width: '100%', minHeight: '140px', border: '2px dashed #CBD5E1', borderRadius: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', cursor: 'pointer', backgroundColor: pdfFile ? '#EEF2FF' : '#F8FAFC', boxSizing: 'border-box' }}>
                  {pdfFile ? (
                    <div style={{ textAlign: 'center' }}>
                      <span style={{ fontWeight: 700, color: '#0F172A', fontSize: '14px', display: 'block' }}>{pdfFile.name}</span>
                      <span style={{ fontSize: '12px', color: '#64748B' }}>{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#64748B' }}>
                      <span style={{ fontSize: '24px', display: 'block', marginBottom: '4px' }}>📁</span>
                      <span style={{ fontSize: '14px', fontWeight: 500, display: 'block' }}>Click to upload or drag & drop PDF</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                    style={{ display: 'none' }}
                  />
                </label>
              )}
            </div>

            {/* Progressive Disclosure: Creative Settings unlock when URL or PDF is present */}
            {hasValidInput && (
              <div style={{ backgroundColor: '#FFFFFF', borderRadius: '24px', padding: '28px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)', border: '1px solid #F1F5F9', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: '12px' }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
                    2. Creative Customizations
                  </h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px' }}>
                  {/* Visual Style Dropdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Visual Style Preset
                    </label>
                    <select
                      value={selectedStyle}
                      onChange={(e) => setSelectedStyle(e.target.value as ImageStylePreset)}
                      style={{ width: '100%', padding: '12px 16px', backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#0F172A', outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="photo-realistic">📷 Photo Realistic (35mm)</option>
                      <option value="whiteboard">✏️ Whiteboard Diagrams</option>
                      <option value="illustration">🎨 Vector Illustration</option>
                      <option value="chalkboard">🧹 Chalkboard (Classic Dark)</option>
                      <option value="chalk-drawing">🎓 Academic Chalk Drawing</option>
                    </select>
                  </div>

                  {/* Background Music Dropdown */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Background Music
                      </label>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#4F46E5', cursor: 'pointer' }}>
                        + Upload Custom Track
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={handleFileUploadMusic}
                          style={{ display: 'none' }}
                        />
                      </label>
                    </div>
                    <select
                      value={selectedMusicId}
                      onChange={(e) => setSelectedMusicId(e.target.value)}
                      style={{ width: '100%', padding: '12px 16px', backgroundColor: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#0F172A', outline: 'none', cursor: 'pointer' }}
                    >
                      <option value="">🎵 No Background Music</option>
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          🎵 {t.name} ({t.genre})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Narrator Voice Selection Single Card + Modal Trigger */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Narrator Voice
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: '#EEF2FF', border: '1px solid #E0E7FF', borderRadius: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)' }}>
                        {activeVoice.name.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, color: '#0F172A', fontSize: '14px' }}>{activeVoice.name}</div>
                        <div style={{ fontSize: '12px', color: '#64748B' }}>{activeVoice.description}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsVoiceModalOpen(true)}
                      style={{ padding: '8px 16px', backgroundColor: '#FFFFFF', color: '#4F46E5', fontSize: '12px', fontWeight: 700, borderRadius: '10px', border: '1px solid #CBD5E1', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                    >
                      Change Voice
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', paddingTop: '8px' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#64748B', fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={bypassCache}
                  onChange={(e) => setBypassCache(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#4F46E5', cursor: 'pointer' }}
                />
                ⚡ Force Fresh AI Generation (Bypass Cache)
              </label>

              {topicAngles.length > 0 && (
                <div style={{ backgroundColor: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '20px', padding: '24px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', boxSizing: 'border-box' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E1B4B', margin: 0 }}>
                    🎯 What should the video focus on?
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                          style={{ padding: '12px', borderRadius: '12px', border: isSelected ? '1px solid #818CF8' : '1px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '12px', backgroundColor: isSelected ? '#FFFFFF' : 'transparent', opacity: isSelected ? 1 : 0.6, boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.05)' : 'none' }}
                        >
                          <div style={{ width: '20px', height: '20px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, backgroundColor: isSelected ? '#4F46E5' : '#E2E8F0', color: isSelected ? '#FFFFFF' : '#94A3B8', flexShrink: 0, marginTop: '2px' }}>
                            {isSelected ? '✓' : ''}
                          </div>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>{a.label}</div>
                            <div style={{ fontSize: '12px', color: '#64748B' }}>{a.description}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={confirmTopics}
                    style={{ width: '100%', padding: '14px', backgroundColor: '#4F46E5', color: '#FFFFFF', fontSize: '14px', fontWeight: 700, borderRadius: '12px', border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)' }}
                  >
                    Continue with Selection
                  </button>
                </div>
              )}

              {!topicAngles.length && (
                <div>
                  <button
                    onClick={handleGenerate}
                    disabled={isProcessing || !hasValidInput}
                    style={{ padding: '16px 36px', backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 700, fontSize: '16px', borderRadius: '14px', border: 'none', cursor: isProcessing || !hasValidInput ? 'not-allowed' : 'pointer', boxShadow: '0 10px 25px -5px rgba(79, 70, 229, 0.4)', opacity: isProcessing || !hasValidInput ? 0.5 : 1, transition: 'all 0.2s' }}
                  >
                    {isProcessing ? `Generating... ${statusMsg}` : 'Generate Storyboard →'}
                  </button>
                </div>
              )}

              <div>
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
                  style={{ fontSize: '13px', fontWeight: 600, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  📂 Load Saved Storyboard
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── STEP 2: EDIT & RENDER STORYBOARD ─── */}
        {step === 'edit' && (
          <div className="space-y-4 relative">
            {/* UI Locking Overlay during rendering */}
            {isRendering && (
              <div className="absolute inset-0 z-30 bg-slate-900/40 backdrop-blur-xs rounded-2xl flex items-center justify-center p-6 transition-all">
                <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center space-y-4">
                  <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  <h3 className="text-lg font-bold text-slate-900">Rendering Video... {renderProgress}%</h3>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-indigo-600 h-full transition-all duration-300"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 font-medium">{renderFrameInfo}</p>
                </div>
              </div>
            )}

            {/* Video Workspace & Scene Sidebar Row */}
            <div className="flex flex-col lg:flex-row gap-4 min-h-[500px]">
              {/* Main Player Container */}
              <div className="flex-1 flex flex-col space-y-3">
                <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-slate-200/80">
                  <Player
                    ref={playerRef}
                    component={ExplainerStoryComposition}
                    durationInFrames={calculatedTotalFrames}
                    fps={30}
                    compositionWidth={1920}
                    compositionHeight={1080}
                    style={{ width: '100%', height: '100%' }}
                    controls
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

                {/* Consolidated Director Toolbar */}
                <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex flex-wrap items-center gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                      Director
                    </span>
                    <select
                      value={director.camera.preset}
                      onChange={(e) =>
                        setDirector({ ...director, camera: { ...director.camera, preset: e.target.value as any } })
                      }
                      title="Camera Movement Preset"
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-800"
                    >
                      <option value="static">🎥 Static</option>
                      <option value="slow_dolly_in">🎥 Dolly In</option>
                      <option value="macro_focus_pull">🎥 Focus Pull</option>
                      <option value="dutch_angle">🎥 Dutch Angle</option>
                    </select>

                    <select
                      value={director.lighting}
                      onChange={(e) => setDirector({ ...director, lighting: e.target.value as LightingPreset })}
                      title="Lighting Style Preset"
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-800"
                    >
                      <option value="flat">💡 Flat</option>
                      <option value="golden_hour">💡 Golden Hour</option>
                      <option value="studio_key">💡 Studio Key</option>
                      <option value="dramatic_shadows">💡 Dramatic</option>
                    </select>
                  </div>

                  <div className="h-4 w-px bg-slate-200 mx-1" />

                  {/* Audio Controls */}
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedMusicId}
                      onChange={(e) => setSelectedMusicId(e.target.value)}
                      title="Background Music Track"
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-800 max-w-[140px]"
                    >
                      <option value="">🎵 No Music</option>
                      {musicTracks.map((t) => (
                        <option key={t.id} value={t.id}>
                          🎵 {t.name}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => setIsVoiceModalOpen(true)}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-800 hover:bg-slate-100"
                    >
                      🎙️ {activeVoice.name.split(' ')[0]}
                    </button>
                  </div>

                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => regenerateAllVoices()}
                      disabled={regeneratingVoiceIdx !== null}
                      title="Regenerate Voiceover for all scenes"
                      className={`px-3 py-1.5 font-semibold rounded-lg border flex items-center gap-1.5 transition-colors ${
                        regeneratingVoiceIdx === 'all'
                          ? 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse cursor-wait'
                          : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'
                      }`}
                    >
                      <span>{regeneratingVoiceIdx === 'all' ? '⏳ Regenerating All Voices...' : '🔄 Voice (All)'}</span>
                    </button>
                    <button
                      onClick={() => triggerGroundingDino()}
                      disabled={isDetectingRegions}
                      title="Grounding DINO Object Sync"
                      className="px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 font-semibold rounded-lg border border-violet-200"
                    >
                      {isDetectingRegions ? '⏳ Syncing...' : '🎯 Detect Regions'}
                    </button>
                    <button
                      onClick={() => handleGenerateVideos()}
                      disabled={isProcessing}
                      title="Generate AI videos for image_to_video / text_to_video scenes"
                      className="px-3 py-1.5 bg-fuchsia-50 hover:bg-fuchsia-100 text-fuchsia-700 font-semibold rounded-lg border border-fuchsia-200"
                    >
                      {isProcessing ? '⏳ Generating...' : '🎬 Generate Videos'}
                    </button>
                    <input
                      type="text"
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      placeholder="Logo URL (optional)"
                      title="Company logo URL — shown on opening + closing cards"
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 w-36"
                    />
                    <button
                      onClick={handleGenerateThumbnail}
                      title="Generate Click-Bait YouTube Thumbnail"
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded-lg border border-rose-200"
                    >
                      🖼️ Thumbnail
                    </button>
                    <button
                      onClick={handleGenerateDescription}
                      title="Generate YouTube Description & Chapters"
                      className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold rounded-lg border border-sky-200"
                    >
                      📝 Description
                    </button>
                  </div>
                </div>
              </div>

              {/* Sidebar Distinction: Distinct light gray background */}
              {showScenePanel && (
                <div className="w-full lg:w-72 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-col space-y-3 max-h-[580px] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {manifest.scenes.length} Scenes
                    </span>
                    <button
                      onClick={() => setShowScenePanel(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-3">
                    {manifest.scenes.map((scene, idx) => {
                      const isSelected = selectedScene === idx;
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
                          className={`p-4 rounded-xl border transition-all cursor-pointer space-y-3 ${
                            isSelected
                              ? 'bg-white border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
                              : 'bg-white border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {/* Header: Scene Number + Duration + Type Badge */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-md border border-indigo-100">
                                Scene {scene.sceneNumber}
                              </span>
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                                scene.animationStrategy === 'text_to_video'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : scene.animationStrategy === 'image_to_video'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : scene.layout?.clearCanvas
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}>
                                {scene.animationStrategy === 'text_to_video'
                                  ? '🎬 Text to Video'
                                  : scene.animationStrategy === 'image_to_video'
                                  ? '🎥 Image to Video'
                                  : scene.layout?.clearCanvas
                                  ? '🖼️ AI Image'
                                  : '📐 Diagram'}
                              </span>
                            </div>
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              {scene.duration}s
                            </span>
                          </div>

                          {/* Full Narration Voiceover Text (Fully readable, no line truncation) */}
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200/80">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                              🎙️ Voiceover Script:
                            </div>
                            <p className="text-xs text-slate-800 leading-relaxed font-normal whitespace-pre-wrap">
                              {scene.narration}
                            </p>
                          </div>

                          {/* Per-Scene Action Controls: Regenerate Voice + Regenerate Video + Replace Image */}
                          <div className="flex items-center justify-between pt-1 gap-1.5 border-t border-slate-100 flex-wrap">
                            <button
                              type="button"
                              disabled={regeneratingVoiceIdx !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                regenerateSceneVoice(idx);
                              }}
                              className={`px-2 py-1 text-[11px] font-semibold rounded-md flex items-center gap-1 transition-colors border ${
                                regeneratingVoiceIdx === idx
                                  ? 'bg-amber-100 text-amber-800 border-amber-300 animate-pulse cursor-wait'
                                  : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'
                              }`}
                              title="Regenerate voiceover for this scene"
                            >
                              <span>{regeneratingVoiceIdx === idx ? '⏳ Generating...' : '🔄 Voice'}</span>
                            </button>

                            {(scene.animationStrategy === 'text_to_video' || scene.animationStrategy === 'image_to_video') && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  alert(`Triggering video generation for Scene ${scene.sceneNumber}...`);
                                }}
                                className="px-2 py-1 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-md flex items-center gap-1 transition-colors"
                                title="Regenerate video for this scene"
                              >
                                <span>🎥 Video</span>
                              </button>
                            )}

                            <label
                              onClick={(e) => e.stopPropagation()}
                              className="px-2.5 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md flex items-center gap-1 cursor-pointer transition-colors"
                              title="Upload custom replacement image for this scene"
                            >
                              <span>📷 Upload Image</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const imgUrl = URL.createObjectURL(file);
                                    const newScenes = manifest.scenes.map((sc, i) => {
                                      if (i !== idx) return sc;
                                      const newElements = sc.layout?.elements ? [...sc.layout.elements] : [];
                                      const imgIdx = newElements.findIndex(el => el.type === 'image');
                                      if (imgIdx >= 0) {
                                        newElements[imgIdx] = { ...newElements[imgIdx], sourceAssetId: imgUrl };
                                      } else {
                                        newElements.push({ id: `img-custom-${Date.now()}`, type: 'image', sourceAssetId: imgUrl, x: 10, y: 10, width: 80, height: 80, zIndex: 1 });
                                      }
                                      return { ...sc, layout: { ...sc.layout, elements: newElements } };
                                    });
                                    const newManifest = { ...manifest, scenes: newScenes };
                                    setManifest(newManifest);
                                    persistState(newManifest, sceneAudio);
                                  }
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Slide-in Export Bar upon completion */}
            {showExportControls && renderUrl && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 shadow-xl space-y-4 animate-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-emerald-950">
                      🎉 Render Complete! Your video is ready.
                    </h3>
                    <p className="text-xs text-emerald-700">Download your MP4 video or export storyboard metadata.</p>
                  </div>
                  <button
                    onClick={() => setShowExportControls(false)}
                    className="px-3 py-1.5 bg-white text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50"
                  >
                    Back to Editing
                  </button>
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href={renderUrl}
                    download="omnicast_explainer.mp4"
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-2"
                  >
                    📥 Download MP4 Video
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
                    className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl"
                  >
                    📄 Export Script (.txt)
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
                    className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold rounded-xl"
                  >
                    📋 Export Manifest (.json)
                  </button>
                </div>
              </div>
            )}

            {/* Deep Blue-Gray Timeline */}
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
        )}
      </main>

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
        <div style={{ position: 'fixed', inset: 0, zIndex: 110, backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: '24px', maxWidth: '720px', width: '100%', padding: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🖼️</span> YouTube Click-Bait Thumbnail
                </h3>
                <p style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  AI-optimized high-CTR thumbnail designed to trigger viewer curiosity and clicks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsThumbnailModalOpen(false)}
                style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', backgroundColor: '#F1F5F9', color: '#64748B', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            {isGeneratingThumbnail ? (
              <div style={{ padding: '48px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '4px solid #EF4444', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>Generating Viral Thumbnail...</div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>Synthesizing high-contrast image & hook text teaser</div>
                </div>
              </div>
            ) : thumbnailData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: '16px', overflow: 'hidden', backgroundColor: '#000000', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)' }}>
                  {thumbnailData.imageUrl ? (
                    <img src={thumbnailData.imageUrl} alt="YouTube Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF' }}>Thumbnail Preview</div>
                  )}

                  <div style={{ position: 'absolute', bottom: '20px', left: '20px', backgroundColor: '#EF4444', color: '#FFFFFF', padding: '10px 20px', borderRadius: '12px', fontWeight: 900, fontSize: '24px', letterSpacing: '0.05em', textTransform: 'uppercase', boxShadow: '0 8px 16px rgba(239, 68, 68, 0.4)', border: '2px solid #FFFFFF' }}>
                    {thumbnailData.overlayText}
                  </div>
                </div>

                <div style={{ backgroundColor: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Thumbnail Visual Prompt:</div>
                  <div style={{ fontSize: '13px', color: '#334155', fontStyle: 'italic', lineHeight: 1.5 }}>"{thumbnailData.imagePrompt}"</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={handleGenerateThumbnail}
                    style={{ padding: '10px 20px', backgroundColor: '#F1F5F9', color: '#334155', fontWeight: 700, fontSize: '13px', borderRadius: '10px', border: '1px solid #CBD5E1', cursor: 'pointer' }}
                  >
                    🔄 Regenerate Concept
                  </button>

                  <a
                    href={thumbnailData.imageUrl}
                    download="youtube_thumbnail.jpg"
                    target="_blank"
                    rel="noreferrer"
                    style={{ padding: '10px 24px', backgroundColor: '#EF4444', color: '#FFFFFF', fontWeight: 700, fontSize: '14px', borderRadius: '10px', border: 'none', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)' }}
                  >
                    ⬇️ Download Thumbnail
                  </a>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* YouTube Description Preview Modal */}
      {isDescriptionModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 110, backgroundColor: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ backgroundColor: '#FFFFFF', borderRadius: '24px', maxWidth: '720px', width: '100%', padding: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '85vh', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📝</span> YouTube Description & Timestamps
                </h3>
                <p style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  SEO-optimized description with exact chapter timestamps ready to copy-paste.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDescriptionModalOpen(false)}
                style={{ width: '32px', height: '32px', borderRadius: '50%', border: 'none', backgroundColor: '#F1F5F9', color: '#64748B', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            {isGeneratingDescription ? (
              <div style={{ padding: '48px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', border: '4px solid #0EA5E9', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#0F172A' }}>Generating YouTube Copy & Timestamps...</div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>Formatting chapters, SEO overview, and hashtags</div>
                </div>
              </div>
            ) : descriptionData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', paddingRight: '4px' }}>
                <div style={{ backgroundColor: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Suggested YouTube Title:</div>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>{descriptionData.title}</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Full Video Description:
                  </label>
                  <textarea
                    readOnly
                    value={descriptionData.description}
                    style={{ width: '100%', height: '260px', padding: '14px', borderRadius: '12px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', color: '#1E293B', fontSize: '13px', fontFamily: 'monospace', lineHeight: 1.6, resize: 'none', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px' }}>
                  <button
                    type="button"
                    onClick={handleGenerateDescription}
                    style={{ padding: '10px 20px', backgroundColor: '#F1F5F9', color: '#334155', fontWeight: 700, fontSize: '13px', borderRadius: '10px', border: '1px solid #CBD5E1', cursor: 'pointer' }}
                  >
                    🔄 Regenerate Copy
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(descriptionData.description);
                      alert('📋 YouTube description copied to clipboard!');
                    }}
                    style={{ padding: '10px 24px', backgroundColor: '#0EA5E9', color: '#FFFFFF', fontWeight: 700, fontSize: '14px', borderRadius: '10px', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)' }}
                  >
                    📋 Copy Description
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
