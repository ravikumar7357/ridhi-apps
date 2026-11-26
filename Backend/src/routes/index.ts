/* Every route that has moved from Apps Script. Add one line per route as it moves; ROUTES.md tracks the rest.
 * Order matters only when two routes share a parameter without a value (none do today). */

import type { Route } from '../lib/router.ts';
import { ping } from './ping.ts';
import { weeklyKeysRoute } from './weekly-keys.ts';
import { listingPeriods } from './listing-periods.ts';
import { adsProfiles } from './ads-profiles.ts';

export const ROUTES: Route[] = [
  ping,
  weeklyKeysRoute,
  listingPeriods,
  adsProfiles,
];
