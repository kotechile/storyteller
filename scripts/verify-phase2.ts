/**
 * Phase 2 verification: the brag gate laws and a real end-to-end plan.
 *
 * Part A is pure (no network): every brag law gets a deliberately broken plan, and the gate must
 * reject it with a specific message. A gate that never fires is worse than no gate, so each case is
 * asserted individually.
 *
 * Part B is a real run: ingest a concept-heavy source, extract its identity, and have Claude
 * (via kie.ai) produce a plan that passes every gate.
 *
 * Run: npx tsx scripts/verify-phase2.ts
 */
import 'dotenv/config';
import { validateBragPlan, assertNoSecrets, sceneMinSeconds, type GateContext } from '../src/lib/bragPlanner';
import { extractSiteIdentity } from '../src/lib/siteIdentity';
import { ingestUrl } from '../src/lib/ingest';
import type { BragPlan } from '../src/types/brag';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ── fixtures ────────────────────────────────────────────────────────────────
const ARTICLE: any = {
  title: 'Retrieval-augmented generation',
  excerpt: 'RAG combines retrieval with generation.',
  wordCount: 1200,
  textContent: 'Retrieval-augmented generation grounds a language model in retrieved documents.',
  assets: [
    { id: 'asset_1', url: 'https://example.com/diagram.png', altText: 'RAG pipeline diagram', position: 0, width: 800, height: 600, classification: 'diagram' },
  ],
};

const CAPTURES = [{ id: 'shot_hero', file: '/tmp/hero.png', label: 'hero' }];

const basePlan = (): BragPlan =>
  ({
    appName: 'RAG',
    whatIsThisApp: 'A technique that grounds a language model in retrieved documents.',
    angle: 'The model stops guessing and starts citing.',
    hook: 'The model was confident. It was also wrong.',
    keyMoments: ['Retrieval happens before generation'],
    keyConcepts: ['Retrieval grounding', 'Vector search'],
    outro: 'Retrieval-augmented generation.',
    userFlow: ['ask', 'retrieve', 'answer'],
    notes: null,
    tone: { preset: 'default', direction: '', interpretation: 'warm' },
    format: { name: 'vertical', width: 1080, height: 1920 },
    durationSeconds: 18,
    visualIdentity: { background: '#000', accent: '#f60', text: '#fff', displayFont: 'Outfit', bodyFont: 'Inter', strongestVisualElement: 'diagram' },
    shareCopy: 'The model stops guessing and starts citing.',
    youtube: { title: 'RAG explained', description: 'How retrieval grounds generation.', tags: ['rag'] },
    audio: { role: 'warm bed', musicMood: 'upbeat', sfxPosture: 'sparse', restraintRule: 'never over the text' },
    storyboard: [
      { name: 'Hook', seconds: 2.5, onScreen: 'A confident answer, struck through.', text: ['The model was confident.'], visualSource: 'typographic', transitionMood: 'hard' },
      { name: 'Reality', seconds: 4, onScreen: 'The real pipeline diagram.', text: ['It was also wrong.'], visualSource: 'article_asset', visualRef: 'asset_1', transitionMood: 'clean' },
      { name: 'Concept', seconds: 5, onScreen: 'Retrieval grounding, step by step.', text: ['Retrieval grounding', 'Search first, then answer'], visualSource: 'screenshot', visualRef: 'shot_hero', transitionMood: 'clean' },
      { name: 'Outro', seconds: 6.5, onScreen: 'Product name over the source.', text: ['Retrieval-augmented generation.'], visualSource: 'screenshot', visualRef: 'shot_hero', transitionMood: 'soft' },
    ],
  }) as BragPlan;

const ctx: GateContext = {
  captures: CAPTURES,
  article: ARTICLE,
  tone: 'default',
  format: 'vertical',
  durationSeconds: 18,
};

