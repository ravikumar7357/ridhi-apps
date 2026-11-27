-- APPLIED 23 Nov 2026 (10:25 IST) by Claude with the user's OK — kept here as the record. Re-running is safe.
-- The ERP's SKU picture cache (Firestore collection repl_skuimg, saved by the master database screen) had no rule in
-- firestore.rules nor in ERP data's copy of them, so every read and save of it was refused. It now follows the
-- replenishment rule (repl), and master-database editors (pt_perms r.mdbEdit) may save it too.
-- Still to do in Firebase itself: add the same rule to Pricing-App/firestore.rules (match /repl_skuimg/{doc}).

do $do$
begin
  if to_regprocedure('core.fs_can_rules(text,text,text,boolean)') is null then
    alter function core.fs_can(text, text, text, boolean) rename to fs_can_rules;
  end if;
end $do$;

create or replace function core.fs_can(p_email text, p_coll text, p_doc text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = core, public as $$
declare em text := nullif(trim(p_email), '');
begin
  if p_coll = 'repl_skuimg' then
    if em is null then return false; end if;
    if core.fs_can_rules(em, 'repl', 'skuimg', p_write) then return true; end if;
    return coalesce((core.rt_value('pt_perms/' || regexp_replace(lower(em), '\.', ',', 'g')) #> '{r,mdbEdit}') = 'true'::jsonb, false);
  end if;
  return core.fs_can_rules(p_email, p_coll, p_doc, p_write);
end $$;
revoke all on function core.fs_can(text, text, text, boolean) from public, anon;
grant execute on function core.fs_can(text, text, text, boolean) to authenticated, service_role;
notify pgrst, 'reload schema';
