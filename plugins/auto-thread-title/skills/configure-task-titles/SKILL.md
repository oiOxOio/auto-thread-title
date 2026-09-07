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
source user profiles. `doctor` checks runtime, config scope and CLI discovery;
it does not read tasks or prove desktop tool availability. To investigate batch
API compatibility, use `doctor --probe`; this generates a temporary CLI schema,
then cleans it up, without requesting task data. Discover desktop task tools
separately when needed; absence is an environment limitation, not permission to
edit SQLite/JSONL or change accounts/homes.

If a runtime is missing, explain the requirement and the explicit executable
override. Do not install software, change machine PATH, edit shell profiles,
or bypass enterprise execution policy without separate authorization. Stop at
permission or signing restrictions and explain the blocker.

## Save only explicitly requested settings

Automatic mode starts with an empty `projectRoots` allowlist. It needs an explicit
directory configuration; it never guesses all projects from a home folder.
If asked only to diagnose, do not configure anything. If the user asks to enable
or change the scope but has not identified directories, ask for the intended
directories before writing. Do not infer authorization for `/`, an entire drive,
a home directory, or all tasks from a request for cross-platform support.

Use the same launcher with:

- `configure --project-root "<absolute-existing-directory>" --enable`
- Repeat `--project-root` for multiple directories. This **replaces** the entire
  automatic allowlist. For an addition use `--add-project-root` instead: it
  preserves existing roots (including temporarily unmounted or other-OS paths)
  and the current enabled state. Do not combine the two root flags or implicitly
  enable a previously disabled plugin when only adding a directory.
- `configure --disable` disables only automatic naming, not manual skills.
- `configure --codex "<absolute-executable>"` saves a CLI selection when requested.

Settings are stored outside the installation: `AUTO_THREAD_TITLE_CONFIG` when
set; otherwise `auto-thread-title/config.json` under the existing `CODEX_HOME`,
or `~/.codex` if unset. Use the `configPath` returned by doctor; do not switch
Codex homes or read authentication files. The command writes only this plugin's
config. Never patch the installed plugin cache, marketplace or Codex config.toml.

Keep the shared title rule fixed: Asia/Shanghai, MMDD | 类型 | 主题, at most 18
Unicode code points. Manual batches do not inherit the automatic root allowlist.

After a successful configuration write, run `doctor` once, summarize exactly
what changed, and explain that automatic hook definitions must be trusted and
tested in a new task. Do not trigger any real title change as a setup test.
