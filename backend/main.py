import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from bson import ObjectId

from backend.core.celery_app import celery_app
from backend.core.constants import DEFAULT_MODEL, MAX_CONTEXT_TOKENS
from backend.core.llm_client import client
from backend.core.redis_client import redis_async_client
from backend.db.database import (
    agent_debug_payloads_collection,
    agent_trace_events_collection,
    agent_traces_collection,
    conversations_collection,
    conversation_turns_collection,
    messages_collection,
    run_steps_collection,
    runs_collection,
    workspaces_collection,
)
from backend.schemas.models import (
    ConversationCreateRequest,
    RunCreateRequest,
    RunExecuteRequest,
    RunStepCreateRequest,
    RunUpdateRequest,
    WorkspaceCreateRequest,
    WorkspaceTextFileCreateRequest,
)
from backend.runtime.sandbox_runner import execute_run_code
from backend.services.agent_service import run_agent_loop
from backend.services.queue_service import enqueue_workspace_run, get_task_result
from backend.services.run_service import (
    create_conversation,
    create_or_get_workspace_conversation,
    create_run,
    create_run_step,
    get_conversation_or_404,
    get_run_or_404,
    list_run_steps,
    list_workspace_conversations,
    list_workspace_runs,
    serialize_conversation,
    serialize_message,
    serialize_run,
    serialize_run_step,
    store_message,
    touch_conversation,
    update_run,
)
from backend.services.run_event_service import (
    append_run_event,
    list_run_events,
    serialize_run_event,
)
from backend.services.trace_service import (
    build_trace_summary,
    create_trace,
    fetch_turn_hydration,
    get_trace_for_run,
    get_trace_or_404,
    list_trace_debug_payloads,
    list_trace_events,
    serialize_debug_payload,
    serialize_trace,
    serialize_trace_event,
)
from backend.services.turn_service import create_turn, list_conversation_turns, serialize_turn, update_turn
from backend.services.workspace_service import (
    create_workspace_text_file,
    create_workspace,
    delete_workspace_file,
    get_workspace_or_404,
    list_workspace_files_docs,
    serialize_workspace,
    serialize_workspace_file,
    store_workspace_file,
    write_workspace_manifest,
)
from backend.utils.token_utils import count_tokens, get_encoding, trim_to_limit

app = FastAPI(title="AI Chatbot Backend")
logger = logging.getLogger(__name__)
TRACE_DEBUG_TOKEN = os.environ.get("TRACE_DEBUG_TOKEN", "").strip()

# Allow frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    model: str = DEFAULT_MODEL
    thinking: bool = True


@app.on_event("startup")
async def ensure_indexes():
    await conversation_turns_collection.create_index(
        [("conversation_id", 1), ("started_at", 1)]
    )
    await messages_collection.create_index([("conversation_id", 1), ("created_at", 1)])
    await runs_collection.create_index([("conversation_id", 1), ("created_at", -1)])
    await runs_collection.create_index([("turn_id", 1)], unique=False)
    await agent_traces_collection.create_index([("turn_id", 1)], unique=True)
    await agent_traces_collection.create_index([("run_id", 1)], unique=True)
    await agent_trace_events_collection.create_index(
        [("trace_id", 1), ("seq", 1)], unique=True
    )
    await agent_debug_payloads_collection.create_index(
        [("trace_id", 1), ("created_at", 1)]
    )


@app.get("/api/config")
async def get_config():
    return {"max_context_tokens": MAX_CONTEXT_TOKENS, "default_model": DEFAULT_MODEL}


@app.get("/api/workspaces")
async def get_workspaces():
    cursor = workspaces_collection.find().sort("updated_at", -1)
    workspaces = await cursor.to_list(length=100)
    return [serialize_workspace(workspace) for workspace in workspaces]


@app.post("/api/workspaces")
async def create_workspace_endpoint(req: WorkspaceCreateRequest):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    workspace = await create_workspace(req.model_dump())
    return serialize_workspace(workspace)


@app.get("/api/workspaces/{workspace_id}")
async def get_workspace(workspace_id: str):
    workspace = await get_workspace_or_404(workspace_id)
    return serialize_workspace(workspace)


