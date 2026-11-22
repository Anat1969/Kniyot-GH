import { COVERAGE_MIN, nis, storeLabel, type StoreResult } from './logic';
import type { Data } from './state';
import { fmtDate } from './App';

/** Reliability: where every number comes from, how it is checked, and what the tool cannot know. */
export default function Trust({ data, results, basketSize }: { data: Data; results: StoreResult[]; basketSize: number }) {
  const m = data.meta;
  const on = results.filter((r) => r.eligible);
  const full = results.filter((r) => r.have === r.lines.length && r.lines.length > 0).length;
  const located = m.stores.filter((s) => s.located).length;
  const chains = [...new Set(m.stores.map((s) => s.chainName))];
  return (
    <main className="trust">
      <section className="trust-lead">
        <p className="crumb">אמינות</p>
        <h1>כל מחיר כאן הוא <mark>דיווח רשמי של הרשת</mark>, לא הערכה</h1>
        <p className="sub">החוק מחייב כל רשת גדולה לפרסם את המחיר של כל מוצר בכל סניף, כל יום. הכלי מוריד את הקבצים ומצליב אותם לפי ברקוד.</p>
        <div className="facts">
          <div className="fact"><b className="big num">{m.stores.length}</b><span>סניפים ב{m.region.name}, מ-{chains.length} רשתות: {chains.join(', ')}.</span></div>
          <div className="fact"><b className="big num">{nis(m.stats.products)}</b><span>מוצרים שנמכרים בשתי רשתות לפחות, ולכן ניתנים להשוואה לפי ברקוד.</span></div>
          <div className="fact"><b className="big num">{on.length}</b><span>סניפים מחזיקים לפחות {Math.round(COVERAGE_MIN * 100)}% מהסל שלך ({basketSize} מוצרים). {full} מחזיקים את כולו.</span></div>
          <div className="fact"><b className="big num">{located}</b><span>סניפים מוקמו במפה לפי הכתובת שבקובץ. השאר מופיעים בדירוג בלי מרחק.</span></div>
        </div>
        <div className="haiku" aria-label="הייקו">
          <p>קבלה ארוכה</p><p>אותו סל, רחוב אחר</p><p>מאה שקל פחות</p>
        </div>
      </section>
      <section className="trust-cols">
        <div>
          <h2>איך המספר מחושב</h2>
          <ol className="steps">
            <li><b>זיהוי:</b> כל מוצר בסל הוא ברקוד. אותו ברקוד בכל סניף הוא אותו מוצר, באותה אריזה.</li>
            <li><b>מחיר:</b> מחיר המדף מקובץ המחירים של הסניף, מתאריך {fmtDate(m.date)}.</li>
            <li><b>מבצע:</b> נספר רק מבצע פתוח לכולם, במחיר קבוע או בכמות, כשהכמות בסל מספיקה.</li>
            <li><b>סניף חסר:</b> סניף שמחזיק פחות מ-{Math.round(COVERAGE_MIN * 100)}% מהסל יורד מההשוואה, כדי שלא ינצח בזכות מה שאין בו.</li>
            <li><b>מוצר חסר:</b> בסניף שנשאר, מוצר חסר מקבל את חציון המחיר באזור, ומסומן.</li>
            <li><b>נסיעה:</b> מרחק בקו אווירי, הלוך ושוב, כפול עלות לק״מ.</li>
          </ol>
        </div>
        <div>
          <h2>מה הכלי לא יודע</h2>
          <ul className="limits">
            <li>מבצעי מועדון, קופונים ומבצעים מורכבים לא נספרים.</li>
            <li>פירות, ירקות ומוצרים במשקל לא מושווים: אין להם ברקוד משותף בין הרשתות.</li>
            <li>מותג פרטי של רשת אחת לא מושווה ({nis(m.stats.singleChain)} מוצרים כאלה ירדו).</li>
            <li>הקובץ אומר מה הסניף מוכר, לא מה יש על המדף ברגע זה.</li>
            <li>הקבצים עצמם עלולים לכלול טעויות של הרשת. לפני נסיעה מיוחדת כדאי לוודא מול הסניף.</li>
            {m.failures.map((f, i) => <li key={i} className="problem-li">{f.chain}{f.store ? `, ${f.store}` : ''}: {f.why}. לכן הסניף לא בהשוואה היום.</li>)}
          </ul>
        </div>
        <div>
          <h2>הסניפים והקבצים</h2>
          <ul className="files">
            {m.stores.map((s, i) => <li key={i}><span>{storeLabel(s)}</span><small>{s.address} · {nis(s.items)} מוצרים{s.fileDate ? ` · קובץ ${fmtDate(s.fileDate)}` : ''}{s.located ? '' : ' · לא מוקם'}</small></li>)}
          </ul>
          <p className="source">מקור: {m.source}. הפורטלים: prices.shufersal.co.il, url.publishedprices.co.il. מיקום: OpenStreetMap. {data.fresh ? 'נטען העדכון היומי.' : 'נטענה התמונה שנבנתה עם האפליקציה.'}</p>
        </div>
      </section>
    </main>
  );
}
