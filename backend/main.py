import json
import os
from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openai import AsyncOpenAI
from typing import Optional
from bson import ObjectId

from backend.database import conversations_collection, messages_collection
from backend.models import ConversationModel, MessageModel
from backend.constants import DEFAULT_MODEL, MAX_CONTEXT_TOKENS
from backend.token_utils import get_encoding, trim_to_limit

app = FastAPI(title="AI Chatbot Backend")

# Allow frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key = os.environ.get("OPENROUTER_API_KEY", "")
if not api_key:
    print("WARNING: OPENROUTER_API_KEY not found in .env.local")

client = AsyncOpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    model: str = DEFAULT_MODEL
    thinking: bool = True

@app.get("/api/conversations")
async def get_conversations():
    cursor = conversations_collection.find().sort("created_at", -1)
    convs = await cursor.to_list(length=100)
    for c in convs:
        c["_id"] = str(c["_id"])
    return convs

@app.post("/api/conversations")
async def create_conversation():
    conv = {
        "title": "New Chat",
        "created_at": datetime.now(timezone.utc)
    }
    res = await conversations_collection.insert_one(conv)
    return {"_id": str(res.inserted_id), "title": conv["title"], "created_at": conv["created_at"].isoformat()}

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    await messages_collection.delete_many({"conversation_id": conversation_id})
    await conversations_collection.delete_one({"_id": ObjectId(conversation_id)})
    return {"status": "ok"}

class RenameRequest(BaseModel):
    title: str

@app.put("/api/conversations/{conversation_id}")
async def rename_conversation(conversation_id: str, req: RenameRequest):
    if req.title:
        await conversations_collection.update_one(
            {"_id": ObjectId(conversation_id)},
            {"$set": {"title": req.title}}
        )
    return {"status": "ok"}

@app.get("/api/conversations/{conversation_id}/messages")
async def get_messages(conversation_id: str):
    cursor = messages_collection.find({"conversation_id": conversation_id}).sort("created_at", 1)
    msgs = await cursor.to_list(length=1000)
    for m in msgs:
        m["_id"] = str(m["_id"])
    return msgs

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if not req.conversation_id:
        conv = {
            "title": req.message[:30] + ("..." if len(req.message) > 30 else ""), 
            "created_at": datetime.now(timezone.utc)
        }
        res = await conversations_collection.insert_one(conv)
        conversation_id = str(res.inserted_id)
    else:
        conversation_id = req.conversation_id

    # Store user message
    user_msg = {
        "conversation_id": conversation_id,
        "role": "user",
        "content": req.message,
        "created_at": datetime.now(timezone.utc)
    }
    await messages_collection.insert_one(user_msg)

    # Load context
    cursor = messages_collection.find({"conversation_id": conversation_id}).sort("created_at", 1)
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
                "include_reasoning": req.thinking
            }
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
                        text = (item.get("text") or item.get("summary")) if isinstance(item, dict) else ""
                        if text:
                            full_thinking += text
                            if req.thinking:
                                yield f"data: {json.dumps({'type': 'thinking', 'content': text})}\n\n"
                    continue

                # 2. DeepSeek / legacy reasoning string field
                reasoning_str = getattr(delta, "reasoning", None)
                if not reasoning_str and hasattr(delta, "model_extra") and delta.model_extra:
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
                            content_buf = content_buf[open_idx + 7:]  # skip <think>
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
                            content_buf = content_buf[close_idx + 8:]  # skip </think>
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
                "token_count": len(enc.encode(full_content)) + (len(enc.encode(full_thinking)) if full_thinking else 0),
                "created_at": datetime.now(timezone.utc)
            }
            await messages_collection.insert_one(assistant_msg)
            
            # Update conversation token count
            await conversations_collection.update_one(
                {"_id": ObjectId(conversation_id)},
                {"$set": {"token_count": ctx_tokens}}
            )

            yield f"data: {json.dumps({'type': 'token_count', 'count': ctx_tokens})}\n\n"
            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
