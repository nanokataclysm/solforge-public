#!/usr/bin/env python3
"""Sanitized current-tree and full-history release audit for Solforge.

The scanner never prints matched values. Reports contain detector IDs, paths,
line numbers, truncated blob IDs, and category counts only.
"""
from __future__ import annotations

import argparse
import collections
import dataclasses
import ipaddress
import json
import pathlib
import re
import subprocess
from typing import Iterable

MAX_BLOB_BYTES = 5 * 1024 * 1024
TEXT_SAMPLE_BYTES = 64 * 1024
MAX_REPORTED_FINDINGS = 5000

PLACEHOLDER_MARKERS = (
    "example",
    "placeholder",
    "replace-me",
    "replace_with",
    "replace-with",
    "changeme",
    "your_",
    "your-",
    "<",
    "${",
    "test",
    "dummy",
    "redacted",
    "xxxx",
)

MEDIA_EXTENSIONS = {
    ".aac", ".aif", ".aiff", ".avi", ".bmp", ".flac", ".gif", ".heic",
    ".jpeg", ".jpg", ".m4a", ".m4v", ".mkv", ".mov", ".mp3", ".mp4",
    ".ogg", ".pdf", ".png", ".svg", ".tif", ".tiff", ".wav", ".webm",
    ".webp", ".zip",
}

OPERATOR_PATH_PREFIXES = (
    "evidence/03-proof/exports/",
    "docs/handoffs/",
)

SENSITIVE_ENV_ASSIGNMENT = re.compile(
    r"(?m)^[ \t]*(?:export[ \t]+)?"
    r"([A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_KEY|APPLICATION_KEY|AUTH_TOKEN|"
    r"BEARER_TOKEN|DATABASE_URL|DB_URL|PASSWORD|PRIVATE_KEY|SECRET|"
    r"SESSION_TOKEN|SIGNING_KEY|TOKEN))"
    r"[ \t]*=[ \t]*([^#\r\n]*)$"
)

