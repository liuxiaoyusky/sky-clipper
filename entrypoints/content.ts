import { bofaAdapter } from '@/utils/research/adapters/bofa';
import {
  isGetPageStatusRequest,
  type CaptureRequest,
  type GetPageStatusResponse,
} from '@/utils/research/messages';
import {
  bofaDomIdentity,
  bofaRunKey,
  createNavigationCaptureScheduler,
  type ScheduledCapture,
  waitForStablePage,
} from '@/utils/research/observe';
import { redactError } from '@/utils/research/privacy';
import {
  isBofaAutoCaptureEnabled,
  loadResearchSettings,
  RESEARCH_SETTINGS_KEY,
} from '@/utils/research/settings';
import type { CaptureResult, PageStatus, PageStatusCode } from '@/utils/research/types';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export default defineContentScript({
  matches: ['https://rsch.baml.com/*'],
  runAt: 'document_idle',
  main() {
    const scheduler = createNavigationCaptureScheduler();
    let status: PageStatus = {
      code: 'observing',
      message: '正在识别当前研报页面',
      updatedAt: new Date().toISOString(),
    };

    const setStatus = (
      code: PageStatusCode,
      message: string,
      extra: Partial<PageStatus> = {},
    ) => {
      status = { code, message, updatedAt: new Date().toISOString(), ...extra };
    };

    const applyResult = (result: CaptureResult, title?: string) => {
      if (result.status === 'saved') {
        setStatus('saved', '原始研报已保存', { title, archivePath: result.archivePath });
      } else if (result.status === 'duplicate') {
        setStatus('duplicate', '相同版本已保存，不重复下载', {
          title,
          archivePath: result.archivePath,
        });
      } else if (result.status === 'partial') {
        setStatus('partial', '已保存可用原始文件，但有文件未完成', {
          title,
          archivePath: result.archivePath,
        });
      } else {
        setStatus('failed', result.reason, { title });
      }
    };

    const readEvidence = () => bofaAdapter.readinessEvidence(document, new URL(location.href));
    const readRunKey = () => bofaRunKey(location.href, bofaAdapter.getSourceId(document) || undefined);
    const readDomIdentity = () => bofaDomIdentity(location.href, readEvidence());
    let startCapture: (capture: ScheduledCapture) => void = () => {};
    const syncNavigation = () => {
      const capture = scheduler.sync(location.href, readDomIdentity(), readRunKey());
      if (capture) startCapture(capture);
    };
    const isCurrent = (runGeneration: number, runKey: string) => {
      syncNavigation();
      return scheduler.isCurrent(runGeneration, runKey);
    };

    const run = async (runGeneration: number, runKey: string) => {
      const settings = await loadResearchSettings();
      if (!isCurrent(runGeneration, runKey)) return;
      if (!isBofaAutoCaptureEnabled(settings)) {
        setStatus('disabled', '自动捕获或 BofA 支持已关闭');
        return;
      }
      const url = new URL(location.href);
      const kind = bofaAdapter.classifyPage(document, url);
      if (kind === 'auth-required') {
        setStatus('needs-action', '页面需要登录、验证或人工处理');
        return;
      }
      if (kind !== 'report-html') {
        setStatus('unsupported', '当前页面不是已支持的 BofA HTML 研报');
        return;
      }

      setStatus('waiting-ready', '等待研报正文稳定');
      const readiness = await waitForStablePage({
        probe: readEvidence,
        sleep,
        shouldContinue: () => isCurrent(runGeneration, runKey),
      });
      if (!isCurrent(runGeneration, runKey) || readiness === 'cancelled') return;
      if (readiness === 'auth-required') {
        setStatus('needs-action', '页面需要登录、验证或人工处理');
        return;
      }
      if (readiness === 'timeout') {
        setStatus('needs-action', '研报正文在 30 秒内没有稳定，请检查页面加载状态');
        return;
      }

      setStatus('extracting', '正在转换原始研报正文');
      if (!isCurrent(runGeneration, runKey)) return;
      const submission = await bofaAdapter.extractOriginal(
        document,
        location.href,
        new Date().toISOString(),
      );
      if (!isCurrent(runGeneration, runKey)) return;
      setStatus('saving', '正在写入 Downloads 研报归档', {
        title: submission.document.title,
      });
      const request: CaptureRequest = {
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_CAPTURE',
        submission,
      };
      if (!isCurrent(runGeneration, runKey)) return;
      const result = (await chrome.runtime.sendMessage(request)) as CaptureResult;
      if (isCurrent(runGeneration, runKey)) applyResult(result, submission.document.title);
    };

    const safelyRun = async (runGeneration: number, runKey: string) => {
      try {
        await run(runGeneration, runKey);
      } catch (error) {
        if (isCurrent(runGeneration, runKey)) {
          setStatus('failed', `保存失败：${redactError(error)}`);
        }
      }
    };

    startCapture = ({ generation, runKey }) => {
      void safelyRun(generation, runKey);
    };

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isGetPageStatusRequest(message)) return false;
      sendResponse({ ok: true, status } satisfies GetPageStatusResponse);
      return false;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[RESEARCH_SETTINGS_KEY]) return;
      const capture = scheduler.restart(location.href, readDomIdentity(), readRunKey());
      if (capture) startCapture(capture);
    });

    let identityCheckTimer: number | undefined;
    const scheduleIdentityCheck = () => {
      if (identityCheckTimer !== undefined) return;
      identityCheckTimer = window.setTimeout(() => {
        identityCheckTimer = undefined;
        syncNavigation();
      }, 100);
    };
    new MutationObserver(scheduleIdentityCheck).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['value'],
      characterData: true,
      childList: true,
      subtree: true,
    });

    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method] as History['pushState'];
      history[method] = ((...args: Parameters<History['pushState']>) => {
        const result = original.apply(history, args);
        queueMicrotask(syncNavigation);
        return result;
      }) as History['pushState'];
    }
    window.addEventListener('popstate', syncNavigation);
    window.addEventListener('hashchange', syncNavigation);
    window.setInterval(syncNavigation, 250);

    startCapture(scheduler.begin(location.href, readDomIdentity(), readRunKey()));
  },
});
