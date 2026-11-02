/* WHAT HER NEW FILES USE FROM HER OLDER ONES (v2 rebuild, Phase 6). Read by the strict type check only
 * (tsconfig.json); the check of all her files together (tsconfig.legacy.json) sees the real ones instead. */
declare let GA_BANK: { list: MdEntry[] } | null;
declare let GA_BANK_P: Promise<unknown> | null;
declare let GA_W: unknown;
declare const GA_AI_URL: string;
declare const GUIDE: { tour: unknown };
declare const GUIDE_STOP: Set<string>;
declare const guideLang: () => string;
