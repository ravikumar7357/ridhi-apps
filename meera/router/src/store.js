/* WHAT THE ROUTER KEEPS, in D1 (schema.sql): how many questions went to a model today, the answers by question, and tickets.
 * Every write is one small row — D1's free ~100,000 writes a day, not KV's 1,000. */

/** Today in India (the limits reset at midnight IST, when the office day starts). */
export function today(now = Date.now()) {
  return new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
}
const stamp = (now = Date.now()) => new Date(now).toISOString();

export function store(db) {
  return {
    /** Count one model question for this person and for the company; false when either is over its limit for the day. */
    async take(uid, userMax, companyMax, now) {
      const day = today(now);
      const up = 'INSERT INTO usage (day, who, n) VALUES (?1, ?2, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1 RETURNING n';
      const [mine, all] = await db.batch([db.prepare(up).bind(day, uid), db.prepare(up).bind(day, '*')]);
      const n1 = (mine.results && mine.results[0] || {}).n || 0, n2 = (all.results && all.results[0] || {}).n || 0;
      return { ok: n1 <= userMax && n2 <= companyMax, mine: n1, all: n2 };
    },
    /** The last approved answer for exactly this (cleaned) question, if any. */
    async saved(qkey) {
      return db.prepare("SELECT id, answer, source FROM answers WHERE qkey = ?1 AND status = 'approved' ORDER BY id DESC LIMIT 1").bind(qkey).first();
    },
    async addAnswer({ qkey, question, lang, screen, answer, source, status = 'pending', email = '' }, now) {
      const r = await db.prepare('INSERT INTO answers (qkey, question, lang, screen, answer, source, status, created, by_email) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id')
        .bind(qkey, question, lang || '', screen || '', JSON.stringify(answer), source, status, stamp(now), email).first();
      return r && r.id;
    },
    async vote(id, up) {
      await db.prepare(up ? 'UPDATE answers SET up = up + 1 WHERE id = ?1' : 'UPDATE answers SET down = down + 1 WHERE id = ?1').bind(id).run();
    },
    async ticket({ uid, email, screen, question, why }, now) {
      const r = await db.prepare("INSERT INTO tickets (created, uid, email, screen, question, why, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open') RETURNING id")
        .bind(stamp(now), uid || '', email || '', screen || '', question, why || '').first();
      return r && r.id;
    },
    async tickets(status = 'open', limit = 200) {
      const r = await db.prepare('SELECT id, created, email, screen, question, why, status, answer_id FROM tickets WHERE status = ?1 ORDER BY id DESC LIMIT ?2').bind(status, limit).all();
      return r.results || [];
    },
    async answers(status = 'pending', limit = 200) {
      const r = await db.prepare('SELECT id, question, lang, screen, answer, source, status, up, down, created FROM answers WHERE status = ?1 ORDER BY id DESC LIMIT ?2').bind(status, limit).all();
      return (r.results || []).map(x => ({ ...x, answer: safeJson(x.answer) }));
    },
    /** An admin's answer, or an admin approving / turning down a model's answer. */
    async setStatus(id, status) {
      await db.prepare('UPDATE answers SET status = ?2 WHERE id = ?1').bind(id, status).run();
    },
    async closeTicket(id, answerId) {
      await db.prepare("UPDATE tickets SET status = 'answered', answer_id = ?2 WHERE id = ?1").bind(id, answerId || null).run();
    },
    /* ---- learning from staff (Phase 4) ---- */
    /** Count one learning record for this person today (who: a hash of their sign-in, never stored with the record). */
    async learnTake(who, max, now) {
      const r = await db.prepare('INSERT INTO usage (day, who, n) VALUES (?1, ?2, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1 RETURNING n')
        .bind(today(now), who).first();
      return ((r && r.n) || 0) <= max;
    },
    async learnAdd({ kind, question, qkey, screen, lang, role, answer, key }, now) {
      const r = await db.prepare("INSERT INTO learn (created, kind, question, qkey, screen, lang, role, answer, note, status, key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '', 'new', ?9) RETURNING id")
        .bind(stamp(now), kind, question, qkey, screen || '', lang || '', role || '', answer || '', key || '').first();
      return r && r.id;
    },
    /** The one-line note after a 👎 — only with the key that record was given. */
    async learnNote(id, key, note) {
      const r = await db.prepare("UPDATE learn SET note = ?3 WHERE id = ?1 AND key = ?2 AND key != '' AND note = '' RETURNING id").bind(id, key, note).first();
      return !!r;
    },
    /** Older than 90 days: gone. And yesterday's learning counters. */
    async learnPurge(now) {
      await db.batch([
        db.prepare('DELETE FROM learn WHERE created < ?1').bind(stamp(now - 90 * 864e5)),
        db.prepare("DELETE FROM usage WHERE who LIKE 'L:%' AND day < ?1").bind(today(now - 2 * 864e5)),
      ]);
    },
    /** What an admin sees: this week's unanswered (most asked first), suggested spellings, 👎s. */
    async learnView(now) {
      const week = stamp(now - 7 * 864e5);
      const unanswered = await db.prepare(`SELECT MIN(question) AS question, screen, lang, COUNT(*) AS n, MAX(created) AS last, GROUP_CONCAT(id) AS ids,
          SUM(kind = 'unsure') AS unsure FROM learn WHERE kind IN ('missed', 'unsure') AND status = 'new' AND created >= ?1
          GROUP BY qkey ORDER BY n DESC, last DESC LIMIT 60`).bind(week).all();
      const spellings = await db.prepare(`SELECT MIN(question) AS question, answer, lang, COUNT(*) AS n, MAX(created) AS last, GROUP_CONCAT(id) AS ids
          FROM learn WHERE kind = 'spelling' AND status = 'new' GROUP BY qkey, answer ORDER BY n DESC, last DESC LIMIT 60`).all();
      const down = await db.prepare(`SELECT id, created, question, screen, lang, answer, note, role FROM learn WHERE kind = 'down' AND status = 'new'
          ORDER BY id DESC LIMIT 100`).all();
      const ids = r => (r.results || []).map(x => ({ ...x, ids: String(x.ids || '').split(',').map(Number).filter(Boolean) }));
      return { unanswered: ids(unanswered), spellings: ids(spellings), down: down.results || [] };
    },
    /** An admin's decision on records: done (an answer was added), approved (a spelling), rejected. */
    async learnSet(ids, status) {
      const list = (ids || []).map(Number).filter(Boolean).slice(0, 200);
      if (!list.length) return 0;
      await db.batch(list.map(id => (status === 'approved'
        ? db.prepare("UPDATE learn SET status = 'approved' WHERE id = ?1 AND kind = 'spelling'").bind(id)
        : db.prepare('UPDATE learn SET status = ?2 WHERE id = ?1').bind(id, status))));
      return list.length;
    },
    /** Approved spellings: a new way of asking for one of her answers. */
    async spellings(limit = 2000) {
      const r = await db.prepare("SELECT question, answer, lang FROM learn WHERE kind = 'spelling' AND status = 'approved' GROUP BY qkey, answer ORDER BY MAX(id) DESC LIMIT ?1").bind(limit).all();
      return r.results || [];
    },
    /** Every approved answer: they join Meera's own list in every browser. */
    async learned(limit = 2000) {
      const r = await db.prepare("SELECT id, question, lang, screen, answer FROM answers WHERE status = 'approved' ORDER BY id DESC LIMIT ?1").bind(limit).all();
      return (r.results || []).map(x => ({ ...x, answer: safeJson(x.answer) }));
    },
  };
}
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return { a: String(s || '') }; } }
