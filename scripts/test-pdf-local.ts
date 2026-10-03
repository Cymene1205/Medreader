import assert from 'node:assert/strict';
import {mkdtemp,copyFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseLocalPdf} from '../src/lib/pdf-local';
import {extractFiguresFromBlocks} from '../src/lib/extract-figures';
async function main(){
  const source=process.argv[2];
  if(!source) throw new Error('Usage: tsx scripts/test-pdf-local.ts PDF_PATH [EXPECTED_FIGURES]');
  const dir=await mkdtemp(join(tmpdir(),'medreader-local-pdf-'));
  try{
    const file=join(dir,'paper.pdf');await copyFile(source,file);
    const result=await parseLocalPdf(file);
    assert.ok(result.markdown.trim());assert.ok(result.pageCount>0);
    const figures=extractFiguresFromBlocks(result.blocks.filter(b=>b.type==='image'),result.imagesDir);
    if(process.argv[3])assert.equal(figures.length,Number(process.argv[3]));
    for(const figure of figures){
      assert.ok(figure.imagePath);
      const png=await readFile(figure.imagePath!);
      assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.ok(png.readUInt32BE(16)>500);assert.ok(png.readUInt32BE(20)>500);
      assert.ok(figure.caption.includes('完整原文页面'));
    }
    console.log('PASS: local PDF text, figure labels, original-page PNG renders',figures.length);
  }finally{await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