@app.get("/api/workspaces/{workspace_id}/conversations")
async def get_workspace_conversations(workspace_id: str):
    await get_workspace_or_404(workspace_id)
    conversations = await list_workspace_conversations(workspace_id)
    return [serialize_conversation(conversation) for conversation in conversations]


@app.get("/api/workspaces/{workspace_id}/files")
async def get_workspace_files(workspace_id: str):
    await get_workspace_or_404(workspace_id)
    file_docs = await list_workspace_files_docs(workspace_id)
    return {"files": [serialize_workspace_file(file_doc) for file_doc in file_docs]}


@app.post("/api/workspaces/{workspace_id}/files")
async def upload_workspace_files(workspace_id: str, files: list[UploadFile] = File(...)):
    workspace = await get_workspace_or_404(workspace_id)
    if not files:
        raise HTTPException(status_code=400, detail="at least one file is required")

    stored_files = []
    for upload in files:
        stored_files.append(await store_workspace_file(workspace, upload))

    await write_workspace_manifest(workspace)
    return {"files": [serialize_workspace_file(file_doc) for file_doc in stored_files]}


@app.post("/api/workspaces/{workspace_id}/text-files")
async def create_workspace_text_file_endpoint(
    workspace_id: str,
    req: WorkspaceTextFileCreateRequest,
):
    workspace = await get_workspace_or_404(workspace_id)
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="title is required")

    file_doc = await create_workspace_text_file(
        workspace,
        title=req.title,
        body=req.body,
    )
    await write_workspace_manifest(workspace)
    return serialize_workspace_file(file_doc)


@app.delete("/api/workspaces/{workspace_id}/files/{file_id}")
async def delete_workspace_file_endpoint(workspace_id: str, file_id: str):
    workspace = await get_workspace_or_404(workspace_id)
    await delete_workspace_file(workspace, file_id)
    return {"status": "deleted"}


@app.get("/api/workspaces/{workspace_id}/manifest")
async def get_workspace_manifest(workspace_id: str):
    workspace = await get_workspace_or_404(workspace_id)
    return await write_workspace_manifest(workspace)


@app.get("/api/workspaces/{workspace_id}/runs")
async def get_workspace_runs(workspace_id: str):
    await get_workspace_or_404(workspace_id)
    runs = await list_workspace_runs(workspace_id)
    return {"runs": [serialize_run(run) for run in runs]}


@app.post("/api/workspaces/{workspace_id}/runs")
async def create_workspace_run(workspace_id: str, req: RunCreateRequest):
    if not req.user_message.strip():
        raise HTTPException(status_code=400, detail="user_message is required")

    await get_workspace_or_404(workspace_id)
    conversation = await create_or_get_workspace_conversation(
        workspace_id, req.conversation_id, req.user_message
    )
    conversation_id = str(conversation["_id"])
    turn = await create_turn(conversation_id, workspace_id, model=req.model, status="queued")
    user_message = await store_message(
        conversation_id,
        "user",
        req.user_message,
        workspace_id=workspace_id,
        turn_id=str(turn["_id"]),
        message_kind="user",
    )
    await update_turn(str(turn["_id"]), user_message_id=str(user_message["_id"]))
    await touch_conversation(
        conversation_id,
        title=conversation.get("title") or req.user_message[:30],
    )

    run = await create_run(
        workspace_id,
        conversation_id,
        req.user_message,
        turn_id=str(turn["_id"]),
        model=req.model,
        status="queued",
    )
    trace = await create_trace(
        turn_id=str(turn["_id"]),
        conversation_id=conversation_id,
        workspace_id=workspace_id,
        run_id=str(run["_id"]),
    )
    run = await update_run(str(run["_id"]), trace_id=str(trace["_id"]))
    await update_turn(
        str(turn["_id"]),
        run_id=str(run["_id"]),
        trace_id=str(trace["_id"]),
        status="queued",
    )
    await append_run_event(
        str(run["_id"]),
        "run.queued",
        {
            "turn_id": str(turn["_id"]),
            "trace_id": str(trace["_id"]),
            "status": "queued",
        },
    )
    return {
        "run_id": str(run["_id"]),
        "turn_id": str(turn["_id"]),
        "trace_id": str(trace["_id"]),
        "status": run["status"],
        "conversation_id": conversation_id,
        "stream_url": f"/api/runs/{run['_id']}/events" if req.stream else None,
    }


