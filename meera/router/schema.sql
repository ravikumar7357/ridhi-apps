-- Meera's router: the D1 database (free: ~100,000 writes a day). Safe to run again: it only creates what is missing.

-- How many questions went to a model, per person per day and for the whole company ('*').
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,          -- 2026-10-26 (India time)
  who TEXT NOT NULL,          -- Firebase uid, or '*' for the company
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);

-- Answers by question: a model's answer waits as 'pending'; an admin's answer, or one an admin approved, is 'approved'
-- and is given straight back the next time (no model), and is offered to every browser to join Meera's own answers.
CREATE TABLE IF NOT EXISTS answers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  qkey     TEXT NOT NULL,     -- the cleaned question, normalised
  question TEXT NOT NULL,     -- the cleaned question as asked
  lang     TEXT,
  screen   TEXT,
  answer   TEXT NOT NULL,     -- JSON: {a, why, steps[]}
  source   TEXT NOT NULL,     -- groq / workers-ai / gemini / admin
  status   TEXT NOT NULL DEFAULT 'pending',
  up       INTEGER NOT NULL DEFAULT 0,
  down     INTEGER NOT NULL DEFAULT 0,
  created  TEXT NOT NULL,
  by_email TEXT
);
CREATE INDEX IF NOT EXISTS answers_qkey ON answers (qkey, status);

-- What nobody could answer, or an answer that did not help: for an admin, when online.
CREATE TABLE IF NOT EXISTS tickets (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  created  TEXT NOT NULL,
  uid      TEXT,
  email    TEXT,
  screen   TEXT,
  question TEXT NOT NULL,     -- cleaned
  why      TEXT,              -- no-answer / not-helpful / limit / models-down
  status   TEXT NOT NULL DEFAULT 'open',
  answer_id INTEGER
);
CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status, created);

-- LEARNING FROM STAFF (Phase 4, 29 Oct 2026; Meera's switch "learn"). What she could not answer, was not sure of, a 👎,
-- and a misspelt question followed by the answer the person then chose. The question is cleaned twice (the browser,
-- then here: names, phones, order numbers, amounts…); no email, no name, no sign-in id — only the role. Nothing here
-- reaches her answers until an admin approves it. Rows older than 90 days are removed.
CREATE TABLE IF NOT EXISTS learn (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  created  TEXT NOT NULL,
  kind     TEXT NOT NULL,     -- missed / unsure / down / spelling
  question TEXT NOT NULL,     -- cleaned
  qkey     TEXT NOT NULL,     -- the cleaned question, normalised: the same question counted once
  screen   TEXT,
  lang     TEXT,
  role     TEXT,              -- staff / admin / vendor
  answer   TEXT,              -- what she gave (her answer ids), or for a spelling the answer chosen
  note     TEXT,              -- "What were you looking for?" after a 👎 (cleaned, optional)
  status   TEXT NOT NULL DEFAULT 'new',   -- new / done / approved / rejected
  key      TEXT               -- lets the browser that sent a 👎 add its one-line note, nothing else
);
CREATE INDEX IF NOT EXISTS learn_kind ON learn (kind, status, created);
CREATE INDEX IF NOT EXISTS learn_created ON learn (created);

-- SEARCH ON THE SERVER (Phase 5, 2 Nov 2026). Her answers and walk-throughs, as in meera-bank.json and meera-walks.json,
-- loaded at each deploy (kb-sql.cjs); answers an admin approves (table answers) join them at once, with no deploy.
CREATE TABLE IF NOT EXISTS kb (
  id   TEXT PRIMARY KEY,
  kind TEXT NOT NULL,         -- answer / walk
  body TEXT NOT NULL          -- the entry, JSON, exactly as in her files
);
-- Her switches on the router, changed by an admin with no deploy: meera, ai, search ('on' / 'off'); kb_version goes up
-- whenever her answers change, so every router copy reloads them.
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Side by side: the browser's answer and the server's to the same question (cleaned), while both run. Kept 90 days.
CREATE TABLE IF NOT EXISTS diffs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,
  question TEXT NOT NULL,     -- cleaned
  screen  TEXT,
  spell   INTEGER NOT NULL DEFAULT 0,
  browser TEXT,               -- top answers with scores: id:score,id:score,…
  server  TEXT,
  same    INTEGER NOT NULL    -- 1 when both would say the same (same first answer, both sure or both not)
);
CREATE INDEX IF NOT EXISTS diffs_created ON diffs (created);
