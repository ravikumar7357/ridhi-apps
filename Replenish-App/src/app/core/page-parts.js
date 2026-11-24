/* ================= PAGE PARTS · WHICH PARTS OF A PAGE A PERSON SEES (Ravi, 24 Nov 2026) =================
 *
 * Ravi's ask: switch tiles, filters, columns, buttons, sections and pop-ups of a page on or off per ROLE, with a per-PERSON
 * exception, so each person sees only what their job needs. Pilot page: Sales Orders. Plan: PAGE-PARTS-PLAN.md.
 *
 * HOW A PAGE USES IT: a part carries data-part="<key>" (for example so.col.raisedBy). Hidden keys get one style rule that
 * removes the part, so rows and toolbars close up. Code that builds a column, an export or opens a pop-up asks apxOn(key).
 *
 * WHO IT APPLIES TO: admins and the owner always see everything. For everyone else a part is visible unless their role has it
 * off; the person's own exception (on or off) beats the role. A part nobody has set stays visible.
 *
 * DATA (new records, so no existing data changes; each Access click will save one switch only):
 *   config/accessParts      = { v: 1, roles: { <roleKey>: { '<key>': false } }, at, by }   only "off" is stored for a role
 *   accessParts/<email>     = { parts: { '<key>': true | false }, at, by }                  the person's exceptions
 *
 * ERROR STRATEGY: saving is not done here (the Access editor does it and says "Not saved" if it fails). READING falls back
 * quietly to today's behaviour, everything shown, with a console.warn saying why (unreadable, rules not live yet, timeout,
 * unknown role). Reading never throws and never blocks sign-in: it waits at most APX_TIMEOUT_MS.
 *
 * HIDING IS NOT SECURITY: the data is still in the browser. Locking money and pay parts in the database rules is a later change.
 *
 * SWITCH (risky change, default off): on for the test link and localhost; localStorage pageParts = '1' turns it on for one PC,
 * '0' off. With the switch off nothing is read, no style is made, and apxOn is always true. The switch is removed once it settles.
 */
const APX_DEFAULT = false;
const APX_TIMEOUT_MS = 2500;
const APX_KEY_OK = /^[a-z0-9.]+$/;

/* A part: key (what the page carries), name (what the Access page shows), need (a warning when a job depends on it). */
const apxPart = (key, name, need) => (need ? { key, name, need } : { key, name });

