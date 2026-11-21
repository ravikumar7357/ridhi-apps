/* Sellora's backend on Firebase (project price-research-48ff3, codebase "sellora-live").
 *
 *   selloraLiveTick   every 10 minutes: Amazon sales + ads, Shopify, Meta → Supabase schema "sellora" (see tick.ts).
 *                     Runs in us-central1, beside Amazon's US servers. One at a time (maxInstances 1).
 *
 * To run it by hand (a test): Google Cloud console → Cloud Scheduler → firebase-schedule-selloraLiveTick-… → Force run.
 * What each run did: sellora.fetch_runs in Supabase, and the function's logs in the Firebase console. */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { SECRET_NAMES, SUPABASE_URL, processEnv } from './config.ts';
import { Db } from './supabase.ts';
import { runTick } from './tick.ts';

const secrets = SECRET_NAMES.map(n => defineSecret(n));

export const selloraLiveTick = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'America/Los_Angeles',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 1,
    retryCount: 0,
    secrets,
  },
  async () => {
    const key = processEnv('SUPABASE_SECRET_KEY');
    if (!key) throw new Error('SUPABASE_SECRET_KEY is not set');
    const db = new Db(process.env.SUPABASE_URL || SUPABASE_URL, key);
    const out = await runTick(db, processEnv);
    const bad = out.filter(r => !r.ok);
    logger.info('sellora live tick', { steps: out.length, failed: bad.length, results: out.map(r => ({ job: r.job, brand: r.brand, ok: r.ok, rows: r.rows, ms: r.ms, error: r.error })) });
    if (bad.length) logger.warn('sellora live tick: some steps failed', bad.map(r => `${r.job}${r.brand ? ':' + r.brand : ''} — ${r.error}`));
  },
);
