import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1600, height: 950, deviceScaleFactor: 2 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('http://localhost:5173/cfps', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
// scroll to the fidelity card grid (cards with 'water room:')
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('div[role="button"]')].filter(d => d.textContent.includes('water room:'));
  // find the GPT-5 #77 card specifically
  const g = cards.find(c => c.textContent.replace(/\s+/g,' ').includes('GPT-5 #77'));
  (g || cards[0]).scrollIntoView({ block: 'center' });
  window.scrollBy(0, -100);
});
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/v4-final.png' });
console.log('errors:', errors.length ? errors.join('\n') : '(none)');
await browser.close();
