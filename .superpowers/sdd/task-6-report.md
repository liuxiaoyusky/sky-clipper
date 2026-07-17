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

## Review 1 follow-up: RED -> GREEN

### RED

Added focused regression coverage before changing production code:

- forged non-top-frame/non-BofA senders, unknown submission properties, uncanonical persisted
  source, and a non-BofA transient PDF URL are rejected by the message guard;
- an abandoned `storage.session` capture lease blocks a new write until startup sweep and lease
  removal finish; a sweep failure returns a redacted recovery failure and does not construct IO;
- a canonical BofA URL/sourceId run key cancels the old generation and accepts a distinct report
  after same-document navigation.

Command:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts
```

Result: FAIL as expected — 4 new assertions failed because there was no sender validator, startup
recovery/lease implementation, or run-key controller.

### GREEN

- `isCaptureRequest()` now has an exact top-level/submission/document allowlist and validates the
  BofA schema, canonical persisted source, timestamp/hash shapes, metadata values, and optional
  transient BofA HTTPS PDF URL. `isBofaCaptureSender()` requires this extension, frame `0`, and a
  BofA HTTPS tab/page sender.
- Startup recovery now sweeps before capture processing starts, clears a stale session lease after
  sweep, and wraps every actual serial capture in a session lease. Recovery/lease errors are
  redacted and never reported as a silent complete result.
- The content script uses a sanitized canonical URL/sourceId key and a generation controller. It
  invalidates old work before probes, extraction, sending, and result application; history API and
  browser navigation events start a new report run.

Final verification:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts
# PASS: 4 files, 16 tests
npm test
# PASS: 12 files, 66 tests
npm run compile
# PASS
npm run build
# PASS
git diff --check
# PASS
```

The built manifest still has only `https://rsch.baml.com/*` as a content-script match. The ASCII
scan of the built content script returned no matches (expected non-match exit status).

## Review 1 self-review

Only Task 6 flow files and the necessary message-contract test/module changed. The implementation
does not add URL discovery/queues, browser control, or tab closing. The session marker contains
only a generated timestamp, raw sender/page/PDF URLs remain transient, and no external error,
status, storage record, or log receives them. Startup recovery is intentionally scoped to the
single service-worker lifecycle and Chrome's `storage.session` lifetime.
