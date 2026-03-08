import os
from typing import Any

from openai import AsyncOpenAI


OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
if not OPENROUTER_API_KEY:
    print("WARNING: OPENROUTER_API_KEY not found in .env.local")


client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
)


async def create_structured_completion(
    *,
    model: str,
    messages: list[dict[str, str]],
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
