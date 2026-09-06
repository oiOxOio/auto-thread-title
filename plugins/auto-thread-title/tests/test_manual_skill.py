from __future__ import annotations

import json
import unittest
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SKILL_PATH = PLUGIN_ROOT / "skills" / "rename-task-title" / "SKILL.md"
OPENAI_YAML_PATH = SKILL_PATH.parent / "agents" / "openai.yaml"
MANIFEST_PATH = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"


class ManualRenameSkillTests(unittest.TestCase):
    def test_manifest_exposes_manual_skill(self) -> None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(manifest["author"]["name"], "Why.Ping")
        self.assertEqual(manifest["interface"]["developerName"], "Why.Ping")
        self.assertEqual(manifest["skills"], "./skills/")
        self.assertIn("Write", manifest["interface"]["capabilities"])
        prompts = manifest["interface"]["defaultPrompt"]
        self.assertTrue(any("$rename-task-title" in prompt for prompt in prompts))

    def test_skill_preserves_title_only_safety_boundary(self) -> None:
        skill = SKILL_PATH.read_text(encoding="utf-8")
        self.assertIn("thread.createdAt", skill)
        self.assertIn("Asia/Shanghai", skill)
        self.assertIn("MMDD | 类型 | 主题", skill)
        self.assertIn("18 characters or fewer", skill)
        self.assertIn("mcp__codex_app__set_thread_title", skill)
        self.assertIn("Do not call `list_threads`", skill)
        self.assertNotIn("MMDD｜类型｜主题", skill)

    def test_skill_ui_metadata_is_present(self) -> None:
        metadata = OPENAI_YAML_PATH.read_text(encoding="utf-8")
        self.assertIn('display_name: "手动整理对话标题"', metadata)
        self.assertIn("$rename-task-title", metadata)


if __name__ == "__main__":
    unittest.main()
