// Gate: the basket arithmetic must hold on today's real data.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
execFileSync('npx', ['esbuild', 'src/logic.ts', '--bundle', '--format=esm', '--outfile=/tmp/kniyot-logic.mjs', '--log-level=error']);
const L = await import('/tmp/kniyot-logic.mjs');
const regions = JSON.parse(readFileSync('public/data/regions.json', 'utf8'));
assert.ok(regions.length >= 1, 'at least one region');
for (const region of regions) {
const meta = JSON.parse(readFileSync(`public/data/${region.id}/meta.json`, 'utf8'));
const rows = JSON.parse(readFileSync(`public/data/${region.id}/catalog.json`, 'utf8'));
const byCode = new Map(rows.map((r) => [r[0], r]));
const st = { home: { lat: meta.region.center[0], lon: meta.region.center[1], label: '' }, radius: 0, ref: null, kmCost: 1.4, promos: false };
const basket = meta.sample.map((c) => ({ c, q: 2 }));

assert.ok(meta.stores.length >= 5, 'at least five branches');
assert.ok(rows.length > 3000, 'a real catalog');
assert.ok(basket.length >= 15 && basket.every((b) => byCode.has(b.c)), 'sample basket exists in the catalog');

const rs = L.compute(basket, byCode, meta, st);
for (const r of rs) {
  // a store total is exactly the sum of its lines, and a full store equals the raw shelf prices
  if (r.have === r.lines.length) {
    const raw = basket.reduce((s, b) => s + byCode.get(b.c)[6][r.i] * b.q, 0);
    assert.ok(Math.abs(raw - r.total) < 0.02, `total of ${r.store.name}`);
  }
  assert.equal(r.eligible, r.coverage >= L.COVERAGE_MIN);
}
const rank = L.ranked(rs);
assert.ok(rank.length >= 3, 'enough eligible branches');
assert.ok(rank.every((r, i) => i === 0 || r.total >= rank[i - 1].total), 'ranked ascending');

// promos can only lower a total, never raise it
const withPromos = L.compute(basket, byCode, meta, { ...st, promos: true });
withPromos.forEach((r, i) => assert.ok(r.total <= rs[i].total + 0.001, 'promo never raises a price'));

// the gap breakdown adds up, and buying each product at its cheapest is never worse than the best single store
const ref = rank[rank.length - 1].i;
const p = L.pareto(basket, byCode, rs, ref, false);
assert.ok(Math.abs(p.rows.reduce((s, r) => s + r.gap, 0) - p.sum) < 0.05);
assert.ok(p.sum + 0.01 >= rs[ref].total - rank[0].total - rs[ref].lines.filter((l) => l.estimated).length * 100);
const pair = L.bestPair(rs);
assert.ok(pair && pair.total <= rank[0].total + 0.01, 'two stores are never worse than one');

assert.ok(L.haversine([31.8, 34.65], [31.8, 34.65]) === 0);
assert.ok(Math.abs(L.haversine([31.8, 34.65], [31.81, 34.65]) - 1.11) < 0.02);
assert.equal(L.daysUntil('1125', '2026-11-22'), 3);
assert.equal(L.search('7290000000000000', rows).length, 0);
assert.ok(L.search('קוטג', rows).length > 0);
console.log(`ok ${region.name}: ${rs.length} branches, cheapest ${rank[0].total} at ${L.storeLabel(rank[0].store)}, dearest ${rank[rank.length - 1].total}`);
}
