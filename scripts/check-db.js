const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const papers = await prisma.paper.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, title: true, parseStatus: true, markdown: true, blocksJson: true, parsedText: true, imagesDir: true, pageCount: true }
  });
  for (const p of papers) {
    console.log('---');
    console.log('id:', p.id, 'title:', p.title, 'status:', p.parseStatus);
    console.log('markdown len:', p.markdown?.length || 0, 'blocks len:', p.blocksJson?.length || 0, 'parsed len:', p.parsedText?.length || 0);
    console.log('imagesDir:', p.imagesDir, 'pageCount:', p.pageCount);
    if (p.markdown) console.log('markdown head:\n', p.markdown.slice(0, 800));
    if (p.blocksJson) {
      try {
        const blocks = JSON.parse(p.blocksJson);
        console.log('blocks count:', blocks.length);
        console.log('first 5 blocks:', JSON.stringify(blocks.slice(0, 5), null, 2).slice(0, 1500));
        const types = {};
        for (const b of blocks) types[b.type] = (types[b.type] || 0) + 1;
        console.log('type counts:', JSON.stringify(types));
        // Show a sample table block
        const tBlock = blocks.find(b => b.type === 'table');
        if (tBlock) {
          console.log('--- sample table block ---');
          console.log('table_body head:', (tBlock.table_body || '').slice(0, 600));
          console.log('table_caption:', tBlock.table_caption);
        }
        // Show a sample text block with level
        const hBlock = blocks.find(b => b.type === 'text' && b.text_level);
        if (hBlock) {
          console.log('--- sample heading block ---');
          console.log('level:', hBlock.text_level, 'text:', hBlock.text);
        }
      } catch(e) { console.log('blocks parse err:', e.message); }
    }
  }
  await prisma.$disconnect();
})();
