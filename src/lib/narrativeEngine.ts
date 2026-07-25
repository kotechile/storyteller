import { resolveLlmModel } from './supabaseClient';
import { ArticleData, StoryboardManifest, StoryboardScene, StoryStylePreset } from '../types/storyboard';

export interface NarrativeEngineOptions {
  stylePreset?: StoryStylePreset;
}

/**
 * 3-Step Narrative & Quality Control Pipeline:
 * Step 1: Cinematic Narrative Generator (Netflix/TED Talk style for Young Professionals 22-35)
 * Step 2: Whiteboard Storyboard Generator (Organic single-screen flowcharts, explicit reveal sync phrases)
 * Step 3: Storyboard QA & Flow Reviewer (LLM Review Pass verifying reveal timings, non-overlapping coordinates & detailed image prompts)
 */
export async function generateStoryboardFromArticle(
  article: ArticleData,
  options: NarrativeEngineOptions = {}
): Promise<StoryboardManifest> {
  const stylePreset = options.stylePreset || 'whiteboard';
  const cleanTitle = article.title.split(/\s+[|:\-–—]\s+/)[0].replace(/\s+/g, ' ').trim();
  const llmConfig = await resolveLlmModel('storyboard_planning');

  console.log(`[NarrativeEngine] Step 1: Generating Cinematic Narrative for: "${cleanTitle}"...`);

  if (!llmConfig.apiKey) {
    console.warn('[NarrativeEngine] No LLM API key resolved. Using built-in Cinematic Narrative & Single-Screen Whiteboard Storyboard.');
    return buildCinematicWhiteboardFallback(cleanTitle, stylePreset);
  }

  try {
    // PROMPT 1: Cinematic Narrative Generator
    const prompt1Text = `Role: You are an award-winning documentary writer, storyteller, and educator.

Task: Transform the provided input text into a cinematic narrated story, not a summary. The final script should feel like a blend of a Netflix documentary, TED Talk, and YouTube educational video.

Audience: A young professional (ages 22–35) who is intelligent but may not be a subject matter expert.

Writing Rules & Style:
- Write entirely as a narrator. Avoid bulleted lists, academic jargon, or sounding like an instruction manual.
- Opening Hook: Start with a relatable scene ("Imagine opening your paycheck..." or "Picture yourself standing at a crossroads..."). Place the listener immediately inside the story.
- Curiosity & Momentum: Ask natural questions ("What happens next?", "Why do most people get this wrong?") to build tension. Every paragraph must naturally bridge to the next.
- Visual Analogies: Convert technical concepts into vivid imagery (e.g., money flow = a cascading waterfall, emergency fund = a gold reserve vault).
- Emotional Contrast: Alternate between confusion and clarity, risk and security, chaos and order.
- Tone: Cinematic, optimistic, intelligent, conversational, and immersive.
- Ending: Build toward a deeper insight ("What is this really about?").

Input Text:
Title: "${cleanTitle}"
Excerpt: "${article.excerpt}"
Content: "${article.textContent.substring(0, 2000)}"`;

    const cinematicScript = await callLlm(llmConfig, prompt1Text);
    console.log('[NarrativeEngine] Step 1 Complete. Cinematic Script generated.');

    // PROMPT 2: Storyboard Generator (Organic Positioning & Explicit Reveal Sync Phrases)
    console.log('[NarrativeEngine] Step 2: Generating Storyboard JSON with Explicit Reveal Timings...');
    const prompt2Text = `Role: You are an expert video producer and storyboard artist specializing in whiteboard system flowcharts.

Task: Take the cinematic narrative script below and break it down into a whiteboard system flowchart JSON. Group interconnected system components cleanly on canvas so the viewer sees the complete architecture.

Visual Style: Hybrid Whiteboard & Real-World Diagramming. Mix photorealistic 35mm photography or clean dry-erase whiteboard line drawings with sleek 3D illustration assets. Place elements organically across 2D canvas (0-100% X, 0-100% Y).

Iconic Object Representation Rules (CRITICAL FOR VIEWER IMPACT):
- NEVER suggest laptops, smartphones, computer monitors, or digital UI screens displaying bank apps, direct deposit text, or website dashboards! Digital screens look generic and weak.
- ALWAYS select single, bold, iconic physical objects or vivid real-world visual metaphors that viewers INSTANTLY associate with the concept upon first glance (within 0.1 seconds):
  1. Income / Direct Deposit -> Thick stacks of crisp green 100 dollar cash banknotes bound with paper bank straps, or overflowing gold coins.
  2. Reserve Vault / Financial Fortress -> A massive 3D solid gold bar or heavy steel bank vault door with digital lock dial.
  3. Allocation System Hub -> A majestic multi-tiered mountain waterfall cascading over rocks into a crystal clear lake.
  4. Compounding Growth -> A glowing rocket launching upwards along a steep green mountain growth trajectory line.
  5. Skills & Team Buffer -> A high-profile executive leadership team collaborating around a polished mahogany boardroom table.
  6. Freedom & Scale -> A grand modern glass-and-steel corporate skyscraper tower touching the sky.

Title Collision & Safe-Zone Rules: Section titles occupy top Y: 4% to 12%. Upper Row Hub Nodes MUST be positioned at Y: 16% to 34% (height: 20-24%). Lower Row Child Nodes MUST be positioned at Y: 65% to 85% (height: 20-24%). Keep Y: 35% to 64% open for connector arrows so labels never collide with node captions! Maintain safe outer margins: 6% <= X <= 94%.

Canvas Accumulation & Reset Rules (CRITICAL FOR NARRATIVE LOGIC):
- Sequential Flowchart Scenes: Diagram elements accumulate across consecutive scenes as a system flowchart builds up step-by-step.
- Fresh Chapter Transition / Finale Climax ("clearCanvas": true): Whenever the narration transitions to a major new chapter, summary, macro conclusion, or centerpiece finale (e.g. transitioning from granular allocation rules to long-term systemic freedom/building), set "clearCanvas": true in that scene's layout!
- Setting "clearCanvas": true wipes past diagram elements clean from the whiteboard so the centerpiece image stands alone on a fresh, clutter-free canvas!

Timeline Reveal Rules: Every image element MUST have a "revealSyncPhrase" matching an exact substring in the narration so that images appear on the timeline ONLY when spoken by the narrator!

Available Asset Keys:
- "asset:waterfall" (Full color cascading waterfall landscape with rocks and lake)
- "asset:vault" (Gold & steel bank reserve safe vault)
- "asset:growth_chart" (Full color compounding growth chart mountain)
- "asset:money" (Full color green cash banknote)
- "asset:people" (Full color team & executive group)
- "asset:building" (Corporate headquarters building)

Script:
"${cinematicScript}"

Return VALID JSON matching this structure:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "Full narration spoken by narrator",
      "duration": 20,
      "layout": {
        "background": { "type": "image", "value": "#f8fafc" },
        "elements": [
          {
            "id": "el_title",
            "type": "text",
            "content": "Wealth Systems Architecture",
            "x": 6, "y": 4, "width": 45, "height": 8, "zIndex": 10,
            "enterAnimation": { "type": "slide_up", "duration": 15, "delay": 0 }
          },
          {
            "id": "el_waterfall",
            "type": "image",
            "sourceAssetId": "asset:waterfall",
            "content": "Waterfall Allocation Hub",
            "revealSyncPhrase": "automated waterfall",
            "imageDescription": "A photorealistic high-definition 35mm photograph of a majestic multi-tiered waterfall cascading over slate rock cliffs into a turquoise alpine lake surrounded by pine trees, soft morning sunlight, 8k resolution",
            "x": 40, "y": 16, "width": 22, "height": 26, "zIndex": 1,
            "enterAnimation": { "type": "scale_in", "duration": 15, "delay": 30 }
          }
        ]
      },
      "syncHints": [
        { "text": "automated waterfall", "triggerAction": "reveal", "targetElementId": "el_waterfall" }
      ]
    }
  ]
}`;

    const jsonResp = await callLlm(llmConfig, prompt2Text, true);
    const parsed = JSON.parse(jsonResp);

    if (parsed.scenes && Array.isArray(parsed.scenes)) {
      const draftManifest: StoryboardManifest = {
        meta: {
          title: cleanTitle,
          targetDuration: parsed.scenes.reduce((acc: number, s: any) => acc + (s.duration || 8), 0),
          stylePreset,
        },
        scenes: parsed.scenes,
      };

      // PROMPT 3: Storyboard Review & Quality Control Pass
      console.log('[NarrativeEngine] Step 3: Running Storyboard QA & Flow Review LLM Pass...');
      return await reviewAndOptimizeStoryboard(draftManifest, llmConfig);
    }
  } catch (err) {
    console.error('[NarrativeEngine] Exception during LLM generation:', err);
  }

  return buildCinematicWhiteboardFallback(cleanTitle, stylePreset);
}

