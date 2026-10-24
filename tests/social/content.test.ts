import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DEFAULT_RESEARCH_SETTINGS, RESEARCH_SETTINGS_KEY } from '@/utils/research/settings';

let config: {main:(ctx:any)=>void};
let changed: (changes:Record<string,unknown>,area:string)=>void;
let listener: (message:unknown,sender:unknown,reply:(value:any)=>void)=>void;
let settings = structuredClone(DEFAULT_RESEARCH_SETTINGS);
const sendMessage=vi.fn();
let invalidated: ()=>void;
function render(id='12345') {
 document.body.innerHTML=`<article data-testid="tweet"><a href="/alice/status/${id}"><time datetime="2026-10-19"></time></a><div data-testid="tweetText">Body ${id}</div></article>`;
}
function status() {let result:any;listener({target:'content',type:'FIN_REPORT_CLIPPER_GET_PAGE_STATUS'},{},value=>{result=value});return result.status;}
beforeEach(async()=>{
 vi.useFakeTimers();settings=structuredClone(DEFAULT_RESEARCH_SETTINGS);sendMessage.mockReset();
 vi.stubGlobal('defineContentScript',(c:any)=>{config=c;return c;});
 vi.stubGlobal('location',{href:'https://x.com/alice/status/12345'});
 vi.stubGlobal('chrome',{
 storage:{local:{get:vi.fn(async()=>({[RESEARCH_SETTINGS_KEY]:settings}))},onChanged:{addListener:(fn:any)=>{changed=fn;},removeListener:vi.fn()}},
 runtime:{sendMessage,onMessage:{addListener:(fn:any)=>{listener=fn;},removeListener:vi.fn()}},
 });
 render();vi.resetModules();await import('@/entrypoints/x.content');
 sendMessage.mockResolvedValue({status:'saved',archivePath:'saved'});
});
afterEach(()=>{invalidated?.();vi.useRealTimers();vi.unstubAllGlobals();});
function start(){config.main({isInvalid:false,setInterval:(fn:any,ms:number)=>setInterval(fn,ms),onInvalidated:(fn:any)=>{invalidated=fn;}});}
it('saves once only after stable content; content edits save a revision',async()=>{
 start();await vi.advanceTimersByTimeAsync(2000);expect(sendMessage).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).toHaveBeenCalledTimes(1);expect(status().code).toBe('saved');
 document.querySelector('[data-testid="tweetText"]')!.textContent='Edited';await vi.advanceTimersByTimeAsync(4000);expect(sendMessage).toHaveBeenCalledTimes(2);
});
it('category/site disable stops capture, reenabling permits save',async()=>{
 settings.socialAutoCapture=false;start();await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();expect(status().code).toBe('disabled');
 settings.socialAutoCapture=true;settings.providers.x=false;changed({[RESEARCH_SETTINGS_KEY]:{}},'local');await vi.advanceTimersByTimeAsync(6000);expect(sendMessage).not.toHaveBeenCalled();
 settings.providers.x=true;changed({[RESEARCH_SETTINGS_KEY]:{}},'local');await vi.advanceTimersByTimeAsync(4000);expect(sendMessage).toHaveBeenCalledTimes(1);
});
it('does not save old content when a SPA route changes',async()=>{
 start();await vi.advanceTimersByTimeAsync(2000);location.href='https://x.com/alice/status/777';
 await vi.advanceTimersByTimeAsync(4000);expect(sendMessage).not.toHaveBeenCalled();render('777');await vi.advanceTimersByTimeAsync(4000);expect(sendMessage.mock.calls[0][0].document.sourceId).toBe('777');
});
it('ignores delayed old-route replies and never saves homepage',async()=>{
 let resolve!:(v:unknown)=>void;sendMessage.mockReturnValueOnce(new Promise(r=>{resolve=r;}));start();await vi.advanceTimersByTimeAsync(4000);
 location.href='https://x.com/home';await vi.advanceTimersByTimeAsync(2000);resolve({status:'saved',archivePath:'old'});await vi.advanceTimersByTimeAsync(2000);
 expect(status().code).toBe('unsupported');expect(status().archivePath).toBeUndefined();expect(sendMessage).toHaveBeenCalledTimes(1);
});
it('a partial result is visible and does not cause a download loop',async()=>{
 sendMessage.mockResolvedValue({status:'partial',archivePath:'partial',warnings:['图片未下载']});start();await vi.advanceTimersByTimeAsync(12000);expect(sendMessage).toHaveBeenCalledTimes(1);expect(status().code).toBe('partial');
});
