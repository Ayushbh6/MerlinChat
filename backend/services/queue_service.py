from celery.result import AsyncResult

from backend.core.celery_app import celery_app
from backend.tasks.agent_tasks import run_workspace_agent


def enqueue_workspace_run(run_id: str) -> AsyncResult:
    return run_workspace_agent.apply_async(args=[run_id])


def get_task_result(task_id: str) -> AsyncResult:
    return AsyncResult(task_id, app=celery_app)
