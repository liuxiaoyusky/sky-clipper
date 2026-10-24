import { it,expect,vi } from 'vitest';
import { saveBilibiliArchive, BILIBILI_HISTORY_KEY } from '@/utils/social/bilibili-archive';
import type { BilibiliDocument } from '@/utils/social/bilibili';
function setup(){
 const doc:BilibiliDocument={schemaVersion:'auto-save/bilibili-v1',sourceUrl:'https://www.bilibili.com/video/BV1CTJ26XE24/',sourceId:'BV1CTJ26XE24-p1',bvid:'BV1CTJ26XE24',aid:123456789,cid:111111,part:1,partTitle:'one',title:'Fixture',author:'Author',publishedAt:'2026-10-16T00:00:00Z',capturedAt:'2026-10-24T00:00:00Z',description:'Description only',duration:60,coverUrl:'https://i0.hdslb.com/bfs/archive/fixture.jpg',subtitle:{status:'available',language:'ai-zh',automatic:true,cues:[{from:1,to:3,content:'Original subtitle'}]},warnings:[]};
 const data:Record<string,unknown>={},files:Record<string,string>={};
 const io={writeText:vi.fn(async(p:string,t:string)=>{files[p]=t;}),downloadUrl:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const storage={get:async(k:string)=>({[k]:data[k]}),set:vi.fn(async(v:Record<string,unknown>)=>{Object.assign(data,v);})};
 return {doc,data,files,io,storage};
}
it('saves local cover plus faithful timecoded subtitle files and deduplicates by content not capture time',async()=>{
 const s=setup();const result=await saveBilibiliArchive(s.doc,s.storage,s.io);expect(result.status).toBe('saved');
 expect(Object.keys(s.files).map(p=>p.split('/').pop()).sort()).toEqual(['capture.json','original.md','subtitles.json','subtitles.srt','transcript.txt']);
 const md=Object.entries(s.files).find(([p])=>p.endsWith('/original.md'))![1];expect(md).toContain('![视频封面](images/cover.jpg)');expect(md).toContain('[1.000–3.000 秒] Original subtitle');expect(md).toContain('AI 自动字幕');
 const meta=JSON.parse(Object.entries(s.files).find(([p])=>p.endsWith('/capture.json'))![1]);expect(meta).toMatchObject({status:'complete',subtitleComplete:true,videoDownloaded:false,fullSpeechVerified:false});
 expect((await saveBilibiliArchive({...s.doc,capturedAt:'2026-10-25T00:00:00Z'},s.storage,s.io)).status).toBe('duplicate');expect(s.io.downloadUrl).toHaveBeenCalledOnce();
 expect(s.data[BILIBILI_HISTORY_KEY]).toBeDefined();expect(s.data.auto_save_x_history).toBeUndefined();
 const revision=await saveBilibiliArchive({...s.doc,description:'Changed'},s.storage,s.io);expect(revision.status).toBe('saved');if(result.status!=='failed'&&revision.status!=='failed')expect(result.archivePath).not.toBe(revision.archivePath);
});
it('never marks a missing subtitle as complete and allows a later refresh to fill it',async()=>{
 const s=setup();s.doc.subtitle={status:'unavailable',language:'',automatic:false,cues:[]};
 expect((await saveBilibiliArchive(s.doc,s.storage,s.io)).status).toBe('partial');expect(s.storage.set).not.toHaveBeenCalled();expect(Object.keys(s.files).some(p=>p.endsWith('subtitles.srt'))).toBe(false);
 expect(Object.values(s.files).join('\n')).toContain('capture_status: partial');
});
it('cover and storage failures stay partial; failed text writes never enter success history',async()=>{
 const s=setup();s.io.downloadUrl.mockRejectedValueOnce(Error('download'));expect((await saveBilibiliArchive(s.doc,s.storage,s.io)).status).toBe('partial');expect(s.storage.set).not.toHaveBeenCalled();
 s.io.writeText.mockRejectedValueOnce(Error('disk'));expect((await saveBilibiliArchive(s.doc,s.storage,s.io)).status).toBe('failed');expect(s.storage.set).not.toHaveBeenCalled();
 s.storage.set.mockRejectedValueOnce(Error('quota'));expect((await saveBilibiliArchive(s.doc,s.storage,s.io)).status).toBe('partial');expect(Object.values(s.files).join('\n')).toContain('去重记录未保存');
});

it('identifies a failed archive step without exposing URLs or raw error text',async()=>{
 const s=setup();s.io.writeText.mockRejectedValueOnce(Error('Offscreen Blob creation failed'));
 const result=await saveBilibiliArchive(s.doc,s.storage,s.io);
 expect(result).toMatchObject({status:'failed',reason:expect.stringContaining('字幕JSON / BLOB_CREATE_FAILED')});
 expect(result).toMatchObject({reason:expect.stringContaining('平台字幕：1条')});
 expect(s.storage.set).not.toHaveBeenCalled();
 const t=setup();t.io.writeText.mockRejectedValueOnce(Error('secret https://example.com/?token=private'));
 const hidden=await saveBilibiliArchive(t.doc,t.storage,t.io);
 expect(hidden).toMatchObject({status:'failed',reason:expect.stringContaining('字幕JSON / UNKNOWN')});
 expect(JSON.stringify(hidden)).not.toMatch(/private|example\.com/);
});

it('downloads SRT as SubRip rather than plain text while preserving TXT as plain text',async()=>{
 const s=setup();await saveBilibiliArchive(s.doc,s.storage,s.io);
 expect(s.io.writeText).toHaveBeenCalledWith(expect.stringMatching(/\/subtitles\.srt$/),expect.stringContaining('00:00:01,000 --> 00:00:03,000'),'application/x-subrip');
 expect(s.io.writeText).toHaveBeenCalledWith(expect.stringMatching(/\/transcript\.txt$/),expect.stringContaining('Original subtitle'),'text/plain;charset=utf-8');
});
