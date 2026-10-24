import { canonicalXUrl, extractXDocument } from '@/utils/social/x';
import { isXAutoCaptureEnabled, loadResearchSettings, RESEARCH_SETTINGS_KEY } from '@/utils/research/settings';
import type { CaptureResult, PageStatus } from '@/utils/research/types';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let status: PageStatus = {code:'observing',message:'正在识别 X 原文',updatedAt:new Date().toISOString()};
    let enabled = false;
    let route: string | null = null;
    let generation = 0;
    let candidate = '';
    let candidateAt = 0;
    let attempted = '';
    let busy = false;
    let settingsGeneration = 0;
    const publish = (code:PageStatus['code'],message:string,extra:Partial<PageStatus>={}) => {
      status = {code,message,updatedAt:new Date().toISOString(),...extra};
    };
    const reset = () => { generation++; candidate=''; attempted=''; };
    const readSettings = async () => {
      const current = ++settingsGeneration;
      try {
        const settings = await loadResearchSettings();
        if (current !== settingsGeneration || ctx.isInvalid) return;
        enabled = isXAutoCaptureEnabled(settings); reset();
        if (!enabled) publish('disabled','自媒体或 X 自动保存已关闭');
      } catch { enabled=false; publish('needs-action','无法读取设置，请刷新页面'); }
    };
    const tick = async () => {
      const nextRoute = canonicalXUrl(location.href);
      if (nextRoute !== route) { route=nextRoute; reset(); }
      if (!enabled || busy || ctx.isInvalid) return;
      if (!route) { publish('unsupported','仅自动保存具体 X 帖子或 Article'); return; }
      const doc = extractXDocument(document,location.href);
      if (!doc) { candidate=''; publish('waiting-ready','等待完整正文；若有“显示更多”，请先展开'); return; }
      const {capturedAt,...stable} = doc;
      const fingerprint = JSON.stringify(stable);
      if (fingerprint === attempted) return;
      if (fingerprint !== candidate) { candidate=fingerprint; candidateAt=Date.now(); publish('waiting-ready','等待正文与图片稳定'); return; }
      if (Date.now()-candidateAt < 1500) return;
      const runGeneration=generation;
      attempted=fingerprint; busy=true;
      publish('saving','正在保存 X 原文与图片',{title:doc.title});
      try {
        const result = await chrome.runtime.sendMessage({target:'background',type:'AUTO_SAVE_X_CAPTURE',document:doc}) as CaptureResult | undefined;
        if (runGeneration !== generation || canonicalXUrl(location.href) !== route || ctx.isInvalid) return;
        if (!result) publish('failed','未收到保存结果，请刷新页面');
        else if (result.status === 'failed') publish('failed',result.reason);
        else publish(result.status,result.status==='saved'?'原文与图片已保存':result.status==='duplicate'?'已有相同原文，未重复保存':`部分保存：${result.warnings.join('；')}`,{title:doc.title,archivePath:result.archivePath});
      } catch { if (runGeneration === generation) publish('failed','无法连接扩展，请刷新页面'); }
      finally { busy=false; }
    };
    const onSettings = (changes:Record<string,unknown>,area:string) => { if(area==='local' && changes[RESEARCH_SETTINGS_KEY]) void readSettings(); };
    const onMessage = (message:unknown,_sender:unknown,reply:(value:unknown)=>void) => {
      const m=message as {target?:string;type?:string};
      if(m?.target==='content' && m.type==='FIN_REPORT_CLIPPER_GET_PAGE_STATUS') reply({ok:true,status});
      return false;
    };
    chrome.storage.onChanged.addListener(onSettings);
    chrome.runtime.onMessage.addListener(onMessage);
    // Bounded, low-frequency checks also see pushState navigation without monkey-patching X.
    const timer = ctx.setInterval(()=>{void tick().catch(()=>publish('needs-action','页面结构暂不支持，请稍后刷新'));},2000);
    ctx.onInvalidated(()=>{clearInterval(timer);chrome.storage.onChanged.removeListener(onSettings);chrome.runtime.onMessage.removeListener(onMessage);});
    void readSettings();
  },
});
