import type { ArchiveIo } from '@/utils/research/archive-writer';
import { sha256Text, stableJson } from '@/utils/research/hash';
import type { CaptureResult } from '@/utils/research/types';
import type { XDocument } from './x';
import type { WechatDocument } from './wechat';

export const WECHAT_HISTORY_KEY = 'auto_save_wechat_history';
export const X_HISTORY_KEY = 'auto_save_x_history';
interface StoragePort { get(key:string):Promise<Record<string,unknown>>; set(items:Record<string,unknown>):Promise<void> }

// Both adapters share one Offscreen document; no concurrent writer may close it.
export function createSerialArchiveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const task = tail.then(job);
    tail = task.catch(() => {});
    return task;
  };
}

export async function saveXArchive(doc:XDocument, storage:StoragePort, io:ArchiveIo):Promise<CaptureResult> {
  return saveSocialArchive(doc,storage,io);
}

export async function saveWechatArchive(doc:WechatDocument, storage:StoragePort, io:ArchiveIo):Promise<CaptureResult> {
  return saveSocialArchive(doc,storage,io);
}

async function saveSocialArchive(doc:XDocument|WechatDocument, storage:StoragePort, io:ArchiveIo):Promise<CaptureResult> {
  const wechat = doc.schemaVersion === 'auto-save/wechat-v1';
  const historyKey = wechat ? WECHAT_HISTORY_KEY : X_HISTORY_KEY;
  const folder = wechat ? 'WeChat' : 'X';
  const scope = wechat ? 'loaded-article-dom' : 'visible-focused-dom';
  try {
    const {capturedAt, sourceUrl, ...content} = doc;
    const hash = await sha256Text(stableJson(content));
    const archivePath = `Sky-Clipper Backup/${folder}/${doc.sourceId}/${hash.slice(7)}`;
    const key = `${doc.sourceId}:${hash}`;
    const state = await storage.get(historyKey);
    const history = (state[historyKey] || {}) as Record<string, string>;
    if ((wechat || doc.kind !== 'article') && history[key] === archivePath) return {status:'duplicate',archivePath};
    const warnings:string[]=wechat ? [...doc.warnings] : [];
    let imagesComplete = wechat ? doc.imagesComplete : true;
    let markdown = doc.markdown;
    for (const image of doc.images) {
      try { await io.downloadUrl(`${archivePath}/${image.path}`,image.url,'image/'); }
      catch {
        imagesComplete = false;
        warnings.push(`图片未下载：${image.path}`);
        markdown = markdown.split(`](${image.path})`).join(`](${image.url})`);
      }
    }
    // A quiet DOM proves stability, not that a long Article has finished lazy loading.
    if (!wechat && doc.kind === 'article') warnings.push('Article 已保存当前加载原文，全文完整性尚待核对');
    const writeMetadata = async () => {
      const status = warnings.length ? 'partial' : 'complete';
      const original = `---\nsource: ${JSON.stringify(sourceUrl)}\nauthor: ${JSON.stringify(doc.author)}\npublished_at: ${JSON.stringify(doc.publishedAt)}\ncaptured_at: ${JSON.stringify(capturedAt)}\ncontent_hash: ${hash}\nsource_scope: ${scope}\ncapture_status: ${status}\n---\n\n# ${doc.title.replace(/[\r\n]/g,' ')}\n\n${markdown}\n${warnings.length ? '\n> '+warnings.join('；')+'\n' : ''}`;
      await io.writeText(`${archivePath}/original.md`, original, 'text/markdown;charset=utf-8');
      await io.writeText(`${archivePath}/capture.json`, JSON.stringify({
        ...doc, contentHash: hash, sourceScope: scope, imagesComplete, status, warnings,
      }, null, 2), 'application/json');
    };
    await writeMetadata();
    if (!warnings.length) {
      try { await storage.set({[historyKey]:{...history,[key]:archivePath}}); }
      catch {
        warnings.push('去重记录未保存，重新打开时将重试');
        await writeMetadata();
      }
    }
    return warnings.length ? {status:'partial',archivePath,warnings} : {status:'saved',archivePath};
  } catch { return {status:'failed',reason:`${wechat ? '公众号' : 'X'}原文保存失败，请重新打开页面重试`}; }
  finally { await io.close().catch(()=>{}); }
}