/**
 * Step 3: Storyboard QA & Flow Review Pass
 * Inspects draft manifest JSON to verify reveal timings, image descriptions, non-overlapping coordinates, and highlight sync.
 */
async function reviewAndOptimizeStoryboard(
  manifest: StoryboardManifest,
  llmConfig: any
): Promise<StoryboardManifest> {
  const reviewPrompt = `Role: You are an expert Visual Director and Quality Control Editor reviewing an explainer video storyboard JSON.

Task: Inspect and optimize the draft Storyboard JSON below. Guarantee 5 strict professional quality benchmarks:
1. Reveal Synchronizations: Verify every image element has a "revealSyncPhrase" matching an exact phrase in narration.
2. Story-Driven Variable Asset Sizing: Do NOT assign uniform box sizes to all images on screen! Vary asset sizes dynamically based on narrative weight: Hero/Anchor Hubs (width: 24-32%, height: 26-34%), Secondary Target Nodes (width: 16-20%, height: 18-24%), Accent Icons/Badges (width: 10-14%, height: 12-16%).
3. Spaced-Out Cluster Layout: Ensure elements are NOT squished close to each other. Unless elements are explicitly part of a visual cluster, enforce generous 20%+ padding and clear vector arrow paths between images.
4. Detailed Image Descriptions: Verify every image element has a detailed 1-2 sentence "imageDescription" suitable for Flux / photorealistic 35mm AI image generation.
5. Zero Title Collision: Ensure all image elements are positioned at Y >= 16% below section titles (Y: 4-12%), with safe outer border margins (6% <= X <= 94%, Y + height <= 92%).

Draft Storyboard JSON:
${JSON.stringify(manifest, null, 2)}

Return the OPTIMIZED VALID JSON matching the exact Storyboard Manifest structure.`;

  try {
    const reviewedJson = await callLlm(llmConfig, reviewPrompt, true);
    const parsed = JSON.parse(reviewedJson);
    if (parsed.scenes && Array.isArray(parsed.scenes)) {
      console.log('[NarrativeEngine] Step 3 Complete. Storyboard QA & Flow Review passed.');
      return {
        meta: manifest.meta,
        scenes: parsed.scenes,
      };
    }
  } catch (err) {
    console.warn('[NarrativeEngine] Review pass encountered issue, using draft manifest:', err);
  }

  return manifest;
}

