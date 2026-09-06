# Auto Thread Title

Automatically normalizes a newly created Codex project task title once, using
the first turn that is already running. It does not poll, schedule another
model run, or inspect other conversations.

It also includes a manual `rename-task-title` skill for one existing local
Codex task supplied through an explicit `codex://threads/<thread-id>` link.

## Default behavior

- Runs only for `SessionStart` with source `startup`.
- Runs only when `cwd` is under a root in `config.json` (currently `S:\\project`).
- Reads only the current thread to obtain its exact `createdAt` value.
- Uses `Asia/Shanghai` and the exact format `MMDD | 类型 | 主题`.
- Requires an ASCII pipe (`U+007C`) with one space on each side; full-width pipes and dot separators are rejected.
- Allows only: 功能、设计、修复、优化、发布、探索、文档、研究.
- Keeps the original title when the type or topic is unclear.
- Changes only the task title, at most once in the first turn.
- Silently skips when the required Codex app tools are unavailable.

ChatGPT cloud project conversations do not receive Codex lifecycle hooks and
are intentionally outside this plugin's scope.

## Manual rename

Select **手动整理对话标题** or invoke `$rename-task-title`, then provide exactly
one Codex task link. The skill reads only that task and applies the same fixed
`MMDD | 类型 | 主题` policy. It does not scan the sidebar, and it leaves the title
unchanged when the type or topic cannot be determined.

## Disable

Set `enabled` to `false` in `config.json`, then update/reinstall the local
plugin. Uninstalling the plugin also disables the hook; existing titles remain.

## Test

```powershell
python -m unittest discover -s tests -v
```
