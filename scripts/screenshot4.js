const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/z/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Upload
  const fileInput = await page.locator('input[type=file]');
  await fileInput.setInputFiles('/home/z/my-project/download/sample-paper.pdf');

  console.log('Waiting 50 seconds for everything to load...');
  await page.waitForTimeout(50000); // 50s should be enough for MinerU + analyze
  
  // Take final state screenshot
  await page.screenshot({ path: '/home/z/my-project/download/v4-final-loaded.png' });
  console.log('Final screenshot saved');

  // Test outline click navigation
  console.log('Clicking section 1 (科学问题)...');
  const section1 = page.locator('[class*="AccordionTrigger"]:has-text("科学问题")').first();
  if (await section1.count() > 0) {
    await section1.click();
    await page.waitForTimeout(1500);
  }
  // Click first child to trigger navigation
  console.log('Clicking first child of section 1...');
  const firstChildBtn = page.locator('[class*="AccordionContent"] button').first();
  if (await firstChildBtn.count() > 0) {
    await firstChildBtn.click();
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: '/home/z/my-project/download/v4-outline-click.png' });
  console.log('Outline click screenshot saved');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
