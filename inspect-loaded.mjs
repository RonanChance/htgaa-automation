import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 }
});
const page = await browser.newPage();
await page.goto('http://localhost:5175/cfps', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1500));

// Click the GPT-5 #77 column header (button inside the table)
const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const btn = buttons.find(b => b.textContent.includes('GPT-5 #77'));
    if (btn) { btn.click(); return true; }
    return false;
});
console.log('clicked GPT-5 #77 button?', clicked);
await new Promise(r => setTimeout(r, 800));

// Scroll back to the top to see the composition + total
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise(r => setTimeout(r, 300));

// Read totals from the sticky preset bar
const totals = await page.evaluate(() => {
    const bar = document.querySelector('[class*="Cell-Free"], .z-30, section');
    return document.body.innerText.match(/Total\s+[\d.]+\s*uL/)?.[0] ?? 'no total found';
});
console.log('totals in page:', totals);

await page.screenshot({ path: '/tmp/cfps-loaded-top.png', fullPage: false });

// Also full-page screenshot to see everything
await page.setViewport({ width: 1600, height: 3200, deviceScaleFactor: 2 });
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: '/tmp/cfps-loaded-full.png', fullPage: false });

await browser.close();
