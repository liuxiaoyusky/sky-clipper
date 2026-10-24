import { describe, expect, it } from 'vitest';
import {
  BATCH_QUEUE_KEY,
  BATCH_NAVIGATION_INTERVAL_MS,
  BATCH_TIMEOUT_ALARM_PREFIX,
  createBatchQueueService,
  readBatchNavigationToken,
  type BatchAlarmPort,
  type BatchStoragePort,
  type BatchTabPort,
} from '@/utils/research/batch-queue';
import type { DiscoveredReportLink } from '@/utils/research/entry-discovery';
import type { PageStatus } from '@/utils/research/types';

function memoryStorage(): BatchStoragePort & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key) {
      return { [key]: data[key] };
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(key) {
      delete data[key];
    },
  };
}

function harness(options: { sleep?: (milliseconds: number) => Promise<void> } = {}) {
  const session = memoryStorage();
  const created: string[] = [];
  const updated: Array<{ tabId: number; url: string }> = [];
  const removed: number[] = [];
  const existingTabs = new Set<number>();
  let nextTabId = 41;
  let nextToken = 0;
  const tabs: BatchTabPort = {
    async create(properties) {
      created.push(properties.url);
      const id = nextTabId++;
      existingTabs.add(id);
      return { id };
    },
    async update(tabId, properties) {
      if (!existingTabs.has(tabId)) throw new Error('missing tab');
      updated.push({ tabId, url: properties.url });
    },
    async get(tabId) {
      if (!existingTabs.has(tabId)) throw new Error('missing tab');
      return { id: tabId };
    },
    async remove(tabId) {
      removed.push(tabId);
      existingTabs.delete(tabId);
    },
  };
  const createdAlarms: string[] = [];
  const clearedAlarms: string[] = [];
  const navigationDelays: number[] = [];
  const alarms: BatchAlarmPort = {
    async create(name) {
      createdAlarms.push(name);
    },
    async clear(name) {
      clearedAlarms.push(name);
      return true;
    },
  };
  const service = createBatchQueueService({
    session,
    tabs,
    alarms,
    now: () => '2026-07-21T05:00:00.000Z',
    makeToken: () => `batch-token-${String(++nextToken).padStart(8, '0')}`,
    sleep: async (milliseconds) => {
      navigationDelays.push(milliseconds);
      await options.sleep?.(milliseconds);
    },
  });
  return {
    alarms,
    clearedAlarms,
    created,
    createdAlarms,
    existingTabs,
    navigationDelays,
    service,
    session,
    tabs,
    updated,
    removed,
  };
}

function currentNavigationToken(test: ReturnType<typeof harness>): string {
  const stored = test.session.data[BATCH_QUEUE_KEY] as {
    currentIndex: number;
    items: Array<{ navigationToken?: string }>;
  };
  const token = stored.items[stored.currentIndex]?.navigationToken;
  if (!token) throw new Error('expected current navigation token');
  return token;
}

function currentAlarmName(test: ReturnType<typeof harness>): string {
  const stored = test.session.data[BATCH_QUEUE_KEY] as { timeoutAlarmName?: string };
  if (!stored.timeoutAlarmName) throw new Error('expected current timeout alarm');
  return stored.timeoutAlarmName;
}

const links: DiscoveredReportLink[] = [
  {
    id: 'report-1',
    title: 'First report',
    url: 'https://rsch.baml.com/r?q=first&e=reader%40example.com&h=secret-one',
  },
  {
    id: 'report-2',
    title: 'Second report',
    url: 'https://rsch.baml.com/r?q=second&e=reader%40example.com&h=secret-two',
  },
];

