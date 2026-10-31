/* WHAT LEAVES FOR A MODEL: never an order number, a phone, an email, a tax number or a person's name.
 * The same rules run in the browser before a question is sent (guide-ask.js, gaClean) and here again, so a question that
 * skipped the browser's cleaning is cleaned all the same. A model only ever sees the cleaned words. */

/* Order and document numbers as the ERP writes them: SHP-3365, AMZ-15102026-01, ORD-1234, SPY-20102026-01, LEG-17102026-01,
 * #RBP7578, CUST-…, GPO-…, PO-…, and any long run of digits (an order, a phone, an AWB, an invoice).
 * SKU codes (CPC008-04, RQL354-K) stay: they help the answer and are not private. */
const ORDER = /\b(?:SHP|AMZ|ORD|SPY|LEG|CUST|GPO|PO|SO|INV)-[A-Z0-9][A-Z0-9-]{2,}\b|#[A-Z]{2,4}\d{3,}\b/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s-]{8,}\d/g;          // a run of digits with spaces or dashes — a phone only when it holds 10+ digits
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/gi;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const LONGNUM = /\b\d{5,}\b/g;                 // what is left of a long number

/** Clean one question. names: people's names the ERP knows (karigars, employees), each one or more words. */
export function clean(text, names = []) {
  let s = String(text || '').slice(0, 500);
  s = s.replace(EMAIL, '[EMAIL]').replace(GSTIN, '[TAX-ID]').replace(PAN, '[TAX-ID]').replace(ORDER, '[ORDER]')
    .replace(PHONE, m => (m.replace(/\D/g, '').length >= 10 ? '[PHONE]' : m)).replace(LONGNUM, '[NUMBER]');
  const list = [...new Set((names || []).map(n => String(n || '').trim()).filter(n => n.length >= 3))].sort((a, b) => b.length - a.length);
  for (const n of list) {
    const re = new RegExp('(^|[^\\p{L}])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^\\p{L}])', 'giu');
    s = s.replace(re, '$1[NAME]');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Does anything that looks like a record's number survive? (Gemini's free tier only gets questions with none.) */
export function hasRecordLike(text) {
  return /\d{4,}/.test(String(text || '')) || /\[(ORDER|PHONE|EMAIL|TAX-ID|NUMBER)\]/.test(String(text || ''));
}

/** The key a saved answer is found by: the cleaned question, lower case, without punctuation or repeated spaces. */
export function questionKey(text) {
  return String(text || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\[\]\s]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
