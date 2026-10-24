import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { RESEARCH_SETTINGS_KEY } from '@/utils/research/settings';
const mocks=vi.hoisted(()=>({collect:vi.fn(),save:vi.fn(),ready:vi.fn(),io:vi.fn()}));
vi.mock('@/utils/social/bilibili',async original=>({...await original<typeof import('@/utils/social/bilibili')>(),collectBilibiliDocument:mocks.collect}));
vi.mock('@/utils/social/bilibili-archive',()=>({saveBilibiliArchive:mocks.save}));
vi.mock('@/utils/research/chrome-archive-io',()=>({createChromeArchiveIo:mocks.io,registerArchiveDownloadFilenames:vi.fn(),eraseArchiveDownloadHistory:vi.fn(),waitForArchiveDownloadsToSettle:vi.fn()}));
vi.mock('@/utils/research/capture-service',()=>({createCaptureService:()=>({}),createCaptureStartupRecovery:()=>({ready:mocks.ready})}));
vi.mock('@/utils/research/history',()=>({createHistoryRepository:()=>({})}));
vi.mock('@/utils/research/batch-queue',()=>({createBatchQueueService:()=>({getState:async()=>({})})}));
vi.mock('@/utils/research/markets-today-run',()=>({createMarketsTodayRunService:()=>({})}));
const url='https://www.bilibili.com/video/BV1CTJ26XE24/';let current=url,enabled=true;
let listener:(m:any,s:any,r:(v:any)=>void)=>boolean;
const message={target:'background',type:'AUTO_SAVE_BILIBILI_CAPTURE',sourceUrl:url,title:'Fixture'};
const sender={id:'ext',frameId:0,url,tab:{id:1,url}};
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();current=url;enabled=true;mocks.ready.mockResolvedValue(undefined);mocks.collect.mockResolvedValue({title:'Fixture'});mocks.save.mockResolvedValue({status:'saved'});
 vi.stubGlobal('defineBackground',(fn:()=>void)=>fn());
 vi.stubGlobal('chrome',{runtime:{id:'ext',onMessage:{addListener:(f:any)=>listener=f}},storage:{session:{},local:{get:async()=>({[RESEARCH_SETTINGS_KEY]:{providers:{bilibili:enabled}}})}},tabs:{get:async()=>({id:1,url:current}),onRemoved:{addListener:vi.fn()}},alarms:{onAlarm:{addListener:vi.fn()}}});
 await import('@/entrypoints/background');
});
afterEach(()=>vi.unstubAllGlobals());
it('routes a trusted Bilibili request through the shared queue',async()=>{
 const result=await new Promise(r=>expect(listener(message,sender,r)).toBe(true));expect(result).toMatchObject({status:'saved'});expect(mocks.collect).toHaveBeenCalledExactlyOnceWith(url,'Fixture',expect.any(Function),expect.any(Function));
});
it('does not start network capture when the switch or current part changed while queued',async()=>{
 enabled=false;expect(await new Promise(r=>listener(message,sender,r))).toMatchObject({status:'failed'});expect(mocks.collect).not.toHaveBeenCalled();
 enabled=true;current=url+'?p=2';expect(await new Promise(r=>listener(message,sender,r))).toMatchObject({status:'failed'});expect(mocks.io).not.toHaveBeenCalled();
});
it('checks again after network capture before any file write',async()=>{
 let done!:(v:any)=>void;mocks.collect.mockReturnValueOnce(new Promise(r=>done=r));const result=new Promise(r=>listener(message,sender,r));
 await vi.waitFor(()=>expect(mocks.collect).toHaveBeenCalledOnce());current=url+'?p=2';done({title:'Fixture'});expect(await result).toMatchObject({status:'failed'});expect(mocks.io).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it('does not expose signed URL errors or accept other extensions/frames',async()=>{
 const reply=vi.fn();expect(listener(message,{...sender,id:'other'},reply)).toBe(false);expect(listener(message,{...sender,frameId:1},reply)).toBe(false);
 mocks.collect.mockRejectedValueOnce(Error('https://example.test/?auth_key=private'));const result=await new Promise(r=>listener(message,sender,r));expect(result).toMatchObject({status:'failed'});expect(JSON.stringify(result)).not.toContain('auth_key');expect(mocks.io).not.toHaveBeenCalled();
});