function pageStatus(code: PageStatus['code'], message: string = code): PageStatus {
  return { code, message, updatedAt: '2026-07-21T05:00:01.000Z' };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('persistent conservative batch queue', () => {
  it('stages a safe draft and opens nothing until the user confirms', async () => {
    const test = harness();

    const staged = await test.service.stageDiscovery(links, false);

    expect(test.created).toEqual([]);
    expect(staged.draft?.items).toEqual([
      { id: 'report-1', title: 'First report' },
      { id: 'report-2', title: 'Second report' },
    ]);
    expect(JSON.stringify(staged)).not.toMatch(/q=|reader|secret/);
  });

  it('uses one work tab, advances only on terminal capture results, and deletes completed URLs', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);

    const started = await test.service.confirmDiscovery(['report-1', 'report-2']);

    expect(started.queue.status).toBe('running');
    expect(test.created).toHaveLength(1);
    expect(new URL(test.created[0]).search).toBe(new URL(links[0].url).search);
    expect(readBatchNavigationToken(new URL(test.created[0]).hash)).toBe(
      currentNavigationToken(test),
    );
    expect(test.createdAlarms[0]).toMatch(
      new RegExp(`^${BATCH_TIMEOUT_ALARM_PREFIX}:`),
    );

    const firstToken = currentNavigationToken(test);
    await test.service.handlePageStatus(41, 'document-1', firstToken, pageStatus('saving'));
    expect(test.updated).toEqual([]);
    expect(test.removed).toEqual([]);

    await test.service.handlePageStatus(41, 'document-1', firstToken, pageStatus('saved'));
    expect(test.created).toHaveLength(1);
    expect(test.updated).toHaveLength(1);
    expect(test.navigationDelays).toEqual([BATCH_NAVIGATION_INTERVAL_MS]);
    expect(test.updated[0].tabId).toBe(41);
    expect(new URL(test.updated[0].url).search).toBe(new URL(links[1].url).search);

    const storedAfterFirst = test.session.data[BATCH_QUEUE_KEY] as {
      items: Array<{ url?: string }>;
    };
    expect(storedAfterFirst.items[0].url).toBeUndefined();
    expect(storedAfterFirst.items[1].url).toBe(links[1].url);

    const late = await test.service.handlePageStatus(
      41,
      'document-1',
      firstToken,
      pageStatus('duplicate'),
    );
    expect(late.queue.currentIndex).toBe(1);

    const secondToken = currentNavigationToken(test);
    const completed = await test.service.handlePageStatus(
      41,
      'document-2',
      secondToken,
      pageStatus('duplicate'),
    );
    expect(completed.queue.status).toBe('completed');
    expect(completed.queue.counts).toMatchObject({ saved: 1, duplicate: 1, remaining: 0 });
    expect(JSON.stringify(completed)).not.toMatch(/q=|reader|secret/);
    const storedCompleted = test.session.data[BATCH_QUEUE_KEY] as {
      items: Array<{ url?: string }>;
    };
    expect(storedCompleted.items.every((item) => item.url === undefined)).toBe(true);
  });

  it('waits ten seconds after a success before starting the next report navigation', async () => {
    const delayStarted = deferred<number>();
    const releaseDelay = deferred();
    const test = harness({
      sleep: async (milliseconds) => {
        delayStarted.resolve(milliseconds);
        await releaseDelay.promise;
      },
    });
    await test.service.stageDiscovery(links, false);
    await test.service.confirmDiscovery(links.map((link) => link.id));

    const advancing = test.service.handlePageStatus(
      41,
      'document-1',
      currentNavigationToken(test),
      pageStatus('saved'),
    );

    await expect(delayStarted.promise).resolves.toBe(BATCH_NAVIGATION_INTERVAL_MS);
    expect(test.updated).toEqual([]);
    releaseDelay.resolve();
    await advancing;
    expect(test.updated).toHaveLength(1);
  });

  it('pauses the whole queue for page action, then resumes only by explicit user action', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);
    await test.service.confirmDiscovery(links.map((link) => link.id));

    const paused = await test.service.handlePageStatus(
      41,
      'document-1',
      currentNavigationToken(test),
      pageStatus('needs-action', '页面需要登录、验证或人工处理'),
    );

    expect(paused.queue.status).toBe('paused');
    expect(paused.queue.pauseReason).toBe('页面需要登录、验证或人工处理');
    expect(test.updated).toEqual([]);

    const resumed = await test.service.resume();
    expect(resumed.queue.status).toBe('running');
    expect(test.updated).toHaveLength(1);
    expect(new URL(test.updated[0].url).search).toBe(new URL(links[0].url).search);
  });

  it('keeps a partial capture on the current task and retries it only after explicit resume', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);
    await test.service.confirmDiscovery(links.map((link) => link.id));

    const pausing = await test.service.pause();
    expect(pausing.queue.status).toBe('pausing');

    const paused = await test.service.handlePageStatus(
      41,
      'document-1',
      currentNavigationToken(test),
      pageStatus('partial'),
    );
    expect(paused.queue.status).toBe('paused');
    expect(paused.queue.currentIndex).toBe(0);
    expect(paused.queue.counts).toMatchObject({ partial: 1, remaining: 2 });
    expect(test.updated).toEqual([]);

    await test.service.resume();
    expect(test.updated).toHaveLength(1);
    expect(new URL(test.updated[0].url).search).toBe(new URL(links[0].url).search);
    const stored = test.session.data[BATCH_QUEUE_KEY] as {
      items: Array<{ url?: string }>;
    };
    expect(stored.items[0].url).toBe(links[0].url);
  });

  it('does not let a new scan replace an active or paused queue', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);
    await test.service.confirmDiscovery(links.map((link) => link.id));

    await expect(test.service.stageDiscovery(links, false)).rejects.toThrow(
      '请先完成或结束当前批量任务',
    );

    await test.service.handlePageStatus(
      41,
      'document-1',
      currentNavigationToken(test),
      pageStatus('needs-action', '请人工检查'),
    );
    await expect(test.service.stageDiscovery(links, false)).rejects.toThrow(
      '请先完成或结束当前批量任务',
    );
  });

  it('keeps an exceptional pause when the current page reports a late success', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);
    await test.service.confirmDiscovery(links.map((link) => link.id));
    const token = currentNavigationToken(test);

    await test.service.handlePageStatus(
      41,
      'document-1',
      token,
      pageStatus('needs-action', '请人工检查'),
    );
    const lateSuccess = await test.service.handlePageStatus(
      41,
      'document-1',
      token,
      pageStatus('saved'),
    );

    expect(lateSuccess.queue).toMatchObject({
      status: 'paused',
      currentIndex: 1,
      pauseReason: '当前研报已完成，批量任务仍保持暂停',
    });
    expect(test.updated).toEqual([]);

    await test.service.resume();
    expect(test.updated).toHaveLength(1);
    expect(new URL(test.updated[0].url).search).toBe(new URL(links[1].url).search);
  });

  it.each(['pause', 'cancel'] as const)(
    'honors a queued %s control before navigating to the next report',
    async (control) => {
      const test = harness();
      await test.service.stageDiscovery(links, false);
      await test.service.confirmDiscovery(links.map((link) => link.id));
      const token = currentNavigationToken(test);
      const enteredSave = deferred();
      const releaseSave = deferred();
      const originalSet = test.session.set;
      let blockNextSave = true;
      test.session.set = async (items) => {
        await originalSet(items);
        if (!blockNextSave) return;
        blockNextSave = false;
        enteredSave.resolve();
        await releaseSave.promise;
      };

      const finishing = test.service.handlePageStatus(
        41,
        'document-1',
        token,
        pageStatus('saved'),
      );
      await enteredSave.promise;
      const controlling = test.service[control]();
      releaseSave.resolve();
      await Promise.all([finishing, controlling]);

      const state = await test.service.getState();
      expect(test.updated).toEqual([]);
      expect(state.queue.status).toBe(control === 'cancel' ? 'cancelled' : 'paused');
      expect(state.queue.currentIndex).toBe(1);
      expect(test.removed).toEqual(control === 'cancel' ? [41] : []);
    },
  );

  it('ignores stale alarms and pages that do not match the current navigation token', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);
    await test.service.confirmDiscovery(links.map((link) => link.id));
    const token = currentNavigationToken(test);
    const firstAlarm = currentAlarmName(test);

    const wrongPage = await test.service.handlePageStatus(
      41,
      'wrong-document',
      'wrong-navigation-token',
      pageStatus('saved'),
    );
    expect(wrongPage.queue.currentIndex).toBe(0);

    await test.service.handlePageStatus(41, 'document-1', token, pageStatus('saving'));
    const secondAlarm = currentAlarmName(test);
    expect(secondAlarm).not.toBe(firstAlarm);

    const wrongDocument = await test.service.handlePageStatus(
      41,
      'wrong-document',
      token,
      pageStatus('saved'),
    );
    expect(wrongDocument.queue.currentIndex).toBe(0);

    const afterStaleAlarm = await test.service.handleTimeout(firstAlarm);
    expect(afterStaleAlarm.queue.status).toBe('running');
    const afterCurrentAlarm = await test.service.handleTimeout(secondAlarm);
    expect(afterCurrentAlarm.queue.status).toBe('paused');
  });

  it('pauses safely when the work tab closes or its alarm expires', async () => {
    const closed = harness();
    await closed.service.stageDiscovery(links, false);
    await closed.service.confirmDiscovery(links.map((link) => link.id));

    const afterClose = await closed.service.handleWorkTabClosed(41);
    expect(afterClose.queue).toMatchObject({
      status: 'paused',
      pauseReason: '工作标签页已关闭，请确认后继续',
    });

    const timedOut = harness();
    await timedOut.service.stageDiscovery(links, false);
    await timedOut.service.confirmDiscovery(links.map((link) => link.id));
    const afterTimeout = await timedOut.service.handleTimeout(currentAlarmName(timedOut));
    expect(afterTimeout.queue).toMatchObject({
      status: 'paused',
      pauseReason: '页面在 60 秒内没有完成，请人工检查',
    });
  });

  it('cancels without navigating again and removes every remaining signed URL', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);
    await test.service.confirmDiscovery(links.map((link) => link.id));

    const cancelled = await test.service.cancel();

    expect(cancelled.queue.status).toBe('cancelled');
    const stored = test.session.data[BATCH_QUEUE_KEY] as { items: Array<{ url?: string }> };
    expect(stored.items.every((item) => item.url === undefined)).toBe(true);
    expect(test.updated).toEqual([]);
    expect(test.removed).toEqual([41]);
    expect(test.clearedAlarms.some((name) => name.startsWith(BATCH_TIMEOUT_ALARM_PREFIX))).toBe(
      true,
    );
  });

  it('does not move completed or cancelled queues backwards when their work tab closes', async () => {
    const completed = harness();
    await completed.service.stageDiscovery([links[0]], false);
    await completed.service.confirmDiscovery([links[0].id]);
    await completed.service.handlePageStatus(
      41,
      'document-1',
      currentNavigationToken(completed),
      pageStatus('saved'),
    );
    expect((await completed.service.handleWorkTabClosed(41)).queue.status).toBe('completed');

    const cancelled = harness();
    await cancelled.service.stageDiscovery(links, false);
    await cancelled.service.confirmDiscovery(links.map((link) => link.id));
    await cancelled.service.cancel();
    const afterClose = await cancelled.service.handleWorkTabClosed(41);
    expect(afterClose.queue.status).toBe('cancelled');
    expect(afterClose.queue.counts.remaining).toBe(0);
  });

  it('restores a session draft and queue in a new service instance without exposing URLs', async () => {
    const test = harness();
    await test.service.stageDiscovery(links, false);

    const restoredDraft = createBatchQueueService({
      session: test.session,
      tabs: test.tabs,
      alarms: test.alarms,
      now: () => '2026-07-21T05:00:00.000Z',
      makeToken: () => 'restored-batch-token-0001',
    });
    const draftState = await restoredDraft.getState();
    expect(draftState.draft?.items).toHaveLength(2);
    expect(JSON.stringify(draftState)).not.toMatch(/reader|secret/);

    await restoredDraft.confirmDiscovery(links.map((link) => link.id));
    const restoredQueue = createBatchQueueService({
      session: test.session,
      tabs: test.tabs,
      alarms: test.alarms,
      now: () => '2026-07-21T05:00:00.000Z',
      makeToken: () => 'restored-batch-token-0002',
    });
    const queueState = await restoredQueue.getState();
    expect(queueState.queue).toMatchObject({ status: 'running', currentIndex: 0, total: 2 });
    expect(JSON.stringify(queueState)).not.toMatch(/reader|secret/);
  });
});
