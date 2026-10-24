import type { DiscoveredReportLink } from './entry-discovery';
import { MAX_DISCOVERED_REPORTS } from './entry-discovery';
import { redactError } from './privacy';
import type { PageStatus, PageStatusCode } from './types';

export const BATCH_DRAFT_KEY = 'fin_report_clipper_batch_draft';
export const BATCH_QUEUE_KEY = 'fin_report_clipper_batch_queue';
export const BATCH_TIMEOUT_ALARM_PREFIX = 'fin_report_clipper_batch_timeout';
export const BATCH_NAVIGATION_INTERVAL_MS = 10_000;
const BATCH_NAVIGATION_HASH_KEY = 'fin-report-clipper-batch';

export type BatchRunStatus =
  | 'idle'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type BatchTaskStatus =
  | 'queued'
  | 'opening'
  | 'observing'
  | 'waiting-ready'
  | 'extracting'
  | 'saving'
  | 'saved'
  | 'duplicate'
  | 'partial'
  | 'needs-action'
  | 'failed'
  | 'cancelled';

interface StoredBatchDraft {
  version: 1;
  createdAt: string;
  truncated: boolean;
  items: DiscoveredReportLink[];
}

interface StoredBatchTask {
  id: string;
  title: string;
  url?: string;
  status: BatchTaskStatus;
  message?: string;
  documentId?: string;
  navigationToken?: string;
}

interface StoredBatchQueue {
  version: 1;
  status: Exclude<BatchRunStatus, 'idle'>;
  currentIndex: number;
  items: StoredBatchTask[];
  retiredDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
  workTabId?: number;
  pauseReason?: string;
  timeoutAlarmName?: string;
}

export interface BatchStoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface BatchTabPort {
  create(properties: { url: string; active: boolean }): Promise<{ id?: number }>;
  update(tabId: number, properties: { url: string; active: boolean }): Promise<unknown>;
  get(tabId: number): Promise<{ id?: number }>;
  remove(tabId: number): Promise<void>;
}

export interface BatchAlarmPort {
  create(name: string, alarmInfo: { delayInMinutes: number }): Promise<void> | void;
  clear(name: string): Promise<boolean>;
}

export interface PublicBatchDraft {
  items: Array<{ id: string; title: string }>;
  truncated: boolean;
}

export interface PublicBatchQueue {
  status: BatchRunStatus;
  currentIndex: number;
  total: number;
  currentTitle?: string;
  pauseReason?: string;
  counts: {
    saved: number;
    duplicate: number;
    partial: number;
    failed: number;
    remaining: number;
  };
  items: Array<{ id: string; title: string; status: BatchTaskStatus; message?: string }>;
}

export interface BatchUiState {
  draft?: PublicBatchDraft;
  queue: PublicBatchQueue;
}

export interface BatchQueueService {
  getState(): Promise<BatchUiState>;
  stageDiscovery(links: DiscoveredReportLink[], truncated: boolean): Promise<BatchUiState>;
  clearDiscovery(): Promise<BatchUiState>;
  confirmDiscovery(selectedIds: string[]): Promise<BatchUiState>;
  pause(): Promise<BatchUiState>;
  resume(): Promise<BatchUiState>;
  cancel(): Promise<BatchUiState>;
  handlePageStatus(
    tabId: number,
    documentId: string,
    navigationToken: string | undefined,
    status: PageStatus,
  ): Promise<BatchUiState>;
  handleWorkTabClosed(tabId: number): Promise<BatchUiState>;
  handleTimeout(alarmName: string): Promise<BatchUiState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOpaqueToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value);
}

export function readBatchNavigationToken(hash: string): string | undefined {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get(BATCH_NAVIGATION_HASH_KEY);
  return isOpaqueToken(token) ? token : undefined;
}

function withBatchNavigationToken(rawUrl: string, token: string): string {
  const url = new URL(rawUrl);
  url.hash = new URLSearchParams({ [BATCH_NAVIGATION_HASH_KEY]: token }).toString();
  return url.toString();
}

function isBofaReportUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'rsch.baml.com') return false;
    if (url.pathname !== '/r' && url.pathname !== '/report') return false;
    return url.pathname !== '/r' || Boolean(url.searchParams.get('q')?.trim());
  } catch {
    return false;
  }
}

