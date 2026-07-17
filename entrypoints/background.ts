import {
  createChromeArchiveIo,
  eraseArchiveDownloadHistory,
} from '@/utils/research/chrome-archive-io';
import { createCaptureService } from '@/utils/research/capture-service';
import { createHistoryRepository } from '@/utils/research/history';
import { isCaptureRequest } from '@/utils/research/messages';

export default defineBackground(() => {
  void eraseArchiveDownloadHistory().catch(() => {});
  const service = createCaptureService({
    history: createHistoryRepository(),
    createIo: createChromeArchiveIo,
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isCaptureRequest(message)) return false;
    service.submit(message.submission).then(sendResponse);
    return true;
  });
});
