import React, { useState } from 'react';
import { Player } from '@remotion/player';
import { ExplainerStoryComposition } from '../../compositions/storyteller/ExplainerStoryComposition';
import { sampleStoryboardManifest, sampleWordTimestamps } from '../../lib/sampleData';
import { StoryboardManifest } from '../../types/storyboard';
import { ingestUrl } from '../../lib/ingest';
import { generateStoryboardFromArticle } from '../../lib/narrativeEngine';

export const StoryStudio: React.FC = () => {
  const [manifest, setManifest] = useState<StoryboardManifest>(sampleStoryboardManifest);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number>(0);
  const [urlInput, setUrlInput] = useState<string>('https://techcrunch.com/article/ai-automation');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const activeScene = manifest.scenes[selectedSceneIndex] || manifest.scenes[0];

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setIsProcessing(true);
    try {
      const article = await ingestUrl(urlInput);
      const newManifest = await generateStoryboardFromArticle(article, {
        stylePreset: manifest.meta.stylePreset,
      });
      setManifest(newManifest);
      setSelectedSceneIndex(0);
    } catch (err) {
      console.error('[StoryStudio] Error generating story from URL:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: '#090d16',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 28px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '20px',
            }}
          >
            🎬
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Storyteller Studio (PRD v0.2)</h1>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
              URL to Audio-Synced Explainer Video Generator
            </p>
          </div>
        </div>

        {/* URL Ingest Form */}
        <form onSubmit={handleIngest} style={{ display: 'flex', gap: '10px', width: '450px' }}>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste article URL here..."
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '8px 14px',
              color: '#ffffff',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isProcessing}
            style={{
              backgroundColor: '#6366f1',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 18px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              opacity: isProcessing ? 0.7 : 1,
            }}
          >
            {isProcessing ? 'Generating...' : 'Ingest Story'}
          </button>
        </form>
      </header>

      {/* Main Studio Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar: Narrative Scenes Navigation */}
        <aside
          style={{
            width: '320px',
            backgroundColor: '#0f172a',
            borderRight: '1px solid #1e293b',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            gap: '16px',
            overflowY: 'auto',
          }}
        >
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em' }}>
            STORYBOARD SCENES
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {manifest.scenes.map((scene, idx) => {
              const isSelected = selectedSceneIndex === idx;
              return (
                <div
                  key={scene.sceneNumber}
                  onClick={() => setSelectedSceneIndex(idx)}
                  style={{
                    padding: '14px',
                    borderRadius: '10px',
                    backgroundColor: isSelected ? '#1e293b' : '#090d16',
                    border: isSelected ? '2px solid #6366f1' : '1px solid #1e293b',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#6366f1' }}>
                      Scene {scene.sceneNumber}
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      ~{scene.duration}s
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#94a3b8',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {scene.narration}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center: Live Remotion Player */}
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backgroundColor: '#040711',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '960px',
              aspectRatio: '16/9',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
              border: '1px solid #1e293b',
            }}
          >
            <Player
              component={ExplainerStoryComposition}
              durationInFrames={720}
              fps={30}
              compositionWidth={1920}
              compositionHeight={1080}
              style={{
                width: '100%',
                height: '100%',
              }}
              controls
              inputProps={{
                manifest,
                wordTimestamps: sampleWordTimestamps,
                audioUrl: 'narration.mp3',
              }}
            />
          </div>
        </main>

        {/* Right Inspector Drawer */}
        <aside
          style={{
            width: '320px',
            backgroundColor: '#0f172a',
            borderLeft: '1px solid #1e293b',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            overflowY: 'auto',
          }}
        >
          <div>
            <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#94a3b8', marginBottom: '12px' }}>
              SCENE {activeScene.sceneNumber} DETAILS
            </h2>
            <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.5' }}>
              {activeScene.narration}
            </p>
          </div>

          <div>
            <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#94a3b8', marginBottom: '12px' }}>
              CANVAS ELEMENTS ({activeScene.layout?.elements?.length || 0})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activeScene.layout?.elements?.map((el) => (
                <div
                  key={el.id}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: '#1e293b',
                    fontSize: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{el.id}</span>
                  <span style={{ color: '#94a3b8' }}>{el.type}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
