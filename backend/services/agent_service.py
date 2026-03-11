import asyncio
import base64
import json
import logging
import os
import re
import traceback
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError

from backend.core.constants import (
    DEFAULT_MODEL,
    FORCE_FINAL_AFTER_CODE_STEPS,
    MAX_AGENT_TURNS,
    MAX_ATTACHED_IMAGES_PER_TURN,
    MAX_CONTEXT_TOKENS,
    MAX_MODEL_FEEDBACK_BYTES,
    MAX_RUN_STEPS,
    MAX_SINGLE_ATTACHED_IMAGE_BYTES,
    MAX_STEP_EXECUTION_SECONDS,
    MAX_TOTAL_ATTACHED_IMAGE_BYTES,
    MAX_TOTAL_RUN_SECONDS,
)
from backend.core.llm_client import create_structured_completion, open_structured_completion_stream
from backend.db.database import messages_collection
from backend.prompts.agent_prompt import (
    build_agent_system_prompt,
    build_agent_turn_prompt,
)
from backend.runtime.agent_contract import (
    BLOCKED_STEP_EXIT_CODE,
    BLOCKED_STEP_PREFIX,
    MAX_CONSECUTIVE_BLOCKED_STEPS,
    count_trailing_blocked_steps,
    detect_duplicate_or_stagnant_code,
    validate_agent_turn,
)
from backend.runtime.sandbox_runner import execute_run_code
from backend.runtime.workspace_storage import workspace_storage
from backend.schemas.models import AgentTurn
from backend.services.run_event_service import append_run_event
from backend.services.run_service import (
    create_run_step,
    get_run_or_404,
    heartbeat_run,
    list_run_steps,
    serialize_run,
    serialize_run_step,
    store_message,
    touch_conversation,
    update_run,
)
from backend.services.trace_service import build_trace_summary
from backend.services.turn_service import update_turn
from backend.services.workspace_service import (
    get_workspace_or_404,
    list_workspace_files_docs,
    write_workspace_manifest,
)
from backend.utils.token_utils import get_encoding, trim_pairs_to_limit

logger = logging.getLogger(__name__)

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
MAX_PRIOR_STEPS_IN_PROMPT = MAX_AGENT_TURNS
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
FAKE_STREAM_CHUNK_SIZE = 220
FAKE_STREAM_DELAY_SECONDS = 0.012


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
        "thought": step.get("thought"),
        "stdout_tail": _truncate_tail(step.get("stdout", ""), MAX_MODEL_FEEDBACK_BYTES),
        "stderr_tail": _truncate_tail(step.get("stderr", ""), MAX_MODEL_FEEDBACK_BYTES),
        "artifacts": _summarize_artifacts(step.get("artifacts", [])),
    }


def _chunk_text(value: str, *, chunk_size: int = 160) -> list[str]:
    text = (value or "").strip()
    if not text:
        return []

    chunks: list[str] = []
    for line in text.splitlines(keepends=True):
        if len(line) <= chunk_size:
            chunks.append(line)
            continue
        start = 0
        while start < len(line):
            chunks.append(line[start : start + chunk_size])
            start += chunk_size
    return chunks


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _stream_final_answer_enabled() -> bool:
    return _env_flag("OPENROUTER_STREAM_FINAL_ANSWER", True)


def _max_streamed_final_answer_chars() -> int:
    return _env_int("MAX_STREAMED_FINAL_ANSWER_CHARS", 40000)


def _build_agent_turn_messages(
    payload: dict[str, Any],
    attached_images: list[dict[str, Any]],
    *,
    repair_message: str | None = None,
) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": build_agent_system_prompt()},
        {
            "role": "user",
            "content": _build_agent_user_message_content(
                build_agent_turn_prompt(
                    payload,
                    repair_message=repair_message,
                ),
                attached_images,
            ),
        },
    ]


async def _replay_answer_deltas(run_id: str, final_answer: str) -> None:
    for chunk in _chunk_text(final_answer, chunk_size=FAKE_STREAM_CHUNK_SIZE):
        await append_run_event(
            run_id,
            "answer.delta",
            {"chunk": chunk},
        )
        await asyncio.sleep(FAKE_STREAM_DELAY_SECONDS)


