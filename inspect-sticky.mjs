import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 }
});
const page = await browser.newPage();
await page.goto('http://localhost:5175/cfps', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));
// Scroll down so composition table is out of view but benchmarks are visible
await page.evaluate(() => window.scrollTo(0, 1400));
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/cfps-scrolled.png' });
console.log('done');
await browser.close();