@app.get("/api/conversations")
async def get_conversations():
    cursor = conversations_collection.find().sort("updated_at", -1)
    convs = await cursor.to_list(length=100)
    return [serialize_conversation(conversation) for conversation in convs]


@app.post("/api/conversations")
async def create_conversation_endpoint(req: ConversationCreateRequest | None = None):
    req = req or ConversationCreateRequest()
    conversation = await create_conversation(req.title, req.workspace_id)
    return serialize_conversation(conversation)


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    await messages_collection.delete_many({"conversation_id": conversation_id})
    runs = await runs_collection.find({"conversation_id": conversation_id}).to_list(length=500)
    run_ids = [str(run["_id"]) for run in runs]
    trace_ids = []
    turn_ids = []
    if run_ids:
        await run_steps_collection.delete_many({"run_id": {"$in": run_ids}})
        turn_ids = [run.get("turn_id") for run in runs if run.get("turn_id")]
        trace_ids = [run.get("trace_id") for run in runs if run.get("trace_id")]
    if trace_ids:
        await agent_trace_events_collection.delete_many({"trace_id": {"$in": trace_ids}})
        await agent_debug_payloads_collection.delete_many({"trace_id": {"$in": trace_ids}})
        await agent_traces_collection.delete_many({"_id": {"$in": [ObjectId(trace_id) for trace_id in trace_ids]}})
    if turn_ids:
        await conversation_turns_collection.delete_many({"_id": {"$in": [ObjectId(turn_id) for turn_id in turn_ids]}})
    await runs_collection.delete_many({"conversation_id": conversation_id})
    await conversations_collection.delete_one({"_id": ObjectId(conversation_id)})
    return {"status": "ok"}


class RenameRequest(BaseModel):
    title: str


@app.put("/api/conversations/{conversation_id}")
async def rename_conversation(conversation_id: str, req: RenameRequest):
    if req.title:
        await touch_conversation(conversation_id, title=req.title)
    return {"status": "ok"}


@app.get("/api/conversations/{conversation_id}/messages")
async def get_messages(conversation_id: str):
    cursor = messages_collection.find({"conversation_id": conversation_id}).sort(
        "created_at", 1
    )
    msgs = await cursor.to_list(length=1000)
    return [serialize_message(message) for message in msgs]


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    conversation = await get_conversation_or_404(conversation_id)
    return serialize_conversation(conversation)


@app.get("/api/conversations/{conversation_id}/runs")
async def get_conversation_runs(conversation_id: str):
    await get_conversation_or_404(conversation_id)
    cursor = runs_collection.find({"conversation_id": conversation_id}).sort("created_at", -1)
    runs = await cursor.to_list(length=200)
    return {"runs": [serialize_run(run) for run in runs]}


@app.get("/api/conversations/{conversation_id}/turns")
async def get_conversation_turns(conversation_id: str):
    await get_conversation_or_404(conversation_id)
    turns = await list_conversation_turns(conversation_id)
    hydration = await fetch_turn_hydration(turns)
    payload = []
    for turn in turns:
        serialized = serialize_turn(turn)
        user_message = hydration["messages"].get(turn.get("user_message_id"))
        assistant_message = hydration["messages"].get(turn.get("assistant_message_id"))
        run = hydration["runs"].get(turn.get("run_id"))
        trace = hydration["traces"].get(turn.get("trace_id"))
        payload.append(
            {
                **serialized,
                "user_message": serialize_message(user_message) if user_message else None,
                "assistant_message": serialize_message(assistant_message) if assistant_message else None,
                "run": serialize_run(run) if run else None,
                "trace": serialize_trace(trace) if trace else None,
            }
        )
    return {"turns": payload}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = await get_run_or_404(run_id)
    return serialize_run(run)


@app.get("/api/traces/{trace_id}")
async def get_trace(trace_id: str):
    trace = await get_trace_or_404(trace_id)
    run = await get_run_or_404(trace["run_id"])
    steps = await list_run_steps(trace["run_id"])
    return {
        "trace": serialize_trace(trace),
        "summary": await build_trace_summary(trace_id),
        "run": serialize_run(run),
        "steps": [serialize_run_step(step) for step in steps],
    }


