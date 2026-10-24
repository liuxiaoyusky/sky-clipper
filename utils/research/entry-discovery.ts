import { sanitizeTextContent } from './privacy';

export const MAX_DISCOVERED_REPORTS = 20;

export interface DiscoveredReportLink {
  /** Opaque scan-local identifier. It never contains provider access parameters. */
  id: string;
  title: string;
  /** Transient navigation URL. Never return this field in popup-safe state. */
  url: string;
}

export interface DiscoveryResult {
  links: DiscoveredReportLink[];
  truncated: boolean;
}

function reportIdentity(url: URL): string | undefined {
  if (url.protocol !== 'https:' || url.hostname !== 'rsch.baml.com') return undefined;
  if (url.pathname !== '/r' && url.pathname !== '/report') return undefined;
  const redirectIdentity = url.searchParams.get('q')?.trim();
  if (url.pathname === '/r' && !redirectIdentity) return undefined;
  return redirectIdentity ? `${url.pathname}:${redirectIdentity}` : url.toString();
}

function safeTitle(anchor: HTMLAnchorElement, url: string, index: number): string {
  const title = sanitizeTextContent(anchor.textContent || '', url)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return title || `BofA 研报 ${index}`;
}

export function discoverBofaReportLinks(
  document: Document,
  baseUrl: string,
  maximum = MAX_DISCOVERED_REPORTS,
): DiscoveryResult {
  const links: DiscoveredReportLink[] = [];
  const identities = new Set<string>();
  let currentIdentity: string | undefined;
  try {
    currentIdentity = reportIdentity(new URL(baseUrl));
  } catch {
    // Invalid base URLs already make relative anchors unusable below.
  }
  let truncated = false;

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (anchor.matches('#print_pdf_anchor, [title="PDF"]')) continue;
    let url: URL;
    try {
      url = new URL(anchor.getAttribute('href') || '', baseUrl);
    } catch {
      continue;
    }
    url.hash = '';
    const identity = reportIdentity(url);
    if (!identity || identity === currentIdentity || identities.has(identity)) continue;
    identities.add(identity);
    if (links.length >= maximum) {
      truncated = true;
      break;
    }
    const index = links.length + 1;
    links.push({
      id: `bofa-report-${index}`,
      title: safeTitle(anchor, url.toString(), index),
      url: url.toString(),
    });
  }

  return { links, truncated };
}
