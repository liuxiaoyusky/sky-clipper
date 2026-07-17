import type { ResearchSiteAdapter } from './types';
import type { MetadataValue, PageKind, ReadinessEvidence } from '../types';
import { buildContentHash } from '../hash';
import { htmlToResearchMarkdown, renderOriginalMarkdown } from '../markdown';
import { canonicalizeBofaUrl, sanitizeTextContent } from '../privacy';

const REPORT_PATHS = new Set(['/r', '/report']);
const BODY_SELECTOR = '[id$="_Body"]';
const AUTH_TEXT = ['access denied', 'too many requests', 'verify you are human', 'captcha'];

function inputValue(document: Document, id: string, baseUrl?: string): string | undefined {
  const raw = (document.getElementById(id) as HTMLInputElement | null)?.value || '';
  const value = (baseUrl ? sanitizeTextContent(raw, baseUrl) : raw)
    .replace(/\s+/g, ' ')
    .trim();
  return value || undefined;
}

function splitSourceList(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(/[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
}

function hasAuthBlock(document: Document): boolean {
  if (document.querySelector('input[type="password"]')) return true;
  if (
    document.querySelector(BODY_SELECTOR) &&
    (inputValue(document, 'reportPid') || inputValue(document, 'reportTitle'))
  ) {
    return false;
  }
  const text = document.body?.textContent?.toLowerCase().slice(0, 12000) || '';
  return AUTH_TEXT.some((marker) => text.includes(marker));
}

function classifyBofaPage(document: Document, url: URL): PageKind {
  if (url.protocol !== 'https:' || url.hostname !== 'rsch.baml.com') return 'unsupported';
  if (!REPORT_PATHS.has(url.pathname)) return 'unsupported';
  return hasAuthBlock(document) ? 'auth-required' : 'report-html';
}

function getSourceId(document: Document): string | null {
  return inputValue(document, 'reportPid') || null;
}

function findOriginalPdf(document: Document): string | null {
  const href = document
    .querySelector<HTMLAnchorElement>('a#print_pdf_anchor[title="PDF"]')
    ?.href?.trim();
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.hostname === 'rsch.baml.com' ? href : null;
  } catch {
    return null;
  }
}

function reportBody(document: Document): HTMLElement {
  const body = document.querySelector<HTMLElement>(BODY_SELECTOR);
  if (!body) throw new Error('BofA report body is unavailable');
  return body;
}

export const bofaAdapter: ResearchSiteAdapter = {
  id: 'bofa',

  classifyPage(document, url) {
    return classifyBofaPage(document, url);
  },

  readinessEvidence(document, url): ReadinessEvidence {
    const body = document.querySelector<HTMLElement>(BODY_SELECTOR);
    const normalized = body?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return {
      kind: classifyBofaPage(document, url),
      sourceId: getSourceId(document) || undefined,
      title: inputValue(document, 'reportTitle'),
      bodyTextLength: normalized.length,
      tableCount: body?.querySelectorAll('table').length || 0,
      tailText: normalized.slice(-160),
    };
  },

  findOriginalPdf(document) {
    return findOriginalPdf(document);
  },

  getSourceId(document) {
    return getSourceId(document);
  },

  async extractOriginal(document, rawUrl, capturedAt) {
    const canonical = canonicalizeBofaUrl(rawUrl);
    const sourceId = inputValue(document, 'reportPid');
    const title = inputValue(document, 'reportTitle', rawUrl);
    const subtitle = inputValue(document, 'reportSubTitle', rawUrl);
    const publishedAt = inputValue(document, 'reportPublishDate', rawUrl);
    const authors = splitSourceList(inputValue(document, 'reportAuthor', rawUrl));
    const transientPdfUrl = findOriginalPdf(document) || undefined;
    const observedMetadata: Record<string, MetadataValue> = {};
    if (subtitle) observedMetadata.subtitle = subtitle;
    if (authors) observedMetadata.authors = authors;
    if (publishedAt) observedMetadata.publishedAt = publishedAt;

    const bodyMarkdown = htmlToResearchMarkdown(reportBody(document), rawUrl);
    const contentHash = await buildContentHash({
      provider: 'BofA Global Research',
      sourceId,
      title,
      publishedAt,
      authors,
      observedMetadata,
      bodyMarkdown,
    });
    const captured = {
      schema: 'fin-report-clipper/capture-v1' as const,
      provider: 'BofA Global Research' as const,
      sourceType: transientPdfUrl ? ('html+pdf' as const) : ('html' as const),
      ...(sourceId ? { sourceId } : {}),
      ...(title ? { title } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(authors ? { authors } : {}),
      observedMetadata,
      sanitizedSource: canonical.sanitized,
      capturedAt,
      contentHash,
      captureStatus: 'complete' as const,
    };
    return {
      adapterVersion: 'bofa-html-v1',
      document: {
        ...captured,
        originalMarkdown: renderOriginalMarkdown(captured, bodyMarkdown),
      },
      ...(transientPdfUrl ? { transientPdfUrl } : {}),
    };
  },
};
