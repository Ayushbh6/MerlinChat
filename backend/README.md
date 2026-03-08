# Backend Layout

## Entry Point

- `main.py`: FastAPI application entrypoint and route registration

## Folders

- `core/`: global constants and LLM client setup
- `db/`: MongoDB client and collection wiring
- `schemas/`: Pydantic request and response models
- `services/`: business logic for runs, workspaces, and agent orchestration
- `runtime/`: execution sandbox, storage mounting, and runtime validation
- `prompts/`: agent system prompt and turn-prompt builders
- `utils/`: shared helper utilities

## Typical Navigation

- workspace and file flow:
  `main.py` -> `services/workspace_service.py` -> `runtime/workspace_storage.py`
- run persistence:
  `main.py` -> `services/run_service.py`
- code-act loop:
  `main.py` -> `services/agent_service.py` -> `runtime/sandbox_runner.py`
- prompt and model contract:
  `prompts/agent_prompt.py` + `schemas/models.py`