function normalizedLink(value: DiscoveredReportLink): DiscoveredReportLink | undefined {
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim() : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !title || !isBofaReportUrl(value.url)) {
    return undefined;
  }
  return { id, title: title.slice(0, 240), url: value.url };
}

function normalizeDraft(value: unknown): StoredBatchDraft | undefined {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return undefined;
  const items = value.items
    .slice(0, MAX_DISCOVERED_REPORTS)
    .map((item) => (isRecord(item) ? normalizedLink(item as unknown as DiscoveredReportLink) : undefined));
  if (!items.length || items.some((item) => !item)) return undefined;
  return {
    version: 1,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    truncated: value.truncated === true,
    items: items as DiscoveredReportLink[],
  };
}

const RUN_STATUSES = new Set<StoredBatchQueue['status']>([
  'running',
  'pausing',
  'paused',
  'completed',
  'cancelled',
]);
const TASK_STATUSES = new Set<BatchTaskStatus>([
  'queued',
  'opening',
  'observing',
  'waiting-ready',
  'extracting',
  'saving',
  'saved',
  'duplicate',
  'partial',
  'needs-action',
  'failed',
  'cancelled',
]);

function normalizeQueue(value: unknown): StoredBatchQueue | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.status !== 'string' ||
    !RUN_STATUSES.has(value.status as StoredBatchQueue['status']) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > MAX_DISCOVERED_REPORTS ||
    !Number.isInteger(value.currentIndex)
  ) {
    return undefined;
  }
  const items: StoredBatchTask[] = [];
  for (const raw of value.items) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string') {
      return undefined;
    }
    if (typeof raw.status !== 'string' || !TASK_STATUSES.has(raw.status as BatchTaskStatus)) {
      return undefined;
    }
    if (raw.url !== undefined && (typeof raw.url !== 'string' || !isBofaReportUrl(raw.url))) {
      return undefined;
    }
    items.push({
      id: raw.id.slice(0, 80),
      title: raw.title.slice(0, 240),
      status: raw.status as BatchTaskStatus,
      ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
      ...(typeof raw.message === 'string' ? { message: raw.message.slice(0, 240) } : {}),
      ...(typeof raw.documentId === 'string' ? { documentId: raw.documentId.slice(0, 160) } : {}),
      ...(isOpaqueToken(raw.navigationToken) ? { navigationToken: raw.navigationToken } : {}),
    });
  }
  const currentIndex = value.currentIndex as number;
  if (currentIndex < 0 || currentIndex > items.length) return undefined;
  return {
    version: 1,
    status: value.status as StoredBatchQueue['status'],
    currentIndex,
    items,
    retiredDocumentIds: Array.isArray(value.retiredDocumentIds)
      ? value.retiredDocumentIds.filter((item): item is string => typeof item === 'string').slice(-40)
      : [],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    ...(typeof value.workTabId === 'number' ? { workTabId: value.workTabId } : {}),
    ...(typeof value.pauseReason === 'string'
      ? { pauseReason: value.pauseReason.slice(0, 240) }
      : {}),
    ...(typeof value.timeoutAlarmName === 'string' &&
    value.timeoutAlarmName.startsWith(`${BATCH_TIMEOUT_ALARM_PREFIX}:`) &&
    isOpaqueToken(value.timeoutAlarmName.slice(BATCH_TIMEOUT_ALARM_PREFIX.length + 1))
      ? { timeoutAlarmName: value.timeoutAlarmName }
      : {}),
  };
}

function emptyPublicQueue(): PublicBatchQueue {
  return {
    status: 'idle',
    currentIndex: 0,
    total: 0,
    counts: { saved: 0, duplicate: 0, partial: 0, failed: 0, remaining: 0 },
    items: [],
  };
}

