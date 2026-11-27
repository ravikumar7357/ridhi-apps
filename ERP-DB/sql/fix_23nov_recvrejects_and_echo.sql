-- RECORD OF TWO FIXES APPLIED BY CLAUDE ON 23 NOV (via the Supabase connector). Kept for the history; re-running is safe.
--
-- 1. pt_recvRejects WAS NOT A LIST THE SAVE ENGINE KNEW. A reject saved in the ERP (printer receive) would have stayed
--    "new" in the inbox for ever: not stored, not copied to Firebase, never mailed. No real reject had been saved since the
--    switch (only two capture tests). Fixed by adding it to core.sy_list as a plain list (core.sync_raw, depth 2, 'misc'),
--    the same way pt_orderAlerts is kept:
do $$
declare d text := pg_get_functiondef('core.sy_list(text)'::regprocedure);
        a text := $a$('pt_orderAlerts', 'core.sync_raw', 2, 1, array[]::text[], 'misc'),$a$;
begin
  if position('pt_recvRejects' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'marker not found — nothing changed'; end if;
  execute replace(d, a, a || E'\r\n    (''pt_recvRejects'', ''core.sync_raw'', 2, 1, array[]::text[], ''misc''),');
end $$;
--
-- 2. THE ECHO BUG of the way back (fixed in migration/firebase-capture/functions/index.js, pushBack, deployed 23 Nov ~15:45
--    IST): two saves of one record inside a minute → Firebase's capture reported the first write too, and it put the record
--    back to the older value. Four records were repaired from the users' own saves (inbox screen 'repair · echo fix 23 Nov'):
--    fs/audit/trends, fs/bsrweeks/__acts, fs/history/lsync_state, fs/repl/projoverride.
--
-- 3. THE OLD APPS SCRIPT "R-one checker" (nightly, ~2:50 AM) still copied Firebase INTO ERP data when they differed (4
--    records on 23 Nov). Since the switch ERP data is the master, so that is backwards: an older Firebase value could
--    overwrite a newer save. core.checker_list is now REPORT ONLY (it still logs what differs in core.checker_log):
do $$
declare d text := pg_get_functiondef('core.checker_list(text,jsonb,boolean)'::regprocedure);
        a text := E'begin\r\n  if auth.role() is distinct from ''service_role'' then raise exception ''checker_list: server only''; end if;';
begin
  if position('report only since the switch' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'marker not found — nothing changed'; end if;
  execute replace(d, a, E'begin\r\n  p_apply := false;   -- 23 Nov: report only since the switch (ERP data is the master; Firebase is the copy)\r\n  if auth.role() is distinct from ''service_role'' then raise exception ''checker_list: server only''; end if;');
end $$;
--
-- 4. (24 Nov, Ravi: "fabricrush inventory ... read and write from firebase ... dont save to supabase also") FabriCrush
--    Inventory is FIREBASE ONLY. core.fs_docs_put now ignores project 'fabricrush-inventory' (answers 0, keeps nothing), so
--    Pricing-API's double write (SbMirror.gs) and the old reader no longer copy it. Nothing in the ERP or Sellora read that copy
--    (ReplSnap reads the Inventory app's Firestore directly).
do $$
declare d text := pg_get_functiondef('core.fs_docs_put(text,jsonb)'::regprocedure);
        a text := 'if p_project not in (''price-research-48ff3'', ''fabricrush-inventory'') then raise exception';
begin
  if position('Firebase only (24 Nov)' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'marker not found — nothing changed'; end if;
  execute replace(d, a, 'if p_project = ''fabricrush-inventory'' then return 0; end if;   -- FabriCrush Inventory is Firebase only (24 Nov): nothing of it is kept here' || E'\n  ' || a);
end $$;
--
-- 5. (24 Nov) B2B IMAGES (b2bimg) were refused to everyone in ERP data — even the owner — because core.fs_can_rules was
--    generated before Firestore got its b2bimg rule. Added to core.fs_can, same as firestore.rules: read hasPerms() || isAdmin();
--    write isAdmin() || perms.replTabs has 'so'. Checked: every other Firestore collection in ERP data reads for the owner.
do $$
declare d text := pg_get_functiondef('core.fs_can(text,text,text,boolean)'::regprocedure);
        a text := E'  return core.fs_can_rules(p_email, p_coll, p_doc, p_write);\nend';
        b text := E'  if p_coll = ''b2bimg'' then   -- 24 Nov: B2B images had no rule here; Firestore: read hasPerms() || isAdmin(); write isAdmin() || replTabs has ''so''\n    if em is null then return false; end if;\n    fp := core.fs_value(''perms'', em);\n    if lower(em) = ''ravi@thefabricrush.com'' or coalesce(fp -> ''admin'' = ''true''::jsonb, false) then return true; end if;\n    if fp is null then return false; end if;\n    if not p_write then return true; end if;\n    return jsonb_typeof(fp -> ''replTabs'') = ''array'' and (fp -> ''replTabs'') ? ''so'';\n  end if;\n';
begin
  if position('if p_coll = ''b2bimg''' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'marker not found — nothing changed'; end if;
  execute replace(d, a, b || a);
end $$;
select core.sy_handles('pt_recvRejects/x') as recv_rejects_now_saved;
