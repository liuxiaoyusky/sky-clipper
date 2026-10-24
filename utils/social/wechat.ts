import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { XDocument } from './x';

export interface WechatDocument extends Omit<XDocument, 'schemaVersion' | 'kind'> {
  schemaVersion: 'auto-save/wechat-v1';
  kind: 'article';
  imagesComplete: boolean;
  warnings: string[];
}

export function canonicalWechatUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.hostname !== 'mp.weixin.qq.com' || u.port || u.username || u.password) return null;
    if (/^\/s\/[\w-]{1,100}\/?$/.test(u.pathname)) return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
    if (u.pathname !== '/s') return null;
    const patterns = { __biz: /^[A-Za-z0-9+/=]{1,64}$/, mid: /^\d{1,30}$/, idx: /^[1-9]\d{0,2}$/, sn: /^[a-fA-F0-9]{32}$/ };
    const query = new URLSearchParams();
    for (const [key, pattern] of Object.entries(patterns)) {
      const values = u.searchParams.getAll(key);
      if (values.length !== 1 || !pattern.test(values[0])) return null;
      query.set(key, values[0]);
    }
    return `${u.origin}/s?${query}`;
  } catch { return null; }
}

function sourceId(url: string): string {
  const u = new URL(url);
  if (u.pathname !== '/s') return `short-${u.pathname.split('/').pop()}`;
  return `msg-${['__biz','mid','idx','sn'].map(key => encodeURIComponent(u.searchParams.get(key)!)).join('-')}`;
}

function inspectWechatImage(raw: string): {url:string | null; reason?:string} {
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (!['http:', 'https:'].includes(u.protocol)) return {url:null,reason:'暂不支持此图片协议'};
    if (u.port || u.username || u.password) return {url:null,reason:'图片地址包含不支持的端口或认证信息'};
    if (!['mmbiz.qpic.cn','mmbiz.qlogo.cn'].includes(u.hostname)) return {url:null,reason:`暂不支持来源域名 ${u.hostname.slice(0,120)}`};
    if (!/^\/[A-Za-z0-9_./%-]+$/.test(u.pathname) || u.pathname.includes('%')) return {url:null,reason:'图片地址路径格式暂不支持'};
    const format = u.searchParams.get('wx_fmt') || u.pathname.match(/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i)?.[1] || 'jpg';
    if (!/^(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(format)) return {url:null,reason:`图片格式暂不支持${['heic','heif','tif','tiff','ico','other'].includes(format.toLowerCase()) ? `（${format.toLowerCase()}）` : ''}`};
    return {url:`https://${u.hostname}${u.pathname}?wx_fmt=${format.toLowerCase()}`};
  } catch { return {url:null,reason:'图片地址无法解析'}; }
}

export function wechatImageUrl(raw: string): string | null {
  return inspectWechatImage(raw).url;
}

function visible(element: Element): boolean {
  for (let el: Element | null = element; el; el = el.parentElement) {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0') return false;
  }
  return true;
}

