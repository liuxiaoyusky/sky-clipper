import { BilibiliCaptureCancelled, canonicalBilibiliUrl, collectBilibiliDocument, isBilibiliCaptureRequest } from '@/utils/social/bilibili';
import { saveBilibiliArchive } from '@/utils/social/bilibili-archive';
import { isBilibiliAutoCaptureEnabled } from '@/utils/research/settings';
import { canonicalWechatUrl, isWechatCaptureRequest } from '@/utils/social/wechat';
import { canonicalXUrl, isXCaptureRequest } from '@/utils/social/x';
import { createSerialArchiveQueue, saveXArchive, saveWechatArchive } from '@/utils/social/archive';
import { isXAutoCaptureEnabled, isWechatAutoCaptureEnabled, loadResearchSettings } from '@/utils/research/settings';
import {
  createChromeArchiveIo,
  registerArchiveDownloadFilenames,
  eraseArchiveDownloadHistory,
  waitForArchiveDownloadsToSettle,
} from '@/utils/research/chrome-archive-io';
import {
  createCaptureService,
  createCaptureStartupRecovery,
} from '@/utils/research/capture-service';
import { createBatchQueueService } from '@/utils/research/batch-queue';
import { createHistoryRepository } from '@/utils/research/history';
import {
  isBatchPageStatusRequest,
  isBatchUiRequest,
  isBofaCaptureSender,
  isCaptureRequest,
  isExtensionUiSender,
  isMarketsTodayDraftRequest,
  isMarketsTodayRunClaimRequest,
  isMarketsTodayRunMutationRequest,
  isMarketsTodaySender,
  type BatchUiRequest,
  type BatchUiResponse,
  type DiscoverCurrentPageResponse,
  type MarketsTodayRunClaimResponse,
} from '@/utils/research/messages';
import { isMarketsTodayResultsUrl } from '@/utils/research/markets-today';
import { createMarketsTodayRunService } from '@/utils/research/markets-today-run';
import { redactError } from '@/utils/research/privacy';

