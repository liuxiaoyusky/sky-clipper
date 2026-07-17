import { describe, expect, it } from 'vitest';
import {
  canonicalizeBofaUrl,
  redactError,
  sanitizeEmbeddedUrl,
  sanitizeTextContent,
} from '@/utils/research/privacy';

describe('research URL privacy', () => {
  const privateUrl =
    'https://rsch.baml.com/r?q=fake-report&e=analyst%40example.com&h=fake-signature';

  it('removes every BofA query parameter from archived identity', () => {
    expect(canonicalizeBofaUrl(privateUrl)).toEqual({
      provider: 'bofa',
      sanitized: 'https://rsch.baml.com/r',
    });
  });

  it('removes BofA credentials from embedded links and keeps safe public params elsewhere', () => {
    expect(sanitizeEmbeddedUrl(privateUrl, privateUrl)).toBe('https://rsch.baml.com/r');
    expect(
      sanitizeEmbeddedUrl(
        'https://cdn.example.com/chart.png?q=semiconductors&width=1200&token=secret',
        privateUrl,
      ),
    ).toBe('https://cdn.example.com/chart.png?q=semiconductors&width=1200');
  });

  it('never returns a URL or email from an error', () => {
    const message = redactError(
      new Error(`download failed for analyst@example.com at ${privateUrl}`),
    );
    expect(message).not.toContain('fake-report');
    expect(message).not.toContain('analyst@example.com');
    expect(message).toContain('[redacted-url]');
  });

  it('sanitizes URLs and emails that appear as visible report text', () => {
    expect(
      sanitizeTextContent(
        `Reader analyst@example.com; public contact public.analyst@bofa.example; read ${privateUrl}`,
        privateUrl,
      ),
    ).toBe(
      'Reader [redacted-email]; public contact public.analyst@bofa.example; read https://rsch.baml.com/r',
    );
  });

  it('rejects non-BofA URLs as BofA identities', () => {
    expect(() => canonicalizeBofaUrl('https://example.com/r?q=x')).toThrow(
      'Unsupported BofA URL',
    );
  });
});
