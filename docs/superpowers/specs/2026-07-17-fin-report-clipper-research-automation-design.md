# Fin Report Clipper Research Automation Design

**Status:** Draft for written review; conversational design approved

**Date:** 2026-07-17

**Initial delivery target:** Phase 1 only

## 1. Summary

Fin Report Clipper evolves the existing browser clipper into two deliberately separate workflows:

1. **Manual web clipping** keeps the current preview-and-save flow, including the existing optional Obsidian URI and Local REST API targets.
2. **Research automation** detects approved financial-research pages, preserves the original HTML/PDF content, and always writes a local archive under the browser Downloads directory.

The research workflow is capture-first. It does not summarize, classify, tag, or publish to Obsidian while capturing. Those operations are optional asynchronous processors that consume the saved original later.

The first supported institution is BofA Global Research. Nomura and Citi follow as independent site adapters after real samples are available.

## 2. Goals

- Rename the product to **Fin Report Clipper**.
- Automatically detect supported research-content pages in a normal visible Chrome or Edge session.
- Preserve HTML reports as faithful Markdown, with the original PDF when one is available.
- Accept URLs from direct import or from links discovered on an approved entry page.
- Process queued reports sequentially and conservatively.
- Always archive research captures under `Downloads/Fin Report Clipper Backup/`.
- Use source IDs and content hashes to avoid duplicates while retaining revised reports.
- Preserve optional and provider-specific metadata without forcing every report into a fixed equity-report schema.
- Keep the original capture immutable and move tags, normalization, summaries, and Obsidian publishing into asynchronous processors.
- Preserve all existing manual clipping and Obsidian behavior during the rebrand.

## 3. Non-goals

The initial program does not include:

- Email or mailbox scanning.
- AI summaries, generated classifications, or automatic tags during capture.
- Automatic publishing of research captures to Obsidian.
- OCR during the capture transaction.
- Infinite pagination, broad site crawling, or discovery outside approved entry pages.
- Headless browsers, Playwright-driven page interaction, stealth plugins, fingerprint spoofing, or CAPTCHA bypass.
- Automatic login, access-control bypass, or repeated retries after 403/429 responses.
- A login item, persistent daemon, or required local file service.
- A promise that automated navigation is undetectable.

## 4. Product naming and compatibility

User-facing names are:

- Product and extension: `Fin Report Clipper`
- npm package and CLI: `fin-report-clipper`
- Release artifacts: `fin-report-clipper-<browser>.zip`
- Research backup root: `Fin Report Clipper Backup`

The rebrand must not destroy existing user state. Existing manual-clipping settings, vault profiles, REST credentials, and highlights remain readable.

Phase 1 avoids a risky mass rename of every internal identifier. Existing `zhaoji_clipper_*` storage records and compatible DOM markers remain readable. New research-only records use a `fin_report_clipper_research_*` prefix. A later migration may copy legacy records to new keys, but old records are not deleted as part of the initial release.

## 5. Architecture decision

The selected architecture is **extension-led capture with an optional one-shot launcher**.

```text
Normal visible Chrome/Edge
        |
        v
Fin Report Clipper extension
        |
        +-- content-page detector
        +-- entry-page link discovery
        +-- persistent URL queue
        +-- institution adapter
        +-- PDF preservation/extraction
        +-- Downloads archive writer

Optional one-shot CLI
        |
        +-- opens the normal browser
        +-- transfers direct URLs into the extension queue
        +-- exits after handoff
```

The extension owns all in-page detection and extraction so the manual and automated paths do not grow separate parsing implementations.

The launcher never uses WebDriver or a headless browser. For one URL it opens that URL through the operating system. For a list, it may temporarily serve a tokenized loopback intake page, open that page in the normal browser, wait for the extension to acknowledge the import, and then exit. It does not install a login item or leave a listening service behind.

## 6. Research adapter boundary

Each institution implements an isolated adapter:

```ts
interface ResearchSiteAdapter {
  id: string;
  classifyPage(): Promise<
    | 'report-html'
    | 'report-pdf'
    | 'entry-page'
    | 'auth-required'
    | 'unsupported'
  >;
  isPageReady(): Promise<boolean>;
  discoverLinks(): Promise<DiscoveredLink[]>;
  extractOriginal(): Promise<CapturedDocument>;
  findOriginalPdf(): Promise<string | null>;
  getSourceId(): Promise<string | null>;
  canonicalizeUrl(url: string): CanonicalResearchUrl;
}
```

