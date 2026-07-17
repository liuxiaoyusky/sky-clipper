import type { CreateBlobRequest, RevokeBlobRequest } from './messages';
import type { ArchiveIo } from './archive-writer';

const OFFSCREEN_PATH = 'offscreen.html';
const ARCHIVE_FILENAME_RE = 'Fin-report-clipper Backup';
const SAFE_ARCHIVE_PREFIX = `${ARCHIVE_FILENAME_RE}/`;
const DOWNLOAD_CLEANUP_ERROR = 'Archive download cleanup failed';
const BLOB_CLEANUP_ERROR = 'Archive Blob cleanup failed';
const DOWNLOAD_RECOVERY_TIMEOUT_ERROR = 'Archive download recovery timed out';
let creatingOffscreen: Promise<void> | null = null;

export async function eraseArchiveDownloadHistory(): Promise<void> {
  await chrome.downloads.erase({ filenameRegex: ARCHIVE_FILENAME_RE });
}

export interface ArchiveDownloadRecoveryOptions {
  downloads?: {
    search(query: chrome.downloads.DownloadQuery): Promise<Array<{ id: number; state: string }>>;
  };
  sleep?(milliseconds: number): Promise<void>;
  maxAttempts?: number;
  intervalMs?: number;
}

export async function waitForArchiveDownloadsToSettle(
  options: ArchiveDownloadRecoveryOptions = {},
): Promise<void> {
  const downloads = options.downloads || chrome.downloads;
  const sleep = options.sleep || ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = options.maxAttempts ?? 20;
  const intervalMs = options.intervalMs ?? 250;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const active = await downloads.search({
      filenameRegex: ARCHIVE_FILENAME_RE,
      state: 'in_progress',
    });
    if (!active.length) return;
    if (attempt === maxAttempts - 1) throw new Error(DOWNLOAD_RECOVERY_TIMEOUT_ERROR);
    await sleep(intervalMs);
  }
}

function isSafeArchiveFilename(path: string): boolean {
  return (
    path.startsWith(SAFE_ARCHIVE_PREFIX) &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '' || part === '.' || part === '..') &&
    !/[\u0000-\u001f\u007f:?*"<>|#[\]]/.test(path)
  );
}

async function hasOffscreenDocument(): Promise<boolean> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Create Blob URLs for large research Markdown downloads',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

function interruptedReason(item: chrome.downloads.DownloadItem): string {
  return item.error || 'UNKNOWN_DOWNLOAD_ERROR';
}

async function waitForDownload(downloadId: number): Promise<chrome.downloads.DownloadItem> {
  return new Promise<chrome.downloads.DownloadItem>((resolve, reject) => {
    let settled = false;
    const finish = (item?: chrome.downloads.DownloadItem, error?: Error) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else if (item) resolve(item);
      else reject(new Error('Download item unavailable'));
    };
    const inspect = async () => {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (!item) return finish(undefined, new Error('Download item unavailable'));
      if (item.state === 'complete') return finish(item);
      if (item.state === 'interrupted') {
        return finish(undefined, new Error(`Download interrupted: ${interruptedReason(item)}`));
      }
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== downloadId || !delta.state?.current) return;
      void inspect().catch((error) =>
        finish(undefined, error instanceof Error ? error : new Error(String(error))),
      );
    };
    chrome.downloads.onChanged.addListener(onChanged);
    void inspect().catch((error) =>
      finish(undefined, error instanceof Error ? error : new Error(String(error))),
    );
  });
}

async function download(
  path: string,
  url: string,
  expectedMimePrefix?: string,
  eraseHistoryOnSuccess = true,
): Promise<number> {
  if (!isSafeArchiveFilename(path)) throw new Error('Unsafe archive download filename');
  const downloadId = await chrome.downloads.download({
    url,
    filename: path,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  let operationError: unknown;
  try {
    const item = await waitForDownload(downloadId);
    if (
      expectedMimePrefix &&
      !item.mime?.toLowerCase().startsWith(expectedMimePrefix.toLowerCase())
    ) {
      throw new Error(`Unexpected download MIME: ${item.mime || 'unknown'}`);
    }
  } catch (error) {
    operationError = error;
  }

  if (operationError) {
    let cleanupFailed = false;
    try {
      await chrome.downloads.removeFile(downloadId);
    } catch {
      cleanupFailed = true;
    }
    try {
      await chrome.downloads.erase({ id: downloadId });
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) throw new Error(DOWNLOAD_CLEANUP_ERROR);
    throw operationError;
  }
  if (eraseHistoryOnSuccess) {
    try {
      await chrome.downloads.erase({ id: downloadId });
    } catch {
      throw new Error(DOWNLOAD_CLEANUP_ERROR);
    }
  }
  return downloadId;
}

async function rollbackTextDownload(downloadId: number): Promise<void> {
  await chrome.downloads.removeFile(downloadId).catch(() => {});
  await chrome.downloads.erase({ id: downloadId }).catch(() => {});
}

async function finalizeTextDownload(downloadId: number): Promise<void> {
  try {
    await chrome.downloads.erase({ id: downloadId });
  } catch {
    await rollbackTextDownload(downloadId);
    throw new Error(DOWNLOAD_CLEANUP_ERROR);
  }
}

async function createBlobUrl(content: string, mime: string): Promise<string> {
  await ensureOffscreenDocument();
  const request: CreateBlobRequest = {
    target: 'offscreen',
    type: 'FIN_REPORT_CLIPPER_CREATE_BLOB',
    requestId: crypto.randomUUID(),
    content,
    mime,
  };
  const response = (await chrome.runtime.sendMessage(request)) as
    | { ok: true; requestId: string; url: string }
    | undefined;
  if (!response?.ok || response.requestId !== request.requestId) {
    throw new Error('Offscreen Blob creation failed');
  }
  return response.url;
}

async function revokeBlobUrl(url: string): Promise<void> {
  const request: RevokeBlobRequest = {
    target: 'offscreen',
    type: 'FIN_REPORT_CLIPPER_REVOKE_BLOB',
    url,
  };
  await chrome.runtime.sendMessage(request);
}

export function createChromeArchiveIo(): ArchiveIo {
  return {
    async writeText(path, content, mime) {
      const url = await createBlobUrl(content, mime);
      let operationError: unknown;
      let downloadId: number | undefined;
      try {
        downloadId = await download(path, url, undefined, false);
      } catch (error) {
        operationError = error;
      }
      try {
        await revokeBlobUrl(url);
      } catch {
        try {
          await chrome.offscreen.closeDocument();
        } catch {
          if (downloadId !== undefined) {
            await rollbackTextDownload(downloadId);
          }
          throw new Error(BLOB_CLEANUP_ERROR);
        }
      }
      if (downloadId !== undefined) await finalizeTextDownload(downloadId);
      if (operationError) throw operationError;
    },
    async downloadUrl(path, url, expectedMimePrefix) {
      await download(path, url, expectedMimePrefix);
    },
    async close() {
      if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
    },
  };
}
