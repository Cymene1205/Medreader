import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';


async function main() {
  process.env.MINERU_API_TOKEN = "local-test-token";
  const { parseWithMinerU } = await import("../src/lib/mineru");
  const dir = await mkdtemp(join(tmpdir(), 'medreader-test-'));
  const path = join(dir, 'paper.pdf');
  await writeFile(path, '%PDF-1.4');
  const zip = new JSZip();
  zip.file('full.md', '# Test paper\nMeaningful content');
  zip.file('paper_content_list.json', JSON.stringify([{type:'text',text:'Test paper',page_idx:1}]));
  zip.file('images/figure.png', 'image bytes');
  const bytes = await zip.generateAsync({type:'nodebuffer'});
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    if (String(url).endsWith('/file-urls/batch')) return Response.json({code:0,data:{batch_id:'test-batch',file_urls:['https://test.invalid/upload']}});
    if (String(url).endsWith('/upload')) {
      assert.equal(init?.method,'PUT');
      assert.equal(new Headers(init?.headers).get('Content-Type'),null);
      return new Response(null,{status:200});
    }
    if (String(url).includes('/extract-results/')) return Response.json({code:0,data:{extract_result:[{state:'done',full_zip_url:'https://test.invalid/result'}]}});
    return new Response(new Uint8Array(bytes));
  }) as typeof fetch;
  try {
    const stages:string[]=[];
    const result=await parseWithMinerU(path,{onProgress:async s=>{stages.push(s)}});
    assert.equal(calls,4);
    assert.equal(result.blocks.length,1);
    assert.equal(result.pageCount,2);
    assert.match(result.markdown,/Meaningful/);
    assert.equal(await readFile(join(result.imagesDir!,'figure.png'),'utf8'),'image bytes');
    calls=0;
    await parseWithMinerU(path,{batchId:'test-batch'});
    assert.equal(calls,2,'Resuming must not submit or upload again');
    zip.remove('full.md');
    const empty=await zip.generateAsync({type:'nodebuffer'});
    globalThis.fetch=(async url=>String(url).includes('/extract-results/')?Response.json({code:0,data:{extract_result:[{state:'done',full_zip_url:'https://test.invalid/result'}]}}):new Response(new Uint8Array(empty))) as typeof fetch;
    await assert.rejects(parseWithMinerU(path,{batchId:'test-batch'}),/markdown|full.md/i);
    console.log('PASS: upload headers, ZIP extraction, images, saved task resume, empty result rejection');
  } finally {globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
