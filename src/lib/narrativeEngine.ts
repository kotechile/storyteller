import { resolveLlmModel } from './supabaseClient';
import { ArticleData, StoryboardManifest, StoryboardScene, StoryStylePreset, storyboardManifestSchema } from '../types/storyboard';
import { fetchWithRetry } from './ingest';

export interface NarrativeEngineOptions {
  stylePreset?: StoryStylePreset;
  recommendedSceneCount?: number;
  contentType?: string;
  bypassCache?: boolean;
  voiceId?: string;
  focusTopics?: string[];
  allowExternalResearch?: boolean;
}

/**
 * 3-Step Narrative & Quality Control Pipeline:
 * Step 1: Relaxed Solo Podcaster Narrative Generator — analogies, rhetorical questions, direct audience engagement
 * Step 2: Whiteboard Storyboard Generator (Organic single-screen flowcharts, explicit reveal sync phrases)
 * Step 3: Storyboard QA & Flow Reviewer (LLM Review Pass — narration quality, reveal timings, positioning, image descriptions)
 */

/**
 * Attempts to repair malformed JSON by fixing common LLM issues
 * (unescaped quotes within string values, trailing commas).
 */
function tryRepairJson(raw: string): any | null {
  try {
    // Remove markdown code fences if present
    let cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    // Fix: unescaped double quotes inside string values
    // Strategy: find "key": "value" patterns and escape internal quotes in values
    cleaned = cleaned.replace(/"narration"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/g, (match, content) => {
      return '"narration": ' + JSON.stringify(content);
    });
    cleaned = cleaned.replace(/"imageDescription"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/g, (match, content) => {
      return '"imageDescription": ' + JSON.stringify(content);
    });
    cleaned = cleaned.replace(/"content"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/g, (match, content) => {
      return '"content": ' + JSON.stringify(content);
    });

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function generateStoryboardFromArticle(
  article: ArticleData,
  options: NarrativeEngineOptions = {}
): Promise<{ manifest: StoryboardManifest; usedFallback: boolean }> {
  const stylePreset = options.stylePreset || 'whiteboard';
  const cleanTitle = article.title.split(/\s+[|:\-–—]\s+/)[0].replace(/\s+/g, ' ').trim();
  const llmConfig = await resolveLlmModel('storyboard_planning');

  console.log(`[NarrativeEngine] Step 1: Generating Cinematic Narrative for: "${cleanTitle}"...`);

  if (!llmConfig.apiKey) {
    throw new Error(
      `[NarrativeEngine] No API key resolved for provider "${llmConfig.provider}" (${llmConfig.modelName}). Please add GEMINI_API_KEY or OPENAI_API_KEY to your Supabase 'api_keys' table or .env file.`
    );
  }

  try {
    // PROMPT 1: Cinematic Narrative Generator
    const contentTypeInfo = `Content Type: "${options.contentType || 'technical_explainer'}"
${options.contentType === 'tutorial' ? '- Structure: Step-by-step learning journey. Each scene builds on the previous with clear progression.' : ''}
${options.contentType === 'news_briefing' ? '- Structure: Lead with the most important fact. Keep scenes concise and fact-dense.' : ''}
${options.contentType === 'cinematic_story' ? '- Structure: Hero\'s journey arc. Open with a hook, build tension, deliver resolution.' : ''}
${options.contentType === 'technical_explainer' ? '- Structure: Break down complex systems visually. Use diagrams and flow metaphors.' : ''}`;

    const prompt1Text = `ROLE AND PRIMARY OBJECTIVE
You are an elite instructional designer, narrative strategist, and charismatic solo podcaster. Your primary objective is to convert the provided article into a highly engaging, single-narrator cinematic script. You do not merely summarize — you transform dense information into a relaxed, story-driven journey that a layperson would eagerly listen to in full.

AUDIENCE
Young professionals (ages 22-35). They are intelligent and curious but have ZERO background knowledge on this topic. They are not reading a textbook — they want to be entertained while learning.

${contentTypeInfo}

═══════════════════════════════════════
NARRATIVE STYLE AND TONAL CONSTRAINTS
═══════════════════════════════════════

1. CONVERSATIONAL AND ACCESSIBLE
Your language must be inherently informal, warm, and energetic. Use contractions (can't, you'll, it's), natural conversational filler, and colloquialisms. Read your narration aloud in your head — if it sounds like a textbook, rewrite it. If it sounds like something you'd say to a friend over coffee, it's right. Pitch complex discussions at the level of a complete newcomer — assume ZERO prior knowledge.

2. THE ILLUSION OF DIALOGUE (CRITICAL)
You are a SINGLE narrator — there is no co-host to banter with. You must simulate conversational momentum alone. Achieve this by:
  - Posing rhetorical questions at transitions: "Now, why does that matter?" / "Sounds counterintuitive, doesn't it?" / "So how does that actually work?"
  - Acknowledging the topic's complexity: "This is where it gets really interesting." / "Stick with me here — this part is worth it."
  - Then answering your own question conversationally, as if responding to a curious friend.

3. DIRECT AUDIENCE ENGAGEMENT
Address the viewer directly and naturally throughout the script. Use phrases like:
  - "You might be wondering..."
  - "Picture this for a second..."
  - "Let's unpack that together."
  - "Here's the thing..."
  - "Think about it this way..."

4. CONTEXTUAL STORYTELLING (CRITICAL)
DO NOT merely summarize, parrot, or regurgitate the article text. You MUST wrap core concepts in surrounding context:
  - Where did this idea come from? (origin)
  - How does it actually work under the hood? (mechanism)
  - Why does it matter in the real world? (implication)
  - What happens if we ignore it? (stakes)
Every paragraph should feel like you're revealing a new layer of a story, not reading bullet points. Stay tightly tethered to the source facts — extrapolate context but do not fabricate.

5. ANALOGICAL ANCHORING
Whenever a complex, abstract, or highly technical concept appears, IMMEDIATELY follow it with an accessible, everyday analogy. Use structures like:
  - "Think of it like..."
  - "It's essentially the same as..."
  - "Imagine you're..."
  - "It's a bit like when you..."
The analogy must be genuinely illuminating, not forced. If there is no natural analogy, use a concrete real-world example instead.

═══════════════════════════════════════
SCRIPT STRUCTURE REQUIREMENTS
═══════════════════════════════════════

- UNRESTRICTED SCENE COUNT (CRITICAL): There is ZERO restriction on the number of scenes generated. Generate as many scenes as needed to naturally explain any topic in the article thoroughly without rushing or truncating. Whether an article requires 5 scenes or 18 scenes, let the topic depth dictate the scene count.
- HIGH-ENERGY SOCIAL HOOK & CALL-TO-ACTION (CRITICAL): This video is designed to capture viewer attention on social platforms and drive clicks to the full YouTube video / article link.
  * Hook (Opening): Must be extremely eye-catching, fun, and provocative. Open with a surprising fact, counterintuitive cliffhanger, or high-stakes scenario.
  * Engagement: Keep the tone entertaining, dynamic, and curiosity-inducing ("Wait till you see how this works...", "This changes everything about...").
  * Final Call-to-Action (Conclusion): End with a compelling teaser CTA driving viewers to click the link / watch the full YouTube video for the complete deep dive ("Want the full breakdown? Click the link below to watch the complete YouTube video now!").
- Progressive Disclosure Scaffolding: You must structure the video blueprint using the 'Progressive Disclosure' framework across scenes:
  * Frame 1 (The Hook): Visually represent the core problem or question.
  * Frame 2 (The Context): Illustrate the environment or stakes of the problem.
  * Frame 3 (The Mechanism): Show a breakdown or cutaway of how the concept works.
  * Frame 4 (The Solution): Present the final resolution or product application.
  Ensure the visual subject logically connects from one frame to the next.
- Progressive Build: Each section deepens understanding, layering context and implications.
- Climax / "Aha" Moment: Include a moment where everything clicks — the key insight that reframes the topic.
- Satisfying Conclusion & YouTube CTA (MANDATORY): The final scene MUST wrap up the narrative with a high-energy takeaway and direct link/video click call-to-action.
- Transitions: Fluid and varied. "So we've established X, which brings us perfectly to Y." / "Now here's where it gets really fascinating..." / "But that's only half the story..."
- Rhetorical Variety: Every segment must include at least ONE of: a rhetorical question, an everyday analogy, a direct audience address, or a contextual "why/how" expansion. Vary the devices across segments — never the same one twice in a row.
- FINAL SCENE GUARANTEE: The very last segment MUST be a satisfying conclusion with a click-through call-to-action to watch the full video/link. This is non-negotiable.

═══════════════════════════════════════
FEW-SHOT EXAMPLES OF DESIRED STYLE
═══════════════════════════════════════

Example — Opening Hook:
"Here's a wild thought: every time you send an email, you're renting a tiny slice of a warehouse-sized computer somewhere in Virginia. You don't own it, you don't maintain it, you just... use it. That's cloud computing in a nutshell. But how did we get here — and more importantly, why should you care?"

Example — Analogy for Abstract Concept:
"So what exactly is a 'latent space'? I know, it sounds like something out of a sci-fi novel. But think of it like this: imagine you have a giant map where every song you've ever heard lives at a specific coordinate. Sad songs cluster together in one neighborhood, upbeat dance tracks in another. A latent space is exactly that — a map where similar ideas live close together."

Example — Transition with Rhetorical Question:
"We've seen how these models process information. But here's the question that keeps engineers up at night: what happens when the model is confidently wrong? That's the hallucination problem — and it's a bigger deal than most people realize."

═══════════════════════════════════════
INTERNAL PROCESSING (Chain-of-Thought)
═══════════════════════════════════════

Before writing the script, process these steps internally:
Step 1 — ANALYZE: Extract the 3-5 core themes, the key facts, and the central "aha" insight from the article.
Step 2 — IDENTIFY ANALOGIES: For each complex concept, determine the best everyday analogy or concrete example.
Step 2.5 — IDENTIFY VISUAL ANCHORS: For each narrative segment, determine the ONE visual concept that best represents it as a static image. What is the single most memorable, concrete image for this segment? This will become the hub image for that scene.
Step 3 — BUILD THE ARC: Hook → Progressive Build → Climax Insight → Satisfying Conclusion.
Step 4 — DRAFT: Write the full script following ALL tonal constraints above.

Input Article:
Title: "${cleanTitle}"
Excerpt: "${article.excerpt}"
Content: "${article.textContent.substring(0, 12000)}"
${options.allowExternalResearch ? `
═══════════════════════════════════════
EXTERNAL RESEARCH & TOPIC ENRICHMENT (ENABLED)
═══════════════════════════════════════

You are EXPLICITLY AUTHORIZED to use your broader knowledge base to perform external research and enrich the script beyond the article's text.
- Complement article facts with up-to-date real-world context, historical background, statistical benchmarks, technical deep-dives, or recent industry developments.
- Bring in external examples, real-world case studies, or expert insights that enhance clarity and engagement.
- Ensure all supplementary external knowledge seamlessly integrates with the article's core thesis.
` : `
═══════════════════════════════════════
SOURCE GROUNDING (STRICT ARTICLE BOUNDARY)
═══════════════════════════════════════
Stay tightly tethered to the facts in the provided article text. Extrapolate narrative context but do not fabricate unverified external claims.
`}
${options.focusTopics && options.focusTopics.length > 0 ? `
═══════════════════════════════════════
FOCUS TOPICS (User-Selected — Primary Emphasis)
═══════════════════════════════════════

${options.focusTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

CRITICAL: Selecting focus topics does NOT mean excluding the rest of the article. You MUST cover the ENTIRE article from start to finish to provide a complete, coherent explanation. Dedicate at least 60% of the narrative emphasis to these specific topics as the primary narrative spine, while seamlessly integrating all supporting context and sections from the full article.
` : ''}`;

    const cinematicScript = await callLlm(llmConfig, prompt1Text);
    console.log('[NarrativeEngine] Step 1 Complete. Narrative script generated (relaxed podcaster style).');

    // Build dynamic asset injection section from source article images
    const availableAssets = article.assets
      .filter(a => a.url && (a.classification === 'diagram' || a.classification === 'chart' || a.classification === 'photo'))
      .map(a => {
        const regions = a.visionAnalysis?.regions
          ? `Regions: ${a.visionAnalysis.regions.map(r => `"${r.id}" (${r.label} at ${r.boundingBox.x}%,${r.boundingBox.y}%)`).join('; ')}`
          : 'No regions identified';
        return `- "${a.id}": ${a.altText} [${a.classification}] — ${a.visionAnalysis?.description || 'No analysis available'}. ${regions}. Source URL: ${a.url}`;
      })
      .join('\n');

    const assetInjectionSection = availableAssets
      ? `\nAvailable Source Assets (from the original article — use these for visual references via sourceAssetId):\n${availableAssets}\n`
      : '\nNo source images available. Use imageDescription fields for AI image generation.\n';

    // PROMPT 2: Storyboard Generator (Organic Positioning & Explicit Reveal Sync Phrases)
    console.log('[NarrativeEngine] Step 2: Generating Storyboard JSON with Explicit Reveal Timings...');
    const contentTypeFormat = `Content Type Format: ${
      options.contentType === 'tutorial'
        ? 'Number scenes sequentially (Step 1, Step 2...). Use instructional tone.'
        : options.contentType === 'news_briefing'
        ? 'Label scenes as News Segments. Keep visuals high-impact and fact-focused.'
        : options.contentType === 'cinematic_story'
        ? 'Label scenes as Story Beats. Build dramatic arc with visual crescendos.'
        : 'Label scenes as System Components. Focus on architecture diagrams and flow visualizations.'
    }`;

    const prompt2Text = `ROLE AND PRIMARY OBJECTIVE
You are an expert cinematic art director, visual prompt engineer, and storyboard artist. Your job is to translate the narrative script below into a storyboard JSON where every image's "imageDescription" is a production-grade, five-layer cinematic prompt that an AI image generation model can render into a rich, professional keyframe.

═══════════════════════════════════════
CRITICAL: IMAGE MUST VISUALIZE THE NARRATION (NOT THE SOURCE ARTICLE)
═══════════════════════════════════════

This is the single most important rule. The imageDescription for each scene MUST directly visualize and explain the SPECIFIC narration text written for THAT scene. Do NOT reach back into the source article for unrelated concepts. The narration IS the specification — the image exists to explain it.

═══════════════════════════════════════
SINGLE-OBJECT BAN (FAILURE MODE TO AVOID)
═══════════════════════════════════════

DO NOT reduce a rich narration to a single isolated object. This is the most common failure mode.

BAD example: Narration discusses cloud repatriation, cost comparison, and vendor lock-in → imageDescription = "Subject: a shiny desktop computer on a desk." This FAILS because it cherry-picks one noun and ignores the entire explanatory arc.

GOOD example: Same narration → imageDescription = "Subject: a split-screen diagram. Left side shows a leaky cloud-shaped bucket with dollar bills flowing out and a broken chain labeled 'uptime'. Right side shows a self-contained server rack inside a house with a backup generator and a sign reading 'fallback'."

RULE: If the narration contains comparison, the image MUST show BOTH sides. If the narration contains an analogy, the image MUST depict the analogy structure. If the narration describes a problem-then-solution, the image MUST show the problem AND the solution side by side.

═══════════════════════════════════════
THE FIVE-LAYER CINEMATIC IMAGE PROMPT FRAMEWORK
═══════════════════════════════════════

LAYER 1: SUBJECT — The primary object(s) in the frame. Be ruthlessly specific. Never use generic placeholder words like "concept", "system", "thing", or "element". Name exactly what the viewer sees: "a split screen showing a person looking at two job offer documents", "a balance scale weighing salary vs work-life balance icons", "a flowchart connecting job icons to growth meters". MANDATORY NEGATIVE RULES: 1) DO NOT include text, letters, words, or labels in imageDescription — AI image generators render text as scrambled gibberish. 2) DO NOT include physical markers, pens, hands, desks, or paper sheets — render purely the conceptual digital illustration itself.

LAYER 2: ACTION & EMOTIONAL ANCHORING — What is happening in the frame, and what does it feel like? Append action verbs and emotional keywords: "gently rising", "calm and orderly", "clear contrast", "balanced layout".

LAYER 3: CAMERA & LENS — Specify framing: "flat 2D view", "centered graphic layout", "clean front view".

LAYER 4: LIGHTING — Describe clean studio lighting: "bright even white illumination", "clean high-contrast background", "zero shadows".

LAYER 5: ENVIRONMENT & STYLISTIC COHESION — Describe the style: "digital whiteboard line art illustration", "clean vector icons and directional arrows", "plain solid white background".

═══════════════════════════════════════
PHOTOGRAPHY MODE & CHARACTER CONSISTENCY RULES
═══════════════════════════════════════

When generating photo-realistic cinematic sequences, enforce these prompt engineering constraints:
1. THE ANCHOR SUBJECT VARIABLE: Generate ONE highly specific, distinct character description (e.g. "35-year-old woman with short curly brown hair wearing a navy blue turtleneck") and prepend this exact string to every character-focused imageDescription in the sequence to ensure consistency.
2. PERSPECTIVE SHIFTS: Vary the camera angle rather than the subject to create visual interest. Specify "over-the-shoulder shot", "close-up of hands typing", "wide shot from behind", or "side profile in medium shot" to avoid rendering the face repeatedly in every scene, masking facial inconsistencies.
3. THE B-ROLL RULE: After establishing the subject in Scene 1, subsequent scenes should focus on the objects of their work (e.g., a glowing server rack, a close-up of a signed contract, a ticking clock face with its hands blurred in motion) rather than the person, simulating standard documentary B-roll.
4. ENVIRONMENT & SCENE DIVERSITY (ANTI-MONOTONY RULE): Prevent keeping the character sat in an office for all scenes. Extract abstract, emotional, or thematic metaphors from the article and map them to diverse physical settings and visual scenes (e.g., a serene river landscape at sunrise to represent peace of mind or financial freedom, an airplane wing above clouds to represent travel or scaling up, a mountain summit for milestone achievement, a bustling open-air market for commerce). Every scene must explore a distinct visual setting or metaphor.

═══════════════════════════════════════
NANO BANANA PRO INFOGRAPHIC PROMPTING (SCVD FORMULA)
═══════════════════════════════════════

When generating explanatory infographic and diagram scenes, follow the SCVD Formula:
- Subject: Explicitly state the core topic or process.
- Context/Goal: Specify what insight the viewer should walk away with.
- Visual Style & Metaphor: Choose a clear structural visual metaphor (e.g., isometric workflow pipeline, comparative split-screen matrix, interconnected node map, decision tree flowchart).
- Data Points: List sequential steps, comparisons, or key metrics to map out. Keep text density low by substituting paragraphs with concise labels, data points, and universally recognized icons.

═══════════════════════════════════════
THE VISUAL TEST & CONTRAST TEST (CRITICAL)
═══════════════════════════════════════

VISUAL TEST: Before writing any imageDescription, ask: "Can this concept be explicitly shown as a static image?" If the narration discusses an abstract feeling (e.g., "confidence in the system"), translate it into a physical visual corollary (e.g., "a steady hand pressing a glowing confirmation button"). NEVER write an imageDescription for something that cannot be visually rendered.

CONTRAST TEST: Consecutive scenes MUST vary in visual composition. After writing scene N's imageDescription, scene N+1 MUST differ in at least TWO of these dimensions:
  - Shot type (wide → close-up, establishing → macro detail)
  - Lighting (warm → cool, bright → moody)
  - Camera angle (eye-level → low angle, front-facing → bird's eye)
  - Subject scale (single object → complex scene, macro detail → wide landscape)
This prevents visual monotony across the video.

═══════════════════════════════════════
SOURCE GROUNDING REQUIREMENT
═══════════════════════════════════════

Pull specific, distinctive terminology from the source article text into your imageDescriptions. If the article mentions "SPLADE sparse lexical representations" or "attention mechanisms with query-key-value triples", USE those exact terms as visual anchors. This grounds the generated images in the actual source content rather than generic stock concepts.

${contentTypeFormat}

═══════════════════════════════════════
LAYOUT RULES
═══════════════════════════════════════

- Scenes: ZERO restrictions on scene count. Translate EVERY segment from the narrative script into its own scene. Do NOT merge or truncate scenes. Each scene MUST feature a unique visual centerpiece.
- Layout: Title Y:4-12%. Hub images Y:16-34% (w:24-34%, h:24-34%). Child text Y:65-85%. Connector zone Y:35-64%.
- Connectors: Every hub with child text MUST have arrows from hub to each child. Format: { "id": "conn_X", "type": "connector", "connectorStyle": "arrow", "fromElementId": "hub_id", "toElementId": "child_id", "x": 0, "y": 0, "width": 0, "height": 0, "zIndex": 2 }
- MANDATORY IMAGE PER SCENE: EVERY scene MUST include at least one image element. No text-only scenes.
- Safe margins: 6% ≤ X ≤ 94%. Elements must not overlap.
- Canvas: Use clearCanvas: true, canvasMode: "clear_canvas" as default for clean per-scene diagrams.
- Source images: Use sourceAssetId from Available Source Assets when available (e.g. "asset_1"). Do NOT invent image URLs. CRITICAL: If a source asset contains a technical diagram or chart, check its description/regions and MUST assign its ID as the sourceAssetId in the specific scene where the voiceover/narration directly discusses that diagram/concept. Do not map them randomly.

═══════════════════════════════════════
SCENE ANIMATION CLASSIFICATION (REQUIRED)
═══════════════════════════════════════

Every scene MUST include an "animationStrategy" field. Classify each scene by how its visual content should be brought to life:

- "programmatic" — Use for simple diagrams, step-by-step builds, and scenes where Remotion-native staggered reveals, connector draws, and whiteboard wipes are sufficient. Best for: labeled architecture diagrams with explicit flow, comparison layouts, simple process steps.

- "image_to_video" — Use when a static image can be elevated by AI motion. The static AI-generated image is sent as the first frame, and an animation prompt describes how it should come alive. Use for: real-world photos (office, nature, people), cinematic establishing shots, AND diagrams where the static image should animate with camera moves, flowing elements, or glowing highlights. When tagging a diagram as "image_to_video", write a companion animation instruction in the imageDescription describing the motion: "camera slowly pans across the flowchart as each node pulses with blue light", "the architecture diagram comes alive with data packets flowing along the connector lines". The animation prompt will be composed from imageDescription + narration.

- "text_to_video" — Use when the scene should be generated entirely as video from a textual description. The system generates a video from scratch — no static image is used as the starting frame. Use for: cinematic atmosphere scenes (time-lapse, slow motion, abstract particles), AND complex animated diagrams where text-to-video can produce richer results than animating a static image. CRITICAL: When tagging a diagram as "text_to_video", you MUST rewrite the imageDescription into an action-oriented video prompt. Instead of "a flowchart with three boxes connected by arrows", write "a dynamic 3D animated sequence where three glowing glass cubes float in space, connected by streams of luminous data particles, the camera orbiting slowly as each cube lights up in sequence, professional photorealistic render with volumetric lighting and depth of field". Describe the animation, the motion, the camera work, the lighting — not the static layout.

- "static" — Use for simple single-fact scenes, title cards (sceneNumber: 0), closing/conclusion cards, quote overlays. No animation.

═══════════════════════════════════════
CINEMATIC INTERLUDE (REQUIRED — EXACTLY ONE SCENE)
═══════════════════════════════════════

Every video MUST include EXACTLY ONE "cinematic interlude" scene positioned roughly in the middle of the story. This scene is tagged "text_to_video" and serves as an emotional bridge.

CRITICAL: This scene OVERRIDES the global style preset. Even if the video uses "whiteboard" or "illustration" style, this ONE scene MUST be written as a photorealistic cinematic video prompt. DO NOT generate a whiteboard diagram or vector illustration for this scene.

PURPOSE: Break cognitive fatigue with a human, emotional moment.

POSITION: The interlude should be the scene right after the problem is established and right before the solution is presented. Typically scene 3 or 4 in a 6-7 scene video.

VOICEOVER: Shift the tone — warm, empathetic, reflective. Use phrases like "Beyond the numbers...", "Here's the thing most calculators miss...", "The quiet truth is...". Speak directly to the viewer's emotions: the uncertainty of leaving comfort zones, the excitement of new beginnings, the human cost of indecision.

IMAGEDESCRIPTION (CRITICAL — write a cinematic video prompt, NOT a diagram): The imageDescription for this scene IS the text-to-video prompt. Extract a SPECIFIC visual metaphor from THIS article's core subject matter — do NOT fall back to generic corporate stock imagery. FORBIDDEN clichés: a person on a commuter train, a person at a desk, a generic boardroom, a handshake, a generic city skyline. Instead, translate the article's central emotional tension into a CONCRETE, evocative scene that only makes sense for THIS topic. Strong topic-specific metaphors (use these as a pattern, adapt to THIS article): a cracked porcelain piggy bank being repaired as warm golden light seeps through the seams (financial fragility → recovery); a pair of hands pulling a lever that re-routes a runaway railcar off a cliff edge (regaining control); a single protected sapling thriving inside a glass dome while weeds wilt outside (wealth protection); a fog bank lifting off a calm lake to reveal a clear path to the far shore (clarity after uncertainty). Then write the metaphor as a cinematic shot with:
- Specific subject: name the exact person/object embodying the metaphor (never the vague "a professional" or "a person")
- Camera motion: "slow tracking shot", "cinematic dolly forward", "gentle camera drift"
- Lighting: "warm golden hour", "soft morning sunlight through glass"
- Emotion: "thoughtful", "quiet confidence", "contemplative"
- Environment: a distinctive setting that reinforces the metaphor (not a generic office or train)
- Quality suffix: "photorealistic, 4k, cinematic shallow depth of field, subtle motion"

VARIETY RULE: This interlude's imagery MUST be visually distinct from every other scene and MUST NOT repeat the same subject or cliché used anywhere else in the video.

NO DIAGRAM ELEMENTS. No text labels, arrows, boxes, or structured content. This scene is pure atmosphere and human emotion.

IMPORTANT: This scene MUST still include one image element in its layout. The image element's "imageDescription" field IS the text-to-video prompt. Its "content" should be a short label like "Cinematic Interlude". Set "sourceAssetId" to empty string to skip static image generation — the video will be attached later.

CLASSIFICATION RULES:
1. Scene 0 (title card) MUST be "static".
2. For diagram/process/architecture scenes: "programmatic" is the safe default. Choose "image_to_video" when the static image would benefit from AI camera motion and glow effects. Choose "text_to_video" when the concept calls for rich 3D animation or complex motion that a static image can't capture.
3. For real-world photographic scenes: "image_to_video" is best (subtle camera motion on the photo). Use "text_to_video" only for purely atmospheric/cinematic moments.
4. For simple text-only facts or quotes: "static".
5. When upgrading a diagram scene to "image_to_video" or "text_to_video", you MUST rewrite the imageDescription to describe the ANIMATION and MOTION, not just the static layout. Include camera movement, light effects, flowing elements, sequential reveals.
6. Vary strategies across scenes — don't use "programmatic" for every diagram. A mix of programmatic reveals, image-to-video animations, and text-to-video sequences creates a more dynamic, engaging video.

TITLE CARD (SCENE 0) -- REQUIRED FIRST SCENE:
The very first scene must be a silent title card (sceneNumber: 0). Duration: 4. Narration: a one-line subtitle describing what the video covers (e.g. "How companies are cutting cloud costs and regaining control"). No layout elements, no syncHints, clearCanvas: true.

Narrative Script:
"${cinematicScript}"
${assetInjectionSection}

Respond STRICTLY with a valid JSON object matching this structure. Note the imageDescription field now contains a FULL multi-sentence five-layer prompt (minimum 40 words), not a short phrase:
{
  "meta": { "title": "${cleanTitle}", "targetDuration": 90, "stylePreset": "${stylePreset}" },
  "scenes": [
    {
      "sceneNumber": 0,
      "narration": "A one-line subtitle explaining what this video covers",
      "duration": 4,
      "animationStrategy": "static",
      "clearCanvas": true,
      "canvasMode": "clear_canvas",
      "layout": { "background": { "type": "solid", "value": "#ffffff" }, "elements": [] },
      "syncHints": []
    },
    {
      "sceneNumber": 1,
      "narration": "Narration text spoken during this scene...",
      "duration": 12,
      "animationStrategy": "programmatic",
      "clearCanvas": true,
      "canvasMode": "clear_canvas",
      "layout": {
        "background": { "type": "solid", "value": "#ffffff" },
        "elements": [
          { "id": "sc1_title", "type": "text", "content": "Section Title", "x": 6, "y": 4, "width": 44, "height": 8, "zIndex": 10 },
          { "id": "sc1_hub", "type": "image", "content": "Subject Name", "revealSyncPhrase": "key phrase from narration", "imageDescription": "Subject: a glass-walled data center with rows of blinking server racks. Action/Emotion: calm and orderly hum of operations. Camera: wide establishing shot, 16mm lens, deep focus. Lighting: cool blue ambient overhead with warm amber status LEDs creating contrast. Environment: set against a dark navy technical blueprint grid.", "x": 10, "y": 18, "width": 26, "height": 22, "zIndex": 1, "sourceAssetId": "asset_1" },
          { "id": "sc1_child1", "type": "text", "content": "Detail A", "x": 10, "y": 72, "width": 20, "height": 8, "zIndex": 5 },
          { "id": "conn1", "type": "connector", "connectorStyle": "arrow", "fromElementId": "sc1_hub", "toElementId": "sc1_child1", "x": 0, "y": 0, "width": 0, "height": 0, "zIndex": 2 }
        ]
      },
      "syncHints": [{ "text": "key phrase from narration", "triggerAction": "reveal", "targetElementId": "sc1_hub" }]
    }
  ]
}`;

    const jsonResp = await callLlm(llmConfig, prompt2Text, true);
    let rawParsed: any;
    try {
      rawParsed = JSON.parse(jsonResp);
    } catch (parseErr) {
      // Attempt JSON repair: fix unescaped quotes within string values
      const repaired = tryRepairJson(jsonResp);
      if (repaired) {
        console.log('[NarrativeEngine] JSON repaired successfully.');
        rawParsed = repaired;
      } else {
        throw new Error(`[NarrativeEngine] Failed to parse LLM JSON response: ${(parseErr as Error).message}\nFirst 500 chars: ${jsonResp.substring(0, 500)}`);
      }
    }

    // Sanitize null values in string fields before Zod validation (LLMs occasionally output null)
    const nullRepairs: string[] = [];
    function sanitizeNulls(obj: any, path: string = '') {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => sanitizeNulls(item, `${path}[${i}]`));
        return;
      }
      for (const key of Object.keys(obj)) {
        const fullPath = path ? `${path}.${key}` : key;
        if (obj[key] === null && ['narration', 'content', 'imageDescription', 'label', 'revealSyncPhrase', 'value', 'text'].includes(key)) {
          obj[key] = '';
          nullRepairs.push(fullPath);
        } else if (typeof obj[key] === 'object') {
          sanitizeNulls(obj[key], fullPath);
        }
      }
    }
    sanitizeNulls(rawParsed);

    if (nullRepairs.length > 0) {
      console.warn(`[NarrativeEngine] Repaired ${nullRepairs.length} null fields in LLM output: ${nullRepairs.join(', ')}`);
    }

    const parsed = storyboardManifestSchema.safeParse(rawParsed);

    if (parsed.success) {
      const draftManifest: StoryboardManifest = parsed.data;

      // PROMPT 3: Storyboard Review & Quality Control Pass
      console.log('[NarrativeEngine] Step 3: Running Storyboard QA & Flow Review LLM Pass...');
      return { manifest: await reviewAndOptimizeStoryboard(draftManifest, llmConfig), usedFallback: false };
    } else {
      throw new Error(`[NarrativeEngine] Storyboard schema validation failed: ${JSON.stringify(parsed.error.flatten())}`);
    }
  } catch (err: any) {
    console.error('[NarrativeEngine] Error during LLM generation:', err);
    throw new Error(`[NarrativeEngine] LLM generation error: ${err.message || err}`);
  }
}

/**
 * Step 3: Storyboard QA & Flow Review Pass
 * Inspects draft manifest JSON to verify reveal timings, image descriptions, non-overlapping coordinates, and highlight sync.
 */
async function reviewAndOptimizeStoryboard(
  manifest: StoryboardManifest,
  llmConfig: any
): Promise<StoryboardManifest> {
  const reviewPrompt = `Role: You are an expert Visual Director, Narrative Quality Editor, and Quality Control Editor reviewing an explainer video storyboard JSON.

Task: Inspect and optimize the draft Storyboard JSON below. Fix EVERY layout AND narration quality issue. You MUST return the FULL corrected JSON.

Quality Checklist — verify and fix ALL of these:

1. Reveal Synchronizations: Verify every image element has a "revealSyncPhrase" matching an exact phrase in narration.
2. Story-Driven Variable Asset Sizing: Vary asset sizes dynamically based on narrative weight: Hero/Anchor Hubs (width: 24-32%, height: 26-34%), Secondary Target Nodes (width: 16-20%, height: 18-24%), Accent Icons/Badges (width: 10-14%, height: 12-16%).
3. Spaced-Out Cluster Layout: Ensure elements are NOT squished close to each other.
4. Detailed Image Descriptions: Verify every image element has a detailed 1-2 sentence "imageDescription" suitable for AI image generation.
5. Zero Title Collision: Ensure all image elements are positioned at Y >= 16% below section titles (Y: 4-12%), with safe outer border margins (6% <= X <= 94%, Y + height <= 92%).

6. NARRATIVE QUALITY (CRITICAL — verify EVERY scene's narration):
   a) Contains at least ONE of: a rhetorical question, an everyday analogy ("Think of it like..."), a direct audience address ("You might be wondering", "Picture this"), or a contextual "why/how" expansion beyond the source text.
   b) Does NOT start with generic openers like "In today's world...", "Welcome to...", "Let's talk about...", or "In this video..."
   c) Sounds like a human podcaster speaking, not a textbook reading. Uses contractions (can't, you'll), natural phrasing, conversational rhythm.
   d) Scene 1 (the hook) MUST open with a surprising fact, provocative question, or relatable scenario — NOT a dry definition or topic introduction.
   e) FINAL SCENE (CONCLUSION): The LAST scene MUST be a satisfying wrap-up with a call-to-action, forward-looking takeaway, or reflective insight. Examples: "So next time you...", "The question now is...", "Here's what you can do today...". If the last scene is just another explanatory segment, REWRITE it as a proper conclusion.
   For any scene that fails these criteria, REWRITE the narration. Preserve all factual content, only change the delivery style to be more relaxed, conversational, and story-driven.

7. RHETORICAL VARIETY: Verify consecutive scenes do NOT use the same rhetorical device (e.g., don't have two scenes in a row both using "Think of it like..."). Vary between questions, analogies, direct addresses, and contextual expansions.

8. IMAGE DESCRIPTION QUALITY — 5-LAYER FRAMEWORK (CRITICAL): Verify EVERY image element's imageDescription includes ALL five layers:
   a) SUBJECT: Names a specific, concrete subject (NOT generic words like "concept", "system", "thing", "element")
   b) ACTION/EMOTION: Contains an action verb or emotional keyword
   c) CAMERA/LENS: Specifies shot type, lens, or depth of field
   d) LIGHTING: Describes the light source and quality
   e) ENVIRONMENT: Describes background, atmosphere, or style (do NOT say "isolated on white background" — that is added automatically)
   For any imageDescription missing any layer, ADD the missing layers while preserving existing content.

9. VISUAL TEST: Verify every imageDescription describes something that CAN be rendered as a static image. If an imageDescription references an abstract concept with no physical visualization, REWRITE it with a concrete visual corollary (e.g., "confidence in the system" → "a steady hand pressing a glowing confirmation button").

10. CONTRAST TEST: Verify consecutive scenes' imageDescriptions vary in at least TWO of: shot type, lighting, camera angle, subject scale. If two consecutive scenes have identical compositions (e.g., both are "wide establishing shot with warm lighting"), REWRITE one to create deliberate contrast.

11. SOURCE GROUNDING: Verify at least 50% of imageDescriptions contain specific terminology, proper nouns, or distinctive phrases extracted from the source article text. If imageDescriptions are all generic ("a server", "a chart", "a building"), REWRITE them to incorporate source-specific vocabulary.

12. NO SHORT PROMPTS: Verify NO imageDescription is shorter than 40 words. A single word or short phrase like "Data Center" is AUTO-REJECTED. Every imageDescription must be a detailed multi-sentence description covering all five layers.

13. IMAGE TEXT LABELS: Image descriptions MAY include text labels, titles, and annotations (e.g., "labeled 'CapEx'", "a sign reading 'Cloud Subscription'"). The image generator now handles readable text well — use labels to make diagrams clear and informative. Keep labels short (1-4 words) and visually integrated.

14. SCENE ANIMATION CLASSIFICATION (REQUIRED): Verify EVERY scene has a correct "animationStrategy" field:
   a) Scene 0 (title card) MUST be "static".
   b) Diagram/process/architecture scenes: "programmatic" is the safe default, but "image_to_video" or "text_to_video" are valid if the imageDescription has been rewritten to describe animation and motion (not static layout). Verify that video-tagged diagram scenes have action-oriented, animation-rich imageDescriptions.
   c) Real-world photographic scenes should be "image_to_video" (subtle motion on the photo) or "text_to_video" for cinematic moments.
   d) Simple text-only fact scenes should be "static".
   e) CRITICAL: When a diagram scene is tagged "image_to_video" or "text_to_video", verify the imageDescription describes ANIMATION and MOTION — not a static diagram. If it still reads like a static layout ("a flowchart with three boxes"), REWRITE it into an animation description ("a dynamic sequence where three glowing nodes pulse in sequence as the camera glides between them"). If you cannot craft a compelling animation description for the scene, reclassify it to "programmatic".
   f) When a scene lacks an "animationStrategy" field, ADD it. Default to "programmatic" for diagram scenes.

Draft Storyboard JSON:
${JSON.stringify(manifest, null, 2)}

Return the OPTIMIZED VALID JSON matching the exact Storyboard Manifest structure.`;

  try {
    const reviewedJson = await callLlm(llmConfig, reviewPrompt, true);
    const parsed = storyboardManifestSchema.safeParse(JSON.parse(reviewedJson));
    if (parsed.success) {
      console.log('[NarrativeEngine] Step 3 Complete. Storyboard QA & Flow Review passed.');
      return parsed.data;
    } else {
      console.warn('[NarrativeEngine] Review pass produced invalid JSON:', parsed.error.flatten());
      return manifest;
    }
  } catch (err) {
    console.warn('[NarrativeEngine] Review pass encountered issue, using draft manifest:', err);
  }

  return manifest;
}

export function buildChatCompletionsUrl(baseUrl?: string, provider = 'openai'): string {
  let url = (baseUrl || '').trim();
  if (!url) {
    if (provider === 'deepseek') url = 'https://api.deepseek.com';
    else if (provider === 'gemini' || provider === 'google') url = 'https://generativelanguage.googleapis.com';
    else url = 'https://api.openai.com/v1';
  }
  url = url.replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) return url;
  return `${url}/chat/completions`;
}

