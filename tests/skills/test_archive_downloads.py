from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / ".agents/skills/archive-fin-reports/scripts/archive_downloads.py"
HASH = "sha256:" + "a" * 64


def load_archiver():
    spec = importlib.util.spec_from_file_location("archive_downloads_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load archive script")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ARCHIVER = load_archiver()


def markdown(
    status: str,
    captured: str,
    title: str = "Taiwan Semiconductor Manufacturing Co.",
    source_type: str = "html+pdf",
    source: str = "https://rsch.baml.com/report",
    source_id: str = "12995258",
    content_hash: str = HASH,
) -> str:
    return f'''---
schema: fin-report-clipper/capture-v1
provider: "BofA Global Research"
source_id: "{source_id}"
source_type: {source_type}
source: "{source}"
captured: "{captured}"
capture_status: {status}
content_hash: {content_hash}
---

# {title}

Original report body.
'''


class ArchiveDownloadsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.downloads = self.root / "Downloads"
        self.archive = self.downloads / "Fin-report-clipper Backup"
        self.downloads.mkdir()
        self.now = time.time()
        self.captured = datetime.fromtimestamp(self.now, tz=timezone.utc).isoformat()
        self.trusted_hosts: dict[Path, str] = {}

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, name: str, content: str | bytes, offset: float) -> Path:
        path = self.downloads / name
        if isinstance(content, str):
            path.write_text(content, encoding="utf-8")
        else:
            path.write_bytes(content)
        timestamp = self.now + offset
        os.utime(path, (timestamp, timestamp))
        return path

    def trust_pdf(self, path: Path, host: str = "research1.ml.com") -> None:
        self.trusted_hosts[path.resolve()] = host

    def fake_origin_hosts(self, path: Path) -> set[str] | None:
        host = self.trusted_hosts.get(path.resolve())
        return {host} if host else None

    def run_script(self, *extra: str) -> tuple[subprocess.CompletedProcess[str], dict]:
        arguments = [
            "--downloads-dir",
            str(self.downloads),
            "--archive-root",
            str(self.archive),
            *extra,
        ]
        stdout = io.StringIO()
        stderr = io.StringIO()
        with mock.patch.object(ARCHIVER, "origin_hosts", side_effect=self.fake_origin_hosts):
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                returncode = ARCHIVER.main(arguments)
        completed = subprocess.CompletedProcess(
            [sys.executable, str(SCRIPT), *arguments],
            returncode,
            stdout.getvalue(),
            stderr.getvalue(),
        )
        return completed, json.loads(completed.stdout)

    def prepare_unique_batch(self) -> tuple[Path, Path, Path, Path]:
        partial = self.write("partial.md", markdown("partial", self.captured), -7)
        pdf = self.write("download.pdf", b"%PDF-1.7\nfixture", -1)
        self.trust_pdf(pdf)
        complete = self.write("complete.md", markdown("complete", self.captured), 0)
        unrelated = self.write("unrelated.pdf", b"%PDF-1.7\nunrelated", 0)
        return partial, pdf, complete, unrelated

    def test_preview_identifies_files_without_moving_them(self) -> None:
        partial, pdf, complete, unrelated = self.prepare_unique_batch()

        completed, result = self.run_script()

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["markdown"], complete.name)
        self.assertEqual(result["pdf"], pdf.name)
        self.assertEqual(result["staging_markdown"], partial.name)
        for path in (partial, pdf, complete, unrelated):
            self.assertTrue(path.exists())
        self.assertFalse(self.archive.exists())

    def test_apply_moves_only_the_unique_report_batch_and_writes_manifest(self) -> None:
        partial, pdf, complete, unrelated = self.prepare_unique_batch()

        completed, result = self.run_script("--apply")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["status"], "archived")
        target = self.archive / result["target"]
        self.assertTrue((target / "original.md").is_file())
        self.assertTrue((target / "original.pdf").is_file())
        self.assertTrue((target / ".fin-report-clipper/staging-partial.md").is_file())
        manifest = json.loads(
            (target / ".fin-report-clipper/capture.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["content_hash"], HASH)
        self.assertNotIn("WhereFroms", json.dumps(manifest))
        self.assertTrue(unrelated.exists())
        for path in (partial, pdf, complete):
            self.assertFalse(path.exists())

    def test_equal_pdf_candidates_are_ambiguous_and_nothing_moves(self) -> None:
        complete = self.write("complete.md", markdown("complete", self.captured), 0)
        first = self.write("download.pdf", b"%PDF-1.7\nfirst", -1)
        second = self.write("download (1).pdf", b"%PDF-1.7\nsecond", 1)
        self.trust_pdf(first)
        self.trust_pdf(second)

        completed, result = self.run_script("--apply")

        self.assertEqual(completed.returncode, 3)
        self.assertEqual(result["status"], "ambiguous")
        self.assertTrue(complete.exists())
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())
        self.assertFalse(self.archive.exists())

    def test_ordinary_markdown_is_ignored(self) -> None:
        note = self.write("notes.md", "# Ordinary notes\n", 0)
        self.write("download.pdf", b"%PDF-1.7\nfixture", 0)

        completed, result = self.run_script()

        self.assertEqual(completed.returncode, 2)
        self.assertEqual(result["status"], "no-match")
        self.assertTrue(note.exists())
        self.assertFalse(self.archive.exists())

    def test_pdf_without_origin_is_not_guessed_from_its_filename(self) -> None:
        complete = self.write("complete.md", markdown("complete", self.captured), 0)
        pdf = self.write("download.pdf", b"%PDF-1.7\nfixture", 0)

        completed, result = self.run_script("--apply")

        self.assertEqual(completed.returncode, 2)
        self.assertEqual(result["status"], "no-match")
        self.assertTrue(complete.exists())
        self.assertTrue(pdf.exists())
        self.assertFalse(self.archive.exists())

    def test_html_only_report_does_not_require_a_pdf(self) -> None:
        complete = self.write(
            "complete.md",
            markdown("complete", self.captured, source_type="html"),
            0,
        )

        completed, result = self.run_script("--apply")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["status"], "archived")
        target = self.archive / result["target"]
        self.assertTrue((target / "original.md").is_file())
        self.assertFalse((target / "original.pdf").exists())
        self.assertFalse(complete.exists())

    def test_existing_target_is_never_overwritten(self) -> None:
        _partial, _pdf, complete, _unrelated = self.prepare_unique_batch()
        preview, plan = self.run_script()
        self.assertEqual(preview.returncode, 0)
        target = self.archive / plan["target"]
        target.mkdir(parents=True)
        sentinel = target / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")

        completed, result = self.run_script("--apply")

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(result["status"], "target-exists")
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
        self.assertTrue(complete.exists())

    def test_signed_source_is_rejected_without_printing_secrets(self) -> None:
        secret = "private-signed-token"
        report = self.write(
            "complete.md",
            markdown(
                "complete",
                self.captured,
                source=f"https://rsch.baml.com/r?q={secret}&e=private@example.com&h=signature",
            ),
            0,
        )
        pdf = self.write("download.pdf", b"%PDF-1.7\nfixture", 0)
        self.trust_pdf(pdf)

        completed, result = self.run_script("--apply")

        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertEqual(result["status"], "no-match")
        combined = completed.stdout + completed.stderr
        self.assertNotIn(secret, combined)
        self.assertNotIn("private@example.com", combined)
        self.assertTrue(report.exists())
        self.assertTrue(pdf.exists())
        self.assertFalse(self.archive.exists())

    def test_pdf_outside_pair_window_is_not_moved(self) -> None:
        complete = self.write("complete.md", markdown("complete", self.captured), 0)
        pdf = self.write("download.pdf", b"%PDF-1.7\nfixture", 31)
        self.trust_pdf(pdf)

        completed, result = self.run_script("--apply")

        self.assertEqual(completed.returncode, 2)
        self.assertEqual(result["status"], "no-match")
        self.assertTrue(complete.exists())
        self.assertTrue(pdf.exists())
        self.assertFalse(self.archive.exists())

    def test_manifest_failure_keeps_sources_and_removes_staging_copy(self) -> None:
        partial, pdf, complete, unrelated = self.prepare_unique_batch()
        preview, plan = self.run_script()
        self.assertEqual(preview.returncode, 0)
        output = io.StringIO()

        with mock.patch.object(ARCHIVER, "origin_hosts", side_effect=self.fake_origin_hosts):
            with mock.patch.object(ARCHIVER, "write_manifest", side_effect=OSError("fixture")):
                with contextlib.redirect_stdout(output):
                    code = ARCHIVER.main(
                        [
                            "--downloads-dir",
                            str(self.downloads),
                            "--archive-root",
                            str(self.archive),
                            "--apply",
                        ]
                    )

        result = json.loads(output.getvalue())
        self.assertEqual(code, 4)
        self.assertEqual(result["status"], "error")
        for path in (partial, pdf, complete, unrelated):
            self.assertTrue(path.exists())
        self.assertFalse((self.archive / plan["target"]).exists())
        self.assertEqual(list(self.archive.rglob("*.archiving-*")), [])

    def test_origin_reader_supports_posix_xattr_api(self) -> None:
        pdf = self.write("report.pdf", b"%PDF-1.7\nfixture", 0)
        raw = plistlib.dumps(["https://research1.ml.com/report"], fmt=plistlib.FMT_BINARY)

        def posix_getxattr(_path: Path, attribute: str) -> bytes:
            if attribute.startswith("user."):
                return raw
            raise OSError("namespace unavailable")

        with mock.patch.object(
            ARCHIVER.os,
            "getxattr",
            side_effect=posix_getxattr,
            create=True,
        ):
            self.assertEqual(ARCHIVER.origin_hosts(pdf), {"research1.ml.com"})

    def test_date_preview_lists_every_bofa_complete_report_for_local_date(self) -> None:
        captured = datetime.fromtimestamp(self.now, tz=timezone.utc)
        local_date = captured.astimezone().date().isoformat()
        previous = (captured - timedelta(days=1)).isoformat()
        first = self.write(
            "first.md",
            markdown(
                "complete",
                captured.isoformat(),
                title="First report",
                source_type="html",
                source_id="first",
                content_hash="sha256:" + "b" * 64,
            ),
            -2,
        )
        second = self.write(
            "second.md",
            markdown(
                "complete",
                captured.isoformat(),
                title="Second report",
                source_type="html",
                source_id="second",
                content_hash="sha256:" + "c" * 64,
            ),
            -1,
        )
        older = self.write(
            "older.md",
            markdown(
                "complete",
                previous,
                title="Older report",
                source_type="html",
                source_id="older",
                content_hash="sha256:" + "d" * 64,
            ),
            0,
        )

        completed, result = self.run_script("--date", local_date)

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["scope"], {"provider": "BofA", "date": local_date})
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["counts"], {"ready": 2})
        self.assertEqual(
            {item["markdown"] for item in result["items"]},
            {first.name, second.name},
        )
        for path in (first, second, older):
            self.assertTrue(path.exists())
        self.assertFalse(self.archive.exists())

    def test_today_is_a_local_date_batch_alias(self) -> None:
        captured = datetime.now(tz=timezone.utc)
        complete = self.write(
            "today.md",
            markdown(
                "complete",
                captured.isoformat(),
                source_type="html",
                source_id="today",
                content_hash="sha256:" + "e" * 64,
            ),
            0,
        )

        completed, result = self.run_script("--today")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["scope"]["date"], captured.astimezone().date().isoformat())
        self.assertEqual([item["markdown"] for item in result["items"]], [complete.name])
        self.assertTrue(complete.exists())

    def test_batch_apply_archives_safe_groups_and_preserves_ambiguous_group(self) -> None:
        captured = datetime.fromtimestamp(self.now, tz=timezone.utc)
        local_date = captured.astimezone().date().isoformat()
        safe = self.write(
            "safe.md",
            markdown(
                "complete",
                captured.isoformat(),
                title="Safe HTML report",
                source_type="html",
                source_id="safe",
                content_hash="sha256:" + "f" * 64,
            ),
            -10,
        )
        ambiguous = self.write(
            "ambiguous.md",
            markdown(
                "complete",
                captured.isoformat(),
                title="Ambiguous PDF report",
                source_id="ambiguous",
                content_hash="sha256:" + "1" * 64,
            ),
            0,
        )
        first_pdf = self.write("download.pdf", b"%PDF-1.7\nfirst", -1)
        second_pdf = self.write("download (1).pdf", b"%PDF-1.7\nsecond", 1)
        self.trust_pdf(first_pdf)
        self.trust_pdf(second_pdf)

        completed, result = self.run_script("--date", local_date, "--apply")

        self.assertEqual(completed.returncode, 3, completed.stderr)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["counts"], {"archived": 1, "ambiguous": 1})
        items = {item["markdown"]: item for item in result["items"]}
        self.assertEqual(items[safe.name]["status"], "archived")
        self.assertEqual(items[ambiguous.name]["status"], "ambiguous")
        self.assertFalse(safe.exists())
        self.assertTrue((self.archive / items[safe.name]["target"] / "original.md").is_file())
        for path in (ambiguous, first_pdf, second_pdf):
            self.assertTrue(path.exists())

    def test_batch_rejects_one_pdf_claimed_by_multiple_reports_before_apply(self) -> None:
        captured = datetime.fromtimestamp(self.now, tz=timezone.utc)
        local_date = captured.astimezone().date().isoformat()
        first = self.write(
            "first.md",
            markdown(
                "complete",
                captured.isoformat(),
                title="First PDF report",
                source_id="first-pdf",
                content_hash="sha256:" + "2" * 64,
            ),
            -1,
        )
        second = self.write(
            "second.md",
            markdown(
                "complete",
                captured.isoformat(),
                title="Second PDF report",
                source_id="second-pdf",
                content_hash="sha256:" + "3" * 64,
            ),
            1,
        )
        pdf = self.write("download.pdf", b"%PDF-1.7\nshared", 0)
        self.trust_pdf(pdf)

        completed, result = self.run_script("--date", local_date, "--apply")

        self.assertEqual(completed.returncode, 3, completed.stderr)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["counts"], {"ambiguous": 2})
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())
        self.assertTrue(pdf.exists())
        self.assertFalse(self.archive.exists())

    def test_batch_considers_pdf_claims_from_adjacent_local_date(self) -> None:
        local_now = datetime.now().astimezone()
        midnight = datetime.combine(
            local_now.date(),
            datetime.min.time(),
            tzinfo=local_now.tzinfo,
        )
        before_midnight = midnight - timedelta(seconds=5)
        after_midnight = midnight + timedelta(seconds=5)
        shadow = self.write(
            "previous-day.md",
            markdown(
                "complete",
                before_midnight.isoformat(),
                title="Previous local day",
                source_id="previous-day",
                content_hash="sha256:" + "4" * 64,
            ),
            0,
        )
        selected = self.write(
            "selected-day.md",
            markdown(
                "complete",
                after_midnight.isoformat(),
                title="Selected local day",
                source_id="selected-day",
                content_hash="sha256:" + "5" * 64,
            ),
            0,
        )
        pdf = self.write("midnight.pdf", b"%PDF-1.7\nshared-across-date", 0)
        for path, timestamp in (
            (shadow, before_midnight.timestamp()),
            (selected, after_midnight.timestamp()),
            (pdf, midnight.timestamp()),
        ):
            os.utime(path, (timestamp, timestamp))
        self.trust_pdf(pdf)

        completed, result = self.run_script(
            "--date",
            after_midnight.date().isoformat(),
            "--apply",
        )

        self.assertEqual(completed.returncode, 3, completed.stderr)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["counts"], {"ambiguous": 1})
        self.assertTrue(shadow.exists())
        self.assertTrue(selected.exists())
        self.assertTrue(pdf.exists())
        self.assertFalse(self.archive.exists())

    def test_archive_target_uses_the_same_local_date_as_batch_selection(self) -> None:
        complete = self.write(
            "utc-boundary.md",
            markdown(
                "complete",
                "2026-07-20T15:30:00+00:00",
                source_type="html",
                source_id="utc-boundary",
                content_hash="sha256:" + "6" * 64,
            ),
            0,
        )
        expected_date = datetime(2026, 7, 21).date()

        with mock.patch.object(ARCHIVER, "captured_local_date", return_value=expected_date):
            completed, result = self.run_script("--date", expected_date.isoformat())

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["items"][0]["markdown"], complete.name)
        self.assertTrue(result["items"][0]["target"].startswith("BofA/2026/2026-07-21-"))


if __name__ == "__main__":
    unittest.main()
