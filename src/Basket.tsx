import { useEffect, useRef, useState } from 'react';
import { matchLine, nis, search, storeLabel, unitText, type Item, type Match, type Row, type StoreResult } from './logic';
import { readReceipt } from './cloud';

interface Props {
  rows: Row[]; byCode: Map<string, Row>; basket: Item[]; shown: StoreResult | null; best: StoreResult | null;
  isSample: boolean; onChange: (b: Item[]) => void; flash: boolean;
}
type Mode = 'search' | 'receipt' | 'list' | 'scan';

export default function Basket({ rows, byCode, basket, shown, best, isSample, onChange, flash }: Props) {
  const [mode, setMode] = useState<Mode>('search');
  const [q, setQ] = useState('');
  const [review, setReview] = useState<{ matches: Match[]; total: number | null; store: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const sugg = q.trim().length >= 2 ? search(q, rows) : [];

  const add = (c: string, qty = 1) => {
    const base = isSample ? [] : basket;
    const at = base.findIndex((b) => b.c === c);
    onChange(at >= 0 ? base.map((b, i) => (i === at ? { ...b, q: b.q + qty } : b)) : [{ c, q: qty }, ...base]);
  };
  const setQty = (c: string, qty: number) => onChange(qty <= 0 ? basket.filter((b) => b.c !== c) : basket.map((b) => (b.c === c ? { ...b, q: qty } : b)));

  const dictate = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setErr('הדפדפן הזה לא תומך בהקלטה. אפשר להקליד.'); return; }
    const r = new SR(); r.lang = 'he-IL'; r.onresult = (e: any) => setQ(e.results[0][0].transcript); r.start();
  };

  const handleImage = async (file: File) => {
    setErr(''); setBusy('קורא את הקבלה');
    try {
      const b64 = await toBase64(file);
      const rec = await readReceipt(b64.data, b64.mime);
      const matches = rec.lines.map((l) => matchLine(l.name, l.qty || 1, l.unit_price || (l.total && l.qty ? l.total / l.qty : null), rows, l.barcode));
      setReview({ matches, total: rec.total, store: rec.store });
    } catch (e: any) { setErr(`${e.message || 'קריאת הקבלה נכשלה'}. אפשר לנסות שוב, או להדביק את הרשימה כטקסט.`); }
    setBusy('');
  };
  const handleText = (text: string) => {
    const lines = text.split(/\n|,|;/).map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 80);
    const matches = lines.map((l) => {
      const m = l.match(/^(\d{1,2})\s*[xX×]?\s+(.*)$/) || l.match(/^(.*?)\s*[xX×]\s*(\d{1,2})$/);
      const qty = m ? +(/^\d/.test(m[1]) ? m[1] : m[2]) : 1;
      const name = m ? (/^\d/.test(m[1]) ? m[2] : m[1]) : l;
      return matchLine(name, qty, null, rows, /^\d{8,14}$/.test(name) ? name : undefined);
    });
    setReview({ matches, total: null, store: '' });
  };
  const acceptReview = () => {
    if (!review) return;
    const next: Item[] = isSample ? [] : [...basket];
    for (const m of review.matches) {
      if (!m.row) continue;
      const at = next.findIndex((b) => b.c === m.row![0]);
      if (at >= 0) next[at] = { ...next[at], q: next[at].q + m.qty }; else next.push({ c: m.row[0], q: m.qty });
    }
    onChange(next); setReview(null); setMode('search');
  };

  const modes: [Mode, string][] = [['search', 'חיפוש'], ['receipt', 'קבלה'], ['list', 'רשימה'], ['scan', 'ברקוד']];
  const lines = shown ? shown.lines : basket.filter((b) => byCode.has(b.c)).map((b) => ({ item: b, row: byCode.get(b.c)!, total: null, promo: null, estimated: false }));

  return (
    <aside className={`basket${flash ? ' flash' : ''}`} aria-label="הסל שלי">
      <header className="basket-head">
        <div>
          <h2>הסל שלי</h2>
          <p className="muted">{isSample ? 'סל לדוגמה. מוסיפים מוצר אחד, והוא מתחלף בסל שלך.' : `${basket.length} מוצרים. נשמר לבד.`}</p>
        </div>
        {!isSample && basket.length > 0 && <button className="btn ghost press" onClick={() => onChange([])} title="מרוקן את הסל">ריקון</button>}
      </header>

      <div className="seg" role="tablist" aria-label="איך מוסיפים לסל">
        {modes.map(([m, label]) => <button key={m} role="tab" aria-selected={mode === m} aria-pressed={mode === m} className="chip press" onClick={() => { setMode(m); setErr(''); setReview(null); }}>{label}</button>)}
      </div>

      {mode === 'search' && (
        <div className="add">
          <div className="field">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם מוצר או ברקוד" aria-label="חיפוש מוצר" />
            <button className="icon press" onClick={dictate} title="הקלטה במקום הקלדה" aria-label="הקלטה">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </button>
          </div>
          {sugg.length > 0 && (
            <ul className="sugg">
              {sugg.map((r) => (
                <li key={r[0]}><button className="press" onClick={() => { add(r[0]); setQ(''); }}>
                  <span>{r[1]}</span><small>{unitText(r)} · מ-{nis(Math.min(...(r[6].filter((x) => x != null) as number[])), 2)} ₪</small>
                </button></li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && !sugg.length && <p className="muted">לא נמצא מוצר כזה בשתי רשתות לפחות. מותג פרטי של רשת אחת לא ניתן להשוואה.</p>}
        </div>
      )}
      {mode === 'receipt' && !review && <Drop busy={busy} onImage={handleImage} onText={handleText} />}
      {mode === 'list' && !review && <ListBox onText={handleText} />}
      {mode === 'scan' && <Scanner onCode={(c) => { const r = byCode.get(c.replace(/^0+/, '')); if (r) { add(r[0]); return r[1]; } return null; }} />}
      {err && <p className="problem">{err}</p>}

      {review && (
        <div className="review">
          <p className="insight-s"><b>{review.matches.filter((m) => m.sure).length}</b> מתוך <b>{review.matches.length}</b> שורות זוהו בוודאות. השאר מסומנות לבדיקה.</p>
          {review.total != null && (() => {
            const sum = review.matches.reduce((s, m) => s + (m.price || 0) * m.qty, 0);
            const ok = Math.abs(sum - review.total!) < 1;
            return <p className={ok ? 'solution' : 'problem'}>{ok ? `הסכום תואם לקבלה: ${nis(review.total!, 2)} ₪.` : `סכום השורות ${nis(sum, 2)} ₪ מול ${nis(review.total!, 2)} ₪ בקבלה. כדאי לצלם שוב או לתקן.`}</p>;
          })()}
          <ul className="review-list">
            {review.matches.map((m, k) => (
              <li key={k} className={m.sure ? '' : 'check'}>
                <small>{m.text}{m.qty > 1 ? ` × ${m.qty}` : ''}</small>
                <select value={m.row ? m.row[0] : ''} onChange={(e) => setReview({ ...review, matches: review.matches.map((x, j) => (j === k ? { ...x, row: byCode.get(e.target.value) || null, sure: true } : x)) })} aria-label="בחירת מוצר">
                  <option value="">לא להוסיף</option>
                  {m.options.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="btn primary press" onClick={acceptReview}>הוספה לסל</button>
            <button className="btn ghost press" onClick={() => setReview(null)}>ביטול</button>
          </div>
        </div>
      )}

      <div className="receipt-head">
        <span>{shown ? <>מחירים ב<b>{storeLabel(shown.store)}</b></> : 'מוצר'}</span>
        <span className="num">{shown ? `${nis(shown.total, 2)} ₪` : ''}</span>
      </div>
      <ul className="receipt">
        {lines.map((l) => {
          const cheaperElsewhere = shown && best && shown.i !== best.i && l.total != null && (() => { const b = best.lines.find((x) => x.item.c === l.item.c); return b && b.total != null && b.total < l.total! - 0.005 ? l.total! - b.total : 0; })();
          return (
            <li key={l.item.c}>
              <div className="r-name">
                <span>{l.row[1]}</span>
                <small>{unitText(l.row)}{l.promo ? ` · מבצע ${l.promo[2] > 1 ? `${l.promo[2]} ב-${nis(l.promo[1] * l.promo[2], 2)}` : nis(l.promo[1], 2)}` : ''}{cheaperElsewhere ? ` · יקר כאן ב-${nis(cheaperElsewhere as number, 2)}` : ''}</small>
              </div>
              {!isSample && (
                <div className="qty">
                  <button className="press" onClick={() => setQty(l.item.c, l.item.q - 1)} aria-label="פחות">−</button>
                  <span className="num">{l.item.q}</span>
                  <button className="press" onClick={() => setQty(l.item.c, l.item.q + 1)} aria-label="עוד">+</button>
                </div>
              )}
              <span className={`num r-price${l.estimated ? ' est' : ''}${cheaperElsewhere ? ' high' : ''}`} title={l.estimated ? 'לא נמכר בסניף הזה. הוערך לפי חציון האזור.' : ''}>{shown ? (l.total != null ? nis(l.total, 2) : 'חסר') : ''}</span>
            </li>
          );
        })}
        {!lines.length && <li className="empty">הסל ריק. מחפשים מוצר, מצלמים קבלה או מדביקים רשימה.</li>}
      </ul>
    </aside>
  );
}

function toBase64(file: File): Promise<{ data: string; mime: string }> {
  // downscale on the device: faster upload, and the full-resolution photo never leaves the phone
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res({ data: c.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg' });
    };
    img.onerror = () => rej(new Error('הקובץ אינו תמונה')); img.src = url;
  });
}

function Drop({ busy, onImage, onText }: { busy: string; onImage: (f: File) => void; onText: (t: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); onImage(f); return; }
      const t = e.clipboardData?.getData('text'); if (t && t.trim().length > 3 && !(e.target as HTMLElement)?.closest('input,textarea')) onText(t);
    };
    window.addEventListener('paste', paste); return () => window.removeEventListener('paste', paste);
  }, [onImage, onText]);
  return (
    <div className={`drop press${over ? ' over' : ''}`} role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter') input.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onImage(f); }}>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = ''; }} />
      {busy ? <b className="pulse">{busy}</b> : <><b>צילום של קבלה</b><span>לחיצה, גרירה או הדבקה. ארבע ספרות הכרטיס: כדאי לכסות לפני הצילום.</span></>}
    </div>
  );
}

function ListBox({ onText }: { onText: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <div className="add">
      <textarea value={t} onChange={(e) => setT(e.target.value)} rows={4} placeholder={'מוצר בכל שורה, למשל:\n2 קוטג 5%\nקפה נמס עלית'} aria-label="רשימת קניות" />
      <button className="btn primary press" disabled={t.trim().length < 2} onClick={() => onText(t)}>זיהוי המוצרים</button>
    </div>
  );
}

function Scanner({ onCode }: { onCode: (c: string) => string | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('');
  const [on, setOn] = useState(false);
  const supported = typeof (window as any).BarcodeDetector !== 'undefined';
  useEffect(() => {
    if (!on || !supported) return;
    let stop = false, stream: MediaStream | null = null, last = '';
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current) return; video.current.srcObject = stream; await video.current.play();
        const det = new (window as any).BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
        while (!stop) {
          const codes = await det.detect(video.current).catch(() => []);
          if (codes[0] && codes[0].rawValue !== last) { last = codes[0].rawValue; const name = onCode(last); setMsg(name ? `נוסף: ${name}` : `ברקוד ${last} לא נמצא בשתי רשתות לפחות.`); }
          await new Promise((r) => setTimeout(r, 350));
        }
      } catch { setMsg('אין גישה למצלמה. מאשרים אותה בדפדפן ומנסים שוב.'); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [on, supported, onCode]);
  if (!supported) return <p className="muted pad">סריקת ברקוד עובדת ב-Chrome בטלפון. במחשב: מקלידים את מספר הברקוד בחיפוש.</p>;
  return (
    <div className="add">
      {on ? <video ref={video} className="scan" muted playsInline /> : <button className="btn primary press" onClick={() => setOn(true)}>פתיחת המצלמה</button>}
      <p className="muted">סורקים מוצרים במזווה. ברקוד הוא זיהוי ודאי, בלי ניחוש.</p>
      {msg && <p className="insight-s">{msg}</p>}
    </div>
  );
}
