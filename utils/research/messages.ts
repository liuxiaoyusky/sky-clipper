import type { CaptureSubmission, PageStatus } from './types';
import { canonicalizeBofaUrl, sanitizeTextContent } from './privacy';

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
