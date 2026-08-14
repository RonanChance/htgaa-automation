import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 }
});
const page = await browser.newPage();
await page.goto('http://localhost:5175/cfps', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
// Scroll to K(Glu) row so we can see the salts section
await page.evaluate(() => {
    const kglu = [...document.querySelectorAll('td')].find(t => t.textContent.trim().startsWith('K(Glu)'));
    if (kglu) kglu.scrollIntoView({ block: 'center' });
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/cfps-salts.png' });
await browser.close();
