import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { extractWechatDocument } from '@/utils/social/wechat';
import { RESEARCH_SETTINGS_KEY } from '@/utils/research/settings';
const mocks=vi.hoisted(()=>({save:vi.fn(),ready:vi.fn(),io:vi.fn()}));
vi.mock('@/utils/social/archive',async original=>({...await original<typeof import('@/utils/social/archive')>(),saveWechatArchive:mocks.save}));
vi.mock('@/utils/research/chrome-archive-io',()=>({createChromeArchiveIo:mocks.io,registerArchiveDownloadFilenames:vi.fn(),eraseArchiveDownloadHistory:vi.fn(),waitForArchiveDownloadsToSettle:vi.fn()}));
vi.mock('@/utils/research/capture-service',()=>({createCaptureService:()=>({}),createCaptureStartupRecovery:()=>({ready:mocks.ready})}));
vi.mock('@/utils/research/history',()=>({createHistoryRepository:()=>({})}));
vi.mock('@/utils/research/batch-queue',()=>({createBatchQueueService:()=>({getState:async()=>({})})}));
vi.mock('@/utils/research/markets-today-run',()=>({createMarketsTodayRunService:()=>({})}));
const url='https://mp.weixin.qq.com/s/offline-fixture';
let listener:(m:unknown,s:unknown,r:(v:any)=>void)=>boolean;
let current=url;
let enabled=true;
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();current=url;enabled=true;
 mocks.ready.mockResolvedValue(undefined);mocks.save.mockResolvedValue({status:'saved'});
 vi.stubGlobal('defineBackground',(fn:()=>void)=>fn());
 vi.stubGlobal('chrome',{
  runtime:{id:'ext',onMessage:{addListener:(fn:typeof listener)=>{listener=fn;}}},
  storage:{session:{},local:{get:async()=>({[RESEARCH_SETTINGS_KEY]:{providers:{wechat:enabled}}})}},
  tabs:{get:async()=>({id:1,url:current}),onRemoved:{addListener:vi.fn()}},alarms:{onAlarm:{addListener:vi.fn()}},
 });
 await import('@/entrypoints/background');
 document.body.innerHTML='<h1 id="activity-name">Local</h1><div id="js_content">Synthetic body</div>';
});
afterEach(()=>vi.unstubAllGlobals());
function request(){
 const message={target:'background',type:'AUTO_SAVE_WECHAT_CAPTURE',document:extractWechatDocument(document,url)};
 const sender={id:'ext',frameId:0,url,tab:{id:1,url}};
 return {message,sender};
}
it('routes a trusted current article through recovery and the WeChat archive writer',async()=>{
 const {message,sender}=request();const result=await new Promise(r=>expect(listener(message,sender,r)).toBe(true));
 expect(result).toEqual({status:'saved'});expect(mocks.ready).toHaveBeenCalledOnce();expect(mocks.save).toHaveBeenCalledOnce();
});
it('checks current tab and current settings after queue/recovery wait',async()=>{
 let release!:()=>void;mocks.ready.mockReturnValueOnce(new Promise<void>(r=>release=r));
 const {message,sender}=request();const pending=new Promise(r=>listener(message,sender,r));
 await Promise.resolve();current='https://mp.weixin.qq.com/s/different';release();
 expect(await pending).toMatchObject({status:'failed'});expect(mocks.save).not.toHaveBeenCalled();
 current=url;enabled=false;expect(await new Promise(r=>listener(message,sender,r))).toMatchObject({status:'failed'});expect(mocks.io).not.toHaveBeenCalled();
});
it('rejects iframe and unrelated extension messages without opening a writer',()=>{
 const {message,sender}=request();const reply=vi.fn();
 expect(listener(message,{...sender,frameId:1},reply)).toBe(false);
 expect(listener(message,{...sender,id:'other'},reply)).toBe(false);
 expect(reply).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
