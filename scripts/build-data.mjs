// Builds public/data/{meta,catalog,history}.json from the official price-transparency files.
// Sources: prices.shufersal.co.il and url.publishedprices.co.il (public, by regulation, 2015).
// Usage: node scripts/build-data.mjs [outDir]
import { execFileSync } from 'node:child_process';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, '..', 'public', 'data');
const region = JSON.parse(readFileSync(join(HERE, process.env.REGION || 'region.json'), 'utf8'));
const GEO_CACHE = join(HERE, 'geocode-cache.json');
const geo = existsSync(GEO_CACHE) ? JSON.parse(readFileSync(GEO_CACHE, 'utf8')) : {};
const TMP = mkdtempSync(join(tmpdir(), 'kniyot-'));
const UA = 'Mozilla/5.0 (compatible; price-compare/1.0)';
const log = (...a) => console.error(...a);

function curl(args, { binary = false, tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const out = execFileSync('curl', ['-sS', '-L', '--fail', '-m', '180', '-A', UA, ...args], {
        maxBuffer: 1 << 30,
      });
      return binary ? out : out.toString('utf8');
    } catch (e) {
      last = e;
      execFileSync('sleep', [String(2 + i * 4)]);
    }
  }
  throw last;
}

function decode(buf) {
  let b = buf;
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  else if (b[0] === 0x50 && b[1] === 0x4b) {
    // single-file zip: local header, then deflate stream
    const nameLen = b.readUInt16LE(26), extraLen = b.readUInt16LE(28);
    b = inflateRawSync(b.subarray(30 + nameLen + extraLen));
  }
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return new TextDecoder('utf-16').decode(b);
  return new TextDecoder('utf-8').decode(b);
}

const tag = (s, name) => {
  const m = s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
};
const blocks = (s, name) => s.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, 'gi')) || [];
const clean = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

function inRegion(st) {
  const city = tag(st, 'City'), name = tag(st, 'StoreName'), addr = tag(st, 'Address');
  if (tag(st, 'StoreType') === '2') return false; // online picking
  if (/ליקוט|אונליין|אינטרנט|online/i.test(name)) return false;
  if (region.cityCodes.includes(city.replace(/^0+/, ''))) return true;
  return region.cityNames.some((c) => city.includes(c) || name.includes(c));
}

function storeObj(chain, st, sub = '') {
  return {
    chain: chain.key, chainName: chain.name, sub,
    id: tag(st, 'StoreID').replace(/^0+/, '') || '0',
    name: clean(tag(st, 'StoreName')), address: clean(tag(st, 'Address')),
  };
}

