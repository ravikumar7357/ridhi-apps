-- FIX: SELLORA SAVES THAT NEVER LANDED (18 Nov UAT). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- What was wrong: the engine applies a Firestore save only when its collection is one the engine has a table for
-- (po, packlist, repl_india, bsrweeks, weeklyrows …, core.sy_list). A save to ANY OTHER collection — e.g. Sellora's Health
-- screen (fs/health, fs/healthrows) — stayed in the inbox as "new" for ever, so on the test link the save did not stick.
-- Found: 14 such saves waiting since 16 Nov.
--
-- Now: a Firestore save whose collection the engine does not handle is written straight into ERP data's Firestore copy
-- (core.fs_docs — what Sellora reads), in order: a put replaces the document, a patch sets one field (deep), a delete removes
-- the document or the field. The inbox row is then marked done ("firestore direct"). Every minute, and at once after a save.

-- set a value deep inside JSON, making the missing levels (null value = remove that field)
create or replace function core.jsonb_set_deep(t jsonb, p text[], v jsonb) returns jsonb language plpgsql immutable as $$
declare head text; cur jsonb;
begin
  if coalesce(array_length(p, 1), 0) = 0 then return v; end if;
  t := case when jsonb_typeof(t) = 'object' then t else '{}'::jsonb end;
  head := p[1];
  if array_length(p, 1) = 1 then
    if v is null or v = 'null'::jsonb then return t - head; end if;
    return jsonb_set(t, array[head], v, true);
  end if;
  cur := core.jsonb_set_deep(t -> head, p[2:], v);
  if cur is null or cur = '{}'::jsonb then return t - head; end if;
  return jsonb_set(t, array[head], cur, true);
end $$;

create or replace function core.fs_direct_apply(p_max int default 500) returns int
language plpgsql security definer set search_path = core, public as $$
declare r record; segs text[]; v_coll text; v_doc text; rest text[]; cur jsonb; nxt jsonb; n int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('fs_direct_apply')) then return 0; end if;
  for r in select i.id, i.kind, i.path, i.value, i.saved_at from core.sync_inbox i
            where i.status = 'new' and i.path like 'fs/%'
              and not exists (select 1 from core.sy_list(i.path))
            order by i.id limit p_max loop
    segs := string_to_array(trim(both '/' from r.path), '/');
    if coalesce(array_length(segs, 1), 0) < 3 then
      update core.sync_inbox set status = 'failed', error = 'firestore direct: a whole collection is not saved this way', done_at = now() where id = r.id;
      continue;
    end if;
    v_coll := segs[2]; v_doc := segs[3]; rest := segs[4:];
    select d.value into cur from core.fs_docs d where d.project = 'price-research-48ff3' and d.path = v_coll || '/' || v_doc and d.gone_at is null;
    if coalesce(array_length(rest, 1), 0) = 0 then
      if r.kind = 'delete' then nxt := null;
      elsif r.kind = 'patch' and jsonb_typeof(r.value) = 'object' then nxt := coalesce(cur, '{}'::jsonb) || r.value;   -- Firebase "update" at the document
      else nxt := r.value; end if;
    else
      nxt := core.jsonb_set_deep(cur, rest, case when r.kind = 'delete' then null else r.value end);
    end if;
    if nxt is null then
      perform core.fs_docs_put('price-research-48ff3', jsonb_build_array(jsonb_build_object('k', 'delete', 'p', v_coll || '/' || v_doc)));
    else
      perform core.fs_docs_put('price-research-48ff3', jsonb_build_array(jsonb_build_object('k', 'put', 'p', v_coll || '/' || v_doc, 'v', nxt,
                                                                         't', coalesce(r.saved_at, now()))));
    end if;
    update core.sync_inbox set status = 'done', section = 'firestore direct', error = null, done_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function core.fs_direct_apply(int) from public, anon, authenticated;

-- every minute (and the 14 waiting since 16 Nov at once, below)
select cron.unschedule(jobid) from cron.job where jobname = 'r1-fs-direct';
select cron.schedule('r1-fs-direct', '* * * * *', 'select core.fs_direct_apply(500)');

-- self-test of the deep set (no data touched)
do $$
begin
  if core.jsonb_set_deep('{"a":{"b":1}}', array['a','c','d'], '2') <> '{"a":{"b":1,"c":{"d":2}}}'::jsonb then raise exception 'jsonb_set_deep: set'; end if;
  if core.jsonb_set_deep('{"a":{"b":1,"c":2}}', array['a','b'], null) <> '{"a":{"c":2}}'::jsonb then raise exception 'jsonb_set_deep: remove'; end if;
end $$;

select core.fs_direct_apply(500) as waiting_saves_applied_now;

select case when (select count(*) from core.sync_inbox i where i.status = 'new' and i.path like 'fs/%' and not exists (select 1 from core.sy_list(i.path))) = 0
             and exists (select 1 from cron.job where jobname = 'r1-fs-direct')
            then 'PASS — Firestore saves of every collection now land (the waiting ones too)'
            else 'FAIL' end as result;