async function callLlm(llmConfig: any, prompt: string, jsonMode = false): Promise<string> {
  if (llmConfig.provider === 'openai') {
    const res = await fetch(`${llmConfig.baseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.modelName,
        messages: [{ role: 'user', content: prompt }],
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    const data = await res.json();
    return data.choices[0].message.content;
  } else if (llmConfig.provider === 'gemini') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${llmConfig.modelName}:generateContent?key=${llmConfig.apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(jsonMode ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      }),
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  return '';
}

function buildCinematicWhiteboardFallback(
  cleanTitle: string,
  stylePreset: NarrativeEngineOptions['stylePreset'] = 'whiteboard'
): StoryboardManifest {
  const scenes: StoryboardScene[] = [
    {
      sceneNumber: 1,
      narration: `Imagine waking up on a Friday morning and checking your phone. A direct deposit has just landed. Your income has suddenly surged to 500 dollars a day. You feel the weight of financial anxiety lift.`,
      duration: 10,
      layout: {
        background: { type: 'image', value: '#f8fafc' },
        elements: [
          {
            id: 'sc1_title',
            type: 'text',
            content: `The Monthly Income Decision`,
            x: 6,
            y: 4,
            width: 44,
            height: 8,
            zIndex: 10,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 0 },
          },
          {
            id: 'sc1_phone',
            type: 'image',
            sourceAssetId: 'asset:money',
            content: 'Direct Deposit: +$500/day ($182.5k/yr)',
            revealSyncPhrase: '500 dollars',
            imageDescription: 'A high-definition photorealistic 35mm photograph of thick stacks of crisp green 100 dollar cash banknotes bound with paper bank straps on a clean white surface, master shot, sharp focus, 8k resolution',
            x: 10,
            y: 18,
            width: 18,
            height: 24,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
          },
          {
            id: 'sc1_glow',
            type: 'highlight_overlay',
            sourceAssetId: 'sc1_phone',
            x: 10,
            y: 18,
            width: 18,
            height: 24,
            zIndex: 5,
            highlightOverlay: { targetAssetId: 'sc1_phone', targetRegion: 'full', style: 'glow' },
            enterAnimation: { type: 'fade_in', duration: 10, delay: 15 },
          },
        ],
      },
      syncHints: [{ text: '500 dollars', triggerAction: 'reveal', targetElementId: 'sc1_phone' }],
    },
    {
      sceneNumber: 2,
      narration: `Your high-interest debt has been eradicated. A fortress of 15,000 dollars sits quietly in a high-yield account, fully insulating you from sudden emergencies. But what happens next?`,
      duration: 10,
      layout: {
        background: { type: 'image', value: '#f8fafc' },
        elements: [
          {
            id: 'sc1_title',
            type: 'text',
            content: `Building the Financial Fortress`,
            x: 6,
            y: 4,
            width: 44,
            height: 8,
            zIndex: 10,
          },
          {
            id: 'sc1_phone',
            type: 'image',
            sourceAssetId: 'asset:money',
            content: 'Direct Deposit: +$500/day',
            revealSyncPhrase: 'direct deposit',
            x: 10,
            y: 18,
            width: 18,
            height: 24,
            zIndex: 1,
          },
          {
            id: 'sc2_conn',
            type: 'connector',
            connectorStyle: 'arrow',
            fromElementId: 'sc1_phone',
            toElementId: 'sc2_fortress',
            content: 'Initial Flow',
            x: 30,
            y: 28,
            width: 12,
            height: 4,
            zIndex: 2,
            enterAnimation: { type: 'fade_in', duration: 10, delay: 10 },
          },
          {
            id: 'sc2_fortress',
            type: 'image',
            sourceAssetId: 'asset:vault',
            content: 'Zero Debt & $15k Fortress',
            revealSyncPhrase: 'fortress of 15,000 dollars',
            imageDescription: 'A sleek 3D gold and stainless-steel bank safe vault with digital wheel dial lock and emerald security shield badge',
            x: 72,
            y: 18,
            width: 20,
            height: 26,
            zIndex: 1,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 15 },
          },
          {
            id: 'sc2_glow',
            type: 'highlight_overlay',
            sourceAssetId: 'sc2_fortress',
            x: 72,
            y: 18,
            width: 20,
            height: 26,
            zIndex: 5,
            highlightOverlay: { targetAssetId: 'sc2_fortress', targetRegion: 'full', style: 'glow' },
            enterAnimation: { type: 'fade_in', duration: 10, delay: 15 },
          },
        ],
      },
      syncHints: [{ text: 'fortress of 15,000 dollars', triggerAction: 'reveal', targetElementId: 'sc2_fortress' }],
    },
    {
      sceneNumber: 3,
      narration: `Instead of letting cash evaporate, you route it through an automated waterfall system. 200 dollars flows directly into your reserve vault, 200 dollars fuels compounding growth, and 100 dollars expands your skill and team buffer.`,
      duration: 18,
      layout: {
        background: { type: 'image', value: '#f8fafc' },
        elements: [
          {
            id: 'sc3_title',
            type: 'text',
            content: `The Automated Waterfall Allocation System`,
            x: 6,
            y: 4,
            width: 52,
            height: 8,
            zIndex: 10,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 0 },
          },
          {
            id: 'sc3_money',
            type: 'image',
            sourceAssetId: 'asset:money',
            content: '+$500 Monthly Income',
            revealSyncPhrase: 'cash evaporate',
            x: 8,
            y: 18,
            width: 18,
            height: 24,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
          },
          {
            id: 'conn_income_waterfall',
            type: 'connector',
            connectorStyle: 'arrow',
            fromElementId: 'sc3_money',
            toElementId: 'sc3_waterfall',
            content: 'Route Surplus',
            x: 27,
            y: 28,
            width: 11,
            height: 4,
            zIndex: 2,
            enterAnimation: { type: 'fade_in', duration: 10, delay: 25 },
          },
          {
            id: 'sc3_waterfall',
            type: 'image',
            sourceAssetId: 'asset:waterfall',
            content: 'Waterfall System Hub',
            revealSyncPhrase: 'automated waterfall',
            replacesElementId: 'sc2_fortress',
            imageDescription: 'A photorealistic high-definition 35mm photograph of a majestic multi-tiered waterfall cascading over slate rock cliffs into a turquoise alpine lake surrounded by pine trees, soft morning sunlight, 8k resolution',
            x: 39,
            y: 16,
            width: 22,
            height: 26,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 30 },
          },
          {
            id: 'conn_vault',
            type: 'connector',
            connectorStyle: 'arrow',
            fromElementId: 'sc3_waterfall',
            toElementId: 'sc3_vault',
            content: '$200 Vault',
            x: 18,
            y: 46,
            width: 20,
            height: 4,
            zIndex: 2,
            enterAnimation: { type: 'fade_in', duration: 10, delay: 45 },
          },
          {
            id: 'conn_growth',
            type: 'connector',
            connectorStyle: 'arrow',
            fromElementId: 'sc3_waterfall',
            toElementId: 'sc3_growth',
            content: '$200 Growth',
            x: 49,
            y: 45,
            width: 4,
            height: 4,
            zIndex: 2,
            enterAnimation: { type: 'fade_in', duration: 10, delay: 75 },
          },
          {
            id: 'conn_people',
            type: 'connector',
            connectorStyle: 'arrow',
            fromElementId: 'sc3_waterfall',
            toElementId: 'sc3_people',
            content: '$100 Skills',
            x: 63,
            y: 46,
            width: 18,
            height: 4,
            zIndex: 2,
            enterAnimation: { type: 'fade_in', duration: 10, delay: 105 },
          },
          {
            id: 'sc3_vault',
            type: 'image',
            sourceAssetId: 'asset:vault',
            content: '1️⃣ Reserve Vault (+$200)',
            revealSyncPhrase: 'reserve vault',
            x: 8,
            y: 60,
            width: 18,
            height: 25,
            zIndex: 1,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 50 },
          },
          {
            id: 'sc3_growth',
            type: 'image',
            sourceAssetId: 'asset:growth_chart',
            content: '2️⃣ Compounding Growth (+$200)',
            revealSyncPhrase: 'compounding growth',
            imageDescription: 'A vibrant 3D compounding growth chart mountain with glowing upward green trajectory line and rocket at peak',
            x: 41,
            y: 60,
            width: 18,
            height: 25,
            zIndex: 1,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 80 },
          },
          {
            id: 'sc3_people',
            type: 'image',
            sourceAssetId: 'asset:people',
            content: '3️⃣ Skill & Team Buffer (+$100)',
            revealSyncPhrase: 'skill and team buffer',
            imageDescription: 'A high-definition photorealistic 35mm photo of a diverse executive team collaborating around a wooden table with laptops',
            x: 74,
            y: 60,
            width: 18,
            height: 25,
            zIndex: 1,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 110 },
          },
          {
            id: 'sc3_vault_glow',
            type: 'highlight_overlay',
            sourceAssetId: 'sc3_vault',
            x: 8,
            y: 60,
            width: 18,
            height: 25,
            zIndex: 5,
            highlightOverlay: { targetAssetId: 'sc3_vault', targetRegion: 'full', style: 'glow' },
            enterAnimation: { type: 'fade_in', duration: 10, delay: 50 },
          },
          {
            id: 'sc3_growth_glow',
            type: 'highlight_overlay',
            sourceAssetId: 'sc3_growth',
            x: 41,
            y: 60,
            width: 18,
            height: 25,
            zIndex: 5,
            highlightOverlay: { targetAssetId: 'sc3_growth', targetRegion: 'full', style: 'glow' },
            enterAnimation: { type: 'fade_in', duration: 10, delay: 80 },
          },
        ],
      },
      syncHints: [
        { text: 'automated waterfall', triggerAction: 'reveal', targetElementId: 'sc3_waterfall' },
        { text: 'reserve vault', triggerAction: 'reveal', targetElementId: 'sc3_vault' },
        { text: 'compounding growth', triggerAction: 'reveal', targetElementId: 'sc3_growth' },
        { text: 'skill and team buffer', triggerAction: 'reveal', targetElementId: 'sc3_people' },
      ],
    },
    {
      sceneNumber: 4,
      narration: `You have built a system that turns momentum into lasting security. Leaving you with the freedom to focus entirely on living your life.`,
      duration: 7,
      layout: {
        background: { type: 'image', value: '#f8fafc' },
        elements: [
          {
            id: 'sc4_title',
            type: 'text',
            content: `Systemic Freedom & Scale`,
            x: 6,
            y: 4,
            width: 50,
            height: 8,
            zIndex: 10,
          },
          {
            id: 'sc4_building',
            type: 'image',
            sourceAssetId: 'asset:building',
            content: 'Enterprise Foundation & Long-Term Freedom',
            revealSyncPhrase: 'freedom to focus',
            replacesElementId: 'sc3_waterfall',
            imageDescription: 'A high-definition photorealistic 35mm photograph of a modern high-rise glass skyscraper building reaching into the sky, cinematic golden hour lighting',
            x: 36,
            y: 18,
            width: 28,
            height: 38,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 20, delay: 10 },
          },
        ],
      },
      syncHints: [{ text: 'freedom to focus', triggerAction: 'reveal', targetElementId: 'sc4_building' }],
    },
  ];

  return {
    meta: {
      title: cleanTitle,
      targetDuration: scenes.reduce((acc, s) => acc + s.duration, 0),
      stylePreset,
    },
    scenes,
  };
}
