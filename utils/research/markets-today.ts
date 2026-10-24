import {
  MAX_DISCOVERED_REPORTS,
  type DiscoveredReportLink,
  type DiscoveryResult,
} from './entry-discovery';
import { sanitizeTextContent } from './privacy';

export const MARKETS_TODAY_ENTRY_URL =
  'https://markets.ml.com/researchlibrary/advancedsearch';

const STRONG_AUTH_MARKERS = [
  'multi-factor',
  'verification code',
  'one-time passcode',
  'captcha',
  'verify you are human',
];
const LOGIN_ACTION_LABELS = new Set(['sign in', 'log in']);
const ACCESS_MARKERS = [
  '403 forbidden',
  '429 too many requests',
  'access denied',
  'request blocked',
  'too many requests',
];

export type MarketsTodayDraftResult =
  | ({ kind: 'draft' } & DiscoveryResult)
  | { kind: 'stopped'; reason: string }
  | { kind: 'failed'; reason: string };

interface MarketsTodayAutomationDependencies {
  document: Document;
  sleep(milliseconds: number): Promise<void>;
  maximumAttempts?: number;
  intervalMs?: number;
  resumeAfterSearch?: boolean;
  stableSamples?: number;
  beforeSearch?(): boolean | Promise<boolean>;
  shouldContinue?(): boolean;
}

interface DateRangeControl {
  element: HTMLInputElement | HTMLSelectElement | HTMLElement;
  scope: ParentNode;
}

function normalizedText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isMarketsTodayEntryUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'markets.ml.com' &&
      url.pathname === '/researchlibrary/advancedsearch'
    );
  } catch {
    return false;
  }
}

export function isMarketsTodayResultsUrl(rawUrl: string): boolean {
  if (!isMarketsTodayEntryUrl(rawUrl)) return false;
  return new URL(rawUrl).searchParams.get('dateRangeDropDown') === 'CurrentDay';
}

function stopReason(document: Document): string | undefined {
  if (document.querySelector('input[type="password"]')) {
    return '页面需要登录或人工验证';
  }
  const text = normalizedText(document.body?.textContent).slice(0, 20000);
  if (ACCESS_MARKERS.some((marker) => text.includes(marker))) {
    return 'BofA 暂时拒绝访问';
  }
  if (STRONG_AUTH_MARKERS.some((marker) => text.includes(marker))) {
    return '页面需要登录或人工验证';
  }
  const hasLoginAction = [
    ...document.querySelectorAll<HTMLElement>(
      'a, button, input[type="button"], input[type="submit"], [role="button"]',
    ),
  ].some((control) => {
    const visibleText =
      control instanceof HTMLInputElement ? control.value : control.textContent;
    return [
      visibleText,
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
    ].some((label) => LOGIN_ACTION_LABELS.has(normalizedText(label)));
  });
  if (hasLoginAction) {
    return '页面需要登录或人工验证';
  }
  return undefined;
}

function labelHasDateRange(label: HTMLLabelElement): boolean {
  return normalizedText(label.textContent).includes('date range');
}

function findDateRangeControl(document: Document): DateRangeControl | undefined {
  for (const label of document.querySelectorAll<HTMLLabelElement>('label')) {
    if (!labelHasDateRange(label)) continue;
    const control = label.control;
    if (control instanceof HTMLSelectElement || control instanceof HTMLInputElement) {
      return { element: control, scope: control.closest('form') || document };
    }
    const combo = label.querySelector<HTMLElement>('[role="combobox"]');
    if (combo) return { element: combo, scope: combo.closest('form') || document };
  }

  const labelled = document.querySelector<HTMLElement>(
    [
      'select[aria-label*="Date Range" i]',
      'select[aria-description*="Date Range" i]',
      'select[title*="Date Range" i]',
      'select[name*="dateRange" i]',
      'input[aria-label*="Date Range" i]',
      '[role="combobox"][aria-label*="Date Range" i]',
      '[role="combobox"][aria-description*="Date Range" i]',
    ].join(', '),
  );
  if (labelled) return { element: labelled, scope: labelled.closest('form') || document };

  for (const fieldset of document.querySelectorAll<HTMLFieldSetElement>('fieldset')) {
    if (!normalizedText(fieldset.querySelector('legend')?.textContent).includes('date range')) {
      continue;
    }
    const today = [...fieldset.querySelectorAll<HTMLInputElement>('input')].find((input) => {
      const label = input.closest('label')?.textContent;
      return normalizedText(input.value) === 'today' || normalizedText(label) === 'today';
    });
    if (today) return { element: today, scope: fieldset.closest('form') || fieldset };
  }

  return undefined;
}

function selectNativeToday(control: HTMLSelectElement | HTMLInputElement): boolean {
  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find(
      (candidate) =>
        normalizedText(candidate.textContent) === 'today' ||
        normalizedText(candidate.value) === 'today',
    );
    if (!option) return false;
    control.value = option.value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (
    (control.type === 'radio' || control.type === 'checkbox') &&
    (normalizedText(control.value) === 'today' ||
      normalizedText(control.closest('label')?.textContent) === 'today')
  ) {
    control.click();
    return true;
  }
  return false;
}

