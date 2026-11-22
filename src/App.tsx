import { createElement, useEffect, useMemo, useState } from 'react';
import { compute, nis, ranked, storeLabel, type Item, type Settings, type StoreResult } from './logic';
import { loadData, useSaved, type Data } from './state';
import { deviceKey } from './cloud';
import RingMap from './RingMap';
import Basket from './Basket';
import { Ranking, What, When } from './Lenses';
import Cover from './Cover';
import Trust from './Trust';

type Route = 'cover' | 'where' | 'when' | 'what' | 'trust';
const routeOf = (): Route => {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return (['where', 'when', 'what', 'trust'] as Route[]).includes(h as Route) ? (h as Route) : 'cover';
};
const NAV: [Route, string, string][] = [['where', 'היכן', 'באיזה סניף'], ['when', 'מתי', 'מבצעים שנגמרים'], ['what', 'מה', 'אילו מוצרים'], ['trust', 'אמינות', 'מקור ובדיקה']];
const SESSION = 'https://claude.ai/code/session_018qeN19tLfiYGn7PfqjP1tF';

export default function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [route, setRoute] = useState<Route>(routeOf());
  const { saved, update, status } = useSaved(data);
  const [hoverI, setHover] = useState<number | null>(null);
  const [selI, setSel] = useState<number | null>(null);
  const [sort, setSort] = useState<'total' | 'net' | 'dist'>('total');
  const [flash, setFlash] = useState(false);
  const [addr, setAddr] = useState('');
  const [addrMsg, setAddrMsg] = useState('');

  useEffect(() => { loadData().then(setData).catch(() => setError('הנתונים לא נטענו. בודקים את החיבור ומרעננים את הדף.')); }, []);
  useEffect(() => { const f = () => setRoute(routeOf()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    const menu = document.querySelector('ai-menu') as any;
    if (!menu) return;
    menu.status = status === 'saved' ? 'נשמר' : status === 'saving' ? 'שומר' : status === 'offline' ? 'נשמר במכשיר' : '';
    menu.items = [
      { label: 'פתיחה במכשיר אחר: העתקת קישור פרטי', onSelect: () => navigator.clipboard?.writeText(`${location.origin}/#/where?k=${deviceKey()}`) },
      { label: 'חזרה לסל לדוגמה', onSelect: () => data && update((s) => ({ ...s, basket: data.meta.sample.map((c) => ({ c, q: 1 })), touched: false })) },
    ];
  }, [status, data, update]);

  const results = useMemo<StoreResult[]>(() => (data && saved ? compute(saved.basket, data.byCode, data.meta, saved.settings) : []), [data, saved]);
  const rank = useMemo(() => ranked(results), [results]);
  const best = rank[0] || null;
  const refI = useMemo(() => {
    if (!saved) return null;
    if (saved.settings.ref != null && results[saved.settings.ref]?.eligible) return saved.settings.ref;
    const near = [...rank].filter((r) => r.dist != null).sort((a, b) => a.dist! - b.dist!)[0];
    return near ? near.i : best ? best.i : null;
  }, [saved, results, rank, best]);

  if (error) return <div className="state"><p className="problem">{error}</p><button className="btn primary press" onClick={() => location.reload()}>רענון</button></div>;
  if (!data || !saved) return <div className="state"><p className="pulse">טוען את מחירי היום</p></div>;

  const ref = refI != null ? results[refI] : null;
  const st = saved.settings;
  const isSample = !saved.touched || (saved.basket.length === data.meta.sample.length && saved.basket.every((b, i) => b.c === data.meta.sample[i] && b.q === 1));
  const setSettings = (p: Partial<Settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  const setBasket = (b: Item[]) => { update((s) => ({ ...s, basket: b })); setFlash(true); setTimeout(() => setFlash(false), 700); };
  const shown = selI != null ? results[selI] : hoverI != null ? results[hoverI] : best;
  const save = best && ref ? ref.total - best.total : 0;
  const pct = ref && ref.total > 0 ? (save / ref.total) * 100 : 0;
  const netSave = best && ref ? ref.net - best.net : 0;
  const sel = selI != null ? results[selI] : best;

  const geocode = async () => {
    if (addr.trim().length < 3) return;
    setAddrMsg('מחפש');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&accept-language=he&q=${encodeURIComponent(`${addr}, ${data.meta.region.name}`)}`).then((x) => x.json());
      if (!r[0]) { setAddrMsg('הכתובת לא נמצאה. מנסים רחוב ומספר.'); return; }
      setSettings({ home: { lat: +r[0].lat, lon: +r[0].lon, label: addr.trim() } }); setAddrMsg(''); setAddr('');
    } catch { setAddrMsg('חיפוש הכתובת לא זמין כרגע.'); }
  };

  const headline = !best ? <>אין סניף שמחזיק מספיק מהסל ברדיוס הזה</>
    : save > 0.5 ? <>{isSample ? 'הסל לדוגמה' : 'הסל שלך'} זול ב-<mark>{nis(save)} ₪</mark> ב{storeLabel(best.store)}</>
      : <>אתם כבר קונים <mark>במקום הזול ביותר</mark> לסל הזה</>;
  const sub = !best ? 'מגדילים את הרדיוס, או מסירים מוצר שנמכר במעט סניפים.'
    : save > 0.5 ? `${nis(best.total)} ₪ במקום ${nis(ref!.total)} ₪ ב${storeLabel(ref!.store)}: ${pct.toFixed(0)}% פחות${best.dist != null ? `, ${best.dist.toFixed(1)} ק״מ מהבית` : ''}. ${pct < 3 ? 'פער קטן: אין סיבה לשנות הרגלים.' : netSave > 0 ? `אחרי עלות נסיעה נשארים ${nis(netSave)} ₪.` : 'עלות הנסיעה גדולה מהחיסכון: נשארים במקום.'}`
      : `${nis(best.total)} ₪ ב${storeLabel(best.store)}. אפשר להפסיק לתהות.`;

  const who = isSample ? 'הסל לדוגמה' : 'הסל שלך';
  const controls = (
            <div className="controls" aria-label="הגדרות ההשוואה">
              <label className="ctl"><span>הבית</span>
                <span className="field sm"><input value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') geocode(); }} placeholder={st.home.label} aria-label="כתובת הבית" />
                  <button className="chip press" onClick={geocode}>מיקום</button></span>
              </label>
              <div className="ctl"><span>רדיוס</span>
                {[2, 5, 10, 0].map((r) => <button key={r} className={`chip press${r === 0 ? ' all' : ''}`} aria-pressed={st.radius === r} onClick={() => setSettings({ radius: r })}>{r === 0 ? 'כל העיר' : `${r} ק״מ`}</button>)}
              </div>
              <label className="ctl"><span>הסופר שלי</span>
                <select value={refI ?? ''} onChange={(e) => setSettings({ ref: +e.target.value })} aria-label="הסופר שבו אני קונה היום">
                  {results.filter((r) => r.eligible).map((r) => <option key={r.i} value={r.i}>{storeLabel(r.store)}</option>)}
                </select>
              </label>
              <div className="ctl"><span>מבצעים</span>
                <button className="chip press" aria-pressed={st.promos} onClick={() => setSettings({ promos: true })}>כולל</button>
                <button className="chip press" aria-pressed={!st.promos} onClick={() => setSettings({ promos: false })}>מחיר מדף</button>
              </div>
              {addrMsg && <span className="muted">{addrMsg}</span>}
            </div>
  );

  return (
    <div className="app">
      <header className="bar">
        <a className="brand press" href="#/" aria-label="קניות: חזרה לכריכה">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 3h14v18l-2.3-1.6L14.3 21 12 19.4 9.7 21l-2.4-1.6L5 21z" fill="none" stroke="currentColor" strokeWidth="1.75" /><path d="M8.5 8h7M8.5 12h7" stroke="currentColor" strokeWidth="1.75" /></svg>
          <b>קניות</b>
        </a>
        <nav aria-label="ניווט">
          {NAV.map(([r, label, hint]) => <a key={r} href={`#/${r}`} className={`nav press${route === r ? ' on' : ''}`} aria-current={route === r ? 'page' : undefined} title={hint}>{label}</a>)}
        </nav>
        <span className="bar-date" title="תאריך קובצי המחירים">מחירי {fmtDate(data.meta.date)}</span>
        {createElement('ai-menu', { chat: SESSION })}
      </header>

      {route === 'cover' && <Cover data={data} results={results} best={best} refR={ref} />}
      {route === 'trust' && <Trust data={data} results={results} basketSize={saved.basket.length} />}
      {(route === 'where' || route === 'when' || route === 'what') && (
        <main className="stage">
          <section className="main">
            {route === 'where' && <>
            <div className="lead">
              <p className="crumb">היכן לקנות</p>
              <h1>{headline}</h1>
              <p className="sub">{sub}</p>
            </div>
            {controls}</>}
            {route === 'where' && (
              <div className="where">
                <div className="map-wrap">
                  <p className="legend">כל עמוד הוא סניף. הגובה: מחיר הסל. הטבעות: מרחק מהבית. <span className="sw sw-best" /> הזול ביותר <span className="sw sw-ref" /> הסופר שלי <span className="sw sw-high" /> יקר ממנו <span className="sw sw-mid" /> זול ממנו</p>
                  <RingMap results={results} bestI={best ? best.i : null} refI={refI} selI={selI} hoverI={hoverI} onHover={setHover} onSelect={(i) => setSel(i === selI ? null : i)} home={st.home} />
                  {sel && (
                    <div className="store-card">
                      <div><b>{storeLabel(sel.store)}</b><small>{sel.store.address}, {data.meta.region.name} · {sel.store.located ? 'מוקם לפי הכתובת' : 'לא מוקם במפה'}</small></div>
                      <div className="row">
                        {sel.store.located && <a className="btn press" target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${sel.store.lat},${sel.store.lon}&navigate=yes`}>ניווט ב-Waze</a>}
                        <a className="btn press" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${sel.store.chainName} ${sel.store.address} ${data.meta.region.name}`)}`}>מפות Google</a>
                        <button className="btn press" onClick={() => navigator.clipboard?.writeText(`רשימת קניות: ${storeLabel(sel.store)}\n` + sel.lines.map((l) => `${l.item.q} × ${l.row[1]}${l.total != null ? ` (${nis(l.total, 2)} ₪)` : ' (לא נמכר כאן)'}`).join('\n') + `\nסך הכול: ${nis(sel.total, 2)} ₪`)}>העתקת רשימת קניות</button>
                      </div>
                    </div>
                  )}
                </div>
                <Ranking results={results} bestI={best ? best.i : null} refI={refI} selI={selI} hoverI={hoverI} onHover={setHover} onSelect={(i) => setSel(i === selI ? null : i)} sort={sort} onSort={setSort} />
              </div>
            )}
            {route === 'when' && <When basket={saved.basket} byCode={data.byCode} meta={data.meta} results={results} history={data.history} controls={controls} who={who} />}
            {route === 'what' && refI != null && <What basket={saved.basket} byCode={data.byCode} meta={data.meta} results={results} refI={refI} usePromos={st.promos} controls={controls} who={who} />}
          </section>
          <Basket rows={data.rows} byCode={data.byCode} basket={saved.basket} shown={shown} best={best} isSample={isSample} onChange={setBasket} flash={flash} />
        </main>
      )}
    </div>
  );
}

export const fmtDate = (d: string) => `${+d.slice(8, 10)}.${+d.slice(5, 7)}.${d.slice(0, 4)}`;
