#!/usr/bin/env python3
"""Extract execution-relevant sections from a codex-plan-handoff markdown artifact."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from typing import Any

HEADING_RE = re.compile(r"^(#{1,4})\s+(.*\S)\s*$")
TASK_RE = re.compile(r"^T\d{2}\.\s+")


def normalize_heading(text: str) -> str:
    text = re.sub(r"^\d+\.\s*", "", text.strip())
    text = re.sub(r"\(§\d+\)", "", text, flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def has_any(summary: dict[str, list[str]], keys: list[str]) -> bool:
    return any(key in summary for key in keys)


def first_section(summary: dict[str, list[str]], keys: list[str]) -> list[str]:
    for key in keys:
        if key in summary:
            return summary[key]
    return []


def parse_plan(text: str) -> dict[str, Any]:
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        match = HEADING_RE.match(line)
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            current = {
                "level": level,
                "title": title,
                "key": normalize_heading(title),
                "lines": [],
            }
            sections.append(current)
            continue
        if current is not None:
            current["lines"].append(line)

    tasks = []
    for section in sections:
        if section["level"] == 4 and TASK_RE.match(section["title"]):
            tasks.append(
                {
                    "id": section["title"].split(".", 1)[0],
                    "title": section["title"],
                    "body": [line for line in section["lines"] if line.strip()],
                }
            )

    summary = {section["key"]: [line for line in section["lines"] if line.strip()] for section in sections}
    metadata = {
        "plan_prefix": "",
        "execution_mode": "",
        "executor_skill": "",
        "internal_validator": "",
        "external_review": "",
    }

    metadata_section = first_section(
        summary,
        ["execution_metadata", "metadados_de_execu_o", "metadados_execu_o"],
    )
    for line in metadata_section:
        lowered = line.lower()
        if "plan prefix" in lowered:
            metadata["plan_prefix"] = line.split(":", 1)[-1].strip().strip("`")
        elif "execution mode" in lowered:
            metadata["execution_mode"] = line.split(":", 1)[-1].strip().strip("`")
        elif "executor skill" in lowered:
            metadata["executor_skill"] = line.split(":", 1)[-1].strip().strip("`")
        elif "internal validator" in lowered:
            metadata["internal_validator"] = line.split(":", 1)[-1].strip().strip("`")
        elif "external review" in lowered:
            metadata["external_review"] = line.split(":", 1)[-1].strip().strip("`")

    # Compact PLAN_TEMPLATE (sections 1–8); legacy aliases kept for older artifacts.
    required_groups = {
        "execution_metadata": ["execution_metadata", "metadados_de_execu_o", "metadados_execu_o"],
        "executive_translation": [
            "tradu_o_executiva",
            "executive_summary",
            "executive_translation",
            "resumo_executivo",
        ],
        "execution_invariants": [
            "invariantes_de_execu_o",
            "invariantes_de_execu_o_derivados_do_prd",
            "execution_invariants",
        ],
        "pitfalls": ["pitfalls"],
        "sprint_opening_state": [
            "estado_na_abertura_da_sprint",
            "estado_na_abertura_da_sprint_pr_implementa_o",
            "current_state_relevant_to_execution",
            "estado_atual_relevante_para_execu_o",
        ],
        "execution_tasks": ["tarefas_de_execu_o", "execution_tasks", "tarefas"],
        "technical_contracts": [
            "contratos_t_cnicos",
            "contratos_t_cnicos_s_ambiguidade_prd_c_digo",
            "technical_contracts",
        ],
        "validation_checklist": [
            "valida_o_e_checklist",
            "valida_o_e_checklist_validator",
            "validation_and_checklist",
            "validation",
            "valida_o",
            "valida_o_final",
        ],
    }

    optional_groups = {
        "slices": ["slices", "slices_somente_se_execution_mode_orchestrated_per_slice"],
        "open_questions_blockers": [
            "perguntas_em_aberto_e_bloqueios_reais",
            "open_questions_and_real_blockers",
            "open_questions",
            "real_blockers",
        ],
        # Legacy sections — extracted if present, never required.
        "handoff_prompt": ["handoff_prompt", "executor_guidance"],
        "legacy_scope": ["scope", "escopo"],
        "legacy_architecture": [
            "solution_design_and_architecture",
            "design_e_arquitetura_da_solu_o",
        ],
    }

    missing = [name for name, aliases in required_groups.items() if not has_any(summary, aliases)]

    execution_mode = metadata.get("execution_mode", "").lower()
    if "orchestrated" in execution_mode and not has_any(summary, optional_groups["slices"]):
        missing.append("slices")

    return {
        "sections": [
            {"title": section["title"], "key": section["key"], "level": section["level"]}
            for section in sections
        ],
        "tasks": tasks,
        "missing_required_sections": missing,
        "execution_metadata": metadata,
        "summary": {
            "execution_metadata": metadata_section,
            "executive_translation": first_section(summary, required_groups["executive_translation"]),
            "execution_invariants": first_section(summary, required_groups["execution_invariants"]),
            "pitfalls": first_section(summary, required_groups["pitfalls"]),
            "sprint_opening_state": first_section(summary, required_groups["sprint_opening_state"]),
            "execution_tasks": first_section(summary, required_groups["execution_tasks"]),
            "technical_contracts": first_section(summary, required_groups["technical_contracts"]),
            "validation_checklist": first_section(summary, required_groups["validation_checklist"]),
            "slices": first_section(summary, optional_groups["slices"]),
            "open_questions_blockers": first_section(
                summary, optional_groups["open_questions_blockers"]
            ),
            "handoff_prompt": first_section(summary, optional_groups["handoff_prompt"]),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", help="Path to a markdown plan artifact")
    args = parser.parse_args()

    plan_path = pathlib.Path(args.plan)
    payload = parse_plan(plan_path.read_text(encoding="utf-8"))
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
