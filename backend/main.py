import json
from datetime import datetime, timezone
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from bson import ObjectId

from backend.core.constants import DEFAULT_MODEL, MAX_CONTEXT_TOKENS
from backend.core.llm_client import client
from backend.db.database import (
    conversations_collection,
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
    serialize_run,
    serialize_run_step,
    store_message,
    touch_conversation,
    update_run,
)
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

    await store_message(conversation_id, "user", req.user_message)
    await touch_conversation(
        conversation_id,
        title=conversation.get("title") or req.user_message[:30],
    )

    run = await create_run(
        workspace_id,
        conversation_id,
        req.user_message,
        model=req.model,
        status="queued",
    )
    return {
        "run_id": str(run["_id"]),
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
    if run_ids:
        await run_steps_collection.delete_many({"run_id": {"$in": run_ids}})
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
    for m in msgs:
        m["_id"] = str(m["_id"])
    return msgs


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


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = await get_run_or_404(run_id)
    return serialize_run(run)


@app.get("/api/runs/{run_id}/steps")
async def get_run_steps(run_id: str):
    await get_run_or_404(run_id)
    steps = await list_run_steps(run_id)
    return {"steps": [serialize_run_step(step) for step in steps]}


@app.get("/api/runs/{run_id}/events")
async def get_run_events(run_id: str):
    await get_run_or_404(run_id)
    raise HTTPException(
        status_code=501, detail="run event streaming is not implemented yet"
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


@app.post("/api/runs/{run_id}/start")
async def start_run_endpoint(run_id: str):
    return await run_agent_loop(run_id)


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
