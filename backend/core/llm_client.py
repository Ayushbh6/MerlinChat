import os
from pathlib import Path
from typing import Any, AsyncIterator

from dotenv import load_dotenv
from openai import AsyncOpenAI


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / ".env.local", override=True)

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY") or os.environ.get(
    "OPENAI_API_KEY", ""
)
OPENROUTER_BASE_URL = os.environ.get(
    "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
)
OPENROUTER_APP_NAME = os.environ.get("OPENROUTER_APP_NAME", "calendar-ai")
OPENROUTER_APP_URL = os.environ.get("OPENROUTER_APP_URL", "http://localhost:5173")

if not OPENROUTER_API_KEY:
    print(
        "WARNING: OPENROUTER_API_KEY is not configured. "
        "Set it in .env.local or .env to enable chat completions."
    )

default_headers: dict[str, str] = {}
if "openrouter.ai" in OPENROUTER_BASE_URL:
    if OPENROUTER_APP_URL:
        default_headers["HTTP-Referer"] = OPENROUTER_APP_URL
    if OPENROUTER_APP_NAME:
        default_headers["X-Title"] = OPENROUTER_APP_NAME

client = AsyncOpenAI(
    base_url=OPENROUTER_BASE_URL,
    api_key=OPENROUTER_API_KEY,
    default_headers=default_headers or None,
)


async def create_structured_completion(
    *,
    model: str,
    messages: list[dict[str, Any]],
    json_schema: dict[str, Any],
    plugins: list[dict[str, Any]] | None = None,
    extra_body: dict[str, Any] | None = None,
):
    body: dict[str, Any] = {
        "provider": {"require_parameters": True},
    }
    if plugins:
        body["plugins"] = plugins
    if extra_body:
        body.update(extra_body)

    return await client.chat.completions.create(
        model=model,
        messages=messages,
        response_format={"type": "json_schema", "json_schema": json_schema},
        extra_body=body,
    )


def _extract_stream_delta_text(delta: Any) -> str:
    content = getattr(delta, "content", None)
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    chunks.append(str(item.get("text", "")))
                continue

            item_type = getattr(item, "type", None)
            if item_type == "text":
                chunks.append(str(getattr(item, "text", "")))
        return "".join(chunks)

    return ""


async def stream_text_completion(
    *,
    model: str,
    messages: list[dict[str, Any]],
    plugins: list[dict[str, Any]] | None = None,
    extra_body: dict[str, Any] | None = None,
) -> AsyncIterator[str]:
    body: dict[str, Any] = {
        "provider": {"require_parameters": True},
    }
    if plugins:
        body["plugins"] = plugins
    if extra_body:
        body.update(extra_body)

    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
        extra_body=body,
    )
    async for chunk in stream:
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        if not delta:
            continue
        text = _extract_stream_delta_text(delta)
        if text:
            yield text
