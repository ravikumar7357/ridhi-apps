-- =====================================================================================
-- FIREBASE → SUPABASE · STEP 1 · A HOLDING TABLE FOR AN EXACT COPY OF FIREBASE
-- Every Realtime Database record and every Firestore document goes in here exactly as it is (as JSON),
-- loaded from the nightly backup files. Nothing is changed or cleaned here — that comes later, module by module.
-- Browsers can NOT read these tables (no access for anon / signed-in users); only the loader with the service key.
-- Supabase → SQL Editor → paste this WHOLE file → Run. Safe to run again. Changes nothing that already exists.
-- =====================================================================================

create table if not exists public.fb_raw (
  source      text   not null check (source in ('rtdb', 'firestore')),
  node        text   not null,              -- RTDB register (pt_masterDB …) or Firestore collection (po, perms …)
  key         text   not null,              -- record key; nested registers use "parent/child" (e.g. VND001/vpo_…)
  data        jsonb,                        -- the record exactly as Firebase had it (Firestore values decoded to plain JSON)
  bytes       integer not null default 0,   -- size of the record as JSON
  backup_day  text   not null,              -- which nightly backup it came from (e.g. 2026-11-06)
  loaded_at   timestamptz not null default now(),
  primary key (source, node, key)
);
create index if not exists fb_raw_node_idx on public.fb_raw (source, node);
create index if not exists fb_raw_day_idx  on public.fb_raw (backup_day);

-- one row per register / collection per load: what the backup said vs what landed
create table if not exists public.fb_raw_loads (
  id               bigserial primary key,
  backup_day       text not null,
  source           text not null,
  node             text not null,
  expected_entries integer,                 -- from the backup's manifest.json
  expected_bytes   bigint,
  loaded_rows      integer not null,
  loaded_bytes     bigint  not null,
  removed_rows     integer not null default 0,  -- rows that were gone from Firebase since the last load
  ok               boolean not null,
  note             text,
  at               timestamptz not null default now()
);

-- locked: no browser access at all (the service key used by the loader bypasses this)
alter table public.fb_raw       enable row level security;
alter table public.fb_raw_loads enable row level security;
revoke all on public.fb_raw, public.fb_raw_loads from anon, authenticated;
revoke all on sequence public.fb_raw_loads_id_seq from anon, authenticated;

-- quick look after a load (run on its own):
-- select source, node, count(*) as rows, pg_size_pretty(sum(bytes)::bigint) as size
--   from public.fb_raw group by 1, 2 order by sum(bytes) desc;
