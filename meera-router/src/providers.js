/* THE MODELS, in order: Groq first (fast, free tier), then Cloudflare Workers AI (free daily allowance, no key — the
 * Worker's own binding), then Gemini (free tier) — and Gemini only for a question with nothing in it that looks like a
 * record, because Google may use free-tier prompts to improve its models. A model that is not set up, fails, is slow or
 * is over its limit is passed over. Model names are settings (wrangler.toml), so a retired model is a one-line change. */
import { hasRecordLike } from './redact.js';

const TIMEOUT = 15000;
async function post(fetcher, url, headers, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export const PROVIDERS = [
  {
    name: 'groq',
    ready: env => !!env.GROQ_API_KEY,
    async ask(env, sys, user, fetcher) {
      const j = await post(fetcher, 'https://api.groq.com/openai/v1/chat/completions', { authorization: 'Bearer ' + env.GROQ_API_KEY }, {
        model: env.GROQ_MODEL, temperature: 0.2, max_tokens: 700, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
      return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    },
  },
  {
    name: 'workers-ai',
    ready: env => !!(env.AI && env.CF_AI_MODEL),
    async ask(env, sys, user) {
      const r = await env.AI.run(env.CF_AI_MODEL, { max_tokens: 700, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] });
      return r && (typeof r.response === 'string' ? r.response : JSON.stringify(r.response));
    },
  },
  {
    name: 'gemini',
    ready: (env, q) => !!env.GEMINI_API_KEY && !hasRecordLike(q),
    async ask(env, sys, user, fetcher) {
      const j = await post(fetcher, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
        { 'x-goog-api-key': env.GEMINI_API_KEY }, {
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: 'application/json' } });
      const p = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      return p && p.map(x => x.text || '').join('');
    },
  },
];

/** A model's reply, read as {found, a, why, steps}; null when it is not that shape. */
export function readReply(text) {
  if (!text) return null;
  const s = String(text), i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  let o;
  try { o = JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
  const str = v => (typeof v === 'string' ? v.trim().slice(0, 1200) : '');
  const out = { found: o.found !== false && !!str(o.a), a: str(o.a), why: str(o.why), steps: Array.isArray(o.steps) ? o.steps.map(str).filter(Boolean).slice(0, 6) : [] };
  return out;
}

/** Ask the models in order; the first good answer wins. Returns { reply, source, tried }. */
export async function askModels(env, sys, user, cleanedQ, fetcher = fetch) {
  const tried = [];
  for (const p of PROVIDERS) {
    if (!p.ready(env, cleanedQ)) continue;
    try {
      const reply = readReply(await p.ask(env, sys, user, fetcher));
      tried.push(p.name + (reply ? ':ok' : ':bad'));
      if (reply) return { reply, source: p.name, tried };
    } catch (e) { tried.push(p.name + ':' + String(e && e.message || e).slice(0, 40)); }
  }
  return { reply: null, source: '', tried };
}
