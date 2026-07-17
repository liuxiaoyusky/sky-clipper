import { describe, expect, it } from 'vitest';
import {
  createPageStatusPoller,
  createSettingsSaveQueue,
  readPageStatus,
} from '@/entrypoints/popup/model';
import type { ResearchSettings } from '@/utils/research/settings';
import type { PageStatus } from '@/utils/research/types';

const initialSettings: ResearchSettings = {
  autoCapture: true,
  providers: { bofa: true },
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
        { autoCapture: false, providers: { bofa: false } },
      ]),
    );
    secondWrite.resolve();
    await Promise.all([first, second]);

    expect(queue.getState()).toMatchObject({
      settings: { autoCapture: false, providers: { bofa: false } },
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
      message: '无法连接当前 BofA 研报页面，请刷新当前页面后重试',
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
