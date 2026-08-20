const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  await page.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'networkidle2' });
  await page.click('button[data-window="10"]');
  await new Promise(r => setTimeout(r, 500));
  await browser.close();
})();