function isTodaySelected(control: DateRangeControl): boolean {
  const element = control.element;
  if (element instanceof HTMLSelectElement) {
    return normalizedText(element.selectedOptions[0]?.textContent) === 'today';
  }
  if (element instanceof HTMLInputElement) {
    return (
      (element.type !== 'radio' && element.type !== 'checkbox') ||
      element.checked
    ) && (
      normalizedText(element.value) === 'today' ||
      normalizedText(element.closest('label')?.textContent) === 'today'
    );
  }
  return [
    element.textContent,
    element.getAttribute('aria-label'),
    element.getAttribute('aria-valuetext'),
    element.getAttribute('title'),
  ].some((value) => normalizedText(value) === 'today');
}

async function selectToday(
  dependencies: MarketsTodayAutomationDependencies,
  control: DateRangeControl,
): Promise<boolean> {
  if (
    control.element instanceof HTMLSelectElement ||
    control.element instanceof HTMLInputElement
  ) {
    return selectNativeToday(control.element);
  }

  control.element.click();
  const attempts = dependencies.maximumAttempts ?? 30;
  const intervalMs = dependencies.intervalMs ?? 250;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (dependencies.shouldContinue?.() === false) return false;
    if (stopReason(dependencies.document)) return false;
    const option = [
      ...dependencies.document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((candidate) => normalizedText(candidate.textContent) === 'today');
    if (option) {
      option.click();
      return true;
    }
    if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
  }
  return false;
}

function findSearchButton(scope: ParentNode): HTMLElement | undefined {
  return [
    ...scope.querySelectorAll<HTMLElement>(
      'button, input[type="button"], input[type="submit"], [role="button"]',
    ),
  ].find((candidate) => {
    const text =
      candidate instanceof HTMLInputElement ? candidate.value : candidate.textContent;
    return normalizedText(text) === 'search';
  });
}

function findSearchResultsTable(document: Document): HTMLTableElement | undefined {
  return [...document.querySelectorAll<HTMLTableElement>('table')].find((table) => {
    const text = normalizedText(table.textContent);
    return text.includes('search results') && /\d+\s*[-\u2013]\s*\d+\s+of\s+\d+/.test(text);
  });
}

