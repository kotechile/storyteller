import { ImageStylePreset } from '../types/storyboard';

export type InfographicType =
  | 'workflow'
  | 'timeline'
  | 'architecture'
  | 'comparative'
  | 'decision_tree'
  | 'data_viz'
  | 'technical_schematic'
  | 'generic';

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
    layout: 'flowing left-to-right with sequential numbered stages connected by directional arrows',
    primary: 'the first and final pipeline stages',
  },
  timeline: {
    metaphor: 'a chronological timeline milestone diagram',
    layout: 'a clean horizontal spine line with sequential date badges, circular milestone nodes, and structured callout cards',
    primary: 'the chronological progression of key milestones',
  },
  architecture: {
    metaphor: 'a modular system architecture map',
    layout: 'a central hub with subsystem component containers branching outward via secure connector lines',
    primary: 'the central hub component',
  },
  comparative: {
    metaphor: 'a split-screen comparative matrix',
    layout: 'two or three columns side by side using visual checkmarks, metric bars, and concise feature lists',
    primary: 'the two or three items being compared',
  },
  decision_tree: {
    metaphor: 'a minimalist decision tree flowchart',
    layout: 'a starting node at the top branching downward into distinct decision outcomes via labeled logic paths',
    primary: 'the starting decision node',
  },
  data_viz: {
    metaphor: 'a structured data visualization dashboard',
    layout: 'a balanced grid containing key metric KPI cards, bar charts, and tabular data blocks',
    primary: 'the core metrics and data trends',
  },
  technical_schematic: {
    metaphor: 'a high-precision technical schematic and cross-section diagram',
    layout: 'isometric or cutaway view of the system with fine technical blueprint lines and numbered callout pins',
    primary: 'the internal mechanism and component grounding',
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
  timeline: {
    metaphor: 'a chronological photographic documentary sequence',
    layout: 'a left-to-right chronological progression of real-world scenes capturing the historical or technical evolution over time',
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
  data_viz: {
    metaphor: 'a real-world mission control or executive dashboard view',
    layout: 'a sharp perspective shot of diagnostic telemetry and operational metric screens arranged in a modern control room',
  },
  technical_schematic: {
    metaphor: 'a realistic engineering laboratory or industrial workshop view',
    layout: 'a crisp close-up focus on real-world machinery, hardware, or biological specimen with contextual diagnostic equipment',
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
  // 1. The Analytic Styles (For Data & Tech)
  'technical-blueprint':
    'Use a monochromatic technical blueprint color palette (deep blueprint navy #0c2340, crisp blueprint cyan #06b6d4, pure white #ffffff). High-precision vector blueprint lines, technical cross-sections, fine engineering grid background, geometric callout pins, realistic grounding, zero noise, high contrast, zero smudges.',
  'modern-minimal':
    'Use a modern minimal high-contrast 3-color palette (deep charcoal #18181b, vivid electric cobalt #2563eb, pure white #ffffff). Solid block backgrounds, bold sans-serif typographic hierarchy, clean geometric shapes, generous negative space, flat vector icons, zero drop shadows, zero noise.',
  'corporate-dashboard':
    'Use a clean corporate executive color palette (deep navy #0f172a, crisp teal #0d9488, slate #64748b, pure white #ffffff). Structured grid layout, clean flat iconography, subtle card containers, professional data presentation, high legibility, zero clutter.',

  // 2. The Creative & Organic Styles (For Process & Strategy)
  'whiteboard-sketch':
    'Use an authentic dry-erase whiteboard marker palette (deep black #1e293b, whiteboard navy #1d4ed8, marker green #15803d, marker red #b91c1c) on a pristine glossy white surface. Organic hand-drawn stroke textures, casual brainstorm sketch nodes, branching flowchart arrows, scribbled callouts, zero smudges.',
  'dotted-notebook':
    'Use an authentic dotted-notebook sketch palette on warm ivory paper (#fefefe) with a subtle dot-matrix grid (#cbd5e1). Fine ink linework in midnight blue (#1e3a8a) and graphite pencil (#475569), organic hand-drawn shapes, notebook flowchart nodes, casual brainstorm scribbles, high clarity.',
  'pop-art-vector':
    'Use a vibrant saturated pop-art color palette (sunshine yellow #facc15, hot punch pink #f43f5e, electric cyan #06b6d4, vivid green #22c55e, heavy solid black ink outlines #09090b). Bold comic-style flat shading, playful stylized graphic elements, energetic vector icons, dynamic viral aesthetic.',

  // 3. The Vintage & Textured Styles (For History & Guides)
  'retro-technical':
    'Use a vintage technical user-manual and field-guide color palette (aged cream background #fef9c3, deep sepia #78350f, weathered navy #1e293b, forest olive #14532d). Lightly aged parchment texture, retro technical engraving linework, fine crosshatch shading, period-accurate diagram typography, authentic historical handbook feel.',
  chalkboard:
    'Use an authentic academic chalkboard palette on a dusty slate-black textured background (#18181b). High-contrast chalk lines in powdery white (#f8fafc) and soft pastel yellow (#fef08a), gentle chalk dust textures, hand-drawn geometric diagram lines, classroom chalkboard feel.',

  // Photographic / Cinematic
  'photo-realistic':
    'Use a strictly muted, professional cinematic color palette with controlled lighting and soft filmic tones. All visual elements must be cohesive, shallow depth of field, authentic 35mm photography aesthetic, zero harsh oversaturation.',

  // Aliases & Backward Compatibility
  whiteboard:
    'Use a strictly muted, professional dry-erase whiteboard color palette with black, navy blue, and green markers on a pristine glossy white surface. All line art elements must be cohesive, clean vector stroke lines, zero smudges.',
  'flowcharts-whiteboard':
    'Use a dry-erase whiteboard marker palette on glossy white surface with organic hand-drawn arrows and brainstorm nodes.',
  'technical-scientific':
    'Use a high-precision technical schematic color palette (slate #1e293b, electric cyan #06b6d4, cobalt blue #2563eb, crisp white #ffffff). Clean vector technical blueprint lines, cross-sections, callouts, realistic component grounding.',
  'step-by-step-guide':
    'Use an instructional guide palette with clean accents. Clear numbered step indicators, directional flow arrows, distinct action stages.',
  'modular-explainer':
    'Use a modern modular system palette on pure white. Clear central hub node, radiating modular cards, clean connecting buses.',
  'timeline-historical':
    'Use an editorial timeline color palette. Distinct sequential milestone nodes, chronological flow line, date markers.',
  'data-visualization':
    'Use an executive data visualization palette on pure white. Crisp bar charts, metric stat cards, structured grid layout.',
  'playful-menu-listicle':
    'Use a vibrant playful pop-art color palette with fun doodle stickers, illustrated listicle cards, and cheerful icons.',
  illustration:
    'Use a strictly muted, professional corporate vector color palette with clean flat graphic design on pure white hex #ffffff.',
  infographic:
    'Use a professional data-visualization color palette with high contrast against pure white background.',
  'flat-vector':
    'Use a modern flat vector palette with subtle flat gradients and clean geometric shapes.',
  'chalk-drawing':
    'Use a strictly muted pastel chalk palette on smooth textured board.',
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
  if (/\b(timeline|chronolog|history|historical|milestone|over time|year|decade|century|evolution|origins)\b/.test(p)) {
    return 'timeline';
  }
  if (/\b(metric|data|kpi|scrum|financial|revenue|cost|stat|dashboard|summary|analytics|csv|table)\b/.test(p)) {
    return 'data_viz';
  }
  if (/\b(schematic|cross[- ]section|physics|biological|kubernetes|pod|hardware|circuit|mechanism|anatomy)\b/.test(p)) {
    return 'technical_schematic';
  }
  if (/\b(compare|comparison|versus|vs\.?|side[- ]by[- ]side|split[- ]screen|contrast|trade[- ]?off|pros and cons|difference between)\b/.test(p)) {
    return 'comparative';
  }
  if (/\b(decision|flowchart|if\b|then\b|branch|criteria|threshold|approval|reject|choose|whether)\b/.test(p)) {
    return 'decision_tree';
  }
  if (/\b(architecture|stack|microservice|infrastructure|server|backend|component|system design|topology|modular|central hub)\b/.test(p)) {
    return 'architecture';
  }
  if (/\b(pipeline|workflow|process|flow|steps?|stages?|sequential|phase|lifecycle|funnel|recipe|guide|how to)\b/.test(p)) {
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
  } else if (stylePreset === 'technical-blueprint') {
    style = 'monochromatic technical blueprint schematic on deep navy grid with fine vector lines';
  } else if (stylePreset === 'modern-minimal') {
    style = 'modern minimal high-contrast layout with bold 3-color palette and sans-serif typography';
  } else if (stylePreset === 'corporate-dashboard') {
    style = 'clean corporate dashboard grid with executive palette and flat iconography';
  } else if (stylePreset === 'whiteboard-sketch' || stylePreset === 'whiteboard' || stylePreset === 'flowcharts-whiteboard') {
    style = 'organic hand-drawn dry-erase whiteboard sketch with marker strokes and brainstorming arrows';
  } else if (stylePreset === 'dotted-notebook') {
    style = 'organic notebook sketch with fine pen linework on ivory dotted-grid paper';
  } else if (stylePreset === 'pop-art-vector') {
    style = 'vibrant pop-art vector illustration with heavy black ink outlines and bold flat shading';
  } else if (stylePreset === 'retro-technical') {
    style = 'vintage user manual and technical field guide engraving on textured cream parchment';
  } else if (stylePreset === 'chalkboard' || stylePreset === 'chalk-drawing') {
    style = 'academic chalk line art on dark slate blackboard with soft chalk textures';
  } else if (stylePreset === 'technical-scientific') {
    style = 'high-precision technical blueprint and scientific diagram with isometric schematic grounding';
  } else if (stylePreset === 'step-by-step-guide') {
    style = 'sequential step-by-step instructional workflow illustration with numbered stage panels';
  } else if (stylePreset === 'modular-explainer') {
    style = 'modular system architecture explainer with central hub and connected subsystem modules';
  } else if (stylePreset === 'timeline-historical') {
    style = 'chronological timeline and historical milestone diagram with date badges and event spine';
  } else if (stylePreset === 'data-visualization' || stylePreset === 'infographic') {
    style = 'crisp flat data-visualization dashboard with structured KPI cards and metric charts';
  } else if (stylePreset === 'playful-menu-listicle') {
    style = 'playful pop-art illustrated menu and listicle graphics with fun stickers and bold outlines';
  } else if (stylePreset === 'flat-vector' || stylePreset === 'illustration') {
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

  // Infer infographic type from wording, with fallback based on stylePreset
  let infographicType = inferInfographicType(rawPrompt);
  if (infographicType === 'generic') {
    if (stylePreset === 'step-by-step-guide' || stylePreset === 'timeline-historical') {
      infographicType = 'workflow';
    } else if (stylePreset === 'modular-explainer' || stylePreset === 'technical-scientific') {
      infographicType = 'architecture';
    } else if (stylePreset === 'flowcharts-whiteboard') {
      infographicType = 'decision_tree';
    } else if (stylePreset === 'data-visualization') {
      infographicType = 'comparative';
    }
  }

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
