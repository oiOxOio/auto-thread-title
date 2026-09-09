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

已添加该市场时无需重复添加，直接安装需要的插件即可。

自动钩子和批量清单使用 **Node.js 22+**，仅依赖 Node.js 标准库，无需 Python、`npm install`、插件专用 API Key 或编译步骤。Windows、macOS、Linux 共用 `src/` 核心代码，通过各自的原生启动器查找运行时。

| 功能 | 必要环境 |
| --- | --- |
| 手动单个任务 | Codex 桌面端的 `read_thread` / `set_thread_title` 工具；不需要 Node.js |
| 自动新任务 | Node.js 22+、已启用并信任的 SessionStart 钩子、本机 Codex 已保存的项目，以及桌面任务工具；也支持手动指定目录 |
| 手动批量 | Node.js 22+、同一本机任务存储的 Codex CLI，以及桌面任务工具 |

批量入口会先检查**本机已安装 CLI** 的 schema，要求 App Server 支持 `thread/list` 的归档筛选、用户来源筛选、游标分页和 `useStateDbOnly`。自动项目范围在已迁移的项目注册表环境中需要支持 `project/list` 的 App Server。CLI 自动发现优先使用 Codex 桌面端维护的 `plugins/.plugin-appserver/codex`（Windows 为 `codex.exe`），再考虑 PATH；显式 CLI 覆盖优先。较旧 CLI 可能需要更新，启动器不会自动安装软件、切换账号或更改企业执行策略。

