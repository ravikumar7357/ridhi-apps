/* MEERA AS HER OWN FILE — what meera.js does AFTER her files (v2 rebuild, Phase 1, 29 Oct 2026).
 * Her files have started her (button, menu, watchers). The screen that was already open when she arrived gets its
 * first-visit walk-round now — its "screen opened" moment came before she was here. And a small handle for her tests
 * and for support: window.MEERA. */
declare function guideScreen(tab: string): void;
declare function gaAnswer(q: string): Promise<{ html?: string; acts?: { t: string; id?: string; tab?: string }[]; bank?: string; miss?: unknown; off?: boolean }>;
declare function gaSpellFind(q: string): { e: { id: string }; s: number }[];
declare function gaSpell(q: string): { text: string; changes: { from: string; to: string }[] };
declare function gaRead(q: string): { means: string[]; words: string[]; lang: string };
declare function gaBankFind(means: string[], words: string[], q: string): { e: { id: string }; s: number }[];
declare function gaBankLoad(): Promise<unknown>;
declare function gaWordsLoad(): Promise<unknown>;
declare function gaSemIndex(): unknown;
declare const __MEERA_VERSION__: string;

try { const tab = ERP_MEERA.screen(); if (tab) guideScreen(tab); } catch (e) { /* no screen yet: the next one opens through the bridge */ }

(window as any).MEERA = {
  version: __MEERA_VERSION__,
  stopped: () => MEERA_STOPPED,
  /* her answer to a question on the screen open now — for her tests and for support */
  answer: (q: string) => gaAnswer(q),
  /* how she reads a question (spelling, Phase 2): the text she understood and each word she changed */
  understand: (q: string) => gaSpell(q),
  find: (q: string) => gaSpellFind(q).map(h => ({ id: h.e.id, s: h.s })),
  ready: async () => { await gaBankLoad(); await gaWordsLoad(); gaSemIndex(); return true; },
};
