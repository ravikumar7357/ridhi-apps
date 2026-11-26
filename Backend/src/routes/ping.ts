/* ?ping — the first route to move. Apps Script (Code.gs doGet):
 *
 *   if (p.ping) { getToken_(); return json_({ ok: true, pong: true, marketplace: marketplaceId_(), host: spHost_() }); }
 *
 * It proves the key works and Ridhi's Amazon login works. Apps Script never calls setBrand_ here, so it is always SP. */

import type { Route } from '../lib/router.ts';
import { marketplaceId, spHost, spToken } from '../lib/amazon.ts';

export const ping: Route = {
  name: 'ping',
  method: 'GET',
  param: 'ping',
  auth: 'key',
  async run(_p, ctx) {
    await spToken(ctx.env, 'SP');                     // throws if the credentials are wrong
    return { ok: true, pong: true, marketplace: marketplaceId(ctx.env, 'SP'), host: spHost(ctx.env, 'SP') };
  },
};
