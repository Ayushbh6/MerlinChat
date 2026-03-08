import json
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from backend.core.constants import (
    DEFAULT_MODEL,
    FORCE_FINAL_AFTER_CODE_STEPS,
    MAX_AGENT_TURNS,
    MAX_MODEL_FEEDBACK_BYTES,
    MAX_RUN_STEPS,
    MAX_STEP_EXECUTION_SECONDS,
    MAX_TOTAL_RUN_SECONDS,
)
from backend.core.llm_client import create_structured_completion
from backend.db.database import messages_collection
from backend.prompts.agent_prompt import (
    build_agent_system_prompt,
    build_agent_turn_prompt,
)
from backend.runtime.agent_contract import validate_agent_turn
from backend.runtime.sandbox_runner import execute_run_code
from backend.schemas.models import AgentTurn
from backend.services.run_service import (
    create_run_step,
    get_run_or_404,
    list_run_steps,
    serialize_run,
    serialize_run_step,
    store_message,
    touch_conversation,
    update_run,
)
from backend.services.workspace_service import get_workspace_or_404, write_workspace_manifest

AGENT_SCHEMA = {
    "name": "agent_turn",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "thought": {
                "type": "string",
                "description": "A brief one-line description of the immediate next move.",
            },
            "action": {
                "type": "string",
                "enum": ["code", "final_answer"],
                "description": "Use 'code' to execute Python next, or 'final_answer' to stop and answer.",
            },
            "code": {
                "type": "string",
                "description": "Python code to run next. Must be empty when action is 'final_answer'.",
            },
            "next_step_needed": {
                "type": "boolean",
                "description": "True only when another execution step is required.",
            },
            "final_answer": {
                "type": ["string", "null"],
                "description": "The user-facing final answer. Required only when action is 'final_answer'.",
            },
        },
        "required": [
            "thought",
            "action",
            "code",
            "next_step_needed",
            "final_answer",
        ],
    },
}

MAX_REPAIR_ATTEMPTS = 1
MAX_PRIOR_STEPS_IN_PROMPT = 3


def _truncate_tail(value: str, max_bytes: int) -> str:
    encoded = value.encode("utf-8", errors="replace")
    if len(encoded) <= max_bytes:
        return value
    trimmed = encoded[-max_bytes:]
    return trimmed.decode("utf-8", errors="replace")


