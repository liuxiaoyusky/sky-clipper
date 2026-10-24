import { describe, expect, it, vi } from 'vitest';
import {
  MARKETS_TODAY_ENTRY_URL,
  isMarketsTodayEntryUrl,
  isMarketsTodayResultsUrl,
  prepareMarketsTodayDraft,
} from '@/utils/research/markets-today';
import {
  isMarketsTodayDraftRequest,
  isMarketsTodayRunClaimRequest,
  isMarketsTodayRunMutationRequest,
  isMarketsTodaySender,
} from '@/utils/research/messages';

function page(html: string): Document {
  const document = window.document.implementation.createHTMLDocument('BofA Markets');
  document.body.innerHTML = html;
  return document;
}

function reportAnchors(count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `<a
        href="javascript:void(0)"
        title="Open Report"
        onclick="javascript:getUrlFromWebserviceForIdHTML('https://rsch.baml.com/r?q=report-${index}&e=reader%40example.com&h=secret-${index}'); return false;"
      ><img alt="Html Report ${index} report opens in a new window" /></a>`,
  ).join('');
}

describe('BofA Markets Today entry automation', () => {
  it('accepts only the exact Advanced Search path', () => {
    expect(isMarketsTodayEntryUrl(MARKETS_TODAY_ENTRY_URL)).toBe(true);
    expect(isMarketsTodayEntryUrl(`${MARKETS_TODAY_ENTRY_URL}?submitted=true`)).toBe(true);
    expect(isMarketsTodayEntryUrl('https://markets.ml.com/researchlibrary')).toBe(false);
    expect(
      isMarketsTodayEntryUrl(
        'https://markets.ml.com/researchlibrary/advancedsearch/other',
      ),
    ).toBe(false);
    expect(
      isMarketsTodayResultsUrl(
        `${MARKETS_TODAY_ENTRY_URL}?dateRangeDropDown=CurrentDay`,
      ),
    ).toBe(true);
    expect(
      isMarketsTodayResultsUrl(
        `${MARKETS_TODAY_ENTRY_URL}?dateRangeDropDown=PastWeek`,
      ),
    ).toBe(false);
    expect(
      isMarketsTodayEntryUrl(
        'https://example.com/researchlibrary/advancedsearch',
      ),
    ).toBe(false);
  });

  it.each([
    ['login', '<input type="password" />', '页面需要登录或人工验证'],
    ['MFA', '<main>Enter your one-time passcode</main>', '页面需要登录或人工验证'],
    ['403', '<main>403 Forbidden</main>', 'BofA 暂时拒绝访问'],
    ['429', '<main>429 Too Many Requests</main>', 'BofA 暂时拒绝访问'],
  ])('stops before interacting for %s signals', async (_label, html, reason) => {
    const document = page(`
      ${html}
      <label>Date Range<select><option>Today</option></select></label>
      <button>Search</button>
    `);
    const search = document.querySelector('button')!;
    const click = vi.spyOn(search, 'click');

    await expect(
      prepareMarketsTodayDraft({
        document,
        sleep: async () => undefined,
        maximumAttempts: 1,
      }),
    ).resolves.toEqual({ kind: 'stopped', reason });
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    '<button type="button">Sign In</button>',
    '<a href="/login">Log In</a>',
    '<input type="submit" value="Sign In" />',
  ])('stops for a structured login action: %s', async (loginControl) => {
    const document = page(`
      ${loginControl}
      <form>
        <label>Date Range<select><option>Today</option></select></label>
        <button type="button">Search</button>
      </form>
    `);
    const search = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Search',
    )!;
    const click = vi.spyOn(search, 'click');

    await expect(
      prepareMarketsTodayDraft({
        document,
        sleep: async () => undefined,
        maximumAttempts: 1,
      }),
    ).resolves.toEqual({
      kind: 'stopped',
      reason: '页面需要登录或人工验证',
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('ignores unrelated sign-in wording on an authenticated Advanced Search page', async () => {
    const document = page(`
      <p>Read the guide about how clients sign in and log in to related services.</p>
      <form>
        <label>Date Range
          <select>
            <option value="all">All</option>
            <option value="today">Today</option>
          </select>
        </label>
        <button type="button">Search</button>
      </form>
      <section id="results"></section>
    `);
    document.querySelector('button')?.addEventListener('click', () => {
      document.getElementById('results')!.innerHTML = `
        <table><tbody>
          <tr><th>Search Results</th><td>1-1 of 1</td></tr>
          <tr><td>${reportAnchors(1)}</td></tr>
        </tbody></table>
      `;
    });

    const result = await prepareMarketsTodayDraft({
      document,
      sleep: async () => undefined,
      maximumAttempts: 1,
    });

    expect(document.querySelector('select')?.value).toBe('today');
    expect(result.kind).toBe('draft');
  });

  it('selects Today, searches, waits for results, and caps the draft at twenty', async () => {
    const document = page(`
      <form>
        <label for="date-range">Date Range</label>
        <select id="date-range">
          <option value="all">All</option>
          <option value="today">Today</option>
        </select>
        <button type="button">Search</button>
      </form>
      <section id="results"></section>
    `);
    const search = document.querySelector<HTMLButtonElement>('button')!;
    vi.spyOn(search, 'click').mockImplementation(() => {
      document.getElementById('results')!.innerHTML = `
        <table><tbody>
          <tr><th>Search Results</th><td>1-25 of 149</td></tr>
          <tr><td>${reportAnchors(25)}</td></tr>
        </tbody></table>
      `;
    });

    const result = await prepareMarketsTodayDraft({
      document,
      sleep: async () => undefined,
      maximumAttempts: 2,
      beforeSearch: async () => true,
    });

    expect(document.querySelector<HTMLSelectElement>('#date-range')?.value).toBe('today');
    expect(search.click).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('draft');
    if (result.kind !== 'draft') throw new Error('expected a draft');
    expect(result.links).toHaveLength(20);
    expect(result.truncated).toBe(true);
    expect(result.links[0].title).toBe('Report 0');
    expect(JSON.stringify(result.links.map(({ id, title }) => ({ id, title })))).not.toMatch(
      /reader|secret|@/,
    );
  });

  it('does not click Search when background execution permission is denied', async () => {
    const document = page(`
      <form>
        <label>Date Range<select><option value="today">Today</option></select></label>
        <button type="button">Search</button>
      </form>
    `);
    const search = document.querySelector<HTMLButtonElement>('button')!;
    const click = vi.spyOn(search, 'click');

    await expect(
      prepareMarketsTodayDraft({
        document,
        sleep: async () => undefined,
        maximumAttempts: 1,
        beforeSearch: async () => false,
      }),
    ).resolves.toEqual({
      kind: 'failed',
      reason: 'Today 搜索没有获得执行许可',
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('supports a labelled Today radio without clicking an unrelated global search', async () => {
    const document = page(`
      <button id="global-search">Search</button>
      <form id="advanced-search">
        <fieldset>
          <legend>Date Range</legend>
          <label><input type="radio" name="dateRange" value="week" />Past Week</label>
          <label><input type="radio" name="dateRange" value="today" />Today</label>
        </fieldset>
        <button id="form-search" type="button">Search</button>
      </form>
      <section id="results"></section>
    `);
    const globalSearch = document.querySelector<HTMLButtonElement>('#global-search')!;
    const formSearch = document.querySelector<HTMLButtonElement>('#form-search')!;
    vi.spyOn(globalSearch, 'click');
    vi.spyOn(formSearch, 'click').mockImplementation(() => {
      document.getElementById('results')!.innerHTML = `
        <table><tbody>
          <tr><th>Search Results</th><td>1-1 of 1</td></tr>
          <tr><td>${reportAnchors(1)}</td></tr>
        </tbody></table>
      `;
    });

    const result = await prepareMarketsTodayDraft({
      document,
      sleep: async () => undefined,
      maximumAttempts: 1,
    });

    expect(document.querySelector<HTMLInputElement>('input[value="today"]')?.checked).toBe(true);
    expect(globalSearch.click).not.toHaveBeenCalled();
    expect(formSearch.click).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('draft');
  });

  it('does not accept a Search Results table that existed before Search and did not change', async () => {
    const document = page(`
      <form>
        <label>Date Range<select><option value="today">Today</option></select></label>
        <button type="button">Search</button>
      </form>
      <table><tbody>
        <tr><th>Search Results</th><td>1-1 of 1</td></tr>
        <tr><td>${reportAnchors(1)}</td></tr>
      </tbody></table>
    `);
    const search = document.querySelector<HTMLButtonElement>('button')!;
    const click = vi.spyOn(search, 'click');

    await expect(
      prepareMarketsTodayDraft({
        document,
        sleep: async () => undefined,
        maximumAttempts: 2,
      }),
    ).resolves.toEqual({
      kind: 'failed',
      reason: 'Search Results 在等待时间内没有可处理的研报',
    });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('resumes a post-Search document without clicking Search again', async () => {
    const document = page(`
      <form>
        <label>Date Range
          <select>
            <option value="all">All</option>
            <option value="today" selected>Today</option>
          </select>
        </label>
        <button type="button">Search</button>
      </form>
      <table><tbody>
        <tr><th>Search Results</th><td>1-1 of 1</td></tr>
        <tr><td>${reportAnchors(1)}</td></tr>
      </tbody></table>
    `);
    const search = document.querySelector<HTMLButtonElement>('button')!;
    const click = vi.spyOn(search, 'click');

    const result = await prepareMarketsTodayDraft({
      document,
      sleep: async () => undefined,
      maximumAttempts: 3,
      resumeAfterSearch: true,
    });

    expect(click).not.toHaveBeenCalled();
    expect(result.kind).toBe('draft');
  });

  it('waits for the report identities to stabilize even when the table text is unchanged', async () => {
    const document = page(`
      <form>
        <label>Date Range<select><option value="today" selected>Today</option></select></label>
        <button type="button">Search</button>
      </form>
      <table><tbody>
        <tr><th>Search Results</th><td>1-1 of 1</td></tr>
        <tr id="report-row"><td>${reportAnchors(1)}</td></tr>
      </tbody></table>
    `);
    let sleeps = 0;

    const result = await prepareMarketsTodayDraft({
      document,
      maximumAttempts: 5,
      resumeAfterSearch: true,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2) {
          document.getElementById('report-row')!.innerHTML = reportAnchors(1)
            .replaceAll('report-0', 'report-new')
            .replaceAll('Report 0', 'Report New');
        }
      },
    });

    expect(result.kind).toBe('draft');
    if (result.kind !== 'draft') throw new Error('expected a draft');
    expect(result.links[0].title).toBe('Report New');
    expect(sleeps).toBe(4);
  });

  it('fails closed when a resumed page does not show Today', async () => {
    const document = page(`
      <form>
        <label>Date Range
          <select>
            <option value="all" selected>All</option>
            <option value="today">Today</option>
          </select>
        </label>
        <button type="button">Search</button>
      </form>
    `);
    const search = document.querySelector<HTMLButtonElement>('button')!;
    const click = vi.spyOn(search, 'click');

    await expect(
      prepareMarketsTodayDraft({
        document,
        sleep: async () => undefined,
        maximumAttempts: 1,
        resumeAfterSearch: true,
      }),
    ).resolves.toEqual({
      kind: 'failed',
      reason: '搜索后的页面没有明确显示 Date Range = Today',
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('fails closed instead of clicking result controls when no report URL is inspectable', async () => {
    const document = page(`
      <form>
        <select aria-label="Date Range"><option>Today</option></select>
        <button type="button">Search</button>
      </form>
      <table><tbody>
        <tr><th>Search Results</th><td>1-1 of 1</td></tr>
        <tr><td>
          <a
            href="javascript:void(0)"
            title="Open Report"
            onclick="window.open('https://rsch.baml.com/r?q=must-not-be-guessed')"
          >
            <img alt="Html Opaque Report report opens in a new window" />
          </a>
        </td></tr>
      </tbody></table>
    `);
    const reportControl = document.querySelector<HTMLAnchorElement>('a')!;
    const click = vi.spyOn(reportControl, 'click');

    await expect(
      prepareMarketsTodayDraft({
        document,
        sleep: async () => undefined,
        maximumAttempts: 1,
      }),
    ).resolves.toEqual({
      kind: 'failed',
      reason: 'Search Results 在等待时间内没有可处理的研报',
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('fails closed when the Date Range or Search Results contract is unavailable', async () => {
    await expect(
      prepareMarketsTodayDraft({
        document: page('<button>Search</button>'),
        sleep: async () => undefined,
        maximumAttempts: 1,
      }),
    ).resolves.toEqual({
      kind: 'failed',
      reason: '找不到 Date Range 的 Today 选项',
    });

    await expect(
      prepareMarketsTodayDraft({
        document: page(`
          <label>Date Range<select><option>Today</option></select></label>
          <button>Search</button>
        `),
        sleep: async () => undefined,
        maximumAttempts: 1,
      }),
    ).resolves.toEqual({
      kind: 'failed',
      reason: 'Search Results 在等待时间内没有可处理的研报',
    });
  });
});

describe('BofA Markets draft message boundary', () => {
  const request = {
    target: 'background',
    type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_DRAFT',
    runId: 'markets-run-00000001',
    links: [
      {
        id: 'bofa-report-1',
        title: 'Report 1',
        url: 'https://rsch.baml.com/r?q=report-1&e=reader%40example.com&h=secret',
      },
    ],
    truncated: false,
  } as const;

  it('accepts a bounded transient BofA draft and rejects extra or unsupported data', () => {
    expect(isMarketsTodayDraftRequest(request)).toBe(true);
    expect(isMarketsTodayDraftRequest({ ...request, runId: 'bad id' })).toBe(false);
    expect(isMarketsTodayDraftRequest({ ...request, autoConfirm: true })).toBe(false);
    expect(
      isMarketsTodayDraftRequest({
        ...request,
        links: [{ ...request.links[0], url: 'https://example.com/report' }],
      }),
    ).toBe(false);
    expect(
      isMarketsTodayDraftRequest({
        ...request,
        links: Array.from({ length: 21 }, (_, index) => ({
          ...request.links[0],
          id: `report-${index}`,
        })),
      }),
    ).toBe(false);
  });

  it('accepts only a strict run claim request', () => {
    expect(
      isMarketsTodayRunClaimRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_CLAIM',
      }),
    ).toBe(true);
    expect(
      isMarketsTodayRunClaimRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_CLAIM',
        runId: 'injected',
      }),
    ).toBe(false);
    expect(
      isMarketsTodayRunMutationRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_ISSUE_SEARCH',
        runId: 'markets-run-00000001',
      }),
    ).toBe(true);
    expect(
      isMarketsTodayRunMutationRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_MARKETS_TODAY_RUN_STOP',
        runId: 'bad id',
      }),
    ).toBe(false);
  });

  it('trusts only the extension content script on the exact Markets path', () => {
    expect(
      isMarketsTodaySender(
        {
          id: 'extension-id',
          frameId: 0,
          documentId: 'document-0001',
          url: `${MARKETS_TODAY_ENTRY_URL}?submitted=true`,
          tab: { id: 11, url: `${MARKETS_TODAY_ENTRY_URL}?submitted=true` },
        } as chrome.runtime.MessageSender,
        'extension-id',
      ),
    ).toBe(true);
    expect(
      isMarketsTodaySender(
        {
          id: 'extension-id',
          frameId: 0,
          documentId: 'document-0002',
          url: 'https://markets.ml.com/',
          tab: { id: 11, url: 'https://markets.ml.com/' },
        } as chrome.runtime.MessageSender,
        'extension-id',
      ),
    ).toBe(false);
    expect(
      isMarketsTodaySender(
        {
          id: 'extension-id',
          frameId: 1,
          documentId: 'document-0003',
          url: MARKETS_TODAY_ENTRY_URL,
          tab: { id: 11, url: MARKETS_TODAY_ENTRY_URL },
        } as chrome.runtime.MessageSender,
        'extension-id',
      ),
    ).toBe(false);
  });
});
