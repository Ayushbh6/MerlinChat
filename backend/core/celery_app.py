import os

from celery import Celery

from backend.core.redis_client import REDIS_URL


CELERY_QUEUE_NAME = os.environ.get("CELERY_QUEUE_NAME", "workspace_runs")
CELERY_WORKER_POOL = os.environ.get("CELERY_WORKER_POOL", "solo")
CELERY_WORKER_CONCURRENCY = int(os.environ.get("CELERY_WORKER_CONCURRENCY", "1"))

celery_app = Celery(
    "atlas_ai",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["backend.tasks.agent_tasks"],
)

celery_app.conf.update(
    task_default_queue=CELERY_QUEUE_NAME,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    worker_pool=CELERY_WORKER_POOL,
    worker_concurrency=CELERY_WORKER_CONCURRENCY,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    broker_connection_retry_on_startup=True,
    result_expires=3600,
)
