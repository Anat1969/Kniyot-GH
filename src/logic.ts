// Pure basket logic: one data source, every view derives from it.

export type Promo = [store: number, unit: number, minQty: number, end: string, desc: string];
export type Row = [code: string, name: string, man: string, qty: string, unit: string, weighted: number, prices: (number | null)[], promos: Promo[]];

export interface Store {
  chain: string; chainName: string; sub: string; id: string; name: string; address: string;
  lat: number | null; lon: number | null; located: boolean; approx?: boolean; city?: string; items: number; fileDate: string;
}
export interface Meta {
  date: string; generatedAt: string;
  region: { id: string; name: string; nameLatin: string; center: [number, number]; radiusKm: number };
  stores: Store[]; failures: { chain: string; store: string; why: string }[]; sample: string[];
  stats: { products: number; singleChain: number; chains: number }; source: string;
}
export interface History { days: string[]; p: Record<string, [number, number][]> }
export interface Item { c: string; q: number }
export interface Settings {
  home: { lat: number; lon: number; label: string };
  radius: number; // km, 0 = whole city
  ref: number | null; // index of "my store"
  kmCost: number; // NIS per km, both ways
  promos: boolean;
  region?: string; // which area's price files are loaded
  homeSet?: boolean; // the user placed the home point
}

export const COVERAGE_MIN = 0.85;

export function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function storeLabel(s: Store): string {
  const subName = s.sub.replace('שופרסל ', '');
  const sub = subName && !s.name.toLowerCase().includes(subName.toLowerCase()) ? subName + ' ' : '';
  let n = s.name.replace(/אשדוד|אשדו$|אש$|ירושלים/g, '').replace(s.city || '\u0000', '').replace(/\(.*?\)/g, '').replace(/\s*[-–]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) n = s.address.split(',')[0].replace(/\d+/g, '').trim() || s.city || '';
  if (s.city && n.replace(subName, '').trim().length < 2) n = `${n} ${s.city}`.trim();
  return `${s.chainName} ${sub}${n}`.replace(/\b(be)\s+be\b/i, '$1').replace(/\s+/g, ' ').trim();
}

/** Price of q units of a row in store i: shelf price, or a public promo when the quantity qualifies. */
export function linePrice(row: Row, i: number, q: number, usePromos: boolean): { total: number; promo: Promo | null } | null {
  const shelf = row[6][i];
  if (shelf == null) return null;
  let total = shelf * q, promo: Promo | null = null;
  if (usePromos) {
    for (const p of row[7]) {
      if (p[0] !== i || q < p[2]) continue;
      const inPromo = Math.floor(q / p[2]) * p[2];
      const t = inPromo * p[1] + (q - inPromo) * shelf;
      if (t < total - 0.001) { total = t; promo = p; }
    }
  }
  return { total: +total.toFixed(2), promo };
}