export async function callLlm(llmConfig: any, prompt: string, jsonMode = false): Promise<string> {
  const provider = (llmConfig.provider || 'deepseek').toLowerCase();

  let endpoint = '';
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let payload: any = {};

  if (provider === 'gemini' || provider === 'google') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${llmConfig.modelName}:generateContent?key=${llmConfig.apiKey}`;
    payload = {
      contents: [{ parts: [{ text: prompt }] }],
      ...(jsonMode ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    };
  } else {
    endpoint = buildChatCompletionsUrl(llmConfig.baseUrl, provider);
    headers['Authorization'] = `Bearer ${llmConfig.apiKey}`;
    payload = {
      model: llmConfig.modelName,
      messages: [{ role: 'user', content: prompt }],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
  }

  let responseText = '';
  let status = 200;

  if (typeof window !== 'undefined') {
    const proxyRes = await fetchWithRetry(
      '/api/proxy-llm',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, headers, body: payload }),
        signal: AbortSignal.timeout(180000),
      },
      2,
      1000
    );
    status = proxyRes.status;
    responseText = await proxyRes.text();
  } else {
    const directRes = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180000),
      },
      2,
      1000
    );
    status = directRes.status;
    responseText = await directRes.text();
  }

  let data: any = {};
  try {
    data = JSON.parse(responseText);
  } catch {
    // Raw fallback
  }

  if (status < 200 || status >= 300 || data.error) {
    const errMsg = data.error?.message || data.message || responseText || `HTTP ${status}`;
    throw new Error(`[${provider.toUpperCase()} API Error ${status}] ${llmConfig.modelName}: ${errMsg}`);
  }

  if (provider === 'gemini' || provider === 'google') {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else {
    return data.choices?.[0]?.message?.content || '';
  }
}

export function buildCinematicWhiteboardFallback(
  cleanTitle: string,
  article: ArticleData,
  stylePreset: NarrativeEngineOptions['stylePreset'] = 'whiteboard'
): StoryboardManifest {
  const scenes: StoryboardScene[] = [
    {
      sceneNumber: 1,
      narration: `Here's something that might surprise you: ${cleanTitle} isn't just another buzzword — it's quietly reshaping how we work, think, and make decisions. And most people have no idea why. Let's fix that.`,
      duration: 8,
      layout: {
        background: { type: 'solid', value: '#f8fafc' },
        elements: [
          {
            id: 'sc1_title',
            type: 'text',
            content: cleanTitle,
            x: 6,
            y: 4,
            width: 50,
            height: 8,
            zIndex: 10,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 0 },
          },
          {
            id: 'sc1_hero',
            type: 'image',
            content: 'Key Concept Overview',
            revealSyncPhrase: cleanTitle.split(' ').slice(0, 3).join(' '),
            imageDescription: `A professional photorealistic diagram illustrating the core concepts of ${cleanTitle}, clean modern design, isolated on white background`,
            x: 34,
            y: 18,
            width: 32,
            height: 40,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
          },
        ],
      },
      syncHints: [{ text: cleanTitle.split(' ').slice(0, 3).join(' '), triggerAction: 'reveal', targetElementId: 'sc1_hero' }],
    },
    {
      sceneNumber: 2,
      narration: `Think of the underlying architecture like an orchestra. You've got different sections — strings, brass, percussion — each playing a completely different part. But when they come together under a conductor, something remarkable happens. That's exactly how these components fit together.`,
      duration: 10,
      layout: {
        background: { type: 'solid', value: '#f8fafc' },
        elements: [
          {
            id: 'sc2_title',
            type: 'text',
            content: `System Architecture`,
            x: 6,
            y: 4,
            width: 44,
            height: 8,
            zIndex: 10,
          },
          {
            id: 'sc2_node1',
            type: 'image',
            content: 'Data Input & Ingestion',
            revealSyncPhrase: 'underlying structure',
            imageDescription: `A clean 3D vector illustration of data ingestion and processing pipeline for ${cleanTitle}, isolated on white background`,
            x: 12,
            y: 20,
            width: 22,
            height: 28,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
          },
          {
            id: 'sc2_conn',
            type: 'connector',
            connectorStyle: 'arrow',
            fromElementId: 'sc2_node1',
            toElementId: 'sc2_node2',
            content: 'Process Flow',
            x: 36,
            y: 32,
            width: 16,
            height: 4,
            zIndex: 2,
            enterAnimation: { type: 'fade_in', duration: 10, delay: 25 },
          },
          {
            id: 'sc2_node2',
            type: 'image',
            content: 'Processing & Reasoning Engine',
            revealSyncPhrase: 'components interact',
            imageDescription: `A high-tech 3D model of an intelligence processing unit, glowing blue nodes, isolated on white background`,
            x: 54,
            y: 20,
            width: 24,
            height: 30,
            zIndex: 1,
            enterAnimation: { type: 'slide_up', duration: 15, delay: 35 },
          },
        ],
      },
      syncHints: [
        { text: 'underlying structure', triggerAction: 'reveal', targetElementId: 'sc2_node1' },
        { text: 'components interact', triggerAction: 'reveal', targetElementId: 'sc2_node2' },
      ],
    },
    {
      sceneNumber: 3,
      narration: `So where does this actually show up in your life? Picture your morning routine — alarm, coffee, commute. Now imagine if every step just... handled itself. That's the promise of automated workflows, and it's closer than you think.`,
      duration: 10,
      layout: {
        background: { type: 'solid', value: '#f8fafc' },
        elements: [
          {
            id: 'sc3_title',
            type: 'text',
            content: `Workflow Optimization`,
            x: 6,
            y: 4,
            width: 44,
            height: 8,
            zIndex: 10,
          },
          {
            id: 'sc3_hero',
            type: 'image',
            content: 'Automated Operations Hub',
            revealSyncPhrase: 'automated workflows',
            imageDescription: `A sleek 3D graphic of an automated network hub with connected node lines, isolated on white background`,
            x: 36,
            y: 18,
            width: 28,
            height: 36,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
          },
        ],
      },
      syncHints: [{ text: 'automated workflows', triggerAction: 'reveal', targetElementId: 'sc3_hero' }],
    },
    {
      sceneNumber: 4,
      narration: `Here's the bottom line: this isn't about technology for technology's sake. It's about getting back the one thing none of us can buy more of — time. And that's a story worth paying attention to.`,
      duration: 8,
      layout: {
        background: { type: 'solid', value: '#f8fafc' },
        elements: [
          {
            id: 'sc4_title',
            type: 'text',
            content: `Key Takeaway & Impact`,
            x: 6,
            y: 4,
            width: 44,
            height: 8,
            zIndex: 10,
          },
          {
            id: 'sc4_hero',
            type: 'image',
            content: 'Scalable Enterprise Growth',
            revealSyncPhrase: 'long-term efficiency',
            imageDescription: `A high-definition photorealistic 35mm photo of a modern corporate skyscraper at sunset, representing scale and success`,
            x: 36,
            y: 18,
            width: 28,
            height: 38,
            zIndex: 1,
            enterAnimation: { type: 'scale_in', duration: 15, delay: 15 },
          },
        ],
      },
      syncHints: [{ text: 'long-term efficiency', triggerAction: 'reveal', targetElementId: 'sc4_hero' }],
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

// ═══════════════════════════════════════════════════
// ART DIRECTOR: Refine image descriptions into structured diagram prompts
// ═══════════════════════════════════════════════════

/**
 * Calls a dedicated "Art Director" LLM (Gemini recommended) to analyze each scene's
 * narration and rewrite the imageDescription into a structured whiteboard diagram prompt
 * with explicit left/right layout, visual metaphors, and comparison structures.
 * 
 * Falls back silently to the original imageDescription if no Art Director API key is available.
 */
export async function refineImagePromptsWithArtDirector(
  manifest: StoryboardManifest,
  articleTitle: string,
  stylePreset: string = 'whiteboard',
): Promise<StoryboardManifest> {
  let adConfig = await resolveLlmModel('art_director');

  // If no dedicated Art Director model, fall back to the default LLM
  if (!adConfig.apiKey) {
    console.log('[ArtDirector] No dedicated art_director model. Falling back to default LLM...');
    adConfig = await resolveLlmModel();
  }

  // If still no API key, we can't refine
  if (!adConfig.apiKey) {
    console.log('[ArtDirector] No LLM API key available. Using original image descriptions.');
    return manifest;
  }

  console.log(`[ArtDirector] Refining image descriptions using ${adConfig.provider}/${adConfig.modelName}...`);
  const refined = JSON.parse(JSON.stringify(manifest)) as StoryboardManifest;
  let refinedCount = 0;

  for (const scene of refined.scenes) {
    // Skip text_to_video scenes — their prompts are already cinematic video prompts
    const sceneAnim = (scene as any).animationStrategy;
    if (sceneAnim === 'text_to_video') {
      console.log(`[ArtDirector] Scene ${scene.sceneNumber}: skipping (text_to_video — cinematic prompt preserved)`);
      continue;
    }

    const imageElements = (scene.layout?.elements || []).filter(e => e.type === 'image');
    if (imageElements.length === 0) continue;

    const styleInstructions: Record<string, string> = {
      'whiteboard': 'High-key lighting, bright glossy white background, dry-erase marker illustration style, hand-drawn vector arrows in blue, black, red, and green, casual brainstorming aesthetic, minimal shading',
      'chalkboard': 'Dusty slate black background, textured chalk-like hand-drawn lines in stark white and pastel yellow, smudged erasures, educational and academic aesthetic, raw and unpolished geometry',
      'chalk-drawing': 'Dusty slate black background, textured chalk-like hand-drawn lines in stark white and pastel yellow, smudged erasures, educational and academic aesthetic, raw and unpolished geometry',
      'photo-realistic': 'cinematic 35mm film photography, natural environmental lighting with shallow depth of field, authentic real-world scenes with human context and emotional resonance, rich color grading with filmic contrast, shot on high-end DSLR with wide aperture, evocative compositions that tell a visual story',
      'illustration': 'flat vector illustration style on white background, bold colorful sans-serif labels, clean geometric connector lines',
    };
    const styleGuide = styleInstructions[stylePreset] || styleInstructions['whiteboard'];

    const isCinematicStyle = stylePreset === 'photo-realistic';

    const diagramPrompt = isCinematicStyle
      ? `You are an expert cinematographer and visual art director. Output valid JSON describing a cinematic scene in ${stylePreset} style that evokes the emotional core of this narration.

Visual style: ${styleGuide}

{
  "imagePrompt": "one descriptive paragraph (80-150 words) describing a CINEMATIC SCENE — include environment, lighting, human context, composition, mood, and a SPECIFIC relatable situation that mirrors what the narration describes. Use film language: wide shot, close-up, shallow depth of field, golden hour, etc.",
  "layout": { "title": "Main Title: Descriptive subtitle explaining what the scene shows", "labels": [], "connectors": [] }
}

imagePrompt rules: cinematic 35mm photography style, describe a REAL SCENE with context (not an isolated object on white), include human element when possible, use spatial and atmospheric words, describe lighting conditions and mood.

VISUAL METAPHOR (MANDATORY): Lead the imagePrompt with the structural metaphor that fits this scene:
- "a split-screen photographic diptych" (two contrasting real-world scenes side by side, divided by a clean vertical seam) when the narration compares or contrasts
- "a sequential photographic sequence" (a series of real-world scenes arranged left-to-right) when the narration describes a process or progression
- "a photographic branching sequence" (distinct visual paths leading to different outcomes) when the narration describes a decision or fork
- "a cinematic environmental portrait" (a wide establishing shot with a clear focal subject and supporting context) otherwise
layout: title as "Main Topic: One-line descriptive subtitle".

Article: "${articleTitle}"  |  Narration: "${scene.narration}"
Output ONLY valid JSON:`
      : `You are an expert visual art director. Output valid JSON describing a labeled explanatory infographic in ${stylePreset} style.

Visual style: ${styleGuide}

{
  "imagePrompt": "one descriptive paragraph (80-150 words) describing what the VIEWER SEES",
  "layout": { "title": "Main Title: Descriptive subtitle explaining what the scene shows", "labels": ["key term 1", "key term 2"], "connectors": [{"from":"hub","to":"label 1"}] }

VISUAL METAPHOR SELECTION (MANDATORY): Choose the single structural metaphor that best fits this scene and lead the imagePrompt with it explicitly:
- "an isometric workflow pipeline diagram" (for processes, steps, stages, flows)
- "a clean flat-design architecture map" (for systems, stacks, components, infrastructure)
- "a split-screen comparative matrix" (for comparisons, trade-offs, contrasts)
- "a minimalist decision tree flowchart" (for decisions, criteria, branches, thresholds)
Then describe the layout direction (left-to-right flow, central hub branching outward, side-by-side columns, or top-down branching).

DATA HIERARCHY (MANDATORY): State the primary focal point, the secondary supporting details, and the tertiary concise labels.

TEXT DENSITY (MANDATORY): Describe the diagram as using concise labels (maximum 3 words each), key data points, and universally recognized icons — NEVER paragraphs of prose, and no scrambled or illegible text.

imagePrompt rules: ${stylePreset} style, flowing paragraph, embed labels naturally as "titled 'X'", "labeled 'Y'", use spatial words, describe connectors and layout within the image itself.
layout: title as "Main Topic: One-line descriptive subtitle", labels 2-4 short terms, connectors simple hub-to-label.

Article: "${articleTitle}"  |  Narration: "${scene.narration}"
Output ONLY valid JSON:`;

    try {
      const jsonResponse = await callLlm(adConfig, diagramPrompt, true);
      const parsed = JSON.parse(jsonResponse);
      const imagePrompt = parsed.imagePrompt || '';
      const layout = parsed.layout || null;

      if (imagePrompt && imagePrompt.length > 20) {
        // Apply refined image prompt and expand to fill canvas
        for (const el of imageElements) {
          el.imageDescription = imagePrompt.trim();
          el.x = 6;
          el.y = 12;
          el.width = 88;
          el.height = 78;
          el.zIndex = 1;
        }

        // Update scene title text only — image carries labels and flow arrows
        if (layout) {
          const texts = (scene.layout?.elements || []).filter(e => e.type === 'text');
          if (layout.title && texts.length > 0) texts[0].content = layout.title;
        }

        // Keep only images + first title text. Drop connectors and extra labels (image has them)
        if (scene.layout) {
          const firstText = (scene.layout.elements || []).find(e => e.type === 'text');
          scene.layout.elements = (scene.layout.elements || []).filter(
            e => e.type === 'image' || e === firstText
          );
        }

        refinedCount++;
        console.log(`[ArtDirector] Scene ${scene.sceneNumber}: image+layout updated`);
      }
    } catch (err) {
      console.warn(`[ArtDirector] Failed to refine Scene ${scene.sceneNumber}, keeping original:`, err);
    }
  }

  console.log(`[ArtDirector] Refined ${refinedCount}/${refined.scenes.length} scenes.`);
  return refined;
}

// ═══════════════════════════════════════════════════
// TOPIC ANGLE PROPOSAL: Extract key angles from article
// ═══════════════════════════════════════════════════

export interface TopicAngle {
  label: string;
  description: string;
}

/**
 * Analyzes the article and proposes 3-5 distinct topic angles the user can
 * choose to focus the explainer video on. Returns a curated list of topics
 * extracted from the article content.
 */
export async function proposeTopicAngles(article: ArticleData): Promise<TopicAngle[]> {
  const llmConfig = await resolveLlmModel('content_classification');

  if (!llmConfig.apiKey) {
    console.warn('[TopicAngles] No LLM key available. Returning empty topic list.');
    return [];
  }

  const prompt = `Analyze this article and extract 3-5 distinct, specific topics or angles that would make great focus points for an explainer video.

Rules:
- Each topic must be SPECIFIC (e.g., "GPU TCO Analyzer tool" not "GPU technology")
- Each topic must come DIRECTLY from the article content
- Include a one-sentence description of what makes this angle interesting
- Output valid JSON array: [{"label":"Topic Name","description":"Why it matters"}]

Article Title: "${article.title}"
Article Content: "${article.textContent.substring(0, 8000)}"

Output ONLY valid JSON array. No prose, no markdown.`;

  try {
    const response = await callLlm(llmConfig, prompt, true);
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed) && parsed.length >= 3) {
      console.log(`[TopicAngles] Extracted ${parsed.length} topic angles.`);
      return parsed.slice(0, 5) as TopicAngle[];
    }
    console.warn('[TopicAngles] LLM returned invalid format. Using fallback.');
    return [];
  } catch (err) {
    console.warn('[TopicAngles] Failed to extract topics:', err);
    return [];
  }
}

