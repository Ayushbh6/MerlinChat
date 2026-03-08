from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from backend.db.database import conversation_turns_collection
from backend.services.workspace_service import parse_object_id


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def serialize_turn(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(doc["_id"]),
        "conversation_id": doc["conversation_id"],
        "workspace_id": doc["workspace_id"],
        "user_message_id": doc.get("user_message_id"),
        "assistant_message_id": doc.get("assistant_message_id"),
        "run_id": doc.get("run_id"),
        "trace_id": doc.get("trace_id"),
        "status": doc["status"],
        "model": doc.get("model"),
        "failure_reason": doc.get("failure_reason"),
        "token_counts": doc.get("token_counts") or {},
        "started_at": _isoformat(doc["started_at"]),
        "completed_at": _isoformat(doc.get("completed_at")),
        "created_at": _isoformat(doc.get("created_at", doc["started_at"])),
        "updated_at": _isoformat(doc.get("updated_at", doc["started_at"])),
    }


async def create_turn(
    conversation_id: str,
    workspace_id: str,
    *,
    model: str | None = None,
    status: str = "queued",
) -> dict[str, Any]:
    now = utc_now()
    turn_doc = {
        "conversation_id": conversation_id,
        "workspace_id": workspace_id,
        "user_message_id": None,
        "assistant_message_id": None,
        "run_id": None,
        "trace_id": None,
        "status": status,
        "model": model,
        "failure_reason": None,
        "token_counts": {},
        "started_at": now,
        "completed_at": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await conversation_turns_collection.insert_one(turn_doc)
    turn_doc["_id"] = result.inserted_id
    return turn_doc


async def get_turn_or_404(turn_id: str) -> dict[str, Any]:
    turn = await conversation_turns_collection.find_one({"_id": parse_object_id(turn_id, "turn")})
    if not turn:
        raise HTTPException(status_code=404, detail="turn not found")
    return turn


async def list_conversation_turns(conversation_id: str) -> list[dict[str, Any]]:
    cursor = conversation_turns_collection.find({"conversation_id": conversation_id}).sort("started_at", 1)
    return await cursor.to_list(length=1000)


async def update_turn(
    turn_id: str,
    **fields: Any,
) -> dict[str, Any]:
    turn = await get_turn_or_404(turn_id)
    update_fields = {"updated_at": utc_now()}
    update_fields.update({key: value for key, value in fields.items() if value is not None})
    if update_fields.get("status") in {"completed", "failed"} and "completed_at" not in update_fields:
        update_fields["completed_at"] = utc_now()
    await conversation_turns_collection.update_one({"_id": turn["_id"]}, {"$set": update_fields})
    turn.update(update_fields)
    return turn
