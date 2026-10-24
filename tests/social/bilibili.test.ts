import { describe,it,expect,vi } from 'vitest';
import { parseBilibiliSource, approvedSubtitleUrl, parseSubtitleCues, subtitleSrt, collectBilibiliDocument, isBilibiliCaptureRequest } from '@/utils/social/bilibili';
const url='https://www.bilibili.com/video/BV1CTJ26XE24/';
const view={bvid:'BV1CTJ26XE24',aid:123456789,title:'Fixture',owner:{name:'Author'},pubdate:1700000000,desc:'Description, not transcript',pic:'https://i0.hdslb.com/bfs/archive/fixture.jpg',pages:[{page:1,cid:111111,duration:60,part:'one'},{page:2,cid:222222,duration:90,part:'two'}]};
const body=[{from:1.25,to:3.5,content:'First original line'},{from:5,to:8.75,content:'Second original line'}];
function fake(options:{tracks?:any[];cues?:unknown;view?:any;status?:number;playerStatus?:number;omitCid?:boolean}={}){
 const calls:string[]=[];
 const request=vi.fn(async(input:string,init:RequestInit)=>{
  calls.push(input);const u=new URL(input);
  if(u.pathname==='/x/web-interface/view')return new Response(JSON.stringify({code:0,data:options.view||view}),{status:options.status||200});
  if(u.pathname==='/x/player/v2'){
   const cid=Number(u.searchParams.get('cid'));
   return new Response(JSON.stringify({code:0,data:{...(options.omitCid ? {} : {cid}),aid:123456789,subtitle:{subtitles:options.tracks ?? [{lan:'ai-zh',subtitle_url:`https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/123456789${cid}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?auth_key=fixture-only`}]}}}),{status:options.playerStatus||200});
  }
  expect(init.credentials).toBe('omit');
  return new Response(JSON.stringify({body:options.cues ?? body}));
 });return {request,calls};
}
describe('Bilibili current-part capture',()=>{
 it('canonicalizes a source without tracking or credentials and keeps parts separate',()=>{
  expect(parseBilibiliSource(url+'?p=2&spm_id_from=tracking#test')).toEqual({url:url+'?p=2',bvid:'BV1CTJ26XE24',part:2,id:'BV1CTJ26XE24-p2'});
  expect(parseBilibiliSource(url+'?p=1')?.url).toBe(url);
  for(const bad of ['https://www.bilibili.com/','https://evil.test/video/BV1CTJ26XE24/',url+'?p=0',url+'?p=2&p=3','https://user:pass@www.bilibili.com/video/BV1CTJ26XE24/'])expect(parseBilibiliSource(bad)).toBeNull();
 });
 it('gets the selected part, preserves all cues and never persists signed subtitle URLs',async()=>{
  const f=fake();const doc=await collectBilibiliDocument(url+'?p=2','Fixture',f.request);
  expect(doc).toMatchObject({cid:222222,part:2,sourceId:'BV1CTJ26XE24-p2',duration:90,subtitle:{automatic:true,status:'available',cues:body}});
  expect(f.calls[1]).toContain('cid=222222');expect(f.calls).toHaveLength(3);
  expect(JSON.stringify(doc)).not.toMatch(/auth_key|fixture-only|subtitle_url/);
 });
 it('does not fall back to the first part or a stale video/title',async()=>{
  for(const [source,title,data] of [[url+'?p=3','Fixture',view],[url,'Other',view],[url,'Fixture',{...view,bvid:'BV1eGTj69EKB'}]]){
   const f=fake({view:data});await expect(collectBilibiliDocument(source as string,title as string,f.request)).rejects.toThrow();expect(f.calls).toHaveLength(1);
  }
 });
 it('prefers authored Chinese over English/AI and keeps no-subtitle distinct from full text',async()=>{
  const tracks=[{lan:'en',subtitle_url:'https://i0.hdslb.com/bfs/subtitle/en.json'},{lan:'ai-zh',subtitle_url:'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/123456789111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},{lan:'zh-CN',subtitle_url:'https://i0.hdslb.com/bfs/subtitle/zh.json'}];
  const f=fake({tracks});expect((await collectBilibiliDocument(url,'Fixture',f.request)).subtitle).toMatchObject({automatic:false,language:'zh-CN'});expect(f.calls[2]).toContain('/zh.json');
  const none=fake({tracks:[]});const d=await collectBilibiliDocument(url,'Fixture',none.request);expect(d.subtitle).toMatchObject({status:'unavailable',cues:[]});expect(d.warnings.length).toBeGreaterThan(0);expect(none.calls).toHaveLength(2);
 });
 it('rejects wrong CID and arbitrary subtitle URLs before fetching',async()=>{
  for(const subtitle_url of ['https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/123456789222222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','https://evil.test/sub.json','http://i0.hdslb.com/bfs/subtitle/a.json','https://i0.hdslb.com/other/a.json']){
   const f=fake({tracks:[{lan:'ai-zh',subtitle_url}]});expect((await collectBilibiliDocument(url,'Fixture',f.request)).subtitle.status).toBe('invalid');expect(f.calls).toHaveLength(2);
  }
  expect(approvedSubtitleUrl('https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/9123456789111111',123456789,111111)).toBeNull();
 });
 it('stops on rate-limit without retries, alternate endpoints or saving a description-only success',async()=>{
  const f=fake({status:429});await expect(collectBilibiliDocument(url,'Fixture',f.request)).rejects.toThrow();expect(f.calls).toHaveLength(1);
 });
 it('rejects malformed/empty/reversed/out-of-duration cues and keeps valid original text',()=>{
  for(const bad of [[],[{from:3,to:2,content:'bad'}],[{from:0,to:999,content:'bad'}],[{from:5,to:6,content:'a'},{from:1,to:2,content:'b'}],[{from:0,to:1,content:''}]])expect(parseSubtitleCues(bad,60)).toBeNull();
  expect(parseSubtitleCues(body,60)).toEqual(body);
  expect(subtitleSrt(body)).toBe('1\n00:00:01,250 --> 00:00:03,500\nFirst original line\n\n2\n00:00:05,000 --> 00:00:08,750\nSecond original line\n');
 });
 it('accepts only its extension, main frame, matching tab and canonical current part',()=>{
  const m={target:'background',type:'AUTO_SAVE_BILIBILI_CAPTURE',sourceUrl:url,title:'Fixture'};
  const sender={id:'self',frameId:0,url,tab:{id:1,url}};
  expect(isBilibiliCaptureRequest(m,sender,'self')).toBe(true);
  for(const s of [{...sender,id:'other'},{...sender,frameId:1},{...sender,tab:{id:1,url:url+'?p=2'}}])expect(isBilibiliCaptureRequest(m,s,'self')).toBe(false);
  expect(isBilibiliCaptureRequest({...m,sourceUrl:url+'?p=1'},sender,'self')).toBe(false);
 });
});

it('cancels before the next platform request when disabled during metadata loading',async()=>{
 const f=fake();let enabled=true;
 const request=async(url:string,init:RequestInit)=>{const response=await f.request(url,init);enabled=false;return response;};
 await expect(collectBilibiliDocument(url,'Fixture',request,async()=>enabled)).rejects.toThrow('自动保存已关闭');expect(f.calls).toHaveLength(1);
});
it('retains metadata as incomplete and stops network after subtitle access failure',async()=>{
 const f=fake({playerStatus:403});const doc=await collectBilibiliDocument(url,'Fixture',f.request);
 expect(doc).toMatchObject({title:'Fixture',description:'Description, not transcript',coverUrl:null,subtitle:{status:'failed',cues:[]}});expect(doc.warnings.length).toBeGreaterThan(0);expect(f.calls).toHaveLength(2);
});
it('rejects absent player CID instead of accepting unbound uploaded subtitles',async()=>{
 const f=fake({omitCid:true,tracks:[{lan:'zh-CN',subtitle_url:'https://i0.hdslb.com/bfs/subtitle/zh.json'}]});expect((await collectBilibiliDocument(url,'Fixture',f.request)).subtitle.status).toBe('failed');expect(f.calls).toHaveLength(2);
});
it('rejects AI subtitle CID prefix collisions with an extra numeric suffix',()=>{
 expect(approvedSubtitleUrl('https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1234567891111119aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',123456789,111111)).toBeNull();
});
