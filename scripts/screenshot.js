const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/home/z/my-project/download/v4-initial.png', fullPage: false });
  console.log('Screenshot 1 saved');

  // Click upload button and upload sample paper
  const fileInput = await page.locator('input[type=file]');
  await fileInput.setInputFiles('/home/z/my-project/download/sample-paper.pdf');

  // Wait for MinerU parsing + analysis to complete (up to 2 min)
  console.log('Waiting for MinerU + analyze...');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    // Check if outline has appeared in the left panel
    const hasOutline = await page.locator('text=全文框架').count();
    const hasDim = await page.locator('text=科学问题').count();
    if (hasDim > 0) {
      console.log('Outline appeared after', i*3, 's');
      break;
    }
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/home/z/my-project/download/v4-loaded.png', fullPage: false });
  console.log('Screenshot 2 saved');

  // Click on a paragraph in the block reader to trigger translation
  const paragraph = await page.locator('.block-reader-table, [data-block-idx]').first();
  if (paragraph) {
    await paragraph.click({ timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/home/z/my-project/download/v4-translate.png', fullPage: false });
  console.log('Screenshot 3 saved');

  // Click on the first outline child to test navigation
  const firstChild = await page.locator('button:has-text("问题")').first();
  if (firstChild) {
    await firstChild.click({ timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/home/z/my-project/download/v4-outline-click.png', fullPage: false });
  console.log('Screenshot 4 saved');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
