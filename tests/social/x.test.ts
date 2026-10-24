import { describe, it, expect, vi } from 'vitest';
import { canonicalXUrl, extractXDocument, mediaUrl, isXCaptureRequest } from '@/utils/social/x';
import { saveXArchive, createSerialArchiveQueue, X_HISTORY_KEY } from '@/utils/social/archive';
import { normalizeResearchSettings } from '@/utils/research/settings';

const url='https://x.com/alice/status/12345?s=46';
function page(text='Original 🧑‍💻', extra='') {
  document.body.innerHTML=`<main><article data-testid="tweet"><div data-testid="User-Name">Alice</div><a href="/alice/status/12345"><time datetime="2026-10-19T00:00:00Z"></time></a><div data-testid="tweetText">${text}</div>${extra}</article><article data-testid="tweet"><a href="/bob/status/555"><time></time></a><div data-testid="tweetText">Reply</div></article></main>`;
}
const sender={id:'ext',frameId:0,url,tab:{id:1,url}};
describe('X original capture',()=>{
 it('limits URL targets and normalizes tracking and aliases',()=>{
  expect(canonicalXUrl(url)).toBe('https://x.com/alice/status/12345');
  expect(canonicalXUrl('https://twitter.com/alice/status/12345/photo/1')).toBe('https://x.com/alice/status/12345');
  for(const v of ['https://x.com/home','https://x.com/alice','https://x.com/search?q=a','https://x.com.evil/a/status/1','http://x.com/a/status/1']) expect(canonicalXUrl(v)).toBeNull();
 });
 it('captures focused original, inline emoji, images; excludes replies and quoted posts',()=>{
  page('Hello <img alt="😀" src="https://abs.twimg.com/emoji.svg">', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/abc?format=jpg&name=small"></div><article data-testid="tweet"><a href="/bob/status/777"><time></time></a><div data-testid="tweetText">Quoted</div></article>');
  const result=extractXDocument(document,url)!;
  expect(result.markdown).toContain('Hello 😀');
  expect(result.markdown).not.toMatch(/Reply|Quoted/);
  expect(result.images).toEqual([{url:'https://pbs.twimg.com/media/abc?format=jpg&name=orig',path:'images/001.jpg'}]);
  expect(result.markdown).toContain('images/001.jpg');
 });
 it('never mistakes a quoted target for the currently opened post',()=>{
  page(); expect(extractXDocument(document,'https://x.com/bob/status/555')?.markdown).toBe('Reply');
  expect(extractXDocument(document,'https://x.com/alice/status/999')).toBeNull();
 });
 it('rejects collapsed text and article teaser, accepts focused full article',()=>{
  page('Teaser','<button data-testid="tweet-text-show-more-link">More</button>'); expect(extractXDocument(document,url)).toBeNull();
  page('Teaser','<a href="/i/article/777">Read article</a>'); expect(extractXDocument(document,url)).toBeNull();
  page('', '<h1 data-testid="twitter-article-title">Full title</h1><div data-testid="twitterArticleRichTextView"><p>Full article</p><p>Paragraph two</p></div>');
  expect(extractXDocument(document,url)?.markdown).toContain('Paragraph two');
 });
 it('excludes quoted cards using X div role=link markup',()=>{
  page('Own post','<div role="link" tabindex="0"><a href="/bob/status/777"><time></time></a><div data-testid="tweetText">Quote</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quote?format=jpg"></div></div>');
  expect(extractXDocument(document,'https://x.com/bob/status/777')).toBeNull();
  expect(extractXDocument(document,url)?.images).toEqual([]);
 });
 it('waits for unresolved images rather than falsely reporting complete',()=>{
  page('Original','<div data-testid="tweetPhoto"><img alt="Still loading"></div>');
  expect(extractXDocument(document,url)).toBeNull();
 });
 it('keeps article cover and inline media in their original order',()=>{
  page('', '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/cover?format=png"></div><h1 data-testid="twitter-article-title">Full</h1><div data-testid="twitterArticleRichTextView"><p>Full article</p><img src="https://pbs.twimg.com/media/inline?format=jpg"></div>');
  const d=extractXDocument(document,url)!;
  expect(d.images.map(i=>i.url)).toEqual(['https://pbs.twimg.com/media/cover?format=png&name=orig','https://pbs.twimg.com/media/inline?format=jpg&name=orig']);
  expect(d.markdown.indexOf('images/001.png')).toBeLessThan(d.markdown.indexOf('Full article'));
 });
 it('saves the poster even when video has a blob or external stream source',()=>{
  page('Video','<video src="blob:https://x.com/video" poster="https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/a.jpg"></video>');
  expect(extractXDocument(document,url)?.images).toHaveLength(1);
 });
 it('requires a matching canonical source for standalone Article',()=>{
  document.head.innerHTML='<link rel="canonical" href="https://x.com/i/article/777">';
  document.body.innerHTML='<main data-testid="primaryColumn"><h1 data-testid="twitter-article-title">Title</h1><div data-testid="twitterArticleRichTextView"><p>Article body</p></div></main>';
  expect(extractXDocument(document,'https://x.com/i/article/777')?.markdown).toBe('Article body');
  expect(extractXDocument(document,'https://x.com/i/article/888')).toBeNull();
 });
 it('accepts only known image hosts and drops arbitrary query parameters',()=>{
  expect(mediaUrl('https://evil.test/photo.jpg')).toBeNull();
  expect(mediaUrl('https://pbs.twimg.com/profile_images/a.jpg')).toBeNull();
  expect(mediaUrl('https://pbs.twimg.com/media/a?format=png&token=secret')).toBe('https://pbs.twimg.com/media/a?format=png&name=orig');
 });
 it('validates sender, schema and downloaded media paths',()=>{
  page(); const capture=extractXDocument(document,url)!;
  const msg={target:'background',type:'AUTO_SAVE_X_CAPTURE',document:capture};
  expect(isXCaptureRequest(msg,sender,'ext')).toBe(true);
  expect(isXCaptureRequest(msg,{...sender,frameId:1},'ext')).toBe(false);
  expect(isXCaptureRequest(msg,{...sender,tab:{id:1,url:'https://x.com/b/status/222'}},'ext')).toBe(false);
  expect(isXCaptureRequest({...msg,document:{...capture,images:[{url:'https://evil.test/a.jpg',path:'../../bad'}]}},sender,'ext')).toBe(false);
 });
});
describe('X archive',()=>{
 function setup(){
  page('Original','<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/abc?format=jpg"></div>');
  const data:Record<string,unknown>={}; const files:Record<string,string>={};
  const io={writeText:vi.fn(async(p:string,s:string)=>{files[p]=s;}),downloadUrl:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
  const storage={get:vi.fn(async(k:string)=>({[k]:data[k]})),set:vi.fn(async(v:Record<string,unknown>)=>{Object.assign(data,v);})};
  return {doc:extractXDocument(document,url)!,data,files,io,storage};
 }
 it('saves original + local image + metadata; deduplicates; preserves revisions',async()=>{
  const s=setup(); const a=await saveXArchive(s.doc,s.storage,s.io); expect(a.status).toBe('saved');
  expect(s.io.downloadUrl).toHaveBeenCalledWith(expect.stringContaining('/images/001.jpg'),s.doc.images[0].url,'image/');
  expect(Object.keys(s.files).some(p=>p.endsWith('/capture.json'))).toBe(true);
  const b=await saveXArchive({...s.doc,capturedAt:'2026-10-20T00:00:00Z'},s.storage,s.io); expect(b.status).toBe('duplicate'); expect(s.io.downloadUrl).toHaveBeenCalledTimes(1);
  const c=await saveXArchive({...s.doc,markdown:'Edited'},s.storage,s.io); expect(c.status).toBe('saved');
  if(a.status!=='failed'&&c.status!=='failed') expect(c.archivePath).not.toBe(a.archivePath);
 });
 it('image failure is partial and retryable, never records full success',async()=>{
  const s=setup();s.io.downloadUrl.mockRejectedValueOnce(new Error('failed'));
  expect((await saveXArchive(s.doc,s.storage,s.io)).status).toBe('partial');
  expect(Object.values(s.files).join('\n')).toContain('图片未下载');
  expect((await saveXArchive(s.doc,s.storage,s.io)).status).toBe('saved');
 });
 it('never labels a stable but potentially incomplete Article as fully saved',async()=>{
  const s=setup();s.doc.kind='article';
  const result=await saveXArchive(s.doc,s.storage,s.io);
  expect(result.status).toBe('partial');
  if(result.status==='partial') expect(result.warnings.join('')).toContain('全文完整性尚待核对');
  const manifest=JSON.parse(Object.entries(s.files).find(([p])=>p.endsWith('/capture.json'))![1]);
  expect(manifest.status).toBe('partial');expect(manifest.sourceScope).toBe('visible-focused-dom');
 });
 it('keeps archive metadata consistent when dedup storage fails',async()=>{
  const s=setup();s.storage.set.mockRejectedValueOnce(new Error('quota'));
  expect((await saveXArchive(s.doc,s.storage,s.io)).status).toBe('partial');
  const original=Object.entries(s.files).find(([p])=>p.endsWith('/original.md'))![1];
  const manifest=JSON.parse(Object.entries(s.files).find(([p])=>p.endsWith('/capture.json'))![1]);
  expect(original).toContain('capture_status: partial');expect(manifest.status).toBe('partial');
  expect(manifest.warnings.join('')).toContain('去重记录未保存');
 });
 it('does not trust an earlier complete history record for an Article',async()=>{
  const s=setup();s.doc.kind='article';
  const first=await saveXArchive(s.doc,s.storage,s.io);
  const meta=JSON.parse(Object.entries(s.files).find(([p])=>p.endsWith('/capture.json'))![1]);
  if(first.status==='failed') throw Error('unexpected');
  s.data[X_HISTORY_KEY]={[`${s.doc.sourceId}:${meta.contentHash}`]:first.archivePath};
  expect((await saveXArchive(s.doc,s.storage,s.io)).status).toBe('partial');
 });
 it('serializes jobs and continues after failure',async()=>{
  const queue=createSerialArchiveQueue(); const calls:string[]=[];
  let unblock!:()=>void;const gate=new Promise<void>(resolve=>unblock=resolve);
  const a=queue(async()=>{calls.push('a');await gate;throw Error('a');}).catch(()=>{});
  const b=queue(async()=>{calls.push('b');});await Promise.resolve();expect(calls).toEqual(['a']);unblock();await Promise.all([a,b]);expect(calls).toEqual(['a','b']);
 });
});
