import os
from typing import Any

import motor.motor_asyncio
from dotenv import load_dotenv

# Load env variables from the project root folder
root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(root_dir, ".env.local"))

MONGO_URL = os.environ.get("MONGO_URL") or os.environ.get(
    "MONGODB_URI", "mongodb://localhost:27017"
)
GRIDFS_BUCKET_NAME = os.environ.get("GRIDFS_BUCKET_NAME", "workspace_files_fs")

client: motor.motor_asyncio.AsyncIOMotorClient | None = None
_db: Any = None
_gridfs_bucket: motor.motor_asyncio.AsyncIOMotorGridFSBucket | None = None


def init_database() -> None:
    global client, _db, _gridfs_bucket
    if client is not None and _db is not None and _gridfs_bucket is not None:
        return

    client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)
    _db = client.ai_chatbot_db
    _gridfs_bucket = motor.motor_asyncio.AsyncIOMotorGridFSBucket(
        _db,
        bucket_name=GRIDFS_BUCKET_NAME,
    )


def close_database() -> None:
    global client, _db, _gridfs_bucket
    if client is not None:
        client.close()
    client = None
    _db = None
    _gridfs_bucket = None


def _get_db():
    if _db is None:
        init_database()
    return _db


def _get_gridfs_bucket():
    if _gridfs_bucket is None:
        init_database()
    return _gridfs_bucket


class _DatabaseProxy:
    def __getattr__(self, name: str):
        return getattr(_get_db(), name)


class _CollectionProxy:
    def __init__(self, collection_name: str):
        self._collection_name = collection_name

    def __getattr__(self, name: str):
        return getattr(_get_db().get_collection(self._collection_name), name)


class _GridFSBucketProxy:
    def __getattr__(self, name: str):
        return getattr(_get_gridfs_bucket(), name)


db = _DatabaseProxy()
conversations_collection = _CollectionProxy("conversations")
messages_collection = _CollectionProxy("messages")
workspaces_collection = _CollectionProxy("workspaces")
workspace_files_collection = _CollectionProxy("workspace_files")
conversation_turns_collection = _CollectionProxy("conversation_turns")
runs_collection = _CollectionProxy("runs")
run_steps_collection = _CollectionProxy("run_steps")
run_events_collection = _CollectionProxy("run_events")
agent_traces_collection = _CollectionProxy("agent_traces")
agent_trace_events_collection = _CollectionProxy("agent_trace_events")
agent_debug_payloads_collection = _CollectionProxy("agent_debug_payloads")
gridfs_bucket = _GridFSBucketProxy()
