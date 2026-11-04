/* THE ROUTER'S ENTRY ON CLOUDFLARE'S FREE PLAN (Ravi, 2 Nov 2026: "I'm not taking Workers Paid"). Everything is worker.js —
 * the AI answers, her learning records, the admin page's lists, her switches — without her search on the server, so her
 * meaning table (meera-words.bin, 1.3 MB) is not bundled. wrangler.toml points here and sets SEARCH = "parked".
 * With Workers Paid one day, point wrangler.toml back to index.js (it bundles the meaning table) and remove SEARCH. */
import { handle } from './worker.js';

export default { fetch: (req, env) => handle(req, env) };
