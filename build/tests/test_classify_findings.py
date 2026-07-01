#!/usr/bin/env python3
"""Testes do gate determinístico de findings da talos-slice-review."""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "packages/skills/talos-slice-review/scripts/classify_findings.py"


def valid_finding() -> dict[str, object]:
    return {
        "severity": "P1",
        "task_id": "T01",
        "title": "Finding confirmado",
        "file": "packages/example.py",
        "line": 12,
        "failure_mode": "Entrada inválida alcança estado inconsistente.",
        "evidence": "Guard ausente na linha indicada.",
        "recommendation": "Restabelecer o guard no proprietário do invariante.",
        "fix_validation": "Teste negativo deve manter o estado anterior.",
    }


def run_gate(payload: object) -> subprocess.CompletedProcess[str]:
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json") as handle:
        json.dump(payload, handle)
        handle.flush()
        return subprocess.run(
            [sys.executable, str(SCRIPT), handle.name],
            check=False,
            capture_output=True,
            text=True,
        )


class ClassifyFindingsTest(unittest.TestCase):
    def test_accepts_complete_finding(self) -> None:
        result = run_gate([valid_finding()])
        self.assertEqual(result.returncode, 0, result.stderr)
        normalized = json.loads(result.stdout)
        self.assertEqual(normalized[0]["recommendation"], valid_finding()["recommendation"])

    def test_accepts_empty_findings(self) -> None:
        result = run_gate([])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [])

    def test_rejects_missing_recommendation(self) -> None:
        finding = valid_finding()
        del finding["recommendation"]
        result = run_gate([finding])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("recommendation", result.stderr)

    def test_rejects_invalid_severity(self) -> None:
        finding = valid_finding()
        finding["severity"] = "high"
        result = run_gate([finding])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid severity", result.stderr)

    def test_rejects_invalid_line(self) -> None:
        finding = valid_finding()
        finding["line"] = 0
        result = run_gate([finding])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid line", result.stderr)


if __name__ == "__main__":
    unittest.main()
