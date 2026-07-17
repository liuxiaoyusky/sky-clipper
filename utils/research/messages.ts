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

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMetadataValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    isStringList(value) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'number'))
  );
}

function isObservedMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) &&
      !/(?:raw|pdf|transient)?url$/i.test(key) &&
      isMetadataValue(item),
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
  if (!hasOnlyKeys(document, DOCUMENT_KEYS) || !isCanonicalBofaUrl(document.sanitizedSource)) {
    return false;
  }
  return (
    document.schema === 'fin-report-clipper/capture-v1' &&
    document.provider === 'BofA Global Research' &&
    (document.sourceType === 'html' || document.sourceType === 'html+pdf') &&
    isSafeSourceId(document.sourceId, document.sanitizedSource) &&
    (document.title === undefined || typeof document.title === 'string') &&
    (document.publishedAt === undefined || typeof document.publishedAt === 'string') &&
    (document.authors === undefined || isStringList(document.authors)) &&
    (document.companies === undefined || isStringList(document.companies)) &&
    (document.tickers === undefined || isStringList(document.tickers)) &&
    isObservedMetadata(document.observedMetadata) &&
    typeof document.originalMarkdown === 'string' &&
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
