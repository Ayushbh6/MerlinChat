import asyncio

_worker_loop = asyncio.new_event_loop()
asyncio.set_event_loop(_worker_loop)

from backend.core.celery_app import celery_app
from backend.services.agent_service import run_agent_loop


@celery_app.task(
    bind=True,
    name="backend.tasks.agent_tasks.run_workspace_agent",
    autoretry_for=(),
    max_retries=0,
)
def run_workspace_agent(self, run_id: str):
    return _worker_loop.run_until_complete(
        run_agent_loop(run_id, worker_task_id=self.request.id)
    )