const PAGE_PARTS = {
  so: { name: 'Sales Orders', groups: {
    'Tiles': [
      apxPart('so.tile.orders', 'Tile: Orders'),
      apxPart('so.tile.awaiting', 'Tile: Awaiting approval'),
      apxPart('so.tile.approved', 'Tile: Approved'),
      apxPart('so.tile.pieces', 'Tile: Pieces'),
      apxPart('so.tile.missing', 'Tile: Missing from the order book'),
    ],
    'Filters': [
      apxPart('so.flt.status', 'Filter: Status'),
      apxPart('so.flt.channel', 'Filter: Channel'),
      apxPart('so.flt.shipMode', 'Filter: AIR / SEA'),
      apxPart('so.flt.saleMonth', 'Filter: Sale month'),
      apxPart('so.flt.search', 'Filter: Search'),
      apxPart('so.flt.dates', 'Filter: Dates'),
    ],
    'Table columns': [
      apxPart('so.col.date', 'Column: Date'),
      apxPart('so.col.channel', 'Column: Channel'),
      apxPart('so.col.buyer', 'Column: Buyer'),
      apxPart('so.col.raisedBy', 'Column: Raised by'),
      apxPart('so.col.status', 'Column: Status'),
      apxPart('so.col.skus', 'Column: SKUs'),
      apxPart('so.col.pieces', 'Column: Pieces'),
      apxPart('so.col.cut', 'Column: Cut'),
      apxPart('so.col.made', 'Column: Made'),
      apxPart('so.col.inBook', 'Column: In order book'),
      apxPart('so.col.delivery', 'Column: Delivery'),
    ],
    'Buttons': [
      apxPart('so.btn.clear', 'Button: Clear'),
      apxPart('so.btn.new', 'Button: New sales order'),
      apxPart('so.btn.delReqs', 'Button: Deletion requests'),
      apxPart('so.btn.export', 'Button: Export'),
      apxPart('so.btn.qtySheet', 'Button: Qty sheet'),
      apxPart('so.btn.qtyImport', 'Button: Qty import'),
      apxPart('so.btn.refresh', 'Button: Refresh'),
      apxPart('so.btn.open', 'Row button: Open'),
      apxPart('so.btn.edit', 'Row button: Edit'),
      apxPart('so.btn.review', 'Row button: Review', 'Approvers cannot approve without it'),
      apxPart('so.btn.addMissing', 'Row button: Add the missing'),
    ],
    'Sections': [
      apxPart('so.sec.backByPpc', 'Section: Sent back by PPC'),
    ],
    'Pop-ups': [
      apxPart('so.dlg.order', 'Pop-up: Sales order'),
      apxPart('so.dlg.order.col.image', 'Sales order column: Image'),
      apxPart('so.dlg.order.col.article', 'Sales order column: Article'),
      apxPart('so.dlg.order.col.size', 'Sales order column: Size'),
      apxPart('so.dlg.order.col.colour', 'Sales order column: Colour'),
      apxPart('so.dlg.order.col.quality', 'Sales order column: Quality'),
      apxPart('so.dlg.order.col.cut', 'Sales order column: Cut'),
      apxPart('so.dlg.order.col.made', 'Sales order column: Made'),
      apxPart('so.dlg.order.col.owed', 'Sales order column: Owed'),
      apxPart('so.dlg.order.col.delivery', 'Sales order column: Delivery'),
      apxPart('so.dlg.order.col.priority', 'Sales order column: Priority'),
      apxPart('so.dlg.order.col.inBook', 'Sales order column: In order book'),
      apxPart('so.dlg.order.btn.editLine', 'Sales order button: Edit line'),
      apxPart('so.dlg.order.btn.changeQty', 'Sales order button: Change qty'),
      apxPart('so.dlg.order.sec.detailChanges', 'Sales order section: Details changed'),
      apxPart('so.dlg.order.sec.qtyChanges', 'Sales order section: Quantities changed'),
      apxPart('so.dlg.changeQty', 'Pop-up: Change the quantity'),
      apxPart('so.dlg.review', 'Pop-up: Review', 'Approvers cannot approve without it'),
      apxPart('so.dlg.review.btn.approve', 'Review button: Approve', 'Approvers cannot approve without it'),
      apxPart('so.dlg.review.btn.sendBack', 'Review button: Send back'),
      apxPart('so.dlg.review.col.image', 'Review column: Image'),
      apxPart('so.dlg.review.col.inBook', 'Review column: In order book'),
      apxPart('so.dlg.form', 'Pop-up: New / Edit order form'),
      apxPart('so.dlg.form.fld.saleMonth', 'Order form field: Sale month'),
      apxPart('so.dlg.form.fld.orderType', 'Order form field: Order type'),
      apxPart('so.dlg.form.fld.delivery', 'Order form field: Delivery'),
      apxPart('so.dlg.form.fld.reference', 'Order form field: Reference'),
      apxPart('so.dlg.form.btn.addLine', 'Order form button: Add line'),
      apxPart('so.dlg.form.btn.template', 'Order form button: Template'),
      apxPart('so.dlg.form.btn.upload', 'Order form button: Upload'),
      apxPart('so.dlg.form.btn.saveDraft', 'Order form button: Save draft'),
      apxPart('so.dlg.form.btn.delete', 'Order form button: Delete'),
      apxPart('so.dlg.form.col.type', 'Order form column: Type'),
      apxPart('so.dlg.form.col.priority', 'Order form column: Priority'),
      apxPart('so.dlg.form.col.lineDelivery', 'Order form column: Delivery'),
      apxPart('so.dlg.form.col.image', 'Order form column: Image (B2B)'),
      apxPart('so.dlg.form.col.brand', 'Order form column: Brand (B2B)'),
      apxPart('so.dlg.form.col.label', 'Order form column: Label (B2B)'),
      apxPart('so.dlg.form.col.material', 'Order form column: Material (B2B)'),
      apxPart('so.dlg.form.col.customization', 'Order form column: Customization (B2B)'),
      apxPart('so.dlg.delReqs', 'Pop-up: Deletion requests'),
      apxPart('so.dlg.qtyConfirm', 'Pop-up: Change these quantities'),
    ],
  } },
};

/* The buttons that open a pop-up. A pop-up that is off must not leave its buttons behind, or a person clicks and nothing happens
 * (Ravi, 24 Nov 2026): so.dlg.form off hides New and Edit too. Row buttons shown only inside another pop-up are listed the same way. */
const APX_OPENERS = {
  'so.dlg.order': ['so.btn.open'],
  'so.dlg.form': ['so.btn.new', 'so.btn.edit'],
  'so.dlg.review': ['so.btn.review', 'so.btn.addMissing'],
  'so.dlg.changeQty': ['so.dlg.order.btn.changeQty'],
  'so.dlg.delReqs': ['so.btn.delReqs'],
  'so.dlg.qtyConfirm': ['so.btn.qtyImport'],
};

/* Every key the app knows, once: anything else found in saved data is ignored. */
const APX_KEYS = new Set(Object.values(PAGE_PARTS).flatMap(page => Object.values(page.groups).flat().map(part => part.key)));

/* What is loaded for THIS sign-in. hidden is empty until a read has worked, so a failed read shows everything. */
const APX = { on: false, hidden: new Set() };

