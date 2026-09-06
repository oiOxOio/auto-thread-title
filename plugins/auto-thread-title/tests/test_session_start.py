from __future__ import annotations

import io
import importlib.util
import json
import os
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "session_start.py"
SPEC = importlib.util.spec_from_file_location("auto_thread_title_session_start", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SessionStartTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = {
            "enabled": True,
            "projectRoots": [r"S:\project"],
            "timezone": "Asia/Shanghai",
            "topicMaxLength": 18,
        }
        self.event = {
            "hook_event_name": "SessionStart",
            "source": "startup",
            "session_id": "01a065fd-ca16-7e73-b272-d9a66f31f090",
            "cwd": r"S:\project\Mixing\dx-cloud-mixing",
        }

    def test_new_project_session_emits_scoped_policy(self) -> None:
        context = MODULE._build_context(self.event, self.config)
        self.assertIsNotNone(context)
        assert context is not None
        self.assertIn("thread.createdAt", context)
        self.assertIn("dx-cloud-mixing", context)
        self.assertIn("类型仅限：功能、设计、修复、优化、发布、探索、文档、研究", context)
        self.assertIn("`MMDD | 类型 | 主题`", context)
        self.assertIn("半角竖线 U+007C", context)
        self.assertNotIn("MMDD｜类型｜主题", context)

    def test_projectless_session_is_ignored(self) -> None:
        event = {**self.event, "cwd": r"S:\Codex\2026-09-04\new-chat"}
        self.assertIsNone(MODULE._build_context(event, self.config))

    def test_resume_is_ignored(self) -> None:
        event = {**self.event, "source": "resume"}
        self.assertIsNone(MODULE._build_context(event, self.config))

    def test_neighbor_path_is_not_inside_root(self) -> None:
        event = {**self.event, "cwd": r"S:\project-old\example"}
        self.assertIsNone(MODULE._build_context(event, self.config))

    def test_disabled_plugin_is_silent(self) -> None:
        config = {**self.config, "enabled": False}
        self.assertIsNone(MODULE._build_context(self.event, config))

    def test_command_entry_accepts_utf8_bom(self) -> None:
        stdout = io.StringIO()
        event_json = "\ufeff" + json.dumps(self.event)
        with (
            patch.dict(os.environ, {"PLUGIN_ROOT": str(SCRIPT_PATH.parents[1])}),
            patch("sys.stdin", io.StringIO(event_json)),
            redirect_stdout(stdout),
        ):
            self.assertEqual(MODULE.main(), 0)

        payload = json.loads(stdout.getvalue())
        context = payload["hookSpecificOutput"]["additionalContext"]
        self.assertIn("thread.createdAt", context)
        self.assertIn("dx-cloud-mixing", context)


if __name__ == "__main__":
    unittest.main()
