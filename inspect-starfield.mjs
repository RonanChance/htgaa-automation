import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 }
});
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message + '\n' + (err.stack || '')));
page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text());
    if (msg.type() === 'warning' && !msg.text().includes('Multiple instances of Three.js')) {
        errors.push('CONSOLE WARN: ' + msg.text());
    }
    if (msg.text().includes('[starfield]')) errors.push('LOG: ' + msg.text());
});

await page.goto('http://localhost:5175/starfield', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise((r) => setTimeout(r, 2500));

// Screenshot initial state
await page.screenshot({ path: '/tmp/starfield-initial.png' });

// Simulate hover at approximately the center of the canvas
await page.mouse.move(720, 450);
await new Promise((r) => setTimeout(r, 500));

// Screenshot after hover
await page.screenshot({ path: '/tmp/starfield-hover.png' });

// Probe what's actually at the click point
const clickTarget = await page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'no element at point';
    return `${el.tagName}${el.className ? '.' + String(el.className).replace(/\s+/g, '.') : ''}${el.id ? '#' + el.id : ''}`;
}, 720, 450);
console.log('=== elementFromPoint(720, 450) ===');
console.log(clickTarget);

// Click at center
await page.mouse.click(720, 450);
await new Promise((r) => setTimeout(r, 1200));

// Screenshot after click (should show detail panel + focused camera)
await page.screenshot({ path: '/tmp/starfield-selected.png' });

// Check for detail panel visibility
const panelInfo = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    if (!aside) return 'No <aside> found';
    const r = aside.getBoundingClientRect();
    const t = aside.style.transform;
    const name = aside.querySelector('div[style*="font-size: 20px"]')?.textContent?.trim();
    return `aside: ${r.width}x${r.height} at (${r.left},${r.top}), transform=${t}, name=${name}`;
});

console.log('=== PANEL INFO ===');
console.log(panelInfo);

if (errors.length) {
    console.log('\n=== ERRORS ===');
    for (const e of errors) console.log(e + '\n');
}

console.log('\nScreenshots: initial, hover, selected in /tmp/starfield-*.png');
await browser.close();