def _summarize_artifacts(artifacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    summarized: list[dict[str, Any]] = []
    for artifact in artifacts:
        summarized.append(
            {
                "name": artifact.get("name"),
                "path": artifact.get("agent_path") or artifact.get("runtime_path"),
                "content_type": artifact.get("content_type"),
                "size_bytes": artifact.get("size_bytes"),
            }
        )
    return summarized


def _step_feedback(step: dict[str, Any]) -> dict[str, Any]:
    return {
        "step": step["step_index"],
        "exit_code": step["exit_code"],
        "stdout_tail": _truncate_tail(step.get("stdout", ""), MAX_MODEL_FEEDBACK_BYTES),
        "stderr_tail": _truncate_tail(step.get("stderr", ""), MAX_MODEL_FEEDBACK_BYTES),
        "artifacts": _summarize_artifacts(step.get("artifacts", [])),
    }


def _build_memory_snapshot() -> dict[str, Any]:
    return {}


async def _load_conversation_history(
    conversation_id: str,
    current_user_prompt: str,
) -> list[dict[str, str]]:
    cursor = messages_collection.find({"conversation_id": conversation_id}).sort("created_at", 1)
    messages = await cursor.to_list(length=200)
    if not messages:
        return []

    prior_messages = list(messages)
    if (
        prior_messages
        and prior_messages[-1].get("role") == "user"
        and (prior_messages[-1].get("content") or "").strip() == current_user_prompt.strip()
    ):
        prior_messages = prior_messages[:-1]

    conversation_history: list[dict[str, str]] = []
    for message in prior_messages:
        role = message.get("role")
        content = (message.get("content") or "").strip()
        if not content:
            continue
        if role not in {"user", "assistant"}:
            continue
        conversation_history.append({"role": role, "content": content})

    return conversation_history


def _build_turn_payload(
    run: dict[str, Any],
    workspace: dict[str, Any],
    manifest: dict[str, Any],
    steps: list[dict[str, Any]],
    conversation_history: list[dict[str, str]],
    *,
    force_final_answer: bool,
) -> dict[str, Any]:
    files = []
    for file_entry in manifest.get("files", []):
        files.append(
            {
                "filename": file_entry.get("filename"),
                "stored_filename": file_entry.get("stored_filename"),
                "content_type": file_entry.get("content_type"),
                "size_bytes": file_entry.get("size_bytes"),
                "path": file_entry.get("agent_path"),
            }
        )

    recent_steps = steps[-MAX_PRIOR_STEPS_IN_PROMPT:]
    return {
        "workspace": {
            "id": str(workspace["_id"]),
            "title": workspace.get("title"),
            "manifest_path": "workspace_manifest.json",
            "docs_dir": "docs",
            "artifacts_dir": "artifacts",
            "files": files,
        },
        "user_task": run["user_prompt"],
        "conversation_history": conversation_history,
        "memory": _build_memory_snapshot(),
        "limits": {
            "max_code_steps": MAX_RUN_STEPS,
            "max_total_turns": MAX_AGENT_TURNS,
            "force_final_after_code_steps": FORCE_FINAL_AFTER_CODE_STEPS,
            "max_step_seconds": MAX_STEP_EXECUTION_SECONDS,
            "max_total_run_seconds": MAX_TOTAL_RUN_SECONDS,
            "max_feedback_chars": MAX_MODEL_FEEDBACK_BYTES,
        },
        "force_final_answer": force_final_answer,
        "prior_steps": [_step_feedback(step) for step in recent_steps],
    }


def _extract_message_text(message: Any) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(item.get("text", ""))
            else:
                text = getattr(item, "text", None)
                if text:
                    text_parts.append(text)
        return "".join(text_parts)
    return str(content or "")


async def _request_agent_turn(
    *,
    model: str,
    payload: dict[str, Any],
    code_step_count: int,
) -> AgentTurn:
    repair_message: str | None = None
    last_error = "model did not return a valid AgentTurn payload"

    for _ in range(MAX_REPAIR_ATTEMPTS + 1):
        response = await create_structured_completion(
            model=model,
            messages=[
                {"role": "system", "content": build_agent_system_prompt()},
                {
                    "role": "user",
                    "content": build_agent_turn_prompt(
                        payload,
                        repair_message=repair_message,
                    ),
                },
            ],
            json_schema=AGENT_SCHEMA,
            plugins=[{"id": "response-healing"}],
            extra_body={
                "reasoning": {"enabled": True, "exclude": True},
                "include_reasoning": False,
            },
        )
        if not response.choices:
            last_error = "model returned no choices"
            repair_message = (
                "Your previous reply had no usable content. Return valid AgentTurn JSON only."
            )
            continue

        raw_text = _extract_message_text(response.choices[0].message).strip()
        if not raw_text:
            last_error = "model returned empty content"
            repair_message = (
                "Your previous reply was empty. Return valid AgentTurn JSON only."
            )
            continue

        try:
            parsed = json.loads(raw_text)
            agent_turn = AgentTurn.model_validate(parsed)
            return validate_agent_turn(agent_turn, code_step_count)
        except (json.JSONDecodeError, ValidationError, HTTPException) as exc:
            last_error = str(exc)
            repair_message = (
                "Your previous reply was invalid. Return valid AgentTurn JSON only. "
                f"Validation error: {last_error}"
            )

    raise HTTPException(status_code=502, detail=last_error)


async def run_agent_loop(run_id: str) -> dict[str, Any]:
    run = await get_run_or_404(run_id)
    if run["status"] in {"completed", "failed", "cancelled"}:
        raise HTTPException(status_code=400, detail="run is already in a terminal state")

    workspace = await get_workspace_or_404(run["workspace_id"])
    manifest = await write_workspace_manifest(workspace)
    model = run.get("model") or DEFAULT_MODEL
    run = await update_run(run_id, status="running", failure_reason=None)
    conversation_history = await _load_conversation_history(
        run["conversation_id"],
        run["user_prompt"],
    )

    try:
        while True:
            run = await get_run_or_404(run_id)
            steps = await list_run_steps(run_id)
            code_step_count = len(steps)
            force_final_answer = code_step_count >= FORCE_FINAL_AFTER_CODE_STEPS
            payload = _build_turn_payload(
                run,
                workspace,
                manifest,
                steps,
                conversation_history,
                force_final_answer=force_final_answer,
            )
            agent_turn = await _request_agent_turn(
                model=model,
                payload=payload,
                code_step_count=code_step_count,
            )

            if agent_turn.action == "final_answer":
                await store_message(
                    run["conversation_id"],
                    "assistant",
                    agent_turn.final_answer or "",
                )
                await touch_conversation(run["conversation_id"])
                updated_run = await update_run(
                    run_id,
                    status="completed",
                    final_answer=agent_turn.final_answer,
                    failure_reason=None,
                )
                final_steps = await list_run_steps(run_id)
                return {
                    "run": serialize_run(updated_run),
                    "steps": [serialize_run_step(step) for step in final_steps],
                }

            try:
                execution = await execute_run_code(run_id, agent_turn.code)
            except HTTPException as exc:
                detail = str(exc.detail)
                if detail in {"max steps per run reached", "max total run time reached"}:
                    raise

                execution = {
                    "code": agent_turn.code,
                    "stdout": "",
                    "stderr": detail,
                    "exit_code": 1,
                    "artifacts": [],
                    "duration_ms": 0,
                }
            await create_run_step(
                run_id,
                thought=agent_turn.thought,
                code=execution["code"],
                stdout=execution["stdout"],
                stderr=execution["stderr"],
                exit_code=execution["exit_code"],
                artifacts=execution["artifacts"],
                next_step_needed=agent_turn.next_step_needed,
                duration_ms=execution["duration_ms"],
            )

            if len(steps) + 1 >= MAX_AGENT_TURNS:
                raise HTTPException(status_code=400, detail="max agent turns reached")

    except HTTPException as exc:
        failure_reason = str(exc.detail)
        updated_run = await update_run(
            run_id,
            status="failed",
            failure_reason=failure_reason,
        )
        final_steps = await list_run_steps(run_id)
        return {
            "run": serialize_run(updated_run),
            "steps": [serialize_run_step(step) for step in final_steps],
        }
    except Exception as exc:
        failure_reason = str(exc)
        updated_run = await update_run(
            run_id,
            status="failed",
            failure_reason=failure_reason,
        )
        final_steps = await list_run_steps(run_id)
        return {
            "run": serialize_run(updated_run),
            "steps": [serialize_run_step(step) for step in final_steps],
        }