function describedTitle(element: HTMLElement): string | undefined {
  const sources = [
    element.getAttribute('aria-label'),
    element.getAttribute('aria-description'),
    element.getAttribute('title'),
    ...[...element.querySelectorAll<HTMLElement>('[aria-label], [aria-description], img[alt]')]
      .flatMap((child) => [
        child.getAttribute('aria-label'),
        child.getAttribute('aria-description'),
        child.getAttribute('alt'),
      ]),
  ];
  for (const source of sources) {
    const match = /^\s*html\s+(.+?)\s+report opens in a new window\s*$/i.exec(source || '');
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

function reportUrlFromElement(element: HTMLElement): string | undefined {
  const directValues = [
    element.getAttribute('href'),
    element.getAttribute('data-href'),
    element.getAttribute('data-url'),
    element.getAttribute('data-report-href'),
    element.getAttribute('data-report-url'),
  ];
  const values: string[] = [];
  for (const raw of directValues) {
    if (raw) values.push(raw);
  }
  const onclick = element
    .getAttribute('onclick')
    ?.replace(/\\\//g, '/')
    .replace(/\\u0026|\\x26/gi, '&')
    .replace(/&amp;/gi, '&');
  const onclickMatch =
    /^\s*javascript:getUrlFromWebserviceForIdHTML\(\s*(['"])(https:\/\/rsch\.baml\.com\/(?:r|report)(?:\?[^'"]*)?)\1\s*\)\s*;?\s*(?:return\s+false\s*;?)?\s*$/i.exec(
      onclick || '',
    );
  if (onclickMatch?.[2]) values.push(onclickMatch[2]);

  for (const raw of values) {
    if (!raw) continue;
    const normalized = raw
      .replace(/\\\//g, '/')
      .replace(/\\u0026|\\x26/gi, '&')
      .replace(/&amp;/gi, '&');
    try {
      const url = new URL(normalized);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'rsch.baml.com' &&
        (url.pathname === '/r' || url.pathname === '/report') &&
        (url.pathname !== '/r' || Boolean(url.searchParams.get('q')?.trim()))
      ) {
        return url.toString();
      }
    } catch {
      // An unparseable DOM attribute is not a usable navigation transaction.
    }
  }
  return undefined;
}

export function discoverMarketsTodayReportLinks(
  document: Document,
  maximum = MAX_DISCOVERED_REPORTS,
): DiscoveryResult {
  const table = findSearchResultsTable(document);
  if (!table) return { links: [], truncated: false };

  const links: DiscoveredReportLink[] = [];
  const identities = new Set<string>();
  let truncated = false;
  for (const element of table.querySelectorAll<HTMLElement>(
    'a, button, [role="button"], [onclick], [data-url], [data-report-url]',
  )) {
    const title = describedTitle(element);
    const url = reportUrlFromElement(element);
    if (!title || !url) continue;
    const parsed = new URL(url);
    const identity = parsed.searchParams.get('q')?.trim() || parsed.toString();
    if (identities.has(identity)) continue;
    identities.add(identity);
    if (links.length >= maximum) {
      truncated = true;
      break;
    }
    const index = links.length + 1;
    links.push({
      id: `bofa-report-${index}`,
      title: sanitizeTextContent(title, url).slice(0, 240) || `BofA 研报 ${index}`,
      url,
    });
  }
  return { links, truncated };
}

function searchResultsSignature(
  document: Document,
  table: HTMLTableElement,
): string {
  const visiblePage = discoverMarketsTodayReportLinks(document, 100);
  const identities = visiblePage.links.map((link) => {
    const reportId = new URL(link.url).searchParams.get('q') || '';
    return [reportId, link.title];
  });
  return JSON.stringify([
    normalizedText(table.textContent).slice(0, 100_000),
    identities,
  ]);
}

export async function prepareMarketsTodayDraft(
  dependencies: MarketsTodayAutomationDependencies,
): Promise<MarketsTodayDraftResult> {
  const initialStop = stopReason(dependencies.document);
  if (initialStop) return { kind: 'stopped', reason: initialStop };

  const attempts = dependencies.maximumAttempts ?? 120;
  const intervalMs = dependencies.intervalMs ?? 500;
  const stableSamples = dependencies.stableSamples ?? Math.min(3, attempts);
  let dateRange: DateRangeControl | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (dependencies.shouldContinue?.() === false) {
      return { kind: 'failed', reason: '页面已离开 BofA Advanced Search' };
    }
    const reason = stopReason(dependencies.document);
    if (reason) return { kind: 'stopped', reason };
    dateRange = findDateRangeControl(dependencies.document);
    if (dateRange) break;
    if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
  }
  if (!dateRange) {
    const reason = stopReason(dependencies.document);
    return reason
      ? { kind: 'stopped', reason }
      : { kind: 'failed', reason: '找不到 Date Range 的 Today 选项' };
  }
  if (dependencies.resumeAfterSearch) {
    if (!isTodaySelected(dateRange)) {
      return {
        kind: 'failed',
        reason: '搜索后的页面没有明确显示 Date Range = Today',
      };
    }
  } else if (!(await selectToday(dependencies, dateRange))) {
    const reason = stopReason(dependencies.document);
    return reason
      ? { kind: 'stopped', reason }
      : { kind: 'failed', reason: '找不到 Date Range 的 Today 选项' };
  }

  const baselineTable = findSearchResultsTable(dependencies.document);
  const baselineSignature = baselineTable
    ? searchResultsSignature(dependencies.document, baselineTable)
    : undefined;
  if (!dependencies.resumeAfterSearch) {
    let search: HTMLElement | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (dependencies.shouldContinue?.() === false) {
        return { kind: 'failed', reason: '页面已离开 BofA Advanced Search' };
      }
      const reason = stopReason(dependencies.document);
      if (reason) return { kind: 'stopped', reason };
      search = findSearchButton(dateRange.scope);
      if (search) break;
      if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
    }
    if (!search) return { kind: 'failed', reason: '找不到 Advanced Search 的 Search 按钮' };
    if (dependencies.beforeSearch && !(await dependencies.beforeSearch())) {
      return { kind: 'failed', reason: 'Today 搜索没有获得执行许可' };
    }
    search.click();
  }

  let previousSignature: string | undefined;
  let stableCount = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (dependencies.shouldContinue?.() === false) {
      return { kind: 'failed', reason: '页面已离开 BofA Advanced Search' };
    }
    const reason = stopReason(dependencies.document);
    if (reason) return { kind: 'stopped', reason };
    const table = findSearchResultsTable(dependencies.document);
    const signature = table
      ? searchResultsSignature(dependencies.document, table)
      : undefined;
    const isFresh =
      dependencies.resumeAfterSearch ||
      (table !== undefined &&
        (baselineTable === undefined ||
          signature !== baselineSignature));
    if (table && signature && isFresh) {
      const result = discoverMarketsTodayReportLinks(dependencies.document);
      if (result.links.length) {
        stableCount = signature === previousSignature ? stableCount + 1 : 1;
        previousSignature = signature;
        if (stableCount >= stableSamples) return { kind: 'draft', ...result };
      } else {
        stableCount = 0;
        previousSignature = undefined;
      }
    } else {
      stableCount = 0;
      previousSignature = undefined;
    }
    if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
  }
  return {
    kind: 'failed',
    reason: 'Search Results 在等待时间内没有可处理的研报',
  };
}
