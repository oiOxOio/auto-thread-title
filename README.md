# 自动对话标题

开发者：**Why.Ping**。GitHub 公开仓库：`oiOxOio/auto-thread-title`。

插件按 `MMDD | 类型 | 主题` 整理任务标题，例如 `0903 | 优化 | 批次文字显示`。日期仅取任务创建时间 `createdAt`，按 `Asia/Shanghai` 转换；类型限定为功能、设计、修复、优化、发布、探索、文档、研究。主题简洁具体，不重复项目名，无法确定时保留原名。

## 三种使用方式

| 入口 | 处理范围 | 执行方式 |
| --- | --- | --- |
| 自动新任务 | 配置目录下刚创建的任务 | 在首轮运行中整理一次 |
| `$rename-task-title` | 用户提供的一个 `codex://threads/<thread-id>` 链接 | 单次读取，最多改名一次 |
| `$rename-all-task-titles` | 本机所有已入库的 Codex 任务，也可指定更小范围 | 分页读取、两列预览、确认后修改并校验 |

三个入口共用固定命名规则，只修改任务标题。绝不修改项目名称、任务内容、归属、排序、置顶或归档状态；不处理 ChatGPT 云端对话。

## 安装

需要支持插件和钩子的 Codex，以及可用的 Python 3.10 或更新版本。Windows 钩子调用 `python`；其他系统入口调用 `python3`，但当前自动作用域按 Windows 路径处理，尚未验证跨平台运行。批量技能还需要本机 Codex CLI 支持 App Server 的 `thread/list` 游标分页和 `useStateDbOnly` 参数。

此仓库为公开仓库，读取不要求专用 GitHub 授权：

```powershell
codex plugin marketplace add oiOxOio/auto-thread-title
codex plugin add auto-thread-title@why-ping
```

安装后，Codex 会自动发现插件内的 `hooks/hooks.json`，无需将钩子复制到用户配置。首次使用必须在 Codex CLI 的 `/hooks` 中审核并信任这个插件的钩子；安装插件不等于自动授权钩子运行。钩子定义变化后可能需要重新审核。完成后新建任务测试。

本机若已安装 `auto-thread-title@personal`，只保留其中一个版本启用，避免两个自动钩子重复触发。插件安装与项目范围跟随本机 Codex 配置；换 Codex 账号本身不会替换这些本地文件，但新账号仍需有工具使用权限。

## 自动模式与额度

`plugins/auto-thread-title/config.json` 使用 `S:\project` 作为自动模式的项目根目录，仅该目录下的新任务触发；其他路径不会自动改名。换电脑后若目录不同，需要调整该文件并更新插件。不要将空的 `projectRoots` 当成“全部项目”：当前实现会跳过全部任务。

命名使用当前正在运行的任务模型，不调用独立模型接口、不增加后台轮询，不需要插件专用 API Key。命名占用当前回合的少量模型用量，并非零额度。插件依赖 Codex 桌面端的任务读取和改名工具；不可用时跳过。

## 整理单个或全部任务

单个：选择 **手动整理对话标题**，或输入：

```text
使用 $rename-task-title 整理这个任务：codex://threads/<thread-id>
```

全部：选择 **整理全部对话标题**，或输入：

```text
使用 $rename-all-task-titles 整理本机全部 Codex 任务标题。
```

也可以要求只整理某个项目。批量模式不受自动模式的 `S:\project` 限制，默认包含本机各项目、无项目、置顶和归档任务，不包含子代理临时任务、其他主机或 ChatGPT 对话。

批量流程先读取完整清单，默认跳过格式、日期等结构检查已合规的标题；如需核对其主题，明确要求“也重新检查已合规标题的主题”。仅为待整理项读取少量实际内容。预览严格使用“原名称 / 新名称”两列，确认前不写入；未展示的条目不在授权范围内。改名前重新检查原名与任务身份，发生变更就跳过；无法确定主题、分页失败或工具不可用时不强行改名。不通过取消归档来处理归档任务。

改名接口没有原子条件更新能力，不能保证完全消除最后一次检查与写入之间的并发窗口。请避免在确认后的执行阶段同时手动改同一批标题。

只读清单脚本仅请求初始化和 `thread/list`，不启动模型回合，不读取完整会话文件，也不直接修改数据库。清单留在本机，不应提交到 GitHub；脚本失败不会退回修改 SQLite/JSONL 的方式。

## 开发与验证

插件本体位于 `plugins/auto-thread-title/`，市场清单位于 `.agents/plugins/marketplace.json`，市场名称为 `why-ping`。

```powershell
python -m unittest discover -s plugins/auto-thread-title/tests -v
python plugins/auto-thread-title/skills/rename-all-task-titles/scripts/list_tasks.py --summary-only --page-size 20
```

第一条使用模拟数据验证模板、分页、重复项、异常、只读 RPC 等行为；第二条只读验证本机清单，只输出计数，不改任何标题。提示词中的确认流程仍需由调用技能的模型遵守，单元测试不代表真实批量改名已经执行。

更新插件时，在仓库插件目录编辑并校验，更新版本后提交、推送；客户端更新对应市场后重新安装插件，在新任务中验证。若钩子提示需要审核，请重新审核当前定义。此次新增批量技能没有改动自动钩子。

仓库不包含 Codex 账号令牌、任务记录或用户级 Codex 配置。Python 缓存、环境文件、日志和认证文件不纳入版本控制。

参考：[Codex 插件打包](https://developers.openai.com/plugins/build/plugins)、[钩子发现与信任](https://learn.chatgpt.com/docs/hooks)、[App Server 分页 API](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters)。
