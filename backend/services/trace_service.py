import json
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from pymongo import ReturnDocument

from backend.core.redis_client import redis_async_client
from backend.db.database import (
    agent_debug_payloads_collection,
    agent_trace_events_collection,
    agent_traces_collection,
    messages_collection,
    run_steps_collection,
    runs_collection,
)
from backend.services.workspace_service import parse_object_id


TRACE_DEBUG_TOKEN = os.environ.get("TRACE_DEBUG_TOKEN", "").strip()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def run_event_channel(run_id: str) -> str:
    return f"run:{run_id}"


def serialize_trace(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "turn_id": doc["turn_id"],
        "conversation_id": doc["conversation_id"],
        "workspace_id": doc["workspace_id"],
        "run_id": doc["run_id"],
        "status": doc["status"],
        "latest_seq": doc.get("latest_seq", 0),
        "raw_debug_enabled": bool(doc.get("raw_debug_enabled", False)),
        "summary": doc.get("summary", {}),
        "created_at": _isoformat(doc["created_at"]),
        "updated_at": _isoformat(doc["updated_at"]),
    }


def serialize_trace_event(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "trace_id": doc["trace_id"],
        "turn_id": doc["turn_id"],
        "run_id": doc["run_id"],
        "seq": doc["seq"],
        "event_type": doc["event_type"],
        "scope": doc.get("scope", "run"),
        "payload": doc.get("payload", {}),
        "ui_payload": doc.get("ui_payload", doc.get("payload", {})),
        "raw_debug_ref": doc.get("raw_debug_ref"),
        "created_at": _isoformat(doc["created_at"]),
    }


def serialize_debug_payload(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "trace_id": doc["trace_id"],
        "turn_id": doc["turn_id"],
        "run_id": doc["run_id"],
        "kind": doc["kind"],
        "payload": doc.get("payload", {}),
        "created_at": _isoformat(doc["created_at"]),
    }


async def create_trace(
    *,
    turn_id: str,
    conversation_id: str,
    workspace_id: str,
    run_id: str,
    raw_debug_enabled: bool = True,
) -> dict[str, Any]:
    now = utc_now()
    trace_doc = {
        "turn_id": turn_id,
        "conversation_id": conversation_id,
        "workspace_id": workspace_id,
        "run_id": run_id,
        "status": "queued",
        "latest_seq": 0,
        "raw_debug_enabled": raw_debug_enabled,
        "summary": {
            "step_count": 0,
            "artifact_count": 0,
            "latest_event_type": "run.queued",
            "last_thought": None,
        },
        "created_at": now,
        "updated_at": now,
    }
    result = await agent_traces_collection.insert_one(trace_doc)
    trace_doc["_id"] = result.inserted_id
    return trace_doc


async def get_trace_or_404(trace_id: str) -> dict[str, Any]:
    trace = await agent_traces_collection.find_one({"_id": parse_object_id(trace_id, "trace")})
    if not trace:
        raise HTTPException(status_code=404, detail="trace not found")
    return trace


async def get_trace_for_run(run_id: str) -> dict[str, Any]:
    trace = await agent_traces_collection.find_one({"run_id": run_id})
    if not trace:
        raise HTTPException(status_code=404, detail="trace not found for run")
    return trace


async def list_trace_events(
    trace_id: str,
    *,
    after_seq: int = 0,
    limit: int = 1000,
) -> list[dict[str, Any]]:
    cursor = agent_trace_events_collection.find(
        {"trace_id": trace_id, "seq": {"$gt": after_seq}}
    ).sort("seq", 1)
    return await cursor.to_list(length=limit)


async def list_trace_debug_payloads(trace_id: str) -> list[dict[str, Any]]:
    cursor = agent_debug_payloads_collection.find({"trace_id": trace_id}).sort("created_at", 1)
    return await cursor.to_list(length=1000)


async def _store_debug_payload(
    *,
    trace_id: str,
    turn_id: str,
    run_id: str,
    kind: str,
    payload: dict[str, Any],
) -> str:
    debug_doc = {
        "trace_id": trace_id,
        "turn_id": turn_id,
        "run_id": run_id,
        "kind": kind,
        "payload": payload,
        "created_at": utc_now(),
    }
    result = await agent_debug_payloads_collection.insert_one(debug_doc)
    return str(result.inserted_id)


