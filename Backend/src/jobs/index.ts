/* Every job roneGet can run, by name. Add one line per job as it moves from Apps Script; ROUTES.md tracks the rest.
 * The key is the name a task uses, and must equal the job's own name (a test checks this). */

import type { JobDef } from '../lib/tasks.ts';
import { heartbeat } from './heartbeat.ts';

export const JOBS: Record<string, JobDef> = {
  heartbeat,
};
