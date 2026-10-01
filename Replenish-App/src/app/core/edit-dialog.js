/* ================= ONE EDIT DIALOG, USED BY EVERY SCREEN =================
 *
 * Editing always opens in front of the row, never in the "new entry" panel at the top. That is not a
 * style choice: reusing the add-form for editing is exactly what stopped a custom Base Data entry
 * being editable at all, because that form insists the SKU exists in the master database.
 *
 * Every register from here on calls ptOpenDialog with its own fields, so they cannot drift apart —
 * the admin-only box, the delete confirmation and the save/failure handling are written once.
 *
 *   ptOpenDialog({
 *     title, subtitle, note,                  // note = the blue explanation box, optional
 *     fields: [{ key, label, type, value, options, readonly, admin, span }],
 *     onSave(values) -> string|falsy          // a returned string is shown as the refusal
 *     onDelete(), deleteWhat                  // both optional; delete is admin-only
 *   })
 */
let PTD = null;      // the open dialog's config

function ptDlgClose() { PTD = null; $('ptDlg').classList.add('hide'); }
function ptDlgMsg(t, bad) { const m = $('ptDlgMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

let PTD_BOXCLS = '';
function ptOpenDialog(cfg) {
  PTD = cfg;
  const admin = !!ME.admin;
  $('ptDlgTitle').textContent = cfg.title || 'Edit';
  $('ptDlgWho').textContent = cfg.subtitle || '';
  $('ptDlgWho').classList.toggle('hide', !cfg.subtitle);
  $('ptDlgNote').innerHTML = cfg.note ? esc(cfg.note) : '';
  $('ptDlgNote').classList.toggle('hide', !cfg.note);

  const fields = (cfg.fields || []).filter(f => !f.admin || admin);
  const one = f => {
    const id = 'ptf_' + f.key;
    const span = f.span ? ' style="grid-column:1/-1"' : '';
    const ro = f.readonly ? ' readonly style="background:var(--hover,#f1f5f9);color:var(--muted)"' : '';
    /* A list field is type-or-pick: every known value is offered, and anything else can still be
     * typed. A select cannot introduce a value that is not already in the data, which is how the
     * rate list ended up unable to accept a new article. */
    const dl = f.list ? ` list="${id}_dl" autocomplete="off"` : '';
    const dlHtml = f.list
      ? `<datalist id="${id}_dl">${[...new Set(f.list.filter(Boolean).map(String))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
          .map(o => `<option value="${esc(o)}">`).join('')}</datalist>`
      : '';
    /* SEVERAL AT ONCE. A checkbox list rather than a multiple-select: a multiple-select hides how
     * many are picked behind a scrollbar, and this is a field where picking four printers instead of
     * three is the whole point. */
    if (f.type === 'multi') {
      const picked = new Set((Array.isArray(f.value) ? f.value : []).map(String));
      return `<label${span}>${esc(f.label)}
        <div class="ptmulti" style="display:flex;flex-wrap:wrap;gap:6px 16px;padding:8px 2px">${
          (f.options || []).map(o => {
            const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
            return `<label style="display:inline-flex;align-items:center;gap:6px;font-weight:400;cursor:pointer">
              <input type="checkbox" data-multi="${esc(f.key)}" value="${esc(val)}" style="width:auto"${picked.has(String(val)) ? ' checked' : ''}>
              ${esc(lab)}</label>`;
          }).join('')}</div></label>`;
    }
    const body = f.type === 'select'
      /* An option may be a plain string, or [value, label] — the shape ptFillSelect has always used.
       * Without the second form a select could only ever show the value it stores, which is how the
       * printer picker ended up offering VND002 to people who call it Choudhary Hand Block. */
      ? `<select id="${id}">${(f.options || []).map(o => {
          const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
          return `<option value="${esc(val)}"${String(val) === String(f.value) ? ' selected' : ''}>${esc(lab)}</option>`;
        }).join('')}</select>`
      : `<input id="${id}" type="${esc(f.type || 'text')}"${f.min != null ? ` min="${esc(f.min)}"` : ''}${f.step ? ` step="${esc(f.step)}"` : ''}${dl} value="${esc(f.value == null ? '' : f.value)}"${ro}>${dlHtml}`;
    return `<label${span}>${esc(f.label)}${f.readonly ? ' <span class="muted">(read-only)</span>' : ''}${body}</label>`;
  };
  const plain = fields.filter(f => !f.admin), gated = fields.filter(f => f.admin);
  // Some dialogs are a report, not a form. They hand over their own markup and take no values.
  $('ptDlgBody').innerHTML = (cfg.html || '') + (fields.length ? `<div class="ptgrid">${plain.map(one).join('')}</div>` : '')
    + (gated.length ? `<div class="ptbox"><div class="ptbox-t">Admin only</div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">${esc(cfg.adminNote
          || 'Changing a date can move these pieces into a different period. Only the day changes — the time already on the record is kept.')}</div>
        <div class="ptgrid">${gated.map(one).join('')}</div></div>` : '');

  /* Deleting is admin-only unless the screen says this person holds a right for it (deleteAllowed). */
  $('ptDlgDelete').classList.toggle('hide', !(cfg.onDelete && (admin || cfg.deleteAllowed)));
  // A report has nothing to save; offering the button would only invite a pointless click.
  $('ptDlgSave').classList.toggle('hide', !cfg.onSave);
  $('ptDlgSave').textContent = cfg.saveLabel || 'Save';
  $('ptDlgSave').disabled = false;          // a screen that disabled it (the bucket, nothing ticked) must not leave it so
  /* Some screens have two ways forward, not one — save a draft or place it, approve it or send it
   * back. The second button behaves exactly like Save: a returned string refuses and is shown. */
  $('ptDlgAlt').classList.toggle('hide', !cfg.alt);
  $('ptDlgAlt').textContent = cfg.alt ? cfg.alt.label : '';
  $('ptDlgCancel').textContent = (cfg.onSave || cfg.alt) ? 'Cancel' : 'Close';
  /* OPT-IN, AND RESET ON EVERY OPEN. One dialog serves every screen; a wide one, a chip beside the
   * title, figures in the footer, or the second button as the main one, are for the dialog that asks
   * for them and must not linger into the next. */
  if ($('ptDlgBox')) $('ptDlgBox').classList.toggle('ptmodal-wide', !!cfg.wide);
  /* A dialog's own look (the vendor order's header band), opt-in and gone again on the next open. */
  if ($('ptDlgBox')) {
    if (PTD_BOXCLS) $('ptDlgBox').classList.remove(PTD_BOXCLS);
    PTD_BOXCLS = cfg.boxClass || '';
    if (PTD_BOXCLS) $('ptDlgBox').classList.add(PTD_BOXCLS);
  }
  if ($('ptDlgTitleX')) $('ptDlgTitleX').innerHTML = cfg.titleExtra || '';
  if ($('ptDlgFootL')) $('ptDlgFootL').innerHTML = cfg.footLeft || '';
  const altMain = !!(cfg.alt && cfg.altPrimary);
  $('ptDlgSave').classList.toggle('ghost', altMain);
  $('ptDlgAlt').classList.toggle('ghost', !altMain);
  /* The main button goes last, where the eye ends up: Cancel · Save draft · Place order. */
  $('ptDlgSave').style.order = altMain ? '1' : '';
  $('ptDlgAlt').style.order = altMain ? '2' : '';
  ptDlgMsg(cfg.msg || '');
  $('ptDlg').classList.remove('hide');
}

const ptDlgValues = () => (PTD.fields || []).reduce((v, f) => {
  if (f.type === 'multi') {
    /* Every box that is ticked, as an array — the field has no single element to read. */
    v[f.key] = [...document.querySelectorAll(`[data-multi="${f.key}"]`)].filter(x => x.checked).map(x => x.value);
    return v;
  }
  const el = $('ptf_' + f.key);
  v[f.key] = el ? el.value : f.value;       // an admin-only field absent for this user keeps its stored value
  return v;
}, {});

$('ptDlgClose').onclick = ptDlgClose;
$('ptDlgCancel').onclick = ptDlgClose;
$('ptDlg').addEventListener('click', e => { if (e.target === $('ptDlg')) ptDlgClose(); });

$('ptDlgSave').onclick = async () => {
  if (!PTD) return;
  $('ptDlgSave').disabled = true;
  ptDlgMsg('Saving…');
  try {
    const err = await PTD.onSave(ptDlgValues());
    if (err) ptDlgMsg(err, true); else ptDlgClose();
  } catch (e) {
    ptDlgMsg('Not saved: ' + (e.message || e), true);
  }
  $('ptDlgSave').disabled = false;
};

$('ptDlgAlt').onclick = async () => {
  if (!PTD || !PTD.alt) return;
  $('ptDlgAlt').disabled = true; $('ptDlgSave').disabled = true;
  ptDlgMsg('Working…');
  try {
    const err = await PTD.alt.run(ptDlgValues());
    if (err) ptDlgMsg(err, true); else ptDlgClose();
  } catch (e) {
    ptDlgMsg('Not done: ' + (e.message || e), true);
  }
  $('ptDlgAlt').disabled = false; $('ptDlgSave').disabled = false;
};

$('ptDlgDelete').onclick = async () => {
  if (!PTD || !PTD.onDelete || !(ME.admin || PTD.deleteAllowed)) return;
  /* The confirmation says what is going, not "are you sure?" — every count built on this row moves
   * with it, payroll included. */
  if (!confirm(`Delete this entry?\n\n${PTD.deleteWhat || ''}\n\nThis cannot be undone, and every `
    + 'figure counted off this row changes with it.')) return;
  $('ptDlgDelete').disabled = true;
  ptDlgMsg('Deleting…');
  try {
    const err = await PTD.onDelete();
    if (err) ptDlgMsg(err, true); else ptDlgClose();
  } catch (e) {
    ptDlgMsg('Not deleted: ' + (e.message || e), true);
  }
  $('ptDlgDelete').disabled = false;
};

/* ---- Press Inventory: edit ---- */
function pressEdit(id) {
  const r = (PTG.press || []).find(x => x.id === id);
  if (!r) return;
  if (!ptCanEdit()) { $('ppMsg').className = 'err'; $('ppMsg').textContent = PT_NO_EDIT; return; }
  ptOpenDialog({
    title: 'Edit Press Entry',
    subtitle: `SKU: ${r.sku || '—'}  ·  ${r.orderNo ? 'Order: ' + r.orderNo : 'no Order ID'}`,
    note: 'The SKU is not changed here — a different SKU is a different entry. Pieces stay capped at what the order still allows.',
    msg: `${r.articleType || ''} · ${r.articleSubtype || ''} · ${r.color || ''} · ${r.size || ''}`,
    fields: [
      { key: 'sku', label: 'SKU', value: r.sku, readonly: true },
      { key: 'pieces', label: 'Pieces', type: 'number', min: 1, step: 1, value: ptNum(r.pieces) },
      { key: 'remarks', label: 'Remarks', value: r.remarks || '', span: true },
      { key: 'entryDate', label: 'Entry date', type: 'date', value: ptIsoDate(r.entryDate), admin: true },
    ],
    deleteWhat: `${nf(ptNum(r.pieces))} piece(s) of ${r.sku} pressed`
      + (r.orderNo ? ` against ${r.orderNo}` : '') + ` on ${r.entryDate}`,
    onSave: async v => {
      if (!ptCanEdit()) return PT_NO_EDIT;
      const pcs = parseInt(v.pieces, 10);
      if (!pcs || pcs < 1) return 'Pieces must be at least 1.';
      if (r.orderNo) {
        const g = pressGuard(r.orderNo, r.sku, pcs, r.id);
        if (g) return g;
      }
      const date = v.entryDate || ptIsoDate(r.entryDate);
      if (pressMonthFrozen(date)) return `${ptMonthKey(date)} is frozen — press entries for that month are locked.`;
      const next = Object.assign({}, r, {
        pieces: pcs, remarks: String(v.remarks || '').trim(),
        entryDate: v.entryDate ? ptStampFrom(r.entryDate, v.entryDate) : r.entryDate,
        editedBy: ME.email, editedAt: new Date().toISOString(),
      });
      delete next._key;
      await ptPut('pt_pressInventory/' + r.id, next);
      PTG.press = (PTG.press || []).map(x => (x.id === r.id ? Object.assign({ _key: r.id }, next) : x));
      renderPpress();
      $('ppMsg').className = 'muted';
      $('ppMsg').textContent = `Updated ${obUC(r.sku)} — ${nf(pcs)} piece(s) pressed.`;
      return '';
    },
    onDelete: async () => {
      await ptDelete('pt_pressInventory/' + r.id);
      PTG.press = (PTG.press || []).filter(x => x.id !== r.id);
      renderPpress();
      $('ppMsg').className = 'muted';
      $('ppMsg').textContent = `Deleted a press entry of ${nf(ptNum(r.pieces))} piece(s) of ${obUC(r.sku)}.`;
      return '';
    },
  });
}

/* ---- Cutting Data: edit ---- */
function cutEdit(id) {
  const r = (PT.cut || []).find(x => x.id === id);
  if (!r) return;
  if (!ptCanEdit()) { $('pcMsg').className = 'err'; $('pcMsg').textContent = PT_NO_EDIT; return; }
  ptOpenDialog({
    title: 'Edit Cutting Entry',
    subtitle: `SKU: ${r.sku || '—'}  ·  ${r.orderNo ? 'Order: ' + r.orderNo : 'no Order ID'}`,
    note: 'Pieces stay capped at what the order still allows, with this entry excluded from its own cap.',
    msg: `${r.articleType || ''} · ${r.articleSubtype || ''} · ${r.color || ''} · ${r.size || ''}`,
    fields: [
      { key: 'sku', label: 'SKU', value: r.sku, readonly: true },
      { key: 'pieces', label: 'Pieces', type: 'number', min: 1, step: 1, value: ptNum(r.pieces) },
      { key: 'fabricWidth', label: 'Fabric', value: r.fabricWidth || '' },
      { key: 'fabricUsed', label: 'Fabric used (m)', type: 'number', step: '0.01', min: 0, value: r.fabricUsed == null ? '' : r.fabricUsed },
      { key: 'fabricWaste', label: 'Waste (m)', type: 'number', step: '0.01', min: 0, value: r.fabricWaste == null ? '' : r.fabricWaste },
      { key: 'fabricWasteWidth', label: 'Waste width (in)', type: 'number', step: '0.25', min: 0, value: r.fabricWasteWidth == null ? '' : r.fabricWasteWidth },
      { key: 'remarks', label: 'Remarks', value: r.remarks || '', span: true },
      { key: 'cutDate', label: 'Cut date', type: 'date', value: ptIsoDate(r.cutDate), admin: true },
    ],
    deleteWhat: `${nf(ptNum(r.pieces))} piece(s) of ${r.sku} cut`
      + (r.orderNo ? ` against ${r.orderNo}` : '') + ` on ${r.cutDate}`,
    onSave: async v => {
      if (!ptCanEdit()) return PT_NO_EDIT;
      const pcs = parseInt(v.pieces, 10);
      if (!pcs || pcs < 1) return 'Pieces must be at least 1.';
      if (!String(v.fabricWidth || '').trim()) return 'Enter the fabric.';
      if (r.orderNo) {
        const g = cutGuard(r.orderNo, r.sku, pcs, r.id);
        if (g) return g;
      }
      const date = v.cutDate || ptIsoDate(r.cutDate);
      if (cutMonthFrozen(date)) return `${ptMonthKey(date)} is frozen — cutting entries for that month are locked.`;
      const next = Object.assign({}, r, {
        pieces: pcs, fabricWidth: String(v.fabricWidth || '').trim(),
        remarks: String(v.remarks || '').trim(),
        cutDate: v.cutDate ? ptStampFrom(r.cutDate, v.cutDate) : r.cutDate,
        editedBy: ME.email, editedAt: new Date().toISOString(),
      });
      /* THE CLOTH FIGURES, and a box emptied here empties the field rather than leaving the old number:
       * a blank and a nought are different, and so are a blank and "what it used to say". */
      [['fabricUsed', v.fabricUsed], ['fabricWaste', v.fabricWaste], ['fabricWasteWidth', v.fabricWasteWidth]].forEach(([k, raw]) => {
        const txt = String(raw == null ? '' : raw).trim();
        if (txt === '') { delete next[k]; return; }
        const n = mdbNum(txt);
        if (Number.isFinite(n) && n >= 0) next[k] = n;
      });
      delete next._key;
      await ptPut('pt_cuttingData/' + r.id, next);
      PT.cut = (PT.cut || []).map(x => (x.id === r.id ? Object.assign({ _key: r.id }, next) : x));
      renderPcut();
      $('pcMsg').className = 'muted';
      $('pcMsg').textContent = `Updated ${obUC(r.sku)} — ${nf(pcs)} piece(s) cut.`;
      return '';
    },
    onDelete: async () => {
      await ptDelete('pt_cuttingData/' + r.id);
      PT.cut = (PT.cut || []).filter(x => x.id !== r.id);
      renderPcut();
      $('pcMsg').className = 'muted';
      $('pcMsg').textContent = `Deleted a cutting entry of ${nf(ptNum(r.pieces))} piece(s) of ${obUC(r.sku)}.`;
      return '';
    },
  });
}

