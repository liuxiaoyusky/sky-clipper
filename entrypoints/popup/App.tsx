import { useEffect, useRef, useState } from 'react';
import type { GetPageStatusResponse } from '@/utils/research/messages';
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
  createSettingsSaveQueue,
  readPageStatus,
  type PageStatusPoller,
  type SettingsQueueState,
  type SettingsSaveQueue,
} from './model';

const BACKUP_LABEL = 'Downloads/Fin-report-clipper Backup/';
const observingStatus: PageStatus = {
  code: 'observing',
  message: '正在读取当前页面状态',
  updatedAt: new Date().toISOString(),
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

export function App() {
  const [settingsState, setSettingsState] = useState<SettingsQueueState>({
    settings: DEFAULT_RESEARCH_SETTINGS,
    saving: false,
  });
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [status, setStatus] = useState<PageStatus>(observingStatus);
  const queueRef = useRef<SettingsSaveQueue>();
  const pollerRef = useRef<PageStatusPoller>();

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
  return (
    <main className="frc-popup">
      <header className="frc-header">
        <div>
          <h1>Fin-report-clipper</h1>
          <p>Chrome 研报自动归档</p>
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
            <strong>自动捕获</strong>
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
        <label>
          <span>
            <strong>BofA Global Research</strong>
            <small>阶段 1 唯一支持机构</small>
          </span>
          <input
            type="checkbox"
            checked={settingsState.settings.providers.bofa}
            disabled={controlsDisabled}
            onChange={(event) => {
              const bofa = event.target.checked;
              update((settings) => ({
                ...settings,
                providers: { ...settings.providers, bofa },
              }));
            }}
          />
        </label>
      </section>

      {(settingsLoading || settingsState.saving || settingsState.error) && (
        <p className="frc-settings-state" role={settingsState.error ? 'alert' : undefined}>
          {settingsState.error || (settingsLoading ? '正在读取设置' : '正在保存设置')}
        </p>
      )}

      <footer>
        <span>固定备份位置</span>
        <code>{BACKUP_LABEL}</code>
      </footer>
    </main>
  );
}
