import unittest

from backend.runtime.agent_contract import (
    BLOCKED_STEP_PREFIX,
    BLOCKED_STEP_EXIT_CODE,
    count_trailing_blocked_steps,
    detect_duplicate_or_stagnant_code,
)


class AgentGuardTests(unittest.TestCase):
    def test_duplicate_detector_blocks_variable_renamed_repeat(self):
        previous_code = (
            "from pathlib import Path\n"
            "course_info = Path('docs/course.md').read_text()\n"
            "print(course_info[:3000])"
        )
        repeated_code = (
            "from pathlib import Path\n"
            "text = Path('docs/course.md').read_text()\n"
            "print(text[:3000])"
        )
        reason = detect_duplicate_or_stagnant_code(
            repeated_code,
            [{"step_index": 1, "exit_code": 0, "code": previous_code}],
        )
        self.assertIsNotNone(reason)
        self.assertIn("step 1", reason or "")

    def test_trailing_blocked_step_counter_stops_at_first_non_blocked_step(self):
        steps = [
            {"exit_code": 0, "stderr": ""},
            {"exit_code": BLOCKED_STEP_EXIT_CODE, "stderr": f"{BLOCKED_STEP_PREFIX} First block"},
            {"exit_code": BLOCKED_STEP_EXIT_CODE, "stderr": f"{BLOCKED_STEP_PREFIX} Second block"},
        ]
        self.assertEqual(count_trailing_blocked_steps(steps), 2)


if __name__ == "__main__":
    unittest.main()
