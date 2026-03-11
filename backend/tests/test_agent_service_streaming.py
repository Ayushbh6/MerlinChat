import sys
import types
import json
import unittest
from types import SimpleNamespace
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

from backend.schemas.models import AgentTurn
from backend.services.agent_service import _request_agent_turn


def _completion_message_for_turn(turn: AgentTurn) -> SimpleNamespace:
    return SimpleNamespace(
        parsed=turn,
        content=json.dumps(turn.model_dump()),
    )


def _raw_completion_for_turn(turn: AgentTurn) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=json.dumps(turn.model_dump()),
                )
            )
        ]
    )


def _final_completion_for_turn(turn: AgentTurn) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=_completion_message_for_turn(turn),
            )
        ]
    )


class _FakeStructuredStream:
    def __init__(self, events: list[object], final_completion: SimpleNamespace | None = None) -> None:
        self._events = events
        self._index = 0
        self._final_completion = final_completion

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._events):
            raise StopAsyncIteration

        event = self._events[self._index]
        self._index += 1
        if isinstance(event, Exception):
            raise event
        return event

    async def get_final_completion(self):
        return self._final_completion


class AgentServiceStreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_streamed_final_answer_emits_incremental_answer_deltas(self):
        streamed_turn = AgentTurn(
            thought="Deliver the summary.",
            action="final_answer",
            code="",
            next_step_needed=False,
            final_answer="Hello",
        )
        stream = _FakeStructuredStream(
            [
                SimpleNamespace(type="content.delta", parsed={"action": "final_answer", "final_answer": "Hel"}),
                SimpleNamespace(type="content.delta", parsed={"action": "final_answer", "final_answer": "Hello"}),
            ],
            final_completion=_final_completion_for_turn(streamed_turn),
        )

        with patch("backend.services.agent_service._stream_final_answer_enabled", return_value=True):
            with patch(
                "backend.services.agent_service.open_structured_completion_stream",
                return_value=stream,
            ) as open_stream_mock:
                with patch("backend.services.agent_service.append_run_event", new=AsyncMock()) as append_run_event_mock:
                    result = await _request_agent_turn(
                        run_id="run-1",
                        model="gpt-5",
                        payload={"prompt": "hi"},
                        attached_images=[],
                        code_step_count=0,
                    )

        self.assertEqual(result.action, "final_answer")
        self.assertEqual(result.final_answer, "Hello")
        self.assertEqual(
            [call.args[2]["chunk"] for call in append_run_event_mock.await_args_list],
            ["Hel", "lo"],
        )
        self.assertEqual(
            open_stream_mock.call_args.kwargs["plugins"],
            [{"id": "response-healing", "enabled": False}],
        )

    async def test_streamed_code_action_does_not_emit_answer_deltas(self):
        streamed_turn = AgentTurn(
            thought="Inspect the files.",
            action="code",
            code="print('hello')",
            next_step_needed=True,
            final_answer=None,
        )
        stream = _FakeStructuredStream(
            [
                SimpleNamespace(type="content.delta", parsed={"action": "code", "code": "print('hello')"}),
            ],
            final_completion=_final_completion_for_turn(streamed_turn),
        )

        with patch("backend.services.agent_service._stream_final_answer_enabled", return_value=True):
            with patch(
                "backend.services.agent_service.open_structured_completion_stream",
                return_value=stream,
            ):
                with patch("backend.services.agent_service.append_run_event", new=AsyncMock()) as append_run_event_mock:
                    result = await _request_agent_turn(
                        run_id="run-2",
                        model="gpt-5",
                        payload={"prompt": "inspect"},
                        attached_images=[],
                        code_step_count=0,
                    )

        self.assertEqual(result.action, "code")
        append_run_event_mock.assert_not_awaited()

    async def test_preanswer_stream_failure_falls_back_without_reset(self):
        fallback_turn = AgentTurn(
            thought="Deliver the summary.",
            action="final_answer",
            code="",
            next_step_needed=False,
            final_answer="Fallback answer.",
        )
        stream = _FakeStructuredStream([RuntimeError("stream failed before answer")])

        with patch("backend.services.agent_service._stream_final_answer_enabled", return_value=True):
            with patch(
                "backend.services.agent_service.open_structured_completion_stream",
                return_value=stream,
            ):
                with patch(
                    "backend.services.agent_service.create_structured_completion",
                    new=AsyncMock(return_value=_raw_completion_for_turn(fallback_turn)),
                ):
                    with patch("backend.services.agent_service.append_run_event", new=AsyncMock()) as append_run_event_mock:
                        with patch("backend.services.agent_service.asyncio.sleep", new=AsyncMock()):
                            result = await _request_agent_turn(
                                run_id="run-3",
                                model="gpt-5",
                                payload={"prompt": "fallback"},
                                attached_images=[],
                                code_step_count=0,
                            )

        self.assertEqual(result.final_answer, "Fallback answer.")
        self.assertEqual(
            [call.args[1] for call in append_run_event_mock.await_args_list],
            ["answer.delta"],
        )
        self.assertEqual(
            append_run_event_mock.await_args_list[0].args[2]["chunk"],
            "Fallback answer.",
        )

    async def test_midanswer_stream_failure_resets_before_fallback_replay(self):
        fallback_turn = AgentTurn(
            thought="Deliver the repaired summary.",
            action="final_answer",
            code="",
            next_step_needed=False,
            final_answer="Recovered answer.",
        )
        stream = _FakeStructuredStream(
            [
                SimpleNamespace(type="content.delta", parsed={"action": "final_answer", "final_answer": "Rec"}),
                RuntimeError("stream failed after partial answer"),
            ]
        )

        with patch("backend.services.agent_service._stream_final_answer_enabled", return_value=True):
            with patch(
                "backend.services.agent_service.open_structured_completion_stream",
                return_value=stream,
            ):
                with patch(
                    "backend.services.agent_service.create_structured_completion",
                    new=AsyncMock(return_value=_raw_completion_for_turn(fallback_turn)),
                ):
                    with patch("backend.services.agent_service.append_run_event", new=AsyncMock()) as append_run_event_mock:
                        with patch("backend.services.agent_service.asyncio.sleep", new=AsyncMock()):
                            result = await _request_agent_turn(
                                run_id="run-4",
                                model="gpt-5",
                                payload={"prompt": "recover"},
                                attached_images=[],
                                code_step_count=0,
                            )

        self.assertEqual(result.final_answer, "Recovered answer.")
        self.assertEqual(
            [call.args[1] for call in append_run_event_mock.await_args_list],
            ["answer.delta", "answer.reset", "answer.delta"],
        )
        self.assertEqual(append_run_event_mock.await_args_list[0].args[2]["chunk"], "Rec")
        self.assertEqual(
            append_run_event_mock.await_args_list[1].args[2],
            {"reason": "fallback_replay"},
        )
        self.assertEqual(
            append_run_event_mock.await_args_list[2].args[2]["chunk"],
            "Recovered answer.",
        )


if __name__ == "__main__":
    unittest.main()
