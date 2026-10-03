import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { MinerUBlock, MinerUResult } from './mineru';
import { extractPageText } from './pdf-parse';

/** Local text and figure-page fallback. Images are original PDF page renders,
 * not MinerU figure crops; keep that distinction visible in captions. */
export async function parseLocalPdf(filePath: string): Promise<MinerUResult> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  (globalThis as any).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const loadingTask = pdfjs.getDocument({data: new Uint8Array(await readFile(filePath)), isEvalSupported:false, useSystemFonts:true});
  const doc = await loadingTask.promise;
  const blocks: MinerUBlock[]=[];
  const sections: string[]=[];
  const imagesDir=join(dirname(filePath),basename(filePath).replace(/\.pdf$/i,'')+'_local_images');
  await mkdir(imagesDir,{recursive:true});
  try {
    for(let number=1;number<=doc.numPages;number++) {
      const text=await extractPageText(doc,number);
      const captions=text.split('\n').map(s=>s.trim()).filter(s=>/^(?:Fig\.?|Figure)\s*\d+\s*[|:.]/i.test(s));
      sections.push(`## 第 ${number} 页\n\n${text}`);
      for(const paragraph of text.split(/\n\s*\n/).filter(s=>s.trim())) blocks.push({type:'text',text:paragraph.trim(),page_idx:number-1});
      if(captions.length) {
        const page=await doc.getPage(number);
        const viewport=page.getViewport({scale:1.5});
        const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const name=`page-${number}.png`;
        await writeFile(join(imagesDir,name),canvas.toBuffer('image/png'));
        for(const caption of captions) {
          blocks.push({type:'image',img_path:`images/${name}`,image_caption:[caption+'（本地提取：图表所在的完整原文页面）'],page_idx:number-1});
        }
        sections.push(`![图表所在原文页面 ${number}](images/${name})`);
        page.cleanup();
      }
    }
    if(!blocks.some(b=>b.text?.trim())) throw new Error('PDF 无可提取文字，需要 OCR 解析');
    return {markdown:sections.join('\n\n'),blocks,imagesDir,pageCount:doc.numPages};
  } finally {await loadingTask.destroy();}
}
