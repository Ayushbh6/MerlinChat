from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from backend.core.constants import DEFAULT_MODEL


class ConversationModel(BaseModel):
    id: Optional[str] = Field(alias="_id", default=None)
    title: str = "New Chat"
    workspace_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MessageModel(BaseModel):
    id: Optional[str] = Field(alias="_id", default=None)
    conversation_id: str
    role: str
    content: str
    thinking: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WorkspaceCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    subject_area: Optional[str] = None
    semester: Optional[str] = None


class WorkspaceResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    subject_area: Optional[str] = None
    semester: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class WorkspaceFileResponse(BaseModel):
    id: str
    workspace_id: str
    filename: str
    stored_filename: str
    content_type: str
    size_bytes: int
    storage_backend: str
    storage_path: str
    status: str
    created_at: datetime


class WorkspaceFileListResponse(BaseModel):
    files: list[WorkspaceFileResponse]


class WorkspaceTextFileCreateRequest(BaseModel):
    title: str
    body: str


class ConversationCreateRequest(BaseModel):
    title: Optional[str] = None
    workspace_id: Optional[str] = None


class RunCreateRequest(BaseModel):
    conversation_id: Optional[str] = None
    user_message: str
    model: str = DEFAULT_MODEL
    stream: bool = True


class RunResponse(BaseModel):
    id: str
    workspace_id: str
    conversation_id: str
    user_prompt: str
    model: str
    status: str
    step_count: int
    final_answer: Optional[str] = None
    failure_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class RunStepResponse(BaseModel):
    id: str
    run_id: str
    step_index: int
    thought: Optional[str] = None
    code: str
    stdout: str
    stderr: str
    exit_code: int
    artifacts: list[dict[str, Any]]
    next_step_needed: bool
    duration_ms: int
    created_at: datetime


class RunStepCreateRequest(BaseModel):
    thought: Optional[str] = None
    code: str
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    next_step_needed: bool
    duration_ms: int = 0


class RunUpdateRequest(BaseModel):
    status: Optional[str] = None
    final_answer: Optional[str] = None
    failure_reason: Optional[str] = None


class RunExecuteRequest(BaseModel):
    thought: Optional[str] = None
    code: str
    next_step_needed: bool = True


class AgentTurn(BaseModel):
    thought: str
    action: Literal["code", "final_answer"]
    code: str = ""
    next_step_needed: bool
    final_answer: Optional[str] = None

    @model_validator(mode="after")
    def validate_turn(self):
        thought = self.thought.strip()
        code = self.code.strip()
        final_answer = (self.final_answer or "").strip()

        if not thought:
            raise ValueError("thought is required")
        if len(thought) > 160:
            raise ValueError("thought must be brief")

        if self.action == "code":
            if not self.next_step_needed:
                raise ValueError(
                    "next_step_needed must be true when action is 'code'"
                )
            if not code:
                raise ValueError("code is required when action is 'code'")
            if final_answer:
                raise ValueError(
                    "final_answer must be empty when action is 'code'"
                )
        else:
            if self.next_step_needed:
                raise ValueError(
                    "next_step_needed must be false when action is 'final_answer'"
                )
            if not final_answer:
                raise ValueError(
                    "final_answer is required when action is 'final_answer'"
                )
            if code:
                raise ValueError("code must be empty when action is 'final_answer'")

        self.thought = thought
        self.code = code
        self.final_answer = final_answer or None
        return self
