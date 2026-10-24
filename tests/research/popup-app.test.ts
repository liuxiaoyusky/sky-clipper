import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResearchSettings } from '@/utils/research/settings';

const popupMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  pollerStop: vi.fn(),
  batchPollerStop: vi.fn(),
  requestBatchUiState: vi.fn(),
  batchOnError: undefined as ((message: string) => void) | undefined,
}));

vi.mock('@/utils/research/settings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/utils/research/settings')>();
  return {
    ...original,
    loadResearchSettings: vi.fn(async () => original.DEFAULT_RESEARCH_SETTINGS),
    saveResearchSettings: vi.fn(async () => undefined),
  };
});

vi.mock('@/entrypoints/popup/model', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/entrypoints/popup/model')>();
  return {
    ...original,
    createSettingsSaveQueue: vi.fn((initial: ResearchSettings) => ({
      getState: () => ({ settings: initial, saving: false }),
      patch: vi.fn(async () => undefined),
      subscribe: popupMocks.subscribe.mockImplementation(() => popupMocks.unsubscribe),
    })),
    createPageStatusPoller: vi.fn(() => ({
      start: vi.fn(),
      refresh: vi.fn(),
      invalidate: vi.fn(),
      stop: popupMocks.pollerStop,
    })),
    requestBatchUiState: popupMocks.requestBatchUiState,
    createBatchStatePoller: vi.fn((dependencies: { onError(message: string): void }) => {
      popupMocks.batchOnError = dependencies.onError;
      return {
        start: vi.fn(),
        refresh: vi.fn(),
        stop: popupMocks.batchPollerStop,
      };
    }),
  };
});

import { App } from '@/entrypoints/popup/App';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterAll(() => {
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

afterEach(() => {
  document.body.innerHTML = '';
  popupMocks.batchOnError = undefined;
  vi.clearAllMocks();
});

describe('popup app cleanup', () => {
  it('invokes the eventual settings unsubscribe when the popup unmounts', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    expect(popupMocks.subscribe).toHaveBeenCalledTimes(1);

    act(() => root.unmount());

    expect(popupMocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(popupMocks.pollerStop).toHaveBeenCalledTimes(1);
    expect(popupMocks.batchPollerStop).toHaveBeenCalledTimes(1);
  });

  it('keeps a command error visible when the background state poll succeeds', async () => {
    popupMocks.requestBatchUiState.mockRejectedValueOnce(new Error('当前页面没有发现研报链接'));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(App));
      await Promise.resolve();
    });
    const scanButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('扫描当前 BofA 列表页'),
    );
    expect(scanButton).toBeDefined();

    await act(async () => {
      scanButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '当前页面没有发现研报链接',
    );

    act(() => popupMocks.batchOnError?.(''));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '当前页面没有发现研报链接',
    );

    act(() => root.unmount());
  });
});
