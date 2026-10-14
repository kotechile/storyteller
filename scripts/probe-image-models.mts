/**
 * Probes the kie.ai image-model contract for the two models the Storyteller pipeline routes to.
 *
 * Lesson this encodes (from the kie.ai Claude integration): a written plan asserted the path, the
 * auth header and the success check and was wrong on all three. Probe the contract live instead of
 * coding to a remembered shape.
 *
 * What it does, per model:
 *   1. resolves it through the same Supabase role the pipeline uses (free)
 *   2. submits ONE tiny task with the EXACT payload `generateKieImage()` sends (costs credits)
 *   3. prints the raw submit + poll bodies, and the resulting image URL
 *
 * Run (resolution only, free):   npx tsx scripts/probe-image-models.mts
 * Run (real generation):         npx tsx scripts/probe-image-models.mts --run
 */
import 'dotenv/config';
import { resolveImageModel } from '../src/lib/supabaseClient';

const RUN = process.argv.includes('--run');
const BASE = 'https://api.kie.ai';

type Probe = { role: string; label: string; prompt: string };

const PROBES: Probe[] = [
  {
    role: 'image_infographic',
    label: 'nano-banana-pro (infographics/diagrams/text)',
    prompt: 'A single labeled blue box on white with the word TEST, clean infographic, no other text',
  },
  {
    role: 'image_realistic',
    label: 'flux-2/pro-text-to-image (photographic)',
    prompt: 'Photograph of one empty wooden table in soft window light, no people, no text',
  },
];

async function submitAndPoll(modelName: string, apiKey: string, prompt: string): Promise<void> {
  // Exactly the payload shape generateKieImage() builds — including the empty image_input array.
  const body = {
    model: modelName,
    input: {
      prompt,
      image_input: [] as string[],
      aspect_ratio: '16:9',
      resolution: '1K', // cheapest
      output_format: 'png',
    },
  };

  console.log(`[probe] POST ${BASE}/api/v1/jobs/createTask  model=${modelName}`);
  console.log(`[probe] payload: ${JSON.stringify(body)}`);
  const submit = await fetch(`${BASE}/api/v1/jobs/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const submitText = await submit.text();
  console.log(`[probe] submit HTTP ${submit.status}: ${submitText.substring(0, 600)}`);

  let taskId: string | undefined;
  try {
    taskId = JSON.parse(submitText)?.data?.taskId;
  } catch { /* handled below */ }
  if (!taskId) {
    console.log('[probe] ❌ no taskId — the payload or model id is wrong for this endpoint.');
    return;
  }

  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await fetch(`${BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!poll.ok) continue;
    const data: any = await poll.json().catch(() => null);
    if (!data) continue;
    const state = String(data?.data?.state || '').toLowerCase();
    if (attempt % 6 === 0) console.log(`[probe] poll ${attempt}: state=${state}`);
    if (state === 'success') {
      const d = data.data || {};
      let url: string | undefined =
        d.url || d.imageUrl || d.image_url || d.output?.imageUrl;
      if (!url && d.resultJson) {
        try {
          const parsed = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson;
          url = parsed?.resultUrls?.[0] || parsed?.imageUrls?.[0] || parsed?.images?.[0]?.url || parsed?.url;
        } catch { /* ignore */ }
      }
      console.log(`[probe] ✅ success — credits=${d.creditsConsumed ?? 'n/a'} costTime=${d.costTime ?? 'n/a'}`);
      console.log(`[probe]    keys: ${Object.keys(d).join(', ')}`);
      console.log(`[probe]    image: ${url ?? '(NO URL — the parser misses this response shape)'}`);
      return;
    }
    if (state === 'failed' || state === 'error') {
      console.log(`[probe] ❌ task failed: ${JSON.stringify(data.data).substring(0, 600)}`);
      return;
    }
  }
  console.log('[probe] ❌ timed out after 5 min of polling');
}

async function main(): Promise<void> {
  for (const probe of PROBES) {
    console.log(`\n=== ${probe.label}  [role: ${probe.role}] ===`);
    const cfg = await resolveImageModel(undefined, probe.role);
    console.log(`[probe] resolved: model="${cfg.modelName}" provider="${cfg.provider}" key=${cfg.apiKey ? 'PRESENT' : 'MISSING'}`);
    if (!cfg.apiKey) {
      console.log('[probe] ❌ no api key resolved — nothing to call.');
      continue;
    }
    if (!RUN) {
      console.log('[probe] (resolution only — pass --run to submit a real task)');
      continue;
    }
    await submitAndPoll(cfg.modelName, cfg.apiKey, probe.prompt);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
