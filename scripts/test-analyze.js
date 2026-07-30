const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const paper = await prisma.paper.findFirst({
    orderBy: { createdAt: 'desc' },
    where: { markdown: { not: null } },
    select: { id: true, title: true, markdown: true }
  });
  if (!paper) { console.log('No paper with markdown'); return; }
  console.log('Testing with paper:', paper.id, paper.title);
  console.log('markdown len:', paper.markdown.length);

  const t0 = Date.now();
  const res = await fetch('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LLM-Provider': 'deepseek',
      'X-LLM-Api-Key': 'sk-edb16a1b2daa4982a45307247934cd91',
      'X-LLM-Model': 'deepseek-chat',
    },
    body: JSON.stringify({
      markdown: paper.markdown.slice(0, 30000), // smaller for faster test
      title: paper.title,
      paperId: paper.id,
    }),
  });
  const data = await res.json();
  console.log('Status:', res.status, 'Elapsed:', (Date.now() - t0) / 1000, 's');
  if (data.error) { console.log('Error:', data.error); return; }
  console.log('Title:', data.outline.title);
  console.log('Sections:', data.outline.sections.length);
  for (const s of data.outline.sections) {
    console.log(`  [${s.id}] ${s.title}: summary=${s.summary?.slice(0,40)}, detail=${s.detail?.length||0} chars, keyPoints=${s.keyPoints?.length||0}, children=${s.children?.length||0}, quote="${s.quote?.slice(0,40)}"`);
  }
  console.log('Headings:', data.outline.headings?.length || 0);
  if (data.outline.headings?.length) {
    console.log('Sample headings:', data.outline.headings.slice(0, 8).map(h => `H${h.level}: ${h.text.slice(0,50)}`).join('\n  '));
  }
  await prisma.$disconnect();
})();
