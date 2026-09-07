# Auto Thread Title

Developer: **Why.Ping**.

Three entry points share the exact `MMDD | 类型 | 主题` title policy:

- Automatic hook: normalize a newly created project task once, in its first turn.
- `$rename-task-title` (**手动整理对话标题**): rename one explicitly linked local task.
- `$rename-all-task-titles` (**整理全部对话标题**): inventory local Codex tasks,
  preview every proposed change, and rename only after explicit confirmation.

All modes change only titles. Project names, task content, associations,
ordering, pins and archive states must remain untouched. Uncertain topics stay
unchanged. ChatGPT conversations and other hosts are outside scope.

## Fixed policy

Use only `createdAt`, converted to `Asia/Shanghai`, never `updatedAt`.
Use ASCII `|` with exactly one space on each side, not full-width pipes or dots.
Allowed types: 功能、设计、修复、优化、发布、探索、文档、研究.
Topics are specific, at most 18 characters, and do not repeat the project name.

## Automatic mode (unchanged)

Runs only for `SessionStart` with source `startup`, when `cwd` is under a root
in `config.json` (currently `S:\project`). Reads only the current task, uses the
already-running model, and attempts at most one title update. No polling,
separate model call or scan of other tasks. Missing app tools cause a silent skip.

Plugin hooks are discovered by Codex but require user trust through `/hooks`.
No manual hook copying is needed. Set `enabled: false` in `config.json` and
update/reinstall to disable the automatic hook; this setting does not disable
the explicitly invoked manual skills. Uninstalling removes all plugin entry
points without restoring previous titles.

## Single-task mode

Supply exactly one `codex://threads/<thread-id>` link to `$rename-task-title`.
Reads only that task, with at most one rename. No batch scan.

## Batch mode

Invoke `$rename-all-task-titles`. Default scope includes all locally indexed
Codex user tasks across projects, including projectless, pinned and archived
tasks. A user may explicitly narrow the scope. It does not inherit the automatic
hook's project-root filter.

Requires Python 3.10+, local Codex CLI App Server cursor pagination, and the
Codex app read/rename tools. The bundled helper reads both archive states,
all providers, and user-task sources with `useStateDbOnly: true`.
It never sends mutation or model-turn requests. CLI/API failure means stop,
not a partial batch or direct SQLite/JSONL editing fallback.

For lower usage, structurally compliant titles are skipped by default; request
a semantic recheck explicitly when needed. Only candidates get short history
reads. The skill shows exactly two columns, 原名称 and 新名称, and waits for
confirmation. Approval is bound to exact task IDs and old/new titles.
It rechecks for concurrent edits before writing, skips conflicts, then verifies
results. No forced rename retries or unarchiving. The API has no atomic
compare-and-set, so avoid editing the same titles during execution.

Naming uses the current task model and consumes current-turn usage, not an
independent model or plugin API key. Inventory is local; do not publish task data.

## Test

```powershell
python -m unittest discover -s tests -v
python skills/rename-all-task-titles/scripts/list_tasks.py --summary-only --page-size 20
```

Unit tests use synthetic tasks. The second command checks real pagination but
prints only counts and never renames. New skills are picked up in a new Codex
task after updating/reinstalling the plugin.
