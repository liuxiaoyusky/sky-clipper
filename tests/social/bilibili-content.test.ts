import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { DEFAULT_RESEARCH_SETTINGS,RESEARCH_SETTINGS_KEY } from '@/utils/research/settings';
let config:{main:(ctx:any)=>void},changed:(c:Record<string,unknown>,area:string)=>void,listener:(m:any,s:any,r:(v:any)=>void)=>void,cleanup:()=>void;
let settings=structuredClone(DEFAULT_RESEARCH_SETTINGS);const sendMessage=vi.fn();
const url='https://www.bilibili.com/video/BV1CTJ26XE24/';
function status(){let value:any;listener({target:'content',type:'FIN_REPORT_CLIPPER_GET_PAGE_STATUS'},{},r=>value=r);return value.status;}
function start(){config.main({isInvalid:false,setInterval:(fn:any,ms:number)=>setInterval(fn,ms),onInvalidated:(fn:any)=>cleanup=fn});}
beforeEach(async()=>{
 vi.useFakeTimers();vi.resetModules();settings=structuredClone(DEFAULT_RESEARCH_SETTINGS);sendMessage.mockReset().mockResolvedValue({status:'saved',archivePath:'local'});
 vi.stubGlobal('defineContentScript',(c:any)=>{config=c;return c});vi.stubGlobal('location',{href:url});
 vi.stubGlobal('chrome',{storage:{local:{get:async()=>({[RESEARCH_SETTINGS_KEY]:settings})},onChanged:{addListener:(f:any)=>changed=f,removeListener:vi.fn()}},runtime:{sendMessage,onMessage:{addListener:(f:any)=>listener=f,removeListener:vi.fn()}}});
 document.body.innerHTML='<h1 class="video-title">Fixture</h1>';vi.spyOn(document,'readyState','get').mockReturnValue('complete');
 await import('@/entrypoints/bilibili.content');
});
afterEach(()=>{cleanup?.();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
it('captures a stable video once and captures a changed part separately without a request loop',async()=>{
 start();await vi.advanceTimersByTimeAsync(2000);expect(sendMessage).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(10000);expect(sendMessage).toHaveBeenCalledTimes(1);
 expect(sendMessage.mock.calls[0][0]).toEqual({target:'background',type:'AUTO_SAVE_BILIBILI_CAPTURE',sourceUrl:url,title:'Fixture'});
 location.href=url+'?p=2';await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).toHaveBeenCalledTimes(2);expect(sendMessage.mock.calls[1][0].sourceUrl).toBe(url+'?p=2');
});
it('obeys both switches; only reenabling permits a fresh attempt',async()=>{
 settings.socialAutoCapture=false;start();await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();
 settings.socialAutoCapture=true;settings.providers.bilibili=false;changed({[RESEARCH_SETTINGS_KEY]:{}},'local');await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();
 settings.providers.bilibili=true;changed({[RESEARCH_SETTINGS_KEY]:{}},'local');await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).toHaveBeenCalledOnce();
});
it('keeps failure visible without polling the platform repeatedly',async()=>{
 sendMessage.mockResolvedValue({status:'failed',reason:'Restricted'});start();await vi.advanceTimersByTimeAsync(60000);expect(sendMessage).toHaveBeenCalledOnce();expect(status().code).toBe('failed');
});
it('ignores stale replies and captures no home/list page',async()=>{
 let done!:(v:unknown)=>void;sendMessage.mockReturnValueOnce(new Promise(r=>done=r));start();await vi.advanceTimersByTimeAsync(4000);
 location.href='https://www.bilibili.com/';await vi.advanceTimersByTimeAsync(2000);done({status:'saved',archivePath:'old'});await vi.advanceTimersByTimeAsync(4000);
 expect(status().code).toBe('unsupported');expect(status().archivePath).toBeUndefined();expect(sendMessage).toHaveBeenCalledOnce();
});
it('disabling while a capture is pending cannot publish a stale saved status',async()=>{
 let done!:(v:unknown)=>void;sendMessage.mockReturnValueOnce(new Promise(r=>done=r));start();await vi.advanceTimersByTimeAsync(4000);
 settings.providers.bilibili=false;changed({[RESEARCH_SETTINGS_KEY]:{}},'local');await vi.advanceTimersByTimeAsync(2000);done({status:'saved',archivePath:'old'});await vi.advanceTimersByTimeAsync(4000);expect(status().code).toBe('disabled');
});
