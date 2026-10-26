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
