import type { BatchStoragePort } from './batch-queue';

export const MARKETS_TODAY_RUN_KEY_PREFIX =
  'fin_report_clipper_markets_today_run';
export const MARKETS_TODAY_RUN_TTL_MS = 10 * 60 * 1000;

type MarketsTodayRunPhase = 'claimed' | 'search-issued' | 'drafted' | 'stopped';

interface StoredMarketsTodayRun {
  version: 1;
  runId: string;
  tabId: number;
  clickDocumentId: string;
  latestDocumentId: string;
  phase: MarketsTodayRunPhase;
  startedAt: number;
  expiresAt: number;
}

export type MarketsTodayRunClaim =
  | { action: 'start' | 'resume'; runId: string }
  | { action: 'wait' | 'skip'; reason: string };

export interface MarketsTodayRunService {
  claim(input: {
    tabId: number;
    documentId: string;
    isTodayResultsPage: boolean;
  }): Promise<MarketsTodayRunClaim>;
  issueSearch(input: {
    tabId: number;
    documentId: string;
    runId: string;
  }): Promise<void>;
  stop(input: {
    tabId: number;
    documentId: string;
    runId: string;
  }): Promise<void>;
  stageDraft<T>(
    input: { tabId: number; documentId: string; runId: string },
    stage: () => Promise<T>,
  ): Promise<T>;
  clearTab(tabId: number): Promise<void>;
}

function storageKey(tabId: number): string {
  return `${MARKETS_TODAY_RUN_KEY_PREFIX}:${tabId}`;
}

function isOpaqueId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 200 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function normalizeRun(value: unknown, tabId: number): StoredMarketsTodayRun | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const run = value as Partial<StoredMarketsTodayRun>;
  if (
    run.version !== 1 ||
    run.tabId !== tabId ||
    !isOpaqueId(run.runId) ||
    !isOpaqueId(run.clickDocumentId) ||
    !isOpaqueId(run.latestDocumentId) ||
    !['claimed', 'search-issued', 'drafted', 'stopped'].includes(run.phase || '') ||
    typeof run.startedAt !== 'number' ||
    !Number.isFinite(run.startedAt) ||
    typeof run.expiresAt !== 'number' ||
    !Number.isFinite(run.expiresAt) ||
    run.expiresAt <= run.startedAt
  ) {
    return undefined;
  }
  return run as StoredMarketsTodayRun;
}

export function createMarketsTodayRunService(dependencies: {
  session: BatchStoragePort;
  now?: () => number;
  makeRunId?: () => string;
  ttlMs?: number;
}): MarketsTodayRunService {
  const now = dependencies.now || Date.now;
  const makeRunId = dependencies.makeRunId || (() => crypto.randomUUID());
  const ttlMs = dependencies.ttlMs ?? MARKETS_TODAY_RUN_TTL_MS;
  let serial: Promise<void> = Promise.resolve();

  const execute = <T>(operation: () => Promise<T>): Promise<T> => {
    const task = serial.then(operation);
    serial = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };

  const read = async (tabId: number) => {
    const key = storageKey(tabId);
    const stored = await dependencies.session.get(key);
    return normalizeRun(stored[key], tabId);
  };

  const save = (run: StoredMarketsTodayRun) =>
    dependencies.session.set({ [storageKey(run.tabId)]: run });

  return {
    claim: (input) =>
      execute(async () => {
        const timestamp = now();
        let run = await read(input.tabId);
        if (run && run.expiresAt <= timestamp) {
          if (run.phase === 'claimed' || run.phase === 'search-issued') {
            run.phase = 'stopped';
            await save(run);
          }
          return {
            action: 'skip',
            reason: '当前标签页的 Today 自动化已经超时停止',
          } satisfies MarketsTodayRunClaim;
        }

        if (!run) {
          const runId = makeRunId();
          if (!isOpaqueId(runId)) throw new Error('Unable to create a Markets Today run');
          run = {
            version: 1,
            runId,
            tabId: input.tabId,
            clickDocumentId: input.documentId,
            latestDocumentId: input.documentId,
            phase: 'claimed',
            startedAt: timestamp,
            expiresAt: timestamp + ttlMs,
          };
          await save(run);
          return { action: 'start', runId } satisfies MarketsTodayRunClaim;
        }

        if (run.phase === 'drafted') {
          return {
            action: 'skip',
            reason: '当前标签页的 Today 草稿已经创建',
          } satisfies MarketsTodayRunClaim;
        }
        if (run.phase === 'stopped') {
          return {
            action: 'skip',
            reason: '当前标签页的 Today 自动化已经停止',
          } satisfies MarketsTodayRunClaim;
        }
        if (run.latestDocumentId === input.documentId) {
          return {
            action: 'wait',
            reason:
              run.phase === 'claimed'
                ? '当前文档正在准备 Today 搜索'
                : '当前文档已经提交过 Today 搜索',
          } satisfies MarketsTodayRunClaim;
        }
        if (run.phase !== 'search-issued') {
          run.phase = 'stopped';
          await save(run);
          return {
            action: 'skip',
            reason: '页面在 Search 获得执行许可前已经变化',
          } satisfies MarketsTodayRunClaim;
        }
        if (!input.isTodayResultsPage) {
          run.phase = 'stopped';
          await save(run);
          return {
            action: 'skip',
            reason: '搜索后的新页面缺少结果查询标记',
          } satisfies MarketsTodayRunClaim;
        }

        run.latestDocumentId = input.documentId;
        await save(run);
        return { action: 'resume', runId: run.runId } satisfies MarketsTodayRunClaim;
      }),

    issueSearch: (input) =>
      execute(async () => {
        const run = await read(input.tabId);
        if (
          !run ||
          run.expiresAt <= now() ||
          run.phase !== 'claimed' ||
          run.runId !== input.runId ||
          run.clickDocumentId !== input.documentId ||
          run.latestDocumentId !== input.documentId
        ) {
          throw new Error('Today 搜索执行许可已经失效');
        }
        run.phase = 'search-issued';
        await save(run);
      }),

    stop: (input) =>
      execute(async () => {
        const run = await read(input.tabId);
        if (
          !run ||
          run.runId !== input.runId ||
          run.latestDocumentId !== input.documentId ||
          run.phase === 'drafted'
        ) {
          return;
        }
        run.phase = 'stopped';
        await save(run);
      }),

    stageDraft: (input, stage) =>
      execute(async () => {
        const run = await read(input.tabId);
        if (
          !run ||
          run.expiresAt <= now() ||
          run.phase !== 'search-issued' ||
          run.runId !== input.runId ||
          run.latestDocumentId !== input.documentId
        ) {
          throw new Error('Today 搜索事务已经失效');
        }
        try {
          const result = await stage();
          run.phase = 'drafted';
          await save(run);
          return result;
        } catch (error) {
          run.phase = 'stopped';
          await save(run);
          throw error;
        }
      }),

    clearTab: (tabId) =>
      execute(() => dependencies.session.remove(storageKey(tabId))),
  };
}