export interface Line { item: Item; row: Row; total: number | null; promo: Promo | null; estimated: boolean }
export interface StoreResult {
  i: number; store: Store; lines: Line[]; total: number; shelfTotal: number; have: number; coverage: number;
  eligible: boolean; dist: number | null; trip: number; net: number; inRadius: boolean;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function compute(basket: Item[], byCode: Map<string, Row>, meta: Meta, st: Settings): StoreResult[] {
  const items = basket.filter((b) => byCode.has(b.c));
  const n = meta.stores.length;
  const med = items.map((b) => {
    const row = byCode.get(b.c)!;
    const all: number[] = [];
    for (let i = 0; i < n; i++) { const lp = linePrice(row, i, b.q, st.promos); if (lp) all.push(lp.total); }
    return all.length ? median(all) : 0;
  });
  const out: StoreResult[] = [];
  for (let i = 0; i < n; i++) {
    const store = meta.stores[i];
    const dist = store.located ? haversine([st.home.lat, st.home.lon], [store.lat!, store.lon!]) : null;
    let total = 0, shelfTotal = 0, have = 0;
    const lines: Line[] = items.map((b, k) => {
      const row = byCode.get(b.c)!;
      const lp = linePrice(row, i, b.q, st.promos);
      if (lp) { have++; total += lp.total; shelfTotal += row[6][i]! * b.q; return { item: b, row, total: lp.total, promo: lp.promo, estimated: false }; }
      total += med[k]; shelfTotal += med[k];
      return { item: b, row, total: null, promo: null, estimated: true };
    });
    const coverage = items.length ? have / items.length : 0;
    const trip = dist == null ? 0 : 2 * dist * st.kmCost;
    out.push({
      i, store, lines, total: +total.toFixed(2), shelfTotal: +shelfTotal.toFixed(2), have, coverage,
      eligible: coverage >= COVERAGE_MIN, dist, trip: +trip.toFixed(2), net: +(total + trip).toFixed(2),
      inRadius: st.radius === 0 || dist == null || dist <= st.radius,
    });
  }
  return out;
}

export const ranked = (rs: StoreResult[]) => rs.filter((r) => r.eligible && r.inRadius).sort((a, b) => a.total - b.total);

/** Which products carry the gap between my store and the cheapest eligible price for each product. */
export function pareto(basket: Item[], byCode: Map<string, Row>, rs: StoreResult[], refI: number, usePromos: boolean) {
  const pool = rs.filter((r) => r.eligible && r.inRadius);
  const rows = basket.filter((b) => byCode.has(b.c)).map((b) => {
    const row = byCode.get(b.c)!;
    const mine = linePrice(row, refI, b.q, usePromos);
    let best: { total: number; i: number } | null = null;
    for (const r of pool) { const lp = linePrice(row, r.i, b.q, usePromos); if (lp && (!best || lp.total < best.total)) best = { total: lp.total, i: r.i }; }
    const gap = mine && best ? Math.max(0, +(mine.total - best.total).toFixed(2)) : 0;
    return { item: b, row, mine: mine ? mine.total : null, best, gap };
  }).sort((a, b) => b.gap - a.gap);
  const sum = rows.reduce((s, r) => s + r.gap, 0);
  let acc = 0, k = 0;
  for (const r of rows) { if (sum > 0 && acc / sum < 0.7) { acc += r.gap; k++; } }
  return { rows, sum: +sum.toFixed(2), topCount: k, topShare: sum > 0 ? acc / sum : 0 };
}

/** Best pair of stores when each product is bought where it is cheaper. */
export function bestPair(rs: StoreResult[]) {
  const pool = rs.filter((r) => r.inRadius && r.coverage >= 0.5);
  let best: { a: StoreResult; b: StoreResult; total: number; fromA: number } | null = null;
  for (let x = 0; x < pool.length; x++) for (let y = x + 1; y < pool.length; y++) {
    const a = pool[x], b = pool[y];
    let total = 0, fromA = 0, ok = true;
    for (let k = 0; k < a.lines.length; k++) {
      const pa = a.lines[k].total, pb = b.lines[k].total;
      if (pa == null && pb == null) { ok = false; break; }
      if (pb == null || (pa != null && pa <= pb)) { total += pa!; fromA++; } else total += pb;
    }
    if (ok && (!best || total < best.total)) best = { a, b, total: +total.toFixed(2), fromA };
  }
  return best;
}

// ---------- text matching ----------
const norm = (s: string) => s.replace(/["'`׳״.,\-_/\\()*%]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const grams = (s: string) => { const t = norm(s).replace(/ /g, ''); const g = new Set<string>(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
export function similarity(a: string, b: string): number {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

export function search(q: string, rows: Row[], limit = 8): Row[] {
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  if (/^\d{7,14}$/.test(toks[0])) { const c = toks[0].replace(/^0+/, ''); return rows.filter((r) => r[0] === c).slice(0, 1); }
  const hits: { r: Row; s: number }[] = [];
  for (const r of rows) {
    const n = norm(r[1]);
    if (!toks.every((t) => n.includes(t))) continue;
    const cover = r[6].reduce((s: number, x) => s + (x != null ? 1 : 0), 0);
    hits.push({ r, s: cover * 2 - n.length * 0.15 + (n.startsWith(toks[0]) ? 8 : 0) });
  }
  return hits.sort((a, b) => b.s - a.s).slice(0, limit).map((h) => h.r);
}

export interface Match { text: string; qty: number; price: number | null; row: Row | null; score: number; sure: boolean; options: Row[] }
/** Match a free-text line (receipt or list) to a product. A price that equals a shelf price is strong evidence. */
export function matchLine(text: string, qty: number, unitPrice: number | null, rows: Row[], barcode?: string): Match {
  if (barcode) {
    const c = barcode.replace(/^0+/, ''); const r = rows.find((x) => x[0] === c);
    if (r) return { text, qty, price: unitPrice, row: r, score: 1, sure: true, options: [r] };
  }
  const priced = (r: Row) => unitPrice != null && r[6].some((p) => p != null && Math.abs(p - unitPrice) < 0.011);
  const scored: { r: Row; s: number }[] = [];
  for (const r of rows) {
    let s = similarity(text, r[1]);
    if (s < 0.25) continue;
    if (priced(r)) s += 0.3;
    scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored[0];
  // sure only when the name is close, the runner-up is clearly behind, and a known price agrees
  const sure = !!top && top.s >= 0.75 && (!scored[1] || top.s - scored[1].s > 0.08) && (unitPrice == null || priced(top.r));
  return { text, qty, price: unitPrice, row: top ? top.r : null, score: top ? top.s : 0, sure, options: scored.slice(0, 4).map((x) => x.r) };
}

export const nis = (x: number, d = 0) => x.toLocaleString('he-IL', { minimumFractionDigits: d, maximumFractionDigits: d });
export const unitText = (r: Row) => { const q = parseFloat(r[3]); return q > 0 && r[4] && !/לא ידוע|unknown/i.test(r[4]) ? `${+q.toFixed(2)} ${r[4]}` : ''; };
export function daysUntil(mmdd: string, today: string): number | null {
  if (!mmdd) return null;
  const y = +today.slice(0, 4), t = new Date(today + 'T00:00:00Z').getTime();
  let d = Date.UTC(y, +mmdd.slice(0, 2) - 1, +mmdd.slice(2, 4));
  if (d < t - 86400e3 * 30) d = Date.UTC(y + 1, +mmdd.slice(0, 2) - 1, +mmdd.slice(2, 4));
  return Math.round((d - t) / 86400e3);
}
