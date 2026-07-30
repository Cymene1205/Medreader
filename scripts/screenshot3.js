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

  console.log('Waiting for FULL outline load (look for actual section titles in left panel)...');
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(3000);
    // Look for the actual section title "论证思路" (only appears when outline is fully rendered)
    const hasOutline = await page.locator('text=论证思路').count();
    const hasLoading = await page.locator('text=Agent 正在分析文献').count();
    console.log(`[${i*3}s] outline_titles=${hasOutline} loading=${hasLoading}`);
    if (hasOutline > 0 && hasLoading === 0) {
      console.log('Outline fully loaded!');
      break;
    }
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/home/z/my-project/download/v4-final.png' });

  // Expand the first section and click a child
  console.log('Expanding first section...');
  const firstSection = page.locator('button:has-text("科学问题")').first();
  if (await firstSection.count() > 0) {
    await firstSection.click();
    await page.waitForTimeout(1500);
  }

  // Click first child
  console.log('Clicking first child...');
  const firstChild = page.locator('button:has-text("问题提出背景"), button:has-text("背景"), [class*="group/item"] button').first();
  if (await firstChild.count() > 0) {
    await firstChild.click();
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: '/home/z/my-project/download/v4-outline-nav.png' });

  // Ask a chat question
  console.log('Asking chat question...');
  const chatInput = page.locator('textarea').last();
  if (await chatInput.count() > 0) {
    await chatInput.fill('这篇文章的科学问题是什么？请用2句话回答。');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(20000); // wait for streaming response
  }
  await page.screenshot({ path: '/home/z/my-project/download/v4-chat.png' });

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
