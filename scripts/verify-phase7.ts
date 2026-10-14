/**
 * Phase 7 verification — the YouTube publisher.
 *
 * Free by default: it validates metadata rules, exercises the REAL refresh-token exchange against
 * Google (which proves the stored credentials work) and runs the upload pre-flight, but never
 * consumes upload quota. Pass `--upload` to perform an actual upload (see the warning below).
 *
 * Why the split matters: `videos.insert` is expensive against quota (commonly documented at 1,600
 * units of a default 10,000/day → ~6 uploads per day), so the default path must not spend it.
 *
 * Run: npx tsx scripts/verify-phase7.ts [--upload] [--privacy unlisted]
 */
import 'dotenv/config';
import fs from 'fs';
import { validateMetadata, buildMetadata, getAccessToken, uploadVideo, type VideoMetadata } from '../src/lib/youtubePublisher';
import { loadOmnicastConfig } from '../src/lib/runtimeConfig';
import { listRuns } from '../src/omnicast';
import type { BragPlan } from '../src/types/brag';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const baseMeta = (over?: Partial<VideoMetadata>): VideoMetadata => ({
  title: 'Retrieval-augmented generation, explained in 18 seconds',
  description: 'What RAG actually does, in 18 seconds.',
  tags: ['ai', 'rag', 'explainers'],
  categoryId: '28',
  privacyStatus: 'unlisted',
  madeForKids: false,
  ...over,
});

/** A plan shaped like the real thing, for the metadata builder. */
const plan = (): BragPlan =>
  ({
    appName: 'Retrieval-augmented generation',
    whatIsThisApp: 'A technique that grounds a language model in retrieved documents.',
    angle: 'Retrieval before generation.',
    hook: 'The model was confident. It was also wrong.',
    keyMoments: ['Retrieval happens first'],
    keyConcepts: ['retrieval before generation', 'embeddings and vector databases', 'grounded answers with verifiable sources'],
    outro: 'Retrieval-augmented generation.',
    userFlow: [],
    notes: null,
    tone: { preset: 'polished', direction: '', interpretation: '' },
    durationSeconds: 18,
    visualIdentity: { background: '#000', accent: '#f60', text: '#fff', displayFont: 'Outfit', bodyFont: 'Inter', strongestVisualElement: 'diagram' },
    shareCopy: 'Before it answers, it reads.',
    youtube: {
      title: 'RAG: retrieval before generation',
      description: 'Why the model reads before it answers, and what that changes.',
      tags: ['rag', 'llm', 'ai explained'],
    },
    audio: { role: 'warm bed', musicMood: 'warm', sfxPosture: 'sparse', restraintRule: '' },
    storyboard: [
      { name: 'Hook', seconds: 3, onScreen: 'x', text: ['The model was confident.'], visualSource: 'typographic', transitionMood: 'hard', visualRef: null, sequential: null, interaction: null, revealHoldSeconds: null, sfxMoment: null },
      { name: 'Reveal', seconds: 5, onScreen: 'x', text: ['It was also wrong.'], visualSource: 'typographic', transitionMood: 'clean', visualRef: null, sequential: null, interaction: null, revealHoldSeconds: null, sfxMoment: null },
      { name: 'Concept', seconds: 5, onScreen: 'x', text: ['Retrieval before generation'], visualSource: 'typographic', transitionMood: 'clean', visualRef: null, sequential: null, interaction: null, revealHoldSeconds: null, sfxMoment: null },
      { name: 'Outro', seconds: 5, onScreen: 'x', text: ['Retrieval-augmented generation.'], visualSource: 'typographic', transitionMood: 'soft', visualRef: null, sequential: null, interaction: null, revealHoldSeconds: null, sfxMoment: null },
    ],
  }) as BragPlan;

