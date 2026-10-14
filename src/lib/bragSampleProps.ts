/**
 * A tiny, self-contained sample promo used as the BragPromo composition's default props.
 *
 * Two jobs: it makes the composition previewable in Remotion Studio without running the whole
 * pipeline, and it doubles as the fixture for the Phase 4 render check.
 *
 * Deliberately imports only PURE modules — no fs, no network — because Studio runs this in a browser.
 * `audio` is therefore omitted here; the pipeline builds the real music/SFX plan in Node
 * (src/lib/bragSfx.ts) and passes it as a prop.
 */
import { bragPlanToStoryboard } from './bragStoryboard';
import type { BragPlan } from '../types/brag';
import type { BragPromoProps } from '../types/bragPromo';

export const SAMPLE_BRAG_PLAN: BragPlan = {
  appName: 'OmniCast',
  whatIsThisApp: 'Turns any URL into a short promo video that also explains what it is about.',
  angle: 'Everyone can read a link. Nobody watches a link. This makes the link watchable.',
  hook: 'A link is not a video.',
  keyMoments: [
    'Paste a URL — that is the entire input',
    'A real screenshot of the page appears in the video',
    'It ships as a vertical short, ready to publish',
  ],
  keyConcepts: ['Retrieval grounding', 'Reading-time budget'],
  outro: 'OmniCast',
  userFlow: ['paste a url', 'review the plan', 'render and publish'],
  notes: 'Sample fixture for Remotion Studio preview.',
  tone: { preset: 'default', direction: '', interpretation: 'Playful but restrained; the type does the work.' },
  format: { name: 'vertical', width: 1080, height: 1920 },
  durationSeconds: 16,
  visualIdentity: {
    background: '#0b0b0f',
    accent: '#ff5c39',
    text: '#ffffff',
    displayFont: 'Outfit',
    bodyFont: 'Inter',
    strongestVisualElement: 'the render output itself',
  },
  shareCopy: 'A link is not a video. Now it can be.',
  youtube: { title: 'Any URL, explained in 16 seconds', description: 'Sample promo.', tags: ['omnicast'] },
  audio: { role: 'warm bed', musicMood: 'upbeat', sfxPosture: 'moderate', restraintRule: 'never over the text' },
  storyboard: [
    {
      name: 'Hook',
      seconds: 3,
      onScreen: 'The hook line alone on a dark field.',
      text: ['A link is not a video.'],
      visualSource: 'typographic',
      transitionMood: 'hard',
      sfxMoment: null,
      sequential: null,
      interaction: null,
      revealHoldSeconds: null,
      visualRef: null,
    },
    {
      name: 'Reveal',
      seconds: 5,
      onScreen: 'Paste a URL. That is the whole input.',
      text: ['Paste a URL.', 'That is the entire input.'],
      visualSource: 'typographic',
      transitionMood: 'clean',
      sfxMoment: 'soft whoosh as the line lands',
      sequential: null,
      interaction: null,
      revealHoldSeconds: null,
      visualRef: null,
    },
    {
      name: 'Concept',
      seconds: 5,
      onScreen: 'Reading-time budget keeps every line on screen long enough to read.',
      text: ['Reading-time budget', 'Every line holds long enough to read'],
      visualSource: 'typographic',
      transitionMood: 'soft',
      sfxMoment: null,
      sequential: 'two lines arrive one after the other',
      interaction: null,
      revealHoldSeconds: null,
      visualRef: null,
    },
    {
      name: 'Outro',
      seconds: 3,
      onScreen: 'Product name over the accent colour.',
      text: ['OmniCast'],
      visualSource: 'typographic',
      transitionMood: 'soft',
      sfxMoment: 'logo payoff bell',
      sequential: null,
      interaction: null,
      revealHoldSeconds: null,
      visualRef: null,
    },
  ],
};

const compiled = bragPlanToStoryboard(SAMPLE_BRAG_PLAN, { format: 'vertical', fps: 30, captions: false });

export const SAMPLE_BRAG_PROPS: BragPromoProps = {
  manifest: compiled.manifest,
  brag: compiled.brag,
  sceneAudio: [],
  audio: null,
  captions: false,
  // In Studio, the Vite dev server (npm run app) serves public/.
  assetsBaseUrl: 'http://localhost:3001',
};
