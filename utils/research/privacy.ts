import type { CanonicalResearchUrl } from './types';

const ACCESS_QUERY_KEYS = new Set([
  'auth',
  'e',
  'email',
  'h',
  'key',
  'q',
  'sig',
  'signature',
  'token',
]);
const GENERIC_SENSITIVE_QUERY_KEYS = new Set([
  'auth',
  'email',
  'key',
  'sig',
  'signature',
  'token',
]);

const HTTP_URL_RE = /https?:\/\/[^\s"'<>),]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_VALUE_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export function canonicalizeBofaUrl(rawUrl: string): CanonicalResearchUrl {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'rsch.baml.com') {
    throw new Error('Unsupported BofA URL');
  }
  const sanitized = `${url.origin}${url.pathname}`;
  return {
    provider: 'bofa',
    sanitized,
  };
}

export function sanitizeEmbeddedUrl(rawUrl: string, baseUrl: string): string {
  if (!rawUrl || rawUrl.startsWith('#')) return rawUrl;
  if (/^(data|blob|javascript):/i.test(rawUrl)) return '';
  try {
    const url = new URL(rawUrl, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    if (url.hostname === 'rsch.baml.com') {
      url.search = '';
    } else {
      for (const key of [...url.searchParams.keys()]) {
        if (GENERIC_SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
          url.searchParams.delete(key);
        }
      }
    }
    return url.toString();
  } catch {
    return '';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactPrivateUrlValues(text: string, baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const values = [...url.searchParams.entries()]
      .filter(([key, value]) => ACCESS_QUERY_KEYS.has(key.toLowerCase()) && value.length >= 3)
      .map(([, value]) => value)
      .sort((left, right) => right.length - left.length);
    return values.reduce((result, value) => {
      const label = EMAIL_VALUE_RE.test(value) ? '[redacted-email]' : '[redacted-value]';
      return result.replace(new RegExp(escapeRegExp(value), 'gi'), label);
    }, text);
  } catch {
    return text;
  }
}

export function sanitizeTextContent(text: string, baseUrl: string): string {
  const urlsSanitized = text.replace(HTTP_URL_RE, (rawUrl) => {
    return sanitizeEmbeddedUrl(rawUrl, baseUrl) || '[redacted-url]';
  });
  return redactPrivateUrlValues(urlsSanitized, baseUrl);
}

export function redactError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(HTTP_URL_RE, '[redacted-url]')
    .replace(EMAIL_RE, '[redacted-email]')
    .slice(0, 240);
}
