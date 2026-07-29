#!/usr/bin/env python3
"""Optional OSS media helpers for Solforge (image / tts / stt)."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def status() -> dict:
    sd = env("SOLFORGE_SD_URL", "http://127.0.0.1:7860")
    piper = env("SOLFORGE_PIPER_BIN") or shutil.which("piper") or ""
    whisper = env("SOLFORGE_WHISPER_BIN") or shutil.which("whisper") or shutil.which("whisper-cli") or ""
    sd_ok = False
    try:
        with urllib.request.urlopen(sd + "/sdapi/v1/options", timeout=2) as r:
            sd_ok = r.status == 200
    except Exception:
        try:
            with urllib.request.urlopen(sd, timeout=2) as r:
                sd_ok = True
        except Exception:
            sd_ok = False
    return {
        "sd_url": sd,
        "sd_reachable": sd_ok,
        "piper": piper or None,
        "whisper": whisper or None,
    }


def tts(text: str, out: Path) -> None:
    piper = env("SOLFORGE_PIPER_BIN") or shutil.which("piper")
    voice = env("SOLFORGE_PIPER_VOICE")
    if not piper:
        raise SystemExit("piper not installed; set SOLFORGE_PIPER_BIN")
    cmd = [piper, "--output_file", str(out)]
    if voice:
        cmd.extend(["--model", voice])
    subprocess.run(cmd, input=text.encode(), check=True)


def image(prompt: str, out: Path) -> None:
    sd = env("SOLFORGE_SD_URL", "http://127.0.0.1:7860").rstrip("/")
    body = json.dumps({"prompt": prompt, "steps": 20}).encode()
    req = urllib.request.Request(
        sd + "/sdapi/v1/txt2img",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.load(r)
    except urllib.error.URLError as e:
        raise SystemExit(f"SD API unreachable at {sd}: {e}") from e
    images = data.get("images") or []
    if not images:
        raise SystemExit("no images in SD response")
    import base64

    raw = base64.b64decode(images[0].split(",", 1)[-1])
    out.write_bytes(raw)


def main() -> int:
    p = argparse.ArgumentParser(prog="solforge-media")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    t = sub.add_parser("tts")
    t.add_argument("--text", required=True)
    t.add_argument("--out", required=True)
    i = sub.add_parser("image")
    i.add_argument("--prompt", required=True)
    i.add_argument("--out", required=True)
    args = p.parse_args()
    if args.cmd == "status":
        print(json.dumps(status(), indent=2))
        return 0
    if args.cmd == "tts":
        tts(args.text, Path(args.out))
        print(args.out)
        return 0
    if args.cmd == "image":
        image(args.prompt, Path(args.out))
        print(args.out)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