function publicQueue(queue: StoredBatchQueue | undefined): PublicBatchQueue {
  if (!queue) return emptyPublicQueue();
  const saved = queue.items.filter((item) => item.status === 'saved').length;
  const duplicate = queue.items.filter((item) => item.status === 'duplicate').length;
  const partial = queue.items.filter((item) => item.status === 'partial').length;
  const failed = queue.items.filter((item) =>
    ['needs-action', 'failed'].includes(item.status),
  ).length;
  const finished = saved + duplicate + queue.items.filter((item) => item.status === 'cancelled').length;
  return {
    status: queue.status,
    currentIndex: queue.currentIndex,
    total: queue.items.length,
    ...(queue.items[queue.currentIndex]
      ? { currentTitle: queue.items[queue.currentIndex].title }
      : {}),
    ...(queue.pauseReason ? { pauseReason: queue.pauseReason } : {}),
    counts: {
      saved,
      duplicate,
      partial,
      failed,
      remaining:
        queue.status === 'cancelled' ? 0 : Math.max(0, queue.items.length - finished),
    },
    items: queue.items.map(({ id, title, status, message }) => ({
      id,
      title,
      status,
      ...(message ? { message } : {}),
    })),
  };
}

function publicState(draft: StoredBatchDraft | undefined, queue: StoredBatchQueue | undefined) {
  return {
    ...(draft
      ? {
          draft: {
            truncated: draft.truncated,
            items: draft.items.map(({ id, title }) => ({ id, title })),
          },
        }
      : {}),
    queue: publicQueue(queue),
  } satisfies BatchUiState;
}

function safeMessage(value: string): string {
  return redactError(value).slice(0, 240);
}

function terminalSuccess(code: PageStatusCode): code is 'saved' | 'duplicate' | 'partial' {
  return code === 'saved' || code === 'duplicate' || code === 'partial';
}

function queueIsActive(queue: StoredBatchQueue | undefined): boolean {
  return Boolean(queue && ['running', 'pausing', 'paused'].includes(queue.status));
}

function workingStatus(code: PageStatusCode): code is Extract<
  BatchTaskStatus,
  'observing' | 'waiting-ready' | 'extracting' | 'saving'
> {
  return ['observing', 'waiting-ready', 'extracting', 'saving'].includes(code);
}

function retireDocument(queue: StoredBatchQueue, documentId: string | undefined): void {
  if (!documentId || queue.retiredDocumentIds.includes(documentId)) return;
  queue.retiredDocumentIds = [...queue.retiredDocumentIds, documentId].slice(-40);
}

