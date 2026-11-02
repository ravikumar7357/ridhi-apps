/* THE CONTRACT BETWEEN THE ERP AND MEERA (v2 rebuild, 29 Oct 2026).
 *
 * What the ERP promises to give Meera — window.ERP_MEERA, made by Replenish-App/src/app/core/meera-bridge.js — and
 * nothing else. Meera may use only this to learn about the ERP or act in it; the ERP may change anything inside itself
 * as long as this stays true. A change here is a change to both sides: bump `v`. */

/** Who is signed in. */
interface ErpMeeraUser {
  email: string;
  /** an admin may open every screen */
  admin: boolean;
  /** the screens this person may open ([] with admin false = every screen, as the ERP itself treats it) */
  tabs: string[];
  /** a printer's own sign-in (the Vendor Portal), not staff */
  vendor: boolean;
}

interface ErpMeera {
  /** the contract's version */
  v: number;
  user(): ErpMeeraUser;
  signedIn(): boolean;
  /** the signed-in person's token, for her router; null when nobody is signed in */
  token(): Promise<string | null>;
  /** the screen open now: 'pbase', 'shop', 'qc' … ('' before one opens) */
  screen(): string;
  /** open a screen by the ERP's own rules; false if it could not */
  openScreen(tab: string): boolean;
  /** karigars' and staff names, to recognise "Ramesh ko …" */
  people(): string[];
  /** the ERP's own names (SKUs, brands, colours, parties, master lists) — her spelling step leaves these as typed (v2) */
  words(): string[];
  /** true on the phone layout */
  phone(): boolean;
  /** 'screen' (tab) — a screen just opened */
  on(event: 'screen', fn: (tab: string) => void): void;
  /** one of her switches (meera-bridge.js, MEERA_SWITCHES) */
  switchOn(name: string): boolean;
  /** Phase 7 (switch "data"): the ERP's own figures, READ ONLY, from this page's memory — never a database read */
  data?: ErpMeeraData;
}
/** where a figure comes from: its screen and when that screen last read it — or why there is none */
interface ErpMeeraFrom { tab: string; name?: string; asOf?: string; denied?: boolean; notLoaded?: boolean }
interface ErpMeeraData {
  orders(): string[];
  findOrder(no: string): { from: ErpMeeraFrom; none?: boolean; order?: { orderNo: string; lines: { sku: string; qty: number; at: string }[]; pcs: number; open: boolean;
    karigars: [string, number][]; last: { ms: number; by: string; kind: string } | null; idle: number; late: boolean } };
  karigars(): string[];
  karigarHolding(name: string): { from: ErpMeeraFrom; name?: string; pieces?: number; rows?: { orderNo: string; sku: string; pcs: number; given: string }[] };
  skus(): string[];
  skuStock(sku: string): { from: ErpMeeraFrom; sku?: string; current?: number; pending?: number };
  waitingAt(stage: string): { from: ErpMeeraFrom; stage?: string; lines?: { orderNo: string; sku: string; pcs: number }[]; pcs?: number };
  today(): { base: ErpMeeraFrom; qc: ErpMeeraFrom; issued?: { pcs: number; entries: number }; received?: { pcs: number; entries: number }; passed?: { pcs: number; checks: number } };
  late(): { from: ErpMeeraFrom; days?: number; orders?: { orderNo: string; idle: number; at: string }[] };
  /** only from a button the person pressed: 'order' | 'karigar' | 'sku' | a screen */
  open(kind: string, key: string): boolean;
}
