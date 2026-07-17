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

  it('redacts URL fragments without preserving sensitive query tails', () => {
    const message = redactError(
      new Error('request failed at https://private.example/r?token=secret,signature=abc)'),
    );

    expect(message).not.toContain('secret');
    expect(message).not.toContain('abc');
    expect(message).toBe('request failed at [redacted-url]');
  });

  it('redacts the complete URL when a sensitive value contains a comma', () => {
    const message = redactError(
      new Error('download failed for https://rsch.baml.com/r?token=secret,continuation'),
    );

    expect(message).not.toContain('secret');
    expect(message).not.toContain('continuation');
    expect(message).toBe('download failed for [redacted-url]');
  });

  it('removes sensitive URL tails from persisted visible text', () => {
    expect(
      sanitizeTextContent(
        'Read https://rsch.baml.com/r?token=secret,continuation',
        privateUrl,
      ),
    ).toBe('Read https://rsch.baml.com/r');
  });

  it('redacts JSON and colon-style sensitive error fields', () => {
    const message = redactError(new Error('response {"token":"secret"}; signature: abc'));

    expect(message).not.toContain('secret');
    expect(message).not.toContain('abc');
    expect(message).toBe('response {"token":[redacted-value]}; signature: [redacted-value]');
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
