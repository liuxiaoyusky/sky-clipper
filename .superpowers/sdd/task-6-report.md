# Task 6 Report: 串行捕获服务与 BofA 页面自动检测

## Status

Completed. The background service now serializes report capture work globally, and the sole content
script automatically observes eligible BofA report pages. This task does not add UI work, a URL
queue, entry discovery, browser control, or any change to archive transaction primitives.

## RED -> GREEN

1. Added the three requested focused test files before the service, observer, or status modules
   existed.
2. Ran:

   ```sh
   npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts
   ```

   RED occurred as expected: all three suites failed at import resolution because the three new
   modules did not exist.
3. Added the minimal serial capture service, bounded three-probe observer, and status presentation
   mapper. Replaced the old general-purpose background and content entrypoints with the specified
   BofA-only flow.
4. Re-ran the focused command: PASS, 3 files and 6 tests.
5. Refactoring was limited to the shared serial-promise continuation and the content-script local
   status helpers; no additional workflow was introduced.

## Delivered files

- `utils/research/capture-service.ts` — global concurrency-one submit queue, duplicate short
  circuit before archive IO, archive result/history handling, and redacted errors.
- `utils/research/observe.ts` — bounded stable-readiness polling with cancellation, timeout, and
  immediate auth handling.
- `utils/research/status.ts` — internal page status to user-facing label/tone mapping.
- `entrypoints/background.ts` — startup download-history sweep and guarded capture-message route.
- `entrypoints/content.ts` — BofA-only automatic page observation, settings re-evaluation, guarded
  status response, extraction, and background submission.
- `tests/research/capture-service.test.ts`
- `tests/research/observe.test.ts`
- `tests/research/status.test.ts`

## Verification

- Focused tests — PASS: 3 files, 6 tests.
- `npm test` — PASS: 12 files, 62 tests.
- `npm run compile` — PASS.
- `npm run build` — PASS.
- Built manifest declares one content-script match only: `https://rsch.baml.com/*`.
- `LC_ALL=C grep -n '[^ -~]' .output/chrome-mv3/content-scripts/content.js` returned no matches
  (the expected non-match exit status), confirming the built content script is ASCII-only.
- `git diff --check` — PASS.

## Self-review and remaining boundary

- All capture requests pass the Task 5 request guard; unknown messages receive no asynchronous
  response. Raw page/PDF URLs remain only in the request and unfinished archive operation; history,
  status, and externally returned errors use archive paths or redacted text.
- Complete history is written only after a complete archive result. Partial archive results persist
  partial history for retry; if history persistence itself fails after files save, the user receives
  a redacted partial result rather than a false complete result.
- The content script neither calls tab-closing APIs nor runs outside the BofA host match.
- Real BofA pages, Chrome Downloads, and Offscreen documents were not contacted during verification;
  tests use synthetic ports and DOM-independent evidence only.
