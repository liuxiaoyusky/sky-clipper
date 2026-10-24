import { describe, expect, it, vi } from 'vitest';
import type { BatchStoragePort } from '@/utils/research/batch-queue';
import {
  MARKETS_TODAY_RUN_KEY_PREFIX,
  createMarketsTodayRunService,
} from '@/utils/research/markets-today-run';

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

function harness() {
  const session = memoryStorage();
  let timestamp = 1_000;
  let token = 0;
  const service = createMarketsTodayRunService({
    session,
    now: () => timestamp,
    makeRunId: () => `markets-run-${String(++token).padStart(8, '0')}`,
    ttlMs: 600,
  });
  return {
    service,
    session,
    advance(milliseconds: number) {
      timestamp += milliseconds;
    },
  };
}

describe('Markets Today run state', () => {
  it('authorizes only one Search for concurrent claims in one document', async () => {
    const test = harness();
    const claims = await Promise.all([
      test.service.claim({
        tabId: 11,
        documentId: 'document-0001',
        isTodayResultsPage: false,
      }),
      test.service.claim({
        tabId: 11,
        documentId: 'document-0001',
        isTodayResultsPage: false,
      }),
    ]);

    expect(claims.filter((claim) => claim.action === 'start')).toHaveLength(1);
    expect(claims.filter((claim) => claim.action === 'wait')).toHaveLength(1);
  });

  it('resumes a query reload in the same tab without authorizing another Search', async () => {
    const test = harness();
    const started = await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });
    if (started.action !== 'start') throw new Error('expected start');
    await test.service.issueSearch({
      tabId: 11,
      documentId: 'document-0001',
      runId: started.runId,
    });
    const resumed = await test.service.claim({
      tabId: 11,
      documentId: 'document-0002',
      isTodayResultsPage: true,
    });
    const duplicate = await test.service.claim({
      tabId: 11,
      documentId: 'document-0002',
      isTodayResultsPage: true,
    });

    expect(resumed).toEqual({ action: 'resume', runId: started.runId });
    expect(duplicate.action).toBe('wait');
  });

  it('keeps resuming across repeated result reloads and accepts only the latest document', async () => {
    const test = harness();
    const started = await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });
    if (started.action !== 'start') throw new Error('expected start');
    await test.service.issueSearch({
      tabId: 11,
      documentId: 'document-0001',
      runId: started.runId,
    });
    const second = await test.service.claim({
      tabId: 11,
      documentId: 'document-0002',
      isTodayResultsPage: true,
    });
    const third = await test.service.claim({
      tabId: 11,
      documentId: 'document-0003',
      isTodayResultsPage: true,
    });
    const stage = vi.fn(async () => 'latest');

    expect(second.action).toBe('resume');
    expect(third.action).toBe('resume');
    await expect(
      test.service.stageDraft(
        {
          tabId: 11,
          documentId: 'document-0002',
          runId: started.runId,
        },
        stage,
      ),
    ).rejects.toThrow('事务已经失效');
    await expect(
      test.service.stageDraft(
        {
          tabId: 11,
          documentId: 'document-0003',
          runId: started.runId,
        },
        stage,
      ),
    ).resolves.toBe('latest');
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the document changes before Search is issued', async () => {
    const test = harness();
    await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });

    await expect(
      test.service.claim({
        tabId: 11,
        documentId: 'document-0002',
        isTodayResultsPage: false,
      }),
    ).resolves.toMatchObject({ action: 'skip' });
    await expect(
      test.service.claim({
        tabId: 11,
        documentId: 'document-0003',
        isTodayResultsPage: true,
      }),
    ).resolves.toMatchObject({ action: 'skip' });
  });

  it('fails closed when an issued Search lands outside a Today results URL', async () => {
    const test = harness();
    const started = await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });
    if (started.action !== 'start') throw new Error('expected start');
    await test.service.issueSearch({
      tabId: 11,
      documentId: 'document-0001',
      runId: started.runId,
    });

    await expect(
      test.service.claim({
        tabId: 11,
        documentId: 'document-0002',
        isTodayResultsPage: false,
      }),
    ).resolves.toMatchObject({ action: 'skip' });
  });

  it('stages once for the active run and rejects stale documents or duplicate drafts', async () => {
    const test = harness();
    const started = await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });
    if (started.action !== 'start') throw new Error('expected start');
    await test.service.issueSearch({
      tabId: 11,
      documentId: 'document-0001',
      runId: started.runId,
    });
    await test.service.claim({
      tabId: 11,
      documentId: 'document-0002',
      isTodayResultsPage: true,
    });
    const stage = vi.fn(async () => 'staged');

    await expect(
      test.service.stageDraft(
        {
          tabId: 11,
          documentId: 'document-0001',
          runId: started.runId,
        },
        stage,
      ),
    ).rejects.toThrow('事务已经失效');
    await expect(
      test.service.stageDraft(
        {
          tabId: 11,
          documentId: 'document-0002',
          runId: started.runId,
        },
        stage,
      ),
    ).resolves.toBe('staged');
    await expect(
      test.service.stageDraft(
        {
          tabId: 11,
          documentId: 'document-0002',
          runId: started.runId,
        },
        stage,
      ),
    ).rejects.toThrow('事务已经失效');
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit issue transition and stops failed runs', async () => {
    const test = harness();
    const started = await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });
    if (started.action !== 'start') throw new Error('expected start');

    await test.service.stop({
      tabId: 11,
      documentId: 'document-0001',
      runId: started.runId,
    });
    await expect(
      test.service.issueSearch({
        tabId: 11,
        documentId: 'document-0001',
        runId: started.runId,
      }),
    ).rejects.toThrow('执行许可已经失效');
    await expect(
      test.service.claim({
        tabId: 11,
        documentId: 'document-0002',
        isTodayResultsPage: true,
      }),
    ).resolves.toMatchObject({ action: 'skip' });
  });

  it('isolates tabs and stops an expired run without restarting the same tab', async () => {
    const test = harness();
    const first = await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });
    const otherTab = await test.service.claim({
      tabId: 12,
      documentId: 'document-0002',
      isTodayResultsPage: false,
    });
    test.advance(601);
    const expired = await test.service.claim({
      tabId: 11,
      documentId: 'document-0003',
      isTodayResultsPage: false,
    });

    expect(first.action).toBe('start');
    expect(otherTab.action).toBe('start');
    expect(expired.action).toBe('skip');
    expect(Object.keys(test.session.data)).toEqual(
      expect.arrayContaining([
        `${MARKETS_TODAY_RUN_KEY_PREFIX}:11`,
        `${MARKETS_TODAY_RUN_KEY_PREFIX}:12`,
      ]),
    );
    expect(JSON.stringify(test.session.data)).not.toMatch(/https?:|[?&=]|@|title|link/i);
  });

  it('marks the run stopped when draft staging fails', async () => {
    const test = harness();
    const started = await test.service.claim({
      tabId: 11,
      documentId: 'document-0001',
      isTodayResultsPage: false,
    });
    if (started.action !== 'start') throw new Error('expected start');
    await test.service.issueSearch({
      tabId: 11,
      documentId: 'document-0001',
      runId: started.runId,
    });

    await expect(
      test.service.stageDraft(
        {
          tabId: 11,
          documentId: 'document-0001',
          runId: started.runId,
        },
        async () => {
          throw new Error('stage failed');
        },
      ),
    ).rejects.toThrow('stage failed');
    await expect(
      test.service.claim({
        tabId: 11,
        documentId: 'document-0002',
        isTodayResultsPage: true,
      }),
    ).resolves.toMatchObject({ action: 'skip' });
  });
});
