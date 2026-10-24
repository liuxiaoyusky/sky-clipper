
export interface BilibiliSource { url: string; bvid: string; part: number; id: string }
export interface SubtitleCue { from: number; to: number; content: string }
export interface BilibiliDocument {
  schemaVersion: 'auto-save/bilibili-v1'; sourceUrl: string; sourceId: string;
  bvid: string; aid: number; cid: number; part: number; partTitle: string;
  title: string; author: string; publishedAt: string; capturedAt: string;
  description: string; duration: number; coverUrl: string | null;
  subtitle: { status: 'available' | 'unavailable' | 'invalid' | 'failed'; language: string; automatic: boolean; cues: SubtitleCue[] };
  warnings: string[];
}
export function parseBilibiliSource(raw: string): BilibiliSource | null {
  try {
    const u = new URL(raw);
    const match = /^\/video\/(BV[A-Za-z0-9]{10})\/?$/.exec(u.pathname);
    if (u.protocol !== 'https:' || u.hostname !== 'www.bilibili.com' || u.port || u.username || u.password || !match) return null;
    const parts = u.searchParams.getAll('p');
    if (parts.length > 1 || (parts.length && !/^[1-9]\d{0,3}$/.test(parts[0]))) return null;
    const part = Number(parts[0] || 1), bvid = match[1];
    return {url:`https://www.bilibili.com/video/${bvid}/${part === 1 ? '' : `?p=${part}`}`,bvid,part,id:`${bvid}-p${part}`};
  } catch { return null; }
}
export const canonicalBilibiliUrl = (raw: string) => parseBilibiliSource(raw)?.url || null;

export function bilibiliCoverUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (!['https:','http:'].includes(u.protocol) || !/^i[012]\.hdslb\.com$/.test(u.hostname) || u.port || u.username || u.password) return null;
    if (!/^\/bfs\/archive\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(u.pathname)) return null;
    return `https://${u.hostname}${u.pathname}`;
  } catch { return null; }
}
export function approvedSubtitleUrl(raw: unknown, aid: number, cid: number): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !['aisubtitle.hdslb.com','i0.hdslb.com','i1.hdslb.com','i2.hdslb.com'].includes(u.hostname)) return null;
    if (!/^\/bfs\/(ai_subtitle|subtitle)\/[A-Za-z0-9_./-]+$/.test(u.pathname)) return null;
    if (u.pathname.startsWith('/bfs/ai_subtitle/')) {
      const prefix = `/bfs/ai_subtitle/prod/${aid}${cid}`;
      if (!u.pathname.startsWith(prefix) || !/^[a-f0-9]{32}$/i.test(u.pathname.slice(prefix.length))) return null;
    }
    return u.href; // Transient only: never stored in a document, log or history.
  } catch { return null; }
}
export function parseSubtitleCues(value: unknown, duration: number): SubtitleCue[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20000) return null;
  const cues: SubtitleCue[] = [];
  let priorStart = -1, chars = 0;
  for (const row of value) {
    if (!row || !Number.isFinite(row.from) || !Number.isFinite(row.to) || row.from < 0 || row.to <= row.from || row.from < priorStart || row.to > duration + 2 || typeof row.content !== 'string' || !row.content.trim()) return null;
    chars += row.content.length;
    if (chars > 2_000_000) return null;
    cues.push({from:row.from,to:row.to,content:row.content});
    priorStart = row.from;
  }
  return cues;
}
export function subtitleSrt(cues: SubtitleCue[]): string {
  const stamp = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2,'0')}:${String(Math.floor(ms / 60000) % 60).padStart(2,'0')}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')},${String(ms % 1000).padStart(3,'0')}`;
  };
  return cues.map((cue,i)=>`${i+1}\n${stamp(cue.from)} --> ${stamp(cue.to)}\n${cue.content}\n`).join('\n');
}

