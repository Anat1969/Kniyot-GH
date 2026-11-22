// Browser gate: the main path, the receipt path, and a second clean device that sees the basket from the cloud.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4173';
const MENU = process.env.AI_MENU; // local copy of ai-menu.js when the shared host is unreachable
const RECEIPT = process.env.RECEIPT_JSON; // a saved answer of the receipt function
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const open = async (hash) => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    if (MENU) await page.route('**/appofapp-gh.vercel.app/ai-menu.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(MENU) }));
    await page.route('**/raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: '' }));
    if (RECEIPT) await page.route('**/functions/v1/kniyot-receipt', (r) => r.fulfill({ contentType: 'application/json', body: fs.readFileSync(RECEIPT) }));
    await page.goto(BASE + '/#/' + hash); await page.waitForSelector('.receipt li', { timeout: 20000 });
    return page;
  };
  const p1 = await open('where');
  ok(await p1.locator('ai-menu .logo').isVisible(), 'logo button in the top bar');
  ok(/זול ב-|הזול ביותר/.test(await p1.locator('h1').textContent()), 'headline states the conclusion');
  ok((await p1.locator('.rank-row:not(.dead)').count()) >= 3, 'at least three ranked branches');
  ok((await p1.locator('svg.ringmap g.col').count()) >= 5, 'branches drawn on the map');
  const fit = await p1.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth);
  ok(fit, 'the screen fits without page scroll');

  // the home point: typed the way people type it, found, named, and drawn on the street map
  ok((await p1.locator('svg.ringmap .tiles image').count()) >= 4, 'street map tiles under the branches');
  await p1.fill('input[aria-label="כתובת הבית"]', 'רחוב נוף הרים , הר אדר');
  await p1.locator('.home-ctl .chip', { hasText: 'חיפוש' }).click();
  await p1.waitForFunction(() => /נמצא/.test(document.querySelector('.home-line')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  const line = await p1.locator('.home-line').textContent();
  ok(/^הבית:/.test(line) && /נמצא: נוף הרים/.test(line), 'address is found and named: ' + line.slice(0, 70));
  await p1.waitForSelector('.receipt li');
  ok(/הר אדר/.test(await p1.locator('svg.ringmap .home-t').textContent()), 'home pin on the map carries the address');
  const far = await p1.locator('.rank-row:not(.dead) .rank-name small').first().textContent();
  ok(/ק״מ/.test(far), 'distances are measured from the new home');
  if (process.env.SHOT) await p1.screenshot({ path: process.env.SHOT });
  // the same placement by clicking the map
  const before = await p1.locator('.home-line small').textContent();
  await p1.locator('.home-ctl .chip', { hasText: 'בחירה במפה' }).click();
  const box = await p1.locator('svg.ringmap').boundingBox();
  await p1.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.62);
  await p1.waitForFunction((b) => (document.querySelector('.home-line small')?.textContent || b) !== b, before, { timeout: 20000 }).catch(() => {});
  const after = await p1.locator('.home-line small').textContent();
  ok(after !== before && /נמצא/.test(await p1.locator('.home-line').textContent()), `a click on the map moves the home (${before} to ${after})`);
  await p1.waitForSelector('.receipt li');

  await p1.fill('input[aria-label="חיפוש מוצר"]', 'במבה'); await p1.waitForSelector('.sugg button');
  await p1.locator('.sugg button').first().click();
  ok((await p1.locator('.receipt li').count()) === 1, 'first product replaces the sample basket');
  await p1.fill('input[aria-label="חיפוש מוצר"]', 'קפה נמס'); await p1.locator('.sugg button').first().click();
  await p1.locator('.qty button[aria-label="עוד"]').first().click();
  ok((await p1.locator('.receipt li').count()) === 2, 'second product added');

  if (RECEIPT) {
    await p1.locator('.seg .chip', { hasText: 'קבלה' }).click();
    await p1.setInputFiles('.drop input[type=file]', path.join(__dirname, 'fixtures', 'receipt.jpg'));
    await p1.waitForSelector('.review-list li', { timeout: 20000 });
    ok(/תואם/.test(await p1.locator('.review').textContent()), 'receipt lines add up to the receipt total');
    await p1.locator('.review .btn.primary').click();
    ok((await p1.locator('.receipt li').count()) >= 8, 'receipt lines entered the basket');
  }
  for (const r of ['when', 'what', 'trust']) {
    await p1.goto(BASE + '/#/' + r); await p1.waitForTimeout(500);
    ok((await p1.locator('h1').textContent()).length > 10, `screen ${r} has a headline`);
  }
  await p1.waitForTimeout(2500); // cloud save
  const key = await p1.evaluate(() => localStorage.getItem('kniyot.key.v1'));
  const n1 = await p1.evaluate(() => JSON.parse(localStorage.getItem('kniyot.state.v1')).basket.length);
  const p2 = await open('where?k=' + key);
  await p2.waitForTimeout(2500);
  const n2 = await p2.locator('.receipt li').count();
  ok(n2 === n1, `a second clean device sees the same basket from the cloud (${n1} / ${n2})`);
  const english = await p2.evaluate(() => [...document.querySelectorAll('button, a, h1, h2, p, label, .legend')].map((e) => e.textContent.trim()).filter((t) => /^[A-Za-z ]{4,}$/.test(t)));
  ok(english.length === 0, 'no English-only text in the interface ' + english.join('|'));
  await b.close(); process.exit(fails ? 1 : 0);
})();