const expectReject = (label: string, mutate: (p: BragPlan) => void, keyword: RegExp): void => {
  const plan = basePlan();
  mutate(plan);
  const violations = validateBragPlan(plan, ctx);
  const hit = violations.some((v) => keyword.test(v));
  check(label, hit, hit ? '' : `no violation matched ${keyword}. Got: ${JSON.stringify(violations)}`);
};

async function main(): Promise<void> {
  // ── Part A: the baseline fixture must PASS ────────────────────────────────
  console.log('\n[A] gate fixtures');
  const clean = basePlan();
  const cleanViolations = validateBragPlan(clean, ctx);
  check('a well-formed plan passes every gate', cleanViolations.length === 0, cleanViolations.join(' | '));
  check('the same plan has no secret leaks', assertNoSecrets(clean).length === 0);

  // ── each law rejects ──────────────────────────────────────────────────────
  expectReject('duration outside 15-25s is rejected', (p) => { p.durationSeconds = 40; p.storyboard.forEach(s => s.seconds *= 2.2); }, /15-25s/);
  expectReject('scene durations not summing to durationSeconds is rejected', (p) => { p.storyboard[0].seconds += 6; }, /sum to/);
  expectReject('a hook longer than 3s is rejected', (p) => { p.storyboard[0].seconds = 5; p.storyboard[3].seconds -= 2.5; }, /hook scene is 5s/);
  expectReject('fewer than 2 keyConcepts is rejected', (p) => { p.keyConcepts = ['only one']; }, /at least 2 concepts/);
  expectReject('selling without explaining is rejected', (p) => { p.keyConcepts = ['Quantisation', 'Distillation']; }, /never explains/);
  expectReject('no real-source scene is rejected when material exists', (p) => { p.storyboard.forEach(s => { s.visualSource = 'typographic'; s.visualRef = undefined; }); }, /shows real source material/);
  expectReject('a hallucinated screenshot id is rejected', (p) => { p.storyboard[2].visualRef = 'shot_imaginary'; }, /not a captured screenshot/);
  expectReject('a hallucinated asset id is rejected', (p) => { p.storyboard[1].visualRef = 'asset_999'; }, /not a source image/);
  expectReject('unreadable text in a short scene is rejected', (p) => { p.storyboard[1].text = ['Retrieval grounding means the model searches a corpus before it answers the question at all']; p.storyboard[1].seconds = 1.5; }, /need ~|Cut copy or lengthen/);
  expectReject('too many lines in one scene is rejected', (p) => { p.storyboard[2].text = ['a', 'b', 'c', 'd', 'e']; }, /carries 5 lines/);
  expectReject('generic SaaS language is rejected', (p) => { p.shareCopy = 'Streamline your workflow with RAG.'; }, /Banned generic SaaS language/);
  expectReject('too few scenes is rejected', (p) => { p.storyboard = p.storyboard.slice(0, 2); p.durationSeconds = 8; }, /3-8|Only 2 scenes/);

  // ── the secret screen (autonomous publishing makes this load-bearing) ─────
  const leaky = basePlan();
  leaky.storyboard[2].text = ['Key: sk-abcdefghijklmnopqrstuvwxyz012345'];
  check('an API key in on-screen text is caught', assertNoSecrets(leaky).some((v) => /OpenAI-style key/.test(v)), assertNoSecrets(leaky)[0] ?? 'NOT CAUGHT');
  const emailLeak = basePlan();
  emailLeak.hook = 'Email jorge@example.com to start.';
  check('an email address on screen is caught', assertNoSecrets(emailLeak).some((v) => /email address/.test(v)));

  // ── reading floor arithmetic matches the brag spec ────────────────────────
  const floorShort = sceneMinSeconds({ name: 'x', seconds: 1, onScreen: '', text: ['Two words'], visualSource: 'typographic', transitionMood: 'clean' } as any, 'default');
  // Generate the line rather than hand-counting words (a miscount makes the test lie, not the code).
  const eightWordLine = Array.from({ length: 8 }, (_, i) => `word${i}`).join(' ');
  const floorLong = sceneMinSeconds({ name: 'x', seconds: 1, onScreen: '', text: [eightWordLine], visualSource: 'typographic', transitionMood: 'clean' } as any, 'default');
  check('1-3 word label floors at ~0.8s + entrance', Math.abs(floorShort - (0.45 + 0.8)) < 0.01, floorShort.toFixed(2));
  check('8-word sentence floors at 8*0.3s + entrance', Math.abs(floorLong - (0.45 + 8 * 0.3)) < 0.01, `${floorLong.toFixed(2)} for ${eightWordLine.split(' ').length} words`);
  const deadpanFloor = sceneMinSeconds({ name: 'x', seconds: 1, onScreen: '', text: ['Two words'], visualSource: 'typographic', transitionMood: 'clean' } as any, 'deadpan');
  check('deadpan demands a longer hold than default', deadpanFloor > floorShort, `${deadpanFloor.toFixed(2)} vs ${floorShort.toFixed(2)}`);

  // ── Part B: real end-to-end plan ──────────────────────────────────────────
  // A real plan costs real credits (~8 on opus) and ~60s, so allow skipping it when only the
  // gates changed:  npx tsx scripts/verify-phase2.ts --no-e2e
  if (process.argv.includes('--no-e2e')) {
    console.log(`\n[B] skipped (--no-e2e). ${failures === 0 ? '✅ Phase 2 gate verification PASSED' : `❌ FAILED (${failures})`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  const url = process.argv.find((a) => a.startsWith('http')) || 'https://en.wikipedia.org/wiki/Retrieval-augmented_generation';
  console.log(`\n[B] real end-to-end plan — ${url}`);
  const t0 = Date.now();
  const article = await ingestUrl(url);
  console.log(`     ingested: "${article.title}" — ${article.wordCount} words, ${article.assets.length} asset(s)`);
  const identity = await extractSiteIdentity(url);
  console.log(`     identity: accent=${identity.accent ?? '(none)'} fonts=${[identity.displayFont, identity.bodyFont].filter(Boolean).join('/') || '(none)'} warnings=${identity.warnings.length}`);

  const { planBrag } = await import('../src/lib/bragPlanner');
  const result = await planBrag(article, identity, { tone: 'polished', durationSeconds: 20, onProgress: (m) => console.log(`     · ${m}`) });

  const sum = result.plan.storyboard.reduce((s, sc) => s + sc.seconds, 0);
  console.log(`\n     model: ${result.model} (${Date.now() - t0}ms total)`);
  console.log(`     storyboard (${result.plan.storyboard.length} scenes, ${sum.toFixed(1)}s):`);
  for (const s of result.plan.storyboard) {
    console.log(`       ${s.seconds.toFixed(1)}s [${s.visualSource}${s.visualRef ? `:${s.visualRef}` : ''}] ${s.name} — ${s.text.join(' / ')}`);
  }

  check('plan passes every gate (end-to-end)', validateBragPlan(result.plan, { captures: [], article, tone: result.plan.tone.preset, format: 'vertical', durationSeconds: result.plan.durationSeconds }).length === 0);
  check('duration in the 15-25s window', sum >= 15 && sum <= 25, `${sum.toFixed(1)}s`);
  check('at least 2 key concepts named', result.plan.keyConcepts.length >= 2, result.plan.keyConcepts.join(', '));
  check('hook scene is <=3s', result.plan.storyboard[0].seconds <= 3.01, `${result.plan.storyboard[0].seconds}s`);
  check('no generic SaaS language', !/streamline|supercharge|unlock insights/i.test(JSON.stringify(result.plan)));
  check('no secret leaks', assertNoSecrets(result.plan).length === 0);
  check('tone was honoured', result.plan.tone.preset === 'polished', result.plan.tone.preset);
  check('format was forced to the request', result.plan.format?.name === 'vertical' && result.plan.format?.width === 1080, JSON.stringify(result.plan.format));

  console.log(`\n${failures === 0 ? '✅ Phase 2 verification PASSED' : `❌ Phase 2 verification FAILED (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ verification crashed:', err);
  process.exit(1);
});
