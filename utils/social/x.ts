import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export interface XDocument {
  schemaVersion: 'auto-save/x-v1';
  sourceUrl: string;
  sourceId: string;
  kind: 'post' | 'article';
  title: string;
  author: string;
  publishedAt: string;
  capturedAt: string;
  markdown: string;
  images: Array<{ url: string; path: string }>;
}

export function canonicalXUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['x.com', 'twitter.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]+)\/(status|article)\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/);
    if (!match || (match[2] === 'article' && match[1] !== 'i')) return null;
    return `https://x.com/${match[1]}/${match[2]}/${match[3]}`;
  } catch { return null; }
}

export function mediaUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || url.port || url.username || url.password) return null;
    if (!/^\/(media|ext_tw_video_thumb|tweet_video_thumb|amplify_video_thumb)\/[A-Za-z0-9_./-]+$/.test(url.pathname)) return null;
    const format = url.searchParams.get('format') || url.pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg';
    if (!/^(jpe?g|png|webp|gif)$/i.test(format)) return null;
    return `https://pbs.twimg.com${url.pathname}?format=${format.toLowerCase()}&name=orig`;
  } catch { return null; }
}

const tweetSelector = 'article[data-testid="tweet"]';
function ownElements(root: Element, selector: string): Element[] {
  return [...root.querySelectorAll(selector)].filter(el => el.closest(tweetSelector) === root && !el.closest('div[role="link"], [data-testid="quoteTweet"]'));
}

export function extractXDocument(doc: Document, rawUrl: string): XDocument | null {
  const sourceUrl = canonicalXUrl(rawUrl);
  if (!sourceUrl) return null;
  const directArticle = sourceUrl.includes('/i/article/');
  let root: Element | undefined;
  if (directArticle) {
    // A canonical link ties a standalone Article to the current SPA route.
    if (canonicalXUrl(doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '') !== sourceUrl) return null;
    const article = doc.querySelector('[data-testid="twitterArticleRichTextView"]');
    root = article?.closest('article') || article?.closest('[data-testid="primaryColumn"]') || article?.parentElement || undefined;
  } else {
    root = [...doc.querySelectorAll(tweetSelector)].find(tweet =>
      ownElements(tweet, 'time').some(time => canonicalXUrl(new URL(time.closest('a')?.getAttribute('href') || '', sourceUrl).href) === sourceUrl));
  }
  if (!root) return null;
  const own = (selector: string) => directArticle ? [...root!.querySelectorAll(selector)] : ownElements(root!, selector);
  const rich = own('[data-testid="twitterArticleRichTextView"]')[0];
  if (!rich && (own('[data-testid="tweet-text-show-more-link"]').length || own('a[href*="/i/article/"]').length)) return null;
  const body = rich || own('[data-testid="tweetText"]')[0];
  const photos = own('[data-testid="tweetPhoto"] img, video[poster]');
  if (!body && !photos.length) return null;
  const clone = doc.createElement('div');
  if (rich) {
    for (const photo of photos.filter(photo => !rich.contains(photo) && Boolean(photo.compareDocumentPosition(rich) & 4))) clone.append(photo.cloneNode(true));
  }
  if (body) clone.append(body.cloneNode(true));
  for (const photo of photos.filter(photo => !rich || (!rich.contains(photo) && Boolean(rich.compareDocumentPosition(photo) & 4)))) clone.append(photo.cloneNode(true));
  clone.querySelectorAll('script,style,button,iframe,article[data-testid="tweet"],div[role="link"],[data-testid="quoteTweet"],.immersive-translate-target-wrapper,.immersive-translate-target-inner,font[class*="immersive-translate"]').forEach(el => el.remove());
  const images: XDocument['images'] = [];
  for (const image of [...clone.querySelectorAll('img,video')]) {
    const src = image.tagName === 'VIDEO' ? image.getAttribute('poster') || '' : image.getAttribute('src') || '';
    const url = mediaUrl(src);
    if (!url) {
      // Emoji are text; unresolved/unsupported media must not silently disappear.
      if (/^https:\/\/abs\.twimg\.com\/.*emoji/.test(src)) {
        image.replaceWith(doc.createTextNode(image.getAttribute('alt') || ''));
        continue;
      }
      return null;
    }
    let entry = images.find(item => item.url === url);
    if (!entry) {
      const extension = new URL(url).searchParams.get('format')!.replace('jpeg', 'jpg');
      entry = { url, path: `images/${String(images.length + 1).padStart(3, '0')}.${extension}` };
      images.push(entry);
    }
    const local = doc.createElement('img'); local.setAttribute('src', entry.path); local.setAttribute('alt', image.getAttribute('alt') || ''); image.replaceWith(local);
  }
  for (const link of [...clone.querySelectorAll('a')]) {
    try {
      const url = new URL(link.getAttribute('href') || '', sourceUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw Error('unsafe');
      link.setAttribute('href', url.href);
    } catch { link.replaceWith(...link.childNodes); }
  }
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  td.use(gfm);
  const markdown = td.turndown(clone.innerHTML).trim();
  if (!markdown) return null;
  return {
    schemaVersion: 'auto-save/x-v1', sourceUrl, sourceId: sourceUrl.split('/').pop()!,
    kind: rich ? 'article' : 'post',
    title: root.querySelector('[data-testid="twitter-article-title"]')?.textContent?.trim() || (body?.textContent || 'X 图片帖').trim().slice(0, 100),
    author: own('[data-testid="User-Name"]')[0]?.textContent?.trim() || (directArticle ? '' : new URL(sourceUrl).pathname.split('/')[1]),
    publishedAt: own('time')[0]?.getAttribute('datetime') || '',
    capturedAt: new Date().toISOString(), markdown, images,
  };
}

export function isXCaptureRequest(value: unknown, sender: {id?:string; frameId?:number; url?:string; tab?:{id?:number;url?:string}}, extensionId: string): value is {type:'AUTO_SAVE_X_CAPTURE';target:'background';document:XDocument} {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  const d = message.document as XDocument | undefined;
  if (message.target !== 'background' || message.type !== 'AUTO_SAVE_X_CAPTURE' || !d || typeof d !== 'object') return false;
  if (sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id === undefined) return false;
  if (typeof d.sourceUrl !== 'string' || !canonicalXUrl(d.sourceUrl) || canonicalXUrl(d.sourceUrl) !== d.sourceUrl || canonicalXUrl(sender.url || '') !== d.sourceUrl || canonicalXUrl(sender.tab.url || '') !== d.sourceUrl) return false;
  if (d.schemaVersion !== 'auto-save/x-v1' || !['post','article'].includes(d.kind) || d.sourceId !== d.sourceUrl.split('/').pop()) return false;
  if (['title','author','publishedAt','capturedAt','markdown'].some(key => typeof d[key as keyof XDocument] !== 'string')) return false;
  if (!d.markdown.trim() || d.markdown.length > 2_000_000 || d.title.length > 500 || d.author.length > 500 || !Number.isFinite(Date.parse(d.capturedAt))) return false;
  return Array.isArray(d.images) && d.images.length <= 200 && d.images.every((img, index) => img && typeof img.url === 'string' && mediaUrl(img.url) === img.url && img.path === `images/${String(index + 1).padStart(3,'0')}.${new URL(img.url).searchParams.get('format')!.replace('jpeg','jpg')}`);
}
