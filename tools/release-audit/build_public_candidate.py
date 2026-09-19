#!/usr/bin/env python3
"""Build a deterministic history-free public candidate from an exact Git commit."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any

MANIFEST = "tools/release-audit/public-candidate-classification.json"
PUBLIC = "public-include"
PRIVATE = "private-source-only"
UNRESOLVED = {"manual-review", "rewrite-before-include"}
ALLOWED = {PUBLIC, PRIVATE, *UNRESOLVED}
MODES = {"100644": 0o644, "100755": 0o755}
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class BuildError(RuntimeError):
    pass


def git(*args: str) -> bytes:
    result = subprocess.run(["git", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise BuildError("git_command_failed")
    return result.stdout


def safe_path(path: str) -> None:
    candidate = PurePosixPath(path)
    if (
        not path
        or "\\" in path
        or CONTROL.search(path)
        or candidate.is_absolute()
        or candidate.as_posix() != path
        or any(part in {"", ".", "..", ".git"} for part in candidate.parts)
    ):
        raise BuildError("unsafe_repository_path")


def resolve_commit(source: str) -> str:
    if not source or CONTROL.search(source):
        raise BuildError("invalid_source_ref")
    commit = git("rev-parse", "--verify", "--end-of-options", f"{source}^{{commit}}").decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40,64}", commit):
        raise BuildError("invalid_source_commit")
    return commit


def read_manifest(commit: str) -> tuple[dict[str, Any], str]:
    safe_path(MANIFEST)
    try:
        blob = git("rev-parse", "--verify", "--end-of-options", f"{commit}:{MANIFEST}").decode().strip()
        manifest = json.loads(git("show", f"{commit}:{MANIFEST}").decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BuildError("invalid_manifest") from exc
    strategy = manifest.get("publicationStrategy", {})
    if (
        manifest.get("schemaVersion") != 1
        or set(manifest.get("allowedDispositions", [])) != ALLOWED
        or strategy.get("mode") != "history-free-clean-export"
        or strategy.get("sourceRepositoryRemainsPrivate") is not True
        or strategy.get("authorizationRequiredBeforeTargetCreation") is not True
    ):
        raise BuildError("unsafe_manifest")
    rules = manifest.get("rules")
    if not isinstance(rules, list) or not rules:
        raise BuildError("invalid_manifest")
    seen: set[str] = set()
    for rule in rules:
        rule_id = rule.get("id")
        pattern = rule.get("pattern")
        kind = rule.get("kind")
        if (
            not isinstance(rule_id, str)
            or not rule_id
            or rule_id in seen
            or kind not in {"exact", "prefix"}
            or not isinstance(pattern, str)
            or not pattern
            or rule.get("disposition") not in ALLOWED
            or not isinstance(rule.get("reason"), str)
            or not rule["reason"].strip()
        ):
            raise BuildError("invalid_rule")
        seen.add(rule_id)
        safe_path(pattern.rstrip("/") if kind == "prefix" else pattern)
        if kind == "prefix" and not pattern.endswith("/"):
            raise BuildError("invalid_rule")
    return manifest, blob


def classify(rules: list[dict[str, Any]], path: str) -> dict[str, Any] | None:
    for rule in rules:
        if (rule["kind"] == "exact" and path == rule["pattern"]) or (
            rule["kind"] == "prefix" and path.startswith(rule["pattern"])
        ):
            return rule
    return None


def tree(commit: str) -> list[tuple[str, str, str, str]]:
    entries: list[tuple[str, str, str, str]] = []
    for record in git("ls-tree", "-r", "-z", "--full-tree", commit).split(b"\0"):
        if not record:
            continue
        metadata, separator, raw_path = record.partition(b"\t")
        if not separator:
            raise BuildError("invalid_tree")
        mode, object_type, blob = metadata.decode("ascii").split()
        try:
            path = raw_path.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise BuildError("non_utf8_path") from exc
        safe_path(path)
        entries.append((mode, object_type, blob, path))
    return sorted(entries, key=lambda item: item[3])


def select(commit: str, manifest: dict[str, Any]) -> tuple[list[dict[str, Any]], Counter[str]]:
    selected: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    folded: dict[str, str] = {}
    for mode, object_type, blob, path in tree(commit):
        rule = classify(manifest["rules"], path)
        if rule is None:
            raise BuildError("unclassified_path")
        disposition = rule["disposition"]
        counts[disposition] += 1
        if disposition in UNRESOLVED:
            raise BuildError("unresolved_disposition")
        if disposition == PRIVATE:
            continue
        if disposition != PUBLIC or object_type != "blob" or mode not in MODES:
            raise BuildError("unsupported_public_entry")
        key = path.casefold()
        if key in folded and folded[key] != path:
            raise BuildError("casefold_collision")
        folded[key] = path
        content = git("cat-file", "blob", blob)
        selected.append(
            {
                "path": path,
                "mode": MODES[mode],
                "blob": blob,
                "content": content,
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    if not selected:
        raise BuildError("empty_candidate")
    return selected, counts


def destinations(output: Path, archive: Path, report: Path) -> None:
    resolved = [path.resolve(strict=False) for path in (output, archive, report)]
    if len(set(resolved)) != 3 or resolved[0] in resolved[1].parents or resolved[0] in resolved[2].parents:
        raise BuildError("destination_collision")
    if output.exists() or archive.exists() or report.exists():
        raise BuildError("destination_exists")
    for path in (output, archive, report):
        path.parent.mkdir(parents=True, exist_ok=True)


def write_tree(root: Path, entries: list[dict[str, Any]]) -> None:
    root.mkdir(mode=0o755, exist_ok=True)
    for entry in entries:
        path = root.joinpath(*PurePosixPath(entry["path"]).parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(entry["content"])
        os.chmod(path, entry["mode"])


def tar_directories(entries: list[dict[str, Any]]) -> list[str]:
    directories = {"solforge-public-candidate"}
    for entry in entries:
        current = PurePosixPath("solforge-public-candidate")
        for part in PurePosixPath(entry["path"]).parts[:-1]:
            current /= part
            directories.add(current.as_posix())
    return sorted(directories, key=lambda value: (value.count("/"), value))


def tar_info(name: str, mode: int, size: int = 0, directory: bool = False) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.mode = mode
    info.uid = info.gid = info.mtime = 0
    info.uname = info.gname = ""
    info.size = size
    if directory:
        info.type = tarfile.DIRTYPE
    return info


def write_archive(path: Path, entries: list[dict[str, Any]]) -> None:
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                for directory in tar_directories(entries):
                    archive.addfile(tar_info(f"{directory}/", 0o755, directory=True))
                for entry in entries:
                    content = entry["content"]
                    archive.addfile(
                        tar_info(f"solforge-public-candidate/{entry['path']}", entry["mode"], len(content)),
                        io.BytesIO(content),
                    )


def digest(entries: list[dict[str, Any]]) -> str:
    value = hashlib.sha256()
    for entry in entries:
        value.update(
            f"{entry['mode']:o}\0{entry['path']}\0{len(entry['content'])}\0{entry['sha256']}\n".encode()
        )
    return value.hexdigest()


def build(source: str, output: Path, archive: Path, report: Path) -> dict[str, Any]:
    destinations(output, archive, report)
    commit = resolve_commit(source)
    manifest, manifest_blob = read_manifest(commit)
    entries, counts = select(commit, manifest)
    temp_root = Path(tempfile.mkdtemp(prefix="public-candidate-", dir=output.parent))
    temp_archive = temp_root.with_suffix(".tar.gz")
    temp_report = temp_root.with_suffix(".json")
    created: list[Path] = []
    try:
        write_tree(temp_root, entries)
        write_archive(temp_archive, entries)
        result = {
            "schemaVersion": 1,
            "ok": True,
            "sourceRepository": manifest.get("sourceRepository"),
            "sourceCommit": commit,
            "manifestPath": MANIFEST,
            "manifestBlobSha": manifest_blob,
            "historyIncluded": False,
            "includedFileCount": len(entries),
            "excludedPrivateFileCount": counts.get(PRIVATE, 0),
            "classificationCounts": dict(sorted(counts.items())),
            "treeSha256": digest(entries),
            "archiveSha256": hashlib.sha256(temp_archive.read_bytes()).hexdigest(),
            "files": [
                {
                    "path": entry["path"],
                    "mode": f"{entry['mode']:o}",
                    "size": len(entry["content"]),
                    "gitBlobSha": entry["blob"],
                    "sha256": entry["sha256"],
                }
                for entry in entries
            ],
            "privateSourcePathsListed": False,
            "matchedValuesPrinted": False,
            "repositoryCreated": False,
            "repositorySettingsChanged": False,
        }
        temp_report.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temp_root.rename(output); created.append(output)
        temp_archive.rename(archive); created.append(archive)
        temp_report.rename(report); created.append(report)
        return result
    except Exception:
        for path in reversed(created):
            shutil.rmtree(path, ignore_errors=True) if path.is_dir() else path.unlink(missing_ok=True)
        raise
    finally:
        if temp_root.exists(): shutil.rmtree(temp_root, ignore_errors=True)
        temp_archive.unlink(missing_ok=True); temp_report.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    result = build(args.source, Path(args.output_dir), Path(args.archive), Path(args.report))
    print(json.dumps({key: result[key] for key in (
        "ok", "sourceCommit", "includedFileCount", "excludedPrivateFileCount",
        "treeSha256", "archiveSha256", "historyIncluded", "repositoryCreated"
    )}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as exc:
        print(json.dumps({"ok": False, "stage": "public_candidate_export", "code": str(exc),
                          "matchedValuesPrinted": False, "repositoryCreated": False}, sort_keys=True), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print(json.dumps({"ok": False, "stage": "public_candidate_export", "code": "unexpected_error",
                          "matchedValuesPrinted": False, "repositoryCreated": False}, sort_keys=True), file=sys.stderr)
        raise SystemExit(1)
