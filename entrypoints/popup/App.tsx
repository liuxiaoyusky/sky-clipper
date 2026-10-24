import { useEffect, useRef, useState } from 'react';
import type { BatchUiState } from '@/utils/research/batch-queue';
import type {
  BatchUiRequest,
  BatchUiResponse,
  GetPageStatusResponse,
} from '@/utils/research/messages';
import {
  DEFAULT_RESEARCH_SETTINGS,
  loadResearchSettings,
  saveResearchSettings,
  type ResearchSettings,
} from '@/utils/research/settings';
import { presentPageStatus } from '@/utils/research/status';
import type { PageStatus } from '@/utils/research/types';
import {
  createPageStatusPoller,
  createBatchStatePoller,
  createSettingsSaveQueue,
  readPageStatus,
  requestBatchUiState,
  type BatchStatePoller,
  type PageStatusPoller,
  type SettingsQueueState,
  type SettingsSaveQueue,
} from './model';

const BACKUP_LABEL = '下载目录：研报 → Fin-report-clipper Backup/；X → Sky-Clipper Backup/X/；公众号 → Sky-Clipper Backup/WeChat/；B站 → Sky-Clipper Backup/Bilibili/';
const observingStatus: PageStatus = {
  code: 'observing',
  message: '正在读取当前页面状态',
  updatedAt: new Date().toISOString(),
};
const idleBatchState: BatchUiState = {
  queue: {
    status: 'idle',
    currentIndex: 0,
    total: 0,
    counts: { saved: 0, duplicate: 0, partial: 0, failed: 0, remaining: 0 },
    items: [],
  },
};

function readCurrentPageStatus(): Promise<PageStatus> {
  return readPageStatus({
    queryActiveTab: () => chrome.tabs.query({ active: true, currentWindow: true }),
    sendToTab: (tabId) =>
      chrome.tabs.sendMessage(tabId, {
        target: 'content',
        type: 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS',
      }) as Promise<GetPageStatusResponse | undefined>,
  });
}

function sendBatchRequest(request: BatchUiRequest): Promise<BatchUiState> {
  return requestBatchUiState(
    request,
    (next) => chrome.runtime.sendMessage(next) as Promise<BatchUiResponse | undefined>,
  );
}

const batchStatusLabels: Record<BatchUiState['queue']['status'], string> = {
  idle: '尚未开始',
  running: '正在顺序抓取',
  pausing: '当前研报完成后暂停',
  paused: '已暂停',
  completed: '本批次已完成',
  cancelled: '本批次已取消',
};

