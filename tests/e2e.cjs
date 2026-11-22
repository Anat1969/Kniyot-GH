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
    ok((await p1.locator('.receipt li').count()) >= 10, 'receipt lines entered the basket');
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
