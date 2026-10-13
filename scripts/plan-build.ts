// Decides how this run builds: daily (homepage + newest two editions + any
// edition the deploy manifest does not list yet) or full. Falls back to full
// when there is no manifest or too many editions are missing.
//
// node --experimental-strip-types scripts/plan-build.ts --mode daily|full \
//   [--manifest .deploy/manifest.prev.json] [--out .deploy/plan.json]
//
// Logs the plan, writes it as JSON to --out, and in GitHub Actions appends
// BUILD_MODE and BUILD_DATES to $GITHUB_ENV for the following steps.
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createBuildClient } from '../src/lib/supabase.ts';
import { getAllDates } from '../src/lib/queries.ts';
import { parseManifest, planBuild } from '../src/lib/site-export.ts';

const { values } = parseArgs({ options: { mode: { type: 'string', default: 'daily' }, manifest: { type: 'string' }, out: { type: 'string' } } });
const requested = values.mode === 'full' ? 'full' : 'daily';

const manifestText = values.manifest
  ? await readFile(values.manifest, 'utf8').catch((error) => (error.code === 'ENOENT' ? null : Promise.reject(error)))
  : null;
const manifest = parseManifest(manifestText);

const plan = requested === 'full'
  ? planBuild('full', [], manifest)
  : planBuild('daily', await getAllDates(createBuildClient(process.env.SUPABASE_URL, process.env.SUPABASE_BUILD_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)), manifest);

console.log(`[plan] ${JSON.stringify(plan)}`);
if (values.out) await writeFile(values.out, JSON.stringify(plan));
if (process.env.GITHUB_ENV) {
  await appendFile(process.env.GITHUB_ENV, `BUILD_MODE=${plan.mode}\nBUILD_DATES=${plan.dates.join(',')}\n`);
}
