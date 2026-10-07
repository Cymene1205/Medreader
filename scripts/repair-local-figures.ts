import { db } from '../src/lib/db';
import { parseLocalPdf } from '../src/lib/pdf-local';
import { markdownToPlainText } from '../src/lib/mineru';
import { extractAndStoreFigures } from '../src/lib/extract-figures';
import { buildCitationsAndStore } from '../src/lib/align-citations';

async function main() {
  const ids=process.argv.slice(2);
  if(!ids.length) throw new Error('请指定需要修复的 paperId');
  for(const id of ids) {
    const paper=await db.paper.findUniqueOrThrow({where:{id}});
    if(paper.markdown && !paper.parseMessage?.includes('本地')) throw new Error('已有 MinerU 结果，跳过本地替换：'+id);
    const result=await parseLocalPdf(paper.filePath);
    await db.paper.update({where:{id},data:{
      markdown:result.markdown,parsedText:markdownToPlainText(result.markdown),blocksJson:JSON.stringify(result.blocks),
      imagesDir:result.imagesDir,pageCount:result.pageCount,
      parseMessage:'本地快速解析完成；图片为图表所在原文页面',
    }});
    const count=await extractAndStoreFigures(id,result.blocks.filter(b=>b.type==='image'),result.imagesDir);
    await buildCitationsAndStore(id);
    await db.paper.update({where:{id},data:{parseStatus:"done"}});
    console.log({id,title:paper.title,pages:result.pageCount,figures:count,source:'local-pdf-page'});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
