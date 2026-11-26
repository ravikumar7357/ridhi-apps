-- R-one backend: what the Amazon gateway needs in Supabase. Run after backend_core.sql. All tiny tables.
-- Only the backend's secret key reads or writes them (RLS on, no policies).

-- 1. The switches (src/lib/controls.ts). Changed here, no deploy needed.
create table if not exists backend.controls (
  key        text primary key,
  value      jsonb not null,
  note       text,
  updated_at timestamptz not null default now()
);
alter table backend.controls enable row level security;

insert into backend.controls (key, value, note) values
  ('pause_all', 'false', 'true = this backend makes no Amazon call at all'),
  ('share',     '0.5',   'part of Amazon''s limits this backend may use; 0.5 while Apps Script also calls Amazon, 1 when it is at zero'),
  ('owner:ads-live',          '"apps-script"', 'who asks Amazon for this data: "apps-script" or "backend". One owner at a time.'),
  ('owner:ads-nightly',       '"apps-script"', null),
  ('owner:sales-live',        '"apps-script"', null),
  ('owner:orders-report',     '"apps-script"', null),
  ('owner:sales-traffic',     '"apps-script"', null),
  ('owner:fba-inventory',     '"apps-script"', null),
  ('owner:inbound-shipments', '"apps-script"', null),
  ('owner:listings',          '"apps-script"', null),
  ('owner:inventory-age',     '"apps-script"', null),
  ('owner:brand-analytics',   '"apps-script"', null),
  ('owner:catalog',           '"apps-script"', null),
  ('owner:pricing',           '"apps-script"', null),
  ('owner:listing-writes',    '"apps-script"', null),
  ('owner:mcf',               '"apps-script"', null)
on conflict (key) do nothing;

-- 2. The speed limit, shared by every running copy of the backend (src/lib/limiter.ts DbLimiter).
create table if not exists backend.rate_buckets (
  key        text primary key,            -- '<brand>:<call>', e.g. 'SP:reports.createReport'
  tokens     double precision not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table backend.rate_buckets enable row level security;

-- Take one token. Answers 0 = go now, or the milliseconds until a token is there.
create or replace function backend.take_token(p_key text, p_rate double precision, p_burst double precision)
returns integer language plpgsql security definer set search_path = backend as $$
declare
  b backend.rate_buckets;
  t timestamptz := clock_timestamp();
  have double precision;
begin
  insert into backend.rate_buckets (key, tokens, updated_at) values (p_key, p_burst, t) on conflict (key) do nothing;
  select * into b from backend.rate_buckets where key = p_key for update;
  have := least(p_burst, b.tokens + extract(epoch from (t - b.updated_at)) * p_rate);
  if have >= 1 then
    update backend.rate_buckets set tokens = have - 1, updated_at = t where key = p_key;
    return 0;
  end if;
  update backend.rate_buckets set tokens = have, updated_at = t where key = p_key;
  return ceil((1 - have) / p_rate * 1000)::int;
end $$;

-- 3. Every Amazon call, counted per minute (src/lib/gateway.ts flush). Outcomes: ok, throttled (Amazon said 429),
--    error, deferred (our own limit said wait), refused (paused, or the data is not ours).
create table if not exists backend.amazon_calls (
  minute  timestamptz not null,
  brand   text not null,
  op      text not null,
  outcome text not null,
  n       integer not null default 0,
  primary key (minute, brand, op, outcome)
);
alter table backend.amazon_calls enable row level security;

create or replace function backend.count_calls(p_rows jsonb) returns void
language sql security definer set search_path = backend as $$
  insert into backend.amazon_calls (minute, brand, op, outcome, n)
  select date_trunc('minute', now()), r->>'brand', r->>'op', r->>'outcome', (r->>'n')::int
  from jsonb_array_elements(p_rows) r
  on conflict (minute, brand, op, outcome) do update set n = backend.amazon_calls.n + excluded.n;
$$;

-- The morning check: today's calls, and how many Amazon throttled.
create or replace view backend.amazon_calls_today as
  select brand, op,
         sum(n) filter (where outcome = 'ok')        as ok,
         sum(n) filter (where outcome = 'throttled') as throttled,
         sum(n) filter (where outcome = 'error')     as errors,
         sum(n) filter (where outcome = 'deferred')  as deferred,
         sum(n) filter (where outcome = 'refused')   as refused
  from backend.amazon_calls where minute >= date_trunc('day', now())
  group by brand, op order by brand, op;

grant all on all tables in schema backend to service_role;
grant execute on function backend.take_token(text, double precision, double precision) to service_role;
grant execute on function backend.count_calls(jsonb) to service_role;
revoke execute on function backend.take_token(text, double precision, double precision) from public, anon, authenticated;
revoke execute on function backend.count_calls(jsonb) from public, anon, authenticated;
