# 自动对话标题 · Auto Thread Title

开发者：**Why.Ping**

插件标识：`auto-thread-title@why-ping`

所属市场：[Why Ping Codex Plugins](https://github.com/oiOxOio/codex-plugins)

按固定模板整理 Codex 任务标题，提供自动新任务、手动单个、手动全部三种入口。只修改标题，不修改项目名称、任务内容、项目归属、排序、置顶或归档状态。

## 安装与依赖

```powershell
codex plugin marketplace add https://github.com/oiOxOio/codex-plugins.git
codex plugin add auto-thread-title@why-ping
```

已添加该市场时无需重复添加；旧仓库地址的迁移方法见 [市场说明中的迁移章节](https://github.com/oiOxOio/codex-plugins#从旧仓库地址迁移)。

需要支持插件的 Codex CLI、Codex 桌面端的任务读取与改名工具，以及 Python 3.10+。Windows 钩子调用 `python`，其他系统入口调用 `python3`；当前自动作用域按 Windows 路径处理，尚未验证跨平台运行。批量技能还需要 CLI 的 App Server 支持 `thread/list` 游标分页和 `useStateDbOnly`。

安装后新建一个任务，让 Codex 载入技能。插件内的 `hooks/hooks.json` 会被发现，不需要复制到用户配置；首次使用自动钩子时需在 Codex CLI 的 `/hooks` 中审核并信任，钩子定义变化后可能需要重新审核。[Codex 钩子说明](https://learn.chatgpt.com/docs/hooks)

## 固定命名规则

```text
MMDD | 类型 | 主题
0903 | 优化 | 批次文字显示
```

- 日期仅取创建时间 `createdAt`，转换到 `Asia/Shanghai`；不使用 `updatedAt` 或当前日期。
- 分隔符是半角 `|`，两侧各一个空格；不使用 `｜` 或 `·`。
- 类型仅限：功能、设计、修复、优化、发布、探索、文档、研究；`分析` 不在范围内。
- 主题根据实际内容提炼，具体简洁，不超过 18 个字符，不重复项目名。
- 无法确定主题或类型时保留原名，不猜测。

## 三种使用方式

| 方式 | 入口 | 范围与写入条件 |
| --- | --- | --- |
| 自动新任务 | 启用并信任插件钩子后触发 | 配置目录下的新任务，在首轮运行中最多整理一次 |
| 手动单个 | `$rename-task-title` | 用户提供一个任务链接，只处理这个任务 |
| 手动全部 | `$rename-all-task-titles` | 读取完整本机清单，先预览、确认后改名 |

### 自动整理新任务

仅在 `SessionStart` 的来源为 `startup`，且项目目录位于配置的根目录下时触发；恢复旧任务不会触发。只读取当前任务，不扫描其他任务，不轮询。

当前 [config.json](config.json) 使用 `S:\project` 作为自动模式的项目根目录。这是本版本的默认作用域，不代表任意电脑上的全部项目。目录不匹配时不会自动改名；空的 `projectRoots` 会跳过全部任务。

需要适配自己的目录时，应在自己的插件源中调整配置并发布或本地测试。不要直接修改安装缓存作为长期配置，更新可能覆盖它。当前没有动态规则设置界面。

### 手动整理单个任务

选择 **手动整理对话标题**，或输入：

```text
使用 $rename-task-title 整理这个任务：codex://threads/<thread-id>
```

必须提供一个明确的任务链接。技能读取一次，最多改名一次，不扫描其他任务。已有标题合规且准确时跳过；目标或主题不明确时不改名。

### 手动整理全部任务

选择 **整理全部对话标题**，或输入：

```text
使用 $rename-all-task-titles 整理本机全部 Codex 任务标题。
```

可以进一步限定“只整理某个项目”。默认范围包含本机所有已入库的 Codex 用户任务：各项目、无项目、置顶和归档任务；不包含其他主机、ChatGPT 云端对话或子代理临时任务。手动模式不受自动模式的 `S:\project` 限制。

执行流程：

1. 只读分页获取完整清单，覆盖活动和归档任务。
2. 默认跳过结构已合规的标题，仅为待整理项读取少量实际内容。
3. 展示“原名称 / 新名称”两列对照表，等待明确确认。
4. 确认后再次核对任务身份与原名，只修改已展示并获批的任务标题。
5. 读回验证结果；跳过不确定或冲突项，如实报告失败和未验证项。

若需要复查已经合规标题的主题，额外说明“也重新检查已合规标题的主题”。没有展示的任务不会自动加入本次修改；分页不完整、工具不可用或内容不足时不强行改名，也不通过取消归档来处理归档任务。

改名接口没有原子条件更新能力，无法完全消除最后一次检查与写入之间的并发窗口。执行期间请避免同时手动修改同一批标题。确认流程由调用技能的模型遵守，不是独立权限网关。

## 模型、额度与数据边界

命名使用当前任务正在运行的模型，不调用独立模型接口、不启动额外模型任务，也不需要插件专用 API Key。命名会使用当前回合额度，并非零消耗；批量整理的用量随待处理任务数增长。

清单脚本在本机运行，仅请求初始化和 `thread/list`；不请求模型回合、不读取完整会话文件，也不直接修改 SQLite 或 JSONL。用于提炼主题的短历史会进入当前 Codex 回合上下文，不应把整个整理过程理解成完全离线。

换 Codex 账号本身不会替换本机插件文件，但仍需当前账号和环境允许使用对应工具。不要将任务清单、会话内容或认证信息提交到公开仓库。

## 更新、停用与卸载

更新：

```powershell
codex plugin marketplace upgrade why-ping
codex plugin add auto-thread-title@why-ping
```

完成后在新任务中验证。若仍有 `auto-thread-title@personal` 本地开发版，请避免和远程版同时启用，以免钩子重复触发。

在插件源中设置 `enabled: false` 并更新安装后，只会关闭自动钩子，不会关闭显式调用的手动技能。卸载整个插件：

```powershell
codex plugin remove auto-thread-title@why-ping
```

卸载不会把已经整理过的标题恢复成原名。

## 验证

在本仓库根目录执行：

```powershell
python -m unittest discover -s plugins/auto-thread-title/tests -v
python plugins/auto-thread-title/skills/rename-all-task-titles/scripts/list_tasks.py --summary-only --page-size 20
```

第一条使用模拟数据测试命名规则、分页、异常和只读 RPC；第二条只读检查本机清单，仅输出计数，不改名。单元测试通过不等于已经执行过真实批量改名。

新增插件和发布要求见 [开发与发布指南](https://github.com/oiOxOio/codex-plugins/blob/main/CONTRIBUTING.md)。
