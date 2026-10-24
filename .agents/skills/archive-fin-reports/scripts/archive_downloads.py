#!/usr/bin/env python3
"""Safely archive one report or one local-date batch from Downloads."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


SCHEMA = "fin-report-clipper/capture-v1"
BACKUP_DIRNAME = "Fin-report-clipper Backup"
ALLOWED_PDF_HOSTS = frozenset({"rsch.baml.com", "research1.ml.com"})
CONTENT_HASH = re.compile(r"^sha256:[a-f0-9]{64}$")
PRIVATE_TITLE = re.compile(r"https?://|[\w.+-]+@[\w.-]+|(?:^|[?&])(q|e|h)=", re.IGNORECASE)
BAD_PATH_CHARS = re.compile(r'[\\/:*?"<>|#\[\]\x00-\x1f\x7f]')
WHERE_FROMS_ATTRIBUTES = (
    "com.apple.metadata:kMDItemWhereFroms",
    "user.com.apple.metadata:kMDItemWhereFroms",
)


class ArchiveError(Exception):
    """Expected, privacy-safe archive error."""

    def __init__(self, status: str, message: str, exit_code: int = 2) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.exit_code = exit_code


@dataclass(frozen=True)
class ReportMarkdown:
    path: Path
    metadata: dict[str, str]
    title: str
    mtime: float


@dataclass(frozen=True)
class ArchivePlan:
    report: ReportMarkdown
    pdf: Path | None
    partial: Path | None
    target: Path
    target_relative: Path
    warnings: tuple[str, ...]


@dataclass
class BatchEntry:
    report: ReportMarkdown
    plan: ArchivePlan | None = None
    error: ArchiveError | None = None


def parse_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, str) else value
        except json.JSONDecodeError:
            return value[1:-1]
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def read_report_markdown(path: Path) -> ReportMarkdown | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    try:
        end = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration:
        return None

    metadata: dict[str, str] = {}
    for line in lines[1:end]:
        match = re.match(r"^([a-z_]+):\s*(.*?)\s*$", line)
        if match:
            metadata[match.group(1)] = parse_scalar(match.group(2))
    title = next(
        (line[2:].strip() for line in lines[end + 1 :] if line.startswith("# ") and line[2:].strip()),
        "untitled-report",
    )
    return ReportMarkdown(path=path, metadata=metadata, title=title, mtime=path.stat().st_mtime)


def is_supported_report(report: ReportMarkdown, status: str = "complete") -> bool:
    metadata = report.metadata
    return (
        metadata.get("schema") == SCHEMA
        and metadata.get("provider") == "BofA Global Research"
        and metadata.get("source_type") in {"html", "html+pdf"}
        and sanitized_source(metadata.get("source", "")) is not None
        and is_valid_captured(metadata.get("captured", ""))
        and metadata.get("capture_status") == status
        and bool(CONTENT_HASH.fullmatch(metadata.get("content_hash", "")))
    )


def safe_segment(value: str, fallback: str = "untitled") -> str:
    value = unicodedata.normalize("NFKC", value)
    value = BAD_PATH_CHARS.sub(" ", value)
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"^\.+", "", value)
    value = re.sub(r"[. ]+$", "", value).strip()
    if not value:
        value = fallback
    return value[:80]


def safe_title(value: str) -> str:
    if PRIVATE_TITLE.search(value):
        return "untitled-report"
    return safe_segment(value, "untitled-report")


def parse_captured(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ArchiveError("no-match", "研报的 captured 时间无效；未移动任何文件。") from error
    if parsed.tzinfo is None:
        raise ArchiveError("no-match", "研报的 captured 时间缺少时区；未移动任何文件。")
    return parsed


def is_valid_captured(value: str) -> bool:
    try:
        parse_captured(value)
        return True
    except ArchiveError:
        return False


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def where_froms_bytes(path: Path) -> bytes | None:
    getxattr = getattr(os, "getxattr", None)
    if callable(getxattr):
        for attribute in WHERE_FROMS_ATTRIBUTES:
            try:
                return getxattr(path, attribute)
            except OSError:
                continue

    xattr = "/usr/bin/xattr"
    if not Path(xattr).exists():
        return None
    result = subprocess.run(
        [xattr, "-px", WHERE_FROMS_ATTRIBUTES[0], str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    try:
        return bytes.fromhex("".join(result.stdout.split()))
    except ValueError:
        return None


def origin_hosts(path: Path) -> set[str] | None:
    raw = where_froms_bytes(path)
    if raw is None:
        return None
    try:
        values = plistlib.loads(raw)
    except plistlib.InvalidFileException:
        return None
    if not isinstance(values, (list, tuple)):
        return set()
    hosts = {
        host.lower().rstrip(".")
        for value in values
        if isinstance(value, str)
        if (host := urlsplit(value).hostname)
    }
    return hosts


def looks_like_pdf(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(5) == b"%PDF-"
    except OSError:
        return False


def trusted_pdf(path: Path) -> bool:
    hosts = origin_hosts(path)
    return hosts is not None and bool(hosts & ALLOWED_PDF_HOSTS)


def pdf_candidates(downloads: Path, report: ReportMarkdown, max_pair_seconds: int) -> list[Path]:
    captured_timestamp = parse_captured(report.metadata["captured"]).timestamp()
    candidates: list[Path] = []
    for path in downloads.iterdir():
        if not path.is_file() or path.suffix.lower() != ".pdf":
            continue
        difference = abs(path.stat().st_mtime - report.mtime)
        captured_difference = abs(path.stat().st_mtime - captured_timestamp)
        if (
            difference > max_pair_seconds
            or captured_difference > 120
            or not looks_like_pdf(path)
            or not trusted_pdf(path)
        ):
            continue
        candidates.append(path)
    candidates.sort(key=lambda path: path.name)
    return candidates


def choose_pdf(downloads: Path, report: ReportMarkdown, max_pair_seconds: int) -> Path:
    candidates = pdf_candidates(downloads, report, max_pair_seconds)
    if not candidates:
        raise ArchiveError("no-match", "没有找到时间接近且来源可信的 PDF；未移动任何文件。")
    if len(candidates) > 1:
        raise ArchiveError("ambiguous", "找到多个同样可信的 PDF，无法安全配对；未移动任何文件。", 3)
    return candidates[0]


def choose_partial(
    reports: list[ReportMarkdown], complete: ReportMarkdown, max_pair_seconds: int
) -> tuple[Path | None, tuple[str, ...]]:
    matches = [
        report
        for report in reports
        if is_supported_report(report, "partial")
        and report.metadata.get("content_hash") == complete.metadata.get("content_hash")
        and report.metadata.get("source_id") == complete.metadata.get("source_id")
        and report.metadata.get("captured") == complete.metadata.get("captured")
        and report.metadata.get("source_type") == complete.metadata.get("source_type")
        and abs(report.mtime - complete.mtime) <= max_pair_seconds
    ]
    matches.sort(key=lambda item: (abs(item.mtime - complete.mtime), -item.mtime, item.path.name))
    if not matches:
        return None, ()
    if len(matches) > 1 and abs(
        abs(matches[0].mtime - complete.mtime) - abs(matches[1].mtime - complete.mtime)
    ) < 1.0:
        return None, ("检测到多个阶段 Markdown，因无法唯一匹配而保留在 Downloads。",)
    return matches[0].path, ()


def load_reports(downloads: Path) -> list[ReportMarkdown]:
    return [
        report
        for path in downloads.iterdir()
        if path.is_file() and path.suffix.lower() == ".md"
        if (report := read_report_markdown(path)) is not None
    ]


def resolve_markdown(downloads: Path, exact: str | None, max_age_hours: float) -> tuple[ReportMarkdown, list[ReportMarkdown]]:
    reports = load_reports(downloads)
    if exact:
        candidate = Path(exact)
        candidate = candidate if candidate.is_absolute() else downloads / candidate
        try:
            candidate = candidate.resolve(strict=True)
        except OSError as error:
            raise ArchiveError("no-match", "指定的 Markdown 不存在；未移动任何文件。") from error
        if candidate.parent != downloads.resolve() or candidate.suffix.lower() != ".md":
            raise ArchiveError("no-match", "只能指定 Downloads 根目录中的 Markdown；未移动任何文件。")
        report = next((item for item in reports if item.path.resolve() == candidate), None)
        if report is None or not is_supported_report(report):
            raise ArchiveError("no-match", "指定文件不是完整的 Fin-report-clipper 研报；未移动任何文件。")
        return report, reports

    cutoff = datetime.now(tz=timezone.utc).timestamp() - max_age_hours * 3600
    complete = [report for report in reports if is_supported_report(report) and report.mtime >= cutoff]
    if not complete:
        raise ArchiveError("no-match", "没有找到足够新的完整 Fin-report-clipper Markdown；未移动任何文件。")
    complete.sort(key=lambda item: (item.mtime, item.path.name), reverse=True)
    return complete[0], reports


def build_plan_for_report(
    args: argparse.Namespace,
    downloads: Path,
    report: ReportMarkdown,
    reports: list[ReportMarkdown],
) -> ArchivePlan:
    metadata = report.metadata
    source_id = metadata.get("source_id", "")
    if source_id and (
        len(source_id) > 80
        or ".." in source_id
        or BAD_PATH_CHARS.search(source_id)
        or PRIVATE_TITLE.search(source_id)
    ):
        raise ArchiveError("no-match", "研报 source_id 不安全；未移动任何文件。")

    capture_date = captured_local_date(report).isoformat()
    content_hash = metadata["content_hash"]
    short_id = safe_segment(source_id or content_hash.removeprefix("sha256:")[:8])[:16]
    folder = f"{capture_date}-{safe_title(report.title)}-{short_id}-{content_hash.removeprefix('sha256:')[:16]}"
    target_relative = Path("BofA") / capture_date[:4] / folder
    archive_root = args.archive_root.expanduser().resolve()
    target = archive_root / target_relative
    source_type = metadata.get("source_type", "")
    pdf = choose_pdf(downloads, report, args.max_pair_seconds) if source_type == "html+pdf" else None
    partial, warnings = choose_partial(reports, report, args.max_pair_seconds)
    return ArchivePlan(report, pdf, partial, target, target_relative, warnings)


def build_plan(args: argparse.Namespace) -> ArchivePlan:
    downloads = args.downloads_dir.expanduser().resolve()
    if not downloads.is_dir():
        raise ArchiveError("no-match", "Downloads 目录不存在；未移动任何文件。")
    report, reports = resolve_markdown(downloads, args.markdown, args.max_age_hours)
    return build_plan_for_report(args, downloads, report, reports)


def public_plan(plan: ArchivePlan, status: str, mode: str) -> dict[str, Any]:
    return {
        "status": status,
        "mode": mode,
        "markdown": plan.report.path.name,
        "pdf": plan.pdf.name if plan.pdf else None,
        "staging_markdown": plan.partial.name if plan.partial else None,
        "target": plan.target_relative.as_posix(),
        "warnings": list(plan.warnings),
    }


def sanitized_source(value: str) -> str | None:
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or parsed.hostname != "rsch.baml.com"
        or parsed.username
        or parsed.password
        or port not in {None, 443}
        or parsed.query
        or parsed.fragment
    ):
        return None
    return value


def write_manifest(root: Path, plan: ArchivePlan, files: list[dict[str, str]]) -> None:
    metadata = plan.report.metadata
    source = sanitized_source(metadata.get("source", ""))
    manifest = {
        "schema": SCHEMA,
        "provider": metadata["provider"],
        **({"source_id": metadata["source_id"]} if metadata.get("source_id") else {}),
        "source_type": metadata.get("source_type", "html"),
        **({"sanitized_source": source} if source else {}),
        "captured_at": metadata.get("captured"),
        "content_hash": metadata["content_hash"],
        "capture_status": "complete",
        "archive_method": "archive-fin-reports",
        "archived_at": datetime.now(tz=timezone.utc).isoformat(),
        "files": files,
        "warnings": list(plan.warnings),
    }
    metadata_dir = root / ".fin-report-clipper"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    temporary = metadata_dir / "capture.json.tmp"
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, metadata_dir / "capture.json")


def existing_target_status(plan: ArchivePlan) -> str | None:
    if plan.target.exists():
        manifest = plan.target / ".fin-report-clipper" / "capture.json"
        try:
            existing = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
        return (
            "already-archived"
            if existing.get("content_hash") == plan.report.metadata.get("content_hash")
            else "target-exists"
        )
    return None


def apply_plan(plan: ArchivePlan) -> dict[str, Any]:
    if status := existing_target_status(plan):
        result = public_plan(plan, status, "apply")
        result["message"] = "目标目录已存在；未覆盖，也未移动 Downloads 中的文件。"
        return result

    destinations: list[tuple[Path, Path, str]] = [
        (plan.report.path, Path("original.md"), "original-markdown")
    ]
    if plan.pdf:
        destinations.append((plan.pdf, Path("original.pdf"), "original-pdf"))
    if plan.partial:
        destinations.append(
            (plan.partial, Path(".fin-report-clipper/staging-partial.md"), "staging-markdown")
        )

    files = [
        {
            "path": relative.as_posix(),
            "role": role,
            "sha256": file_sha256(source),
        }
        for source, relative, role in destinations
    ]
    expected_hashes = {source: file["sha256"] for (source, _relative, _role), file in zip(destinations, files)}

    plan.target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(
            prefix=f".{plan.target.name}.archiving-",
            dir=plan.target.parent,
        )
    )
    committed = False
    try:
        for source, relative, _role in destinations:
            if not source.is_file():
                raise ArchiveError("error", "归档前文件状态发生变化；源文件仍保留。", 4)
            destination = staging / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            if file_sha256(destination) != expected_hashes[source]:
                raise ArchiveError("error", "目标副本哈希校验失败；源文件仍保留。", 4)
        write_manifest(staging, plan, files)
        if plan.target.exists():
            result = public_plan(plan, existing_target_status(plan) or "target-exists", "apply")
            result["message"] = "目标目录已由另一个归档创建；未覆盖，也未移除源文件。"
            return result
        try:
            staging.rename(plan.target)
        except OSError:
            if plan.target.exists():
                result = public_plan(plan, existing_target_status(plan) or "target-exists", "apply")
                result["message"] = "目标目录已由另一个归档创建；未覆盖，也未移除源文件。"
                return result
            raise
        committed = True
    finally:
        if not committed and staging.exists():
            shutil.rmtree(staging)

    cleanup_warnings: list[str] = []
    for source, _relative, _role in destinations:
        try:
            if not source.is_file() or file_sha256(source) != expected_hashes[source]:
                cleanup_warnings.append(f"{source.name} 在归档期间发生变化，源副本已保留。")
                continue
            source.unlink()
        except OSError:
            cleanup_warnings.append(f"{source.name} 无法从 Downloads 移除，归档副本已保留。")

    result = public_plan(plan, "archived", "apply")
    result["warnings"].extend(cleanup_warnings)
    return result


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("日期必须使用 YYYY-MM-DD 格式") from error


def captured_local_date(report: ReportMarkdown) -> date:
    return parse_captured(report.metadata["captured"]).astimezone().date()


def batch_entries(args: argparse.Namespace, selected_date: date) -> list[BatchEntry]:
    downloads = args.downloads_dir.expanduser().resolve()
    if not downloads.is_dir():
        raise ArchiveError("no-match", "Downloads 目录不存在；未移动任何文件。")
    reports = load_reports(downloads)
    supported_complete = [report for report in reports if is_supported_report(report)]
    complete = [
        report
        for report in supported_complete
        if captured_local_date(report) == selected_date
    ]
    complete.sort(
        key=lambda report: (
            parse_captured(report.metadata["captured"]).timestamp(),
            report.mtime,
            report.path.name,
        )
    )
    if not complete:
        raise ArchiveError(
            "no-match",
            f"本地日期 {selected_date.isoformat()} 没有完整的 BofA Fin-report-clipper Markdown；未移动任何文件。",
        )

    entries: list[BatchEntry] = []
    for report in complete:
        try:
            plan = build_plan_for_report(args, downloads, report, reports)
            entries.append(BatchEntry(report=report, plan=plan))
        except ArchiveError as error:
            entries.append(BatchEntry(report=report, error=error))

    pdfs_by_report: dict[Path, list[Path]] = {}
    pdf_owners: dict[Path, set[Path]] = {}
    for report in supported_complete:
        candidates = (
            pdf_candidates(downloads, report, args.max_pair_seconds)
            if report.metadata.get("source_type") == "html+pdf"
            else []
        )
        report_key = report.path.resolve()
        pdfs_by_report[report_key] = candidates
        for pdf in candidates:
            pdf_owners.setdefault(pdf.resolve(), set()).add(report_key)

    conflicting: set[int] = set()
    for index, entry in enumerate(entries):
        for pdf in pdfs_by_report.get(entry.report.path.resolve(), []):
            if len(pdf_owners[pdf.resolve()]) > 1:
                conflicting.add(index)

    claims: dict[tuple[str, Path], list[int]] = {}
    for index, entry in enumerate(entries):
        if entry.plan is not None:
            claims.setdefault(("target", entry.plan.target), []).append(index)
            if entry.plan.partial is not None:
                claims.setdefault(("partial", entry.plan.partial.resolve()), []).append(index)

    conflicting.update(
        index
        for claimants in claims.values()
        if len(set(claimants)) > 1
        for index in claimants
    )
    for index in conflicting:
        entries[index].plan = None
        entries[index].error = ArchiveError(
            "ambiguous",
            "该组与同批其他研报竞争相同的 PDF、阶段 Markdown 或目标目录；未移动任何相关文件。",
            3,
        )
    return entries


def error_item(entry: BatchEntry, mode: str) -> dict[str, Any]:
    error = entry.error or ArchiveError("error", "归档计划不可用；未移动任何文件。", 4)
    return {
        "status": error.status,
        "mode": mode,
        "markdown": entry.report.path.name,
        "message": error.message,
    }


def batch_result(args: argparse.Namespace, selected_date: date) -> tuple[dict[str, Any], int]:
    entries = batch_entries(args, selected_date)
    mode = "apply" if args.apply else "preview"
    items: list[dict[str, Any]] = []
    for entry in entries:
        if entry.error is not None or entry.plan is None:
            items.append(error_item(entry, mode))
            continue
        if not args.apply:
            status = existing_target_status(entry.plan) or "ready"
            item = public_plan(entry.plan, status, mode)
            if status != "ready":
                item["message"] = "目标目录已存在；预览未移动或覆盖任何文件。"
            items.append(item)
            continue
        try:
            items.append(apply_plan(entry.plan))
        except ArchiveError as error:
            entry.error = error
            items.append(error_item(entry, mode))
        except Exception:
            entry.error = ArchiveError(
                "error",
                "该组归档遇到未预期错误；源文件未被覆盖。",
                4,
            )
            items.append(error_item(entry, mode))

    counts: dict[str, int] = {}
    for item in items:
        status = str(item["status"])
        counts[status] = counts.get(status, 0) + 1

    unsafe_codes = [
        4 if item["status"] == "error" else 3 if item["status"] == "ambiguous" else 2
        for item in items
        if item["status"] in {"error", "ambiguous", "no-match"}
    ]
    exit_code = max(unsafe_codes, default=0)
    expected = "archived" if args.apply else "ready"
    overall_status = expected if all(item["status"] == expected for item in items) else "partial"
    return (
        {
            "status": overall_status,
            "mode": mode,
            "scope": {"provider": "BofA", "date": selected_date.isoformat()},
            "total": len(items),
            "counts": counts,
            "items": items,
        },
        exit_code,
    )


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--downloads-dir", type=Path, default=Path.home() / "Downloads")
    result.add_argument(
        "--archive-root",
        type=Path,
        default=Path.home() / "Downloads" / BACKUP_DIRNAME,
    )
    selection = result.add_mutually_exclusive_group()
    selection.add_argument("--markdown", help="Exact root-level Markdown filename to archive")
    selection.add_argument("--today", action="store_true", help="Process all BofA reports captured today in local time")
    selection.add_argument(
        "--date",
        dest="capture_date",
        type=parse_date,
        help="Process all BofA reports captured on this local date (YYYY-MM-DD)",
    )
    result.add_argument("--max-age-hours", type=float, default=24.0)
    result.add_argument("--max-pair-seconds", type=int, default=30)
    result.add_argument("--apply", action="store_true", help="Move the uniquely matched files")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.today or args.capture_date is not None:
            selected_date = datetime.now().astimezone().date() if args.today else args.capture_date
            result, exit_code = batch_result(args, selected_date)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return exit_code
        plan = build_plan(args)
        if args.apply:
            result = apply_plan(plan)
        else:
            status = existing_target_status(plan) or "ready"
            result = public_plan(plan, status, "preview")
            if status != "ready":
                result["message"] = "目标目录已存在；预览未移动或覆盖任何文件。"
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except ArchiveError as error:
        print(
            json.dumps(
                {"status": error.status, "mode": "apply" if args.apply else "preview", "message": error.message},
                ensure_ascii=False,
                indent=2,
            )
        )
        return error.exit_code
    except Exception:
        print(
            json.dumps(
                {
                    "status": "error",
                    "mode": "apply" if args.apply else "preview",
                    "message": "归档遇到未预期错误；请检查文件状态。未执行删除或覆盖。",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 4


if __name__ == "__main__":
    sys.exit(main())
