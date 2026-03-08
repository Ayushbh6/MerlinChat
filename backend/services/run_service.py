from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from backend.db.database import (
    conversations_collection,
    messages_collection,
    run_steps_collection,
    runs_collection,
)
from backend.services.workspace_service import get_workspace_or_404, parse_object_id

RUN_STATUS_VALUES = {"queued", "running", "completed", "failed", "cancelled"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _normalize_title(title: str, fallback: str = "New Chat") -> str:
    cleaned = title.strip()
    return cleaned or fallback


def _conversation_title_from_prompt(prompt: str) -> str:
    prompt = prompt.strip()
    if not prompt:
        return "New Chat"
    return prompt[:30] + ("..." if len(prompt) > 30 else "")


def serialize_conversation(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "_id": str(doc["_id"]),
        "title": doc["title"],
        "workspace_id": doc.get("workspace_id"),
        "created_at": _isoformat(doc["created_at"]),
        "updated_at": _isoformat(doc.get("updated_at", doc["created_at"])),
        "token_count": doc.get("token_count"),
    }


def serialize_message(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "_id": str(doc["_id"]),
        "conversation_id": doc["conversation_id"],
        "workspace_id": doc.get("workspace_id"),
        "turn_id": doc.get("turn_id"),
        "run_id": doc.get("run_id"),
        "trace_id": doc.get("trace_id"),
        "role": doc["role"],
        "message_kind": doc.get("message_kind", doc["role"]),
        "content": doc["content"],
        "thinking": doc.get("thinking"),
        "trace_summary": doc.get("trace_summary"),
        "created_at": _isoformat(doc["created_at"]),
    }


def serialize_run(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "workspace_id": doc["workspace_id"],
        "conversation_id": doc["conversation_id"],
        "turn_id": doc.get("turn_id"),
        "trace_id": doc.get("trace_id"),
        "user_prompt": doc["user_prompt"],
        "model": doc.get("model"),
        "status": doc["status"],
        "step_count": doc["step_count"],
        "worker_task_id": doc.get("worker_task_id"),
        "attempt_count": doc.get("attempt_count", 0),
        "queued_at": _isoformat(doc.get("queued_at")),
        "started_at": _isoformat(doc.get("started_at")),
        "completed_at": _isoformat(doc.get("completed_at")),
        "heartbeat_at": _isoformat(doc.get("heartbeat_at")),
        "lease_expires_at": _isoformat(doc.get("lease_expires_at")),
        "final_answer": doc.get("final_answer"),
        "failure_reason": doc.get("failure_reason"),
        "created_at": _isoformat(doc["created_at"]),
        "updated_at": _isoformat(doc["updated_at"]),
    }


def serialize_run_step(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "run_id": doc["run_id"],
        "turn_id": doc.get("turn_id"),
        "trace_id": doc.get("trace_id"),
        "step_index": doc["step_index"],
        "thought": doc.get("thought"),
        "step_type": doc.get("step_type", "code"),
        "blocked_reason": doc.get("blocked_reason"),
        "model_decision_id": doc.get("model_decision_id"),
        "code": doc["code"],
        "stdout": doc["stdout"],
        "stderr": doc["stderr"],
        "exit_code": doc["exit_code"],
        "artifacts": doc["artifacts"],
        "next_step_needed": doc["next_step_needed"],
        "duration_ms": doc["duration_ms"],
        "created_at": _isoformat(doc["created_at"]),
    }


async def get_conversation_or_404(conversation_id: str) -> dict[str, Any]:
    oid = parse_object_id(conversation_id, "conversation")
    conversation = await conversations_collection.find_one({"_id": oid})
    if not conversation:
        raise HTTPException(status_code=404, detail="conversation not found")
    return conversation


async def create_conversation(
    title: str | None = None, workspace_id: str | None = None
) -> dict[str, Any]:
    if workspace_id:
        await get_workspace_or_404(workspace_id)

    now = utc_now()
    conversation_doc = {
        "title": _normalize_title(title or "New Chat"),
        "workspace_id": workspace_id,
        "created_at": now,
        "updated_at": now,
    }
    result = await conversations_collection.insert_one(conversation_doc)
    conversation_doc["_id"] = result.inserted_id
    return conversation_doc


async def create_or_get_workspace_conversation(
    workspace_id: str,
    conversation_id: str | None,
    user_message: str,
) -> dict[str, Any]:
    if conversation_id:
        conversation = await get_conversation_or_404(conversation_id)
        if conversation.get("workspace_id") != workspace_id:
            raise HTTPException(
                status_code=400,
                detail="conversation does not belong to the requested workspace",
            )
        return conversation

    return await create_conversation(
        title=_conversation_title_from_prompt(user_message),
        workspace_id=workspace_id,
    )


async def store_message(
    conversation_id: str,
    role: str,
    content: str,
    thinking: str | None = None,
    token_count: int | None = None,
    workspace_id: str | None = None,
    turn_id: str | None = None,
    run_id: str | None = None,
    trace_id: str | None = None,
    message_kind: str | None = None,
    trace_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    message_doc = {
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "created_at": utc_now(),
    }
    if thinking is not None:
        message_doc["thinking"] = thinking
    if token_count is not None:
        message_doc["token_count"] = token_count
    if workspace_id is not None:
        message_doc["workspace_id"] = workspace_id
    if turn_id is not None:
        message_doc["turn_id"] = turn_id
    if run_id is not None:
        message_doc["run_id"] = run_id
    if trace_id is not None:
        message_doc["trace_id"] = trace_id
    if message_kind is not None:
        message_doc["message_kind"] = message_kind
    if trace_summary is not None:
        message_doc["trace_summary"] = trace_summary

    result = await messages_collection.insert_one(message_doc)
    message_doc["_id"] = result.inserted_id
    return message_doc


async def touch_conversation(
    conversation_id: str,
    *,
    title: str | None = None,
    token_count: int | None = None,
) -> None:
    update_fields: dict[str, Any] = {"updated_at": utc_now()}
    if title is not None:
        update_fields["title"] = _normalize_title(title)
    if token_count is not None:
        update_fields["token_count"] = token_count
    await conversations_collection.update_one(
        {"_id": parse_object_id(conversation_id, "conversation")},
        {"$set": update_fields},
    )


async def list_workspace_conversations(workspace_id: str) -> list[dict[str, Any]]:
    cursor = conversations_collection.find({"workspace_id": workspace_id}).sort(
        "updated_at", -1
    )
    return await cursor.to_list(length=200)


async def create_run(
    workspace_id: str,
    conversation_id: str,
    user_prompt: str,
    *,
    turn_id: str | None = None,
    trace_id: str | None = None,
    model: str | None = None,
    status: str = "queued",
) -> dict[str, Any]:
    if status not in RUN_STATUS_VALUES:
        raise HTTPException(status_code=400, detail="invalid run status")

    now = utc_now()
    run_doc = {
        "workspace_id": workspace_id,
        "conversation_id": conversation_id,
        "turn_id": turn_id,
        "trace_id": trace_id,
        "user_prompt": user_prompt,
        "model": model,
        "status": status,
        "step_count": 0,
        "worker_task_id": None,
        "attempt_count": 0,
        "queued_at": now if status == "queued" else None,
        "started_at": None,
        "completed_at": None,
        "heartbeat_at": None,
        "lease_expires_at": None,
        "final_answer": None,
        "failure_reason": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await runs_collection.insert_one(run_doc)
    run_doc["_id"] = result.inserted_id
    return run_doc


async def get_run_or_404(run_id: str) -> dict[str, Any]:
    oid = parse_object_id(run_id, "run")
    run = await runs_collection.find_one({"_id": oid})
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return run


async def list_workspace_runs(workspace_id: str) -> list[dict[str, Any]]:
    cursor = runs_collection.find({"workspace_id": workspace_id}).sort("created_at", -1)
    return await cursor.to_list(length=200)


async def list_run_steps(run_id: str) -> list[dict[str, Any]]:
    cursor = run_steps_collection.find({"run_id": run_id}).sort("step_index", 1)
    return await cursor.to_list(length=200)


async def create_run_step(
    run_id: str,
    *,
    thought: str | None = None,
    step_type: str = "code",
    blocked_reason: str | None = None,
    model_decision_id: str | None = None,
    code: str,
    stdout: str,
    stderr: str,
    exit_code: int,
    artifacts: list[dict[str, Any]],
    next_step_needed: bool,
    duration_ms: int,
) -> dict[str, Any]:
    run = await get_run_or_404(run_id)
    if run["status"] in {"completed", "failed", "cancelled"}:
        raise HTTPException(
            status_code=400, detail="cannot append steps to a terminal run"
        )

    previous_step = await run_steps_collection.find_one(
        {"run_id": run_id}, sort=[("step_index", -1)]
    )
    step_index = 1 if not previous_step else previous_step["step_index"] + 1

    step_doc = {
        "run_id": run_id,
        "turn_id": run.get("turn_id"),
        "trace_id": run.get("trace_id"),
        "step_index": step_index,
        "thought": thought,
        "step_type": step_type,
        "blocked_reason": blocked_reason,
        "model_decision_id": model_decision_id,
        "code": code,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "artifacts": artifacts,
        "next_step_needed": next_step_needed,
        "duration_ms": duration_ms,
        "created_at": utc_now(),
    }
    result = await run_steps_collection.insert_one(step_doc)
    step_doc["_id"] = result.inserted_id

    await runs_collection.update_one(
        {"_id": run["_id"]},
        {
            "$set": {"updated_at": utc_now(), "status": "running"},
            "$inc": {"step_count": 1},
        },
    )
    return step_doc


async def update_run(
    run_id: str,
    *,
    status: str | None = None,
    trace_id: str | None = None,
    final_answer: str | None = None,
    failure_reason: str | None = None,
    worker_task_id: str | None = None,
    attempt_count: int | None = None,
    queued_at: datetime | None = None,
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
    heartbeat_at: datetime | None = None,
    lease_expires_at: datetime | None = None,
) -> dict[str, Any]:
    run = await get_run_or_404(run_id)

    update_fields: dict[str, Any] = {"updated_at": utc_now()}
    if status is not None:
        if status not in RUN_STATUS_VALUES:
            raise HTTPException(status_code=400, detail="invalid run status")
        update_fields["status"] = status
    if trace_id is not None:
        update_fields["trace_id"] = trace_id
    if final_answer is not None:
        update_fields["final_answer"] = final_answer
        if status is None:
            update_fields["status"] = "completed"
    if failure_reason is not None:
        update_fields["failure_reason"] = failure_reason
    if worker_task_id is not None:
        update_fields["worker_task_id"] = worker_task_id
    if attempt_count is not None:
        update_fields["attempt_count"] = attempt_count
    if queued_at is not None:
        update_fields["queued_at"] = queued_at
    if started_at is not None:
        update_fields["started_at"] = started_at
    if completed_at is not None:
        update_fields["completed_at"] = completed_at
    if heartbeat_at is not None:
        update_fields["heartbeat_at"] = heartbeat_at
    if lease_expires_at is not None:
        update_fields["lease_expires_at"] = lease_expires_at

    effective_status = update_fields.get("status")
    if effective_status == "running" and "started_at" not in update_fields:
        update_fields["started_at"] = utc_now()
    if effective_status in {"completed", "failed", "cancelled"} and "completed_at" not in update_fields:
        update_fields["completed_at"] = utc_now()

    await runs_collection.update_one({"_id": run["_id"]}, {"$set": update_fields})
    run.update(update_fields)
    return run


async def heartbeat_run(run_id: str, *, lease_seconds: int = 90) -> dict[str, Any]:
    now = utc_now()
    return await update_run(
        run_id,
        heartbeat_at=now,
        lease_expires_at=now + timedelta(seconds=lease_seconds),
    )
