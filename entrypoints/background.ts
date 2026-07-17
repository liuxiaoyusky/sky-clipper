import {
  createChromeArchiveIo,
  eraseArchiveDownloadHistory,
} from '@/utils/research/chrome-archive-io';
import {
  createCaptureService,
  createCaptureStartupRecovery,
} from '@/utils/research/capture-service';
import { createHistoryRepository } from '@/utils/research/history';
import { isBofaCaptureSender, isCaptureRequest } from '@/utils/research/messages';
import { redactError } from '@/utils/research/privacy';

export default defineBackground(() => {
  const recovery = createCaptureStartupRecovery({
    session: chrome.storage.session,
    sweep: eraseArchiveDownloadHistory,
  });
  const service = createCaptureService({
    history: createHistoryRepository(),
    createIo: createChromeArchiveIo,
    recovery,
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isCaptureRequest(message) || !isBofaCaptureSender(sender, chrome.runtime.id)) {
      return false;
    }
    service
      .submit(message.submission)
      .then(sendResponse)
      .catch((error) => sendResponse({ status: 'failed', reason: redactError(error) }));
    return true;
  });
});
