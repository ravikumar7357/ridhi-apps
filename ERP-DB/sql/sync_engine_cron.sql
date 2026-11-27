-- LIVE MIRROR · run the engine every 10 seconds inside the database (paste only after tools/sync-engine-proof.js says ALL PASS)
create extension if not exists pg_cron;
select cron.schedule('r1-sync-engine', '10 seconds', $$select core.sync_run(2000)$$);
select jobid, jobname, schedule, active from cron.job where jobname = 'r1-sync-engine';
