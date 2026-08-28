import { ImageStylePreset } from '../types/storyboard';

export type InfographicType = 'workflow' | 'architecture' | 'comparative' | 'decision_tree' | 'generic';

export interface StructuredImagePromptComponents {
  subject: string;
  action: string;
  location: string;
  composition: string;
  style: string;
  /** SCVD — Context/Goal: who is the audience, what insight should they walk away with. */
  contextGoal?: string;
  /** SCVD — Visual Style & Metaphor: the structural layout (funnel, roadmap, split-screen, node map). */
  visualMetaphor?: string;
  /** SCVD — Data Points: sequential steps, comparisons, or metrics to map out. */
  dataPoints?: string[];
  /** The infographic type driving the structural metaphor + layout template. */
  infographicType?: InfographicType;
  /** Explicit text labels to render cleanly inside the infographic. */
  infographicLabels?: string[];
  /** Reference image anchor for character/style consistency. */
  referenceImage?: string;
}

/**
 * Visual metaphor + layout templates per infographic type (guide: "Types, Styles & Suggested Prompts").
 */
export const INFOGRAPHIC_TYPE_TEMPLATES: Record<
  InfographicType,
  { metaphor: string; layout: string; primary: string }
> = {
  workflow: {
    metaphor: 'an isometric workflow pipeline diagram',
    layout: 'flowing left-to-right with sequential stages connected by directional arrows',
    primary: 'the first and final pipeline stages',
  },
  architecture: {
    metaphor: 'a clean flat-design architecture map',
    layout: 'a central hub with component containers branching outward via secure connection lines',
    primary: 'the central hub component',
  },
  comparative: {
    metaphor: 'a split-screen comparative matrix',
    layout: 'two or three columns side by side using visual checkmarks, radar charts, and concise feature lists',
    primary: 'the two or three items being compared',
  },
  decision_tree: {
    metaphor: 'a minimalist decision tree flowchart',
    layout: 'a starting node at the top branching downward into distinct decision outcomes via labeled paths',
    primary: 'the starting decision node',
  },
  generic: {
    metaphor: 'a structured infographic',
    layout: 'a clear focal point with supporting details arranged around it in a balanced grid',
    primary: 'the central focal concept',
  },
};

/**
 * Photorealistic variants of the structural metaphors — the same layout concepts
 * (split-screen, sequential flow, branching, central hub) expressed in photographic language.
 */
export const PHOTOGRAPHIC_TYPE_TEMPLATES: Record<
  InfographicType,
  { metaphor: string; layout: string }
> = {
  workflow: {
    metaphor: 'a sequential photographic sequence',
    layout: 'a series of real-world scenes arranged left-to-right, each depicting one stage of the process, with a clear visual progression between them',
  },
  architecture: {
    metaphor: 'a cinematic environmental portrait of a system',
    layout: 'a wide establishing shot where the central subject is in sharp focus and supporting components are arranged naturally around it in the frame',
  },
  comparative: {
    metaphor: 'a split-screen photographic diptych',
    layout: 'two contrasting real-world scenes side by side, divided by a clean vertical seam, each showing a distinct scenario with matching composition and lighting',
  },
  decision_tree: {
    metaphor: 'a photographic branching sequence',
    layout: 'a real-world scene with clearly distinct visual paths leading to different outcomes, arranged top-to-bottom with the starting point prominent',
  },
  generic: {
    metaphor: 'a cinematic photographic scene',
    layout: 'a well-composed real-world scene with a clear focal subject and contextual supporting elements in the frame',
  },
};

/**
 * Positive style constraints hardcoded into the payload as mandated by Nano Banana Pro specifications.
 */
export const NANO_BANANA_POSITIVE_CONSTRAINTS: Record<string, string> = {
  illustration:
    'Use a strictly muted, professional corporate vector color palette with a maximum of three colors (navy blue #0f172a, crisp teal #0284c7, and pure white #ffffff). All visual elements must be cohesive, clean, flat graphic design, zero drop shadows, zero noise, high contrast typography, isolated on a pure white background hex #ffffff.',
  infographic:
    'Use a professional data-visualization color palette (deep navy #0f172a, vivid cyan #0891b2, emerald #059669, warm amber #f59e0b) with high contrast against a pure white background. Render crisp charts, icons, and structured layout blocks with clean geometric connector lines. Zero drop shadows, zero noise, zero background textures, high legibility.',
  'flat-vector':
    'Use a modern flat vector palette (navy #1e3a5f, teal #14b8a6, coral #fb7185, warm gray #94a3b8) with subtle flat gradients. All visual elements must be cohesive, clean geometric shapes, crisp outlines, high contrast typography, isolated on a pure white background hex #ffffff.',
  'photo-realistic':
    'Use a strictly muted, professional cinematic color palette with controlled lighting and soft filmic tones. All visual elements must be cohesive, shallow depth of field, authentic 35mm photography aesthetic, zero harsh oversaturation.',
  whiteboard:
    'Use a strictly muted, professional dry-erase whiteboard color palette with black, navy blue, and green markers on a pristine glossy white surface. All line art elements must be cohesive, clean vector stroke lines, zero smudges.',
  chalkboard:
    'Use a strictly muted slate-grey chalkboard palette with soft white and subtle yellow chalk textures. All line art elements must be cohesive academic diagrams.',
  'chalk-drawing':
    'Use a strictly muted pastel chalk palette on smooth textured board. All visual elements must be cohesive.',
};