// ---------- Shufersal ----------
function shufersalLinks(cat, storeId) {
  const html = curl([`https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=${cat}&storeId=${storeId}`]);
  return [...html.matchAll(/href="([^"]*blob[^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}
function shufersal(chain) {
  const xml = decode(curl([shufersalLinks(5, 0)[0]], { binary: true }));
  const stores = [];
  for (const sc of blocks(xml, 'SubChain')) {
    const sub = clean(tag(sc, 'SubChainName'));
    if (/אונליין|online|ישיר/i.test(sub)) continue;
    for (const st of blocks(sc, 'Store')) if (inRegion(st)) stores.push(storeObj(chain, st, sub));
  }
  for (const s of stores) {
    const pick = (cat, prefix) => shufersalLinks(cat, s.id).filter((u) => u.includes(prefix)).sort().pop();
    try {
      const p = pick(2, 'PriceFull'), q = pick(4, 'PromoFull');
      if (p) { s.priceXml = decode(curl([p], { binary: true })); s.fileDate = (p.match(/-(\d{8})-?\d{4}/) || [])[1]; }
      if (q) s.promoXml = decode(curl([q], { binary: true }));
    } catch (e) { log('  shufersal store failed', s.id, e.message.slice(0, 80)); }
  }
  return stores;
}

// ---------- Cerberus (publishedprices) ----------
function cerberus(chain) {
  const base = 'https://url.publishedprices.co.il';
  const jar = join(TMP, chain.key + '.cj');
  const token = (html) => (html.match(/csrftoken" content="([^"]*)"/) || [])[1] || '';
  const t1 = token(curl(['-c', jar, base + '/login']));
  curl(['-b', jar, '-c', jar, '-o', '/dev/null', '-d', `username=${chain.user}&password=${chain.pass || ''}&csrftoken=${t1}&r=`, base + '/login/user']);
  const t2 = token(curl(['-b', jar, '-c', jar, base + '/file']));
  const dir = JSON.parse(curl(['-b', jar, '-d',
    `sEcho=1&iColumns=5&sColumns=%2C%2C%2C%2C&iDisplayStart=0&iDisplayLength=100000&mDataProp_0=fname&mDataProp_1=typeLabel&mDataProp_2=size&mDataProp_3=ftime&mDataProp_4=&sSearch=&bRegex=false&iSortingCols=0&cd=%2F&csrftoken=${t2}`,
    base + '/file/json/dir']));
  const files = (dir.aaData || []).map((x) => x.fname);
  const get = (f) => decode(curl(['-b', jar, `${base}/file/d/${f}`], { binary: true }));
  const storesFile = files.filter((f) => /^stores/i.test(f)).sort().pop();
  if (!storesFile) return [];
  const stores = blocks(get(storesFile), 'Store').filter(inRegion).map((st) => storeObj(chain, st));
  for (const s of stores) {
    // two naming schemes: <chain>-<store>-<datetime> and <chain>-<sub>-<store>-<date>-<time>
    const stamp = (f) => (f.match(new RegExp(`-0*${s.id}-(\\d{8})`)) || [])[1] || '';
    const pick = (prefix) => files
      .filter((f) => new RegExp(`^${prefix}\\d+-(?:\\d+-)?0*${s.id}-\\d{8}`, 'i').test(f))
      .sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.localeCompare(b)).pop();
    try {
      const p = pick('PriceFull'), q = pick('PromoFull');
      if (p) { s.priceXml = get(p); s.fileDate = stamp(p); }
      if (q) s.promoXml = get(q);
      if (process.env.DUMP && q) writeFileSync(join(process.env.DUMP, `${chain.key}-${s.id}-promo.xml`), s.promoXml);
    } catch (e) { log('  store failed', chain.key, s.id, e.message.slice(0, 80)); }
  }
  return stores;
}

// ---------- Geocoding (OpenStreetMap Nominatim, cached) ----------
function geocode(s) {
  const key = `${s.chain}|${s.id}`;
  if (geo[key]) return geo[key];
  const street = s.address.replace(/,?\s*(אשדוד|מתחם.*|סטאר סנטר.*|א\.ת\..*|רובע.*|קניון.*)$/g, '').replace(/[,"]/g, ' ').trim();
  const m = street.match(/\d+/);
  const words = street.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
  const w2 = words.replace(/בי ח/, 'בית חולים').replace(/רח'|שכונת|שדרות|פינת.*/g, ' ')
    .split(/\s+/).filter((t) => t.length > 1).join(' ');
  const queries = [...new Set([m ? `${words} ${m[0]}, ${region.name}` : null, `${words}, ${region.name}`,
    m ? `${w2} ${m[0]}, ${region.name}` : null, `${w2}, ${region.name}`].filter(Boolean))];
  for (const q of queries) {
    try {
      execFileSync('sleep', ['1.2']);
      const r = JSON.parse(curl([`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&accept-language=he&q=${encodeURIComponent(q)}`]));
      if (r[0]) {
        const lat = +r[0].lat, lon = +r[0].lon;
        if (Math.abs(lat - region.center[0]) < 0.15 && Math.abs(lon - region.center[1]) < 0.15) {
          return (geo[key] = { lat: +lat.toFixed(5), lon: +lon.toFixed(5), q });
        }
      }
    } catch (e) { log('  geocode failed', q); }
  }
  return null;
}

// ---------- Parse ----------
function parsePrices(xml) {
  const out = new Map();
  for (const it of blocks(xml, 'Item')) {
    const code = tag(it, 'ItemCode').replace(/^0+/, '');
    const price = parseFloat(tag(it, 'ItemPrice'));
    if (!/^\d{8,14}$/.test(code) || !(price > 0)) continue; // real barcodes only
    out.set(code, {
      price, name: clean(tag(it, 'ItemName') || tag(it, 'ItemNm')),
      man: clean(tag(it, 'ManufacturerName')), qty: tag(it, 'Quantity'),
      unit: clean(tag(it, 'UnitQty') || tag(it, 'UnitOfMeasure')), w: tag(it, 'bIsWeighted') === '1' ? 1 : 0,
    });
  }
  return out;
}

function parsePromos(xml, prices, today) {
  const out = new Map(); // code -> {u, n, end, d}
  const num = (x) => parseFloat(x || '0') || 0;
  for (const pr of blocks(xml, 'Promotion')) {
    const clubs = [...pr.matchAll(/<ClubId>\s*(\d+)[^<]*<\/ClubId>/gi)].map((m) => m[1]);
    if (clubs.length && !clubs.includes('0')) continue; // members only
    if (tag(pr, 'AdditionalIsCoupon') === '1') continue;
    if (num(tag(pr, 'MinPurchaseAmount') || tag(pr, 'MinPurchaseAmnt')) > 0) continue;
    const end = (tag(pr, 'PromotionEndDateTime') || tag(pr, 'PromotionEndDate')).slice(0, 10);
    const start = (tag(pr, 'PromotionStartDateTime') || tag(pr, 'PromotionStartDate')).slice(0, 10);
    if (end && end < today) continue;
    if (start && start > today) continue;
    const d = clean(tag(pr, 'PromotionDescription')).slice(0, 60);
    if (/קופון|מועדון|אשראי|חבר/.test(d)) continue;
    let items = blocks(pr, 'PromotionItem');
    if (!items.length) items = blocks(pr, 'Item');
    if (!items.length || items.length > 400) continue;
    for (const it of items) {
      const code = tag(it, 'ItemCode').replace(/^0+/, '');
      const base = prices.get(code);
      if (!base) continue;
      if (!['1', '10'].includes(tag(it, 'RewardType') || tag(pr, 'RewardType'))) continue;
      const n = Math.round(num(tag(it, 'MinQty') || tag(pr, 'MinQty') || '1')) || 1;
      if (n > 6) continue;
      const total = num(tag(it, 'DiscountedPrice') || tag(pr, 'DiscountedPrice'));
      const per = num(tag(it, 'DiscountedPricePerMida') || tag(pr, 'DiscountedPricePerMida'));
      let u = total > 0 ? total / n : per;
      if (!(u > 0)) continue;
      if (u >= base.price * 0.995 || u < base.price * 0.3) continue; // not a real discount, or implausible
      const prev = out.get(code);
      if (!prev || u < prev.u) out.set(code, { u: +u.toFixed(2), n, end: end > '2027-06' ? '' : end, d });
    }
  }
  return out;
}

// ---------- Main ----------
const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
let stores = [];
const failures = [];
for (const chain of region.chains) {
  try {
    const got = chain.portal === 'shufersal' ? shufersal(chain) : cerberus(chain);
    log(chain.name, 'stores in region:', got.length, 'with prices:', got.filter((s) => s.priceXml).length);
    for (const s of got) if (!s.priceXml) failures.push({ chain: chain.name, store: s.name, why: 'אין קובץ מחירים היום' });
    stores.push(...got.filter((s) => s.priceXml));
  } catch (e) {
    log(chain.name, 'FAILED', e.message.slice(0, 120));
    failures.push({ chain: chain.name, store: '', why: 'הפורטל לא ענה' });
  }
}

const products = new Map(); // code -> {name, man, qty, unit, w, p:[], pr:[]}
const kept = [];
for (const s of stores) {
  const prices = parsePrices(s.priceXml);
  if (prices.size < 1500) { failures.push({ chain: s.chainName, store: s.name, why: `סניף קטן: ${prices.size} מוצרים` }); continue; }
  const g = geocode(s);
  const idx = kept.length;
  kept.push({
    chain: s.chain, chainName: s.chainName, sub: s.sub || '', id: s.id, name: s.name, address: s.address,
    lat: g ? g.lat : null, lon: g ? g.lon : null, located: !!g, items: prices.size,
    fileDate: s.fileDate ? `${s.fileDate.slice(0, 4)}-${s.fileDate.slice(4, 6)}-${s.fileDate.slice(6, 8)}` : '',
  });
  const promos = s.promoXml ? parsePromos(s.promoXml, prices, today) : new Map();
  for (const [code, it] of prices) {
    let p = products.get(code);
    if (!p) products.set(code, (p = { name: it.name, man: it.man, qty: it.qty, unit: it.unit, w: it.w, p: [], pr: [], chains: new Set() }));
    if (it.name.length > p.name.length && it.name.length < 60) p.name = it.name;
    p.p[idx] = it.price; p.chains.add(s.chain);
    const pm = promos.get(code);
    if (pm) p.pr.push([idx, pm.u, pm.n, pm.end.slice(5).replace('-', ''), pm.d]);
  }
  log(' ', s.chainName, s.name, 'items', prices.size, 'promos', promos.size, g ? 'located' : 'NOT located');
}
writeFileSync(GEO_CACHE, JSON.stringify(geo, null, 1));

const n = kept.length;
const rows = [];
let single = 0;
for (const [code, p] of products) {
  if (p.chains.size < 2) { single++; continue; }
  const prices = Array.from({ length: n }, (_, i) => (p.p[i] == null ? null : p.p[i]));
  rows.push([code, p.name, p.man === 'לא ידוע' ? '' : p.man, p.qty, p.unit, p.w, prices, p.pr]);
}
rows.sort((a, b) => a[1].localeCompare(b[1], 'he'));

// history: lowest shelf price per product, recorded only when it changes
const histFile = join(OUT, 'history.json');
let hist = { days: [], p: {} };
if (existsSync(histFile)) { try { hist = JSON.parse(readFileSync(histFile, 'utf8')); } catch {} }
if (hist.days[hist.days.length - 1] !== today) hist.days.push(today);
const di = hist.days.length - 1;
const live = new Set();
for (const r of rows) {
  const min = Math.min(...r[6].filter((x) => x != null));
  live.add(r[0]);
  const h = hist.p[r[0]] || (hist.p[r[0]] = []);
  const lastEntry = h[h.length - 1];
  if (!lastEntry || lastEntry[1] !== min) { if (lastEntry && lastEntry[0] === di) lastEntry[1] = min; else h.push([di, min]); }
}
for (const c of Object.keys(hist.p)) if (!live.has(c)) delete hist.p[c];

// a starter basket: for each everyday keyword, the product carried by the most stores
const KEYS = ['חלב 3%', 'גבינת קוטג', 'גבינה לבנה 5%', 'גבינה צהובה', 'יוגורט', 'חמאה', 'קפה נמס', 'קפה טורקי', 'סוכר לבן', 'קמח', 'אורז', 'פסטה', 'ספגטי', 'שמן קנולה', 'טונה', 'חומוס', 'טחינה', 'קטשופ', 'מיונז', 'קורנפלקס', 'שוקולד', 'במבה', 'ביסלי', 'קוקה קולה', 'מים מינרלים', 'נייר טואלט', 'נוזל כלים', 'אבקת כביסה', 'מרכך כביסה', 'שמפו', 'משחת שיניים'];
const sample = [];
for (const k of KEYS) {
  const toks = k.split(' ');
  let best = null, bestN = 0;
  for (const r of rows) {
    const at = r[1].indexOf(toks[0]);
    if (r[5] || at < 0 || at > 1 || !toks.every((t) => r[1].includes(t))) continue;
    const c = r[6].filter((x) => x != null).length;
    if (c > bestN) { best = r; bestN = c; }
  }
  if (best && bestN >= Math.ceil(n * 0.5) && !sample.includes(best[0])) sample.push(best[0]);
}

mkdirSync(OUT, { recursive: true });
const meta = {
  date: today, generatedAt: new Date().toISOString(),
  region: { id: region.id, name: region.name, nameLatin: region.nameLatin, center: region.center },
  stores: kept, failures, sample,
  stats: { products: rows.length, singleChain: single, chains: new Set(kept.map((s) => s.chain)).size },
  source: 'קובצי שקיפות המחירים שהרשתות מפרסמות לפי תקנות קידום התחרות בענף המזון (שקיפות מחירים), 2014',
};
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta));
writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(rows));
writeFileSync(histFile, JSON.stringify(hist));
log(`done: ${n} stores, ${rows.length} comparable products, ${single} single-chain products dropped`);
if (n < 3) { log('too few stores, failing'); process.exit(1); }
