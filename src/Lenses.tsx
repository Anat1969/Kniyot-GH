import type { ReactNode } from 'react';
import { daysUntil, nis, pareto, bestPair, storeLabel, unitText, type History, type Item, type Meta, type Row, type StoreResult } from './logic';

const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

// ---------- WHERE: ranking beside the map ----------
export function Ranking({ results, bestI, refI, selI, hoverI, onHover, onSelect, sort, onSort }: {
  results: StoreResult[]; bestI: number | null; refI: number | null; selI: number | null; hoverI: number | null;
  onHover: (i: number | null) => void; onSelect: (i: number) => void; sort: 'total' | 'net' | 'dist'; onSort: (s: 'total' | 'net' | 'dist') => void;
}) {
  const key = (r: StoreResult) => (sort === 'total' ? r.total : sort === 'net' ? r.net : r.dist ?? 99);
  const on = results.filter((r) => r.eligible && r.inRadius).sort((a, b) => key(a) - key(b));
  const off = results.filter((r) => !(r.eligible && r.inRadius));
  const ref = refI != null ? results[refI] : null;
  const lo = Math.min(...on.map((r) => r.total)), hi = Math.max(...on.map((r) => r.total));
  const row = (r: StoreResult, dead = false) => {
    const diff = ref && !dead ? r.total - ref.total : 0;
    return (
      <li key={r.i} className={`rank-row press${r.i === bestI ? ' best' : ''}${r.i === refI ? ' ref' : ''}${r.i === selI ? ' sel' : ''}${hoverI === r.i ? ' hov' : ''}${dead ? ' dead' : ''}`}
        onPointerEnter={() => onHover(r.i)} onPointerLeave={() => onHover(null)} onClick={() => onSelect(r.i)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.i); }}>
        <div className="rank-name">
          <b>{storeLabel(r.store)}</b>
          <small>{r.dist != null ? `${r.dist.toFixed(1)} ק״מ` : 'לא מוקם במפה'}{r.i === refI ? ' · הסופר שלי' : ''}{dead ? ` · ${r.inRadius ? `מחזיק ${Math.round(r.coverage * 100)}% מהסל` : 'מחוץ לרדיוס'}` : r.have < r.lines.length ? ` · ${r.lines.length - r.have} חסרים, הוערכו` : ''}</small>
        </div>
        {!dead && <div className="rank-bar"><i style={{ width: `${hi > lo ? 12 + ((r.total - lo) / (hi - lo)) * 88 : 50}%` }} /></div>}
        {!dead && <div className="rank-num"><b className="num">{nis(r.total)} ₪</b><small className={`num ${diff < -0.5 ? 'down' : diff > 0.5 ? 'up' : ''}`}>{ref && r.i !== refI ? `${diff > 0 ? '+' : '−'}${nis(Math.abs(diff))}` : ''}</small></div>}
      </li>
    );
  };
  return (
    <section className="rank" aria-label="דירוג הסניפים">
      <div className="rank-tools">
        <span className="muted">מסודר לפי:</span>
        {([['total', 'מחיר הסל'], ['net', 'כולל נסיעה'], ['dist', 'מרחק']] as const).map(([k, l]) => <button key={k} className="chip press" aria-pressed={sort === k} onClick={() => onSort(k)}>{l}</button>)}
      </div>
      <ul className="rank-list">{on.map((r) => row(r))}{off.length > 0 && <li className="rank-sep">לא נכנסו להשוואה</li>}{off.map((r) => row(r, true))}</ul>
    </section>
  );
}