// ═══════════════════════════════════════════════════
// YOUTUBE THUMBNAIL GENERATION
// ═══════════════════════════════════════════════════

export interface YouTubeThumbnailResult {
  imagePrompt: string;
  overlayText: string;
  imageUrl?: string;
}

/**
 * Generates an eye-catching, high-click-through YouTube thumbnail prompt based on article & storyboard manifest.
 */
export async function generateYouTubeThumbnailPrompt(
  manifest: StoryboardManifest,
  articleTitle: string,
  stylePreset: string = 'photo-realistic'
): Promise<YouTubeThumbnailResult> {
  const llmConfig = await resolveLlmModel('storyboard_planning');

  if (!llmConfig.apiKey) {
    return {
      imagePrompt: `High-impact YouTube thumbnail, dramatic high-contrast composition featuring a glowing key concept from ${articleTitle}, vibrant colors, high-key lighting, cinematic focal point, shallow depth of field, 8k resolution`,
      overlayText: 'THIS CHANGES EVERYTHING!',
    };
  }

  const scenesSummary = manifest.scenes
    .slice(0, 5)
    .map(s => `Scene ${s.sceneNumber}: ${s.narration}`)
    .join('\n');

  const prompt = `You are a world-class YouTube growth strategist and thumbnail designer specializing in viral tech/explainer videos.

Create a high-click-through (CTR) YouTube thumbnail concept based on this video content:
Article Title: "${articleTitle}"
Style: "${stylePreset}"
Key Narrative Beats:
${scenesSummary}

RULES FOR THUMBNAIL CONCEPT:
1. EYE-CATCHING & HOOK BAIT: Hint at a major secret, shock, or transformation without spoiling everything. Evoke intense curiosity, awe, or urgency.
2. COMPOSITION: High-contrast, clean 16:9 layout, single powerful focal point, bold colors (red/yellow accents or high-contrast neon/gold glow), expressive face or dramatic visual metaphor.
3. OVERLAY TEXT: Short, punchy 2-4 word bold text teaser (e.g. "THE REAL COST?", "DON'T DO THIS!", "SECRET REVEALED", "BEFORE IT'S TOO LATE").
4. Output STRICT JSON: {"imagePrompt":"detailed 60-100 word image generation prompt in ${stylePreset} style","overlayText":"2-4 WORD BOLD TEXT"}

Output ONLY valid JSON:`;

  try {
    const raw = await callLlm(llmConfig, prompt, true);
    const parsed = JSON.parse(raw);
    return {
      imagePrompt: parsed.imagePrompt || `High-impact YouTube thumbnail for ${articleTitle}`,
      overlayText: (parsed.overlayText || 'MUST SEE!').toUpperCase(),
    };
  } catch (err) {
    console.warn('[Thumbnail] Failed to generate custom prompt. Using fallback:', err);
    return {
      imagePrompt: `High-impact cinematic YouTube thumbnail featuring a glowing central mystery concept from ${articleTitle}, vibrant high-contrast lighting, dramatic angle, 8k resolution`,
      overlayText: 'THE TRUTH REVEALED!',
    };
  }
}

