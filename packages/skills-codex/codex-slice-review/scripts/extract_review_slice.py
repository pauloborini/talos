#!/usr/bin/env python3
"""Extract the review slice from a codex-plan-handoff-style markdown artifact."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Any

TASK_HEADING_RE = re.compile(r"^####\s+(T\d{2})\.\s+(.*)$")
FIELD_RE = re.compile(r"^- ([^:]+):\s*(.*)$")
HEADING_RE = re.compile(r"^(#{1,4})\s+(.*\S)\s*$")


def normalize_heading(text: str) -> str:
    text = re.sub(r"^\d+\.\s*", "", text.strip())
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def normalize_field(text: str) -> str:
    text = text.strip().strip("*").strip()
    text = re.sub(r"^\d+\.\s*", "", text)
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def parse_sections(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current_key: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        heading_match = HEADING_RE.match(line)
        if heading_match:
            current_key = normalize_heading(heading_match.group(2).strip())
            sections.setdefault(current_key, [])
            continue
        if current_key is not None and line.strip():
            sections[current_key].append(line)
    return sections


def first_section(sections: dict[str, list[str]], keys: list[str]) -> list[str]:
    for key in keys:
        if key in sections:
            return sections[key]
    return []


def parse_tasks(text: str) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_field: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        task_match = TASK_HEADING_RE.match(line)
        if task_match:
            current = {
                "id": task_match.group(1),
                "title": task_match.group(2).strip(),
                "fields": {},
            }
            tasks.append(current)
            current_field = None
            continue
        if current is None:
            continue
        field_match = FIELD_RE.match(line)
        if field_match:
            key = normalize_field(field_match.group(1))
            current["fields"][key] = field_match.group(2).strip().strip("*").strip()
            current_field = key
            continue
        if current_field and line.strip():
            previous = current["fields"].get(current_field, "")
            current["fields"][current_field] = f"{previous}\n{line.strip()}".strip()
    return tasks


def expected_files_for(task: dict[str, Any]) -> str:
    fields = task["fields"]
    for key in ("likely_files/modules", "files", "arquivos_verificados", "arquivos", "m_dulos"):
        value = fields.get(key)
        if value:
            return value
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", help="Path to the plan markdown file")
    parser.add_argument("--task-id", action="append", dest="task_ids", default=[], help="Task id to extract, repeatable")
    parser.add_argument("--changed-file", action="append", dest="changed_files", default=[], help="Changed file path, repeatable")
    args = parser.parse_args()

    text = pathlib.Path(args.plan).read_text(encoding="utf-8")
    sections = parse_sections(text)
    tasks = parse_tasks(text)
    selected = [task for task in tasks if not args.task_ids or task["id"] in args.task_ids]

    payload = {
        "task_ids": args.task_ids,
        "selected_tasks": selected,
        "changed_files": args.changed_files,
        "expected_files": [expected_files_for(task) for task in selected],
        "execution_metadata": {
            "plan_prefix": "",
            "execution_mode": "",
        },
        "plan_constraints": {
            "rules_and_decisions": first_section(
                sections,
                [
                    "project_rules_constraints_and_decisions_already_made",
                    "regras_e_restri_es_do_projeto",
                    "regras_decis_es",
                    "decis_es_fechadas",
                ],
            ),
            "contracts_invariants_quality": first_section(
                sections,
                ["contracts_invariants_and_quality_guarantees", "contratos_e_invariantes"],
            ),
            "risk_and_regression": first_section(
                sections,
                ["risk_and_regression_matrix", "regression_risks", "matriz_de_risco_e_regress_o", "riscos"],
            ),
            "validation": first_section(sections, ["validation", "valida_o", "valida_o_final"]),
        },
        "review_focus": [
            "logic gaps",
            "hidden scenarios",
            "regressions",
            "security risks",
            "missing tests",
            "plan contract drift",
            "source conflict drift",
            "permission matrix drift",
        ],
    }
    metadata_section = first_section(
        sections,
        ["execution_metadata", "metadados_de_execu_o", "metadados_execu_o"],
    )
    for line in metadata_section:
        lowered = line.lower()
        if "plan prefix" in lowered:
            payload["execution_metadata"]["plan_prefix"] = line.split(":", 1)[-1].strip().strip("`")
        elif "execution mode" in lowered:
            payload["execution_metadata"]["execution_mode"] = line.split(":", 1)[-1].strip().strip("`")
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