// ---------- WHEN: promos on my basket, on a time axis ----------
export function When({ basket, byCode, meta, results, history, controls, who }: { basket: Item[]; byCode: Map<string, Row>; meta: Meta; results: StoreResult[]; history: History; controls: ReactNode; who: string }) {
  const pool = new Set(results.filter((r) => r.inRadius).map((r) => r.i));
  const span = 21;
  const bars = basket.flatMap((b) => {
    const row = byCode.get(b.c); if (!row) return [];
    const shelfMin = Math.min(...(row[6].filter((x, i) => x != null && pool.has(i)) as number[]));
    const best = row[7].filter((p) => pool.has(p[0]) && p[1] < shelfMin - 0.005).sort((x, y) => x[1] - y[1])[0];
    if (!best) return [];
    const d = daysUntil(best[3], meta.date);
    return [{ row, promo: best, days: d, save: (shelfMin - best[1]) * Math.max(b.q, best[2]) }];
  }).sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
  const soon = bars.filter((b) => b.days != null && b.days <= 7);
  const today = new Date(meta.date + 'T00:00:00Z');
  const dayOf = (d: number) => new Date(today.getTime() + d * 86400e3);

  // history of the basket's lowest shelf total
  const hist = history.days.map((_, di) => basket.reduce((s, b) => {
    const h = history.p[b.c]; if (!h) return s;
    let v = h[0][1]; for (const [d, p] of h) if (d <= di) v = p;
    return s + v * b.q;
  }, 0));

  return (
    <>
    <div className="lead">
      <p className="crumb">מתי לקנות</p>
      <h1>{soon.length > 0 ? <><mark>{soon.length} מבצעים</mark> על {who} נגמרים בתוך שבוע</> : bars.length > 0 ? <>אין מבצע על {who} ש<mark>נגמר השבוע</mark></> : <>היום אין מבצע פתוח שמוזיל את {who}</>}</h1>
      <p className="sub">{bars.length > 0 ? `${bars.length} מוצרים מהסל במבצע פתוח לכולם. מה שנגמר השבוע קונים עכשיו, והשאר יכול לחכות לקנייה הבאה.` : 'מחיר המדף הזול באזור הוא המחיר הטוב ביותר היום. אין סיבה להקדים קנייה.'}</p>
    </div>
    {controls}
    <div className="lens-body">
      <div className="lens-main">
        <p className="legend">כל פס הוא מבצע פתוח לכולם על מוצר מהסל, מהיום ועד היום שבו הוא נגמר. <span className="sw sw-soon" /> נגמר בתוך שבוע <span className="sw sw-later" /> נגמר מאוחר יותר</p>
        {bars.length === 0 ? <p className="empty-box">אין היום מבצע פתוח לכולם שמוזיל מוצר מהסל מתחת למחיר המדף הזול באזור.</p> : (
          <div className="tl scroll-y">
            <div className="tl-row tl-axis"><span /><div className="tl-track">
              {Array.from({ length: span / 7 + 1 }, (_, w) => <i key={w} style={{ insetInlineStart: `${(w * 7 / span) * 88}%` }}>{w === 0 ? 'היום' : `${HE_DAYS[dayOf(w * 7).getUTCDay()]} ${dayOf(w * 7).getUTCDate()}.${dayOf(w * 7).getUTCMonth() + 1}`}</i>)}
            </div></div>
            {bars.map((b) => {
              const d = b.days == null ? span : Math.max(0.5, Math.min(span, b.days));
              return (
                <div className="tl-row" key={b.row[0]}>
                  <span className="tl-name" title={b.row[1]}>{b.row[1]}</span>
                  <div className="tl-track">
                    <div className={`tl-bar ${b.days != null && b.days <= 7 ? 'soon' : 'later'}`} style={{ width: `${(d / span) * 88}%` }}>
                      <b>{b.promo[2] > 1 ? `${b.promo[2]} יחידות ב-${nis(b.promo[1] * b.promo[2], 2)} ₪` : `${nis(b.promo[1], 2)} ₪`}</b> · {storeLabel(meta.stores[b.promo[0]])}
                    </div>
                    <small>{b.days == null || b.days > span ? 'בלי תאריך סיום קרוב' : b.days <= 0 ? 'נגמר היום' : `עוד ${b.days} ימים`}</small>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <aside className="lens-side">
        <div className="fact"><b className="big num">{soon.length}</b><span>מבצעים על הסל נגמרים בתוך שבוע. את המוצרים האלה כדאי לקנות עכשיו.</span></div>
        <div className="fact"><b className="big num">{nis(bars.reduce((s, b) => s + b.save, 0))} ₪</b><span>ההוזלה שהמבצעים הפתוחים נותנים לסל, מול מחיר המדף הזול באזור.</span></div>
        <div className="fact">
          <Spark values={hist} />
          <span>{hist.length < 3 ? `מעקב המחירים התחיל ב-${fmt(history.days[0])}. בכל יום נוספת נקודה, והגרף יראה מתי הסל זול.` : `המחיר הנמוך של הסל ב-${hist.length} הימים האחרונים: בין ${nis(Math.min(...hist))} ל-${nis(Math.max(...hist))} ₪.`}</span>
        </div>
      </aside>
    </div>
    </>
  );
}
const fmt = (d: string) => (d ? `${+d.slice(8, 10)}.${+d.slice(5, 7)}.${d.slice(0, 4)}` : '');

function Spark({ values }: { values: number[] }) {
  const W = 220, H = 48, lo = Math.min(...values), hi = Math.max(...values);
  const pt = (v: number, i: number) => `${values.length > 1 ? (i / (values.length - 1)) * (W - 8) + 4 : W / 2},${hi > lo ? H - 6 - ((v - lo) / (hi - lo)) * (H - 12) : H / 2}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" style={{ direction: 'ltr' }} aria-hidden="true">
      <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke="#2E2E2B" strokeOpacity=".15" />
      {values.length > 1 && <polyline points={values.map(pt).join(' ')} fill="none" stroke="#2E2E2B" strokeWidth="1.5" />}
      {values.map((v, i) => <circle key={i} cx={pt(v, i).split(',')[0]} cy={pt(v, i).split(',')[1]} r={i === values.length - 1 ? 3.5 : 2} fill={i === values.length - 1 ? '#2F7D5B' : '#2E2E2B'} />)}
    </svg>
  );
}

// ---------- WHAT: which products carry the gap ----------
export function What({ basket, byCode, meta, results, refI, usePromos, controls, who }: { basket: Item[]; byCode: Map<string, Row>; meta: Meta; results: StoreResult[]; refI: number; usePromos: boolean; controls: ReactNode; who: string }) {
  const p = pareto(basket, byCode, results, refI, usePromos);
  const rows = p.rows.filter((r) => r.gap > 0.005);
  const max = rows.length ? rows[0].gap : 1;
  const pair = bestPair(results);
  const single = results.filter((r) => r.eligible && r.inRadius).sort((a, b) => a.total - b.total)[0];
  const pairGain = pair && single ? single.total - pair.total : 0;
  return (
    <>
    <div className="lead">
      <p className="crumb">מה מייקר את הסל</p>
      <h1>{rows.length > 0 ? <><mark>{p.topCount} מוצרים</mark> מחזיקים {Math.round(p.topShare * 100)}% מהפער של {who}</> : <>אף מוצר ב{who} לא <mark>זול יותר</mark> במקום אחר</>}</h1>
      <p className="sub">{rows.length > 0 ? `לא חייבים להחליף סופר. מספיק לקנות את המוצרים האלה במקום אחר, או לחכות להם למבצע. הפער המלא: ${nis(p.sum)} ₪.` : 'הסופר שלך הוא הזול ביותר לסל הזה, מוצר אחרי מוצר.'}</p>
    </div>
    {controls}
    <div className="lens-body">
      <div className="lens-main">
        <p className="legend">כל שורה: כמה המוצר יקר יותר ב<b>{storeLabel(meta.stores[refI])}</b> מהמחיר הזול ביותר שלו באזור, ואיפה הוא זול. <span className="sw sw-top" /> המוצרים שמחזיקים את רוב הפער <span className="sw sw-rest" /> השאר</p>
        {rows.length === 0 ? <p className="empty-box solution">אף מוצר בסל לא זול יותר במקום אחר. הסופר שלך הוא הזול ביותר לסל הזה.</p> : (
          <ul className="pareto scroll-y">
            {rows.map((r, k) => (
              <li key={r.item.c} className={k < p.topCount ? 'top' : ''}>
                <div className="p-name"><span>{r.row[1]}</span><small>{unitText(r.row)}{r.item.q > 1 ? ` × ${r.item.q}` : ''}</small></div>
                <div className="p-bar"><i style={{ width: `${Math.max(2, (r.gap / max) * 100)}%` }} /></div>
                <div className="p-num"><b className="num">{nis(r.gap, 2)} ₪</b><small>{r.best ? `זול ב${storeLabel(meta.stores[r.best.i])}: ${nis(r.best.total, 2)}` : ''}</small></div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <aside className="lens-side">
        <div className="fact"><b className="big num">{p.topCount}</b><span>מוצרים מחזיקים <b>{Math.round(p.topShare * 100)}%</b> מהפער. אותם שווה לקנות במקום אחר, או לחכות למבצע.</span></div>
        <div className="fact"><b className="big num">{nis(p.sum)} ₪</b><span>הפער אילו כל מוצר נקנה במקום הזול ביותר שלו. זה הגבול העליון של החיסכון.</span></div>
        {pair && single && (
          <div className="fact">
            <b className="big num">{pairGain > 1 ? `${nis(pairGain)} ₪` : 'לא שווה'}</b>
            <span>{pairGain > 1
              ? <>עצירה בשני סניפים במקום אחד: <b>{pair.fromA}</b> מוצרים ב{storeLabel(pair.a.store)} והשאר ב{storeLabel(pair.b.store)}. סך הכול {nis(pair.total)} ₪.</>
              : 'פיצול הקנייה לשני סניפים לא מוזיל את הסל מעבר לסניף הזול ביותר.'}</span>
          </div>
        )}
      </aside>
    </div>
    </>
  );
}
