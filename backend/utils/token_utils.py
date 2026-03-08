import tiktoken

def get_encoding() -> tiktoken.Encoding:
    """Return a tiktoken encoding suitable for counting across most models."""
    try:
        return tiktoken.encoding_for_model("gpt-4o")
    except KeyError:
        return tiktoken.get_encoding("cl100k_base")

def count_tokens(messages: list[dict], enc: tiktoken.Encoding) -> int:
    """Estimate the total token count of a list of chat messages."""
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

def trim_to_limit(messages: list[dict], max_tokens: int, enc: tiktoken.Encoding) -> list[dict]:
    """
    Drop the oldest (user, assistant) pairs until the total token count
    is at or below *max_tokens*.
    """
    system = [m for m in messages if m.get("role") == "system"]
    convo  = [m for m in messages if m.get("role") != "system"]

    while count_tokens(system + convo, enc) > max_tokens and len(convo) >= 2:
        # Remove the oldest user message and the assistant reply that follows it
        convo = convo[2:]

    return system + convo
