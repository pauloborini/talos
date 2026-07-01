#!/usr/bin/env python3
"""Classify a gate outcome into pass, fixable, or blocked."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any


def load_json(path: pathlib.Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"JSON file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("gate_result", help="JSON file describing the gate outcome")
    parser.add_argument("--budget-state", help="Optional budget state JSON file")
    args = parser.parse_args()

    try:
        payload = load_json(pathlib.Path(args.gate_result))
        budget = load_json(pathlib.Path(args.budget_state)) if args.budget_state else {}
    except FileNotFoundError as exc:
        sys.stderr.write(f"{exc}\n")
        return 1

    failed_checks = payload.get("failed_checks", [])
    invariant_breaks = payload.get("invariant_breaks", [])
    external_blockers = payload.get("external_blockers", [])
    diff_attributed = payload.get("diff_attributed", True)

    if external_blockers or budget.get("blocked"):
        status = "blocked"
    elif failed_checks or invariant_breaks:
        status = "fixable" if diff_attributed else "blocked"
    else:
        status = "pass"

    result = {
        "status": status,
        "failed_checks": failed_checks,
        "invariant_breaks": invariant_breaks,
        "external_blockers": external_blockers,
        "diff_attributed": diff_attributed,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