/** Is the feature on for this PC? localStorage wins ('1' on, '0' off); else the default, plus the test link and localhost. */
function apxSwitchOn() {
  try { const v = localStorage.getItem('pageParts'); if (v === '1') return true; if (v === '0') return false; } catch (e) { /* storage blocked: use the default */ }
  const testLink = typeof window !== 'undefined' && (!!window.__TEST_ERP || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname));
  return APX_DEFAULT || testLink;
}

/** The keys one person must not see, as a Set. Pure: same inputs, same answer. */
function apxEffective(roleDoc, personDoc, role, isAdmin) {
  if (isAdmin) return new Set();
  const roleOff = apxRoleOff(roleDoc, role);
  const person = (personDoc && personDoc.parts) || {};
  const hidden = new Set();
  roleOff.forEach(key => { if (person[key] !== true) hidden.add(key); });
  Object.keys(person).forEach(key => { if (person[key] === false && apxKnown(key)) hidden.add(key); });
  return apxWithChildren(hidden);
}

/* The keys a role has off. A missing role, or one with no entry, has nothing off. */
function apxRoleOff(roleDoc, role) {
  const roles = (roleDoc && roleDoc.roles) || {};
  if (!role) return [];
  if (!roles[role]) { if (roleDoc) console.warn('[page parts] no switches saved for role "' + role + '": everything shown for that role'); return []; }
  return Object.keys(roles[role]).filter(key => roles[role][key] === false && apxKnown(key));
}

/* A saved key the app does not know (an old name, a typo) is ignored, with a line saying so. */
function apxKnown(key) {
  if (APX_KEYS.has(key)) return true;
  console.warn('[page parts] unknown part ignored: ' + String(key).slice(0, 60));
  return false;
}

/* A pop-up that is off takes everything inside it with it (so.dlg.order off hides so.dlg.order.col.image too) and the buttons that open it. */
function apxWithChildren(hidden) {
  const all = new Set(hidden);
  APX_KEYS.forEach(key => { if ([...hidden].some(parent => key.startsWith(parent + '.'))) all.add(key); });
  hidden.forEach(key => (APX_OPENERS[key] || []).forEach(opener => all.add(opener)));
  return all;
}

/** Reads the two records once at sign-in and builds the style. Needs ME.email, ME.admin, ME.accessRole. Never throws. */
async function apxLoad() {
  APX.on = apxSwitchOn();
  APX.hidden = new Set();
  if (!APX.on) { apxStyle(); return; }
  if (ME.admin) { apxStyle(); return; }   // admins and the owner see everything: nothing to read
  const docs = await apxRead(ME.email);
  if (docs) { APX.hidden = apxEffective(docs.roleDoc, docs.personDoc, ME.accessRole, false); }
  apxStyle();
}

/* The two records, or null with a console line saying why (rules not live, unreadable, too slow). */
async function apxRead(email) {
  let timer;
  const tooSlow = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('no answer in ' + APX_TIMEOUT_MS + ' ms')), APX_TIMEOUT_MS); });
  try {
    const read = Promise.all([getDoc(doc(db, 'config', 'accessParts')), getDoc(doc(db, 'accessParts', email))]);
    const [roleSnap, personSnap] = await Promise.race([read, tooSlow]);
    return { roleDoc: roleSnap.exists() ? roleSnap.data() : null, personDoc: personSnap.exists() ? personSnap.data() : null };
  } catch (e) {
    console.warn('[page parts] could not read the switches, everything shown: ' + (e && e.message || e));
    return null;
  } finally { clearTimeout(timer); }
}

/** Should this part be shown? True when the switch is off, nothing was loaded, or the key is not hidden. */
function apxOn(key) { return !APX.on || !APX.hidden.has(key); }

/** The style text for a set of hidden keys: only keys the app knows and that are plain letters, digits and dots. */
function apxStyleText(hidden) {
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape : s => s;
  return [...hidden].filter(key => APX_KEYS.has(key) && APX_KEY_OK.test(key))
    .map(key => '[data-part="' + esc(key) + '"]{display:none!important}').join('\n');
}

/* The one <style id="apxStyle"> on the page; removed when nothing is hidden. */
function apxStyle() {
  if (typeof document === 'undefined') return;
  const old = document.getElementById('apxStyle');
  const text = APX.on ? apxStyleText(APX.hidden) : '';
  if (old) old.remove();
  if (!text) return;
  const el = document.createElement('style');
  el.id = 'apxStyle';
  el.textContent = text;
  document.head.appendChild(el);
}

/** Admin only, for the Access editor's preview: shows the page as this role would see it, in memory only (nothing saved).
 *  apxPreviewAs(null) goes back to the signed-in person's own view. The editor hands over the role switches it holds right now
 *  (roleDoc), so a switch changed a moment ago shows in the next preview without a reload. */
function apxPreviewAs(roleKey, roleDoc) {
  if (!ME.admin || !APX.on) return;
  APX.hidden = roleKey ? apxEffective(roleDoc, null, roleKey, false) : new Set();
  apxStyle();
}
