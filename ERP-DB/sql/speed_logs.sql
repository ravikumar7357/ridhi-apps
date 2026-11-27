-- READ-ONLY: ERP data's own record of where its time goes (the "logs"). Paste into ERP data → Run → send all result tables.

-- 1 · the 15 queries that cost the most time in total (pg_stat_statements is on by default in Supabase)
select calls, round(total_exec_time) as total_ms, round(mean_exec_time) as avg_ms, round(max_exec_time) as max_ms, rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 110) as query
from extensions.pg_stat_statements
order by total_exec_time desc
limit 15;