export default defineBackground(() => {
  registerArchiveDownloadFilenames();
  const recovery = createCaptureStartupRecovery({
    session: chrome.storage.session,
    settle: waitForArchiveDownloadsToSettle,
    sweep: eraseArchiveDownloadHistory,
  });
  const archiveQueue = createSerialArchiveQueue();
  const service = createCaptureService({
    history: createHistoryRepository(),
    createIo: createChromeArchiveIo,
    recovery,
  });
  const batch = createBatchQueueService({
    session: chrome.storage.session,
    tabs: chrome.tabs,
    alarms: chrome.alarms,
  });
  const marketsTodayRuns = createMarketsTodayRunService({
    session: chrome.storage.session,
  });

  const scanActivePage = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id === undefined || !tab.url) throw new Error('无法读取当前标签页');
    const url = new URL(tab.url);
    if (url.protocol !== 'https:' || url.hostname !== 'rsch.baml.com') {
      throw new Error('当前页面不是 BofA Research 页面');
    }
    const response = (await chrome.tabs.sendMessage(tab.id, {
      target: 'content',
      type: 'FIN_REPORT_CLIPPER_DISCOVER_CURRENT_PAGE',
    })) as DiscoverCurrentPageResponse | undefined;
    if (!response?.ok || !response.links.length) {
      throw new Error('当前页面没有发现可处理的 BofA 研报链接');
    }
    return batch.stageDiscovery(response.links, response.truncated);
  };

  const handleBatchUiRequest = (message: BatchUiRequest) => {
    if (message.type === 'FIN_REPORT_CLIPPER_BATCH_SCAN_ACTIVE_PAGE') return scanActivePage();
    if (message.type === 'FIN_REPORT_CLIPPER_BATCH_GET_STATE') return batch.getState();
    if (message.type === 'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY') {
      return batch.confirmDiscovery(message.selectedIds);
    }
    if (message.type === 'FIN_REPORT_CLIPPER_BATCH_CLEAR_DISCOVERY') {
      return batch.clearDiscovery();
    }
    if (message.type === 'FIN_REPORT_CLIPPER_BATCH_PAUSE') return batch.pause();
    if (message.type === 'FIN_REPORT_CLIPPER_BATCH_RESUME') return batch.resume();
    return batch.cancel();
  };

  void batch.getState().catch(() => {});

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isBilibiliCaptureRequest(message, sender, chrome.runtime.id)) {
      archiveQueue(async () => {
        await recovery.ready();
        const stillAllowed = async () => {
          const tab = await chrome.tabs.get(sender.tab!.id!);
          return isBilibiliAutoCaptureEnabled(await loadResearchSettings()) && canonicalBilibiliUrl(tab.url || '') === message.sourceUrl;
        };
        if (!await stillAllowed()) return {status:'failed',reason:'B站自动保存已关闭或页面已切换'};
        const doc = await collectBilibiliDocument(message.sourceUrl,message.title,fetch,stillAllowed);
        if (!await stillAllowed()) return {status:'failed',reason:'B站自动保存已关闭或页面已切换，未写入文件'};
        const io = createChromeArchiveIo();
        const guard = async () => { if (!await stillAllowed()) throw new BilibiliCaptureCancelled('自动保存已关闭或页面已切换'); };
        return saveBilibiliArchive(doc,chrome.storage.local,{
          writeText:async (...args) => {await guard();return io.writeText(...args);},
          downloadUrl:async (...args) => {await guard();return io.downloadUrl(...args);},
          close:() => io.close(),
        });
      }).then(sendResponse).catch(() => sendResponse({status:'failed',reason:'B站读取或保存失败；请检查登录状态及页面后刷新，不会自动重试'}));
      return true;
    }

    if (isXCaptureRequest(message, sender, chrome.runtime.id)) {
      archiveQueue(async () => {
        await recovery.ready();
        const tab = await chrome.tabs.get(sender.tab!.id!);
        if (!isXAutoCaptureEnabled(await loadResearchSettings()) || canonicalXUrl(tab.url || '') !== message.document.sourceUrl) {
          return { status: 'failed', reason: 'X 自动保存已关闭或页面已切换' };
        }
        return saveXArchive(message.document, chrome.storage.local, createChromeArchiveIo());
      }).then(sendResponse).catch(() => sendResponse({ status: 'failed', reason: 'X 保存失败，请刷新重试' }));
      return true;
    }

    if (isWechatCaptureRequest(message, sender, chrome.runtime.id)) {
      archiveQueue(async () => {
        await recovery.ready();
        const tab = await chrome.tabs.get(sender.tab!.id!);
        if (!isWechatAutoCaptureEnabled(await loadResearchSettings()) || canonicalWechatUrl(tab.url || '') !== message.document.sourceUrl) {
          return { status: 'failed', reason: '公众号自动保存已关闭或页面已切换' };
        }
        return saveWechatArchive(message.document, chrome.storage.local, createChromeArchiveIo());
      }).then(sendResponse).catch(() => sendResponse({ status: 'failed', reason: '公众号保存失败，请刷新重试' }));
      return true;
    }

    if (isCaptureRequest(message) && isBofaCaptureSender(sender, chrome.runtime.id)) {
      archiveQueue(() => service.submit(message.submission))
        .then(sendResponse)
        .catch((error) => sendResponse({ status: 'failed', reason: redactError(error) }));
      return true;
    }

    if (
      isBatchPageStatusRequest(message) &&
      isBofaCaptureSender(sender, chrome.runtime.id) &&
      sender.tab?.id !== undefined &&
      sender.documentId
    ) {
      batch
        .handlePageStatus(
          sender.tab.id,
          sender.documentId,
          message.navigationToken,
          message.status,
        )
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (
      isMarketsTodayRunClaimRequest(message) &&
      isMarketsTodaySender(sender, chrome.runtime.id) &&
      sender.tab?.id !== undefined &&
      sender.documentId
    ) {
      marketsTodayRuns
        .claim({
          tabId: sender.tab.id,
          documentId: sender.documentId,
          isTodayResultsPage: isMarketsTodayResultsUrl(sender.url || ''),
        })
        .then((claim) =>
          sendResponse({ ok: true, ...claim } satisfies MarketsTodayRunClaimResponse),
        )
        .catch((error) =>
          sendResponse({
            ok: false,
            reason: redactError(error),
          } satisfies MarketsTodayRunClaimResponse),
        );
      return true;
    }

    if (
      isMarketsTodayRunMutationRequest(message) &&
      isMarketsTodaySender(sender, chrome.runtime.id) &&
      sender.tab?.id !== undefined &&
      sender.documentId
    ) {
      const operation =
        message.type === 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_ISSUE_SEARCH'
          ? marketsTodayRuns.issueSearch({
              tabId: sender.tab.id,
              documentId: sender.documentId,
              runId: message.runId,
            })
          : marketsTodayRuns.stop({
              tabId: sender.tab.id,
              documentId: sender.documentId,
              runId: message.runId,
            });
      operation
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({ ok: false, reason: redactError(error) }),
        );
      return true;
    }

    if (
      isMarketsTodayDraftRequest(message) &&
      isMarketsTodaySender(sender, chrome.runtime.id) &&
      sender.tab?.id !== undefined &&
      sender.documentId
    ) {
      marketsTodayRuns
        .stageDraft(
          {
            tabId: sender.tab.id,
            documentId: sender.documentId,
            runId: message.runId,
          },
          () => batch.stageDiscovery(message.links, message.truncated),
        )
        .then((state) => sendResponse({ ok: true, state } satisfies BatchUiResponse))
        .catch((error) =>
          sendResponse({ ok: false, reason: redactError(error) } satisfies BatchUiResponse),
        );
      return true;
    }

    if (isBatchUiRequest(message) && isExtensionUiSender(sender, chrome.runtime.id)) {
      handleBatchUiRequest(message)
        .then((state) => sendResponse({ ok: true, state } satisfies BatchUiResponse))
        .catch((error) =>
          sendResponse({ ok: false, reason: redactError(error) } satisfies BatchUiResponse),
        );
      return true;
    }

    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void batch.handleWorkTabClosed(tabId).catch(() => {});
    void marketsTodayRuns.clearTab(tabId).catch(() => {});
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    void batch.handleTimeout(alarm.name).catch(() => {});
  });
});