DETECTORS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("private-key-pem", "high", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]{64,}?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("github-token", "high", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{30,255})\b")),
    ("openai-api-key", "high", re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b")),
    ("aws-access-key", "high", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("google-api-key", "high", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("slack-token", "high", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("stripe-live-secret", "high", re.compile(r"\bsk_live_[A-Za-z0-9]{16,}\b")),
    ("basic-auth-url", "high", re.compile(r"\b(?:https?|postgres(?:ql)?|redis)://[^\s/:@]+:[^\s/@]+@")),
    ("bearer-token", "high", re.compile(r"(?i)\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}")),
    ("jwt", "medium", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
)

EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
HOME_PATH_RE = re.compile(r"(?:/home/[A-Za-z0-9._-]+|/Users/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)(?:[/\\][^\s'\"`<>]*)?")
SESSION_CONTEXT_RE = re.compile(r"(?i)\b(?:chat|conversation|session|thread|run)[-_ ]?(?:id|uuid)?\b[^\n]{0,40}\b[0-9a-f]{8}-[0-9a-f-]{27,36}\b")
IPV4_RE = re.compile(r"(?<![0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])")


@dataclasses.dataclass(frozen=True)
class Finding:
    scope: str
    detector: str
    severity: str
    path: str
    line: int | None
    blob: str | None
    key_name: str | None = None

    def as_dict(self) -> dict[str, object]:
        value: dict[str, object] = {
            "scope": self.scope,
            "detector": self.detector,
            "severity": self.severity,
            "path": self.path,
            "line": self.line,
            "blob": self.blob[:12] if self.blob else None,
        }
        if self.key_name:
            value["keyName"] = self.key_name
        return value


def git(*args: str, input_bytes: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["git", *args],
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {message}")
    return result.stdout


def is_probably_text(data: bytes) -> bool:
    sample = data[:TEXT_SAMPLE_BYTES]
    if b"\0" in sample:
        return False
    if not sample:
        return True
    decoded = sample.decode("utf-8", errors="replace")
    replacements = decoded.count("\ufffd")
    return replacements / max(len(decoded), 1) < 0.02


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def placeholder_value(value: str) -> bool:
    normalized = value.strip().strip("'\"").lower()
    if not normalized:
        return True
    return any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def public_ip_matches(text: str) -> Iterable[re.Match[str]]:
    for match in IPV4_RE.finditer(text):
        try:
            address = ipaddress.ip_address(match.group(0))
        except ValueError:
            continue
        if address.is_global:
            yield match


def scan_text(scope: str, path: str, text: str, blob: str | None) -> list[Finding]:
    findings: list[Finding] = []

    for detector, severity, pattern in DETECTORS:
        for match in pattern.finditer(text):
            if detector == "basic-auth-url" and placeholder_value(match.group(0)):
                continue
            findings.append(Finding(scope, detector, severity, path, line_number(text, match.start()), blob))

    for match in SENSITIVE_ENV_ASSIGNMENT.finditer(text):
        key_name = match.group(1)
        raw_value = match.group(2).strip().strip("'\"")
        if placeholder_value(raw_value) or len(raw_value) < 12:
            continue
        example_path = pathlib.PurePosixPath(path).name.endswith(".example") or path.endswith(".env.example")
        severity = "medium" if example_path else "high"
        detector = "sensitive-example-assignment" if example_path else "sensitive-env-assignment"
        findings.append(
            Finding(scope, detector, severity, path, line_number(text, match.start()), blob, key_name=key_name)
        )

    for match in HOME_PATH_RE.finditer(text):
        findings.append(Finding(scope, "local-operator-path", "privacy", path, line_number(text, match.start()), blob))

    for match in EMAIL_RE.finditer(text):
        email = match.group(0).lower()
        if email.endswith("@example.com") or email.endswith("@users.noreply.github.com"):
            continue
        findings.append(Finding(scope, "email-address", "privacy", path, line_number(text, match.start()), blob))

    for match in SESSION_CONTEXT_RE.finditer(text):
        findings.append(Finding(scope, "session-or-chat-identifier", "privacy", path, line_number(text, match.start()), blob))

    for match in public_ip_matches(text):
        findings.append(Finding(scope, "public-ip-address", "privacy", path, line_number(text, match.start()), blob))

    return findings


def current_tree_files() -> list[str]:
    raw = git("ls-files", "-z")
    return [part.decode("utf-8", errors="surrogateescape") for part in raw.split(b"\0") if part]


def current_tree_scan() -> tuple[list[Finding], dict[str, object]]:
    findings: list[Finding] = []
    files = current_tree_files()
    total_bytes = 0
    binary_count = 0
    oversized_count = 0
    media_paths: list[str] = []
    operator_paths: list[str] = []
    top_level = collections.Counter()
    extensions = collections.Counter()

    for file_name in files:
        path = pathlib.Path(file_name)
        top_level[file_name.split("/", 1)[0]] += 1
        extensions[path.suffix.lower() or "<none>"] += 1
        if path.suffix.lower() in MEDIA_EXTENSIONS:
            media_paths.append(file_name)
        if file_name.startswith(OPERATOR_PATH_PREFIXES) or "transcript" in file_name.lower() or "handoff" in file_name.lower():
            operator_paths.append(file_name)

        try:
            data = path.read_bytes()
        except OSError:
            findings.append(Finding("current", "unreadable-tracked-file", "medium", file_name, None, None))
            continue

        total_bytes += len(data)
        if len(data) > MAX_BLOB_BYTES:
            oversized_count += 1
            findings.append(Finding("current", "oversized-file-not-content-scanned", "medium", file_name, None, None))
            continue
        if not is_probably_text(data):
            binary_count += 1
            continue

        text = data.decode("utf-8", errors="replace")
        findings.extend(scan_text("current", file_name, text, None))

    inventory = {
        "trackedFiles": len(files),
        "trackedBytes": total_bytes,
        "binaryFiles": binary_count,
        "oversizedFilesSkipped": oversized_count,
        "mediaFiles": len(media_paths),
        "operatorOrTranscriptPaths": len(operator_paths),
        "topLevelCounts": dict(sorted(top_level.items())),
        "extensionCounts": dict(sorted(extensions.items())),
        "mediaPaths": sorted(media_paths),
        "operatorOrTranscriptPathList": sorted(operator_paths),
    }
    return findings, inventory


def reachable_blob_map() -> dict[str, set[str]]:
    raw = git("rev-list", "--objects", "--all")
    mapping: dict[str, set[str]] = collections.defaultdict(set)
    for line in raw.decode("utf-8", errors="surrogateescape").splitlines():
        sha, sep, path = line.partition(" ")
        if sha and sep and path:
            mapping[sha].add(path)
    return mapping


def blob_metadata(shas: list[str]) -> dict[str, tuple[str, int]]:
    payload = "".join(f"{sha}\n" for sha in shas).encode("ascii")
    raw = git("cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)", input_bytes=payload)
    result: dict[str, tuple[str, int]] = {}
    for line in raw.decode("ascii", errors="replace").splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        sha, object_type, size_value = parts
        try:
            size = int(size_value)
        except ValueError:
            continue
        result[sha] = (object_type, size)
    return result


def history_scan() -> tuple[list[Finding], dict[str, object]]:
    findings: list[Finding] = []
    mapping = reachable_blob_map()
    metadata = blob_metadata(list(mapping))
    blob_count = 0
    text_blob_count = 0
    binary_blob_count = 0
    oversized_blob_count = 0
    scanned_bytes = 0

    for sha in sorted(mapping):
        object_type, size = metadata.get(sha, ("unknown", 0))
        if object_type != "blob":
            continue
        blob_count += 1
        paths = sorted(mapping[sha])
        representative_path = paths[0] if paths else "<unknown>"
        if size > MAX_BLOB_BYTES:
            oversized_blob_count += 1
            findings.append(Finding("history", "oversized-blob-not-content-scanned", "medium", representative_path, None, sha))
            continue

        data = git("cat-file", "blob", sha)
        scanned_bytes += len(data)
        if not is_probably_text(data):
            binary_blob_count += 1
            continue
        text_blob_count += 1
        text = data.decode("utf-8", errors="replace")
        for path in paths[:20]:
            findings.extend(scan_text("history", path, text, sha))
        if len(paths) > 20:
            findings.append(Finding("history", "blob-path-list-truncated", "info", representative_path, None, sha))

    inventory = {
        "reachableBlobs": blob_count,
        "textBlobsScanned": text_blob_count,
        "binaryBlobsSkipped": binary_blob_count,
        "oversizedBlobsSkipped": oversized_blob_count,
        "historyBytesScanned": scanned_bytes,
    }
    return findings, inventory


def deduplicate(findings: list[Finding]) -> list[Finding]:
    seen: set[tuple[object, ...]] = set()
    result: list[Finding] = []
    for finding in findings:
        key = (
            finding.scope,
            finding.detector,
            finding.severity,
            finding.path,
            finding.line,
            finding.blob,
            finding.key_name,
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(finding)
    return result


def report_summary(findings: list[Finding]) -> dict[str, object]:
    severity = collections.Counter(finding.severity for finding in findings)
    detector = collections.Counter(finding.detector for finding in findings)
    scope = collections.Counter(finding.scope for finding in findings)
    affected_paths = sorted({finding.path for finding in findings})
    high_paths = sorted({finding.path for finding in findings if finding.severity == "high"})
    privacy_paths = sorted({finding.path for finding in findings if finding.severity == "privacy"})
    return {
        "findingCount": len(findings),
        "severityCounts": dict(sorted(severity.items())),
        "detectorCounts": dict(sorted(detector.items())),
        "scopeCounts": dict(sorted(scope.items())),
        "affectedPathCount": len(affected_paths),
        "highConfidencePathCount": len(high_paths),
        "privacyPathCount": len(privacy_paths),
        "highConfidencePaths": high_paths,
        "privacyPaths": privacy_paths,
    }


def print_sanitized_summary(report: dict[str, object]) -> None:
    summary = report["summary"]
    current = report["currentTree"]
    history = report["history"]
    print("PUBLIC_RELEASE_AUDIT_SUMMARY")
    print(json.dumps({
        "ok": report["ok"],
        "sourceCommit": report["sourceCommit"],
        "trackedFiles": current["trackedFiles"],
        "reachableBlobs": history["reachableBlobs"],
        "severityCounts": summary["severityCounts"],
        "detectorCounts": summary["detectorCounts"],
        "highConfidencePaths": summary["highConfidencePaths"],
        "privacyPathCount": summary["privacyPathCount"],
        "mediaFiles": current["mediaFiles"],
        "operatorOrTranscriptPaths": current["operatorOrTranscriptPaths"],
        "matchedValuesPrinted": False,
    }, indent=2, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--fail-on-high", action="store_true")
    args = parser.parse_args()

    source_commit = git("rev-parse", "HEAD").decode("ascii").strip()
    current_findings, current_inventory = current_tree_scan()
    history_findings, history_inventory = history_scan()
    findings = deduplicate(current_findings + history_findings)
    findings.sort(key=lambda item: (item.severity, item.detector, item.path, item.line or 0, item.blob or ""))

    truncated = len(findings) > MAX_REPORTED_FINDINGS
    reported_findings = findings[:MAX_REPORTED_FINDINGS]
    summary = report_summary(findings)
    high_count = summary["severityCounts"].get("high", 0)

    report = {
        "schemaVersion": 1,
        "sourceCommit": source_commit,
        "ok": high_count == 0,
        "policy": {
            "maxBlobBytes": MAX_BLOB_BYTES,
            "matchedValuesPrinted": False,
            "currentTreeAndAllReachableRefsScanned": True,
            "highConfidenceFindingsFailGate": bool(args.fail_on_high),
        },
        "currentTree": current_inventory,
        "history": history_inventory,
        "summary": summary,
        "findingsTruncated": truncated,
        "findings": [finding.as_dict() for finding in reported_findings],
    }

    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print_sanitized_summary(report)

    if args.fail_on_high and high_count:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "stage": "scanner",
            "code": type(exc).__name__,
            "matchedValuesPrinted": False,
        }, sort_keys=True))
        raise
