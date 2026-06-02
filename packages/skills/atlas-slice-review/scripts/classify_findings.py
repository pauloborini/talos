#!/usr/bin/env python3
"""Normalize raw findings into a severity-oriented review structure."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

SEVERITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


def load_findings(path: pathlib.Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Findings input must be a JSON array")
    return payload


def normalize_finding(finding: dict[str, Any]) -> dict[str, Any]:
    severity = finding.get("severity", "P2")
    if severity not in SEVERITY_ORDER:
        severity = "P2"
    return {
        "severity": severity,
        "task_id": finding.get("task_id", ""),
        "title": finding.get("title", ""),
        "file": finding.get("file", ""),
        "line": finding.get("line"),
        "summary": finding.get("summary", ""),
        "evidence": finding.get("evidence", ""),
        "diff_attributed": bool(finding.get("diff_attributed", True)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("findings_json", help="Path to a JSON array of findings")
    args = parser.parse_args()

    try:
        normalized = [normalize_finding(item) for item in load_findings(pathlib.Path(args.findings_json))]
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"{exc}\n")
        return 1

    normalized.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], item["task_id"], item["file"], item["line"] or 0))
    json.dump(normalized, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
