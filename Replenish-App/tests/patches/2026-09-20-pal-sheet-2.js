/* The buttons, and a stopped design saying so on the screen. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the buttons ---- */
one(`          <button id="palExport" class="ghost">Export</button>
          <button id="palRefresh" class="ghost">Refresh</button>`,
`          <button id="palExport" class="ghost">Export</button>
          <button id="palSheet" class="ghost hide" title="Every design, with its group, whether it is still being made, and what the registers say about it. Fill in Group and Continue; the rest is worked out.">Design sheet</button>
          <button id="palImport" class="ghost hide" title="Read a filled design sheet back. You are shown what it would do before anything is written.">Design import</button>
          <input id="palFile" type="file" accept=".xlsx,.csv,text/csv" style="display:none">
          <button id="palRefresh" class="ghost">Refresh</button>`, 'the buttons');

one(`$('palExport').onclick = () => palExport();`,
`$('palExport').onclick = () => palExport();

$('palSheet').onclick = () => {
  const rows = palSheetRows();
  if (rows.length < 2) {
    $('palMsg').className = 'err';
    $('palMsg').textContent = 'There are no designs to write — the master database has no colours in it yet.';
    return;
  }
  ptDownload('designs', rows.map(r => r.map(csvCell).join(',')));
  $('palMsg').className = 'muted';
  $('palMsg').textContent = nf(rows.length - 1) + ' design(s) written. Fill in Group and Continue; '
    + 'every other column is worked out from the registers and is read back for nothing.';
};
$('palImport').onclick = () => $('palFile').click();
$('palFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = palSheetRead(rows);
    if (read.err) { $('palMsg').className = 'err'; $('palMsg').textContent = read.err; return; }
    const plan = palSheetPlan(read.entries);
    if (!plan.set.length) {
      $('palMsg').className = plan.skip.length ? 'err' : 'muted';
      $('palMsg').textContent = plan.skip.length
        ? nf(plan.skip.length) + ' row(s) refused, and nothing written: '
          + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
          + (plan.skip.length > 3 ? ' and ' + nf(plan.skip.length - 3) + ' more.' : '')
        : 'Every row in that file already says what the screen says.';
      return;
    }
    const gs = plan.set.filter(x => x.field === 'group'), ls = plan.set.filter(x => x.field === 'live');
    const show = list => list.slice(0, 12).map(x => esc(x.d.brand + ' · ' + x.d.color) + ': '
      + (x.from === '' ? '<i>not set</i>' : esc(x.from)) + ' → <b>' + esc(x.to) + '</b>').join('<br>');
    ptOpenDialog({
      title: 'Write these decisions?',
      subtitle: nf(gs.length) + ' group(s) · ' + nf(ls.length) + ' started or stopped',
      /* WHAT STOPPING ONE DOES, said before it is done: the pieces stop being planned, the row stays. */
      note: 'A design you stop keeps its row and its figures — its outstanding pieces simply stop counting '
        + 'towards what has to be made, and stop being offered to a printer. Nothing is deleted. '
        + 'Only Group and Continue are read; every other column on the sheet is worked out here.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + (gs.length ? '<b>Group</b><br>' + show(gs) + (gs.length > 12 ? '<br>…and ' + nf(gs.length - 12) + ' more.' : '') + '<br><br>' : '')
        + (ls.length ? '<b>Continue</b><br>' + show(ls) + (ls.length > 12 ? '<br>…and ' + nf(ls.length - 12) + ' more.' : '') + '<br><br>' : '')
        + (plan.skip.length ? '<b style="color:var(--bad)">' + nf(plan.skip.length) + ' row(s) refused, and not written</b><br>'
          + plan.skip.slice(0, 10).map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>')
          + (plan.skip.length > 10 ? '<br>…and ' + nf(plan.skip.length - 10) + ' more.' : '') : '')
        + '</div>',
      saveLabel: 'Write ' + nf(plan.set.length) + ' decision(s)',
      onSave: async () => {
        const err = await palSheetRun(plan);
        if (err) return err;
        renderPal();
        $('palMsg').className = 'muted';
        $('palMsg').textContent = nf(plan.set.length) + ' decision(s) written.'
          + (plan.skip.length ? ' ' + nf(plan.skip.length) + ' row(s) were refused and left alone.' : '');
        return '';
      },
    });
  } catch (err) { $('palMsg').className = 'err'; $('palMsg').textContent = 'Could not read it: ' + (err.message || err); }
};`, 'wired');

/* ---- 2. only for somebody who may change a decision ---- */
one(`function renderPal() {`,
`function renderPal() {
  /* The sheet writes groups and stop decisions, so it is the same right that ticks them by hand. */
  ['palSheet', 'palImport'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !palCanEdit()); });`, 'and only for an editor');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
