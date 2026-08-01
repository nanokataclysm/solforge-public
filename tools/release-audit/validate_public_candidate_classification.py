#!/usr/bin/env python3
"""Validate the fail-closed public-candidate classification manifest."""

from __future__ import annotations

import json
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

MANIFEST = Path("tools/release-audit/public-candidate-classification.json")
PACKAGE = Path("apps/orchestrator/package.json")
PACKAGE_LOCK = Path("apps/orchestrator/package-lock.json")
ROOT_LICENSE = Path("LICENSE")


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def matches(rule: dict[str, Any], path: str) -> bool:
    kind = rule["kind"]
    pattern = rule["pattern"]
    if kind == "exact":
        return path == pattern
    if kind == "prefix":
        return path.startswith(pattern)
    raise ValueError(f"unsupported rule kind: {kind}")


def classify(rules: list[dict[str, Any]], path: str) -> dict[str, Any] | None:
    for rule in rules:
        if matches(rule, path):
            return rule
    return None


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    errors: list[str] = []

    if manifest.get("schemaVersion") != 1:
        errors.append("unsupported_schema_version")

    allowed = set(manifest.get("allowedDispositions", []))
    expected_allowed = {
        "public-include",
        "private-source-only",
        "rewrite-before-include",
        "manual-review",
    }
    if allowed != expected_allowed:
        errors.append("invalid_allowed_dispositions")

    strategy = manifest.get("publicationStrategy", {})
    if (
        strategy.get("mode") != "history-free-clean-export"
        or strategy.get("sourceRepositoryRemainsPrivate") is not True
        or strategy.get("authorizationRequiredBeforeTargetCreation") is not True
    ):
        errors.append("unsafe_publication_strategy")

    source_base = manifest.get("sourceBase")
    if not isinstance(source_base, str):
        errors.append("source_base_missing")

    rules = manifest.get("rules", [])
    if not isinstance(rules, list) or not rules:
        errors.append("rules_missing")
        rules = []

    seen_ids: set[str] = set()
    seen_patterns: set[tuple[str, str]] = set()
    for rule in rules:
        rule_id = rule.get("id")
        signature = (str(rule.get("kind")), str(rule.get("pattern")))
        if not isinstance(rule_id, str) or not rule_id:
            errors.append("rule_id_missing")
        elif rule_id in seen_ids:
            errors.append(f"duplicate_rule_id:{rule_id}")
        seen_ids.add(str(rule_id))

        if signature in seen_patterns:
            errors.append(f"duplicate_rule_pattern:{signature[0]}:{signature[1]}")
        seen_patterns.add(signature)

        if rule.get("kind") not in {"exact", "prefix"}:
            errors.append(f"invalid_rule_kind:{rule_id}")
        if rule.get("disposition") not in expected_allowed:
            errors.append(f"invalid_rule_disposition:{rule_id}")
        if not isinstance(rule.get("reason"), str) or not rule["reason"].strip():
            errors.append(f"rule_reason_missing:{rule_id}")

    tracked = [
        item.decode("utf-8")
        for item in git("ls-files", "-z").split(b"\0")
        if item
    ]
    tracked_set = set(tracked)

    classifications: dict[str, dict[str, Any]] = {}
    for path in tracked:
        rule = classify(rules, path)
        if rule is None:
            errors.append(f"unclassified_path:{path}")
        else:
            classifications[path] = rule

    counts = Counter(rule["disposition"] for rule in classifications.values())
    exported_target = (
        bool(tracked)
        and len(classifications) == len(tracked)
        and counts == Counter({"public-include": len(tracked)})
    )
    validation_mode = "exported-target" if exported_target else "source"

    source_base_reachable = False
    if isinstance(source_base, str):
        try:
            git("cat-file", "-e", f"{source_base}^{{commit}}")
            source_base_reachable = True
        except subprocess.CalledProcessError:
            if not exported_target:
                errors.append("source_base_not_reachable")

    coverage = manifest.get("auditCoverage", {})
    privacy_paths = set(coverage.get("privacySensitivePaths", []))
    media_paths = set(coverage.get("mediaPaths", []))
    exceptions = {
        item.get("path")
        for item in manifest.get("reviewedPublicExceptions", [])
        if isinstance(item, dict)
    }

    historical_only_privacy_paths = 0
    for path in sorted(privacy_paths):
        rule = classify(rules, path)
        if rule is None:
            errors.append(f"audit_path_unclassified:{path}")
            continue
        if path not in tracked_set:
            historical_only_privacy_paths += 1
        if rule["disposition"] == "public-include" and path not in exceptions:
            errors.append(f"privacy_path_public_without_exception:{path}")

    for path in sorted(media_paths):
        if path not in tracked_set:
            if not exported_target:
                errors.append(f"media_path_missing:{path}")
            continue
        rule = classifications.get(path)
        if rule is not None and rule["disposition"] != "private-source-only":
            errors.append(f"media_not_private:{path}")

    for path, rule in sorted(classifications.items()):
        if path.startswith("evidence/") and rule["disposition"] != "private-source-only":
            errors.append(f"evidence_not_private:{path}")

    manual_review_paths = sorted(
        path
        for path, rule in classifications.items()
        if rule["disposition"] == "manual-review"
    )
    rewrite_before_include_paths = sorted(
        path
        for path, rule in classifications.items()
        if rule["disposition"] == "rewrite-before-include"
    )
    if manual_review_paths:
        errors.append("manual_review_paths_remaining")
    if rewrite_before_include_paths:
        errors.append("rewrite_before_include_paths_remaining")

    package = json.loads(PACKAGE.read_text(encoding="utf-8"))
    package_lock = json.loads(PACKAGE_LOCK.read_text(encoding="utf-8"))
    if package.get("license") != "MIT":
        errors.append("package_license_not_mit")
    if package_lock.get("packages", {}).get("", {}).get("license") != "MIT":
        errors.append("package_lock_license_not_mit")
    if not ROOT_LICENSE.read_text(encoding="utf-8").startswith("MIT License\n"):
        errors.append("root_license_not_mit")

    result = {
        "ok": not errors,
        "validationMode": validation_mode,
        "sourceBase": source_base,
        "sourceBaseReachable": source_base_reachable,
        "trackedFiles": len(tracked),
        "classificationCounts": dict(sorted(counts.items())),
        "manualReviewPaths": manual_review_paths,
        "rewriteBeforeIncludePaths": rewrite_before_include_paths,
        "packageLicense": package.get("license"),
        "packageLockLicense": package_lock.get("packages", {}).get("", {}).get("license"),
        "rootLicense": "MIT" if "root_license_not_mit" not in errors else "unexpected",
        "privacySensitivePathsCovered": len(privacy_paths),
        "historicalOnlyPrivacyPaths": historical_only_privacy_paths,
        "mediaPathsCovered": len(media_paths),
        "errors": errors,
        "fileContentsPrinted": False,
        "matchedValuesPrinted": False,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
