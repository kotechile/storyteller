# OmniCast StoryStudio — UI Fix Instructions

## THE PROBLEM

The current `StoryStudio.tsx` (865 lines) is a **marketing landing page** wrapped around the functional wizard:
- Fake navigation bar with dead links (Platform, Solutions, Showcase, Pricing, Docs, Sign in)
- Hero section with invented marketing copy ("Agentic Video Engine v2.5 • 98.4% Temporal Sync")
- Fake integration badges (Terminal, Web, iOS, Android, GitHub, VS Code, JetBrains, Slack)
- Decorative SVG curves in the background
- Fake browser window chrome (macOS traffic lights, fake URL bar)
- Tailwind CSS classes that may not load properly

## THE FIX

DELETE ALL MARKETING FLUFF. Keep ONLY the functional 3-step wizard. The file should be a clean, beautiful, functional video creation tool — not a fake SaaS website.

## EXACT IMPLEMENTATION

### Step 1: Delete `src/components/studio/StoryStudio.tsx` entirely

### Step 2: Create a new `StoryStudio.tsx` with the content below

Copy this ENTIRE file. It is a clean, production-quality wizard with:
- No fake nav/hero/marketing
- Just the 3-step workflow: Import → Edit → Export
- Clean light theme with professional typography
- All existing functionality preserved
- No Tailwind — pure inline styles (consistent with the rest of the codebase)

### Step 3: Delete `studio.html` if it exists with any Tailwind CDN links

### Step 4: Run `npx tsc --noEmit` and fix any type errors

---

## COMPLETE NEW FILE: `src/components/studio/StoryStudio.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { Player } from '@remotion/player';
import { ExplainerStoryComposition } from '../../compositions/storyteller/ExplainerStoryComposition';
import { sampleStoryboardManifest, sampleWordTimestamps } from '../../lib/sampleData';
import { StoryboardManifest, CameraInstruction, ImageStylePreset } from '../../types/storyboard';
import { LightingPreset } from '../../compositions/storyteller/BackgroundRenderer';
import { ingestUrl, ingestPdf } from '../../lib/ingest';
import { generateContextAwareStoryboard, ContentContext } from '../../lib/contextEngine';
import { loadMusicLibrary, MusicTrack } from '../../lib/musicLibrary';

// ── Types ──

type WizardStep = 'import' | 'edit' | 'export';

interface DirectorState {
  camera: CameraInstruction;
  lighting: LightingPreset;
}

// ── Design Tokens ──

const C = {
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  border: '#EBEBEB',
  borderFocus: '#D4D4D4',
  text: '#171717',
  textMuted: '#737373',
  textSubtle: '#A3A3A3',
  accent: '#4F46E5',
  accentHover: '#4338CA',
  accentLight: '#EEF2FF',
  accentText: '#312E81',
  success: '#059669',
  successLight: '#ECFDF5',
  danger: '#DC2626',
  dangerLight: '#FEF2F2',
  warning: '#D97706',
} as const;

// ── Reusable Styles ──

const s = {
  page: {
    minHeight: '100vh',
    backgroundColor: C.bg,
    color: C.text,
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    WebkitFontSmoothing: 'antialiased',
  } as React.CSSProperties,

  container: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '0 24px',
  } as React.CSSProperties,

  card: {
    backgroundColor: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: '14px',
    padding: '24px',
  } as React.CSSProperties,

  cardHover: {
    backgroundColor: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: '14px',
    padding: '24px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    backgroundColor: C.accent,
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '10px',
    padding: '14px 28px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'background 0.15s ease, transform 0.1s ease',
  } as React.CSSProperties,

  btnOutline: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    backgroundColor: C.surface,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: '10px',
    padding: '14px 28px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '14px 18px',
    fontSize: '16px',
    fontFamily: 'Inter, system-ui, sans-serif',
    border: `1px solid ${C.border}`,
    borderRadius: '10px',
    outline: 'none',
    backgroundColor: C.surface,
    color: C.text,
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,

  label: {
    fontSize: '12px',
    fontWeight: 600,
    color: C.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '10px',
  } as React.CSSProperties,

  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 10px',
    borderRadius: '100px',
    fontSize: '11px',
    fontWeight: 500,
    backgroundColor: '#F5F5F5',
    color: C.textMuted,
  } as React.CSSProperties,

  stepDot: (active: boolean, completed: boolean) => ({
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 700,
    backgroundColor: completed ? C.accent : active ? C.accent : '#EBEBEB',
    color: completed || active ? '#FFFFFF' : C.textSubtle,
    transition: 'all 0.2s ease',
  } as React.CSSProperties),
};

