import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1600, height: 950, deviceScaleFactor: 2 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('http://localhost:5173/cfps', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('div[role="button"]')].filter(d => d.textContent.includes('water room:'));
  cards[0].scrollIntoView({ block: 'start' });
  window.scrollBy(0, -160);
});
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/v4-cards.png' });
console.log('errors:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
