import type { BatchUiState } from './batch-queue';
import type { DiscoveredReportLink } from './entry-discovery';
import type { CaptureSubmission, PageStatus, PageStatusCode } from './types';
import { canonicalizeBofaUrl, sanitizeTextContent } from './privacy';
import { isMarketsTodayEntryUrl } from './markets-today';

export interface CaptureRequest {
  target: 'background';
  type: 'FIN_REPORT_CLIPPER_CAPTURE';
  submission: CaptureSubmission;
}

export interface GetPageStatusRequest {
  target: 'content';
  type: 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS';
}

export interface GetPageStatusResponse {
  ok: true;
  status: PageStatus;
}

export interface DiscoverCurrentPageRequest {
  target: 'content';
  type: 'FIN_REPORT_CLIPPER_DISCOVER_CURRENT_PAGE';
}

export interface DiscoverCurrentPageResponse {
  ok: true;
  links: DiscoveredReportLink[];
  truncated: boolean;
}

export interface BatchPageStatusRequest {
  target: 'background';
  type: 'FIN_REPORT_CLIPPER_BATCH_PAGE_STATUS';
  navigationToken?: string;
  status: PageStatus;
}

export interface MarketsTodayDraftRequest {
  target: 'background';
  type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_DRAFT';
  runId: string;
  links: DiscoveredReportLink[];
  truncated: boolean;
}

export interface MarketsTodayRunClaimRequest {
  target: 'background';
  type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_CLAIM';
}

export interface MarketsTodayRunMutationRequest {
  target: 'background';
  type:
    | 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_ISSUE_SEARCH'
    | 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_STOP';
  runId: string;
}

export type MarketsTodayRunMutationResponse =
  | { ok: true }
  | { ok: false; reason: string };

export type MarketsTodayRunClaimResponse =
  | { ok: true; action: 'start' | 'resume'; runId: string }
  | { ok: true; action: 'wait' | 'skip'; reason: string }
  | { ok: false; reason: string };

export type BatchUiRequest =
  | { target: 'background'; type: 'FIN_REPORT_CLIPPER_BATCH_SCAN_ACTIVE_PAGE' }
  | { target: 'background'; type: 'FIN_REPORT_CLIPPER_BATCH_GET_STATE' }
  | {
      target: 'background';
      type: 'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY';
      selectedIds: string[];
    }
  | { target: 'background'; type: 'FIN_REPORT_CLIPPER_BATCH_CLEAR_DISCOVERY' }
  | { target: 'background'; type: 'FIN_REPORT_CLIPPER_BATCH_PAUSE' }
  | { target: 'background'; type: 'FIN_REPORT_CLIPPER_BATCH_RESUME' }
  | { target: 'background'; type: 'FIN_REPORT_CLIPPER_BATCH_CANCEL' };

export type BatchUiResponse =
  | { ok: true; state: BatchUiState }
  | { ok: false; reason: string };

export interface CreateBlobRequest {
  target: 'offscreen';
  type: 'FIN_REPORT_CLIPPER_CREATE_BLOB';
  requestId: string;
  content: string;
  mime: string;
}

export interface RevokeBlobRequest {
  target: 'offscreen';
  type: 'FIN_REPORT_CLIPPER_REVOKE_BLOB';
  url: string;
}

const CAPTURE_REQUEST_KEYS = new Set(['target', 'type', 'submission']);
const SUBMISSION_KEYS = new Set(['adapterVersion', 'document', 'transientPdfUrl']);
const DOCUMENT_KEYS = new Set([
  'schema',
  'provider',
  'sourceType',
  'sourceId',
  'title',
  'publishedAt',
  'authors',
  'companies',
  'tickers',
  'observedMetadata',
  'originalMarkdown',
  'sanitizedSource',
  'capturedAt',
  'contentHash',
  'captureStatus',
]);
const PAGE_STATUS_CODES = new Set<PageStatusCode>([
  'observing',
  'waiting-ready',
  'extracting',
  'saving',
  'saved',
  'duplicate',
  'partial',
  'needs-action',
  'failed',
  'disabled',
  'unsupported',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSanitizedString(value: unknown, source: string): value is string {
  return typeof value === 'string' && sanitizeTextContent(value, source) === value;
}

function isSanitizedStringList(value: unknown, source: string): boolean {
  return Array.isArray(value) && value.every((item) => isSanitizedString(item, source));
}

function isMetadataValue(value: unknown, source: string): boolean {
  return (
    isSanitizedString(value, source) ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isSanitizedStringList(value, source) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'number'))
  );
}

function isObservedMetadata(value: unknown, source: string): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) &&
      !/(?:raw|pdf|transient)?url$/i.test(key) &&
      isMetadataValue(item, source),
  );
}

function isCanonicalBofaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return canonicalizeBofaUrl(value).sanitized === value;
  } catch {
    return false;
  }
}

function isBofaHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    canonicalizeBofaUrl(value);
    return true;
  } catch {
    return false;
  }
}

function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return false;
  const date = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  return Boolean(date && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date);
}

function isSafeSourceId(value: unknown, source: string): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length <= 256 &&
      sanitizeTextContent(value, source) === value)
  );
}

function isTransientBofaPdfUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'rsch.baml.com';
  } catch {
    return false;
  }
}

function isTransientBofaReportUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'rsch.baml.com' &&
      (url.pathname === '/r' || url.pathname === '/report') &&
      (url.pathname !== '/r' || Boolean(url.searchParams.get('q')?.trim()))
    );
  } catch {
    return false;
  }
}

function isCaptureSubmission(value: unknown): value is CaptureSubmission {
  if (!isRecord(value) || !hasOnlyKeys(value, SUBMISSION_KEYS)) return false;
  if (value.adapterVersion !== 'bofa-html-v1' || !isRecord(value.document)) return false;
  const document = value.document;
  const source = document.sanitizedSource;
  if (!hasOnlyKeys(document, DOCUMENT_KEYS) || !isCanonicalBofaUrl(source)) {
    return false;
  }
  return (
    document.schema === 'fin-report-clipper/capture-v1' &&
    document.provider === 'BofA Global Research' &&
    (document.sourceType === 'html' || document.sourceType === 'html+pdf') &&
    isSafeSourceId(document.sourceId, source) &&
    (document.title === undefined || isSanitizedString(document.title, source)) &&
    (document.publishedAt === undefined || isSanitizedString(document.publishedAt, source)) &&
    (document.authors === undefined || isSanitizedStringList(document.authors, source)) &&
    (document.companies === undefined || isSanitizedStringList(document.companies, source)) &&
    (document.tickers === undefined || isSanitizedStringList(document.tickers, source)) &&
    isObservedMetadata(document.observedMetadata, source) &&
    isSanitizedString(document.originalMarkdown, source) &&
    isValidTimestamp(document.capturedAt) &&
    typeof document.contentHash === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(document.contentHash) &&
    (document.captureStatus === 'complete' || document.captureStatus === 'partial') &&
    (value.transientPdfUrl === undefined || isTransientBofaPdfUrl(value.transientPdfUrl))
  );
}

export function isCaptureRequest(message: unknown): message is CaptureRequest {
  if (!isRecord(message) || !hasOnlyKeys(message, CAPTURE_REQUEST_KEYS)) return false;
  const value = message as Partial<CaptureRequest>;
  return (
    value.target === 'background' &&
    value.type === 'FIN_REPORT_CLIPPER_CAPTURE' &&
    isCaptureSubmission(value.submission)
  );
}

export function isBofaCaptureSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): boolean {
  if (sender.id !== extensionId || sender.frameId !== 0 || !sender.tab?.url || !sender.url) {
    return false;
  }
  return isBofaHttpsUrl(sender.url) && isBofaHttpsUrl(sender.tab.url);
}

export function isGetPageStatusRequest(message: unknown): message is GetPageStatusRequest {
  if (!message || typeof message !== 'object') return false;
  const value = message as Partial<GetPageStatusRequest>;
  return value.target === 'content' && value.type === 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS';
}

export function isDiscoverCurrentPageRequest(
  message: unknown,
): message is DiscoverCurrentPageRequest {
  if (!isRecord(message) || !hasOnlyKeys(message, new Set(['target', 'type']))) return false;
  return (
    message.target === 'content' &&
    message.type === 'FIN_REPORT_CLIPPER_DISCOVER_CURRENT_PAGE'
  );
}

function isPageStatus(value: unknown): value is PageStatus {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set([
    'code',
    'message',
    'title',
    'archivePath',
    'updatedAt',
  ]))) {
    return false;
  }
  return (
    typeof value.code === 'string' &&
    PAGE_STATUS_CODES.has(value.code as PageStatusCode) &&
    typeof value.message === 'string' &&
    value.message.length <= 500 &&
    typeof value.updatedAt === 'string' &&
    isValidTimestamp(value.updatedAt) &&
    (value.title === undefined || (typeof value.title === 'string' && value.title.length <= 500)) &&
    (value.archivePath === undefined ||
      (typeof value.archivePath === 'string' && value.archivePath.length <= 500))
  );
}

