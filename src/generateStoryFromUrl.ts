import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';
import { ingestUrl, ingestPdf } from './lib/ingest';
import { generateContextAwareStoryboard } from './lib/contextEngine';
import { synthesizePerSceneSpeech } from './lib/elevenlabsTts';
import { alignStoryboardWithTimestamps } from './lib/audioSync';
import { getOrGenerateConceptImage } from './lib/assetCatalogManager';
import { generateSfxCues } from './lib/sfxEngine';
import { findTrackById, getTrackSource } from './lib/musicLibrary';
import { ArticleData, StoryboardManifest, SceneAudio, ImageStylePreset } from './types/storyboard';
import { proposeTopicAngles } from './lib/narrativeEngine';
import { generateRegionFocusEvents } from './lib/regionSync';
import { isGroundingDinoAvailable } from './lib/groundingDinoClient';

function loadCheckpoint<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return (parsed.data || parsed) as T;
    }
  } catch (err) {
    console.warn(`[Checkpoint] Failed to load ${filePath}:`, err);
  }
  return null;
}

function saveCheckpoint(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ data, completedAt: new Date().toISOString() }, null, 2));
}

async function main() {
  const targetUrl = process.argv[2] || 'https://techcrunch.com/article/ai-automation';
  const rawStyleArg = process.argv[3] || 'photo-realistic';
  const musicTrackId = process.argv[4] || ''; // --music <track-id>
  const validStyles: ImageStylePreset[] = [
    'technical-blueprint',
    'modern-minimal',
    'corporate-dashboard',
    'whiteboard-sketch',
    'dotted-notebook',
    'pop-art-vector',
    'retro-technical',
    'chalkboard',
    'photo-realistic',
    'whiteboard',
    'illustration',
    'chalk-drawing',
    'flowcharts-whiteboard',
    'technical-scientific',
    'step-by-step-guide',
    'modular-explainer',
    'timeline-historical',
    'data-visualization',
    'playful-menu-listicle',
  ];
  const imageStyle: ImageStylePreset = validStyles.includes(rawStyleArg as ImageStylePreset) ? (rawStyleArg as ImageStylePreset) : 'photo-realistic';
  const allowResearchArg = process.argv.includes('--research') || process.argv.includes('-r');
  let allowResearch = allowResearchArg;

  console.log('\n======================================================');
  console.log(`🎬 OmniCast URL/PDF-to-Explainer-Video Generator`);
  console.log(`Target: ${targetUrl}`);
  console.log(`Image Style Preset: ${imageStyle}`);
  console.log(`Music Track: ${musicTrackId || 'none'}`);
  console.log(`External Research: ${allowResearch ? 'ENABLED' : 'DISABLED'}`);
  console.log('======================================================\n');

  // ── STAGE 1: Ingestion (skip if checkpoint exists) ──
  const ingestionCheckpointPath = path.join(process.cwd(), 'out', 'ingestion_checkpoint.json');
  let article = loadCheckpoint<ArticleData>(ingestionCheckpointPath);
  if (!article) {
    console.log('1️⃣ Ingesting article/PDF content and vision image assets...');
    const isPdf = targetUrl.toLowerCase().endsWith('.pdf') || (targetUrl.startsWith('/') && targetUrl.endsWith('.pdf'));
    if (isPdf) {
      article = await ingestPdf(targetUrl);
    } else {
      article = await ingestUrl(targetUrl);
    }
    saveCheckpoint(ingestionCheckpointPath, article);
    console.log('   ✅ Ingestion checkpoint saved.');
  } else {
    console.log('1️⃣ Loaded existing ingestion checkpoint (skipping re-ingest).');
  }

  // ── STAGE 1.5: Topic Angle Selection & External Research Prompt ──
  let focusTopics: string[] = [];
  const topicsCheckpointPath = path.join(process.cwd(), 'out', 'topics_checkpoint.json');
  const savedTopics = loadCheckpoint<{ topics: string[]; allowResearch?: boolean }>(topicsCheckpointPath);
  if (savedTopics) {
    focusTopics = savedTopics.topics;
    if (savedTopics.allowResearch !== undefined) allowResearch = savedTopics.allowResearch;
    console.log(`1.5️⃣ Loaded saved settings — Focus topics: ${focusTopics.join(', ')} | External Research: ${allowResearch ? 'ENABLED' : 'DISABLED'}`);
  } else {
    if (!allowResearchArg) {
      const researchChoice = await new Promise<string>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('\n🌐 Allow AI to perform external research to enrich article topic? (y/N): ', (answer) => {
          rl.close();
          resolve(answer.trim().toLowerCase());
        });
      });
      allowResearch = researchChoice === 'y' || researchChoice === 'yes';
    }

    console.log('\n1.5️⃣ Analyzing article for key topics...');
    const angles = await proposeTopicAngles(article);
    
    if (angles.length > 0) {
      console.log('\n📋 Key Topics Found:');
      angles.forEach((a, i) => console.log(`  ${i + 1}. ${a.label} — ${a.description}`));
      
      const selected = await new Promise<string>((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('\n🎯 Enter topic numbers to focus on (e.g., "1,3,4" or "all"): ', (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });

      if (selected.toLowerCase() === 'all') {
        focusTopics = angles.map(a => a.label);
      } else {
        const indices = selected.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < angles.length);
        focusTopics = indices.map(i => angles[i].label);
      }
      
      saveCheckpoint(topicsCheckpointPath, { topics: focusTopics, allowResearch });
    }
  }

  // ── STAGE 2: Context-Aware Narrative Storyboard (skip if checkpoint exists) ──
  const storyboardCheckpointPath = path.join(process.cwd(), 'out', 'storyboard_checkpoint.json');
  let manifest = loadCheckpoint<StoryboardManifest>(storyboardCheckpointPath);
  if (!manifest) {
    console.log(`2️⃣ Generating Context-Aware Narrative Storyboard (External Research: ${allowResearch ? 'ENABLED' : 'DISABLED'})...`);
    const result = await generateContextAwareStoryboard(article, {
      stylePreset: imageStyle,
      focusTopics: focusTopics.length > 0 ? focusTopics : undefined,
      allowExternalResearch: allowResearch,
    });
    manifest = result.manifest;
    console.log(`   └─ Content Type: ${result.context.contentType}, Target Audience: ${result.context.targetAudience}`);
    saveCheckpoint(storyboardCheckpointPath, manifest);
    console.log('   ✅ Storyboard checkpoint saved.');
  } else {
    console.log('2️⃣ Loaded existing storyboard checkpoint (skipping re-generation).');
  }

  // ── STAGE 3: Per-Scene TTS (one ElevenLabs call per scene) ──
  console.log('3️⃣ Synthesizing per-scene voiceover and visual assets in parallel...');
  const ttsCheckpointPath = path.join(process.cwd(), 'out', 'tts_checkpoint.json');
  let sceneAudioResult = loadCheckpoint<SceneAudio[]>(ttsCheckpointPath);

  const imagePromiseTasks = manifest.scenes.flatMap((scene) =>
    (scene.layout?.elements || [])
      .filter((element) => element.type === 'image')
      .map(async (element) => {
        if (element.sourceAssetId && element.sourceAssetId.startsWith('asset_')) {
          const sourceAsset = article.assets.find((a) => a.id === element.sourceAssetId);
          if (sourceAsset?.url) {
            element.sourceAssetId = sourceAsset.url;
            console.log(`   └─ Element '${element.id}' → SOURCE ARTICLE IMAGE: ${sourceAsset.url}`);
            return;
          }
        }
        const rawAsset = element.sourceAssetId || element.content || 'concept';
        const detailedPrompt = element.imageDescription || element.content || rawAsset;
        const resolved = await getOrGenerateConceptImage(rawAsset, detailedPrompt, imageStyle);
        element.sourceAssetId = resolved.imageUrl;
        console.log(`   └─ Element '${element.id}' → ${resolved.fromCache ? 'CACHED CATALOG' : 'FLUX GEN'}: ${resolved.imageUrl}`);
      })
  );

  const ttsPromiseTask = async () => {
    if (!sceneAudioResult) {
      // NEW: One ElevenLabs call per scene — durations are deterministic
      sceneAudioResult = await synthesizePerSceneSpeech(
        manifest.scenes.map((s) => ({ sceneNumber: s.sceneNumber, narration: s.narration })),
      );
      saveCheckpoint(ttsCheckpointPath, sceneAudioResult);
    } else {
      console.log('3️⃣ Loaded existing per-scene TTS checkpoint (skipping re-synthesis).');
    }
  };

  await Promise.all([ttsPromiseTask(), ...imagePromiseTasks]);

  const totalDuration = sceneAudioResult!.reduce((sum, sa) => sum + sa.durationSeconds, 0);
  console.log(`   ✅ Per-scene TTS complete: ${sceneAudioResult!.length} scenes, ${totalDuration.toFixed(1)}s total`);

  // ── STAGE 4: Per-Scene Audio Sync (no character math needed!) ──
  console.log('4️⃣ Aligning scene durations and element reveals with per-scene audio...');
  const { alignedManifest, sceneBoundaries } = alignStoryboardWithTimestamps(
    manifest,
    sceneAudioResult!
  );

  // ── STAGE 4.5: Grounding DINO Sub-Region Detection & Sync ──
  const dinoAvailable = await isGroundingDinoAvailable();
  if (dinoAvailable) {
    console.log('4.5️⃣ Grounding DINO backend detected. Running visual region detection...');
    for (let i = 0; i < alignedManifest.scenes.length; i++) {
      const scene = alignedManifest.scenes[i];
      const audio = sceneAudioResult!.find((sa) => sa.sceneNumber === scene.sceneNumber);
      const imageElement = scene.layout?.elements?.find((el) => el.type === 'image');
      const imageUrl = imageElement?.sourceAssetId;

      if (imageUrl && audio?.wordTimestamps) {
        const result = await generateRegionFocusEvents(
          scene,
          audio.wordTimestamps,
          imageUrl
        );
        scene.detectedRegions = result.detectedRegions;
        scene.regionFocusEvents = result.regionFocusEvents;
        scene.detectedImageWidth = result.imageWidth;
        scene.detectedImageHeight = result.imageHeight;
      }
    }
  } else {
    console.log('4.5️⃣ Grounding DINO backend not reachable. Skipping sub-region detection.');
  }

  const sfxCues = generateSfxCues(alignedManifest, sceneBoundaries);

  // Resolve music track ID to actual URL for the composition
  let resolvedMusicUrl: string | undefined;
  if (musicTrackId) {
    const track = findTrackById(musicTrackId);
    if (track) {
      const source = getTrackSource(track);
      resolvedMusicUrl = track.source === 'local' && !source.startsWith('http')
        ? source // staticFile path
        : source; // remote URL
    }
  }

  const outputPayload = {
    manifest: alignedManifest,
    sceneAudio: sceneAudioResult,                        // NEW: per-scene audio
    wordTimestamps: [],                                   // DEPRECATED (kept for backward compat)
    audioUrl: '',                                         // DEPRECATED (kept for backward compat)
    sceneBoundaries,
    sfxCues,
    audioDurationSeconds: totalDuration,
    bgMusicUrl: resolvedMusicUrl,
  };

  const outputFilePath = path.join(process.cwd(), 'out', 'generated_storyboard.json');
  const srcLatestPath = path.join(process.cwd(), 'src', 'lib', 'latestStory.json');
  fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
  fs.writeFileSync(outputFilePath, JSON.stringify(outputPayload, null, 2));
  fs.writeFileSync(srcLatestPath, JSON.stringify(outputPayload, null, 2));

  console.log(`✅ Saved Storyboard Manifest JSON: ${outputFilePath}`);
  console.log(`🎬 Total Scenes: ${alignedManifest.scenes.length}`);
  console.log(`⏱️ Video Duration: ${totalDuration.toFixed(1)}s`);

  // ── STAGE 5: Render Video via Remotion CLI ──
  const videoOutputPath = path.join(process.cwd(), 'out', 'generated_video.mp4');
  if (fs.existsSync(videoOutputPath)) {
    console.log(`5️⃣ Video already exists at ${videoOutputPath}. Skipping render.`);
    return;
  }

  console.log('\n5️⃣ Rendering video with Remotion...');
  try {
    execSync(
      `npx remotion render StorytellerExplainer "${videoOutputPath}" --props="${outputFilePath}" --codec=h264 --concurrency=1`,
      { stdio: 'inherit' }
    );
    console.log('\n======================================================');
    console.log('🎉 Explainer Video Successfully Rendered!');
    console.log(`📹 Output Video: ${videoOutputPath}`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Error during Remotion rendering:', err);
  }
}

main();
