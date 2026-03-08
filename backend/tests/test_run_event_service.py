import unittest
from unittest.mock import AsyncMock, patch

from backend.services.run_event_service import append_run_event


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


if __name__ == "__main__":
    unittest.main()
