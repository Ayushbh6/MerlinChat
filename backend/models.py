from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone

class ConversationModel(BaseModel):
    id: Optional[str] = Field(alias="_id", default=None)
    title: str = "New Chat"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MessageModel(BaseModel):
    id: Optional[str] = Field(alias="_id", default=None)
    conversation_id: str
    role: str
    content: str
    thinking: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