export function createBatchQueueService(dependencies: {
  session: BatchStoragePort;
  tabs: BatchTabPort;
  alarms: BatchAlarmPort;
  now?: () => string;
  makeToken?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
}): BatchQueueService {
  const now = dependencies.now || (() => new Date().toISOString());
  const makeToken = dependencies.makeToken || (() => crypto.randomUUID());
  const sleep =
    dependencies.sleep ||
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let draft: StoredBatchDraft | undefined;
  let queue: StoredBatchQueue | undefined;
  let readyPromise: Promise<void> | undefined;
  let serial: Promise<void> = Promise.resolve();
  let pendingControl: 'pause' | 'cancel' | undefined;

  const saveDraft = async () => {
    if (draft) await dependencies.session.set({ [BATCH_DRAFT_KEY]: draft });
    else await dependencies.session.remove(BATCH_DRAFT_KEY);
  };
  const saveQueue = async () => {
    if (queue) {
      queue.updatedAt = now();
      await dependencies.session.set({ [BATCH_QUEUE_KEY]: queue });
    } else {
      await dependencies.session.remove(BATCH_QUEUE_KEY);
    }
  };
  const nextToken = () => {
    const token = makeToken();
    if (!isOpaqueToken(token)) throw new Error('Unable to create a batch token');
    return token;
  };
  const takeTimeoutAlarm = () => {
    const alarmName = queue?.timeoutAlarmName;
    if (queue) delete queue.timeoutAlarmName;
    return alarmName;
  };
  const clearAlarm = async (alarmName: string | undefined) => {
    if (alarmName) await dependencies.alarms.clear(alarmName).catch(() => false);
  };
  const armTimeout = async () => {
    if (!queue) return;
    const previous = queue.timeoutAlarmName;
    const alarmName = `${BATCH_TIMEOUT_ALARM_PREFIX}:${nextToken()}`;
    queue.timeoutAlarmName = alarmName;
    await saveQueue();
    try {
      await dependencies.alarms.create(alarmName, { delayInMinutes: 1 });
    } catch (error) {
      if (queue?.timeoutAlarmName === alarmName) {
        if (previous) queue.timeoutAlarmName = previous;
        else delete queue.timeoutAlarmName;
        await saveQueue();
      }
      throw error;
    }
    await clearAlarm(previous);
  };
  const pauseFor = async (reason: string, taskStatus: BatchTaskStatus = 'needs-action') => {
    if (!queue) return;
    const alarmName = takeTimeoutAlarm();
    const current = queue.items[queue.currentIndex];
    if (current && !terminalSuccess(current.status as PageStatusCode)) {
      current.status = taskStatus;
      current.message = safeMessage(reason);
    }
    queue.status = 'paused';
    queue.pauseReason = safeMessage(reason);
    await saveQueue();
    await clearAlarm(alarmName);
  };
  const requestControl = (control: 'pause' | 'cancel') => {
    if (control === 'cancel' || pendingControl === undefined) pendingControl = control;
  };
  const clearControl = (control: 'pause' | 'cancel') => {
    if (pendingControl === control) pendingControl = undefined;
  };
  const holdForPendingControl = async () => {
    if (!queue || !pendingControl) return false;
    const current = queue.items[queue.currentIndex];
    if (current) {
      retireDocument(queue, current.documentId);
      delete current.documentId;
      delete current.navigationToken;
      if (!terminalSuccess(current.status as PageStatusCode)) current.status = 'queued';
    }
    const alarmName = takeTimeoutAlarm();
    queue.status = 'paused';
    queue.pauseReason =
      pendingControl === 'cancel' ? '正在结束批量任务' : '批量任务已暂停';
    await saveQueue();
    await clearAlarm(alarmName);
    return true;
  };

  const initialize = async () => {
    const [draftState, queueState] = await Promise.all([
      dependencies.session.get(BATCH_DRAFT_KEY),
      dependencies.session.get(BATCH_QUEUE_KEY),
    ]);
    draft = normalizeDraft(draftState[BATCH_DRAFT_KEY]);
    queue = normalizeQueue(queueState[BATCH_QUEUE_KEY]);
    if (queue && (queue.status === 'running' || queue.status === 'pausing')) {
      if (queue.workTabId === undefined) {
        await pauseFor('批量任务已恢复，请确认后继续');
      } else {
        let workTabExists = true;
        try {
          await dependencies.tabs.get(queue.workTabId);
        } catch {
          workTabExists = false;
        }
        if (!workTabExists) {
          queue.workTabId = undefined;
          await pauseFor('工作标签页已关闭，请确认后继续', 'queued');
        } else {
          const current = queue.items[queue.currentIndex];
          if (!current) {
            const alarmName = takeTimeoutAlarm();
            queue.status = 'completed';
            delete queue.pauseReason;
            await saveQueue();
            await clearAlarm(alarmName);
          } else if (!current.navigationToken || current.status === 'queued') {
            retireDocument(queue, current.documentId);
            delete current.documentId;
            current.status = 'queued';
            await pauseFor('批量任务已恢复，请确认后继续', 'queued');
          } else if (!queue.timeoutAlarmName) {
            await armTimeout();
          }
        }
      }
    }
  };
  const ready = () => {
    if (!readyPromise) {
      readyPromise = initialize().catch((error) => {
        readyPromise = undefined;
        throw error;
      });
    }
    return readyPromise;
  };

  const execute = <T>(operation: () => Promise<T>): Promise<T> => {
    const task = serial.then(async () => {
      await ready();
      return operation();
    });
    serial = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  const navigateCurrent = async (): Promise<void> => {
    if (!queue) return;
    if (await holdForPendingControl()) return;
    const current = queue.items[queue.currentIndex];
    if (!current) {
      const alarmName = takeTimeoutAlarm();
      queue.status = 'completed';
      delete queue.pauseReason;
      await saveQueue();
      await clearAlarm(alarmName);
      return;
    }
    if (!current.url) {
      await pauseFor('当前任务缺少可恢复链接', 'failed');
      return;
    }
    retireDocument(queue, current.documentId);
    delete current.documentId;
    current.navigationToken = nextToken();
    current.status = 'opening';
    delete current.message;
    queue.status = 'running';
    delete queue.pauseReason;
    await saveQueue();
    if (await holdForPendingControl()) return;

    try {
      if (queue.workTabId !== undefined) {
        try {
          await dependencies.tabs.get(queue.workTabId);
        } catch {
          delete queue.workTabId;
        }
      }
      if (await holdForPendingControl()) return;
      if (queue.workTabId === undefined) {
        const tab = await dependencies.tabs.create({
          url: withBatchNavigationToken(current.url, current.navigationToken),
          active: true,
        });
        if (tab.id === undefined) throw new Error('Work tab is unavailable');
        queue.workTabId = tab.id;
      } else {
        try {
          await dependencies.tabs.update(queue.workTabId, {
            url: withBatchNavigationToken(current.url, current.navigationToken),
            active: true,
          });
        } catch {
          await pauseFor('无法打开工作标签页，请人工检查');
          return;
        }
      }
      await saveQueue();
      await armTimeout();
    } catch {
      await pauseFor('无法打开工作标签页，请人工检查');
    }
  };

  return {
    getState: () => execute(async () => publicState(draft, queue)),

    stageDiscovery: (links, truncated) =>
      execute(async () => {
        if (queueIsActive(queue)) throw new Error('请先完成或结束当前批量任务');
        const normalized: DiscoveredReportLink[] = [];
        const ids = new Set<string>();
        for (const raw of links.slice(0, MAX_DISCOVERED_REPORTS)) {
          const link = normalizedLink(raw);
          if (!link || ids.has(link.id)) continue;
          ids.add(link.id);
          normalized.push(link);
        }
        if (!normalized.length) throw new Error('当前页面没有可加入的 BofA 研报链接');
        draft = { version: 1, createdAt: now(), truncated, items: normalized };
        await saveDraft();
        return publicState(draft, queue);
      }),

    clearDiscovery: () =>
      execute(async () => {
        draft = undefined;
        await saveDraft();
        return publicState(draft, queue);
      }),

    confirmDiscovery: (selectedIds) =>
      execute(async () => {
        if (!draft) throw new Error('没有等待确认的扫描结果');
        if (queueIsActive(queue)) throw new Error('已有批量任务正在执行');
        const selected = new Set(selectedIds.slice(0, MAX_DISCOVERED_REPORTS));
        const items = draft.items
          .filter((item) => selected.has(item.id))
          .map<StoredBatchTask>((item) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            status: 'queued',
          }));
        if (!items.length) throw new Error('请至少选择一份研报');
        const timestamp = now();
        queue = {
          version: 1,
          status: 'running',
          currentIndex: 0,
          items,
          retiredDocumentIds: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        draft = undefined;
        await Promise.all([saveDraft(), saveQueue()]);
        await navigateCurrent();
        return publicState(draft, queue);
      }),

    pause: () => {
      requestControl('pause');
      return execute(async () => {
        try {
          if (!queue || queue.status !== 'running') return publicState(draft, queue);
          if (queue.currentIndex >= queue.items.length) {
            const alarmName = takeTimeoutAlarm();
            queue.status = 'completed';
            await saveQueue();
            await clearAlarm(alarmName);
          } else {
            queue.status = 'pausing';
            queue.pauseReason = '当前研报完成后暂停';
            await saveQueue();
          }
          return publicState(draft, queue);
        } finally {
          clearControl('pause');
        }
      });
    },

    resume: () =>
      execute(async () => {
        if (!queue || queue.status !== 'paused') return publicState(draft, queue);
        const current = queue.items[queue.currentIndex];
        if (!current) {
          queue.status = 'completed';
          delete queue.pauseReason;
          await saveQueue();
          return publicState(draft, queue);
        }
        if (
          current.documentId &&
          ['opening', 'observing', 'waiting-ready', 'extracting', 'saving'].includes(current.status)
        ) {
          queue.status = 'running';
          delete queue.pauseReason;
          await saveQueue();
          await armTimeout();
        } else {
          current.status = 'queued';
          await navigateCurrent();
        }
        return publicState(draft, queue);
      }),

    cancel: () => {
      requestControl('cancel');
      return execute(async () => {
        try {
          if (!queue) return publicState(draft, queue);
          if (queue.status === 'completed' || queue.status === 'cancelled') {
            return publicState(draft, queue);
          }
          queue.status = 'cancelled';
          delete queue.pauseReason;
          for (const item of queue.items) {
            delete item.url;
            delete item.documentId;
            delete item.navigationToken;
            if (!terminalSuccess(item.status as PageStatusCode)) item.status = 'cancelled';
          }
          const alarmName = takeTimeoutAlarm();
          const workTabId = queue.workTabId;
          delete queue.workTabId;
          await saveQueue();
          await clearAlarm(alarmName);
          if (workTabId !== undefined) {
            await dependencies.tabs.remove(workTabId).catch(() => {});
          }
          return publicState(draft, queue);
        } finally {
          clearControl('cancel');
        }
      });
    },

    handlePageStatus: (tabId, documentId, navigationToken, status) =>
      execute(async () => {
        if (
          !queue ||
          queue.workTabId !== tabId ||
          queue.status === 'completed' ||
          queue.status === 'cancelled' ||
          !documentId ||
          queue.retiredDocumentIds.includes(documentId)
        ) {
          return publicState(draft, queue);
        }
        const current = queue.items[queue.currentIndex];
        if (!current) return publicState(draft, queue);
        if (!navigationToken || navigationToken !== current.navigationToken) {
          return publicState(draft, queue);
        }
        if (current.documentId && current.documentId !== documentId) {
          return publicState(draft, queue);
        }
        current.documentId ||= documentId;
        current.message = safeMessage(status.message);

        if (workingStatus(status.code)) {
          current.status = status.code;
          await saveQueue();
          if (queue.status !== 'paused') await armTimeout();
          return publicState(draft, queue);
        }

        if (terminalSuccess(status.code)) {
          const stayPaused =
            queue.status === 'paused' || queue.status === 'pausing' || pendingControl !== undefined;
          const alarmName = takeTimeoutAlarm();
          current.status = status.code;

          if (status.code === 'partial') {
            queue.status = 'paused';
            queue.pauseReason = '当前研报仅部分保存，请检查后继续';
            await saveQueue();
            await clearAlarm(alarmName);
            return publicState(draft, queue);
          }

          delete current.url;
          delete current.navigationToken;
          retireDocument(queue, current.documentId);
          queue.currentIndex += 1;
          if (queue.currentIndex >= queue.items.length) {
            queue.status = 'completed';
            delete queue.pauseReason;
            await saveQueue();
            await clearAlarm(alarmName);
          } else if (stayPaused) {
            queue.status = 'paused';
            queue.pauseReason = pendingControl
              ? pendingControl === 'cancel'
                ? '正在结束批量任务'
                : '批量任务已暂停'
              : queue.pauseReason === '当前研报完成后暂停'
                ? '批量任务已暂停'
                : '当前研报已完成，批量任务仍保持暂停';
            await saveQueue();
            await clearAlarm(alarmName);
          } else {
            await saveQueue();
            await clearAlarm(alarmName);
            await sleep(BATCH_NAVIGATION_INTERVAL_MS);
            await navigateCurrent();
          }
          return publicState(draft, queue);
        }

        if (['needs-action', 'failed', 'disabled', 'unsupported'].includes(status.code)) {
          await pauseFor(
            status.message,
            status.code === 'failed' ? 'failed' : 'needs-action',
          );
        }
        return publicState(draft, queue);
      }),

    handleWorkTabClosed: (tabId) =>
      execute(async () => {
        if (!queue || queue.workTabId !== tabId) return publicState(draft, queue);
        if (queue.status === 'completed' || queue.status === 'cancelled') {
          delete queue.workTabId;
          await saveQueue();
          return publicState(draft, queue);
        }
        const current = queue.items[queue.currentIndex];
        if (current) {
          retireDocument(queue, current.documentId);
          delete current.documentId;
          delete current.navigationToken;
          if (!terminalSuccess(current.status as PageStatusCode)) current.status = 'queued';
        }
        delete queue.workTabId;
        await pauseFor('工作标签页已关闭，请确认后继续', 'queued');
        return publicState(draft, queue);
      }),

    handleTimeout: (alarmName) =>
      execute(async () => {
        if (
          queue &&
          alarmName === queue.timeoutAlarmName &&
          (queue.status === 'running' || queue.status === 'pausing')
        ) {
          await pauseFor('页面在 60 秒内没有完成，请人工检查');
        }
        return publicState(draft, queue);
      }),
  };
}
