import { describe, expect, it } from 'vitest';
import { createDocumentBatchPageStatusRequest } from '@/utils/research/batch-page-status';
import {
  bofaDomIdentity,
  bofaRunKey,
  createNavigationCaptureScheduler,
} from '@/utils/research/observe';
import type { PageStatus, ReadinessEvidence } from '@/utils/research/types';

const status: PageStatus = {
  code: 'waiting-ready',
  message: '等待研报正文稳定',
  updatedAt: '2026-07-29T12:00:00.000Z',
};

const pendingEvidence: ReadinessEvidence = {
  kind: 'report-html',
  pdfState: 'pending',
  sourceId: '',
  title: 'Report',
  bodyTextLength: 500,
  tableCount: 1,
  tailText: 'fnv1a64:0123456789abcdef',
};

describe('document batch page status', () => {
  it('keeps the document token across settings restarts and report-id run-key changes', () => {
    const token = 'batch-navigation-token-0001';
    const url = `https://rsch.baml.com/report#fin-report-clipper-batch=${token}`;
    const createRequest = createDocumentBatchPageStatusRequest(new URL(url).hash);
    const scheduler = createNavigationCaptureScheduler();
    const pendingIdentity = bofaDomIdentity(url, pendingEvidence);
    const pendingRunKey = bofaRunKey(url);

    const first = scheduler.begin(url, pendingIdentity, pendingRunKey);
    const restarted = scheduler.restart(url, pendingIdentity, pendingRunKey);
    const completeEvidence = {
      ...pendingEvidence,
      pdfState: 'available' as const,
      sourceId: '12995258',
    };
    const completed = scheduler.sync(
      url,
      bofaDomIdentity(url, completeEvidence),
      bofaRunKey(url, completeEvidence.sourceId),
    );

    expect(restarted).toBeDefined();
    expect(completed).toBeDefined();
    expect(new Set([first.generation, restarted?.generation, completed?.generation]).size).toBe(3);
    expect([first, restarted, completed].map(() => createRequest(status).navigationToken)).toEqual([
      token,
      token,
      token,
    ]);
  });

  it('lets a new content-script document derive its own token', () => {
    const first = createDocumentBatchPageStatusRequest(
      '#fin-report-clipper-batch=batch-navigation-token-0001',
    );
    const next = createDocumentBatchPageStatusRequest(
      '#fin-report-clipper-batch=batch-navigation-token-0002',
    );

    expect(first(status).navigationToken).toBe('batch-navigation-token-0001');
    expect(next(status).navigationToken).toBe('batch-navigation-token-0002');
    expect(createDocumentBatchPageStatusRequest('#unrelated=value')(status)).not.toHaveProperty(
      'navigationToken',
    );
  });
});
