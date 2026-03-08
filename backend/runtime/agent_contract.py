from fastapi import HTTPException

from backend.core.constants import FORCE_FINAL_AFTER_CODE_STEPS
from backend.schemas.models import AgentTurn


def validate_agent_turn(agent_turn: AgentTurn, code_step_count: int) -> AgentTurn:
    if code_step_count >= FORCE_FINAL_AFTER_CODE_STEPS and agent_turn.action != "final_answer":
        raise HTTPException(
            status_code=400,
            detail=(
                "final_answer is required after "
                f"{FORCE_FINAL_AFTER_CODE_STEPS} code steps"
            ),
        )
    return agent_turn