@app.get("/api/traces/{trace_id}/events")
async def get_trace_events(trace_id: str, after_seq: int = 0, limit: int = 500):
    await get_trace_or_404(trace_id)
    events = await list_trace_events(trace_id, after_seq=after_seq, limit=min(limit, 1000))
    return {"events": [serialize_trace_event(event) for event in events]}


@app.get("/api/traces/{trace_id}/debug")
async def get_trace_debug(trace_id: str, request: Request):
    if TRACE_DEBUG_TOKEN and request.headers.get("x-trace-debug-token") != TRACE_DEBUG_TOKEN:
        raise HTTPException(status_code=403, detail="trace debug access denied")
    await get_trace_or_404(trace_id)
    payloads = await list_trace_debug_payloads(trace_id)
    return {"payloads": [serialize_debug_payload(item) for item in payloads]}


@app.get("/api/runs/{run_id}/steps")
async def get_run_steps(run_id: str):
    await get_run_or_404(run_id)
    steps = await list_run_steps(run_id)
    return {"steps": [serialize_run_step(step) for step in steps]}


@app.get("/api/runs/{run_id}/events")
async def get_run_events(run_id: str, request: Request):
    await get_run_or_404(run_id)
    last_event_id = request.headers.get("last-event-id")
    try:
        after_seq = int(last_event_id or "0")
    except ValueError:
        after_seq = 0

    def normalize_stream_event(event: dict) -> dict:
        if "type" in event:
            return event

        event_type = event.get("event_type")
        if not event_type:
            return event

        ui_payload = event.get("ui_payload")
        payload = event.get("payload")
        if not isinstance(ui_payload, dict):
            ui_payload = payload if isinstance(payload, dict) else {}

        return {
            "id": str(event.get("id", "")),
            "run_id": event.get("run_id", run_id),
            "trace_id": event.get("trace_id"),
            "turn_id": event.get("turn_id"),
            "seq": int(event.get("seq", 0)),
            "type": event_type,
            "scope": event.get("scope", "run"),
            "payload": ui_payload,
            "ui_payload": ui_payload,
            "created_at": event.get("created_at"),
        }

    async def event_stream():
        current_seq = after_seq
        channel = f"run:{run_id}"
        pubsub = redis_async_client.pubsub()
        await pubsub.subscribe(channel)
        heartbeat_interval = 15
        last_yield_time = asyncio.get_event_loop().time()
        logger.info("SSE stream opened run_id=%s after_seq=%s", run_id, after_seq)
        try:
            while True:
                # ---- 1. drain MongoDB backlog first ----
                try:
                    backlog = await list_run_events(run_id, after_seq=current_seq)
                except Exception:
                    backlog = []

                if backlog:
                    for event_doc in backlog:
                        serialized = serialize_run_event(event_doc)
                        current_seq = int(serialized["seq"])
                        payload = json.dumps(serialized)
                        yield f"id: {current_seq}\ndata: {payload}\n\n"
                        last_yield_time = asyncio.get_event_loop().time()
                    if backlog[-1]["event_type"] in {"turn.completed", "turn.failed"}:
                        break
                    continue

                # ---- 2. wait for a Redis pub/sub push ----
                try:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True,
                        timeout=0.1,
                    )
                except Exception:
                    message = None
                    await asyncio.sleep(0.05)

                if message and message.get("data"):
                    try:
                        event = normalize_stream_event(json.loads(message["data"]))
                    except Exception:
                        continue
                    event_seq = int(event.get("seq", 0))
                    if event_seq > current_seq:
                        current_seq = event_seq
                        yield f"id: {current_seq}\ndata: {json.dumps(event)}\n\n"
                        last_yield_time = asyncio.get_event_loop().time()
                        if event.get("type") in {"turn.completed", "turn.failed"}:
                            break
                        continue

                # ---- 3. keepalive heartbeat ----
                now = asyncio.get_event_loop().time()
                if now - last_yield_time >= heartbeat_interval:
                    yield ": heartbeat\n\n"
                    last_yield_time = now

                # ---- 4. terminal-status fallback ----
                try:
                    current_run = await get_run_or_404(run_id)
                except Exception:
                    break
                if current_run["status"] in {"completed", "failed", "cancelled"}:
                    final_backlog = await list_run_events(run_id, after_seq=current_seq)
                    for event_doc in final_backlog:
                        serialized = serialize_run_event(event_doc)
                        current_seq = int(serialized["seq"])
                        yield f"id: {current_seq}\ndata: {json.dumps(serialized)}\n\n"
                    break
        finally:
            logger.info("SSE stream closed run_id=%s final_seq=%s", run_id, current_seq)
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/runs/{run_id}/steps")
async def create_run_step_endpoint(run_id: str, req: RunStepCreateRequest):
    step = await create_run_step(
        run_id,
        thought=req.thought,
        code=req.code,
        stdout=req.stdout,
        stderr=req.stderr,
        exit_code=req.exit_code,
        artifacts=req.artifacts,
        next_step_needed=req.next_step_needed,
        duration_ms=req.duration_ms,
    )
    return serialize_run_step(step)