export class BilibiliCaptureCancelled extends Error {}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
async function readJson(url: string, credentials: RequestCredentials, request: Fetcher): Promise<any> {
  const response = await request(url,{credentials,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('B站读取失败或访问受限，请检查登录状态后刷新；不会自动重试');
  if (Number(response.headers.get('content-length')) > 4_000_000) throw new Error('B站响应过大，已停止保存');
  const text = await response.text();
  if (text.length > 4_000_000) throw new Error('B站响应过大，已停止保存');
  try { return JSON.parse(text); } catch { throw new Error('B站返回的数据暂不支持，请稍后刷新'); }
}
async function readApi(path: string, request: Fetcher): Promise<any> {
  const result = await readJson(`https://api.bilibili.com${path}`,'include',request);
  if (result?.code !== 0 || !result.data) throw new Error('B站读取失败或需要登录，已停止自动保存');
  return result.data;
}
function textField(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('B站元数据无效，已停止保存');
  return value;
}

// Uses the legacy clipper's documented source flow (view -> current part -> player
// subtitles), with independent bounded parsing; never reads cookies or page globals.
export async function collectBilibiliDocument(raw: string, expectedTitle: string, request: Fetcher = fetch, canContinue: () => Promise<boolean> = async () => true): Promise<BilibiliDocument> {
  const upstream = request;
  request = async (url, init) => {
    if (!await canContinue()) throw new BilibiliCaptureCancelled('自动保存已关闭或页面已切换');
    return upstream(url,init);
  };
  const source = parseBilibiliSource(raw);
  if (!source) throw new Error('仅支持具体 B站视频与当前分P');
  const data = await readApi(`/x/web-interface/view?bvid=${source.bvid}`,request);
  if (data.bvid !== source.bvid || !Number.isSafeInteger(data.aid) || data.aid <= 0) throw new Error('B站视频标识不一致，已停止保存');
  const title = textField(data.title,500);
  if (!title.trim() || title.replace(/\s+/g,' ').trim() !== expectedTitle.replace(/\s+/g,' ').trim()) throw new Error('视频仍在切换，标题不一致；请刷新稳定后的页面');
  const page = Array.isArray(data.pages) ? data.pages.find((p:any)=>p.page === source.part) : null;
  if (!page || !Number.isSafeInteger(page.cid) || page.cid <= 0 || !Number.isFinite(page.duration) || page.duration <= 0) throw new Error('当前分P信息缺失，未回退到第一P');
  if (!Number.isFinite(data.pubdate) || data.pubdate <= 0) throw new Error('B站发布日期无效');
  const doc: BilibiliDocument = {
    schemaVersion:'auto-save/bilibili-v1',sourceUrl:source.url,sourceId:source.id,bvid:source.bvid,aid:data.aid,cid:page.cid,part:source.part,
    partTitle:textField(page.part || '',500),title,author:textField(data.owner?.name || '',500),
    publishedAt:new Date(data.pubdate*1000).toISOString(),capturedAt:new Date().toISOString(),
    description:textField(data.desc || '',200000),duration:page.duration,coverUrl:bilibiliCoverUrl(data.pic),
    subtitle:{status:'unavailable',language:'',automatic:false,cues:[]},warnings:[],
  };
  if (!doc.coverUrl) doc.warnings.push('封面地址暂不支持，未保存封面');
  try {
  const player = await readApi(`/x/player/v2?aid=${doc.aid}&cid=${doc.cid}&bvid=${doc.bvid}`,request);
  if (String(player.cid) !== String(doc.cid) || (player.aid !== undefined && String(player.aid) !== String(doc.aid))) throw new Error('字幕来源与当前分P不一致，已拒收');
  const tracks = player.subtitle?.subtitles;
  if (!Array.isArray(tracks) || !tracks.length) {
    doc.warnings.push('平台当前未返回可用字幕（可能需登录）；简介不等于文字稿');
    return doc;
  }
  const candidates = tracks.filter(t=>t && typeof t.lan === 'string' && t.lan.length <= 40);
  const rank = (t:any) => /^zh(?:-|$)/i.test(t.lan) ? 0 : /^ai-zh(?:-|$)/i.test(t.lan) ? 1 : 2;
  const track = candidates.sort((a,b)=>rank(a)-rank(b))[0];
  const subtitleUrl = approvedSubtitleUrl(track?.subtitle_url,doc.aid,doc.cid);
  if (!track || !subtitleUrl) {doc.subtitle.status='invalid';doc.warnings.push('字幕来源域名或视频标识不匹配，已拒收');return doc;}
  const body = await readJson(subtitleUrl,'omit',request);
  const cues = parseSubtitleCues(body?.body,doc.duration);
  if (!cues) {doc.subtitle.status='invalid';doc.warnings.push('平台字幕为空或时间轴无效，未保存文字稿');return doc;}
  doc.subtitle = {status:'available',language:track.lan,automatic:/^ai-/i.test(track.lan) || track.ai_type > 0,cues};
  if (cues.some((cue,i)=>i>0 && cue.from < cues[i-1].to)) doc.warnings.push('平台字幕存在时间重叠，保留原时间轴待核对');
  return doc;
  } catch (error) {
    if (error instanceof BilibiliCaptureCancelled) throw error;
    doc.subtitle.status='failed';
    doc.coverUrl=null; // Stop network work after a provider failure, including cover fetch.
    doc.warnings.push('字幕读取失败或受限，已停止网络读取；仅保存已取得的信息，封面未下载');
    return doc;
  }
}

type Sender = {id?:string;frameId?:number;url?:string;tab?:{id?:number;url?:string}};
export interface BilibiliCaptureRequest { target:'background';type:'AUTO_SAVE_BILIBILI_CAPTURE';sourceUrl:string;title:string }
export function isBilibiliCaptureRequest(value:unknown,sender:Sender,extensionId:string): value is BilibiliCaptureRequest {
  if (!value || typeof value !== 'object') return false;
  const m=value as BilibiliCaptureRequest;
  return m.target==='background' && m.type==='AUTO_SAVE_BILIBILI_CAPTURE' && typeof m.sourceUrl==='string' && canonicalBilibiliUrl(m.sourceUrl)===m.sourceUrl && !!m.sourceUrl && typeof m.title==='string' && !!m.title.trim() && m.title.length<=500 && sender.id===extensionId && sender.frameId===0 && sender.tab?.id!==undefined && canonicalBilibiliUrl(sender.url || '')===m.sourceUrl && canonicalBilibiliUrl(sender.tab.url || '')===m.sourceUrl;
}
export function bilibiliPageTitle(doc:Document):string {
  return (doc.querySelector('h1.video-title, .video-info-title-inner, h1.video-info-title')?.textContent || '').trim();
}