Provider selectors, URL patterns, report IDs, readiness rules, disclosure boundaries, and PDF-link discovery remain inside the provider adapter. Only stable cross-provider behavior belongs in shared modules.

The initial BofA adapter uses the supplied saved HTML sample as evidence that the report page contains a full HTML document, stable metadata fields, many paragraphs and tables, and a separate PDF action. The raw supplied sample must never be committed because it contains personalized access parameters and third-party injected markup. A sanitized fixture will be produced during implementation.

## 7. Original-first document model

The capture model intentionally permits absent and provider-specific fields:

```ts
type MetadataValue = string | number | boolean | string[] | number[];

interface CapturedDocument {
  schema: 'fin-report-clipper/capture-v1';
  provider: string;
  sourceType: 'html' | 'pdf' | 'html+pdf';
  sourceId?: string;
  title?: string;
  publishedAt?: string;
  observedMetadata: Record<string, MetadataValue>;
  originalMarkdown: string;
  originalPdf?: Blob;
  assets: CapturedAsset[];
  sanitizedSource: string;
  capturedAt: string;
  contentHash: string;
  captureStatus: 'complete' | 'partial';
}
```

Rules:

- Only source-observed values are written.
- Missing values are omitted rather than emitted as empty strings.
- Authors, companies, securities, and tickers are arrays when present.
- A report may have zero, one, or many tickers.
- Macro, thematic, strategy, and multi-company reports remain valid without an equity-specific schema.
- Provider-only data is retained in `observedMetadata` instead of being discarded or guessed into a common field.
- Generated tags, sentiment, recommendations, and summaries are absent from the capture model.

## 8. Original Markdown

`original.md` has minimal, source-grounded frontmatter:

```markdown
---
schema: fin-report-clipper/capture-v1
provider: BofA Global Research
source_id: "provider-report-id"
source_type: html+pdf
captured: 2026-07-17T16:30:00+09:00
capture_status: complete
content_hash: sha256:...
---

# Original report title

Faithfully converted report body...
```

Fields such as `published`, `authors`, `companies`, and `tickers` appear only when the source explicitly provides them.

The body preserves the source order, headings, paragraphs, tables, disclosures, links, and usable images. The capture layer does not rewrite the argument, shorten the report, or insert an interpretation.

## 9. Archive layout

Research captures always write to a relative browser-download path:

```text
Downloads/
└── Fin Report Clipper Backup/
    └── BofA/
        └── 2026/
            └── 2026-07-17-report-title-short-id/
                ├── original.md
                ├── original.pdf
                ├── assets/
                ├── derived/
                └── .fin-report-clipper/
                    └── capture.json
```

Artifact rules:

- `original.md` is always attempted.
- `original.pdf` is written when the provider exposes a downloadable PDF.
- `assets/` contains images that can be preserved reliably.
- `derived/` is reserved for optional asynchronous outputs.
- `.fin-report-clipper/capture.json` stores source-observed metadata, extractor version, checksums, warnings, and the file manifest.
- Raw unsanitized full-page HTML is not archived by default because it may contain personalized URLs, injected extension markup, and executable site code.

`capture.json` is written last and acts as the bundle-completion marker. A directory without a complete manifest is recoverable but not considered a completed archive.

The browser Downloads API may write only beneath the Downloads root. The configured relative backup root defaults to `Fin Report Clipper Backup/`.

## 10. URL privacy and canonicalization

The system separates the URL needed to open a pending task from the source identity safe to archive.

- The raw URL is stored only in the local pending task record.
- Email addresses, access tokens, signatures, and nonessential query parameters are removed from exported Markdown, manifests, logs, and UI.
- Completed task history drops the raw URL and retains only the provider, source ID, sanitized origin/path, and content hash.
- Provider adapters define an allowlist of query parameters that are safe and structurally required.
- Error messages never include a full raw URL.

## 11. Deduplication and revisions

Deduplication occurs in three stages:

1. **Before opening:** compare a normalized link key against queued and completed tasks.
2. **After page readiness:** prefer the provider's stable source/report ID.
3. **After extraction:** compute a SHA-256 hash of the normalized original Markdown.

Identity priority is:

1. Provider plus stable report/document ID.
2. Provider PDF/document identifier.
3. Provider plus normalized title, publication date, and source-observed authors.
4. Normalized Markdown content hash.