安装后新建一个任务，让 Codex 载入技能。插件内的 `hooks/hooks.json` 会被发现，不需要复制到用户配置；首次使用自动钩子时需在 Codex CLI 的 `/hooks` 中审核并信任，钩子定义变化后可能需要重新审核。[Codex 钩子说明](https://learn.chatgpt.com/docs/hooks)

### 统一入口与环境检查

默认自动范围跟随 Codex 保存的本机项目。优先在 Codex 中使用设置技能，不必手动定位脚本；旧手动配置需要切换时可以说：

```text
使用 $configure-task-titles，启用自动标题，并让范围自动跟随本机 Codex 保存的项目。
```

只想诊断、不修改配置时，明确说“使用 `$configure-task-titles` 仅检查当前环境和自动项目范围”。设置技能会读取现有配置，自动模式无需选择目录，手动模式区分新增目录与替换目录；执行结果不代表已完成真实改名验收。

需要命令行时，以下 `<插件目录>` 指实际安装的 `auto-thread-title` 目录，不是技能子目录；从 `codex plugin list --json` 核对已安装来源和路径，替换占位符。请在实际运行钩子/技能的 Codex 环境检查，终端 PATH 正常不代表桌面进程的 PATH 相同。

macOS / Linux：

```sh
sh "<插件目录>/scripts/run.sh" doctor
sh "<插件目录>/scripts/run.sh" doctor --projects
sh "<插件目录>/scripts/run.sh" doctor --probe
```

Windows（PowerShell）：

```powershell
powershell -NoProfile -File "<插件目录>\scripts\run.ps1" doctor
powershell -NoProfile -File "<插件目录>\scripts\run.ps1" doctor --projects
powershell -NoProfile -File "<插件目录>\scripts\run.ps1" doctor --probe
```

`doctor` 检查 Node、配置和 CLI 位置，不启动 CLI；projects 模式尚未读取项目列表时，`automaticScopeReady` 为 `null`，不能据此判断范围已就绪。`--projects` 额外只读获取本机项目元数据，核对实际范围和当前工作目录是否匹配，不读取任务或修改标题。`--probe` 额外运行 CLI 的 schema 生成命令，使用并清理临时 schema，不读取任务。这些检查不会验证桌面工具或改名权限；缺少 CLI 会使诊断返回非零，但不表示手动单任务不可用。

启动器依次尝试显式 `AUTO_THREAD_TITLE_NODE`、Codex 已提供的 `CODEX_PRIMARY_RUNTIME_NODE`、PATH 的 `node`，然后检查常见安装位置。不加载 shell profile，不安装包，也不修改 PATH；显式覆盖无效时停止，不偷偷换另一个程序。

| 覆盖项 | 用途 |
| --- | --- |
| `AUTO_THREAD_TITLE_NODE` | 启动器使用的 Node.js 22+ 可执行文件绝对路径 |
| `AUTO_THREAD_TITLE_CODEX` | 自动项目发现、批量清单和诊断使用的 Codex CLI 路径；建议绝对路径 |
| `--codex "<CLI绝对路径>"` | 本次 `doctor` / `inventory` 覆盖，优先于环境变量及保存配置 |
| `configure --codex "<CLI绝对路径>"` | 将 CLI 路径保存到用户配置，避免每次输入 |
| `AUTO_THREAD_TITLE_CONFIG` | 显式指定用户配置文件绝对路径 |

若 Node 来自 nvm、fnm 等版本管理器，桌面进程可能没有对应 PATH；在其正常启动环境提供 `AUTO_THREAD_TITLE_NODE`，然后重启 Codex。也可以使用已经确认的 Node 绝对路径直接运行 `src/cli.mjs`，所有子命令不变；PowerShell 中调用带引号的可执行路径要使用 `&`。不要为运行启动器添加 `-ExecutionPolicy Bypass`，策略拦截时交由管理员批准签名或运行方式。

Windows 官方 npm CLI 的 `.cmd` 包装会解析到其相邻 `codex.js` 并由 Node 直接启动，不经 `cmd` 执行用户路径；自定义 `.cmd` / `.bat` / `.ps1` 包装不受支持，应选择真实 `codex.exe` 或受支持的官方 npm 安装。

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
| 自动新任务 | 启用并信任插件钩子后触发 | 本机 Codex 已保存项目（默认）或手动范围内的新任务，在首轮运行中最多整理一次 |
| 手动单个 | `$rename-task-title` | 用户提供一个任务链接，只处理这个任务 |
| 手动全部 | `$rename-all-task-titles` | 读取完整本机清单，先预览、确认后改名 |

### 自动整理新任务

仅在 `SessionStart` 的来源为 `startup`，且任务实际目录匹配自动范围时触发；恢复旧任务、继续对话或更改范围不会补触发旧任务。命名只读取当前任务，不扫描其他任务，不轮询。

默认 [config.json](config.json) 使用 `scope: "projects"`，每次新任务启动时读取**本机 Codex 保存的项目及其全部根目录**。在 Codex 中新增、移除或迁移项目后，后续新任务自动使用最新范围，无需同步一份插件目录清单。匹配实际目录及其子目录，也支持已保存 Git 仓库的 linked worktree；项目显示名称不参与路径匹配。

切换到 macOS 或 Linux 后，插件读取那台机器的项目列表，不转换或复制 Windows 盘符。每台机器仍需安装依赖并按 Codex 提示信任钩子，插件不会绕过首次信任。未匹配已保存项目的目录不在默认范围内；项目列表读取失败时跳过并提供诊断，不会扩大到所有任务。

已迁移到新项目注册表的 Codex 通过只读、分页的 `project/list` 提供范围；未迁移的旧环境读取 `local-projects[].rootPaths`。不使用可能已经过时的 `saved-workspace-roots`。获取项目列表可能短暂启动本机 App Server 子进程，设有超时和分页上限，不请求额外模型回合。

全新安装无需额外设置范围。若已有手动配置，希望改为跟随项目，执行：

macOS / Linux：

```sh
sh "<插件目录>/scripts/run.sh" configure --scope projects --enable
```

Windows：

```powershell
powershell -NoProfile -File "<插件目录>\scripts\run.ps1" configure --scope projects --enable
```

需要只覆盖自选目录时，可切换为 `scope: "manual"`。`configure --scope manual` 使用已保存的手动列表；`--project-root` 和 `--add-project-root` 也会自动切换为 manual，且不会隐式启用已停用的自动标题。以下示例路径必须替换为本机已存在、可访问的目录：

```sh
sh "<插件目录>/scripts/run.sh" configure --project-root "$HOME/project" --enable
sh "<插件目录>/scripts/run.sh" configure --add-project-root "$HOME/another-project"
```

Windows 同样在 PowerShell 启动器后使用 `configure --project-root "S:\project" --enable` 或 `configure --add-project-root "D:\another-project"`。可重复 `--project-root`，每次会**替换整份手动目录列表**；可重复 `--add-project-root`，只验证新增目录，保留旧目录及启停状态。原有目录暂未挂载或属于另一系统也不会阻止添加。两个目录选项不能混用，也不能与 `--scope projects` 同用。手动列表为空时不会处理任务；`--enable` / `--disable` 只切换自动标题的启停，不影响手动技能。

手动目录支持本机绝对路径和 `~/`，拒绝普通相对路径。作用域比较使用平台原生路径及两端的真实路径，不会把 `project-old` 当成 `project` 子目录；指向根目录外的符号链接不会扩大手动作用域。

`configure` 将配置保存在 `AUTO_THREAD_TITLE_CONFIG` 指定的文件，未指定时使用既有 `CODEX_HOME` 下的 `auto-thread-title/config.json`，再无则使用用户主目录下 `.codex/auto-thread-title/config.json`。它不修改 `CODEX_HOME` 环境变量，也不修改插件安装缓存。钩子和清单只读取配置；只有显式 `configure` 写入配置。

升级保留已有选择：用户配置显式包含 `projectRoots`、但没有 `scope` 时，按 manual 处理，包括空列表；`enabled: false` 仍保持停用。没有用户手动目录配置时采用 projects 默认值。旧版内置的 Windows 默认目录不会复制到其他系统；需要从已有手动范围切换时使用 `configure --scope projects --enable`。不要把整个 Codex 用户配置跨账号复制，不要编辑下载缓存作为长期设置。

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

可以进一步限定“只整理某个项目”。默认范围包含当前 CLI 所用本机 Codex home 中所有已入库的用户任务：各项目、无项目、置顶和归档任务；不包含其他主机、ChatGPT 云端对话或子代理临时任务。CLI 与桌面端必须对应同一任务存储，不切换账号或扫描其他 home。手动技能不受自动范围的 scope 或 projectRoots 限制。

执行流程：

1. 只读分页获取完整清单，覆盖活动和归档任务。
2. 默认跳过结构已合规的标题，仅为待整理项读取少量实际内容。
3. 展示“原名称 / 新名称”两列对照表，等待明确确认。
4. 确认后再次核对任务身份与原名，只修改已展示并获批的任务标题。
5. 读回验证结果；跳过不确定或冲突项，如实报告失败和未验证项。

若需要复查已经合规标题的主题，额外说明“也重新检查已合规标题的主题”。没有展示的任务不会自动加入本次修改；分页不完整、工具不可用或内容不足时不强行改名，也不通过取消归档来处理归档任务。

清单支持 `--page-size 1..200`（默认 100）、`--needs-review`、`--summary-only` 和 `--offset N --limit N`。它先完整遍历活动/归档任务，再筛选或分片输出；`complete: true` 只表示服务端枚举完成，不代表当前输出包含全部候选。分片需要同时检查 `outputComplete`、`outputTotal` 和 `nextOffset`；每次命令都会重新枚举，不是固定快照。减少输出能节省上下文，但不会省略后台分页或授权确认；数据变化时应重新核对，不把未显示的剩余项纳入批准。

改名接口没有原子条件更新能力，无法完全消除最后一次检查与写入之间的并发窗口。执行期间请避免同时手动修改同一批标题。确认流程由调用技能的模型遵守，不是独立权限网关。

## 模型、额度与数据边界

命名使用当前任务正在运行的模型，不调用独立模型接口、不启动额外模型任务，也不需要插件专用 API Key。命名会使用当前回合额度，并非零消耗；批量整理的用量随待处理任务数增长。

清单脚本在本机运行，先生成兼容性 schema，再仅发送初始化和 `thread/list` RPC；不请求模型回合、不读取完整会话文件，也不直接修改 SQLite 或 JSONL。设有进程、分页、任务数和输出大小上限，错误时不输出伪装成完整结果的部分清单。用于提炼主题的短历史会进入当前 Codex 回合上下文，不应把整个整理过程理解成完全离线。

换 Codex 账号本身不会替换本机插件文件，但仍需当前账号和环境允许使用对应工具。不要将任务清单、会话内容或认证信息提交到公开仓库。

## 更新、停用与卸载

更新：

```powershell
codex plugin marketplace upgrade why-ping
codex plugin add auto-thread-title@why-ping
```

完成后在新任务中验证。

用对应平台启动器执行 `configure --disable` 即可关闭自动钩子，无需修改插件源或重新发布，不会关闭显式调用的手动技能。用户配置独立于插件版本保存。卸载整个插件：

```powershell
codex plugin remove auto-thread-title@why-ping
```

卸载不会把已经整理过的标题恢复成原名，也不会由本插件主动删除用户配置。

## 验证

从本仓库根目录执行测试（Node.js 22+，无需安装依赖）：

```text
cd plugins/auto-thread-title
node --test
```

测试使用临时配置、合成任务和假 App Server，覆盖路径、配置、命名、分页、启动与只读 RPC，不需要真实任务。需要检查本机清单时，由用户明确执行对应平台启动器的 `inventory --summary-only --page-size 20`；该命令会读取任务元数据，只输出计数，不改名。

CI 已配置 Ubuntu、Windows、macOS × Node.js 22/24 的六种组合，见 [工作流](../../.github/workflows/title-plugin-tests.yml)。本次开发环境是 Linux / Node.js 24；新增矩阵的成功状态应以提交后的 Actions 结果为准。未完成 Windows/macOS 桌面实机端到端验收，不能仅凭 Linux 或模拟平台测试通过就声称所有平台已验证。实机验收需覆盖安装和信任、桌面环境下运行时发现、自动作用域内/外行为、只读清单，以及明确确认后的隔离任务改名。

新增插件和发布要求见 [开发与发布指南](https://github.com/oiOxOio/codex-plugins/blob/main/CONTRIBUTING.md)。
