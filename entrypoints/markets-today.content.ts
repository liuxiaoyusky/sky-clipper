import {
  isMarketsTodayEntryUrl,
  prepareMarketsTodayDraft,
} from '@/utils/research/markets-today';
import type {
  BatchUiResponse,
  MarketsTodayDraftRequest,
  MarketsTodayRunClaimRequest,
  MarketsTodayRunClaimResponse,
  MarketsTodayRunMutationRequest,
  MarketsTodayRunMutationResponse,
} from '@/utils/research/messages';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export default defineContentScript({
  matches: ['https://markets.ml.com/researchlibrary/advancedsearch*'],
  runAt: 'document_idle',
  main() {
    if (!isMarketsTodayEntryUrl(location.href)) return;

    void (async () => {
      const claimRequest: MarketsTodayRunClaimRequest = {
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_CLAIM',
      };
      const claim = (await chrome.runtime.sendMessage(claimRequest)) as
        | MarketsTodayRunClaimResponse
        | undefined;
      if (!claim?.ok) {
        console.warn(
          `[Fin-report-clipper] ${claim?.reason || '无法创建 Today 搜索事务'}`,
        );
        return;
      }
      if (claim.action === 'wait' || claim.action === 'skip') {
        console.warn(`[Fin-report-clipper] ${claim.reason}`);
        return;
      }
      if (!('runId' in claim)) return;
      const updateRun = async (
        type: MarketsTodayRunMutationRequest['type'],
      ): Promise<boolean> => {
        const response = (await chrome.runtime.sendMessage({
          target: 'background',
          type,
          runId: claim.runId,
        } satisfies MarketsTodayRunMutationRequest)) as
          | MarketsTodayRunMutationResponse
          | undefined;
        return response?.ok === true;
      };

      try {
        const result = await prepareMarketsTodayDraft({
          document,
          sleep,
          resumeAfterSearch: claim.action === 'resume',
          beforeSearch: () =>
            updateRun('FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_ISSUE_SEARCH'),
          shouldContinue: () => isMarketsTodayEntryUrl(location.href),
        });
        if (result.kind !== 'draft') {
          await updateRun('FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_STOP').catch(
            () => false,
          );
          console.warn(`[Fin-report-clipper] ${result.reason}`);
          return;
        }

        const request: MarketsTodayDraftRequest = {
          target: 'background',
          type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_DRAFT',
          runId: claim.runId,
          links: result.links,
          truncated: result.truncated,
        };
        const response = (await chrome.runtime.sendMessage(request)) as
          | BatchUiResponse
          | undefined;
        if (!response?.ok) {
          await updateRun('FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_STOP').catch(
            () => false,
          );
          console.warn('[Fin-report-clipper] 当前页研报草稿未创建，请打开 Popup 检查');
        }
      } catch (error) {
        await updateRun('FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_STOP').catch(
          () => false,
        );
        throw error;
      }
    })().catch(() => {
      console.warn('[Fin-report-clipper] BofA 当日研报入口自动化已停止');
    });
  },
});
