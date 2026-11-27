-- THE NIGHTLY CHECK CAN READ THE AUDIT LOG (20 Nov). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- The full check reads the audit log one month at a time with the SERVER key; a big month (8–10 MB) takes longer than that
-- key's time limit (8 s), so the audit was never compared. This gives ONLY the server key 2 minutes per request — it is used by
-- the server jobs (the full check, the way back, the capture), never by a screen. People's sign-ins keep their limits.

alter role service_role set statement_timeout = '120s';
notify pgrst, 'reload config';

select case when exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                          where r.rolname = 'service_role' and 'statement_timeout=120s' = any(s.setconfig))
            then 'PASS — server jobs may take up to 2 minutes per request (screens unchanged)' else 'FAIL' end as result;
