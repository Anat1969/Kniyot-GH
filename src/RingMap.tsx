import { useEffect, useMemo, useRef, useState } from 'react';
import { nis, storeLabel, type StoreResult } from './logic';

interface Props {
  results: StoreResult[]; bestI: number | null; refI: number | null; selI: number | null;
  hoverI: number | null; onHover: (i: number | null) => void; onSelect: (i: number) => void;
  home: { lat: number; lon: number; label: string };
  picking?: boolean; onPick?: (lat: number, lon: number) => void; flashKey?: number;
}

// Web Mercator, in "world pixels" at zoom 0 (one 256px tile covers the earth)
const mx = (lon: number) => ((lon + 180) / 360) * 256;
const my = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256; };
const invLon = (x: number) => (x / 256) * 360 - 180;
const invLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 256))) * 180) / Math.PI;

/** Distance against price on the real street map: rings are kilometres from home, a column's height is the basket's price. */
export default function RingMap({ results, bestI, refI, selI, hoverI, onHover, onSelect, home, picking, onPick, flashKey }: Props) {
  const [box, setBox] = useState({ w: 800, h: 520 });
  const W = box.w, H = box.h;
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 50) setBox({ w: Math.round(r.width), h: Math.round(r.height) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { setView({ k: 1, x: 0, y: 0 }); }, [home.lat, home.lon]);

  const located = results.filter((r) => r.dist != null);
  // world pixels per km at this latitude
  const wpk = 256 / (40075.017 * Math.cos((home.lat * Math.PI) / 180));
  const hx = mx(home.lon), hy = my(home.lat);
  const km = located.map((r) => ({ r, e: (mx(r.store.lon!) - hx) / wpk, s: (my(r.store.lat!) - hy) / wpk }));
  const ext = (f: (p: { e: number; s: number }) => number) => Math.max(0.6, ...km.map(f));
  const maxD = Math.max(1.5, ...located.map((r) => r.dist!));
  const colMax = Math.min(130, H * 0.2);
  const padTop = colMax + 62, padBottom = 34, padX = 76;
  const eE = ext((p) => p.e), eW = ext((p) => -p.e), eN = ext((p) => -p.s), eS = ext((p) => p.s);
  const scale = Math.min((W - 2 * padX) / (eE + eW), (H - padTop - padBottom) / (eN + eS)); // screen px per km
  const cx = padX + eW * scale + (W - 2 * padX - (eE + eW) * scale) / 2;
  const cy = padTop + eN * scale + (H - padTop - padBottom - (eN + eS) * scale) / 2;
  const ringStep = maxD > 6 ? 2 : 1;
  const rings = useMemo(() => { const out: number[] = []; for (let d = ringStep; d <= maxD * 1.1; d += ringStep) out.push(d); return out; }, [maxD, ringStep]);

  // street-map tiles under everything, so the placement can be checked by eye
  const f0 = scale / wpk; // screen px per world px
  const z = Math.max(8, Math.min(17, Math.round(Math.log2(f0 * view.k))));
  const tile = (256 / 2 ** z) * f0; // tile edge on screen (before the view transform)
  const vis = { x0: -view.x / view.k, y0: -view.y / view.k, x1: (W - view.x) / view.k, y1: (H - view.y) / view.k };
  const toTile = (sx: number, sy: number) => ({ tx: ((sx - cx) / f0 + hx) / (256 / 2 ** z), ty: ((sy - cy) / f0 + hy) / (256 / 2 ** z) });
  const t0 = toTile(vis.x0, vis.y0), t1 = toTile(vis.x1, vis.y1);
  const tiles: { x: number; y: number; sx: number; sy: number }[] = [];
  for (let x = Math.floor(t0.tx); x <= Math.floor(t1.tx); x++) for (let y = Math.floor(t0.ty); y <= Math.floor(t1.ty); y++) {
    if (tiles.length > 80 || y < 0 || y >= 2 ** z) continue;
    tiles.push({ x, y, sx: cx + ((x * 256) / 2 ** z - hx) * f0, sy: cy + ((y * 256) / 2 ** z - hy) * f0 });
  }

  const elig = results.filter((r) => r.eligible && r.inRadius);
  const lo = Math.min(...elig.map((r) => r.total)), hi = Math.max(...elig.map((r) => r.total));
  const colH = (t: number) => 22 + (hi > lo ? ((t - lo) / (hi - lo)) * colMax : 0);
  const pts = km.map(({ r, e, s }) => ({ r, x: cx + e * scale, y: cy + s * scale })).sort((a, b) => a.y - b.y);
  const kindOf = (r: StoreResult) => (!(r.eligible && r.inRadius) ? 'off' : r.i === bestI ? 'best' : r.i === refI ? 'ref' : refI != null && results[refI] && r.total > results[refI].total ? 'high' : 'mid');

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W, py = ((e.clientY - rect.top) / rect.height) * H;
    return { px, py, bx: (px - view.x) / view.k, by: (py - view.y) / view.k };
  };
  const onWheel = (e: React.WheelEvent) => {
    const { px, py } = local(e);
    setView((v) => {
      const k = Math.min(12, Math.max(1, v.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      const wx = (px - v.x) / v.k, wy = (py - v.y) / v.k;
      return k === 1 ? { k: 1, x: 0, y: 0 } : { k, x: px - wx * k, y: py - wy * k };
    });
  };
  const k = view.k;

  return (
    <svg ref={svg} className={`ringmap${picking ? ' picking' : ''}`} viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr' }} role="img"
      aria-label="מפת הסניפים: מרחק מהבית מול מחיר הסל"
      onWheel={onWheel}
      onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
        if (view.k === 1) return;
        const rect = svg.current!.getBoundingClientRect();
        setView((v) => ({ ...v, x: d.vx + ((e.clientX - d.x) / rect.width) * W, y: d.vy + ((e.clientY - d.y) / rect.height) * H }));
      }}
      onPointerUp={(e) => {
        const d = drag.current; drag.current = null;
        if (picking && onPick && d && !d.moved) { const { bx, by } = local(e); onPick(invLat((by - cy) / f0 + hy), invLon((bx - cx) / f0 + hx)); }
      }}
      onPointerLeave={() => { drag.current = null; onHover(null); }}>
      <rect width={W} height={H} fill="#F4F3EF" />
      <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
        <g className="tiles">
          {tiles.map((t) => <image key={`${z}/${t.x}/${t.y}`} href={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`} x={t.sx} y={t.sy} width={tile + 0.5 / k} height={tile + 0.5 / k} preserveAspectRatio="none" />)}
        </g>
        {rings.map((d) => (
          <g key={d}>
            <circle cx={cx} cy={cy} r={d * scale} fill="none" stroke="#2E2E2B" strokeOpacity={0.4} strokeWidth={1.2 / k} strokeDasharray={`${3 / k} ${5 / k}`} />
            <text x={cx - d * scale * 0.707 - 6 / k} y={cy + d * scale * 0.707 + 14 / k} textAnchor="start" style={{ direction: 'rtl' }} className="ring-t" fontSize={11.5 / k}>{`${d} ק״מ`}</text>
          </g>
        ))}
        {pts.map(({ r, x, y }) => {
          const on = r.eligible && r.inRadius;
          const h = on ? colH(r.total) / k : 14 / k;
          const w = Math.max(9, Math.min(20, scale * 0.16)) / k;
          const kind = kindOf(r);
          const active = hoverI === r.i || selI === r.i;
          const dim = hoverI != null && hoverI !== r.i;
          return (
            <g key={r.i} className={`col col-${kind}${active ? ' is-active' : ''}${dim ? ' is-dim' : ''}`}
              onPointerEnter={() => onHover(r.i)} onClick={() => { if (!picking) onSelect(r.i); }} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.i); }} aria-label={`${storeLabel(r.store)}: ${nis(r.total)} שקלים`}>
              <ellipse cx={x} cy={y} rx={w * 0.9} ry={w * 0.32} className="col-shadow" />
              <rect x={x - w / 2} y={y - h} width={w} height={h} className="col-body" />
              <rect x={x - w / 2} y={y - h} width={w * 0.28} height={h} className="col-side" />
              {selI === r.i && <rect x={x - w / 2 - 3 / k} y={y - h - 3 / k} width={w + 6 / k} height={h + 6 / k} fill="none" stroke="#2E2E2B" strokeWidth={1.5 / k} />}
            </g>
          );
        })}
        <g className="home-pin" key={flashKey} pointerEvents="none">
          <circle cx={cx} cy={cy} r={26 / k} className="home-pulse" />
          <path d={`M ${cx} ${cy} l ${-9 / k} ${-17 / k} a ${10.2 / k} ${10.2 / k} 0 1 1 ${18 / k} 0 z`} className="home-drop" strokeWidth={1.5 / k} />
          <circle cx={cx} cy={cy - 21 / k} r={3.6 / k} fill="#fff" />
          <text x={cx} y={cy + 17 / k} textAnchor="middle" className="home-t" fontSize={13 / k}>{home.label.length > 34 ? home.label.slice(0, 33) + '…' : home.label}</text>
        </g>
        {pts.map(({ r, x, y }) => {
          const on = r.eligible && r.inRadius, kind = kindOf(r), active = hoverI === r.i || selI === r.i;
          if (!on || !(active || kind === 'best' || kind === 'ref' || k > 2.2)) return null;
          if (hoverI != null && !active) return null;
          const h = colH(r.total) / k;
          const side = kind === 'ref' && !active;
          const sd = x >= cx ? 1 : -1; // label on the side away from the home pin
          return (
            <g key={'l' + r.i} className={`col-${kind}`} pointerEvents="none">
              <text x={side ? x + sd * 16 / k : x} y={side ? y - h / 2 - 4 / k : y - h - 24 / k} textAnchor={side ? (sd > 0 ? 'start' : 'end') : 'middle'} className="col-price" fontSize={(active || kind === 'best' ? 20 : 16) / k}>{nis(r.total)} ₪</text>
              <text x={side ? x + sd * 16 / k : x} y={side ? y - h / 2 + 12 / k : y - h - 7 / k} textAnchor={side ? (sd > 0 ? 'start' : 'end') : 'middle'} className="col-name" fontSize={12.5 / k}>{storeLabel(r.store)}</text>
            </g>
          );
        })}
      </g>
      <text x={W - 6} y={H - 6} textAnchor="start" style={{ direction: 'rtl' }} className="osm-credit" fontSize={10}>מפת הרקע: OpenStreetMap</text>
    </svg>
  );
}
