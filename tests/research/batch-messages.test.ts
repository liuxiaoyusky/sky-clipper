import { describe, expect, it } from 'vitest';
import {
  isBatchPageStatusRequest,
  isBatchUiRequest,
  isDiscoverCurrentPageRequest,
  isExtensionUiSender,
} from '@/utils/research/messages';

describe('batch message boundaries', () => {
  it('accepts only strict extension-UI commands and never accepts a navigation URL', () => {
    expect(
      isBatchUiRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY',
        selectedIds: ['bofa-report-1', 'bofa-report-2'],
      }),
    ).toBe(true);
    expect(
      isBatchUiRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY',
        selectedIds: ['bofa-report-1'],
        url: 'https://rsch.baml.com/r?q=secret',
      }),
    ).toBe(false);
    expect(
      isBatchUiRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY',
        selectedIds: ['duplicate', 'duplicate'],
      }),
    ).toBe(false);
  });

  it('validates content discovery and page-status messages', () => {
    expect(
      isDiscoverCurrentPageRequest({
        target: 'content',
        type: 'FIN_REPORT_CLIPPER_DISCOVER_CURRENT_PAGE',
      }),
    ).toBe(true);
    expect(
      isBatchPageStatusRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_BATCH_PAGE_STATUS',
        navigationToken: 'batch-navigation-token-0001',
        status: {
          code: 'saving',
          message: '正在写入 Downloads 研报归档',
          updatedAt: '2026-07-21T05:00:00.000Z',
        },
      }),
    ).toBe(true);
    expect(
      isBatchPageStatusRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_BATCH_PAGE_STATUS',
        navigationToken: 'short',
        status: {
          code: 'saving',
          message: 'invalid token',
          updatedAt: '2026-07-21T05:00:00.000Z',
        },
      }),
    ).toBe(false);
    expect(
      isBatchPageStatusRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_BATCH_PAGE_STATUS',
        status: {
          code: 'made-up',
          message: 'invalid',
          updatedAt: '2026-07-21T05:00:00.000Z',
        },
      }),
    ).toBe(false);
  });

  it('trusts only the extension popup origin for batch commands', () => {
    expect(
      isExtensionUiSender(
        {
          id: 'extension-id',
          url: 'chrome-extension://extension-id/popup.html',
        },
        'extension-id',
      ),
    ).toBe(true);
    expect(
      isExtensionUiSender(
        { id: 'extension-id', url: 'https://rsch.baml.com/report' },
        'extension-id',
      ),
    ).toBe(false);
  });
});
