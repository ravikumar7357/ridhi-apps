/* Every save that has moved from the browser to roneSave. Empty until the save door (sign-in check, rights from
 * login, month lock, one transaction with the change log) is built and the first ERP screen moves.
 *
 * Every save route uses auth: 'signin', so the router checks the Firebase ID token before the route runs. */

import type { Route } from '../lib/router.ts';

export const SAVE_ROUTES: Route[] = [];
