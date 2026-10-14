// Decides which editions this run builds.
//
//   daily: the newest edition and the one before it (two small queries), plus
//          backfill dates when asked for. Never turns into a full build.
//   full:  every edition (Astro reads them itself).
//
// node --experimental-strip-types scripts/plan-build.ts --mode daily|full \
//   [--backfill "" | missing | 2026-10-01,2026-10-02] [--inventory .deploy/remote.json] [--out .deploy/plan.json]
//
// --backfill missing compares every database edition with the bucket
// inventory: the only daily option that reads all edition dates.
// Writes the plan as JSON to --out and, in GitHub Actions, BUILD_MODE and
// BUILD_DATES to $GITHUB_ENV for the following steps.
import { appendFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createBuildClient } from '../src/lib/supabase.ts';
import { getAllDates, getLatestDate, getNeighborDates } from '../src/lib/queries.ts';
import { editionKey, missingEditions, planDaily, type BuildPlan } from '../src/lib/site-export.ts';
import { readInventory } from './lib/inventory.mjs';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'daily' },
    backfill: { type: 'string', default: '' },
    inventory: { type: 'string' },
    out: { type: 'string' },
  },
});

function warn(message: string) {
  console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `[plan] warning: ${message}`);
}

let plan: BuildPlan;
if (values.mode === 'full') {
  plan = { mode: 'full', dates: [], reason: 'full build requested' };
} else {
  const db = createBuildClient(process.env.SUPABASE_URL, process.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const latest = await getLatestDate(db);
  const { prev } = latest ? await getNeighborDates(db, latest) : { prev: null };
  const inventory = values.inventory ? await readInventory(values.inventory) : null;
  const keys = new Set(inventory?.keys() ?? []);

  let backfill: string[] = [];
  const request = values.backfill.trim();
  if (request === 'missing') {
    if (!inventory) throw new Error('--backfill missing needs --inventory');
    backfill = missingEditions(await getAllDates(db), keys);
    console.log(`[plan] editions in the database but not on OSS: ${backfill.length ? backfill.join(', ') : 'none'}`);
  } else if (request) {
    backfill = request.split(',').map((d) => d.trim()).filter(Boolean);
  }
  plan = planDaily(latest, prev, backfill);

  // The page before yesterday's links to it as 上一期's target: say so if it is missing.
  if (inventory && prev && !request) {
    const { prev: before } = await getNeighborDates(db, prev);
    if (before && !keys.has(editionKey(before))) {
      warn(`edition ${before} is not on OSS; run the daily workflow with backfill "missing" to restore it`);
    }
  }
}

console.log(`[plan] ${JSON.stringify(plan)}`);
if (values.out) await writeFile(values.out, JSON.stringify(plan));
if (process.env.GITHUB_ENV) {
  await appendFile(process.env.GITHUB_ENV, `BUILD_MODE=${plan.mode}\nBUILD_DATES=${plan.dates.join(',')}\n`);
}