export function isBatchPageStatusRequest(message: unknown): message is BatchPageStatusRequest {
  if (
    !isRecord(message) ||
    !hasOnlyKeys(message, new Set(['target', 'type', 'navigationToken', 'status']))
  ) {
    return false;
  }
  return (
    message.target === 'background' &&
    message.type === 'FIN_REPORT_CLIPPER_BATCH_PAGE_STATUS' &&
    (message.navigationToken === undefined ||
      (typeof message.navigationToken === 'string' &&
        /^[A-Za-z0-9_-]{16,80}$/.test(message.navigationToken))) &&
    isPageStatus(message.status)
  );
}

export function isMarketsTodayDraftRequest(
  message: unknown,
): message is MarketsTodayDraftRequest {
  if (
    !isRecord(message) ||
    !hasOnlyKeys(message, new Set(['target', 'type', 'runId', 'links', 'truncated'])) ||
    message.target !== 'background' ||
    message.type !== 'FIN_REPORT_CLIPPER_MARKETS_TODAY_DRAFT' ||
    typeof message.runId !== 'string' ||
    !/^[A-Za-z0-9_-]{8,200}$/.test(message.runId) ||
    !Array.isArray(message.links) ||
    message.links.length < 1 ||
    message.links.length > 20 ||
    typeof message.truncated !== 'boolean'
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const link of message.links) {
    if (
      !isRecord(link) ||
      !hasOnlyKeys(link, new Set(['id', 'title', 'url'])) ||
      typeof link.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(link.id) ||
      ids.has(link.id) ||
      typeof link.title !== 'string' ||
      !link.title ||
      link.title.length > 240 ||
      typeof link.url !== 'string' ||
      !isTransientBofaReportUrl(link.url) ||
      sanitizeTextContent(link.title, link.url) !== link.title
    ) {
      return false;
    }
    ids.add(link.id);
  }
  return true;
}

export function isMarketsTodayRunClaimRequest(
  message: unknown,
): message is MarketsTodayRunClaimRequest {
  return Boolean(
    isRecord(message) &&
      hasOnlyKeys(message, new Set(['target', 'type'])) &&
      message.target === 'background' &&
      message.type === 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_CLAIM',
  );
}

export function isMarketsTodayRunMutationRequest(
  message: unknown,
): message is MarketsTodayRunMutationRequest {
  return Boolean(
    isRecord(message) &&
      hasOnlyKeys(message, new Set(['target', 'type', 'runId'])) &&
      message.target === 'background' &&
      (message.type === 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_ISSUE_SEARCH' ||
        message.type === 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_STOP') &&
      typeof message.runId === 'string' &&
      /^[A-Za-z0-9_-]{8,200}$/.test(message.runId),
  );
}

export function isMarketsTodaySender(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): boolean {
  return Boolean(
    sender.id === extensionId &&
      sender.frameId === 0 &&
      sender.tab?.id !== undefined &&
      sender.documentId &&
      sender.url &&
      sender.tab?.url &&
      isMarketsTodayEntryUrl(sender.url) &&
      isMarketsTodayEntryUrl(sender.tab.url),
  );
}

const BATCH_UI_TYPES = new Set([
  'FIN_REPORT_CLIPPER_BATCH_SCAN_ACTIVE_PAGE',
  'FIN_REPORT_CLIPPER_BATCH_GET_STATE',
  'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY',
  'FIN_REPORT_CLIPPER_BATCH_CLEAR_DISCOVERY',
  'FIN_REPORT_CLIPPER_BATCH_PAUSE',
  'FIN_REPORT_CLIPPER_BATCH_RESUME',
  'FIN_REPORT_CLIPPER_BATCH_CANCEL',
]);

export function isBatchUiRequest(message: unknown): message is BatchUiRequest {
  if (!isRecord(message) || message.target !== 'background' || typeof message.type !== 'string') {
    return false;
  }
  if (!BATCH_UI_TYPES.has(message.type)) return false;
  if (message.type === 'FIN_REPORT_CLIPPER_BATCH_CONFIRM_DISCOVERY') {
    return (
      hasOnlyKeys(message, new Set(['target', 'type', 'selectedIds'])) &&
      Array.isArray(message.selectedIds) &&
      message.selectedIds.length > 0 &&
      message.selectedIds.length <= 20 &&
      message.selectedIds.every(
        (item) => typeof item === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item),
      ) &&
      new Set(message.selectedIds).size === message.selectedIds.length
    );
  }
  return hasOnlyKeys(message, new Set(['target', 'type']));
}

export function isExtensionUiSender(
  sender: chrome.runtime.MessageSender,
  extensionId: string,
): boolean {
  if (sender.id !== extensionId || sender.tab || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId;
  } catch {
    return false;
  }
}
