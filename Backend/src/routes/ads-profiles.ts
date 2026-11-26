/* ?ads=profiles — every advertising profile each brand's Ads login can see. Apps Script (Code.gs doGet):
 *
 *   if (p.ads === 'profiles') return json_(adsProfilesBoth_());
 *
 * Ported from Pricing-API/AdsApi.gs adsProfilesBoth_. It is the Ads connection test: it proves each brand's three
 * ADS_* values are right AND shows which profile the PPC pull should be scoped to.
 *
 * A brand that fails reports its own error rather than sinking the whole answer: one brand's login being wrong
 * should not hide that the other's is fine. So the answer is ok:true even when both brands fail, as in Apps Script.
 *
 * One difference, by design: the call goes through the Amazon gateway, so it obeys the switches. Until
 * owner:ads-profiles is set to "backend", each brand answers ok:false with "Not fetched: … belongs to apps-script".
 * Listing profiles fetches no report and fills no table, so handing it over first is safe. */

import type { Route } from '../lib/router.ts';
import { amazonGateway } from '../lib/router.ts';
import { adsHost } from '../lib/amazon.ts';
import type { Brand } from '../lib/env.ts';

interface AmazonProfile {
  profileId: number | string;
  countryCode?: string;
  currencyCode?: string;
  accountInfo?: { type?: string; name?: string; marketplaceStringId?: string; id?: string };
}

export const adsProfiles: Route = {
  name: 'ads:profiles',
  method: 'GET',
  param: 'ads',
  value: 'profiles',
  auth: 'key',
  async run(_p, ctx) {
    const gw = await amazonGateway(ctx);
    const brands: Record<string, object> = {};
    for (const b of ['SP', 'CPC'] as Brand[]) {
      try {
        const list = (await gw.call<AmazonProfile[]>('ads.profiles', b, { path: '/v2/profiles' }, { dataset: 'ads-profiles' })) || [];
        brands[b] = {
          ok: true,
          host: adsHost(ctx.env, b),
          configured: ctx.env(b + '_ADS_PROFILE_ID') || '',
          profiles: list.map(p => {
            const a = p.accountInfo || {};
            return {
              profileId: String(p.profileId),
              country: p.countryCode || '',
              currency: p.currencyCode || '',
              type: a.type || '',
              name: a.name || '',
              marketplace: a.marketplaceStringId || '',
              sellerId: a.id || '',
            };
          }),
        };
      } catch (e) {
        brands[b] = { ok: false, error: String((e as Error)?.message || e) };
      }
    }
    await gw.flush(ctx.db);
    return { ok: true, brands };
  },
};
