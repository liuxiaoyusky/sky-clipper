import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { bofaAdapter } from '@/utils/research/adapters/bofa';
import { StableReadinessTracker } from '@/utils/research/adapters/types';

const fixture = readFileSync('tests/fixtures/bofa-report.html', 'utf8');
const privateUrl =
  'https://rsch.baml.com/r?q=fake-report&e=analyst%40example.com&h=fake-signature';

describe('BofA adapter', () => {
  beforeEach(() => {
    document.open();
    document.write(fixture);
    document.close();
  });

  it('classifies only approved BofA report routes', () => {
    expect(bofaAdapter.classifyPage(document, new URL(privateUrl))).toBe('report-html');
    expect(
      bofaAdapter.classifyPage(document, new URL('https://rsch.baml.com/home')),
    ).toBe('unsupported');
  });

  it('detects explicit auth pages without treating report prose as an auth failure', () => {
    document.querySelector('[id$="_Body"]')?.append(' Access denied is discussed as a scenario.');
    expect(bofaAdapter.classifyPage(document, new URL(privateUrl))).toBe('report-html');
    document.body.innerHTML = '<input type="password"><p>Access denied</p>';
    expect(bofaAdapter.classifyPage(document, new URL(privateUrl))).toBe('auth-required');
  });

  it('extracts source metadata, faithful body and a transient PDF URL', async () => {
    const result = await bofaAdapter.extractOriginal(
      document,
      privateUrl,
      '2026-07-17T16:30:00+09:00',
    );
    expect(result.document.sourceId).toBe('BOFA-TEST-001');
    expect(result.document.authors).toEqual(['Analyst One', 'Analyst Two']);
    expect(result.document.sourceType).toBe('html+pdf');
    expect(result.document.sanitizedSource).toBe('https://rsch.baml.com/r');
    expect(result.transientPdfUrl).toBe(privateUrl);
    expect(result.document.originalMarkdown).toContain('# Taiwan Semiconductor Manufacturing Co.');
    expect(result.document.originalMarkdown).toContain(
      '> Quarterly sales and margin update for [redacted-email]',
    );
    expect(result.document.originalMarkdown).toContain('## Investment rationale');
    expect(result.document.originalMarkdown).toContain('<table>');
    expect(result.document.originalMarkdown).toContain('colspan="2"');
    expect(result.document.originalMarkdown).toContain('## Disclosures');
    expect(result.document.originalMarkdown).toContain('public.analyst@bofa.example');
    expect(result.document.originalMarkdown).not.toContain('analyst@example.com');
    expect(result.document.originalMarkdown).not.toContain('fake-image-token');
    expect(result.document.originalMarkdown).not.toContain('fake-signature');
    expect(JSON.stringify(result.document.observedMetadata)).not.toContain(
      'analyst@example.com',
    );
    expect(result.document.originalMarkdown).not.toContain('tags:');
    expect(result.document.originalMarkdown).not.toContain('summary:');
  });

  it('omits absent optional metadata rather than writing empty fields', async () => {
    document.querySelector('#reportAuthor')?.remove();
    document.querySelector('#reportPublishDate')?.remove();
    const result = await bofaAdapter.extractOriginal(
      document,
      privateUrl,
      '2026-07-17T16:30:00+09:00',
    );
    expect(result.document.authors).toBeUndefined();
    expect(result.document.publishedAt).toBeUndefined();
    expect(result.document.originalMarkdown).not.toContain('authors:');
    expect(result.document.originalMarkdown).not.toContain('published:');
  });

  it('requires three identical ready observations', () => {
    const tracker = new StableReadinessTracker(3);
    const evidence = bofaAdapter.readinessEvidence(document, new URL(privateUrl));
    expect(tracker.observe(evidence)).toBe(false);
    expect(tracker.observe(evidence)).toBe(false);
    expect(tracker.observe(evidence)).toBe(true);
  });
});
