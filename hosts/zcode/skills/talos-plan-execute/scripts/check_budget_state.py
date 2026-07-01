#!/usr/bin/env python3
"""Track bounded repair attempts for a gated execution task."""

from __future__ import annotations

import argparse
import json
import pathlib
from dataclasses import dataclass, asdict


@dataclass
class BudgetState:
    task_id: str
    max_attempts: int = 2
    max_same_failure: int = 2
    attempts: int = 0
    same_failure_count: int = 0
    last_failure_key: str = ""
    blocked: bool = False


def load_state(path: pathlib.Path) -> BudgetState:
    if not path.exists():
        raise FileNotFoundError(f"State file not found: {path}")
    return BudgetState(**json.loads(path.read_text(encoding="utf-8")))


def save_state(path: pathlib.Path, state: BudgetState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(state), indent=2) + "\n", encoding="utf-8")


def cmd_init(args: argparse.Namespace) -> int:
    state = BudgetState(
        task_id=args.task_id,
        max_attempts=args.max_attempts,
        max_same_failure=args.max_same_failure,
    )
    save_state(pathlib.Path(args.state_file), state)
    print(json.dumps(asdict(state), indent=2))
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    path = pathlib.Path(args.state_file)
    state = load_state(path)
    state.attempts += 1

    if args.failure_key:
        if args.failure_key == state.last_failure_key:
            state.same_failure_count += 1
        else:
            state.last_failure_key = args.failure_key
            state.same_failure_count = 1

    if state.attempts >= state.max_attempts or state.same_failure_count >= state.max_same_failure:
        state.blocked = True

    save_state(path, state)
    print(json.dumps(asdict(state), indent=2))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    state = load_state(pathlib.Path(args.state_file))
    print(json.dumps(asdict(state), indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init")
    init_parser.add_argument("state_file")
    init_parser.add_argument("task_id")
    init_parser.add_argument("--max-attempts", type=int, default=2)
    init_parser.add_argument("--max-same-failure", type=int, default=2)
    init_parser.set_defaults(func=cmd_init)

    record_parser = subparsers.add_parser("record")
    record_parser.add_argument("state_file")
    record_parser.add_argument("--failure-key", default="")
    record_parser.set_defaults(func=cmd_record)

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("state_file")
    status_parser.set_defaults(func=cmd_status)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
