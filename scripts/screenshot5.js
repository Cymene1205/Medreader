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

  const fileInput = await page.locator('input[type=file]');
  await fileInput.setInputFiles('/home/z/my-project/download/sample-paper.pdf');

  console.log('Waiting 50s for everything to load...');
  await page.waitForTimeout(50000);

  // Click the FIRST paragraph in the block reader
  console.log('Clicking first paragraph in block reader...');
  const paragraphs = page.locator('[data-block-idx] p').filter({ hasText: /.+/ });
  const count = await paragraphs.count();
  console.log('Paragraphs found:', count);
  if (count > 0) {
    // Click the 4th paragraph (after title, subtitle, section heading) to get real content
    await paragraphs.nth(3).click();
    await page.waitForTimeout(5000);
  }
  await page.screenshot({ path: '/home/z/my-project/download/v4-paragraph-translate.png' });
  console.log('Paragraph translate screenshot saved');

  // Ask chat question
  console.log('Asking chat question...');
  const chatInput = page.locator('textarea').last();
  await chatInput.fill('这篇文章研究的核心科学问题是什么？请基于论文原文回答。');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(25000);
  await page.screenshot({ path: '/home/z/my-project/download/v4-chat-answered.png' });
  console.log('Chat screenshot saved');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