@app.post("/api/runs/{run_id}/execute")
async def execute_run_step_endpoint(run_id: str, req: RunExecuteRequest):
    execution = await execute_run_code(run_id, req.code)
    step = await create_run_step(
        run_id,
        thought=req.thought,
        code=execution["code"],
        stdout=execution["stdout"],
        stderr=execution["stderr"],
        exit_code=execution["exit_code"],
        artifacts=execution["artifacts"],
        next_step_needed=req.next_step_needed,
        duration_ms=execution["duration_ms"],
    )
    return {
        "step": serialize_run_step(step),
        "sandbox": execution["sandbox"],
    }
@app.post("/api/runs/{run_id}/start", status_code=202)
async def start_run_endpoint(run_id: str):
    run = await get_run_or_404(run_id)
    if run["status"] in {"completed", "failed", "cancelled"}:
        return {"run_id": run_id, "status": run["status"]}
    if run.get("worker_task_id") and run["status"] in {"queued", "running"}:
        task = get_task_result(run["worker_task_id"])
        if task.state not in {"FAILURE", "REVOKED"}:
            return {"run_id": run_id, "task_id": run["worker_task_id"], "status": run["status"]}

    task = enqueue_workspace_run(run_id)
    updated_run = await update_run(
        run_id,
        status="queued",
        worker_task_id=task.id,
        attempt_count=(run.get("attempt_count", 0) or 0) + 1,
        queued_at=datetime.now(timezone.utc),
    )
    return {"run_id": run_id, "task_id": task.id, "status": updated_run["status"]}


@app.patch("/api/runs/{run_id}")
async def update_run_endpoint(run_id: str, req: RunUpdateRequest):
    if req.status is None and req.final_answer is None and req.failure_reason is None:
        raise HTTPException(status_code=400, detail="nothing to update")
    run = await update_run(
        run_id,
        status=req.status,
        final_answer=req.final_answer,
        failure_reason=req.failure_reason,
    )
    return serialize_run(run)