async def append_trace_event(
    *,
    trace_id: str,
    turn_id: str,
    run_id: str,
    event_type: str,
    scope: str = "run",
    payload: dict[str, Any] | None = None,
    ui_payload: dict[str, Any] | None = None,
    raw_debug_kind: str | None = None,
    raw_debug_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    trace = await get_trace_or_404(trace_id)
    updated_trace = await agent_traces_collection.find_one_and_update(
        {"_id": trace["_id"]},
        {"$inc": {"latest_seq": 1}, "$set": {"updated_at": utc_now()}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated_trace:
        raise HTTPException(status_code=404, detail="trace not found")

    raw_debug_ref = None
    if raw_debug_kind and raw_debug_payload and updated_trace.get("raw_debug_enabled", False):
        raw_debug_ref = await _store_debug_payload(
            trace_id=trace_id,
            turn_id=turn_id,
            run_id=run_id,
            kind=raw_debug_kind,
            payload=raw_debug_payload,
        )

    event_doc = {
        "trace_id": trace_id,
        "turn_id": turn_id,
        "run_id": run_id,
        "seq": int(updated_trace["latest_seq"]),
        "event_type": event_type,
        "scope": scope,
        "payload": payload or {},
        "ui_payload": ui_payload or payload or {},
        "raw_debug_ref": raw_debug_ref,
        "created_at": utc_now(),
    }
    result = await agent_trace_events_collection.insert_one(event_doc)
    event_doc["_id"] = result.inserted_id

    summary_update: dict[str, Any] = {
        "summary.latest_event_type": event_type,
        "updated_at": utc_now(),
    }
    if event_type == "thought.updated":
        summary_update["summary.last_thought"] = (ui_payload or payload or {}).get("thought")
    if event_type == "step.completed":
        step_count = await run_steps_collection.count_documents({"run_id": run_id})
        summary_update["summary.step_count"] = step_count
        steps = await run_steps_collection.find({"run_id": run_id}).to_list(length=500)
        artifact_count = sum(len(step.get("artifacts", [])) for step in steps)
        summary_update["summary.artifact_count"] = artifact_count
    if event_type == "turn.completed":
        summary_update["status"] = "completed"
        summary_update["summary.completed_at"] = utc_now()
    if event_type == "turn.failed":
        summary_update["status"] = "failed"
    await agent_traces_collection.update_one({"_id": updated_trace["_id"]}, {"$set": summary_update})

    await redis_async_client.publish(
        run_event_channel(run_id),
        json.dumps(serialize_trace_event(event_doc)),
    )
    return event_doc


async def build_trace_summary(trace_id: str) -> dict[str, Any]:
    trace = await get_trace_or_404(trace_id)
    run = await runs_collection.find_one({"_id": parse_object_id(trace["run_id"], "run")})
    latest_event = await agent_trace_events_collection.find_one({"trace_id": trace_id}, sort=[("seq", -1)])
    summary = dict(trace.get("summary") or {})
    summary["trace_id"] = trace_id
    summary["status"] = trace.get("status")
    summary["latest_seq"] = trace.get("latest_seq", 0)
    summary["last_event_type"] = latest_event["event_type"] if latest_event else None
    summary["run_status"] = run.get("status") if run else None
    return summary


async def fetch_turn_hydration(turn_docs: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    message_ids = {doc[key] for doc in turn_docs for key in ("user_message_id", "assistant_message_id") if doc.get(key)}
    run_ids = {doc["run_id"] for doc in turn_docs if doc.get("run_id")}
    trace_ids = {doc["trace_id"] for doc in turn_docs if doc.get("trace_id")}

    messages: dict[str, dict[str, Any]] = {}
    runs: dict[str, dict[str, Any]] = {}
    traces: dict[str, dict[str, Any]] = {}

    if message_ids:
        cursor = messages_collection.find({"_id": {"$in": [parse_object_id(message_id, "message") for message_id in message_ids]}})
        async for doc in cursor:
            messages[str(doc["_id"])] = doc

    if run_ids:
        cursor = runs_collection.find({"_id": {"$in": [parse_object_id(run_id, "run") for run_id in run_ids]}})
        async for doc in cursor:
            runs[str(doc["_id"])] = doc

    if trace_ids:
        cursor = agent_traces_collection.find({"_id": {"$in": [parse_object_id(trace_id, "trace") for trace_id in trace_ids]}})
        async for doc in cursor:
            traces[str(doc["_id"])] = doc

    return {"messages": messages, "runs": runs, "traces": traces}
