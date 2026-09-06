#!/usr/bin/env python3
"""Emit a one-time developer instruction for safe automatic task naming."""

from __future__ import annotations

import json
import ntpath
import os
import re
import sys
from pathlib import Path
from typing import Any


SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$")
ALLOWED_TYPES = ("功能", "设计", "修复", "优化", "发布", "探索", "文档", "研究")


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _canonical_windows_path(value: str) -> str:
    return ntpath.normcase(ntpath.normpath(value.strip().rstrip("\\/")))


def _is_within(path: str, root: str) -> bool:
    candidate = _canonical_windows_path(path)
    boundary = _canonical_windows_path(root)
    if not candidate or not boundary:
        return False
    try:
        return ntpath.commonpath((candidate, boundary)) == boundary
    except ValueError:
        return False


def _project_aliases(cwd: str) -> list[str]:
    name = ntpath.basename(_canonical_windows_path(cwd))
    aliases = [name] if name else []
    if name.lower().endswith("-mixing") and len(name) > len("-mixing"):
        aliases.append(name[: -len("-mixing")])
    return aliases


def _build_context(event: dict[str, Any], config: dict[str, Any]) -> str | None:
    if event.get("hook_event_name") != "SessionStart" or event.get("source") != "startup":
        return None
    if config.get("enabled") is not True:
        return None

    session_id = event.get("session_id")
    cwd = event.get("cwd")
    roots = config.get("projectRoots")
    if not isinstance(session_id, str) or not SESSION_ID_PATTERN.fullmatch(session_id):
        return None
    if not isinstance(cwd, str) or not isinstance(roots, list):
        return None
    valid_roots = [root for root in roots if isinstance(root, str) and root.strip()]
    if not valid_roots or not any(_is_within(cwd, root) for root in valid_roots):
        return None

    timezone_name = config.get("timezone", "Asia/Shanghai")
    if not isinstance(timezone_name, str) or not timezone_name.strip():
        timezone_name = "Asia/Shanghai"
    topic_max_length = config.get("topicMaxLength", 18)
    if not isinstance(topic_max_length, int) or not 6 <= topic_max_length <= 30:
        topic_max_length = 18

    aliases = _project_aliases(cwd)
    aliases_text = "、".join(aliases) if aliases else "当前项目名称"
    types_text = "、".join(ALLOWED_TYPES)

    return f"""AUTO_THREAD_TITLE_POLICY（新建项目对话，仅一次，静默）
本轮最终答复前：
1. 仅调用 mcp__codex_app__read_thread 读取当前对话：threadId={session_id!r}、hostId='local'、turnLimit=1、includeOutputs=false、maxOutputCharsPerItem=200。失败即跳过；禁止扫描其他对话或联网。
2. 日期只用 thread.createdAt（禁用 updatedAt），按 {timezone_name} 转 MMDD；原名已符合 `MMDD | 类型 | 主题` 则跳过。
3. 按用户本轮实际请求判断。类型仅限：{types_text}；主题具体简洁、最多 {topic_max_length} 字，不含项目名/别名：{aliases_text}。不确定就保留原名，禁止猜测。
4. 设置前严格检查：标题必须恰好包含两个 ` | `，分隔符只能是两侧各一个空格的半角竖线 U+007C，禁止使用 `｜`、`·` 或其他分隔符；类型必须属于上述八类。任一项不符就不改。
5. 仅在标题可确定且检查通过时调用 mcp__codex_app__set_thread_title 一次。不得修改项目名称、内容、归属、排序、置顶、归档或任何其他对话。
"""


def main() -> int:
    try:
        raw_event = sys.stdin.read().lstrip("\ufeff")
        event = json.loads(raw_event)
    except (json.JSONDecodeError, OSError):
        return 0
    if not isinstance(event, dict):
        return 0

    plugin_root_value = os.environ.get("PLUGIN_ROOT")
    plugin_root = Path(plugin_root_value) if plugin_root_value else Path(__file__).resolve().parents[1]
    config = _read_json(plugin_root / "config.json")
    if config is None:
        return 0

    context = _build_context(event, config)
    if context is None:
        return 0

    payload = {
        "continue": True,
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": context,
        },
    }
    json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