def _extract_partial_agent_turn(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value

    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(exclude_none=False)
        if isinstance(dumped, dict):
            return dumped

    return None


class StructuredStreamError(Exception):
    def __init__(self, message: str, *, emitted_answer: str = "") -> None:
        super().__init__(message)
        self.emitted_answer = emitted_answer


async def _emit_step_stream(
    run_id: str,
    *,
    step_index: int,
    thought: str | None,
    code: str,
    stdout: str,
    stderr: str,
    exit_code: int,
    artifacts: list[dict[str, Any]],
    duration_ms: int,
    created_at: str | None = None,
) -> None:
    await append_run_event(
        run_id,
        "step.started",
        {
            "step_index": step_index,
            "thought": thought,
            "status": "running",
        },
    )
    for chunk in _chunk_text(code):
        await append_run_event(
            run_id,
            "step.code.delta",
            {"step_index": step_index, "chunk": chunk},
        )
    for chunk in _chunk_text(stdout):
        await append_run_event(
            run_id,
            "step.stdout.delta",
            {"step_index": step_index, "chunk": chunk},
        )
    for chunk in _chunk_text(stderr):
        await append_run_event(
            run_id,
            "step.stderr.delta",
            {"step_index": step_index, "chunk": chunk},
        )
    await append_run_event(
        run_id,
        "step.completed",
        {
            "step_index": step_index,
            "thought": thought,
            "code": code,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code,
            "artifacts": _summarize_artifacts(artifacts),
            "duration_ms": duration_ms,
            "created_at": created_at,
            "status": "completed",
        },
    )


def _build_memory_snapshot() -> dict[str, Any]:
    return {}


def _normalize_tokens(value: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", value.lower()) if token]


def _is_image_file(file_doc: dict[str, Any]) -> bool:
    content_type = (file_doc.get("content_type") or "").lower()
    if content_type.startswith("image/"):
        return True
    filename = (file_doc.get("filename") or "").lower()
    return any(filename.endswith(ext) for ext in IMAGE_EXTENSIONS)


def _score_image_relevance(prompt: str, file_doc: dict[str, Any]) -> int:
    prompt_lower = prompt.lower()
    prompt_tokens = set(_normalize_tokens(prompt))
    filename = (file_doc.get("filename") or "").lower()
    stored_filename = (file_doc.get("stored_filename") or "").lower()
    score = 0

    for candidate in {filename, stored_filename}:
        if candidate and candidate in prompt_lower:
            score += 100

    for token in _normalize_tokens(filename):
        if len(token) >= 3 and token in prompt_tokens:
            score += 10

    if any(keyword in prompt_tokens for keyword in {"image", "images", "diagram", "figure", "screenshot", "photo", "chart", "graph"}):
        score += 5

    return score


async def _prepare_attached_images(
    user_prompt: str,
    file_docs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    image_docs = [file_doc for file_doc in file_docs if _is_image_file(file_doc)]
    if not image_docs:
        return [], 0

    ranked = sorted(
        image_docs,
        key=lambda file_doc: (
            -_score_image_relevance(user_prompt, file_doc),
            file_doc.get("created_at"),
            file_doc.get("filename", ""),
        ),
    )

    selected: list[dict[str, Any]] = []
    total_bytes = 0
    skipped = 0

    for file_doc in ranked:
        if len(selected) >= MAX_ATTACHED_IMAGES_PER_TURN:
            skipped += 1
            continue

        size_bytes = int(file_doc.get("size_bytes") or 0)
        if size_bytes > MAX_SINGLE_ATTACHED_IMAGE_BYTES:
            skipped += 1
            continue
        if total_bytes + size_bytes > MAX_TOTAL_ATTACHED_IMAGE_BYTES:
            skipped += 1
            continue

        try:
            data = await workspace_storage.read_file_bytes(file_doc)
        except Exception:
            skipped += 1
            continue

        content_type = file_doc.get("content_type") or "image/png"
        encoded = base64.b64encode(data).decode("ascii")
        selected.append(
            {
                "filename": file_doc.get("filename"),
                "stored_filename": file_doc.get("stored_filename"),
                "content_type": content_type,
                "size_bytes": len(data),
                "path": f"/workspace/docs/{file_doc['stored_filename']}",
                "data_url": f"data:{content_type};base64,{encoded}",
            }
        )
        total_bytes += len(data)

    skipped += max(0, len(image_docs) - len(selected) - skipped)
    return selected, skipped


async def _load_conversation_history(
    conversation_id: str,
    current_user_prompt: str,
) -> tuple[list[dict[str, str]], int]:
    cursor = messages_collection.find({"conversation_id": conversation_id}).sort("created_at", 1)
    messages = await cursor.to_list(length=200)
    if not messages:
        current_only = [{"role": "user", "content": current_user_prompt.strip()}]
        return [], trim_pairs_to_limit(
            [],
            max_tokens=MAX_CONTEXT_TOKENS,
            enc=get_encoding(),
            fixed_messages=current_only,
        )[1]

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

    enc = get_encoding()
    trimmed_history, token_count = trim_pairs_to_limit(
        conversation_history,
        max_tokens=MAX_CONTEXT_TOKENS,
        enc=enc,
        fixed_messages=[{"role": "user", "content": current_user_prompt.strip()}],
    )
    return trimmed_history, token_count


def _build_turn_payload(
    run: dict[str, Any],
    workspace: dict[str, Any],
    manifest: dict[str, Any],
    steps: list[dict[str, Any]],
    conversation_history: list[dict[str, str]],
    attached_images: list[dict[str, Any]],
    omitted_image_count: int,
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
        "attached_images": [
            {
                "filename": image["filename"],
                "stored_filename": image["stored_filename"],
                "content_type": image["content_type"],
                "size_bytes": image["size_bytes"],
                "path": image["path"],
            }
            for image in attached_images
        ],
        "omitted_image_count": omitted_image_count,
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


def _build_agent_user_message_content(
    prompt_text: str,
    attached_images: list[dict[str, Any]],
) -> str | list[dict[str, Any]]:
    if not attached_images:
        return prompt_text

    content: list[dict[str, Any]] = [{"type": "text", "text": prompt_text}]
    for image in attached_images:
        content.append(
            {
                "type": "text",
                "text": (
                    f"Attached workspace image: {image['path']} "
                    f"({image['content_type']}, {image['size_bytes']} bytes)"
                ),
            }
        )
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": image["data_url"]},
            }
        )
    return content


async def _request_agent_turn_non_streaming(
    *,
    model: str,
    payload: dict[str, Any],
    attached_images: list[dict[str, Any]],
    code_step_count: int,
    run_id: str,
    replay_final_answer: bool,
) -> AgentTurn:
    repair_message: str | None = None
    last_error = "model did not return a valid AgentTurn payload"

    for _ in range(MAX_REPAIR_ATTEMPTS + 1):
        response = await create_structured_completion(
            model=model,
            messages=_build_agent_turn_messages(
                payload,
                attached_images,
                repair_message=repair_message,
            ),
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
            validated_turn = validate_agent_turn(agent_turn, code_step_count)
            if replay_final_answer and validated_turn.action == "final_answer":
                await _replay_answer_deltas(run_id, validated_turn.final_answer or "")
            return validated_turn
        except (json.JSONDecodeError, ValidationError, HTTPException) as exc:
            last_error = str(exc)
            repair_message = (
                "Your previous reply was invalid. Return valid AgentTurn JSON only. "
                f"Validation error: {last_error}"
            )

    raise HTTPException(status_code=502, detail=last_error)


async def _request_agent_turn_streaming(
    *,
    run_id: str,
    model: str,
    payload: dict[str, Any],
    attached_images: list[dict[str, Any]],
    code_step_count: int,
) -> AgentTurn:
    emitted_answer = ""
    max_stream_chars = _max_streamed_final_answer_chars()

    try:
        async with open_structured_completion_stream(
            model=model,
            messages=_build_agent_turn_messages(payload, attached_images),
            response_format=AgentTurn,
            plugins=[{"id": "response-healing", "enabled": False}],
            extra_body={
                "reasoning": {"enabled": True, "exclude": True},
                "include_reasoning": False,
            },
        ) as stream:
            async for event in stream:
                if getattr(event, "type", None) != "content.delta":
                    continue

                partial_turn = _extract_partial_agent_turn(getattr(event, "parsed", None))
                if not partial_turn or partial_turn.get("action") != "final_answer":
                    continue

                partial_answer = partial_turn.get("final_answer")
                if not isinstance(partial_answer, str):
                    continue

                visible_answer = partial_answer[:max_stream_chars]
                if emitted_answer and not visible_answer.startswith(emitted_answer):
                    raise StructuredStreamError(
                        "streamed final_answer diverged from the previously emitted prefix",
                        emitted_answer=emitted_answer,
                    )

                next_chunk = visible_answer[len(emitted_answer) :]
                if next_chunk:
                    await append_run_event(
                        run_id,
                        "answer.delta",
                        {"chunk": next_chunk},
                    )
                    emitted_answer = visible_answer

            final_completion = await stream.get_final_completion()
    except StructuredStreamError:
        raise
    except Exception as exc:
        raise StructuredStreamError(str(exc), emitted_answer=emitted_answer) from exc

    if not getattr(final_completion, "choices", None):
        raise StructuredStreamError("model returned no choices", emitted_answer=emitted_answer)

    message = final_completion.choices[0].message
    parsed_message = getattr(message, "parsed", None)
    if isinstance(parsed_message, AgentTurn):
        agent_turn = parsed_message
    else:
        raw_text = _extract_message_text(message).strip()
        if not raw_text:
            raise StructuredStreamError("model returned empty content", emitted_answer=emitted_answer)
        try:
            agent_turn = AgentTurn.model_validate(json.loads(raw_text))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise StructuredStreamError(str(exc), emitted_answer=emitted_answer) from exc

    return validate_agent_turn(agent_turn, code_step_count)


async def _request_agent_turn(
    *,
    run_id: str,
    model: str,
    payload: dict[str, Any],
    attached_images: list[dict[str, Any]],
    code_step_count: int,
) -> AgentTurn:
    if not _stream_final_answer_enabled():
        return await _request_agent_turn_non_streaming(
            model=model,
            payload=payload,
            attached_images=attached_images,
            code_step_count=code_step_count,
            run_id=run_id,
            replay_final_answer=True,
        )

    try:
        agent_turn = await _request_agent_turn_streaming(
            run_id=run_id,
            model=model,
            payload=payload,
            attached_images=attached_images,
            code_step_count=code_step_count,
        )
        logger.info(
            "structured_stream_success run_id=%s model=%s action=%s",
            run_id,
            model,
            agent_turn.action,
        )
        return agent_turn
    except StructuredStreamError as exc:
        fallback_requires_reset = bool(exc.emitted_answer)
        logger.warning(
            "%s run_id=%s model=%s error=%s",
            "structured_stream_midanswer_reset_fallback"
            if fallback_requires_reset
            else "structured_stream_preanswer_fallback",
            run_id,
            model,
            exc,
        )
        if fallback_requires_reset:
            await append_run_event(
                run_id,
                "answer.reset",
                {"reason": "fallback_replay"},
            )

        try:
            return await _request_agent_turn_non_streaming(
                model=model,
                payload=payload,
                attached_images=attached_images,
                code_step_count=code_step_count,
                run_id=run_id,
                replay_final_answer=True,
            )
        except Exception:
            logger.exception(
                "structured_stream_terminal_failure run_id=%s model=%s",
                run_id,
                model,
            )
            raise


async def run_agent_loop(run_id: str, worker_task_id: str | None = None) -> dict[str, Any]:
    run = await get_run_or_404(run_id)
    if run["status"] in {"completed", "failed", "cancelled"}:
        raise HTTPException(status_code=400, detail="run is already in a terminal state")

    workspace = await get_workspace_or_404(run["workspace_id"])
    manifest = await write_workspace_manifest(workspace)
    file_docs = await list_workspace_files_docs(run["workspace_id"])
    model = run.get("model") or DEFAULT_MODEL
    run = await update_run(
        run_id,
        status="running",
        failure_reason=None,
        worker_task_id=worker_task_id,
    )
    await heartbeat_run(run_id)
    conversation_history, conversation_token_count = await _load_conversation_history(
        run["conversation_id"],
        run["user_prompt"],
    )
    await touch_conversation(run["conversation_id"], token_count=conversation_token_count)
    attached_images, omitted_image_count = await _prepare_attached_images(
        run["user_prompt"],
        file_docs,
    )
    await append_run_event(
        run_id,
        "turn.started",
        {
            "turn_id": run["turn_id"],
            "conversation_id": run["conversation_id"],
            "workspace_id": run["workspace_id"],
            "user_prompt": run["user_prompt"],
        },
    )
    await append_run_event(
        run_id,
        "run.started",
        {
            "status": "running",
            "conversation_id": run["conversation_id"],
            "workspace_id": run["workspace_id"],
            "user_prompt": run["user_prompt"],
        },
    )

    try:
        while True:
            await heartbeat_run(run_id)
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
                attached_images,
                omitted_image_count,
                force_final_answer=force_final_answer,
            )
            await append_run_event(
                run_id,
                "llm.call.started",
                {
                    "step_index": len(steps) + 1,
                    "model": model,
                },
                raw_debug_kind="llm.call.started",
                raw_debug_payload={"model": model, "payload": payload},
            )
            agent_turn = await _request_agent_turn(
                run_id=run_id,
                model=model,
                payload=payload,
                attached_images=attached_images,
                code_step_count=code_step_count,
            )
            await append_run_event(
                run_id,
                "llm.call.completed",
                {
                    "step_index": len(steps) + 1,
                    "action": agent_turn.action,
                },
                raw_debug_kind="llm.call.completed",
                raw_debug_payload={"agent_turn": agent_turn.model_dump()},
            )
            await append_run_event(
                run_id,
                "thought.updated",
                {
                    "thought": agent_turn.thought,
                    "action": agent_turn.action,
                    "step_index": len(steps) + 1,
                },
            )

            if agent_turn.action == "final_answer":
                draft_final_answer = (agent_turn.final_answer or "").strip()

                # Use the agent's own structured final_answer directly.
                # A second LLM call would lose grounding from execution results.
                final_answer = draft_final_answer
                if not final_answer:
                    raise HTTPException(status_code=502, detail="model returned empty final answer")

                trace_summary = await build_trace_summary(run["trace_id"])
                assistant_message = await store_message(
                    run["conversation_id"],
                    "assistant",
                    final_answer,
                    workspace_id=run["workspace_id"],
                    turn_id=run["turn_id"],
                    run_id=run_id,
                    trace_id=run["trace_id"],
                    message_kind="assistant",
                    trace_summary=trace_summary,
                )
                _, final_token_count = await _load_conversation_history(
                    run["conversation_id"],
                    "",
                )
                await touch_conversation(run["conversation_id"], token_count=final_token_count)
                updated_run = await update_run(
                    run_id,
                    status="completed",
                    final_answer=final_answer,
                    failure_reason=None,
                )
                await update_turn(
                    run["turn_id"],
                    assistant_message_id=str(assistant_message["_id"]),
                    status="completed",
                    token_counts={"conversation": final_token_count},
                )
                await append_run_event(
                    run_id,
                    "turn.completed",
                    {
                        "status": updated_run["status"],
                        "final_answer": final_answer,
                    },
                )
                final_steps = await list_run_steps(run_id)
                return {
                    "run": serialize_run(updated_run),
                    "steps": [serialize_run_step(step) for step in final_steps],
                }

            blocked_reason = detect_duplicate_or_stagnant_code(agent_turn.code, steps)
            if blocked_reason:
                blocked_step = await create_run_step(
                    run_id,
                    thought=agent_turn.thought,
                    step_type="blocked",
                    blocked_reason=blocked_reason,
                    code=agent_turn.code,
                    stdout="",
                    stderr=blocked_reason,
                    exit_code=BLOCKED_STEP_EXIT_CODE,
                    artifacts=[],
                    next_step_needed=True,
                    duration_ms=0,
                )
                await _emit_step_stream(
                    run_id,
                    step_index=blocked_step["step_index"],
                    thought=agent_turn.thought,
                    code=agent_turn.code,
                    stdout="",
                    stderr=blocked_reason,
                    exit_code=BLOCKED_STEP_EXIT_CODE,
                    artifacts=[],
                    duration_ms=0,
                    created_at=serialize_run_step(blocked_step)["created_at"],
                )
                latest_steps = await list_run_steps(run_id)
                if count_trailing_blocked_steps(latest_steps) >= MAX_CONSECUTIVE_BLOCKED_STEPS:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "agent repeated duplicate or stagnant code steps after being blocked"
                        ),
                    )
                if len(steps) + 1 >= MAX_AGENT_TURNS:
                    raise HTTPException(status_code=400, detail="max agent turns reached")
                continue

            # ---- Pre-calculate step index and emit started / code deltas BEFORE execution ----
            step_index = len(steps) + 1
            await append_run_event(
                run_id,
                "step.started",
                {
                    "step_index": step_index,
                    "thought": agent_turn.thought,
                    "status": "running",
                },
            )
            # Stream code deltas with a small delay between chunks for a typewriter effect
            for chunk in _chunk_text(agent_turn.code, chunk_size=320):
                await append_run_event(
                    run_id,
                    "step.code.delta",
                    {"step_index": step_index, "chunk": chunk},
                )
                await asyncio.sleep(0.008)

            # Live stdout / stderr callbacks — emit delta events as the sandbox produces output
            stdout_acc: list[str] = []
            stderr_acc: list[str] = []

            async def _on_stdout(chunk: str) -> None:
                stdout_acc.append(chunk)
                await append_run_event(
                    run_id,
                    "step.stdout.delta",
                    {"step_index": step_index, "chunk": chunk},
                )

            async def _on_stderr(chunk: str) -> None:
                stderr_acc.append(chunk)
                await append_run_event(
                    run_id,
                    "step.stderr.delta",
                    {"step_index": step_index, "chunk": chunk},
                )

            try:
                execution = await execute_run_code(
                    run_id,
                    agent_turn.code,
                    on_stdout_chunk=_on_stdout,
                    on_stderr_chunk=_on_stderr,
                )
            except HTTPException as exc:
                detail = str(exc.detail)
                if detail in {"max steps per run reached", "max total run time reached"}:
                    raise

                execution = {
                    "code": agent_turn.code,
                    "stdout": "".join(stdout_acc),
                    "stderr": ("".join(stderr_acc) + ("\n" if stderr_acc else "") + detail).strip(),
                    "exit_code": 1,
                    "artifacts": [],
                    "duration_ms": 0,
                }
            except Exception as exc:
                logger.exception(
                    "Unexpected code execution failure run_id=%s step_index=%s",
                    run_id,
                    len(steps) + 1,
                )
                execution = {
                    "code": agent_turn.code,
                    "stdout": "".join(stdout_acc),
                    "stderr": "\n".join(
                        [
                            "Unexpected execution failure.",
                            f"error: {type(exc).__name__}: {exc}",
                            traceback.format_exc(limit=8).strip(),
                        ]
                    ),
                    "exit_code": 1,
                    "artifacts": [],
                    "duration_ms": 0,
                }
            created_step = await create_run_step(
                run_id,
                thought=agent_turn.thought,
                step_type="code",
                code=execution["code"],
                stdout=execution["stdout"],
                stderr=execution["stderr"],
                exit_code=execution["exit_code"],
                artifacts=execution["artifacts"],
                next_step_needed=agent_turn.next_step_needed,
                duration_ms=execution["duration_ms"],
            )
            serialized_step = serialize_run_step(created_step)
            # Emit step.completed — code and output deltas were already streamed live above
            await append_run_event(
                run_id,
                "step.completed",
                {
                    "step_index": created_step["step_index"],
                    "thought": agent_turn.thought,
                    "code": execution["code"],
                    "stdout": execution["stdout"],
                    "stderr": execution["stderr"],
                    "exit_code": execution["exit_code"],
                    "artifacts": _summarize_artifacts(execution["artifacts"]),
                    "duration_ms": execution["duration_ms"],
                    "created_at": serialized_step["created_at"],
                    "status": "completed",
                },
            )
            for artifact in execution["artifacts"]:
                await append_run_event(
                    run_id,
                    "artifact.created",
                    {
                        "step_index": created_step["step_index"],
                        "artifact": {
                            "name": artifact.get("name"),
                            "path": artifact.get("agent_path") or artifact.get("runtime_path"),
                            "content_type": artifact.get("content_type"),
                            "size_bytes": artifact.get("size_bytes"),
                        },
                    },
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
        await append_run_event(
            run_id,
            "turn.failed",
            {"failure_reason": failure_reason},
        )
        await update_turn(run["turn_id"], status="failed", failure_reason=failure_reason)
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
        await append_run_event(
            run_id,
            "turn.failed",
            {"failure_reason": failure_reason},
        )
        await update_turn(run["turn_id"], status="failed", failure_reason=failure_reason)
        final_steps = await list_run_steps(run_id)
        return {
            "run": serialize_run(updated_run),
            "steps": [serialize_run_step(step) for step in final_steps],
        }
