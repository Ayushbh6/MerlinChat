#!/usr/bin/env python3
"""
OpenRouter CLI Chat
───────────────────
Multi-turn streaming chat with sliding-window context management and thinking
mode support.

Usage:
    python chat.py [options]

Options:
    -m, --model MODEL                OpenRouter model string
                                     (default: qwen/qwen3.5-122b-a10b)
    -t, --thinking                   Enable thinking / reasoning mode
    -c, --max-context-tokens N       Max tokens allowed in context window
                                     (default: 60000). Oldest (user+assistant)
                                     pairs are dropped when limit is exceeded.
    --reasoning-effort LEVEL         Effort level for reasoning: xhigh | high |
                                     medium | low | minimal  (OpenAI/Grok style)
    --reasoning-max-tokens N         Token budget for reasoning (Anthropic/Gemini
                                     style)
    --system PROMPT                  Optional system prompt

Environment:
    OPENROUTER_API_KEY               Required.
"""

import os
import sys
import time
import argparse

from dotenv import load_dotenv
from openai import OpenAI
import tiktoken


# ─── Constants ────────────────────────────────────────────────────────────────

BASE_URL = "https://openrouter.ai/api/v1"


# ─── Terminal colours ─────────────────────────────────────────────────────────

class C:
    RESET           = "\033[0m"
    BOLD            = "\033[1m"
    DIM             = "\033[2m"
    ITALIC          = "\033[3m"
    THINKING_HDR    = "\033[1;35m"   # bold magenta  – "Thinking" header
    THINKING_BODY   = "\033[2;35m"   # dim  magenta  – thinking tokens
    RESPONSE_HDR    = "\033[1;32m"   # bold green    – "Assistant" header
    USER_HDR        = "\033[1;34m"   # bold blue     – "You" header
    META            = "\033[2;36m"   # dim  cyan     – token stats / hints
    SEP             = "\033[2;37m"   # dim  white    – separators


# ─── Token helpers ────────────────────────────────────────────────────────────

def get_encoding() -> tiktoken.Encoding:
    """Return a tiktoken encoding suitable for counting across most models."""
    try:
        return tiktoken.encoding_for_model("gpt-4o")
    except KeyError:
        return tiktoken.get_encoding("cl100k_base")


def count_tokens(messages: list[dict], enc: tiktoken.Encoding) -> int:
    """
    Estimate the total token count of a list of chat messages.

    Uses the standard ~4-token overhead per message (role + formatting).
    """
    total = 0
    for msg in messages:
        total += 4  # per-message overhead
        total += len(enc.encode(msg.get("role", "")))
        content = msg.get("content", "")
        if isinstance(content, str):
            total += len(enc.encode(content))
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    total += len(enc.encode(part.get("text", "")))
    return total


def trim_to_limit(
    messages: list[dict],
    max_tokens: int,
    enc: tiktoken.Encoding,
) -> list[dict]:
    """
    Drop the oldest (user, assistant) pairs until the total token count of the
    remaining messages is at or below *max_tokens*.

    The system message (if present) is always preserved.
    """
    system = [m for m in messages if m["role"] == "system"]
    convo  = [m for m in messages if m["role"] != "system"]

    while count_tokens(system + convo, enc) > max_tokens and len(convo) >= 2:
        # Remove the oldest user message and the assistant reply that follows it
        convo = convo[2:]

    return system + convo


# ─── Streaming helpers ────────────────────────────────────────────────────────

def _get(obj, field: str):
    """
    Retrieve *field* from an openai SDK object, handling both proper attributes
    and fields stored in `model_extra` (unknown fields from the server).
    """
    if isinstance(obj, dict):
        return obj.get(field)

    val = getattr(obj, field, None)
    if val is None and hasattr(obj, "model_extra") and obj.model_extra:
        val = obj.model_extra.get(field)
    return val


def _extract_reasoning_text(reasoning_details) -> str:
    """
    Pull text out of a reasoning_details item, which may be a Pydantic model or
    a plain dict depending on SDK version.
    """
    if reasoning_details is None:
        return ""
    texts = []
    items = reasoning_details if isinstance(reasoning_details, list) else [reasoning_details]
    for rd in items:
        if rd is None:
            continue
        text = _get(rd, "text") or _get(rd, "summary")
        if text:
            texts.append(text)
    return "".join(texts)


