import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    defaultViewport: { width: 1600, height: 1100, deviceScaleFactor: 2 }
});
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text());
});

await page.goto('http://localhost:5175/cfps', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

// Scroll to the benchmarks section and click the "Show" toggle
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Show'));
    if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 700));

// Scroll to make the table visible
await page.evaluate(() => {
    const table = document.querySelector('section table');
    table?.scrollIntoView({ block: 'center' });
});
await new Promise((r) => setTimeout(r, 500));

await page.screenshot({ path: '/tmp/cfps-benchmarks.png', fullPage: false });

// Also capture full page to see everything
await page.screenshot({ path: '/tmp/cfps-full.png', fullPage: true });

if (errors.length) {
    console.log('=== ERRORS ===');
    for (const e of errors) console.log(e);
}

console.log('Screenshots: /tmp/cfps-benchmarks.png (viewport) + /tmp/cfps-full.png (full page)');
await browser.close();