/** Shared infographic core-principles block (guide: "Core Principles of Infographic Prompting"). */
const INFOGRAPHIC_CORE_PRINCIPLES =
  'Data Hierarchy: establish a clear primary focal point with secondary supporting details and tertiary concise labels. Text Density: substitute lengthy paragraphs with concise labels (maximum 3 words each), key data points, and universally recognized icons. No long sentences, no watermarks, no logos, no scrambled or illegible text. Output a single unified frame only — no duplicated or repeated panels, no letterbox bars, no thumbnail preview strip.';

/** Photorealistic core-principles block — composition focus, no data-viz labels. */
const PHOTOGRAPHIC_CORE_PRINCIPLES =
  'Data Hierarchy: a clear primary focal subject with secondary supporting elements and tertiary contextual detail. No text overlays, no watermarks, no logos, no UI elements, no scrambled or illegible text. Consistent color grading and natural lighting across the frame. Output a single unified frame only — never duplicate, repeat, mirror, zoom-crop, or inset any portion of the scene; no letterbox bars, no thumbnail preview strip, no repeated copy of the same subject anywhere in the frame.';

/**
 * Infers the infographic type from free-text cues in the raw prompt.
 * (No schema/plumbing change required — driven entirely by the prompt wording.)
 */
export function inferInfographicType(rawPrompt: string): InfographicType {
  const p = rawPrompt.toLowerCase();
  if (/\b(compare|comparison|versus|vs\.?|side[- ]by[- ]side|split[- ]screen|contrast|trade[- ]?off|pros and cons|difference between)\b/.test(p)) {
    return 'comparative';
  }
  if (/\b(decision|flowchart|if\b|then\b|branch|criteria|threshold|approval|reject|choose|whether)\b/.test(p)) {
    return 'decision_tree';
  }
  if (/\b(architecture|stack|microservice|infrastructure|server|backend|component|system design|topology)\b/.test(p)) {
    return 'architecture';
  }
  if (/\b(pipeline|workflow|process|flow|steps?|stages?|sequential|phase|lifecycle|funnel)\b/.test(p)) {
    return 'workflow';
  }
  return 'generic';
}

/**
 * 1. Assembles image prompt variables into the SCVD format + guide core principles:
 * Subject + Context/Goal + Visual Metaphor + Data Points, plus data hierarchy,
 * text-density limits, hardcoded positive style constraints, and infographic labels.
 */
export function assembleNanoBananaPrompt(
  components: StructuredImagePromptComponents,
  stylePreset: ImageStylePreset | string = 'illustration'
): string {
  const {
    subject,
    action,
    location,
    composition,
    style,
    contextGoal,
    visualMetaphor,
    dataPoints,
    infographicType,
    infographicLabels,
    referenceImage,
  } = components;

  const isPhoto = stylePreset === 'photo-realistic';
  const typeTemplate = isPhoto
    ? PHOTOGRAPHIC_TYPE_TEMPLATES[infographicType || 'generic'] || PHOTOGRAPHIC_TYPE_TEMPLATES.generic
    : INFOGRAPHIC_TYPE_TEMPLATES[infographicType || 'generic'] || INFOGRAPHIC_TYPE_TEMPLATES.generic;

  const positiveConstraint =
    NANO_BANANA_POSITIVE_CONSTRAINTS[stylePreset] || NANO_BANANA_POSITIVE_CONSTRAINTS['illustration'];

  const parts: string[] = [];

  // SCVD — Subject
  parts.push(`Subject: ${subject}.`);
  if (action) parts.push(`Action: ${action}.`);
  if (location) parts.push(`Location and Context: ${location}.`);

  // SCVD — Context/Goal
  const goalRaw =
    contextGoal ||
    (isPhoto
      ? 'The viewer should immediately grasp the core idea and the emotional or comparative contrast it conveys'
      : 'The viewer should immediately understand the core concept and its key components without reading paragraphs of text');
  const goal = goalRaw.replace(/[.\s]+$/, '');
  parts.push(`Context and Goal: ${goal}.`);

  // SCVD — Visual Style & Metaphor
  const metaphor = visualMetaphor || typeTemplate.metaphor;
  parts.push(`Visual Metaphor: ${metaphor}. Layout: ${typeTemplate.layout}.`);

  // Composition & Style
  if (composition) parts.push(`Composition and Framing: ${composition}.`);
  parts.push(`Style: ${style}.`);

  // SCVD — Data Points (diagram styles only — photos don't carry data-viz labels)
  if (!isPhoto && dataPoints && dataPoints.length > 0) {
    parts.push(`Data Points to map out: ${dataPoints.join('; ')}.`);
  }

  // Core principles: data hierarchy + text density (style-appropriate)
  parts.push(isPhoto ? PHOTOGRAPHIC_CORE_PRINCIPLES : INFOGRAPHIC_CORE_PRINCIPLES);

  // Positive style constraints (color palette)
  parts.push(`Positive Style Constraints: ${positiveConstraint}`);

  if (!isPhoto && infographicLabels && infographicLabels.length > 0) {
    const labelsText = infographicLabels.map((l) => `"${l}"`).join(', ');
    parts.push(`Infographic Text Labels to display cleanly: ${labelsText}.`);
  }

  if (referenceImage) {
    parts.push(
      `Character and Style Consistency Reference Anchor: Maintain exact visual character, color tones, and stylistic signature of Reference Image: ${referenceImage.substring(0, 100)}.`
    );
  }

  return parts.join(' ');
}

