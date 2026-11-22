import { createElement, useEffect, useMemo, useState } from 'react';
import { compute, haversine, nis, ranked, storeLabel, type Item, type Settings, type StoreResult } from './logic';
import { loadData, loadRegions, localSaved, useSaved, type Data, type RegionInfo } from './state';
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
  const [addrOk, setAddrOk] = useState(true);

  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [regionId, setRegionId] = useState('');
  const [homeFlash, setHomeFlash] = useState(0);
  const [picking, setPicking] = useState(false);
  const fail = () => setError('הנתונים לא נטענו. בודקים את החיבור ומרעננים את הדף.');

  useEffect(() => {
    loadRegions().then((rs) => {
      setRegions(rs);
      const wanted = localSaved()?.settings.region;
      setRegionId(rs.some((r) => r.id === wanted) ? wanted! : rs[0].id);
    }).catch(fail);
  }, []);
  useEffect(() => { if (regionId) { setData(null); setSel(null); loadData(regionId).then(setData).catch(fail); } }, [regionId]);
  // a basket that arrives from the cloud may belong to another area
  useEffect(() => { const r = saved?.settings.region; if (r && r !== regionId && regions.some((x) => x.id === r)) setRegionId(r); }, [saved?.settings.region, regionId, regions]);
  useEffect(() => { const f = () => setRoute(routeOf()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    const menu = document.querySelector('ai-menu') as any;
    if (!menu) return;
    menu.status = status === 'saved' ? 'נשמר' : status === 'saving' ? 'שומר' : status === 'offline' ? 'נשמר במכשיר' : '';
    menu.items = [
      { label: 'פתיחה במכשיר אחר: העתקת קישור פרטי', onSelect: () => navigator.clipboard?.writeText(`${location.origin}/#/where?k=${deviceKey()}`) },
      { label: 'חזרה לסל לדוגמה', onSelect: () => data && update((s) => ({ ...s, basket: [], ownBasket: false })) },
    ];
  }, [status, data, update]);

  const eff = useMemo(() => {
    if (!data || !saved) return null;
    const mine = saved.settings.homeSet && saved.settings.region === data.meta.region.id;
    const c = data.meta.region.center;
    const sample = data.meta.sample.map((x) => ({ c: x, q: 1 }));
    const isSample = !saved.ownBasket;
    const basket = isSample ? sample : saved.basket;
    const settings: Settings = { ...saved.settings, home: mine ? saved.settings.home : { lat: c[0], lon: c[1], label: `מרכז האזור: ${data.meta.region.name}` }, ref: saved.settings.region === data.meta.region.id ? saved.settings.ref : null };
    return { basket, settings, isSample, mine: !!mine };
  }, [data, saved]);
  const results = useMemo<StoreResult[]>(() => (data && eff ? compute(eff.basket, data.byCode, data.meta, eff.settings) : []), [data, eff]);
  const rank = useMemo(() => ranked(results), [results]);
  const best = rank[0] || null;
  const refI = useMemo(() => {
    if (!eff) return null;
    if (eff.settings.ref != null && results[eff.settings.ref]?.eligible) return eff.settings.ref;
    const near = [...rank].filter((r) => r.dist != null).sort((a, b) => a.dist! - b.dist!)[0];
    return near ? near.i : best ? best.i : null;
  }, [eff, results, rank, best]);

  if (error) return <div className="state"><p className="problem">{error}</p><button className="btn primary press" onClick={() => location.reload()}>רענון</button></div>;
  if (!data || !saved || !eff) return <div className="state"><p className="pulse">טוען את מחירי היום</p></div>;

  const ref = refI != null ? results[refI] : null;
  const st = eff.settings;
  const isSample = eff.isSample;
  const setSettings = (p: Partial<Settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  const setBasket = (b: Item[]) => { update((s) => ({ ...s, basket: b, ownBasket: true, settings: { ...s.settings, region: data.meta.region.id } })); setFlash(true); setTimeout(() => setFlash(false), 700); };
  const shown = selI != null ? results[selI] : hoverI != null ? results[hoverI] : best;
  const save = best && ref ? ref.total - best.total : 0;
  const pct = ref && ref.total > 0 ? (save / ref.total) * 100 : 0;
  const netSave = best && ref ? ref.net - best.net : 0;
  const sel = selI != null ? results[selI] : best;

  // every answer is relative to the home point, so placing it is shown, named and checked
  const placeHome = (lat: number, lon: number, label: string, found: string) => {
    const near = regions.map((r) => ({ r, d: haversine([lat, lon], r.center) })).sort((x, y) => x.d - y.d)[0];
    if (!near || near.d > near.r.radiusKm + 12) {
      setAddrMsg(`נמצא: ${found}. אין עדיין קובצי מחירים לאזור הזה. האזורים הקיימים: ${regions.map((r) => r.name).join(', ')}.`); setAddrOk(false); return;
    }
    const sameRegion = near.r.id === data.meta.region.id;
    update((s) => ({ ...s, settings: { ...s.settings, home: { lat, lon, label }, homeSet: true, region: near.r.id, ref: sameRegion ? s.settings.ref : null, radius: sameRegion ? s.settings.radius : 0 } }));
    setAddrMsg(`נמצא: ${found}`); setAddrOk(true); setAddr(''); setHomeFlash((x) => x + 1); setSel(null);
    if (!sameRegion) setRegionId(near.r.id);
  };
  const short = (name: string) => name.split(',').slice(0, 3).map((x: string) => x.trim()).join(', ');
  const geocode = async () => {
    const raw = addr.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
    if (raw.length < 2) return;
    setAddrMsg('מחפש את הכתובת'); setAddrOk(true);
    // people write addresses in many ways: try as written, then without "street", then the settlement alone
    const bare = raw.replace(/(^|\s)(רחוב|רח'|רח׳|שדרות|שד'|סמטת|דרך)\s+/g, '$1').trim();
    const town = raw.includes(',') ? raw.split(',').pop()!.trim() : '';
    const tries = [...new Set([raw, bare, town].filter((q) => q.length > 1))];
    try {
      for (let i = 0; i < tries.length; i++) {
        if (i > 0) await new Promise((res) => setTimeout(res, 1100));
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il,ps&accept-language=he&q=${encodeURIComponent(tries[i])}`).then((x) => x.json());
        if (!r[0]) continue;
        const onlyTown = tries[i] === town && town !== raw && town !== bare;
        placeHome(+r[0].lat, +r[0].lon, onlyTown ? town : raw, onlyTown ? `הרחוב לא נמצא במפה, ולכן מוקם לפי היישוב: ${short(r[0].display_name)}. אפשר לדייק בבחירה במפה` : short(r[0].display_name));
        return;
      }
      setAddrMsg('הכתובת לא נמצאה. מנסים רחוב ויישוב, או בוחרים נקודה במפה.'); setAddrOk(false);
    } catch { setAddrMsg('חיפוש הכתובת לא זמין כרגע. אפשר לבחור נקודה במפה.'); setAddrOk(false); }
  };
  const pickOnMap = async (lat: number, lon: number) => {
    setPicking(false);
    let found = `${lat.toFixed(4)}, ${lon.toFixed(4)}`, label = 'נקודה שבחרתי במפה';
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&accept-language=he&lat=${lat}&lon=${lon}`).then((x) => x.json());
      if (r && r.display_name) { found = short(r.display_name); label = r.display_name.split(',').slice(0, 2).join(',').trim(); }
    } catch { /* the point itself is enough */ }
    placeHome(lat, lon, label, found);
  };
  const locateMe = () => {
    if (!navigator.geolocation) { setAddrMsg('הדפדפן לא נותן מיקום. מקלידים כתובת או בוחרים במפה.'); setAddrOk(false); return; }
    setAddrMsg('מאתר את המיקום'); setAddrOk(true);
    navigator.geolocation.getCurrentPosition((p) => pickOnMap(p.coords.latitude, p.coords.longitude), () => { setAddrMsg('המיקום לא אושר בדפדפן. מקלידים כתובת או בוחרים במפה.'); setAddrOk(false); }, { timeout: 10000 });
  };

  const headline = !best ? <>אין סניף שמחזיק מספיק מהסל ברדיוס הזה</>
    : save > 0.5 ? <>{isSample ? 'הסל לדוגמה' : 'הסל שלך'} זול ב-<mark>{nis(save)} ₪</mark> ב{storeLabel(best.store)}</>
      : <>אתם כבר קונים <mark>במקום הזול ביותר</mark> לסל הזה</>;
  const sub = !best ? 'מגדילים את הרדיוס, או מסירים מוצר שנמכר במעט סניפים.'
    : save > 0.5 ? `${nis(best.total)} ₪ במקום ${nis(ref!.total)} ₪ ב${storeLabel(ref!.store)}: ${pct.toFixed(0)}% פחות${best.dist != null ? `, ${best.dist.toFixed(1)} ק״מ מהבית` : ''}. ${pct < 3 ? 'פער קטן: אין סיבה לשנות הרגלים.' : netSave > 0 ? `אחרי עלות נסיעה נשארים ${nis(netSave)} ₪.` : 'עלות הנסיעה גדולה מהחיסכון: נשארים במקום.'}`
      : `${nis(best.total)} ₪ ב${storeLabel(best.store)}. אפשר להפסיק לתהות.`;

  const who = isSample ? 'הסל לדוגמה' : 'הסל שלך';
  const controls = (<>
            <div className="controls" aria-label="הגדרות ההשוואה">
              <div className="ctl home-ctl"><span>הבית</span>
                <span className="field sm"><input value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') geocode(); }} placeholder="רחוב ויישוב" aria-label="כתובת הבית" />
                  <button className="chip press" onClick={geocode}>חיפוש</button>
                  <button className="chip press" aria-pressed={picking} onClick={() => { setPicking(!picking); if (route !== 'where') location.hash = '#/where'; }} title="לוחצים על המפה במקום שבו הבית">בחירה במפה</button>
                  <button className="chip press" onClick={locateMe} title="המיקום של המכשיר">המיקום שלי</button></span>
              </div>
              <div className="ctl"><span>רדיוס</span>
                {[2, 5, 10, 0].map((r) => <button key={r} className={`chip press${r === 0 ? ' all' : ''}`} aria-pressed={st.radius === r} onClick={() => setSettings({ radius: r })}>{r === 0 ? 'כל האזור' : `${r} ק״מ`}</button>)}
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
            </div>
            <p className={`home-line${addrOk ? '' : ' bad'}`} key={homeFlash} aria-live="polite">
              <b>{eff.mine ? 'הבית:' : 'נקודת המוצא:'}</b> {st.home.label}
              <small className="num">{st.home.lat.toFixed(4)}, {st.home.lon.toFixed(4)}</small>
              {!eff.mine && !addrMsg && <span>עוד לא סומן בית. כל המרחקים נמדדים ממרכז האזור, עד שתסמני.</span>}
              {picking && <span className="pick-hint">לוחצים על המפה במקום שבו הבית.</span>}
              {addrMsg && <span>{addrMsg}</span>}
            </p></>
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
      {route === 'trust' && <Trust data={data} results={results} basketSize={eff.basket.length} />}
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
                  <RingMap results={results} bestI={best ? best.i : null} refI={refI} selI={selI} hoverI={hoverI} onHover={setHover} onSelect={(i) => setSel(i === selI ? null : i)} home={st.home} picking={picking} onPick={pickOnMap} flashKey={homeFlash} />
                  {sel && (
                    <div className="store-card">
                      <div><b>{storeLabel(sel.store)}</b><small>{sel.store.address}, {sel.store.city || data.meta.region.name} · {!sel.store.located ? 'לא מוקם במפה' : sel.store.approx ? 'מיקום משוער: מרכז היישוב' : 'מוקם לפי הכתובת'}</small></div>
                      <div className="row">
                        {sel.store.located && <a className="btn press" target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${sel.store.lat},${sel.store.lon}&navigate=yes`}>ניווט ב-Waze</a>}
                        <a className="btn press" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${sel.store.chainName} ${sel.store.address} ${sel.store.city || data.meta.region.name}`)}`}>מפות Google</a>
                        <button className="btn press" onClick={() => navigator.clipboard?.writeText(`רשימת קניות: ${storeLabel(sel.store)}\n` + sel.lines.map((l) => `${l.item.q} × ${l.row[1]}${l.total != null ? ` (${nis(l.total, 2)} ₪)` : ' (לא נמכר כאן)'}`).join('\n') + `\nסך הכול: ${nis(sel.total, 2)} ₪`)}>העתקת רשימת קניות</button>
                      </div>
                    </div>
                  )}
                </div>
                <Ranking results={results} bestI={best ? best.i : null} refI={refI} selI={selI} hoverI={hoverI} onHover={setHover} onSelect={(i) => setSel(i === selI ? null : i)} sort={sort} onSort={setSort} />
              </div>
            )}
            {route === 'when' && <When basket={eff.basket} byCode={data.byCode} meta={data.meta} results={results} history={data.history} controls={controls} who={who} />}
            {route === 'what' && refI != null && <What basket={eff.basket} byCode={data.byCode} meta={data.meta} results={results} refI={refI} usePromos={st.promos} controls={controls} who={who} />}
          </section>
          <Basket rows={data.rows} byCode={data.byCode} basket={eff.basket} shown={shown} best={best} isSample={isSample} onChange={setBasket} flash={flash} />
        </main>
      )}
    </div>
  );
}

export const fmtDate = (d: string) => `${+d.slice(8, 10)}.${+d.slice(5, 7)}.${d.slice(0, 4)}`;
