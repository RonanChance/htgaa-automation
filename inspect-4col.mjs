import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1500, height: 1000, deviceScaleFactor: 2 } });
const page = await browser.newPage();
await page.goto('http://localhost:5173/cfps', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1300));
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(d => d.textContent.replace(/\s+/g,' ').trim().startsWith('Easy ·'));
  el?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -60);
});
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/4col.png' });
await browser.close();
