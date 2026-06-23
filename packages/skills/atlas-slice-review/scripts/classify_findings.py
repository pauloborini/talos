#!/usr/bin/env python3
"""Wrapper legado: delega ao gate Node canônico por uma release."""

from __future__ import annotations

import pathlib
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("Usage: python classify_findings.py <findings.json>\n")
        return 1
    script = pathlib.Path(__file__).with_name("classify_findings.mjs")
    try:
        return subprocess.run(["node", str(script), sys.argv[1]], check=False).returncode
    except FileNotFoundError:
        sys.stderr.write("Node.js ausente: requisito runtime do Atlas\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