@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if not req.conversation_id:
        conversation = await create_conversation(req.message[:30], None)
        conversation_id = str(conversation["_id"])
    else:
        conversation_id = req.conversation_id

    # Store user message
    await store_message(conversation_id, "user", req.message)
    await touch_conversation(conversation_id)

    # Load context
    cursor = messages_collection.find({"conversation_id": conversation_id}).sort(
        "created_at", 1
    )
    history = await cursor.to_list(length=1000)
    messages = [{"role": m["role"], "content": m["content"]} for m in history]

    # Enforce sliding token limit
    enc = get_encoding()
    messages = trim_to_limit(messages, MAX_CONTEXT_TOKENS, enc)

    async def event_stream():
        kwargs = dict(
            model=req.model,
            messages=messages,
            stream=True,
            extra_body={
                "reasoning": {"enabled": req.thinking, "exclude": not req.thinking},
                "include_reasoning": req.thinking,
            },
        )

        full_content = ""
        full_thinking = ""
        content_buf = ""
        in_think_tag = False

        yield f"data: {json.dumps({'type': 'meta', 'conversation_id': conversation_id})}\n\n"

        try:
            stream = await client.chat.completions.create(**kwargs)
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                # 1. Anthropic-style reasoning_details field
                rd = getattr(delta, "reasoning_details", None)
                if not rd and hasattr(delta, "model_extra") and delta.model_extra:
                    rd = delta.model_extra.get("reasoning_details")
                if rd:
                    items = rd if isinstance(rd, list) else [rd]
                    for item in items:
                        if item is None:
                            continue
                        text = (
                            (item.get("text") or item.get("summary"))
                            if isinstance(item, dict)
                            else ""
                        )
                        if text:
                            full_thinking += text
                            if req.thinking:
                                yield f"data: {json.dumps({'type': 'thinking', 'content': text})}\n\n"
                    continue

                # 2. DeepSeek / legacy reasoning string field
                reasoning_str = getattr(delta, "reasoning", None)
                if (
                    not reasoning_str
                    and hasattr(delta, "model_extra")
                    and delta.model_extra
                ):
                    reasoning_str = delta.model_extra.get("reasoning")
                if reasoning_str:
                    full_thinking += reasoning_str
                    if req.thinking:
                        yield f"data: {json.dumps({'type': 'thinking', 'content': reasoning_str})}\n\n"
                    continue

                # 3. Content stream — ALWAYS parse <think> tags to keep them out of content,
                #    but only emit thinking SSE events when req.thinking is True.
                piece = getattr(delta, "content", "") or ""
                if not piece:
                    continue

                content_buf += piece

                # State machine — runs unconditionally so <think> tags are always stripped
                while content_buf:
                    if not in_think_tag:
                        open_idx = content_buf.find("<think>")
                        if open_idx == -1:
                            # No opening tag; safe to emit up to last 6 chars
                            # (a partial "<think" might span the next chunk)
                            safe_end = max(0, len(content_buf) - 6)
                            if safe_end > 0:
                                emit = content_buf[:safe_end]
                                full_content += emit
                                yield f"data: {json.dumps({'type': 'content', 'content': emit})}\n\n"
                                content_buf = content_buf[safe_end:]
                            break
                        else:
                            # Emit clean content before the tag
                            before = content_buf[:open_idx]
                            if before:
                                full_content += before
                                yield f"data: {json.dumps({'type': 'content', 'content': before})}\n\n"
                            content_buf = content_buf[open_idx + 7 :]  # skip <think>
                            in_think_tag = True
                    else:
                        close_idx = content_buf.find("</think>")
                        if close_idx == -1:
                            # Still inside <think>; hold last 8 chars for partial </think>
                            safe_end = max(0, len(content_buf) - 8)
                            if safe_end > 0:
                                txt = content_buf[:safe_end]
                                full_thinking += txt
                                if req.thinking:
                                    yield f"data: {json.dumps({'type': 'thinking', 'content': txt})}\n\n"
                                content_buf = content_buf[safe_end:]
                            break
                        else:
                            txt = content_buf[:close_idx]
                            full_thinking += txt
                            if req.thinking:
                                yield f"data: {json.dumps({'type': 'thinking', 'content': txt})}\n\n"
                            content_buf = content_buf[close_idx + 8 :]  # skip </think>
                            in_think_tag = False

            # Flush any remaining buffered content
            if content_buf:
                full_content += content_buf
                yield f"data: {json.dumps({'type': 'content', 'content': content_buf})}\n\n"

            # Re-calculate tokens with assistant reply included
            assistant_msg_dict = {"role": "assistant", "content": full_content}
            if full_thinking:
                assistant_msg_dict["reasoning"] = full_thinking

            final_messages = messages + [assistant_msg_dict]
            ctx_tokens = count_tokens(final_messages, enc)

            # Store assistant response in DB
            assistant_msg = {
                "conversation_id": conversation_id,
                "role": "assistant",
                "content": full_content,
                "thinking": full_thinking,
                "token_count": len(enc.encode(full_content))
                + (len(enc.encode(full_thinking)) if full_thinking else 0),
                "created_at": datetime.now(timezone.utc),
            }
            await messages_collection.insert_one(assistant_msg)

            # Update conversation token count
            await touch_conversation(conversation_id, token_count=ctx_tokens)

            yield f"data: {json.dumps({'type': 'token_count', 'count': ctx_tokens})}\n\n"
            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