If the source ID and content hash both match, the task is a duplicate and no files are downloaded again. If a known source ID has a new content hash, the capture is retained as a revision rather than overwriting the older archive.

## 12. Detection and queue state machine

The extension only observes provider domains explicitly enabled in the research allowlist.

```text
observing
  -> unsupported
  -> auth-paused
  -> discovering (entry page)
  -> waiting-ready (report page)

queued -> opening -> waiting-ready -> extracting -> saving
       -> duplicate
       -> completed
       -> partial
       -> paused-auth
       -> failed
```

Readiness uses adapter evidence instead of one fixed sleep:

- A report title or stable source ID exists.
- The expected content container exists.
- Content length is stable across consecutive observations.
- The PDF link has appeared or the adapter has concluded that none exists.
- No login, access-denied, CAPTCHA, or transient error view is active.

The persistent queue is stored in `chrome.storage.local`. If the browser exits during an intermediate state, `opening`, `waiting-ready`, `extracting`, and `saving` tasks return to `queued` on recovery.

The pending raw URL is deleted after a completed, duplicate, or intentionally discarded task.

## 13. URL intake

### Direct URL import

The research dashboard accepts one or more pasted URLs. It classifies, canonicalizes, de-duplicates, and enqueues approved provider URLs.

### Entry-page discovery

An approved entry page may contribute report links already present in the loaded DOM.

Initial limits:

- Discover only links matching enabled provider rules.
- Do not crawl arbitrary same-site links.
- Do not automatically traverse pagination or infinite scrolling.
- Enqueue at most 20 new reports per run by default.
- Require an explicit registered entry-page rule or a user-triggered scan.

Provider-specific pagination can be added later only when a real entry-page sample proves it necessary.

## 14. Conservative execution and bot-detection boundary

The launcher itself does not add common automation-browser fingerprints because it opens the ordinary visible browser and does not use WebDriver, Playwright page control, headless mode, CDP injection, or stealth tooling.

This does not make the overall workflow undetectable. A research site may still identify unusual behavior from request rate, repetitive navigation, download volume, session changes, or account policy signals.

The product therefore enforces conservative defaults:

- Concurrency is always one.
- One report is fully saved before another is opened.
- The default run limit is 20 new reports.
- A normal transient failure may be retried once.
- Authentication views, CAPTCHA, 403, and 429 pause the whole queue and require human action.
- Automatically opened tabs may close after a verified save.
- User-opened tabs are never closed by automation.
- No random behavior intended to mimic a human is added.
- No access-control or CAPTCHA bypass is attempted.

The product describes this accurately as conservative browser automation, not as bot-proof automation.

## 15. PDF handling

PDF handling is also original-first:

1. Save the original PDF as soon as it is available.
2. Attempt text extraction separately.

For text PDFs, an extension offscreen task using PDF.js produces page-ordered Markdown with explicit page boundaries. It does not invent heading levels or table structure when layout evidence is ambiguous.

For scanned or extraction-resistant PDFs, the original PDF is retained and the capture is marked `partial`. OCR is an optional asynchronous processor, not part of the capture transaction.

Direct PDF URLs and embedded PDF viewers require provider-aware URL detection because the browser's built-in PDF viewer is not a reliable content-script surface.

## 16. Asynchronous processor contract

Capture success never waits for tags, normalization, summaries, or Obsidian publishing.

Optional processors consume the original bundle and write only under `derived/` or to an explicitly selected downstream destination.

```ts
interface ProcessingJob {
  documentPath: string;
  inputHash: string;
  processor: string;
  processorVersion: string;
}

interface ProcessingResult {
  inputHash: string;
  processor: string;
  status: 'completed' | 'failed' | 'skipped';
  outputFiles: string[];
  generatedAt: string;
  error?: string;
}
```

Candidate processors are:

- Research tagging.
- Metadata normalization.
- Research-note generation.
- OCR and table recovery.
- Publishing an enriched working copy to Obsidian.

The default rule is that processors do not modify `original.md` or `original.pdf`.

## 17. User interface

The existing popup keeps the manual clipping workflow.

A separate Research dashboard provides:

- Global research auto-capture toggle.
- Per-provider toggles.
- Multiline direct URL import.
- Scan-current-entry-page action.
- Queue pause/resume.
- Counts for queued, processing, saved, partial, and action-required tasks.
- Per-task retry and archive-open actions.
- Sanitized error details and extractor version.

User-facing states remain simple:

