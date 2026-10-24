import { describe, expect, it } from 'vitest';
import { discoverBofaReportLinks } from '@/utils/research/entry-discovery';

function page(html: string): Document {
  const document = window.document.implementation.createHTMLDocument('BofA research');
  document.body.innerHTML = html;
  return document;
}

describe('BofA entry-page discovery', () => {
  it('discovers only loaded BofA report links without exposing access data in labels', () => {
    const result = discoverBofaReportLinks(
      page(`
        <a href="/r?q=report-one&e=reader%40example.com&h=secret-one">First report</a>
        <a href="https://rsch.baml.com/report?q=report-two&token=secret-two">Second report</a>
        <a href="https://rsch.baml.com/download/file.pdf">PDF</a>
        <a href="https://example.com/r?q=outside">Outside</a>
        <a href="javascript:alert(1)">Script</a>
      `),
      'https://rsch.baml.com/research/today',
    );

    expect(result.truncated).toBe(false);
    expect(result.links).toHaveLength(2);
    expect(result.links.map((link) => link.title)).toEqual(['First report', 'Second report']);
    expect(result.links[0].url).toContain('q=report-one');
    expect(JSON.stringify(result.links.map(({ id, title }) => ({ id, title })))).not.toMatch(
      /reader|secret|token|@/,
    );
  });

  it('deduplicates the same redirect report and caps one scan at twenty links', () => {
    const anchors = Array.from({ length: 24 }, (_, index) =>
      `<a href="/r?q=report-${index}&e=first%40example.com">Report ${index}</a>`,
    );
    anchors.splice(
      1,
      0,
      '<a href="/r?q=report-0&e=second%40example.com&h=other">Duplicate</a>',
    );

    const result = discoverBofaReportLinks(
      page(anchors.join('\n')),
      'https://rsch.baml.com/research/today',
    );

    expect(result.links).toHaveLength(20);
    expect(result.truncated).toBe(true);
    expect(result.links[0].title).toBe('Report 0');
    expect(new Set(result.links.map((link) => link.id))).toHaveLength(20);
  });

  it('does not rediscover the report that is already open', () => {
    const result = discoverBofaReportLinks(
      page(`
        <a href="/report?q=current&e=reader%40example.com&h=secret">Current report</a>
        <a href="/r?q=opaque-123&e=reader%40example.com&h=secret">Related report</a>
      `),
      'https://rsch.baml.com/report?q=current&e=reader%40example.com&h=secret',
    );

    expect(result.links).toEqual([
      {
        id: 'bofa-report-1',
        title: 'Related report',
        url: 'https://rsch.baml.com/r?q=opaque-123&e=reader%40example.com&h=secret',
      },
    ]);
  });

  it('requires an explicit report path and a usable report identity', () => {
    const result = discoverBofaReportLinks(
      page(`
        <a href="/r">Missing redirect identity</a>
        <a href="/home?q=report-one">Wrong path</a>
        <a href="/report">Direct report page</a>
      `),
      'https://rsch.baml.com/research/today',
    );

    expect(result.links).toEqual([
      {
        id: 'bofa-report-1',
        title: 'Direct report page',
        url: 'https://rsch.baml.com/report',
      },
    ]);
  });
});