// ── Step Indicator Component ──

const StepIndicator: React.FC<{ step: WizardStep }> = ({ step }) => {
  const steps = [
    { key: 'import' as WizardStep, label: 'Import Content' },
    { key: 'edit' as WizardStep, label: 'Edit Storyboard' },
    { key: 'export' as WizardStep, label: 'Export Video' },
  ];
  const idx = steps.findIndex((x) => x.key === step);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0', padding: '32px 0 24px' }}>
      {steps.map((st, i) => (
        <React.Fragment key={st.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={s.stepDot(i === idx, i < idx)}>
              {i < idx ? '✓' : i + 1}
            </div>
            <span style={{
              fontSize: '13px',
              fontWeight: i === idx ? 600 : 400,
              color: i === idx ? C.text : C.textSubtle,
            }}>
              {st.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              width: '56px',
              height: '1.5px',
              backgroundColor: i < idx ? C.accent : C.border,
              margin: '0 16px',
              transition: 'background 0.3s ease',
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// ── Main Component ──

export const StoryStudio: React.FC = () => {
  const [step, setStep] = useState<WizardStep>('import');
  const [urlInput, setUrlInput] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<ImageStylePreset>('photo-realistic');
  const [selectedMusicId, setSelectedMusicId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'url' | 'pdf'>('url');
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const [manifest, setManifest] = useState<StoryboardManifest>(sampleStoryboardManifest);
  const [contextInfo, setContextInfo] = useState<ContentContext | null>(null);
  const [selectedScene, setSelectedScene] = useState(0);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);

  const [director, setDirector] = useState<DirectorState>({
    camera: { preset: 'static', intensity: 0.5, durationFrames: 90 },
    lighting: 'flat',
  });

  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);

  useEffect(() => {
    const lib = loadMusicLibrary();
    if (lib?.tracks) setMusicTracks(lib.tracks);
  }, []);

  // ── Handlers ──

  const handleGenerate = async () => {
    if (!urlInput.trim() && !pdfFile) return;
    setIsProcessing(true);
    setError(null);
    setStatusMsg('Analyzing content...');

    try {
      const isPdf = importMode === 'pdf' || urlInput.toLowerCase().endsWith('.pdf');
      const article = pdfFile
        ? await ingestPdf(URL.createObjectURL(pdfFile))
        : isPdf ? await ingestPdf(urlInput) : await ingestUrl(urlInput);

      setStatusMsg('Building storyboard...');
      const result = await generateContextAwareStoryboard(article, { stylePreset: selectedStyle });
      setManifest(result.manifest);
      setContextInfo(result.context);
      setSelectedScene(0);
      setExpandedScene(null);
      setStep('edit');
    } catch (err: any) {
      setError(err.message || 'Failed to generate storyboard.');
    } finally {
      setIsProcessing(false);
      setStatusMsg('');
    }
  };

  const estimateCost = () => {
    const sc = manifest.scenes.length;
    const imgs = manifest.scenes.reduce((a, s) => a + (s.layout?.elements?.filter((e) => e.type === 'image').length || 0), 0);
    const chars = manifest.scenes.reduce((a, s) => a + s.narration.length, 0);
    const t = sc * 0.005 + chars * 0.000015 + imgs * 0.01 + 0.05;
    return { total: t.toFixed(2), llm: (sc * 0.005).toFixed(3), tts: (chars * 0.000015).toFixed(3), img: (imgs * 0.01).toFixed(3) };
  };

  const cost = estimateCost();
  const activeScene = manifest.scenes[selectedScene] || manifest.scenes[0];

  // ── Render ──

  return (
    <div style={s.page}>
      {/* Minimal Header */}
      <header style={{
        backgroundColor: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: '14px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: `linear-gradient(135deg, ${C.accent}, #7C3AED)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFF', fontWeight: 800, fontSize: '15px',
          }}>O</div>
          <span style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.01em' }}>OmniCast</span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {step === 'edit' && (
            <>
              <button style={s.btnOutline} onClick={() => setStep('import')}>← Back</button>
              <button style={s.btn} onClick={() => setStep('export')}>Render Video →</button>
            </>
          )}
          {step === 'export' && (
            <button style={s.btnOutline} onClick={() => { setStep('import'); setUrlInput(''); setPdfFile(null); setError(null); }}>
              + New Project
            </button>
          )}
        </div>
      </header>

      <StepIndicator step={step} />
      <div style={s.container}>

        {/* ─── STEP 1: IMPORT ─── */}
        {step === 'import' && (
          <div style={{ paddingBottom: '80px' }}>
            <div style={{ textAlign: 'center', marginBottom: '40px' }}>
              <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                Create an explainer video
              </h1>
              <p style={{ fontSize: '15px', color: C.textMuted, margin: 0, maxWidth: '520px', marginInline: 'auto', lineHeight: '1.5' }}>
                Paste an article URL or upload a PDF. We'll extract the story, generate visuals, and produce a narrated video.
              </p>
            </div>

            {error && (
              <div style={{ ...s.card, borderColor: C.danger, backgroundColor: C.dangerLight, marginBottom: '20px', color: C.danger, fontSize: '14px' }}>
                {error}
              </div>
            )}

            {/* Content Input */}
            <div style={{ marginBottom: '28px' }}>
              <div style={s.label}>Content Source</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                {['url', 'pdf'].map((mode) => (
                  <button key={mode}
                    onClick={() => setImportMode(mode as 'url' | 'pdf')}
                    style={{
                      ...s.btnOutline,
                      padding: '6px 18px',
                      fontSize: '13px',
                      borderRadius: '8px',
                      backgroundColor: importMode === mode ? C.accent : C.surface,
                      color: importMode === mode ? '#FFF' : C.text,
                      borderColor: importMode === mode ? C.accent : C.border,
                    }}
                  >{mode === 'url' ? 'URL' : 'PDF Upload'}</button>
                ))}
              </div>

              {importMode === 'url' ? (
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/your-article"
                  style={{ ...s.input, fontSize: '17px', padding: '16px 18px' }}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                />
              ) : (
                <label style={{
                  ...s.card,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '10px', minHeight: '130px', cursor: 'pointer', borderStyle: 'dashed',
                  borderColor: pdfFile ? C.accent : C.border,
                  backgroundColor: pdfFile ? C.accentLight : C.surface,
                }}>
                  {pdfFile ? (
                    <><span style={{ fontSize: '14px', fontWeight: 600 }}>{pdfFile.name}</span>
                      <span style={{ fontSize: '12px', color: C.textMuted }}>{(pdfFile.size / 1024 / 1024).toFixed(1)} MB</span></>
                  ) : (
                    <span style={{ fontSize: '14px', color: C.textMuted }}>Drop PDF here or click to browse</span>
                  )}
                  <input type="file" accept=".pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                </label>
              )}
            </div>

            {/* Visual Style */}
            <div style={{ marginBottom: '28px' }}>
              <div style={s.label}>Visual Style</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                {([
                  { key: 'photo-realistic' as ImageStylePreset, name: 'Photo Realistic', desc: '35mm photography' },
                  { key: 'whiteboard' as ImageStylePreset, name: 'Whiteboard', desc: 'Hand-drawn diagrams' },
                  { key: 'illustration' as ImageStylePreset, name: 'Illustration', desc: '3D vector graphics' },
                  { key: 'chalk-drawing' as ImageStylePreset, name: 'Chalkboard', desc: 'Academic sketches' },
                ]).map((st) => {
                  const sel = selectedStyle === st.key;
                  return (
                    <div key={st.key} onClick={() => setSelectedStyle(st.key)} style={{
                      ...s.cardHover,
                      padding: '16px',
                      textAlign: 'center',
                      borderColor: sel ? C.accent : C.border,
                      backgroundColor: sel ? C.accentLight : C.surface,
                    }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: sel ? C.accentText : C.text }}>{st.name}</div>
                      <div style={{ fontSize: '11px', color: C.textMuted, marginTop: '2px' }}>{st.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Background Music */}
            <div style={{ marginBottom: '32px' }}>
              <div style={s.label}>Background Music</div>
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                <div onClick={() => setSelectedMusicId('')} style={{
                  ...s.cardHover, minWidth: '130px', padding: '14px', textAlign: 'center',
                  borderColor: !selectedMusicId ? C.accent : C.border,
                  backgroundColor: !selectedMusicId ? C.accentLight : C.surface,
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>No Music</div>
                  <div style={{ fontSize: '11px', color: C.textMuted }}>Narration only</div>
                </div>
                {musicTracks.slice(0, 8).map((track) => {
                  const sel = selectedMusicId === track.id;
                  return (
                    <div key={track.id} onClick={() => setSelectedMusicId(sel ? '' : track.id)} style={{
                      ...s.cardHover, minWidth: '150px', padding: '14px',
                      borderColor: sel ? C.accent : C.border,
                      backgroundColor: sel ? C.accentLight : C.surface,
                    }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{track.name}</div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span style={s.badge}>{track.genre}</span>
                        <span style={s.badge}>{track.mood}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Generate CTA */}
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={handleGenerate}
                disabled={isProcessing || (!urlInput.trim() && !pdfFile)}
                style={{
                  ...s.btn, padding: '16px 48px', fontSize: '17px',
                  opacity: isProcessing || (!urlInput.trim() && !pdfFile) ? 0.5 : 1,
                  cursor: isProcessing || (!urlInput.trim() && !pdfFile) ? 'not-allowed' : 'pointer',
                }}
              >
                {isProcessing ? `Generating... ${statusMsg}` : 'Generate Storyboard'}
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: EDIT ─── */}
        {step === 'edit' && (
          <div style={{ display: 'flex', gap: '24px', paddingBottom: '80px', minHeight: '60vh' }}>
            {/* Video Preview */}
            <div style={{ flex: '1 1 60%', minWidth: 0 }}>
              <div style={{ ...s.card, overflow: 'hidden', borderRadius: '16px', aspectRatio: '16/9', boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}>
                <Player
                  component={ExplainerStoryComposition}
                  durationInFrames={Math.max(manifest.meta.targetDuration * 30, 300)}
                  fps={30}
                  compositionWidth={1920}
                  compositionHeight={1080}
                  style={{ width: '100%', height: '100%' }}
                  controls
                  inputProps={{
                    manifest,
                    wordTimestamps: sampleWordTimestamps,
                    audioUrl: 'narration.mp3',
                    camera: director.camera,
                    lighting: director.lighting,
                  }}
                />
              </div>

              {/* Director Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '16px', flexWrap: 'wrap' }}>
                <select value={director.camera.preset} onChange={(e) => setDirector({ ...director, camera: { ...director.camera, preset: e.target.value as any } })}
                  style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${C.border}`, fontSize: '13px', backgroundColor: C.surface, cursor: 'pointer', outline: 'none' }}>
                  <option value="static">🎥 Static</option>
                  <option value="slow_dolly_in">🎥 Slow Dolly In</option>
                  <option value="macro_focus_pull">🎥 Focus Pull</option>
                  <option value="dutch_angle">🎥 Dutch Angle</option>
                  <option value="crane_up">🎥 Crane Up</option>
                </select>

                <select value={director.lighting} onChange={(e) => setDirector({ ...director, lighting: e.target.value as LightingPreset })}
                  style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${C.border}`, fontSize: '13px', backgroundColor: C.surface, cursor: 'pointer', outline: 'none' }}>
                  <option value="flat">💡 Flat</option>
                  <option value="golden_hour">💡 Golden Hour</option>
                  <option value="studio_key">💡 Studio Key</option>
                  <option value="dramatic_shadows">💡 Dramatic</option>
                </select>

                <select value={selectedMusicId} onChange={(e) => setSelectedMusicId(e.target.value)}
                  style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${C.border}`, fontSize: '13px', backgroundColor: C.surface, cursor: 'pointer', outline: 'none', maxWidth: '180px' }}>
                  <option value="">🎵 No Music</option>
                  {musicTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            {/* Scene Cards */}
            <div style={{ flex: '0 0 360px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '70vh' }}>
              <div style={s.label}>{manifest.scenes.length} Scenes</div>
              {contextInfo && (
                <div style={{ fontSize: '11px', color: C.textMuted, marginBottom: '4px' }}>
                  {contextInfo.contentType.replace(/_/g, ' ')} · {contextInfo.targetAudience}
                </div>
              )}
              {manifest.scenes.map((scene, idx) => {
                const isExpanded = expandedScene === idx;
                const isSelected = selectedScene === idx;
                return (
                  <div key={scene.sceneNumber} onClick={() => { setSelectedScene(idx); setExpandedScene(isExpanded ? null : idx); }} style={{
                    ...s.cardHover, padding: isExpanded ? '16px' : '12px 16px',
                    borderColor: isSelected ? C.accent : C.border,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <span style={{
                          width: '26px', height: '26px', borderRadius: '7px',
                          backgroundColor: isSelected ? C.accent : '#F5F5F5',
                          color: isSelected ? '#FFF' : C.textMuted,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: 700, flexShrink: 0,
                        }}>{scene.sceneNumber}</span>
                        <span style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>
                          {scene.narration.substring(0, 55)}{scene.narration.length > 55 ? '…' : ''}
                        </span>
                      </div>
                      <span style={{ fontSize: '11px', color: C.textMuted, flexShrink: 0, marginLeft: '8px' }}>~{scene.duration}s</span>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                        onClick={(e) => e.stopPropagation()}>
                        <textarea
                          value={scene.narration}
                          onChange={(e) => {
                            const ns = manifest.scenes.map((s, i) => i === idx ? { ...s, narration: e.target.value } : s);
                            setManifest({ ...manifest, scenes: ns });
                          }}
                          style={{ ...s.input, fontSize: '12px', padding: '10px', minHeight: '64px', resize: 'vertical' }}
                        />
                        {(scene.layout?.elements || []).filter((el) => el.type === 'image').map((el) => (
                          <input key={el.id} type="text"
                            value={el.imageDescription || ''}
                            onChange={(e) => {
                              const ns = manifest.scenes.map((s, i) => {
                                if (i !== idx) return s;
                                return { ...s, layout: { ...s.layout, elements: s.layout.elements.map((elm) => elm.id === el.id ? { ...elm, imageDescription: e.target.value } : elm) } };
                              });
                              setManifest({ ...manifest, scenes: ns });
                            }}
                            placeholder={`Image prompt: ${el.id}`}
                            style={{ ...s.input, fontSize: '11px', padding: '8px 10px' }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── STEP 3: EXPORT ─── */}
        {step === 'export' && (
          <div style={{ paddingBottom: '80px', textAlign: 'center' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Your video is ready</h2>
            <p style={{ fontSize: '14px', color: C.textMuted, marginBottom: '24px' }}>
              {manifest.meta.targetDuration}s · 1920×1080 · H.264 · {manifest.scenes.length} scenes
            </p>

            <div style={{ ...s.card, overflow: 'hidden', borderRadius: '16px', maxWidth: '720px', margin: '0 auto 24px', aspectRatio: '16/9', boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}>
              <Player
                component={ExplainerStoryComposition}
                durationInFrames={Math.max(manifest.meta.targetDuration * 30, 300)}
                fps={30}
                compositionWidth={1920}
                compositionHeight={1080}
                style={{ width: '100%', height: '100%' }}
                controls
                inputProps={{
                  manifest,
                  wordTimestamps: sampleWordTimestamps,
                  audioUrl: 'narration.mp3',
                  camera: director.camera,
                  lighting: director.lighting,
                }}
              />
            </div>

            {/* Cost Table */}
            <div style={{ ...s.card, maxWidth: '380px', margin: '0 auto', textAlign: 'left' }}>
              <div style={s.label}>Cost Breakdown</div>
              {[
                ['LLM Storyboard Planning', `$${cost.llm}`],
                ['ElevenLabs Voice Synthesis', `$${cost.tts}`],
                ['Flux Image Generation', `$${cost.img}`],
                ['Video Rendering', '$0.05'],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '13px', color: C.textMuted }}>
                  <span>{label}</span><span style={{ fontWeight: 600, color: C.text }}>{val}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${C.border}`, marginTop: '8px', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '14px' }}>
                <span>Total</span><span style={{ color: C.success }}>${cost.total}</span>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
```

## POST-IMPLEMENTATION VERIFICATION

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Delete `studio.html` if it contains Tailwind CDN links
- [ ] Delete or strip `src/index.css` of any Tailwind `@import` or `@tailwind` directives
- [ ] `npm run studio` starts and shows the Remotion Studio
- [ ] The StoryStudio wizard loads correctly
- [ ] No fake nav links, no marketing hero, no browser window chrome
- [ ] Input a URL → click Generate → advances to Edit step
- [ ] Edit step shows video preview + scene cards
- [ ] Scene cards expand/collapse with editable narration and image prompts
- [ ] Camera/lighting/music selectors work
- [ ] Export step shows video player + cost breakdown
