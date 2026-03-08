from typing import Any

from backend.services.run_service import get_run_or_404
from backend.services.trace_service import (
    append_trace_event,
    get_trace_for_run,
    list_trace_events,
    serialize_trace_event,
)


TERMINAL_RUN_EVENT_TYPES = {"turn.completed", "turn.failed"}


async def append_run_event(
    run_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    scope: str = "run",
    ui_payload: dict[str, Any] | None = None,
    raw_debug_kind: str | None = None,
    raw_debug_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    run = await get_run_or_404(run_id)
    trace = await get_trace_for_run(run_id)
    return await append_trace_event(
        trace_id=str(trace["_id"]),
        turn_id=run["turn_id"],
        run_id=run_id,
        event_type=event_type,
        scope=scope,
        payload=payload,
        ui_payload=ui_payload,
        raw_debug_kind=raw_debug_kind,
        raw_debug_payload=raw_debug_payload,
    )


async def list_run_events(run_id: str, *, after_seq: int = 0, limit: int = 1000) -> list[dict[str, Any]]:
    trace = await get_trace_for_run(run_id)
    return await list_trace_events(str(trace["_id"]), after_seq=after_seq, limit=limit)


async def delete_run_events(run_ids: list[str]) -> None:
    # Trace events are now stored in agent_trace_events and removed through conversation/trace cleanup.
    return None


def is_terminal_run_event(event_doc: dict[str, Any]) -> bool:
    return event_doc.get("event_type") in TERMINAL_RUN_EVENT_TYPES


def serialize_run_event(doc: dict[str, Any]) -> dict[str, Any]:
    serialized = serialize_trace_event(doc)
    return {
        "id": serialized["id"],
        "run_id": serialized["run_id"],
        "trace_id": serialized["trace_id"],
        "turn_id": serialized["turn_id"],
        "seq": serialized["seq"],
        "type": serialized["event_type"],
        "scope": serialized["scope"],
        "payload": serialized["ui_payload"],
        "ui_payload": serialized["ui_payload"],
        "created_at": serialized["created_at"],
    }
