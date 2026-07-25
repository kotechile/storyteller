import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ingestUrl } from './lib/ingest';
import { generateStoryboardFromArticle } from './lib/narrativeEngine';
import { synthesizeElevenLabsSpeech } from './lib/elevenlabsTts';
import { alignStoryboardWithTimestamps } from './lib/audioSync';
import { getOrGenerateConceptImage } from './lib/assetCatalogManager';

async function main() {
  const targetUrl = process.argv[2] || 'https://techcrunch.com/article/ai-automation';
  const rawStyleArg = process.argv[3] || 'photo-realistic';
  const imageStyle = rawStyleArg === 'illustration' || rawStyleArg === 'whiteboard' || rawStyleArg === 'chalk-drawing' ? rawStyleArg : 'photo-realistic';

  console.log('\n======================================================');
  console.log(`🎬 PRD v0.2 URL-to-Explainer-Video Generator`);
  console.log(`Target URL: ${targetUrl}`);
  console.log(`Image Style Preset: ${imageStyle}`);
  console.log('======================================================\n');

  // Step 1: Ingest URL & Extract Article Content
  console.log('1️⃣ Ingesting article content and vision image assets...');
  const article = await ingestUrl(targetUrl);

  // Step 2: Narrative Engine Storyboard Generation
  console.log('2️⃣ Generating Narrative Storyboard (Full-Story Layout First)...');
  const manifest = await generateStoryboardFromArticle(article, {
    stylePreset: imageStyle,
  });

  // Step 2.5: High-Quality Asset Catalog Lookup & Flux AI Asset Resolution
  console.log(`🖼️ Resolving Concept Assets via Flux (${imageStyle})...`);
  for (const scene of manifest.scenes) {
    if (scene.layout?.elements) {
      for (const element of scene.layout.elements) {
        if (element.type === 'image') {
          const rawAsset = element.sourceAssetId || element.content || 'concept';
          const detailedPrompt = element.imageDescription || element.content || rawAsset;
          const resolved = await getOrGenerateConceptImage(rawAsset, detailedPrompt, imageStyle);
          element.sourceAssetId = resolved.imageUrl;
          console.log(`   └─ Element '${element.id}' resolved via ${resolved.provider} (${resolved.fromCache ? 'CACHED CATALOG' : 'NEW FLUX GEN'}): ${resolved.imageUrl}`);
        }
      }
    }
  }

  // Step 3: Audio & Word-Level Timestamp Alignment
  console.log('3️⃣ Synthesizing speech & word timestamps...');
  const narrationText = manifest.scenes.map((s) => s.narration).join(' ');
  const ttsResult = await synthesizeElevenLabsSpeech(narrationText);

  // Step 4: Align Hints & Save Output JSON
  console.log('4️⃣ Aligning sync hints with millisecond-precise audio timestamps...');
  const { alignedManifest, sceneBoundaries } = alignStoryboardWithTimestamps(
    manifest,
    ttsResult.wordTimestamps
  );

  const outputPayload = {
    manifest: alignedManifest,
    wordTimestamps: ttsResult.wordTimestamps,
    sceneBoundaries,
    audioDurationSeconds: ttsResult.durationSeconds,
  };

  const outputFilePath = path.join(process.cwd(), 'out', 'generated_storyboard.json');
  const srcLatestPath = path.join(process.cwd(), 'src', 'lib', 'latestStory.json');
  fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
  fs.writeFileSync(outputFilePath, JSON.stringify(outputPayload, null, 2));
  fs.writeFileSync(srcLatestPath, JSON.stringify(outputPayload, null, 2));

  console.log(`✅ Saved Storyboard Manifest JSON: ${outputFilePath}`);
  console.log(`🎬 Total Scenes: ${alignedManifest.scenes.length}`);
  console.log(`⏱️ Video Duration: ${ttsResult.durationSeconds.toFixed(1)}s`);

  // Step 5: Render Video via Remotion CLI
  console.log('\n5️⃣ Rendering video with Remotion...');
  const videoOutputPath = path.join(process.cwd(), 'out', 'generated_video.mp4');

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