export function extractWechatDocument(doc: Document, rawUrl: string): WechatDocument | null {
  const sourceUrl = canonicalWechatUrl(rawUrl);
  const body = doc.querySelector('#js_content');
  const title = doc.querySelector('#activity-name')?.textContent?.trim();
  if (!sourceUrl || !body || !title || !visible(body)) return null;
  if ([...doc.querySelectorAll('#js_paywall, #js_article_payread, #js_pay_content, #captcha, #verify, .verifycode')].some(visible)) return null;
  const copy = body.cloneNode(true) as Element;
  // Visibility must be checked in the source DOM: detached clones lose ancestor CSS.
  const originals = [...body.querySelectorAll('*')];
  const clones = [...copy.querySelectorAll('*')];
  originals.forEach((el,index) => { if (!visible(el)) clones[index].remove(); });
  copy.querySelectorAll('script,style,noscript,button,form,.immersive-translate-target-wrapper,.immersive-translate-target-inner').forEach(el => el.remove());
  const images: WechatDocument['images'] = [];
  const warnings: string[] = [];
  let imagesComplete = true;
  for (const [index,img] of [...copy.querySelectorAll('img')].entries()) {
    const raw = img.getAttribute('data-src')?.trim() || img.getAttribute('src')?.trim() || '';
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
    const {url,reason} = inspectWechatImage(raw);
    if (!url) {
      imagesComplete = false;
      const source = originals[clones.indexOf(img)] as HTMLImageElement | undefined;
      const rect = source?.getBoundingClientRect();
      const size = rect ? `；显示尺寸 ${Math.round(rect.width)}×${Math.round(rect.height)}，原始尺寸 ${source?.naturalWidth || 0}×${source?.naturalHeight || 0}` : '';
      warnings.push(`图片 ${index+1} 未保存：${reason}${size}`);
      img.replaceWith(doc.createTextNode(`[未保存图片：${img.getAttribute('alt') || '原文配图'}]`));
      continue;
    }
    let file = images.find(item => item.url === url);
    if (!file) {
      const ext = new URL(url).searchParams.get('wx_fmt')!.replace('jpeg','jpg');
      file = {url, path: `images/${String(images.length + 1).padStart(3,'0')}.${ext}`};
      images.push(file);
    }
    const local = doc.createElement('img');
    local.setAttribute('src',file.path);
    local.setAttribute('alt',img.getAttribute('alt') || '');
    img.replaceWith(local);
  }
  for (const media of [...copy.querySelectorAll('iframe,video,audio,mpvoice,qqmusic,mp-video,mp-common-videosnap,mp-common-mpaudio')]) {
    warnings.push('嵌入音视频未下载');
    media.replaceWith(doc.createTextNode('[原文包含音视频，请在来源页面查看]'));
  }
  for (const a of [...copy.querySelectorAll('a')]) {
    try {
      const u = new URL(a.getAttribute('href') || '',sourceUrl);
      if (!['http:','https:'].includes(u.protocol)) throw new Error('unsafe');
      a.setAttribute('href',canonicalWechatUrl(u.href) || u.href);
    } catch { a.replaceWith(...a.childNodes); }
  }
  const converter = new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced'});
  converter.use(gfm);
  const markdown = converter.turndown(copy.innerHTML).trim();
  if (!markdown || markdown.length > 2_000_000 || images.length > 200 || warnings.length > 200) return null;
  return {
    schemaVersion:'auto-save/wechat-v1',sourceUrl,sourceId:sourceId(sourceUrl),kind:'article',
    title:title.slice(0,500),author:doc.querySelector('#js_name')?.textContent?.trim().slice(0,500) || '',
    publishedAt:doc.querySelector('#publish_time')?.textContent?.trim().slice(0,100) || '',
    capturedAt:new Date().toISOString(),markdown,images,imagesComplete,warnings,
  };
}

type Sender = {id?:string;frameId?:number;url?:string;tab?:{id?:number;url?:string}};
export function isWechatCaptureRequest(value: unknown, sender: Sender, extensionId: string): value is {target:'background';type:'AUTO_SAVE_WECHAT_CAPTURE';document:WechatDocument} {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  const d = m.document as WechatDocument | undefined;
  if (m.target !== 'background' || m.type !== 'AUTO_SAVE_WECHAT_CAPTURE' || !d || typeof d !== 'object') return false;
  if (sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id === undefined) return false;
  if (typeof d.sourceUrl !== 'string' || !canonicalWechatUrl(d.sourceUrl) || canonicalWechatUrl(d.sourceUrl) !== d.sourceUrl || canonicalWechatUrl(sender.url || '') !== d.sourceUrl || canonicalWechatUrl(sender.tab.url || '') !== d.sourceUrl) return false;
  if (d.schemaVersion !== 'auto-save/wechat-v1' || d.kind !== 'article' || d.sourceId !== sourceId(d.sourceUrl)) return false;
  if (['title','author','publishedAt','capturedAt','markdown'].some(key => typeof d[key as keyof WechatDocument] !== 'string')) return false;
  if (!d.title.trim() || d.title.length > 500 || d.author.length > 500 || d.publishedAt.length > 100 || !Number.isFinite(Date.parse(d.capturedAt)) || !d.markdown.trim() || d.markdown.length > 2_000_000) return false;
  if (typeof d.imagesComplete !== 'boolean' || !Array.isArray(d.warnings) || d.warnings.length > 200 || d.warnings.some(w => typeof w !== 'string' || w.length > 500) || (!d.imagesComplete && !d.warnings.length)) return false;
  return Array.isArray(d.images) && d.images.length <= 200 && d.images.every((img,index) => img && typeof img.url === 'string' && wechatImageUrl(img.url) === img.url && img.path === `images/${String(index+1).padStart(3,'0')}.${new URL(img.url).searchParams.get('wx_fmt')!.replace('jpeg','jpg')}`);
}
