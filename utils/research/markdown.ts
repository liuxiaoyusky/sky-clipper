import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { CapturedDocument } from './types';
import { sanitizeEmbeddedUrl, sanitizeTextContent } from './privacy';

const SAFE_ATTRIBUTES = new Set([
  'alt',
  'colspan',
  'height',
  'href',
  'rowspan',
  'scope',
  'src',
  'title',
  'width',
]);

function cleanClone(root: HTMLElement, baseUrl: string): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('script, style, noscript, form, input, button, iframe, canvas, svg, [hidden], [aria-hidden="true"]')
    .forEach((node) => node.remove());
  clone.querySelectorAll<HTMLElement>('*').forEach((element) => {
    if (/display\s*:\s*none/i.test(element.getAttribute('style') || '')) {
      element.remove();
      return;
    }
    const anchorHref = element instanceof HTMLAnchorElement
      ? element.getAttribute('href') || ''
      : '';
    const imageSrc = element instanceof HTMLImageElement
      ? element.getAttribute('data-src') ||
        element.getAttribute('data-original') ||
        element.getAttribute('src') ||
        ''
      : '';
    for (const attribute of [...element.attributes]) {
      if (!SAFE_ATTRIBUTES.has(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
    }
    for (const attributeName of ['alt', 'title']) {
      const value = element.getAttribute(attributeName);
      if (value) element.setAttribute(attributeName, sanitizeTextContent(value, baseUrl));
    }
    if (element instanceof HTMLAnchorElement) {
      const href = sanitizeEmbeddedUrl(anchorHref, baseUrl);
      href ? element.setAttribute('href', href) : element.removeAttribute('href');
    }
    if (element instanceof HTMLImageElement) {
      const src = sanitizeEmbeddedUrl(imageSrc, baseUrl);
      src ? element.setAttribute('src', src) : element.remove();
    }
  });
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    textNode.nodeValue = sanitizeTextContent(textNode.nodeValue || '', baseUrl);
    textNode = walker.nextNode();
  }
  return clone;
}

export function htmlToResearchMarkdown(root: HTMLElement, baseUrl: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(gfm);
  turndown.addRule('complexResearchTable', {
    filter: (node) =>
      node.nodeName === 'TABLE' && Boolean((node as HTMLElement).querySelector('[rowspan], [colspan]')),
    replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
  });
  return turndown
    .turndown(cleanClone(root, baseUrl))
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(key: string, values: string[] | undefined): string[] {
  return values?.length ? [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)] : [];
}

export function renderOriginalMarkdown(
  document: Omit<CapturedDocument, 'originalMarkdown'>,
  bodyMarkdown: string,
): string {
  const frontmatter = [
    '---',
    'schema: fin-report-clipper/capture-v1',
    `provider: ${yamlString(document.provider)}`,
    ...(document.sourceId ? [`source_id: ${yamlString(document.sourceId)}`] : []),
    `source_type: ${document.sourceType}`,
    `source: ${yamlString(document.sanitizedSource)}`,
    ...(document.publishedAt ? [`published: ${yamlString(document.publishedAt)}`] : []),
    ...yamlList('authors', document.authors),
    ...yamlList('companies', document.companies),
    ...yamlList('tickers', document.tickers),
    `captured: ${yamlString(document.capturedAt)}`,
    `capture_status: ${document.captureStatus}`,
    `content_hash: ${document.contentHash}`,
    '---',
  ];
  const title = document.title
    ? `# ${document.title.replace(/\s+/g, ' ').trim()}\n\n`
    : '';
  const subtitleValue = document.observedMetadata.subtitle;
  const subtitle =
    typeof subtitleValue === 'string'
      ? `> ${subtitleValue.replace(/\s+/g, ' ').trim()}\n\n`
      : '';
  return `${frontmatter.join('\n')}\n\n${title}${subtitle}${bodyMarkdown.trim()}\n`;
}
