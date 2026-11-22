import { useEffect, useMemo, useRef, useState } from 'react';
import { nis, storeLabel, type StoreResult } from './logic';
import type { Data } from './state';

/** The cover: a receipt unrolls, every line travels to the branch where it is cheapest, and the total drops. Built from today's real prices. */
export default function Cover({ data, results, best, refR }: { data: Data; results: StoreResult[]; best: StoreResult | null; refR: StoreResult | null }) {
  const W = 1600, H = 860, cx = 600, cy = 470;
  const [t, setT] = useState(0); // seconds
  const [run, setRun] = useState(0);
  const raf = useRef(0);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scene = useMemo(() => {
    const pool = results.filter((r) => r.eligible && r.dist != null);
    if (!pool.length || !best) return null;
    const high = [...pool].sort((a, b) => b.total - a.total)[0];
    const from = refR && refR.total > best.total ? refR : high;
    const maxD = Math.max(1.5, ...pool.map((r) => r.dist!));
    const scale = 330 / (maxD * 1.05);
    const home = data.meta.region.center;
    const kmLon = 111.2 * Math.cos((home[0] * Math.PI) / 180);
    const pos = new Map(pool.map((r) => [r.i, { x: cx + (r.store.lon! - home[1]) * kmLon * scale, y: cy - (r.store.lat! - home[0]) * 111.2 * scale }]));
    const lines = from.lines.filter((l) => l.total != null).slice(0, 22).map((l, k) => {
      let to = from, price = l.total!;
      for (const r of pool) { const x = r.lines.find((y) => y.item.c === l.item.c); if (x && x.total != null && x.total < price - 0.005) { price = x.total; to = r; } }
      return { k, name: l.row[1], was: l.total!, now: price, to: to.i };
    });
    const was = lines.reduce((s, l) => s + l.was, 0), now = lines.reduce((s, l) => s + l.now, 0);
    return { pool, pos, lines, was, now, from, maxD, scale };
  }, [results, best, refR, data]);

  useEffect(() => {
    if (reduced) { setT(99); return; }
    const t0 = performance.now();
    const tick = (n: number) => { const s = (n - t0) / 1000; setT(s); if (s < 12) raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [run, reduced]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'r' || e.key === 'R' || e.key === 'ר') setRun((x) => x + 1); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);

  if (!scene) return <main className="cover"><a className="btn primary press open" href="#/where">פתיחה</a></main>;
  const { pool, pos, lines, was, now, from, maxD, scale } = scene;
  const rx = 1150, rw = 380, rowH = 27, top = 120;
  const start = (k: number) => 0.8 + k * 0.3, fly = 1.1;
  const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3));
  const landed = new Map<number, number>();
  let total = 0;
  for (const l of lines) {
    const p = ease((t - start(l.k) - 0.25) / fly);
    total += l.was + (l.now - l.was) * p;
    if (p >= 1) landed.set(l.to, (landed.get(l.to) || 0) + 1);
  }
  const shownLines = lines.filter((l) => t >= start(l.k));
  const paperH = Math.min(lines.length, Math.max(1, shownLines.length)) * rowH + 78;
  const done = t > start(lines.length - 1) + fly + 0.6;
  const rings: number[] = []; for (let d = 1; d <= maxD * 1.1; d += maxD > 6 ? 2 : 1) rings.push(d);

  return (
    <main className="cover">
      <svg viewBox={`0 0 ${W} ${H}`} className="cover-svg" style={{ direction: 'ltr' }} role="img" aria-label={`הסל יורד מ-${nis(was)} ל-${nis(now)} שקלים כשכל מוצר נקנה במקום הזול ביותר`}>
        {rings.map((d) => <circle key={d} cx={cx} cy={cy} r={d * scale} fill="none" stroke="#2E2E2B" strokeOpacity={0.12} strokeDasharray="2 6" />)}
        <circle cx={cx} cy={cy} r={6} fill="#2E2E2B" />
        {pool.map((r) => {
          const p = pos.get(r.i)!; const n = landed.get(r.i) || 0; const h = 10 + n * 9;
          const isBest = best && r.i === best.i;
          return (
            <g key={r.i} opacity={ease(t / 0.8)}>
              <ellipse cx={p.x} cy={p.y} rx={17} ry={6} fill="#2E2E2B" opacity={0.1} />
              <rect x={p.x - 11} y={p.y - h} width={22} height={h} fill={n ? (isBest ? '#2F7D5B' : '#8FB8A3') : '#D8D6D0'} />
              {(isBest || n >= 4) && <text x={p.x + 18} y={p.y - h + 4} className="cv-store">{storeLabel(r.store)}</text>}
            </g>
          );
        })}

        <g className="paper">
          <rect x={rx} y={top - 54} width={rw} height={paperH} fill="#fff" filter="drop-shadow(0 10px 24px rgba(46,46,43,.16))" />
          <text x={rx + rw - 22} y={top - 22} textAnchor="end" className="cv-head">{storeLabel(from.store)}</text>
          <line x1={rx + 22} x2={rx + rw - 22} y1={top - 8} y2={top - 8} stroke="#2E2E2B" strokeOpacity={0.25} strokeDasharray="3 4" />
          {shownLines.map((l) => {
            const p = ease((t - start(l.k) - 0.25) / fly);
            return (
              <g key={l.k} opacity={ease((t - start(l.k)) / 0.25)}>
                <text x={rx + rw - 22} y={top + 14 + l.k * rowH} textAnchor="end" className="cv-line">{l.name.slice(0, 30)}</text>
                <text x={rx + 22} y={top + 14 + l.k * rowH} className={`cv-num${l.now < l.was && p >= 1 ? ' cut' : ''}`}>{nis(l.was, 2)}</text>
              </g>
            );
          })}
        </g>
        {lines.map((l) => {
          const p = ease((t - start(l.k) - 0.25) / fly);
          if (p <= 0 || p >= 1 || l.now >= l.was) return null;
          const to = pos.get(l.to)!; const sx = rx + 40, sy = top + 10 + l.k * rowH;
          const x = sx + (to.x - sx) * p, y = sy + (to.y - 20 - sy) * p - Math.sin(p * Math.PI) * 70;
          return <g key={'f' + l.k}><rect x={x - 26} y={y - 12} width={52} height={22} fill="#2F7D5B" /><text x={x} y={y + 4} textAnchor="middle" className="cv-fly">{nis(l.now, 2)}</text></g>;
        })}

        <g>
          <text x={96} y={150} className="cv-title">קניות</text>
          <text x={96} y={700} className="cv-total">{nis(total)} ₪</text>
          <text x={96} y={742} className="cv-was" opacity={done ? 1 : 0}>{nis(was)} ₪</text>
          <rect x={96} y={760} width={Math.max(0, ((was - total) / Math.max(1, was - now)) * 330)} height={6} fill="#2F7D5B" />
          <text x={96} y={796} className="cv-save" opacity={done ? 1 : 0}>פחות {nis(was - now)} ₪ על אותו סל, {data.meta.region.name}, {+data.meta.date.slice(8, 10)}.{+data.meta.date.slice(5, 7)}</text>
        </g>
      </svg>
      <div className="cover-actions">
        <a className="btn primary press open" href="#/where">פתיחה</a>
        <button className="btn ghost press" onClick={() => setRun((x) => x + 1)} title="מקש R">שוב</button>
      </div>
    </main>
  );
}