async function main(): Promise<void> {
  const cfg = loadOmnicastConfig();

  // ── 1. metadata validation must reject what the API would reject ──────────
  console.log('\n[1] pre-flight validation (free)');
  check('a clean metadata set passes', validateMetadata(baseMeta()).length === 0, validateMetadata(baseMeta()).join(' | '));
  check('an over-long title is rejected', validateMetadata(baseMeta({ title: 'x'.repeat(101) })).some((p) => /limit is 100/.test(p)));
  check('a title exactly at the limit passes', validateMetadata(baseMeta({ title: 'x'.repeat(100) })).length === 0);
  check('angle brackets in the title are rejected', validateMetadata(baseMeta({ title: 'a <b> c' })).some((p) => /may not contain/.test(p)));
  check('angle brackets in a tag are rejected', validateMetadata(baseMeta({ tags: ['<b>'] })).some((p) => /contains "<"/.test(p)));
  check('a comma inside a tag is rejected', validateMetadata(baseMeta({ tags: ['a,b'] })).some((p) => /comma/.test(p)));
  check('an over-long tag is rejected', validateMetadata(baseMeta({ tags: ['y'.repeat(101)] })).some((p) => /exceeds 100/.test(p)));
  check('an over-budget tag set is rejected', validateMetadata(baseMeta({ tags: Array.from({ length: 20 }, () => 'z'.repeat(40)) })).some((p) => /tags total/.test(p)));
  check('a non-numeric category is rejected', validateMetadata(baseMeta({ categoryId: 'Science' })).some((p) => /must be numeric/.test(p)));
  check('an empty title is rejected', validateMetadata(baseMeta({ title: '' })).some((p) => /empty/.test(p)));

  // ── 2. metadata builder honours limits and Shorts conventions ────────────
  console.log('\n[2] metadata building (free)');
  const vertical = buildMetadata({ plan: plan(), privacy: 'unlisted', categoryId: '28', madeForKids: false, defaultTags: ['automation'], isVertical: true, durationSeconds: 18, sourceUrl: 'https://example.com/a' });
  check('plan title is used', vertical.title.startsWith('RAG: retrieval before generation'), vertical.title);
  check('#Shorts is appended for a vertical short', /#shorts/i.test(vertical.title), vertical.title);
  check('title stays within 100 characters', [...vertical.title].length <= 100, `${[...vertical.title].length} chars`);
  check('tags are deduped case-insensitively', new Set(vertical.tags.map((t) => t.toLowerCase())).size === vertical.tags.length, vertical.tags.join(', '));
  check('tags fit the 500-char budget', vertical.tags.reduce((n, t) => n + [...t].length, 0) <= 500);
  check('the source URL is credited in the description', vertical.description.includes('https://example.com/a'));
  check('privacy is passed through explicitly', vertical.privacyStatus === 'unlisted');

  const landscape = buildMetadata({ plan: plan(), privacy: 'private', categoryId: '28', madeForKids: false, isVertical: false, durationSeconds: 18 });
  check('no #Shorts on a landscape render', !/#shorts/i.test(landscape.title));
  // A plan title over the limit must be clamped AND reported — never passed through to fail at the
  // API (which would waste a render and a quota unit), and never shortened silently.
  const longTitlePlan = plan();
  longTitlePlan.youtube.title = 'q'.repeat(140);
  const longTitleMeta = buildMetadata({
    plan: longTitlePlan,
    privacy: 'unlisted',
    categoryId: '28',
    madeForKids: false,
    isVertical: true,
    durationSeconds: 18,
  });
  check('an over-long plan title is clamped below the limit', [...longTitleMeta.title].length <= 100, `${[...longTitleMeta.title].length} chars`);
  check('the clamp is reported, not silent', longTitleMeta.warnings.some((w) => /truncated/.test(w)), longTitleMeta.warnings.join(' | '));
  check('the #Shorts suffix survives the clamp', /#shorts/i.test(longTitleMeta.title), longTitleMeta.title.slice(-20));

  // ── 3. missing credentials must name the problem ─────────────────────────
  console.log('\n[3] credential errors (free)');
  let credErr = '';
  try {
    await getAccessToken({ clientId: '', clientSecret: '', refreshToken: '' });
  } catch (e) {
    credErr = (e as Error).message;
  }
  check('missing credentials produce a clear, actionable error', /Missing clientId/.test(credErr) && /youtube:auth/.test(credErr), credErr.split('\n')[0]);

  // ── 4. REAL token exchange — proves the stored refresh token works ───────
  console.log('\n[4] live OAuth token exchange (free, no quota)');
  check('client id + secret + refresh token are configured', Boolean(cfg.youtube.clientId && cfg.youtube.clientSecret && cfg.youtube.refreshToken));
  let accessToken = '';
  try {
    accessToken = await getAccessToken({
      clientId: cfg.youtube.clientId,
      clientSecret: cfg.youtube.clientSecret,
      refreshToken: cfg.youtube.refreshToken,
    });
    check('refresh token exchanged for an access token', accessToken.length > 20, `${accessToken.length} chars`);
  } catch (e) {
    check('refresh token exchanged for an access token', false, (e as Error).message.split('\n')[0]);
  }

  // ── 5. upload pre-flight against the real rendered video ─────────────────
  console.log('\n[5] upload pre-flight (free, no quota)');
  const done = listRuns(20).find((r) => r.status === 'done' && r.videoPath && fs.existsSync(r.videoPath));
  if (!done) {
    check('a rendered run exists to publish', false, 'run `npm run omnicast -- --url <url>` first');
  } else {
    console.log(`     using run ${done.runId}: ${done.videoPath}`);
    const meta = buildMetadata({
      plan: done.plan ?? plan(),
      privacy: 'unlisted',
      categoryId: cfg.youtube.categoryId,
      madeForKids: cfg.youtube.madeForKids,
      defaultTags: cfg.youtube.defaultTags,
      isVertical: done.format === 'vertical',
      durationSeconds: done.durationSeconds,
      sourceUrl: done.url,
    });
    try {
      const dry = await uploadVideo({
        videoPath: done.videoPath!,
        metadata: meta,
        creds: { clientId: cfg.youtube.clientId, clientSecret: cfg.youtube.clientSecret, refreshToken: cfg.youtube.refreshToken },
        thumbnailPath: done.posterPath,
        dryRun: true,
        onProgress: (m) => console.log(`     · ${m}`),
      });
      check('dry-run pre-flight succeeds', dry.warnings.some((w) => /DRY RUN/.test(w)), dry.videoId);
      check('dry-run reports the Short treatment for a vertical render', dry.isShort === (done.format === 'vertical'), `isShort=${dry.isShort}`);
      check('dry-run used no quota (no video id returned)', dry.videoId === '(dry-run)');
    } catch (e) {
      check('dry-run pre-flight succeeds', false, (e as Error).message.split('\n')[0]);
    }
  }

  // ── 6. real upload (opt-in) ──────────────────────────────────────────────
  const wantUpload = process.argv.includes('--upload');
  const privacyArg = process.argv[process.argv.indexOf('--privacy') + 1];
  if (!wantUpload) {
    console.log('\n[6] skipped — pass --upload to publish for real (costs ~1,600 quota units ≈ 1/6 of a day)');
  } else if (!done?.videoPath) {
    check('upload performed', false, 'no rendered video to upload');
  } else {
    console.log('\n[6] REAL UPLOAD — consuming quota');
    const meta = buildMetadata({
      plan: done.plan ?? plan(),
      privacy: (privacyArg === 'public' || privacyArg === 'private' ? privacyArg : 'unlisted') as VideoMetadata['privacyStatus'],
      categoryId: cfg.youtube.categoryId,
      madeForKids: cfg.youtube.madeForKids,
      defaultTags: cfg.youtube.defaultTags,
      isVertical: done.format === 'vertical',
      durationSeconds: done.durationSeconds,
      sourceUrl: done.url,
    });
    try {
      const result = await uploadVideo({
        videoPath: done.videoPath,
        metadata: meta,
        creds: { clientId: cfg.youtube.clientId, clientSecret: cfg.youtube.clientSecret, refreshToken: cfg.youtube.refreshToken },
        thumbnailPath: done.posterPath,
        onProgress: (m) => console.log(`     · ${m}`),
      });
      console.log(`     → ${result.watchUrl}`);
      check('upload returned a video id', /^[\w-]{6,}$/.test(result.videoId), result.videoId);
      check('read-back confirms the title', result.verified.title === meta.title, `"${result.verified.title}"`);
      check('read-back confirms the privacy', result.verified.privacyStatus === meta.privacyStatus, result.verified.privacyStatus);
      check('thumbnail was set', result.thumbnailSet, result.warnings.filter((w) => /humbnail/.test(w)).join(' | ') || 'ok');
      if (result.warnings.length) console.log(`     warnings: ${result.warnings.join(' | ')}`);
      console.log(`\n     ⚠️  Delete it when finished: https://studio.youtube.com/video/${result.videoId}/edit`);
    } catch (e) {
      check('upload performed', false, (e as Error).message.split('\n')[0]);
    }
  }

  console.log(`\n${failures === 0 ? '✅ Phase 7 verification PASSED' : `❌ Phase 7 verification FAILED (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ verification crashed:', err);
  process.exit(1);
});
