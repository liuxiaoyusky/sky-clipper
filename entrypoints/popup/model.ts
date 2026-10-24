import { canonicalBilibiliUrl } from '@/utils/social/bilibili';
import { canonicalWechatUrl } from '@/utils/social/wechat';
import { canonicalXUrl } from '@/utils/social/x';
import type { BatchUiState } from '@/utils/research/batch-queue';
import type {
  BatchUiRequest,
  BatchUiResponse,
  GetPageStatusResponse,
} from '@/utils/research/messages';
import type { ResearchSettings } from '@/utils/research/settings';
import type { PageStatus } from '@/utils/research/types';

export type SettingsPatch = (settings: ResearchSettings) => ResearchSettings;

export interface SettingsQueueState {
  settings: ResearchSettings;
  saving: boolean;
  error?: string;
}

export interface SettingsSaveQueue {
  getState(): SettingsQueueState;
  patch(apply: SettingsPatch): Promise<void>;
  subscribe(listener: (state: SettingsQueueState) => void): () => void;
}

export function createSettingsSaveQueue(
  initial: ResearchSettings,
  save: (settings: ResearchSettings) => Promise<void>,
): SettingsSaveQueue {
  let committed = initial;
  let desired = initial;
  let state: SettingsQueueState = { settings: initial, saving: false };
  const listeners = new Set<(next: SettingsQueueState) => void>();
  const pending: Array<{ apply: SettingsPatch; done: () => void }> = [];
  let draining = false;

  const publish = () => listeners.forEach((listener) => listener(state));
  const projectPending = () => pending.reduce((next, job) => job.apply(next), committed);

  const drain = async () => {
    if (draining) return;
    draining = true;
    while (pending.length) {
      const job = pending.shift()!;
      try {
        const next = job.apply(committed);
        await save(next);
        committed = next;
      } catch {
        desired = projectPending();
        state = { settings: desired, saving: pending.length > 0, error: '无法保存设置，请重试' };
        publish();
      }
      job.done();
      if (state.error === undefined) {
        state = { settings: desired, saving: pending.length > 0 };
        publish();
      }
    }
    draining = false;
    state = { settings: committed, saving: false, ...(state.error ? { error: state.error } : {}) };
    publish();
  };

  return {
    getState: () => state,
    patch(apply) {
      desired = apply(desired);
      state = { settings: desired, saving: true };
      publish();
      return new Promise<void>((resolve) => {
        pending.push({ apply, done: resolve });
        void drain();
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface ActiveTab {
  id?: number;
  url?: string;
}

export interface PageStatusDependencies {
  queryActiveTab(): Promise<ActiveTab[]>;
  sendToTab(tabId: number): Promise<GetPageStatusResponse | undefined>;
}

function status(code: PageStatus['code'], message: string): PageStatus {
  return { code, message, updatedAt: new Date().toISOString() };
}

function isBofaUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'rsch.baml.com';
  } catch {
    return false;
  }
}

export async function readPageStatus(dependencies: PageStatusDependencies): Promise<PageStatus> {
  let tab: ActiveTab | undefined;
  try {
    [tab] = await dependencies.queryActiveTab();
  } catch {
    return status('needs-action', '无法读取当前标签页，请关闭弹窗后重试');
  }
  if (tab?.id == null || (!isBofaUrl(tab.url) && !canonicalXUrl(tab.url || '') && !canonicalWechatUrl(tab.url || '') && !canonicalBilibiliUrl(tab.url || ''))) {
    return status('unsupported', '当前页面不是已支持的 BofA 研报、X 原文、公众号文章或 B站视频');
  }
  try {
    const response = await dependencies.sendToTab(tab.id);
    return response?.ok
      ? response.status
      : status('needs-action', '无法连接当前原文页面，请刷新当前页面后重试');
  } catch {
    return status('needs-action', '无法连接当前原文页面，请刷新当前页面后重试');
  }
}

export interface PageStatusPoller {
  start(): void;
  refresh(): void;
  invalidate(): void;
  stop(): void;
}

export async function requestBatchUiState(
  request: BatchUiRequest,
  send: (request: BatchUiRequest) => Promise<BatchUiResponse | undefined>,
): Promise<BatchUiState> {
  const response = await send(request);
  if (!response?.ok) throw new Error(response?.reason || '无法读取批量任务状态');
  return response.state;
}

export interface BatchStatePoller {
  start(): void;
  refresh(): void;
  stop(): void;
}

export function createBatchStatePoller(dependencies: {
  read(): Promise<BatchUiState>;
  publish(state: BatchUiState): void;
  onError(message: string): void;
  schedule(callback: () => void, delay: number): number;
  cancel(timer: number): void;
  intervalMs?: number;
}): BatchStatePoller {
  const intervalMs = dependencies.intervalMs ?? 1000;
  let active = false;
  let inFlight = false;
  let generation = 0;
  let timer: number | undefined;

  const clearTimer = () => {
    if (timer !== undefined) dependencies.cancel(timer);
    timer = undefined;
  };
  const poll = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    const runGeneration = ++generation;
    try {
      const next = await dependencies.read();
      if (active && runGeneration === generation) {
        dependencies.publish(next);
        dependencies.onError('');
      }
    } catch (error) {
      if (active && runGeneration === generation) {
        dependencies.onError(error instanceof Error ? error.message : '无法读取批量任务状态');
      }
    } finally {
      inFlight = false;
      if (active) {
        timer = dependencies.schedule(() => {
          timer = undefined;
          void poll();
        }, intervalMs);
      }
    }
  };

  return {
    start() {
      if (active) return;
      active = true;
      void poll();
    },
    refresh() {
      if (!active) return;
      clearTimer();
      if (!inFlight) void poll();
    },
    stop() {
      active = false;
      generation += 1;
      clearTimer();
    },
  };
}

export function createPageStatusPoller(dependencies: {
  read(): Promise<PageStatus>;
  publish(status: PageStatus): void;
  schedule(callback: () => void, delay: number): number;
  cancel(timer: number): void;
  intervalMs?: number;
}): PageStatusPoller {
  const intervalMs = dependencies.intervalMs ?? 1000;
  let active = false;
  let inFlight = false;
  let generation = 0;
  let rerun = false;
  let timer: number | undefined;

  const clearTimer = () => {
    if (timer !== undefined) dependencies.cancel(timer);
    timer = undefined;
  };

  const poll = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    const runGeneration = ++generation;
    try {
      const next = await dependencies.read();
      if (active && runGeneration === generation) dependencies.publish(next);
    } finally {
      inFlight = false;
      if (!active) return;
      const delay = rerun ? 0 : intervalMs;
      rerun = false;
      timer = dependencies.schedule(() => {
        timer = undefined;
        void poll();
      }, delay);
    }
  };

  return {
    start() {
      if (active) return;
      active = true;
      void poll();
    },
    refresh() {
      if (!active) return;
      clearTimer();
      if (!inFlight) void poll();
    },
    invalidate() {
      if (!active) return;
      if (inFlight) {
        generation += 1;
        rerun = true;
        return;
      }
      this.refresh();
    },
    stop() {
      active = false;
      generation += 1;
      clearTimer();
    },
  };
}