def _to_plain_reasoning_details(reasoning_details) -> list[dict]:
    """
    Normalize reasoning_details chunks into plain dicts suitable for sending
    back in subsequent turns.
    """
    if reasoning_details is None:
        return []
    items = reasoning_details if isinstance(reasoning_details, list) else [reasoning_details]
    out: list[dict] = []
    for item in items:
        if item is None:
            continue
        if isinstance(item, dict):
            out.append(item)
            continue
        if hasattr(item, "model_dump"):
            out.append(item.model_dump(exclude_none=True))
            continue
        # Fallback for unknown object types
        out.append(dict(getattr(item, "__dict__", {})))
    return out


# ─── Main chat loop ───────────────────────────────────────────────────────────

def chat(args: argparse.Namespace) -> None:
    # Load environment from .env.local in the project root (one level up from this script)
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(os.path.join(_root, ".env.local"))
    
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        print("Error: OPENROUTER_API_KEY environment variable is not set in .env.local.", file=sys.stderr)
        sys.exit(1)

    client  = OpenAI(base_url=BASE_URL, api_key=api_key)
    enc     = get_encoding()
    messages: list[dict] = []

    # Optional system message
    if args.system:
        messages.append({"role": "system", "content": args.system.strip()})

    # ── Splash ──────────────────────────────────────────────────────────────
    print()
    print(f"{C.BOLD}OpenRouter Chat{C.RESET}")
    print(f"  {C.DIM}Model  :{C.RESET} {C.BOLD}{args.model}{C.RESET}")
    print(f"  {C.DIM}Thinking:{C.RESET} {C.BOLD}{'ON' if args.thinking else 'OFF'}{C.RESET}", end="")
    if args.thinking:
        if args.reasoning_max_tokens:
            print(f"  {C.DIM}(max_tokens={args.reasoning_max_tokens}){C.RESET}", end="")
        elif args.reasoning_effort:
            print(f"  {C.DIM}(effort={args.reasoning_effort}){C.RESET}", end="")
        else:
            print(f"  {C.DIM}(effort=medium){C.RESET}", end="")
    print()
    print(f"  {C.DIM}Context:{C.RESET} {C.BOLD}{args.max_context_tokens:,}{C.RESET} max tokens (sliding window)")
    print(f"  {C.DIM}Commands: /clear  /quit  /thinking  /thinking=Y|N  /model <model> or /model=<model>{C.RESET}")
    print(f"{C.SEP}{'─' * 60}{C.RESET}\n")

    # ── Conversation loop ────────────────────────────────────────────────────
    while True:

        # ── User input ───────────────────────────────────────────────────────
        try:
            print(f"{C.USER_HDR}You:{C.RESET} ", end="", flush=True)
            user_input = input().strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() in ("/quit", "/exit", "/q"):
            print("Goodbye!")
            break

        if user_input.lower() in ("/clear", "/reset"):
            messages = [m for m in messages if m["role"] == "system"]
            print(f"{C.META}[History cleared]{C.RESET}\n")
            continue

        # ── /thinking (status) ───────────────────────────────────────────────
        if user_input.lower() == "/thinking":
            print(f"{C.META}[Thinking: {'ON' if args.thinking else 'OFF'}]{C.RESET}\n")
            continue

        # ── /thinking=Y|N ─────────────────────────────────────────────────────
        if user_input.lower().startswith("/thinking="):
            val = user_input.split("=", 1)[1].strip().upper()
            if val in ("Y", "YES", "ON", "1", "TRUE"):
                args.thinking = True
                print(f"{C.META}[Thinking: ON]{C.RESET}\n")
            elif val in ("N", "NO", "OFF", "0", "FALSE"):
                args.thinking = False
                print(f"{C.META}[Thinking: OFF]{C.RESET}\n")
            else:
                print(f"{C.META}[Unknown value '{val}' — use /thinking=Y or /thinking=N]{C.RESET}\n")
            continue

        # ── /model <model_string> or /model=<model_string> ───────────────────
        if user_input.lower().startswith("/model"):
            new_model = ""
            if user_input.lower().startswith("/model="):
                new_model = user_input.split("=", 1)[1].strip()
            else:
                parts = user_input.split(None, 1)
                if len(parts) >= 2:
                    new_model = parts[1].strip()

            if not new_model:
                print(
                    f"{C.META}[Current model: {args.model}  — usage: /model <openrouter-model-string> or /model=<openrouter-model-string>]{C.RESET}\n"
                )
            else:
                args.model = new_model
                print(f"{C.META}[Model switched to: {args.model}]{C.RESET}\n")
            continue

        # ── Add user turn, apply sliding window ──────────────────────────────
        messages.append({"role": "user", "content": user_input})
        messages = trim_to_limit(messages, args.max_context_tokens, enc)

        # ── Build request ────────────────────────────────────────────────────
        kwargs: dict = dict(
            model=args.model,
            messages=messages,
            stream=True,
        )

        # Always set reasoning explicitly so models like Qwen don't rely on
        # provider defaults.
        reasoning_cfg: dict = {
            "enabled": bool(args.thinking),
            "exclude": not bool(args.thinking),
        }
        if args.thinking:
            if args.reasoning_max_tokens:
                reasoning_cfg["max_tokens"] = args.reasoning_max_tokens
            elif args.reasoning_effort:
                reasoning_cfg["effort"] = args.reasoning_effort
        kwargs["extra_body"] = {
            "reasoning": reasoning_cfg,
            # Legacy compatibility flag used by some provider adapters.
            "include_reasoning": bool(args.thinking),
        }

        # ── Stream response ──────────────────────────────────────────────────
        print(f"\n{C.RESPONSE_HDR}Assistant:{C.RESET}")

        full_thinking  = ""
        full_content   = ""
        full_reasoning_details: list[dict] = []
        saw_reasoning_chunk = False

        # State for <think>...</think> tag detection inside content stream
        content_buf          = ""   # partial content not yet emitted
        in_think_tag         = False
        think_buf            = ""   # accumulated thinking from <think> tags
        thinking_hdr_printed = False
        response_sep_printed = False

        def _open_thinking() -> None:
            nonlocal thinking_hdr_printed
            if not thinking_hdr_printed:
                print(f"{C.THINKING_HDR}[Thinking]{C.RESET}", flush=True)
                print(C.THINKING_BODY, end="", flush=True)
                thinking_hdr_printed = True

        def _close_thinking() -> None:
            nonlocal response_sep_printed
            if thinking_hdr_printed and not response_sep_printed:
                print(C.RESET, end="", flush=True)
                print(f"\n{C.SEP}{'─' * 30}{C.RESET}", flush=True)
                response_sep_printed = True

        try:
            started_at = time.perf_counter()
            stream = client.chat.completions.create(**kwargs)

            for chunk in stream:
                if not chunk.choices:
                    continue

                delta = chunk.choices[0].delta

                # ── Path 1: reasoning_details (Anthropic/structured) ─────────
                rd = _get(delta, "reasoning_details")
                if rd:
                    saw_reasoning_chunk = True
                    full_reasoning_details.extend(_to_plain_reasoning_details(rd))
                    text = _extract_reasoning_text(rd)
                    if text:
                        if args.thinking:
                            _open_thinking()
                            print(text, end="", flush=True)
                            full_thinking += text
                    continue

                # ── Path 2: reasoning string field (DeepSeek R1 / legacy) ────
                reasoning_str = _get(delta, "reasoning")
                if reasoning_str:
                    saw_reasoning_chunk = True
                    if args.thinking:
                        _open_thinking()
                        print(reasoning_str, end="", flush=True)
                        full_thinking += reasoning_str
                    continue

                # ── Path 3: content (may contain <think> tags) ────────────────
                piece = _get(delta, "content") or ""
                if not piece:
                    continue

                content_buf += piece
                full_content += piece

                # Fast path: no <think> tag involvement
                if not args.thinking or ("<think>" not in content_buf and not in_think_tag):
                    _close_thinking()
                    print(content_buf, end="", flush=True)
                    content_buf = ""
                    continue

                # State-machine for <think>...</think> in streamed content
                while content_buf:
                    if not in_think_tag:
                        open_idx = content_buf.find("<think>")
                        if open_idx == -1:
                            # No opening tag; safe to emit up to the last 6 chars
                            # (partial "<think" might span next chunk)
                            safe_end = max(0, len(content_buf) - 6)
                            if safe_end > 0:
                                _close_thinking()
                                print(content_buf[:safe_end], end="", flush=True)
                                content_buf = content_buf[safe_end:]
                            break
                        else:
                            # Emit everything before the tag
                            before = content_buf[:open_idx]
                            if before:
                                _close_thinking()
                                print(before, end="", flush=True)
                            content_buf  = content_buf[open_idx + len("<think>"):]
                            in_think_tag = True
                            _open_thinking()
                    else:
                        close_idx = content_buf.find("</think>")
                        if close_idx == -1:
                            # Still inside <think>; stream what we have
                            # but hold back last 8 chars for partial "</think"
                            safe_end = max(0, len(content_buf) - 8)
                            if safe_end > 0:
                                txt = content_buf[:safe_end]
                                print(txt, end="", flush=True)
                                think_buf   += txt
                                full_thinking += txt
                                content_buf  = content_buf[safe_end:]
                            break
                        else:
                            # Complete </think> found
                            txt = content_buf[:close_idx]
                            print(txt, end="", flush=True)
                            think_buf     += txt
                            full_thinking += txt
                            content_buf   = content_buf[close_idx + len("</think>"):]
                            in_think_tag  = False
                            # Print separation before normal content resumes
                            print(C.RESET, end="", flush=True)
                            print(f"\n{C.SEP}{'─' * 30}{C.RESET}", flush=True)
                            response_sep_printed = True

            # Flush anything left in buffer
            if content_buf:
                _close_thinking()
                print(content_buf, end="", flush=True)

        except KeyboardInterrupt:
            print(f"\n{C.META}[Interrupted]{C.RESET}")
            # Drop the user message we just added so history stays clean
            if messages and messages[-1]["role"] == "user":
                messages.pop()
            print()
            continue

        except Exception as exc:
            print(f"\n{C.META}[Error: {exc}]{C.RESET}")
            if messages and messages[-1]["role"] == "user":
                messages.pop()
            print()
            continue

        print(f"\n")
        elapsed_s = time.perf_counter() - started_at

        if args.thinking and not saw_reasoning_chunk:
            print(f"{C.META}[Thinking enabled, but provider returned no reasoning tokens for this turn]{C.RESET}")

        # ── Save assistant turn ───────────────────────────────────────────────
        assistant_msg: dict = {"role": "assistant", "content": full_content}
        if full_reasoning_details:
            assistant_msg["reasoning_details"] = full_reasoning_details
        elif full_thinking:
            # Fallback for providers exposing plaintext reasoning only
            assistant_msg["reasoning"] = full_thinking
        messages.append(assistant_msg)

        # ── Context token stats ───────────────────────────────────────────────
        ctx_tokens = count_tokens(messages, enc)
        print(
            f"{C.META}[~{ctx_tokens:,} ctx tokens | {len(messages)} msgs "
            f"| limit {args.max_context_tokens:,} | {elapsed_s:.2f}s]{C.RESET}\n"
        )


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="CLI multi-turn chat via OpenRouter with streaming + thinking mode.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-m", "--model",
        default="qwen/qwen3.5-122b-a10b",
        metavar="MODEL",
        help="OpenRouter model string  (default: qwen/qwen3.5-122b-a10b)",
    )
    parser.add_argument(
        "-t", "--thinking",
        action="store_true",
        help="Enable thinking / reasoning mode",
    )
    parser.add_argument(
        "-c", "--max-context-tokens",
        type=int,
        default=60_000,
        metavar="N",
        help="Max tokens in the sliding context window  (default: 60000)",
    )
    parser.add_argument(
        "--reasoning-effort",
        choices=["xhigh", "high", "medium", "low", "minimal"],
        default=None,
        metavar="LEVEL",
        help="Reasoning effort level: xhigh|high|medium|low|minimal  (OpenAI/Grok style)",
    )
    parser.add_argument(
        "--reasoning-max-tokens",
        type=int,
        default=None,
        metavar="N",
        help="Token budget for reasoning  (Anthropic/Gemini style)",
    )
    parser.add_argument(
        "--system",
        type=str,
        default=None,
        metavar="PROMPT",
        help="System prompt",
    )

    args = parser.parse_args()
    chat(args)


if __name__ == "__main__":
    main()
