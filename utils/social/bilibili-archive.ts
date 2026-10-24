import type { ArchiveIo } from '@/utils/research/archive-writer';
import { sha256Text, stableJson } from '@/utils/research/hash';
import type { CaptureResult } from '@/utils/research/types';
import { subtitleSrt, type BilibiliDocument } from './bilibili';
export const BILIBILI_HISTORY_KEY = 'auto_save_bilibili_history';
interface Storage {get(key:string):Promise<Record<string,unknown>>;set(data:Record<string,unknown>):Promise<void>}
function archiveErrorCode(error:unknown):string {
  const messages:Record<string,string>={
    'Offscreen Blob creation failed':'BLOB_CREATE_FAILED',
    'Could not establish connection. Receiving end does not exist.':'NO_MESSAGE_RECEIVER',
    'Archive download filename changed':'FILENAME_CHANGED',
    'Unsafe archive download filename':'UNSAFE_FILENAME',
    'Invalid filename':'INVALID_FILENAME',
    'Archive download cleanup failed':'DOWNLOAD_CLEANUP_FAILED',
    'Archive Blob cleanup failed':'BLOB_CLEANUP_FAILED',
    'Download item unavailable':'DOWNLOAD_ITEM_MISSING',
  };
  if(error instanceof Error && messages[error.message]) return messages[error.message];
  if(error instanceof Error && /^Download interrupted: (FILE_FAILED|FILE_ACCESS_DENIED|FILE_NO_SPACE|FILE_NAME_TOO_LONG|FILE_TOO_LARGE|FILE_VIRUS_INFECTED|FILE_BLOCKED|FILE_SECURITY_CHECK_FAILED|FILE_TOO_SHORT|FILE_HASH_MISMATCH|NETWORK_FAILED|NETWORK_TIMEOUT|NETWORK_DISCONNECTED|NETWORK_SERVER_DOWN|NETWORK_INVALID_REQUEST|SERVER_FAILED|SERVER_NO_RANGE|SERVER_BAD_CONTENT|SERVER_UNAUTHORIZED|SERVER_CERT_PROBLEM|SERVER_FORBIDDEN|SERVER_UNREACHABLE|USER_CANCELED|USER_SHUTDOWN|CRASH)$/.test(error.message)) return error.message.replace('Download interrupted: ','');
  return error instanceof TypeError?'TYPE_ERROR':'UNKNOWN';
}
export async function saveBilibiliArchive(doc:BilibiliDocument, storage:Storage, io:ArchiveIo):Promise<CaptureResult> {
  let stage='内容指纹';
  const subtitleSummary=doc.subtitle.status==='available'?`平台字幕：${doc.subtitle.cues.length}条`:`平台字幕：${doc.subtitle.status}`;
  try {
    const {capturedAt,...content}=doc;
    const hash=await sha256Text(stableJson(content));
    const archivePath=`Sky-Clipper Backup/Bilibili/${doc.sourceId}/${hash.slice(7)}`;
    stage='去重读取';
    const state=await storage.get(BILIBILI_HISTORY_KEY);
    const history=(state[BILIBILI_HISTORY_KEY] || {}) as Record<string,string>;
    const key=`${doc.sourceId}:${hash}`;
    if(history[key]===archivePath) return {status:'duplicate',archivePath};
    const warnings=[...doc.warnings];
    const hasSubtitle=doc.subtitle.status==='available' && doc.subtitle.cues.length>0;
    if(!hasSubtitle && !warnings.length) warnings.push('未取得平台字幕，简介不等于文字稿');
    let coverPath:string|null=null;
    if(doc.coverUrl){
      const path=`images/cover.${doc.coverUrl.split('.').pop()}`;
      stage='封面';
      try{await io.downloadUrl(`${archivePath}/${path}`,doc.coverUrl,'image/');coverPath=path;}
      catch(error){warnings.push(`封面下载失败（${archiveErrorCode(error)}）`);}
    }
    const cueLabel=doc.subtitle.automatic?'B站 AI 自动字幕（未人工逐字听校）':'B站平台字幕（未人工逐字听校）';
    if(hasSubtitle){
      stage='字幕JSON';
      await io.writeText(`${archivePath}/subtitles.json`,JSON.stringify({sourceUrl:doc.sourceUrl,cid:doc.cid,language:doc.subtitle.language,automatic:doc.subtitle.automatic,body:doc.subtitle.cues},null,2),'application/json');
      stage='字幕SRT';
      await io.writeText(`${archivePath}/subtitles.srt`,subtitleSrt(doc.subtitle.cues),'application/x-subrip');
      stage='纯文字稿';
      await io.writeText(`${archivePath}/transcript.txt`,`${cueLabel}\n${doc.subtitle.cues.map(c=>c.content).join('\n')}\n`,'text/plain;charset=utf-8');
    }
    const writeMetadata=async()=>{
      const status=warnings.length?'partial':'complete';
      const markdown=`---\nsource: ${JSON.stringify(doc.sourceUrl)}\nauthor: ${JSON.stringify(doc.author)}\npublished_at: ${JSON.stringify(doc.publishedAt)}\ncaptured_at: ${JSON.stringify(capturedAt)}\ncontent_hash: ${hash}\nsource_scope: current-part-platform-subtitles\ncapture_status: ${status}\nvideo_downloaded: false\n---\n\n# ${doc.title.replace(/[\r\n]/g,' ')}\n\n分P：${doc.part} · ${doc.partTitle}\n\n[观看原视频](${doc.sourceUrl})（本次保存文字与封面，未下载视频文件）\n\n${coverPath?`![视频封面](${coverPath})\n\n`:''}## 简介\n\n${doc.description}\n\n## 字幕\n\n${hasSubtitle?`${cueLabel} · ${doc.subtitle.language}\n\n`+doc.subtitle.cues.map(c=>`[${c.from.toFixed(3)}–${c.to.toFixed(3)} 秒] ${c.content}`).join('  \n'):'未取得可用字幕。'}\n${warnings.length?'\n> '+warnings.join('；')+'\n':''}`;
      stage='原文Markdown';
      await io.writeText(`${archivePath}/original.md`,markdown,'text/markdown;charset=utf-8');
      stage='归档清单';
      await io.writeText(`${archivePath}/capture.json`,JSON.stringify({...doc,coverPath,imagesComplete:!!coverPath,contentHash:hash,sourceScope:'current-part-platform-subtitles',videoDownloaded:false,subtitleComplete:hasSubtitle,fullSpeechVerified:false,status,warnings},null,2),'application/json');
    };
    await writeMetadata();
    if(!warnings.length){try{await storage.set({[BILIBILI_HISTORY_KEY]:{...history,[key]:archivePath}});}catch{warnings.push('去重记录未保存，刷新可重试');await writeMetadata();}}
    return warnings.length?{status:'partial',archivePath,warnings}:{status:'saved',archivePath};
  }catch(error){return {status:'failed',reason:`B站保存失败（${stage} / ${archiveErrorCode(error)}；${subtitleSummary}）`};}
  finally{await io.close().catch(()=>{});}
}
