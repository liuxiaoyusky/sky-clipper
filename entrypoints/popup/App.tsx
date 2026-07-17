import { useCallback, useEffect, useState } from 'react';
import type {
  GetPageStatusRequest,
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

const BACKUP_LABEL = 'Downloads/Fin-report-clipper Backup/';
const unsupportedStatus: PageStatus = {
  code: 'unsupported',
  message: '当前页面不是已支持的 BofA 研报',
  updatedAt: new Date().toISOString(),
};

async function readCurrentPageStatus(): Promise<PageStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return unsupportedStatus;
  const request: GetPageStatusRequest = {
    target: 'content',
    type: 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS',
  };
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, request)) as
      | GetPageStatusResponse
      | undefined;
    return response?.ok ? response.status : unsupportedStatus;
  } catch {
    return unsupportedStatus;
  }
}

export function App() {
  const [settings, setSettings] = useState<ResearchSettings>(DEFAULT_RESEARCH_SETTINGS);
  const [status, setStatus] = useState<PageStatus>({
    code: 'observing',
    message: '正在读取当前页面状态',
    updatedAt: new Date().toISOString(),
  });

  const refreshStatus = useCallback(async () => {
    setStatus(await readCurrentPageStatus());
  }, []);

  useEffect(() => {
    let active = true;
    void loadResearchSettings().then((value) => {
      if (active) setSettings(value);
    });
    void refreshStatus();
    const timer = window.setInterval(refreshStatus, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshStatus]);

  const update = async (next: ResearchSettings) => {
    setSettings(next);
    await saveResearchSettings(next);
    await refreshStatus();
  };

  const presented = presentPageStatus(status.code);
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
            checked={settings.autoCapture}
            onChange={(event) => void update({ ...settings, autoCapture: event.target.checked })}
          />
        </label>
        <label>
          <span>
            <strong>BofA Global Research</strong>
            <small>阶段 1 唯一支持机构</small>
          </span>
          <input
            type="checkbox"
            checked={settings.providers.bofa}
            onChange={(event) =>
              void update({
                ...settings,
                providers: { ...settings.providers, bofa: event.target.checked },
              })
            }
          />
        </label>
      </section>

      <footer>
        <span>固定备份位置</span>
        <code>{BACKUP_LABEL}</code>
      </footer>
    </main>
  );
}
