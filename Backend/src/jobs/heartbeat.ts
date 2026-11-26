/* heartbeat — proves the whole "getting and filling" chain works before any real job moves:
 * timer → queue → roneGet → a row in backend.job_runs. It calls nobody and writes nothing else.
 *
 * If backend.job_runs stops showing "heartbeat" rows every 30 minutes, the timers or the queue are broken,
 * and every real job is broken with them. */

import type { JobDef } from '../lib/tasks.ts';

export const heartbeat: JobDef = {
  name: 'heartbeat',
  async run(_task, ctx) {
    return { rows: 0, details: { at: new Date(ctx.now()).toISOString() } };
  },
};