export function App() {
  const [settingsState, setSettingsState] = useState<SettingsQueueState>({
    settings: DEFAULT_RESEARCH_SETTINGS,
    saving: false,
  });
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [status, setStatus] = useState<PageStatus>(observingStatus);
  const [batchState, setBatchState] = useState<BatchUiState>(idleBatchState);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchCommandError, setBatchCommandError] = useState('');
  const [batchPollError, setBatchPollError] = useState('');
  const queueRef = useRef<SettingsSaveQueue>();
  const pollerRef = useRef<PageStatusPoller>();
  const batchPollerRef = useRef<BatchStatePoller>();
  const draftKeyRef = useRef('');

  const publishBatchState = (next: BatchUiState) => {
    const draftKey = next.draft?.items.map((item) => item.id).join('|') || '';
    if (draftKey !== draftKeyRef.current) {
      draftKeyRef.current = draftKey;
      setSelectedIds(next.draft?.items.map((item) => item.id) || []);
    }
    setBatchState(next);
  };

  useEffect(() => {
    let active = true;
    let queue: SettingsSaveQueue | undefined;
    let unsubscribe: (() => void) | undefined;
    void loadResearchSettings()
      .then((initial) => {
        if (!active) return;
        queue = createSettingsSaveQueue(initial, saveResearchSettings);
        queueRef.current = queue;
        setSettingsState(queue.getState());
        setSettingsReady(true);
        setSettingsLoading(false);
        unsubscribe = queue.subscribe((next) => {
          if (active) setSettingsState(next);
        });
      })
      .catch(() => {
        if (!active) return;
        setSettingsState({
          settings: DEFAULT_RESEARCH_SETTINGS,
          saving: false,
          error: '无法读取设置，请关闭弹窗后重试',
        });
        setSettingsLoading(false);
      });
    return () => {
      active = false;
      unsubscribe?.();
      if (queueRef.current === queue) queueRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const poller = createBatchStatePoller({
      read: () =>
        sendBatchRequest({
          target: 'background',
          type: 'FIN_REPORT_CLIPPER_BATCH_GET_STATE',
        }),
      publish: publishBatchState,
      onError: setBatchPollError,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
    });
    batchPollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      batchPollerRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const poller = createPageStatusPoller({
      read: readCurrentPageStatus,
      publish: setStatus,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      pollerRef.current = undefined;
    };
  }, []);

  const update = (apply: (settings: ResearchSettings) => ResearchSettings) => {
    const queue = queueRef.current;
    if (!queue) return;
    void queue.patch(apply).then(() => pollerRef.current?.invalidate());
  };

  const presented = presentPageStatus(status.code);
  const controlsDisabled = !settingsReady || settingsState.saving;
  const queueActive = ['running', 'pausing', 'paused'].includes(batchState.queue.status);
  const currentBatchItem = batchState.queue.items[batchState.queue.currentIndex];
  const pausedBeforeOpening =
    batchState.queue.status === 'paused' && currentBatchItem?.status === 'queued';
  const runBatchCommand = async (request: BatchUiRequest) => {
    setBatchBusy(true);
    setBatchCommandError('');
    try {
      publishBatchState(await sendBatchRequest(request));
      batchPollerRef.current?.refresh();
    } catch (error) {
      setBatchCommandError(error instanceof Error ? error.message : '批量操作失败，请重试');
    } finally {
      setBatchBusy(false);
    }
  };
  return (
    <main className="frc-popup">
      <header className="frc-header">
        <div>
          <h1>自动保存版本</h1>
          <p>打开原文，自动保存</p>
        </div>
      </header>

      <section className={`frc-status frc-status-${presented.tone}`}>
        <strong>{presented.label}</strong>
        <span>{status.message}</span>
        {status.title && <small>{status.title}</small>}
        {status.archivePath && <code>{status.archivePath}</code>}
      </section>

      <section className="frc-settings" aria-label="自动捕获设置">
        <label>
          <span>
            <strong>研报 · 自动捕获</strong>
            <small>打开受支持研报后自动保存</small>
          </span>
          <input
            type="checkbox"
            checked={settingsState.settings.autoCapture}
            disabled={controlsDisabled}
            onChange={(event) => {
              const autoCapture = event.target.checked;
              update((settings) => ({ ...settings, autoCapture }));
            }}
          />
        </label>
        <label className="frc-site-setting">
          <span>
            <strong>BofA Global Research</strong>
            <small>研报站点</small>
          </span>
          <input
            type="checkbox"
            checked={settingsState.settings.providers.bofa}
            disabled={controlsDisabled || !settingsState.settings.autoCapture}
            onChange={(event) => {
              const bofa = event.target.checked;
              update((settings) => ({
                ...settings,
                providers: { ...settings.providers, bofa },
              }));
            }}
          />
        </label>
        <label>
          <span><strong>自媒体 · 自动保存</strong><small>打开具体原文后自动保存</small></span>
          <input type="checkbox" checked={settingsState.settings.socialAutoCapture}
            disabled={controlsDisabled}
            onChange={(event) => { const socialAutoCapture = event.target.checked; update(settings => ({...settings,socialAutoCapture})); }} />
        </label>
        <label className="frc-site-setting">
          <span><strong>X / Twitter</strong><small>单篇帖子与 Article，保留原文及图片</small></span>
          <input type="checkbox" checked={settingsState.settings.providers.x}
            disabled={controlsDisabled || !settingsState.settings.socialAutoCapture}
            onChange={(event) => { const x = event.target.checked; update(settings => ({...settings,providers:{...settings.providers,x}})); }} />
        </label>
        <label className="frc-site-setting">
          <span><strong>微信公众号</strong><small>公开图文文章，保留正文与配图</small></span>
          <input type="checkbox" checked={settingsState.settings.providers.wechat}
            disabled={controlsDisabled || !settingsState.settings.socialAutoCapture}
            onChange={(event) => { const wechat = event.target.checked; update(settings => ({...settings,providers:{...settings.providers,wechat}})); }} />
        </label>
        <label className="frc-site-setting">
          <span><strong>B站 / Bilibili</strong><small>当前分P的简介、封面与平台字幕；不下载视频</small></span>
          <input type="checkbox" checked={settingsState.settings.providers.bilibili}
            disabled={controlsDisabled || !settingsState.settings.socialAutoCapture}
            onChange={(event) => { const bilibili = event.target.checked; update(settings => ({...settings,providers:{...settings.providers,bilibili}})); }} />
        </label>
      </section>

      {(settingsLoading || settingsState.saving || settingsState.error) && (
        <p className="frc-settings-state" role={settingsState.error ? 'alert' : undefined}>
          {settingsState.error || (settingsLoading ? '正在读取设置' : '正在保存设置')}
        </p>
      )}

      <section className="frc-batch" aria-label="批量抓取">
        <div className="frc-batch-heading">
          <span>
            <strong>批量抓取</strong>
            <small>扫描当前列表，确认后单标签顺序处理</small>
          </span>
          <span className={`frc-batch-state frc-batch-state-${batchState.queue.status}`}>
            {batchStatusLabels[batchState.queue.status]}
          </span>
        </div>

        {!batchState.draft && !queueActive && (
          <button
            type="button"
            className="frc-primary-button"
            disabled={batchBusy}
            onClick={() =>
              void runBatchCommand({
                target: 'background',
                type: 'FIN_REPORT_CLIPPER_BATCH_SCAN_ACTIVE_PAGE',
              })
            }
          >
            扫描当前 BofA 列表页
          </button>
        )}

        {batchState.draft && !queueActive && (
          <div className="frc-discovery">
            <p>
              已发现 <strong>{batchState.draft.items.length}</strong> 篇当前页面研报
              {batchState.draft.truncated ? '（已达到单批 20 篇上限）' : ''}
            </p>
            <div className="frc-discovery-list">
              {batchState.draft.items.map((item) => (
                <label key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    disabled={batchBusy}
                    onChange={(event) =>
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>{item.title}</span>
                </label>
              ))}
            </div>
            <div className="frc-button-row">
              <button
                type="button"
                disabled={batchBusy}
                onClick={() =>
                  void runBatchCommand({
                    target: 'background',
                    type: 'FIN_REPORT_CLIPPER_BATCH_CLEAR_DISCOVERY',
                  })
                }
              >
                取消
              </button>
              <button
                type="button"
                className="frc-primary-button"
                disabled={batchBusy || selectedIds.length === 0}
                onClick={() =>
                  void runBatchCommand({
                    target: 'background',
                    type: 'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY',
                    selectedIds,
                  })
                }
              >
                开始抓取 {selectedIds.length} 篇
              </button>
            </div>
          </div>
        )}

        {batchState.queue.total > 0 && (
          <div className="frc-batch-progress">
            {batchState.queue.status === 'cancelled' ? (
              <p>本批次已结束，不会再打开研报</p>
            ) : (
              <p>
                {pausedBeforeOpening
                  ? `已完成 ${batchState.queue.currentIndex}/${batchState.queue.total}`
                  : `进度 ${Math.min(batchState.queue.currentIndex + 1, batchState.queue.total)}/${batchState.queue.total}`}
                {batchState.queue.currentTitle
                  ? ` · ${pausedBeforeOpening ? '待处理：' : ''}${batchState.queue.currentTitle}`
                  : ''}
              </p>
            )}
            <small>
              成功 {batchState.queue.counts.saved} · 重复 {batchState.queue.counts.duplicate} ·
              部分 {batchState.queue.counts.partial} · 待处理 {batchState.queue.counts.remaining}
            </small>
            {batchState.queue.pauseReason && (
              <p className="frc-batch-warning" role="alert">
                {batchState.queue.pauseReason}
              </p>
            )}
            {queueActive && (
              <div className="frc-button-row">
                {batchState.queue.status === 'running' && (
                  <button
                    type="button"
                    disabled={batchBusy}
                    onClick={() =>
                      void runBatchCommand({
                        target: 'background',
                        type: 'FIN_REPORT_CLIPPER_BATCH_PAUSE',
                      })
                    }
                  >
                    暂停
                  </button>
                )}
                {batchState.queue.status === 'paused' && (
                  <button
                    type="button"
                    className="frc-primary-button"
                    disabled={batchBusy}
                    onClick={() =>
                      void runBatchCommand({
                        target: 'background',
                        type: 'FIN_REPORT_CLIPPER_BATCH_RESUME',
                      })
                    }
                  >
                    继续
                  </button>
                )}
                <button
                  type="button"
                  disabled={batchBusy}
                  onClick={() =>
                    void runBatchCommand({
                      target: 'background',
                      type: 'FIN_REPORT_CLIPPER_BATCH_CANCEL',
                    })
                  }
                >
                  结束并关闭工作页
                </button>
              </div>
            )}
          </div>
        )}

        {(batchCommandError || batchPollError) && (
          <p className="frc-batch-warning" role="alert">
            {batchCommandError || batchPollError}
          </p>
        )}
      </section>

      <footer>
        <span>文件流程</span>
        <code>{BACKUP_LABEL}</code>
      </footer>
    </main>
  );
}
