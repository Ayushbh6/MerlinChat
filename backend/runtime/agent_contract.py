import ast
import re
from typing import Any

from fastapi import HTTPException

from backend.core.constants import FORCE_FINAL_AFTER_CODE_STEPS
from backend.schemas.models import AgentTurn

BLOCKED_STEP_EXIT_CODE = 2
BLOCKED_STEP_PREFIX = "Execution blocked: duplicate or stagnant code step."
MAX_CONSECUTIVE_BLOCKED_STEPS = 2


def validate_agent_turn(agent_turn: AgentTurn, code_step_count: int) -> AgentTurn:
    if code_step_count >= FORCE_FINAL_AFTER_CODE_STEPS and agent_turn.action != "final_answer":
        raise HTTPException(
            status_code=400,
            detail=(
                "final_answer is required after "
                f"{FORCE_FINAL_AFTER_CODE_STEPS} code steps"
            ),
        )
    return agent_turn


class _NormalizeIdentifiers(ast.NodeTransformer):
    def __init__(self) -> None:
        self._mapping: dict[str, str] = {}
        self._counter = 0

    def _token(self, value: str) -> str:
        if value not in self._mapping:
            self._counter += 1
            self._mapping[value] = f"v{self._counter}"
        return self._mapping[value]

    def visit_Name(self, node: ast.Name) -> ast.AST:
        return ast.copy_location(ast.Name(id=self._token(node.id), ctx=node.ctx), node)

    def visit_arg(self, node: ast.arg) -> ast.AST:
        node.arg = self._token(node.arg)
        return node

    def visit_alias(self, node: ast.alias) -> ast.AST:
        if node.asname:
            node.asname = self._token(node.asname)
        return node


def normalize_code_for_comparison(code: str) -> str:
    source = code.strip()
    if not source:
        return ""

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return re.sub(r"\s+", " ", source)

    normalized = _NormalizeIdentifiers().visit(tree)
    ast.fix_missing_locations(normalized)
    return ast.dump(normalized, annotate_fields=False, include_attributes=False)


def detect_duplicate_or_stagnant_code(
    code: str,
    prior_steps: list[dict[str, Any]],
) -> str | None:
    current = normalize_code_for_comparison(code)
    if not current:
        return None

    for step in reversed(prior_steps):
        if int(step.get("exit_code", 1)) != 0:
            continue
        previous = normalize_code_for_comparison(step.get("code", ""))
        if previous and previous == current:
            return (
                f"{BLOCKED_STEP_PREFIX} The proposed code is materially identical to "
                f"step {step.get('step_index')} and would repeat the same inspection."
            )

    return None


def count_trailing_blocked_steps(prior_steps: list[dict[str, Any]]) -> int:
    count = 0
    for step in reversed(prior_steps):
        if int(step.get("exit_code", 0)) != BLOCKED_STEP_EXIT_CODE:
            break
        stderr = step.get("stderr", "")
        if not isinstance(stderr, str) or not stderr.startswith(BLOCKED_STEP_PREFIX):
            break
        count += 1
    return count
