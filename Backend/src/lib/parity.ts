/* Parity: is the new backend's answer the same as Apps Script's? Used two ways:
 *   - in tests, against answers recorded from Apps Script (test/golden/<route>.json)
 *   - live, by tools/parity.ts, which asks both backends the same question and prints the differences
 * Fields that change on every call (timestamps, tokens) are named in `ignore` and skipped. Numbers may differ by
 * `tolerance` (default 0) — money sums can differ in the last decimal when the order of adding changes. */

export interface Diff { path: string; old: unknown; new: unknown }

export interface ParityOptions { ignore?: string[]; tolerance?: number; maxDiffs?: number }

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function ignored(path: string, ignore: string[]): boolean {
  // "at" ignores the key anywhere; "rows[].at" ignores it inside every row; exact paths work too
  const generic = path.replace(/\[\d+\]/g, '[]');
  const last = path.split('.').pop()!.replace(/\[\d+\]$/, '');
  return ignore.some(i => i === path || i === generic || (!i.includes('.') && !i.includes('[') && i === last));
}

export function diffJson(oldV: unknown, newV: unknown, opt: ParityOptions = {}): Diff[] {
  const ignore = opt.ignore || [], tol = opt.tolerance || 0, max = opt.maxDiffs || 50;
  const out: Diff[] = [];
  const walk = (a: any, b: any, path: string) => {
    if (out.length >= max) return;
    if (path && ignored(path, ignore)) return;
    const ka = kind(a), kb = kind(b);
    if (ka !== kb) { out.push({ path: path || '(root)', old: a, new: b }); return; }
    if (ka === 'number') { if (Math.abs(a - b) > tol) out.push({ path, old: a, new: b }); return; }
    if (ka === 'array') {
      if (a.length !== b.length) out.push({ path: (path || '') + '.length', old: a.length, new: b.length });
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`);
      return;
    }
    if (ka === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of [...keys].sort()) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    if (a !== b) out.push({ path: path || '(root)', old: a, new: b });
  };
  walk(oldV, newV, '');
  return out;
}

export function describe(diffs: Diff[]): string {
  if (!diffs.length) return 'Same answer.';
  return diffs.map(d => `  ${d.path}: Apps Script ${JSON.stringify(d.old)?.slice(0, 80)}  →  new ${JSON.stringify(d.new)?.slice(0, 80)}`).join('\n');
}
