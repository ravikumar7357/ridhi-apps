-- FIX: JOB-WORK CORRECTIONS "CLOSED" (20 Nov UAT). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- The live ERP now closes a job-work correction request with status "closed" ("the entry had moved on, so it was left as
-- it was"). The engine only knew pending / approved / rejected / withdrawn, so every closed request was refused
-- ("cannot place pt_jwCorrReqs/…: status closed") and ERP data kept showing them as pending — 27 requests on 20 Nov.
-- Now: a closed job-work correction is stored as REJECTED (nothing was changed), the word "closed" kept in old_status
-- exactly as Firebase wrote it, answered at answeredAt (or closedAt). The same way FGI corrections already handle "closed".
-- Only the pt_jwCorrReqs branch changes; everything else is the function as it was.

create or replace function core.syc_approval(reg text, k text, x jsonb) returns jsonb language plpgsql immutable as $$
declare r jsonb; st text; lg jsonb; ok boolean;
begin
  r := jsonb_build_object('legacy_key', reg || '/' || k, 'no', null, 'ref_room', null, 'ref_table', null, 'ref_legacy_key', null, 'order_no', null, 'sku_code', null,
    'snapshot', null, 'change', null, 'reason', null, 'old_status', null, 'asked_email', null, 'asked_at', null, 'answered_email', null, 'answered_at', null,
    'answer_note', null, 'withdrawn_email', null, 'withdrawn_at', null, 'result_legacy_key', null, 'result_no', null);
  if reg = 'pt_jwCorrReqs' then
    r := r || jsonb_build_object('kind', 'jw_correction', 'ref_room', 'erp', 'ref_table', 'job_work', 'ref_legacy_key', x -> 'rowId',
      'order_no', core.js_or(x -> 'orderNo', 'null'), 'sku_code', core.js_or(x -> 'sku', 'null'), 'snapshot', core.js_or(x -> 'snapshot', 'null'),
      'change', case when jsonb_typeof(x -> 'change') = 'object' then x -> 'change' else '{}'::jsonb end
                || case when core.js_truthy(x -> 'empName') then jsonb_build_object('empName', x -> 'empName') else '{}'::jsonb end,
      'reason', core.js_or(x -> 'why', 'null'),
      'status', case when x ->> 'status' = 'closed' then '"rejected"'::jsonb else x -> 'status' end,      -- 20 Nov: closed = looked at, nothing changed
      'old_status', x -> 'status', 'asked_email', core.js_lc(x -> 'by'), 'asked_at', core.js_iso(x -> 'at'),
      'answered_email', core.js_lc(x -> 'answeredBy'), 'answered_at', core.js_iso(core.js_or(x -> 'answeredAt', x -> 'closedAt')),
      'answer_note', core.js_or(x -> 'answerNote', 'null'));
  elsif reg = 'pt_fgiCorrReqs' then
    r := r || jsonb_build_object('kind', 'fgi_correction', 'ref_room', 'erp', 'ref_table', 'stock_moves',
      'ref_legacy_key', case when core.js_truthy(x -> 'snapshot') then x -> 'snapshot' -> '_id' end,
      'order_no', core.js_or(case when core.js_truthy(x -> 'snapshot') then x -> 'snapshot' -> 'orderNo' end, 'null'), 'sku_code', core.js_or(x -> 'sku', 'null'),
      'snapshot', core.js_or(x -> 'snapshot', 'null'),
      'change', case when jsonb_typeof(x -> 'change') = 'object' then x -> 'change' else '{}'::jsonb end || coalesce(core.js_pick(x, array['kind', 'qty', 'txnType', 'note']), '{}'),
      'reason', core.js_or(x -> 'why', 'null'), 'status', case when x ->> 'status' = 'closed' then '"approved"'::jsonb else x -> 'status' end, 'old_status', x -> 'status',
      'asked_email', core.js_lc(x -> 'by'), 'asked_at', core.js_iso(x -> 'at'), 'answered_email', core.js_lc(x -> 'answeredBy'), 'answered_at', core.js_iso(x -> 'answeredAt'));
  elsif reg = 'pt_obDeleteReqs' then
    r := r || jsonb_build_object('kind', 'order_delete', 'ref_room', 'erp', 'ref_table', 'production_demand', 'ref_legacy_key', core.js_or(x -> 'id', to_jsonb(k)),
      'order_no', core.js_or(x -> 'orderNo', 'null'), 'sku_code', core.js_or(x -> 'sku', 'null'),
      'snapshot', core.js_pick(x, array['articleType', 'articleSubtype', 'color', 'size', 'orderDate', 'qty', 'src', 'from', 'work', 'workAtDelete']),
      'change', core.js_pick(x, array['obRowsRemoved', 'soQtyRemoved']), 'reason', core.js_or(x -> 'why', 'null'),
      'status', case when x ->> 'status' = 'deleted' then '"approved"'::jsonb else x -> 'status' end, 'old_status', x -> 'status',
      'asked_email', core.js_lc(x -> 'by'), 'asked_at', core.js_iso(x -> 'at'), 'answered_email', core.js_lc(x -> 'answeredBy'), 'answered_at', core.js_iso(x -> 'answeredAt'));
  elsif reg = 'pt_vendorOrderReqs' then
    st := x ->> 'status';
    r := r || jsonb_build_object('no', core.js_or(x -> 'reqNo', 'null'), 'kind', 'vendor_order_request', 'ref_room', 'core', 'ref_table', 'vendors', 'ref_legacy_key', core.js_or(x -> 'vendorCode', 'null'),
      'snapshot', core.js_pick(x, array['category', 'service', 'orderType', 'channel', 'vendorCode', 'vendorName', 'filler', 'notes', 'sentTo', 'sentToName', 'lines', 'log']),
      'reason', core.js_or(core.js_or(x -> 'why', x -> 'notes'), 'null'), 'status', x -> 'status', 'old_status', x -> 'status',
      'asked_email', core.js_lc(x -> 'requestedBy'), 'asked_at', core.js_iso(x -> 'requestedAt'),
      'answered_email', case st when 'approved' then core.js_lc(x -> 'approvedBy') when 'rejected' then core.js_lc(x -> 'rejectedBy') end,
      'answered_at', case st when 'approved' then core.js_iso(x -> 'approvedAt') when 'rejected' then core.js_iso(x -> 'rejectedAt') end,
      'answer_note', core.js_or(case when st = 'rejected' then x -> 'rejectReason' else x -> 'approveNote' end, 'null'),
      'withdrawn_email', case when st = 'withdrawn' then case when position('@' in core.js_str(core.js_or(x -> 'withdrawnBy', '""'))) > 0 then core.js_lc(x -> 'withdrawnBy') else core.js_or(x -> 'withdrawnBy', 'null') end end,
      'withdrawn_at', case when st = 'withdrawn' then core.js_iso(x -> 'withdrawnAt') end,
      'result_legacy_key', core.js_or(x -> 'vendorOrderId', 'null'), 'result_no', core.js_or(x -> 'vendorOrderNo', 'null'));
  elsif reg = 'pt_rfdDecisions' then
    lg := case when jsonb_typeof(x -> 'log') = 'array' then (select coalesce(jsonb_agg(e order by core.js_str(e -> 'at') collate "C", o), '[]') from jsonb_array_elements(x -> 'log') with ordinality t(e, o) where core.js_truthy(e)) else '[]' end;
    r := r || jsonb_build_object('kind', 'rfd_decision', 'ref_room', 'erp', 'ref_table', 'vendor_orders', 'ref_legacy_key', core.js_or(x -> 'orderId', 'null'),
      'order_no', core.js_or(x -> 'orderNo', 'null'), 'sku_code', core.js_or(x -> 'sku', 'null'),
      'snapshot', core.js_pick(x, array['orderId', 'orderNo', 'vendorCode', 'vendorName', 'sku', 'size', 'fabric', 'unit', 'metres', 'pieces', 'sends', 'log']),
      'change', core.js_pick(x, array['want']), 'reason', core.js_or(x -> 'note', 'null'), 'status', x -> 'stage', 'old_status', x -> 'stage',
      'asked_at', core.js_or(core.js_iso(lg -> 0 -> 'at'), core.js_iso(x -> 'at')),
      'answered_email', core.js_lc(core.js_or(x -> 'by', lg -> (jsonb_array_length(lg) - 1) -> 'by')),
      'answered_at', core.js_iso(core.js_or(x -> 'at', lg -> (jsonb_array_length(lg) - 1) -> 'at')));
  elsif reg = 'pt_printerRates' then
    ok := lower(core.js_str(x -> 'status')) = 'approved';
    r := r || jsonb_build_object('kind', 'rate', 'ref_room', 'erp', 'ref_table', 'print_rates', 'ref_legacy_key', k,
      'snapshot', x - 'status' - 'approvedAt' - 'approvedBy', 'status', case when ok then 'approved' else 'pending' end, 'old_status', core.js_or(x -> 'status', 'null'),
      'asked_email', core.js_lc(x -> 'by'), 'asked_at', core.js_iso(core.js_or(x -> 'at', x -> 'addedAt')),
      'answered_email', case when ok then core.js_lc(x -> 'approvedBy') end, 'answered_at', case when ok then core.js_iso(x -> 'approvedAt') end);
  else return null; end if;
  r := r || jsonb_build_object('asked_at', coalesce(r -> 'asked_at', r -> 'answered_at', r -> 'withdrawn_at', '"2026-01-01T00:00:00.000Z"'::jsonb));
  if jsonb_typeof(r -> 'asked_at') = 'null' then r := r || jsonb_build_object('asked_at', coalesce(nullif(r -> 'answered_at', 'null'), nullif(r -> 'withdrawn_at', 'null'), '"2026-01-01T00:00:00.000Z"'::jsonb)); end if;
  if coalesce(r ->> 'status', '') not in ('pending', 'approved', 'rejected', 'withdrawn') then raise exception 'cannot place %/%: status %', reg, k, r ->> 'status'; end if;
  if r ->> 'status' in ('approved', 'rejected') and coalesce(r ->> 'answered_at', '') = '' then raise exception 'cannot place %/%: answered without a time', reg, k; end if;
  return r || jsonb_build_object('legacy_self_approved', coalesce(r ->> 'asked_email', '') <> '' and coalesce(r ->> 'answered_email', '') <> '' and r ->> 'asked_email' = r ->> 'answered_email');
end $$;

-- the 27 refused saves: put back in line, the engine (every 10 s) applies them now
update core.sync_inbox set status = 'new', error = null, done_at = null
 where status = 'failed' and path like 'pt_jwCorrReqs/%' and error like '%status closed%';

select case when (core.syc_approval('pt_jwCorrReqs', 't', '{"status":"closed","at":"2026-11-01T00:00:00Z","answeredAt":"2026-11-20T01:53:29Z","answeredBy":"a@b.c","by":"d@e.f"}') ->> 'status') = 'rejected'
            then 'PASS — closed job-work corrections are stored now (as rejected, "closed" kept); the waiting ones are being applied'
            else 'FAIL' end as result;
