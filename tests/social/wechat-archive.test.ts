import { it, expect, vi } from 'vitest';
import { extractWechatDocument } from '@/utils/social/wechat';
import { saveWechatArchive, WECHAT_HISTORY_KEY } from '@/utils/social/archive';
import { normalizeResearchSettings, isWechatAutoCaptureEnabled, isXAutoCaptureEnabled } from '@/utils/research/settings';
function setup(){
 document.body.innerHTML='<h1 id="activity-name">Offline</h1><div id="js_content"><p>Text</p><img data-src="https://mmbiz.qpic.cn/mmbiz_png/fixture/640?wx_fmt=png"></div>';
 const doc=extractWechatDocument(document,'https://mp.weixin.qq.com/s/offline-fixture')!;
 const data:Record<string,unknown>={},files:Record<string,string>={};
 const io={writeText:vi.fn(async(p:string,s:string)=>{files[p]=s;}),downloadUrl:vi.fn(async()=>{}),close:vi.fn(async()=>{})};
 const storage={get:vi.fn(async(k:string)=>({[k]:data[k]})),set:vi.fn(async(v:Record<string,unknown>)=>{Object.assign(data,v);})};
 return {doc,data,files,io,storage};
}
it('saves original and images with an isolated history, deduplicates and keeps revisions',async()=>{
 const s=setup();const a=await saveWechatArchive(s.doc,s.storage,s.io);expect(a.status).toBe('saved');
 expect(s.io.downloadUrl).toHaveBeenCalledWith(expect.stringMatching(/^Sky-Clipper Backup\/WeChat\/short-offline-fixture\/.+\/images\/001.png$/),s.doc.images[0].url,'image/');
 expect(s.data[WECHAT_HISTORY_KEY]).toBeDefined();expect(s.data.auto_save_x_history).toBeUndefined();
 expect(Object.values(s.files).join('\n')).toContain('images/001.png');
 expect((await saveWechatArchive({...s.doc,capturedAt:'2026-10-21T00:00:00Z'},s.storage,s.io)).status).toBe('duplicate');
 expect(s.io.downloadUrl).toHaveBeenCalledTimes(1);
 const b=await saveWechatArchive({...s.doc,markdown:'Edited'},s.storage,s.io);
 if(a.status==='failed'||b.status==='failed')throw Error('unexpected');expect(b.archivePath).not.toBe(a.archivePath);
 expect(s.io.close).toHaveBeenCalledTimes(3);
});
it('image failures stay partial with truthful metadata and can retry',async()=>{
 const s=setup();s.io.downloadUrl.mockRejectedValueOnce(Error('network'));
 expect((await saveWechatArchive(s.doc,s.storage,s.io)).status).toBe('partial');
 const meta=JSON.parse(Object.entries(s.files).find(([p])=>p.endsWith('/capture.json'))![1]);
 expect(meta.imagesComplete).toBe(false);expect(meta.status).toBe('partial');expect(s.data[WECHAT_HISTORY_KEY]).toBeUndefined();
 expect((await saveWechatArchive(s.doc,s.storage,s.io)).status).toBe('saved');
});
it('unsupported media warnings cannot be discarded or marked complete',async()=>{
 const s=setup();s.doc.warnings=['正文图片来源暂不支持，未下载'];s.doc.imagesComplete=false;
 expect((await saveWechatArchive(s.doc,s.storage,s.io)).status).toBe('partial');
 expect(Object.values(s.files).join('\n')).toContain(s.doc.warnings[0]);expect(s.storage.set).not.toHaveBeenCalled();
});
it('metadata or storage failures never create a success record',async()=>{
 const s=setup();s.io.writeText.mockRejectedValueOnce(Error('disk'));
 expect((await saveWechatArchive(s.doc,s.storage,s.io)).status).toBe('failed');expect(s.storage.set).not.toHaveBeenCalled();expect(s.io.close).toHaveBeenCalled();
 s.storage.set.mockRejectedValueOnce(Error('quota'));expect((await saveWechatArchive(s.doc,s.storage,s.io)).status).toBe('partial');
 expect(Object.values(s.files).join('\n')).toContain('capture_status: partial');
});
it('migrates old settings without changing other switches and obeys both WeChat switches',()=>{
 const s=normalizeResearchSettings({autoCapture:false,socialAutoCapture:false,providers:{bofa:false,x:false}});
 expect(s.providers).toEqual({bofa:false,x:false,wechat:true,bilibili:true});expect(s.autoCapture).toBe(false);expect(isWechatAutoCaptureEnabled(s)).toBe(false);
 s.socialAutoCapture=true;expect(isWechatAutoCaptureEnabled(s)).toBe(true);expect(isXAutoCaptureEnabled(s)).toBe(false);
 s.providers.wechat=false;expect(isWechatAutoCaptureEnabled(s)).toBe(false);
});