- **Saved:** the original archive is complete.
- **Partially saved:** at least one original artifact is retained, but Markdown or assets are incomplete.
- **Action required:** login, CAPTCHA, access limit, or storage failure requires the user.

Internal queue states are not exposed as product vocabulary.

## 18. Error handling

| Condition | Behavior |
|---|---|
| Authentication expired or CAPTCHA | Pause the full queue and wait for the user |
| HTTP 403 or 429 | Pause without automatic retry |
| Transient page/network failure | Retry the task once |
| HTML extraction failure with PDF available | Save PDF and mark partial |
| PDF text extraction failure | Preserve PDF and mark partial |
| Download interruption | Keep the task recoverable; do not write a complete manifest |
| Exact duplicate | Record duplicate and do not download again |
| Same source ID with changed content | Preserve a revision |

## 19. Delivery phases

### Phase 1: Rebrand, capture foundation, and BofA HTML

- User-facing rename to Fin Report Clipper.
- Preserve manual clipping and Obsidian behavior.
- Add research types, BofA adapter, sanitized URL identity, content hash, and Downloads archive writer.
- Auto-detect a manually opened BofA HTML report.
- Save faithful `original.md` and exposed PDF.
- Validate against a sanitized local fixture and a real logged-in browser session.

### Phase 2: Queue and entry-page discovery

- Persistent queue.
- Direct multi-URL import.
- Approved entry-page link discovery.
- Sequential tab lifecycle.
- Pause, resume, recovery, and dashboard.

### Phase 3: One-shot launcher

- `fin-report-clipper run <url>`.
- `fin-report-clipper run <file>`.
- Normal visible Chrome/Edge startup and ephemeral URL handoff.
- No daemon, login item, or browser-driving framework.

### Phase 4: PDF extraction

- PDF.js offscreen extraction for text PDFs.
- Page boundaries and partial-state handling.
- Scanned-PDF preservation without synchronous OCR.

### Phase 5: Nomura and Citi

- One independent adapter per provider.
- Real HTML, PDF, and entry-page samples before implementation.
- Provider-specific browser acceptance tests.

### Phase 6: Optional asynchronous processors

- Tagging.
- Metadata normalization.
- Research-note generation.
- OCR/table recovery.
- Obsidian publication.

Each phase receives its own implementation plan and verification gate. The first implementation plan covers Phase 1 only.

## 20. Verification strategy

### Unit and fixture tests

- Sensitive-query removal and safe URL canonicalization.
- Optional metadata omission.
- Multiple authors, companies, and tickers.
- Stable directory naming.
- Source-ID and content-hash duplicate detection.
- Revision behavior.
- Queue transition and recovery logic.
- Manifest written only after all required downloads complete.
- Sanitized BofA fixture extraction.

### Browser integration tests

- Manually open a supported BofA report and capture it once.
- Open the same report again and observe a duplicate without new files.
- Capture a changed report revision without overwriting the old one.
- Confirm personalized URL parameters are absent from exported files and UI.
- Confirm user-opened tabs remain open.
- Confirm auth/403/429 conditions pause the queue.
- Confirm a browser restart recovers unfinished tasks.
- Confirm the backup path and artifact names under Chrome and Edge.

### PDF tests

- Text PDF produces original PDF plus page-ordered Markdown.
- Scanned PDF preserves the PDF and reports partial completion.
- Failed PDF text extraction does not delete or invalidate the original PDF.

### Legacy regression tests

- Existing manual generic clipping still works.
- Existing site adapters still work.
- Existing Obsidian URI and Local REST API manual saves still work.
- Existing settings, profiles, secrets, and highlights remain readable.
- TypeScript compilation and Chrome/Edge production builds pass.
- Generated content script remains ASCII-compatible.

## 21. Phase 1 acceptance criteria

Phase 1 is complete only when all of the following are demonstrated:

1. The extension displays the Fin Report Clipper name without losing existing manual settings.
2. A supported BofA HTML report is detected only on the approved content-page contract.
3. `original.md` preserves report structure and source-observed metadata without generated tags or summaries.
4. An exposed original PDF is downloaded alongside the Markdown.
5. The archive is created under `Downloads/Fin Report Clipper Backup/`.
6. Sensitive URL parameters do not appear in exported artifacts, UI, or error logs.
7. Reopening the same report does not create another archive.
8. A changed report with the same source ID is retained as a revision.
9. Existing manual clipping and manual Obsidian saves still pass regression checks.
10. Chrome and Edge production builds and the focused browser acceptance test pass.