// ═══════════════════════════════════════════════════
// YOUTUBE DESCRIPTION & CHAPTER TIMESTAMPS GENERATION
// ═══════════════════════════════════════════════════

export interface YouTubeDescriptionResult {
  title: string;
  description: string;
  timestamps: Array<{ time: string; title: string }>;
  tags: string[];
}

/**
 * Helper to format seconds into mm:ss or hh:mm:ss timestamp string.
 */
function formatTimestampSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Generates an SEO-optimized YouTube video description with chapter timestamps and relevant hashtags.
 */
export async function generateYouTubeDescription(
  manifest: StoryboardManifest,
  articleTitle: string,
  articleUrl?: string
): Promise<YouTubeDescriptionResult> {
  const llmConfig = await resolveLlmModel('storyboard_planning');

  let accumulatedSecs = 0;
  const rawTimestamps = manifest.scenes.map((sc) => {
    const timeStr = formatTimestampSeconds(accumulatedSecs);
    const textSnippet = (sc.layout?.elements?.find(e => e.type === 'text')?.content || sc.narration || `Scene ${sc.sceneNumber}`).replace(/\n/g, ' ');
    const title = textSnippet.length > 40 ? textSnippet.substring(0, 37) + '...' : textSnippet;
    accumulatedSecs += sc.duration || 10;
    return { time: timeStr, title };
  });

  const timestampsText = rawTimestamps.map(t => `${t.time} - ${t.title}`).join('\n');

  if (!llmConfig.apiKey) {
    const desc = `🎬 ${articleTitle}\n\nIn this video, we break down ${articleTitle} step-by-step.\n\n📌 TIMESTAMPS:\n${timestampsText}\n\n${articleUrl ? `🔗 Read the full article: ${articleUrl}\n\n` : ''}#explainer #tech #education`;
    return {
      title: articleTitle,
      description: desc,
      timestamps: rawTimestamps,
      tags: ['explainer', 'technology', 'education'],
    };
  }

  const prompt = `You are a YouTube SEO copywriter and growth expert. Generate a high-performing YouTube video description for an explainer video.

Article Title: "${articleTitle}"
Article URL: "${articleUrl || ''}"

Calculated Scene Timestamps (MUST INCLUDE EXACTLY THESE TIMESTAMPS IN THE DESCRIPTION):
${timestampsText}

REQUIREMENTS FOR DESCRIPTION:
1. SEO-Friendly Overview: 2-3 engaging paragraphs explaining what viewers will learn.
2. Timestamps Section: Format exact chapters with 00:00 start (e.g., 00:00 - Introduction).
3. Call-To-Action (CTA): Encourage viewers to Subscribe, Like, and click the full article link.
4. Relevant Hashtags: 5-8 trending hashtags at the bottom.
5. Output STRICT JSON: {"videoTitle":"Catchy SEO YouTube Title","description":"Full formatted YouTube description string with timestamps, link, and hashtags","tags":["tag1","tag2"]}

Output ONLY valid JSON:`;

  try {
    const raw = await callLlm(llmConfig, prompt, true);
    const parsed = JSON.parse(raw);
    return {
      title: parsed.videoTitle || articleTitle,
      description: parsed.description || `🎬 ${articleTitle}\n\n📌 TIMESTAMPS:\n${timestampsText}`,
      timestamps: rawTimestamps,
      tags: parsed.tags || ['explainer', 'tech', 'education'],
    };
  } catch (err) {
    console.warn('[Description] Failed to generate custom YouTube description. Using fallback:', err);
    return {
      title: articleTitle,
      description: `🎬 ${articleTitle}\n\nIn this video, we unpack ${articleTitle} step-by-step.\n\n📌 TIMESTAMPS:\n${timestampsText}\n\n${articleUrl ? `🔗 Full Article: ${articleUrl}\n\n` : ''}#explainer #education #tech`,
      timestamps: rawTimestamps,
      tags: ['explainer', 'tech', 'education'],
    };
  }
}