/**
 * Parses raw text or unstructured prompt into structured components.
 * Recovers SCVD fields when present and infers the infographic type from keywords.
 */
export function parsePromptToComponents(
  rawPrompt: string,
  stylePreset: ImageStylePreset | string = 'illustration'
): StructuredImagePromptComponents {
  // Extract explicit infographic text labels if present (e.g. labeled 'CapEx', sign reading 'Growth')
  const labelMatches = rawPrompt.match(/['"]([^'"]+)['"]/g);
  const infographicLabels = labelMatches ? labelMatches.map((m) => m.replace(/['"]/g, '')) : [];

  let subject = rawPrompt;
  let action = 'static conceptual representation';
  let location = 'clean corporate environment';
  let composition = 'centered 16:9 widescreen layout with clear focal point';
  let style = 'flat modern vector illustration';
  let contextGoal: string | undefined;
  let visualMetaphor: string | undefined;

  if (stylePreset === 'photo-realistic') {
    style = 'cinematic 35mm photography with natural lighting';
  } else if (stylePreset === 'whiteboard') {
    style = 'clean dry-erase whiteboard line art';
  } else if (stylePreset === 'chalkboard' || stylePreset === 'chalk-drawing') {
    style = 'academic chalk line art on dark slate';
  } else if (stylePreset === 'infographic') {
    style = 'crisp flat data-visualization infographic with charts and icons';
  } else if (stylePreset === 'flat-vector') {
    style = 'modern flat vector illustration with clean geometric shapes';
  }

  // Parse structured key-value pairs if prompt was generated by narrativeEngine or Art Director
  if (rawPrompt.includes('Subject:') || rawPrompt.includes('subject:')) {
    const subjMatch = rawPrompt.match(/Subject:\s*([^.]+)/i);
    if (subjMatch) subject = subjMatch[1].trim();

    const actMatch = rawPrompt.match(/(?:Action|Action\/Emotion):\s*([^.]+)/i);
    if (actMatch) action = actMatch[1].trim();

    const locMatch = rawPrompt.match(/(?:Location|Environment):\s*([^.]+)/i);
    if (locMatch) location = locMatch[1].trim();

    const compMatch = rawPrompt.match(/(?:Composition|Camera):\s*([^.]+)/i);
    if (compMatch) composition = compMatch[1].trim();
  }

  // Recover SCVD Context/Goal if explicitly present
  const goalMatch = rawPrompt.match(/(?:Context and Goal|Goal|Insight):\s*([^.]+)/i);
  if (goalMatch) contextGoal = goalMatch[1].trim();

  // Recover explicit visual metaphor if present
  const metaphorMatch = rawPrompt.match(/(?:Visual Metaphor|Metaphor):\s*([^.]+)/i);
  if (metaphorMatch) visualMetaphor = metaphorMatch[1].trim();

  // Infer infographic type from wording
  const infographicType = inferInfographicType(rawPrompt);

  return {
    subject,
    action,
    location,
    composition,
    style,
    contextGoal,
    visualMetaphor,
    dataPoints: infographicLabels.length > 0 ? infographicLabels : undefined,
    infographicType,
    infographicLabels,
  };
}
