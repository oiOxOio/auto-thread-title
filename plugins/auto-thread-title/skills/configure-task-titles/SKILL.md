---
name: configure-task-titles
description: "配置或诊断 auto-thread-title 插件的跨平台运行环境、自动项目范围和启停状态；不整理任务标题，不用于其他插件配置。"
---

# 配置与诊断自动标题

Resolve this installed skill's directory. The plugin root is two levels above it;
use only this plugin's bundled helpers. No command here renames a task.

## Inspect without changing anything

Run the platform launcher with `doctor`:

- macOS/Linux: `sh "<plugin-root>/scripts/run.sh" doctor`
- Windows: `powershell.exe -NoProfile -NonInteractive -File "<plugin-root>/scripts/run.ps1" doctor`
- If Node.js 22+ is already resolved, direct invocation is supported:
  `"<node-executable>" "<plugin-root>/src/cli.mjs" doctor` (PowerShell requires `&`).

The launchers honor an explicit `AUTO_THREAD_TITLE_NODE`, the available Codex
runtime, PATH and standard install locations. They never install software or
source user profiles. `doctor` checks runtime, config and CLI discovery without
starting the CLI; in projects mode, `automaticScopeReady: null` means the project
scope has not been checked. Use `doctor --projects` to read local project metadata
and check whether the current working directory matches. It does not read tasks
or rename them. To investigate batch API compatibility, use `doctor --probe`;
this generates and cleans up a temporary CLI schema without requesting task data.
None of these checks proves desktop tool availability or rename permissions.

For CLI discovery, explicit overrides take precedence; automatic discovery
prefers Codex's managed `plugins/.plugin-appserver/codex` (`codex.exe` on Windows)
over PATH. Do not replace it with an older PATH CLI just because that binary
launches successfully. Discover desktop task tools separately when needed;
absence does not authorize editing SQLite/JSONL or changing accounts/homes.

If a runtime is missing, explain the requirement and the explicit executable
override. Do not install software, change machine PATH, edit shell profiles,
or bypass enterprise execution policy without separate authorization. Stop at
permission or signing restrictions and explain the blocker.

## Save only explicitly requested settings

The default `scope: "projects"` follows projects saved in the local Codex home.
Every new-task startup refreshes all roots, so project additions, removals and
moves require no separate plugin setting. It matches actual paths and linked Git
worktrees, not sidebar names. Each OS reads its own project list; do not copy or
translate drive letters or enumerate other machines.

Migrated project registries must use read-only paginated `project/list`; only
unmigrated legacy environments may use `local-projects[].rootPaths`. Do not use
stale `saved-workspace-roots`. The bundled helper applies bounded subprocess and
pagination limits; discovery failure skips automatic naming without broadening
the scope. Do not repair it by directly changing Codex's project registry.

If asked only to diagnose, do not configure anything. A request to follow saved
projects or enable automatic project discovery authorizes
`--scope projects --enable` without asking for directories. If the user only
wants to toggle an existing setup, preserve its scope. For a requested manual range, use their
specified directories; ask only if the intended manual directories cannot be
determined from the conversation. Do not infer `/`, an entire drive, a home
directory, or all tasks as the manual scope.

Use the same launcher with:

- `configure --scope projects --enable` follows saved local Codex projects.
- `configure --scope manual` returns to the saved manual root list.
- `configure --project-root "<absolute-existing-directory>" --enable` sets manual
  roots and enables automatic naming within them.
- Repeat `--project-root` for multiple directories. This **replaces** the entire
  manual list. For an addition use `--add-project-root` instead: it
  preserves existing roots (including temporarily unmounted or other-OS paths)
  and the current enabled state. Both root flags select manual scope without
  implicitly enabling it. Do not combine the root flags with each other or with
  `--scope projects`.
- `configure --enable` / `configure --disable` toggles automatic naming while
  preserving the scope; manual skills are unaffected.
- `configure --codex "<absolute-executable>"` saves a CLI selection when requested.

Settings are stored outside the installation: `AUTO_THREAD_TITLE_CONFIG` when
set; otherwise `auto-thread-title/config.json` under the existing `CODEX_HOME`,
or `~/.codex` if unset. Use the `configPath` returned by doctor; do not switch
Codex homes or read authentication files. The command writes only this plugin's
config. Never patch the installed plugin cache, marketplace or Codex config.toml.

When upgrading, user config with explicit `projectRoots` but no `scope` stays in
manual mode, including an empty list; `enabled: false` stays disabled. Only switch
these choices when the user requests it. The default projects mode applies when
there is no existing manual root configuration.

Keep the shared title rule fixed: Asia/Shanghai, MMDD | 类型 | 主题, at most 18
Unicode code points for the topic. Manual batches do not inherit automatic scope.

After a successful configuration write, run `doctor --projects` once when checking
projects mode, or `doctor` for manual mode. Summarize the saved scope, enabled
state and diagnostic result. First-use hook trust still follows Codex's approval
flow; do not bypass it. Only a new task with SessionStart source `startup` can
trigger automatic naming; continuing an existing task does not retroactively
trigger it. Once the first user request establishes a clear topic, the naming
policy prioritizes the current task's title before business tool calls instead
of waiting for the final answer. An unclear topic or unavailable naming tools
means skip. If interrupted before the rename completes, the original title may
remain; never resume an interrupted task just to finish naming it. Distinguish
successful hook injection from a completed title write when reporting diagnostics.
There is no polling or extra model turn, but project discovery may briefly start
a bounded local subprocess. Do not trigger a real title change as a setup test.
