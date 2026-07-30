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
  await page.screenshot({ path: '/home/z/my-project/download/v4-initial.png' });

  // Upload
  const fileInput = await page.locator('input[type=file]');
  await fileInput.setInputFiles('/home/z/my-project/download/sample-paper.pdf');

  console.log('Waiting for MinerU + outline...');
  // Wait for the outline to ACTUALLY load (not just placeholder).
  // Real outline has elements with "维度" badge and detail button.
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    const hasBadge = await page.locator('text=6 维度').count();
    const hasLoading = await page.locator('text=MinerU 解析中').count();
    const hasAnalyze = await page.locator('text=AI 分析中').count();
    console.log(`[${i*3}s] badge=${hasBadge} mineru_loading=${hasLoading} analyze_loading=${hasAnalyze}`);
    if (hasBadge > 0) {
      console.log('Outline loaded!');
      break;
    }
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/home/z/my-project/download/v4-loaded.png' });

  // Click on a paragraph in the block reader to trigger translation
  console.log('Clicking first paragraph...');
  const paragraphs = page.locator('[data-block-idx][class*="cursor-pointer"]');
  const count = await paragraphs.count();
  console.log('Clickable paragraphs found:', count);
  if (count > 0) {
    await paragraphs.first().click({ timeout: 5000 });
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: '/home/z/my-project/download/v4-translate.png' });

  // Switch to PDF tab
  console.log('Switching to PDF tab...');
  const pdfTab = page.locator('button[role="tab"]:has-text("原文 PDF")');
  if (await pdfTab.count() > 0) {
    await pdfTab.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/home/z/my-project/download/v4-pdf-tab.png' });
  }

  // Switch to mindmap tab
  console.log('Switching to mindmap tab...');
  const mmTab = page.locator('button[role="tab"]:has-text("思维导图")');
  if (await mmTab.count() > 0) {
    await mmTab.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/home/z/my-project/download/v4-mindmap-tab.png' });
  }

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
