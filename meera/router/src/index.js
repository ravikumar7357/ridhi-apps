/* THE ROUTER'S ENTRY on Cloudflare (Phase 5): her meaning table, bundled with the router (wrangler.toml [[rules]] Data),
 * handed to the router; then everything is worker.js. Tests use worker.js directly with the table read from disk. */
import WORDS from '../../../Replenish-App/public/guide/meera-words.bin';
import { handle, setWords } from './worker.js';

setWords(WORDS);
export default { fetch: (req, env) => handle(req, env) };
