import { useEffect, useMemo, useRef, useState } from 'react';
import { nis, storeLabel, type StoreResult } from './logic';

interface Props {
  results: StoreResult[]; bestI: number | null; refI: number | null; selI: number | null;
  hoverI: number | null; onHover: (i: number | null) => void; onSelect: (i: number) => void;
  home: { lat: number; lon: number; label: string }; onMoveHome?: (lat: number, lon: number) => void;
}

/** Distance against price in one picture: rings are kilometres from home, a column's height is the basket's price. */
export default function RingMap({ results, bestI, refI, selI, hoverI, onHover, onSelect, home }: Props) {
  const [box, setBox] = useState({ w: 800, h: 520 });
  const W = box.w, H = box.h, cx = W / 2, cy = H * 0.6;
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 50) setBox({ w: Math.round(r.width), h: Math.round(r.height) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const located = results.filter((r) => r.dist != null);
  const kmLat = 111.2, kmLon = 111.2 * Math.cos((home.lat * Math.PI) / 180);
  const km = located.map((r) => ({ r, e: (r.store.lon! - home.lon) * kmLon, n: (r.store.lat! - home.lat) * kmLat }));
  const ext = (f: (p: { e: number; n: number }) => number) => Math.max(0.6, ...km.map(f));
  const maxD = Math.max(1.5, ...located.map((r) => r.dist!));
  const colMax = Math.min(130, H * 0.24);
  const scale = Math.min((W / 2 - 70) / ext((p) => Math.abs(p.e)), (H * 0.6 - colMax - 60) / ext((p) => p.n), (H * 0.4 - 26) / ext((p) => -p.n)); // px per km
  const ringStep = maxD > 6 ? 2 : 1;
  const rings = useMemo(() => { const out: number[] = []; for (let d = ringStep; d <= maxD * 1.1; d += ringStep) out.push(d); return out; }, [maxD, ringStep]);

  const elig = results.filter((r) => r.eligible && r.inRadius);
  const lo = Math.min(...elig.map((r) => r.total)), hi = Math.max(...elig.map((r) => r.total));
  const colH = (t: number) => 22 + (hi > lo ? ((t - lo) / (hi - lo)) * colMax : 0);

  const pts = km.map(({ r, e, n }) => ({ r, x: cx + e * scale, y: cy - n * scale })).sort((a, b) => a.y - b.y);
  const kindOf = (r: StoreResult) => (!(r.eligible && r.inRadius) ? 'off' : r.i === bestI ? 'best' : r.i === refI ? 'ref' : refI != null && results[refI] && r.total > results[refI].total ? 'high' : 'mid');

  const onWheel = (e: React.WheelEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W, py = ((e.clientY - rect.top) / rect.height) * H;
    setView((v) => {
      const k = Math.min(6, Math.max(1, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      const wx = (px - v.x) / v.k, wy = (py - v.y) / v.k;
      return k === 1 ? { k: 1, x: 0, y: 0 } : { k, x: px - wx * k, y: py - wy * k };
    });
  };

  return (
    <svg ref={svg} className="ringmap" viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr' }} role="img"
      aria-label="מפת הסניפים: מרחק מהבית מול מחיר הסל"
      onWheel={onWheel}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
      onPointerMove={(e) => { const d = drag.current; if (!d || view.k === 1) return; const rect = svg.current!.getBoundingClientRect(); setView((v) => ({ ...v, x: d.vx + ((e.clientX - d.x) / rect.width) * W, y: d.vy + ((e.clientY - d.y) / rect.height) * H })); }}
      onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; onHover(null); }}>
      <defs>
        <radialGradient id="ground" cx="50%" cy="56%" r="60%"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#F4F3EF" /></radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#ground)" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {rings.map((d) => (
          <g key={d}>
            <circle cx={cx} cy={cy} r={d * scale} fill="none" stroke="#2E2E2B" strokeOpacity={0.13} strokeWidth={1 / view.k} strokeDasharray="2 5" />
            <text x={cx - d * scale * 0.707 - 6} y={cy + d * scale * 0.707 + 14} textAnchor="start" style={{ direction: 'rtl' }} className="ring-t" fontSize={11 / view.k}>{`${d} ק״מ`}</text>
          </g>
        ))}
        <g>
          <circle cx={cx} cy={cy} r={7 / view.k} fill="#2E2E2B" />
          <circle cx={cx} cy={cy} r={13 / view.k} fill="none" stroke="#2E2E2B" strokeWidth={1.2 / view.k} />
          <text x={cx} y={cy + 28 / view.k} textAnchor="middle" className="home-t" fontSize={12 / view.k}>הבית</text>
        </g>
        {pts.map(({ r, x, y }) => {
          const on = r.eligible && r.inRadius;
          const h = on ? colH(r.total) / view.k : 14 / view.k;
          const w = 20 / view.k;
          const kind = kindOf(r);
          const active = hoverI === r.i || selI === r.i;
          const dim = hoverI != null && hoverI !== r.i;
          return (
            <g key={r.i} className={`col col-${kind}${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}`}
              onPointerEnter={() => onHover(r.i)} onClick={() => onSelect(r.i)} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.i); }} aria-label={`${storeLabel(r.store)}: ${nis(r.total)} שקלים`}>
              <ellipse cx={x} cy={y} rx={w * 0.9} ry={w * 0.32} className="col-shadow" />
              <rect x={x - w / 2} y={y - h} width={w} height={h} className="col-body" />
              <rect x={x - w / 2} y={y - h} width={w * 0.28} height={h} className="col-side" />
              {selI === r.i && <rect x={x - w / 2 - 3 / view.k} y={y - h - 3 / view.k} width={w + 6 / view.k} height={h + 6 / view.k} fill="none" stroke="#2E2E2B" strokeWidth={1.5 / view.k} />}
            </g>
          );
        })}
        {pts.map(({ r, x, y }) => {
          const on = r.eligible && r.inRadius, kind = kindOf(r), active = hoverI === r.i || selI === r.i;
          if (!on || !(active || kind === 'best' || kind === 'ref' || view.k > 1.6)) return null;
          if (hoverI != null && !active) return null;
          const h = colH(r.total) / view.k;
          return (
            <g key={'l' + r.i} className={`col-${kind}`} pointerEvents="none">
              <text x={x} y={y - h - 24 / view.k} textAnchor="middle" className="col-price" fontSize={(active || kind === 'best' ? 20 : 16) / view.k}>{nis(r.total)} ₪</text>
              <text x={x} y={y - h - 7 / view.k} textAnchor="middle" className="col-name" fontSize={12.5 / view.k}>{storeLabel(r.store)}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
