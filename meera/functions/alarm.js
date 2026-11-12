/* THE CENT ALARM (Ravi, 3 Nov: "on ANY actual cost above zero, it turns the router's 'Search on the server' switch off and
 * sets the function to stop serving … It must NEVER disable billing for the project").
 * Google's budget for the project (the smallest amount it allows) sends its figures to the Pub/Sub topic "meera-budget"
 * several times a day; index.js hands each message here. Any cost above 0 → (1) her router's switch off (/alarm, with its
 * key) — every browser searches on its own; (2) the search function's door shut (stop.js). Nothing else is touched: no
 * billing call exists in this file or anywhere in meera/functions (her tests check). Cost 0 → nothing happens. */
export function makeAlarm({ env, fetcher = fetch, stopServing }) {
  return {
    /** one budget message (the JSON Google sends): what was done */
    async onBudget(msg) {
      const cost = Number(msg && msg.costAmount);
      if (!(cost > 0)) return { acted: false, cost: Number.isFinite(cost) ? cost : null };
      const done = { acted: true, cost, router: false, door: false };
      try {
        const r = await fetcher(String(env.ROUTER_URL || '').replace(/\/$/, '') + '/alarm', { method: 'POST', headers: { 'x-stop-key': String(env.STOP_KEY || ''), 'content-type': 'application/json' },
          body: JSON.stringify({ cost, currency: msg.currencyCode || '', budget: msg.budgetDisplayName || '' }) });
        done.router = r.ok;
      } catch (e) { /* her router out of reach: the door below still shuts */ }
      try { done.door = !!(await stopServing()).ok; } catch (e) { /* tried */ }
      return done;
    },
  };
}
