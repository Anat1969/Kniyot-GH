// Reads a supermarket receipt photo into structured lines. The image is not stored anywhere.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const hits = new Map<string, number[]>(); // per-instance rate limit
const PROMPT = `זו קבלה מסופרמרקט בישראל. חלץ כל שורת מוצר.
לכל שורה: name (השם בדיוק כפי שהוא מודפס), qty (כמות, ברירת מחדל 1), unit_price (מחיר ליחידה לפני הנחה), total (סכום השורה אחרי הנחות ששייכות לה), barcode (רק אם מודפס, אחרת מחרוזת ריקה).
שורת הנחה או מבצע אינה מוצר: הפחת אותה מה-total של המוצר שמעליה.
store: שם הרשת והסניף כפי שמודפס. total: הסכום הסופי לתשלום.
אל תמציא שורות. אם התמונה אינה קבלה, החזר lines ריק.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'שיטה לא נתמכת' }, 405);
  const ip = (req.headers.get('x-forwarded-for') || 'x').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 12) return json({ error: 'יותר מדי קבלות בשעה האחרונה. מנסים שוב מאוחר יותר' }, 429);
  recent.push(now); hits.set(ip, recent);

  let body: { image?: string; mime?: string };
  try { body = await req.json(); } catch { return json({ error: 'בקשה לא תקינה' }, 400); }
  const image = body.image || '';
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(body.mime || '') ? body.mime! : 'image/jpeg';
  if (image.length < 2000 || image.length > 6_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return json({ error: 'התמונה חסרה או גדולה מדי' }, 400);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'קריאת קבלות לא מוגדרת בשרת' }, 503);
  const schema = {
    type: 'OBJECT',
    properties: {
      store: { type: 'STRING' }, total: { type: 'NUMBER' },
      lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        name: { type: 'STRING' }, qty: { type: 'NUMBER' }, unit_price: { type: 'NUMBER' }, total: { type: 'NUMBER' }, barcode: { type: 'STRING' },
      }, required: ['name', 'qty', 'unit_price', 'total'] } },
    },
    required: ['store', 'lines'],
  };
  try {
    // the newest free model first, an older one when it is overloaded
    let r: Response | null = null, j: any = null;
    for (const model of ['gemini-flash-latest', 'gemini-2.5-flash']) {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: image } }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
        }),
      });
      j = await r.json();
      if (r.ok) break;
    }
    if (!r || !r.ok) return json({ error: r && r.status === 429 ? 'המכסה היומית של קריאת הקבלות נגמרה. אפשר להדביק את הרשימה כטקסט' : 'קריאת הקבלה נכשלה' }, 502);
    const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
    const out = JSON.parse(text);
    const lines = (Array.isArray(out.lines) ? out.lines : []).slice(0, 150).map((l: Record<string, unknown>) => ({
      name: String(l.name || '').slice(0, 80), qty: Math.max(0.01, Number(l.qty) || 1),
      unit_price: Number(l.unit_price) || 0, total: Number(l.total) || 0, barcode: String(l.barcode || '').replace(/\D/g, ''),
    })).filter((l: { name: string }) => l.name.length > 1);
    if (!lines.length) return json({ error: 'לא זוהו שורות מוצר בתמונה. מצלמים שוב, ישר ובאור טוב' }, 422);
    return json({ store: String(out.store || '').slice(0, 80), total: Number(out.total) || null, lines });
  } catch {
    return json({ error: 'קריאת הקבלה נכשלה' }, 502);
  }
});
