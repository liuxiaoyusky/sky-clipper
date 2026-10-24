import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DEFAULT_RESEARCH_SETTINGS, RESEARCH_SETTINGS_KEY } from '@/utils/research/settings';

let config: {main:(ctx:any)=>void};
let changed: (changes:Record<string,unknown>,area:string)=>void;
let listener: (message:unknown,sender:unknown,reply:(value:any)=>void)=>void;
let settings = structuredClone(DEFAULT_RESEARCH_SETTINGS);
const sendMessage=vi.fn();
let invalidated: ()=>void;
function render() {
 document.body.innerHTML='<h1 id="activity-name">Local fixture</h1><div id="js_content"><p>Offline body</p></div>';
}
function status() {let result:any;listener({target:'content',type:'FIN_REPORT_CLIPPER_GET_PAGE_STATUS'},{},value=>{result=value});return result.status;}
beforeEach(async()=>{
 vi.useFakeTimers();settings=structuredClone(DEFAULT_RESEARCH_SETTINGS);sendMessage.mockReset();
 vi.stubGlobal('defineContentScript',(c:any)=>{config=c;return c;});
 vi.stubGlobal('location',{href:'https://mp.weixin.qq.com/s/offline-fixture'});
 vi.stubGlobal('chrome',{
 storage:{local:{get:vi.fn(async()=>({[RESEARCH_SETTINGS_KEY]:settings}))},onChanged:{addListener:(fn:any)=>{changed=fn;},removeListener:vi.fn()}},
 runtime:{sendMessage,onMessage:{addListener:(fn:any)=>{listener=fn;},removeListener:vi.fn()}},
 });
 render();vi.resetModules();await import('@/entrypoints/wechat.content');
 sendMessage.mockResolvedValue({status:'saved',archivePath:'saved'});
});
afterEach(()=>{invalidated?.();vi.useRealTimers();vi.unstubAllGlobals();});
function start(){config.main({isInvalid:false,setInterval:(fn:any,ms:number)=>setInterval(fn,ms),onInvalidated:(fn:any)=>{invalidated=fn;}});}
it('saves once only after stable content; content edits save a revision',async()=>{
 start();await vi.advanceTimersByTimeAsync(2000);expect(sendMessage).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).toHaveBeenCalledTimes(1);expect(status().code).toBe('saved');
 document.querySelector('#js_content p')!.textContent='Edited';await vi.advanceTimersByTimeAsync(4000);expect(sendMessage).toHaveBeenCalledTimes(2);
});
it('category/site disable stops capture, reenabling permits save',async()=>{
 settings.socialAutoCapture=false;start();await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();expect(status().code).toBe('disabled');
 settings.socialAutoCapture=true;settings.providers.wechat=false;changed({[RESEARCH_SETTINGS_KEY]:{}},'local');await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();
 settings.providers.wechat=true;changed({[RESEARCH_SETTINGS_KEY]:{}},'local');await vi.advanceTimersByTimeAsync(4000);expect(sendMessage).toHaveBeenCalledTimes(1);
});
it('ignores delayed old-route replies and never saves homepage',async()=>{
 let resolve!:(v:unknown)=>void;sendMessage.mockReturnValueOnce(new Promise(r=>{resolve=r;}));start();await vi.advanceTimersByTimeAsync(4000);
 location.href='https://mp.weixin.qq.com/';await vi.advanceTimersByTimeAsync(2000);resolve({status:'saved',archivePath:'old'});await vi.advanceTimersByTimeAsync(2000);
 expect(status().code).toBe('unsupported');expect(status().archivePath).toBeUndefined();expect(sendMessage).toHaveBeenCalledTimes(1);
});
it('a partial result is visible and does not cause a download loop',async()=>{
 sendMessage.mockResolvedValue({status:'partial',archivePath:'partial',warnings:['图片未下载']});start();await vi.advanceTimersByTimeAsync(12000);expect(sendMessage).toHaveBeenCalledTimes(1);expect(status().code).toBe('partial');
});

it('waits for document load and unresolved images, then captures without scrolling',async()=>{
 vi.spyOn(document,'readyState','get').mockReturnValue('loading');start();await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();
 vi.spyOn(document,'readyState','get').mockReturnValue('complete');document.querySelector('#js_content')!.innerHTML+='<img src="data:image/png;base64,stub">';
 await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();
 document.querySelector('img')!.setAttribute('data-src','https://mmbiz.qpic.cn/mmbiz_png/fixture/640?wx_fmt=png');
 await vi.advanceTimersByTimeAsync(4000);expect(sendMessage).toHaveBeenCalledTimes(1);expect(sendMessage.mock.calls[0][0].type).toBe('AUTO_SAVE_WECHAT_CAPTURE');
 vi.restoreAllMocks();
});
