#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

BUILDER = Path(__file__).with_name("build_public_candidate.py").resolve()
MANIFEST = "tools/release-audit/public-candidate-classification.json"


def run(*args: str, cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


class BuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        run("git", "init", "-q", "--initial-branch=main", cwd=self.repo)
        run("git", "config", "user.name", "Candidate Test", cwd=self.repo)
        run("git", "config", "user.email", "candidate@example.com", cwd=self.repo)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write(self, path: str, content: str, mode: int = 0o644) -> None:
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        os.chmod(target, mode)

    def manifest(self, extra: list[dict[str, str]] | None = None) -> dict[str, object]:
        rules = [
            {"id":"readme","kind":"exact","pattern":"README.md","disposition":"public-include","reason":"fixture"},
            {"id":"script","kind":"exact","pattern":"script.sh","disposition":"public-include","reason":"fixture"},
            {"id":"private","kind":"prefix","pattern":"private/","disposition":"private-source-only","reason":"fixture"},
            {"id":"tools","kind":"prefix","pattern":"tools/","disposition":"public-include","reason":"fixture"},
        ]
        return {
            "schemaVersion":1,
            "sourceRepository":"example/source",
            "publicationStrategy":{"mode":"history-free-clean-export","sourceRepositoryRemainsPrivate":True,
                                     "targetRepository":None,"authorizationRequiredBeforeTargetCreation":True},
            "allowedDispositions":["public-include","private-source-only","rewrite-before-include","manual-review"],
            "rules": (extra or []) + rules,
        }

    def commit(self, manifest: dict[str, object] | None = None) -> str:
        self.write("README.md", "committed\n")
        self.write("script.sh", "#!/bin/sh\necho public\n", 0o755)
        self.write("private/operator.txt", "private\n")
        self.write(MANIFEST, json.dumps(manifest or self.manifest()))
        run("git", "add", "-A", cwd=self.repo)
        run("git", "commit", "-qm", "fixture", cwd=self.repo)
        return run("git", "rev-parse", "HEAD", cwd=self.repo).stdout.strip()

    def build(self, name: str, source: str = "HEAD") -> subprocess.CompletedProcess[str]:
        return run(sys.executable, str(BUILDER), "--source", source,
                   "--output-dir", str(self.root / name), "--archive", str(self.root / f"{name}.tar.gz"),
                   "--report", str(self.root / f"{name}.json"), cwd=self.repo, check=False)

    def test_deterministic_commit_bound_allowlist(self) -> None:
        commit = self.commit()
        self.write("README.md", "dirty\n")
        first = self.build("one", commit); second = self.build("two", commit)
        self.assertEqual(first.returncode, 0, first.stderr); self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual((self.root / "one/README.md").read_text(), "committed\n")
        self.assertFalse((self.root / "one/private/operator.txt").exists())
        self.assertTrue(stat.S_IMODE((self.root / "one/script.sh").stat().st_mode) & stat.S_IXUSR)
        self.assertEqual((self.root / "one.tar.gz").read_bytes(), (self.root / "two.tar.gz").read_bytes())
        report = json.loads((self.root / "one.json").read_text())
        self.assertEqual(report["sourceCommit"], commit)
        self.assertEqual(report["includedFileCount"], 3)
        self.assertNotIn("private/operator.txt", (self.root / "one.json").read_text())
        with tarfile.open(self.root / "one.tar.gz", "r:gz") as archive:
            self.assertNotIn("solforge-public-candidate/private/operator.txt", archive.getnames())
            self.assertEqual(archive.getmember("solforge-public-candidate/script.sh").mtime, 0)

    def test_unresolved_and_symlink_fail_closed(self) -> None:
        pending = {"id":"pending","kind":"exact","pattern":"pending.txt","disposition":"manual-review","reason":"pending"}
        self.write("pending.txt", "pending\n")
        self.commit(self.manifest([pending]))
        result = self.build("pending")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stderr)["code"], "unresolved_disposition")

        (self.repo / "pending.txt").unlink()
        link_rule = {"id":"link","kind":"exact","pattern":"link.txt","disposition":"public-include","reason":"fixture"}
        self.write(MANIFEST, json.dumps(self.manifest([link_rule])))
        os.symlink("README.md", self.repo / "link.txt")
        run("git", "add", "-A", cwd=self.repo)
        run("git", "commit", "-qm", "link fixture", cwd=self.repo)
        result = self.build("link")
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stderr)["code"], "unsupported_public_entry")


if __name__ == "__main__":
    unittest.main()
