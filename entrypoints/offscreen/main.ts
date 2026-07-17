import type { CreateBlobRequest, RevokeBlobRequest } from '@/utils/research/messages';

const ownedUrls = new Set<string>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  if (message.type === 'FIN_REPORT_CLIPPER_CREATE_BLOB') {
    const request = message as CreateBlobRequest;
    const url = URL.createObjectURL(new Blob([request.content], { type: request.mime }));
    ownedUrls.add(url);
    sendResponse({ ok: true, requestId: request.requestId, url });
    return false;
  }
  if (message.type === 'FIN_REPORT_CLIPPER_REVOKE_BLOB') {
    const request = message as RevokeBlobRequest;
    if (ownedUrls.delete(request.url)) URL.revokeObjectURL(request.url);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
