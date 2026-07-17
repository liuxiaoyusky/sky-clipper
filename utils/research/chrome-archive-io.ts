import type { CreateBlobRequest, RevokeBlobRequest } from './messages';
import type { ArchiveIo } from './archive-writer';

const OFFSCREEN_PATH = 'offscreen.html';
const ARCHIVE_FILENAME_RE = 'Fin-report-clipper Backup';
const SAFE_ARCHIVE_PREFIX = `${ARCHIVE_FILENAME_RE}/`;
const DOWNLOAD_CLEANUP_ERROR = 'Archive download cleanup failed';
const BLOB_CLEANUP_ERROR = 'Archive Blob cleanup failed';
let creatingOffscreen: Promise<void> | null = null;

export async function eraseArchiveDownloadHistory(): Promise<void> {
  await chrome.downloads.erase({ filenameRegex: ARCHIVE_FILENAME_RE });
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
  rollbackTextOnCleanupFailure = false,
): Promise<void> {
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

  let cleanupFailed = false;
  let fileRemovalAttempted = false;
  if (operationError) {
    fileRemovalAttempted = true;
    try {
      await chrome.downloads.removeFile(downloadId);
    } catch {
      cleanupFailed = true;
    }
  }
  try {
    await chrome.downloads.erase({ id: downloadId });
  } catch {
    cleanupFailed = true;
  }
  if (cleanupFailed) {
    if (rollbackTextOnCleanupFailure && !fileRemovalAttempted) {
      await chrome.downloads.removeFile(downloadId).catch(() => {});
    }
    throw new Error(DOWNLOAD_CLEANUP_ERROR);
  }
  if (operationError) throw operationError;
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
      try {
        await download(path, url, undefined, true);
      } catch (error) {
        operationError = error;
      }
      try {
        await revokeBlobUrl(url);
      } catch {
        try {
          await chrome.offscreen.closeDocument();
        } catch {
          throw new Error(BLOB_CLEANUP_ERROR);
        }
      }
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
