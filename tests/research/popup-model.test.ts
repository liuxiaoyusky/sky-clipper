import { describe, expect, it } from 'vitest';
import {
  createBatchStatePoller,
  createPageStatusPoller,
  createSettingsSaveQueue,
  readPageStatus,
  requestBatchUiState,
} from '@/entrypoints/popup/model';
import type { BatchUiState } from '@/utils/research/batch-queue';
import type { ResearchSettings } from '@/utils/research/settings';
import type { PageStatus } from '@/utils/research/types';

const initialSettings: ResearchSettings = {
  autoCapture: true,
  socialAutoCapture: true,
  providers: { bofa: true, x: true, wechat: true, bilibili: true },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await Promise.resolve();
    }
  }
  assertion();
}

describe('popup reliability model', () => {
  it('reads safe batch state and surfaces background command errors', async () => {
    const state: BatchUiState = {
      queue: {
        status: 'running',
        currentIndex: 0,
        total: 1,
        currentTitle: 'Safe report title',
        counts: { saved: 0, duplicate: 0, partial: 0, failed: 0, remaining: 1 },
        items: [{ id: 'report-1', title: 'Safe report title', status: 'opening' }],
      },
    };
    const request = {
      target: 'background' as const,
      type: 'FIN_REPORT_CLIPPER_BATCH_GET_STATE' as const,
    };

    await expect(requestBatchUiState(request, async () => ({ ok: true, state }))).resolves.toBe(
      state,
    );
    await expect(
      requestBatchUiState(request, async () => ({ ok: false, reason: '队列不可用' })),
    ).rejects.toThrow('队列不可用');
  });

  it('stops the batch poller without publishing a late popup result', async () => {
    const pending = deferred<BatchUiState>();
    const published: BatchUiState[] = [];
    const errors: string[] = [];
    const poller = createBatchStatePoller({
      read: () => pending.promise,
      publish: (state) => published.push(state),
      onError: (message) => errors.push(message),
      schedule: () => 1,
      cancel: () => {},
    });

    poller.start();
    poller.stop();
    pending.resolve({
      queue: {
        status: 'completed',
        currentIndex: 1,
        total: 1,
        counts: { saved: 1, duplicate: 0, partial: 0, failed: 0, remaining: 0 },
        items: [{ id: 'report-1', title: 'Report', status: 'saved' }],
      },
    });
    await Promise.resolve();

    expect(published).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('serializes rapid settings patches against the latest committed settings', async () => {
    const writes: ResearchSettings[] = [];
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const releases = [firstWrite, secondWrite];
    const queue = createSettingsSaveQueue(initialSettings, async (next) => {
      writes.push(next);
      await releases[writes.length - 1].promise;
    });

    const first = queue.patch((settings) => ({ ...settings, autoCapture: false }));
    const second = queue.patch((settings) => ({
      ...settings,
      providers: { ...settings.providers, bofa: false },
    }));

    await eventually(() => expect(writes).toEqual([{ ...initialSettings, autoCapture: false }]));
    firstWrite.resolve();
    await eventually(() =>
      expect(writes).toEqual([
        { ...initialSettings, autoCapture: false },
        { autoCapture: false, socialAutoCapture: true, providers: { bofa: false, x: true, wechat: true, bilibili: true } },
      ]),
    );
    secondWrite.resolve();
    await Promise.all([first, second]);

    expect(queue.getState()).toMatchObject({
      settings: { autoCapture: false, socialAutoCapture: true, providers: { bofa: false, x: true, wechat: true, bilibili: true } },
      saving: false,
    });
    expect(queue.getState().error).toBeUndefined();
  });

  it('rolls back a rejected patch to the last persisted settings and exposes an error', async () => {
    const queue = createSettingsSaveQueue(initialSettings, async () => {
      throw new Error('storage unavailable');
    });

    await queue.patch((settings) => ({ ...settings, autoCapture: false }));

    expect(queue.getState()).toEqual({
      settings: initialSettings,
      saving: false,
      error: '无法保存设置，请重试',
    });
  });

  it('distinguishes unsupported pages, unavailable BofA content, and tab-query failure', async () => {
    await expect(
      readPageStatus({
        queryActiveTab: async () => [{ id: 1, url: 'https://example.com/report' }],
        sendToTab: async () => {
          throw new Error('must not send');
        },
      }),
    ).resolves.toMatchObject({ code: 'unsupported' });

    await expect(
      readPageStatus({
        queryActiveTab: async () => [{ id: 1, url: 'https://rsch.baml.com/r?q=secret' }],
        sendToTab: async () => {
          throw new Error('receiving end does not exist');
        },
      }),
    ).resolves.toEqual({
      code: 'needs-action',
      message: '无法连接当前原文页面，请刷新当前页面后重试',
      updatedAt: expect.any(String),
    });

    await expect(
      readPageStatus({
        queryActiveTab: async () => {
          throw new Error('tabs unavailable');
        },
        sendToTab: async () => ({ ok: true, status: {} as PageStatus }),
      }),
    ).resolves.toEqual({
      code: 'needs-action',
      message: '无法读取当前标签页，请关闭弹窗后重试',
      updatedAt: expect.any(String),
    });
  });

  it('uses one in-flight status request and suppresses stale or stopped results', async () => {
    const first = deferred<PageStatus>();
    const second = deferred<PageStatus>();
    const reads = [first, second];
    const published: PageStatus[] = [];
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const poller = createPageStatusPoller({
      read: () => reads.shift()!.promise,
      publish: (status) => published.push(status),
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      cancel: () => {},
    });

    poller.start();
    poller.refresh();
    poller.invalidate();
    first.resolve({ code: 'saved', message: 'old', updatedAt: '2026-07-18T00:00:00Z' });
    await eventually(() => expect(scheduled).toEqual([{ callback: expect.any(Function), delay: 0 }]));
    expect(published).toEqual([]);

    scheduled[0].callback();
    poller.stop();
    second.resolve({ code: 'saved', message: 'late', updatedAt: '2026-07-18T00:00:01Z' });
    await Promise.resolve();
    expect(published).toEqual([]);
  });
});
