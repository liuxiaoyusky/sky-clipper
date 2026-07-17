# Security Policy

## Supported version

Security fixes apply to the latest authorized Fin-report-clipper release.

## Reporting a vulnerability

Use the repository's private vulnerability reporting. Do not put research URLs, report HTML/PDF, email addresses, tokens, signatures, credentials, or private documents in public issues or pull requests. Revoke exposed credentials before sharing sanitized technical details.

## Research artifact handling

Only synthetic sanitized fixtures belong in the repository. Real BofA files remain outside the repository and must not be copied into logs, test reports, commits, or release assets.

## Development toolchain

Production dependencies must pass `npm audit --omit=dev --audit-level=high`; critical development dependency findings are blocked. `npm run verify` is required before an authorized release.

## License boundary

The existing `LICENSE` remains authoritative. A release or redistribution must not proceed without the copyright holder authorization required by that license.
