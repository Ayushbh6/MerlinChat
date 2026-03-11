import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

motor_module = types.ModuleType("motor")
motor_asyncio_module = types.ModuleType("motor.motor_asyncio")


class _DummyMotorClient:
    def __init__(self, *args, **kwargs):
        self.ai_chatbot_db = self

    def get_collection(self, _name: str):
        return self

    def close(self):
        return None


class _DummyGridFSBucket:
    def __init__(self, *args, **kwargs):
        pass


class _DummyObjectId(str):
    def __new__(cls, value=""):
        return str.__new__(cls, value)


motor_asyncio_module.AsyncIOMotorClient = _DummyMotorClient
motor_asyncio_module.AsyncIOMotorGridFSBucket = _DummyGridFSBucket
motor_module.motor_asyncio = motor_asyncio_module
sys.modules.setdefault("motor", motor_module)
sys.modules.setdefault("motor.motor_asyncio", motor_asyncio_module)

bson_module = types.ModuleType("bson")
bson_module.ObjectId = _DummyObjectId
sys.modules.setdefault("bson", bson_module)

pymongo_module = types.ModuleType("pymongo")
pymongo_module.ReturnDocument = types.SimpleNamespace(AFTER="after")
sys.modules.setdefault("pymongo", pymongo_module)

redis_module = types.ModuleType("redis")
redis_asyncio_module = types.ModuleType("redis.asyncio")


class _DummyRedis:
    @classmethod
    def from_url(cls, *_args, **_kwargs):
        return cls()


redis_module.Redis = _DummyRedis
redis_asyncio_module.Redis = _DummyRedis
sys.modules.setdefault("redis", redis_module)
sys.modules.setdefault("redis.asyncio", redis_asyncio_module)

from backend.services.run_event_service import (
    append_run_event,
    is_terminal_run_event,
    serialize_run_event,
)


class RunEventServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_event_sequence_increments_without_gaps(self):
        with patch(
            "backend.services.run_event_service.get_run_or_404",
            new=AsyncMock(return_value={"_id": "run-1", "turn_id": "turn-1"}),
        ):
            with patch(
                "backend.services.run_event_service.get_trace_for_run",
                new=AsyncMock(return_value={"_id": "trace-1"}),
            ):
                with patch(
                    "backend.services.run_event_service.append_trace_event",
                    new=AsyncMock(
                        side_effect=[
                            {"seq": 1, "run_id": "run-1"},
                            {"seq": 2, "run_id": "run-1"},
                        ]
                    ),
                ):
                    first = await append_run_event("run-1", "run.started", {"status": "running"})
                    second = await append_run_event("run-1", "thought.updated", {"thought": "Inspecting docs."})

        self.assertEqual(first["seq"], 1)
        self.assertEqual(second["seq"], 2)

    def test_terminal_event_detection(self):
        self.assertTrue(is_terminal_run_event({"event_type": "turn.completed"}))
        self.assertTrue(is_terminal_run_event({"event_type": "turn.failed"}))
        self.assertFalse(is_terminal_run_event({"event_type": "step.completed"}))

    def test_serialize_run_event_uses_ui_payload_shape(self):
        doc = {
            "_id": "evt-1",
            "trace_id": "trace-1",
            "turn_id": "turn-1",
            "run_id": "run-1",
            "seq": 3,
            "event_type": "step.completed",
            "scope": "run",
            "payload": {"internal": True},
            "ui_payload": {"step_index": 1, "status": "completed"},
            "created_at": "2026-03-10T12:00:00Z",
        }

        with patch(
            "backend.services.run_event_service.serialize_trace_event",
            return_value={
                "id": "evt-1",
                "trace_id": "trace-1",
                "turn_id": "turn-1",
                "run_id": "run-1",
                "seq": 3,
                "event_type": "step.completed",
                "scope": "run",
                "payload": {"internal": True},
                "ui_payload": {"step_index": 1, "status": "completed"},
                "created_at": "2026-03-10T12:00:00Z",
            },
        ):
            serialized = serialize_run_event(doc)

        self.assertEqual(serialized["type"], "step.completed")
        self.assertEqual(serialized["payload"], {"step_index": 1, "status": "completed"})
        self.assertEqual(serialized["ui_payload"], {"step_index": 1, "status": "completed"})


if __name__ == "__main__":
    unittest.main()
