import type { MetadataValue } from './types';

function sortValue(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n');
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/\r\n?/g, '\n'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

export interface ContentHashInput {
  provider: string;
  sourceId?: string;
  title?: string;
  publishedAt?: string;
  authors?: string[];
  observedMetadata: Record<string, MetadataValue>;
  bodyMarkdown: string;
}

export function buildContentHash(input: ContentHashInput): Promise<string> {
  return sha256Text(stableJson(input));
}
