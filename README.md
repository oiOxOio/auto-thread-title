# Why Ping Codex Plugins

由 **Why.Ping** 维护的 Codex 插件集合与远程插件市场。

一个仓库集中管理多个插件，每个插件独立安装、独立说明、独立维护。后续新增插件会加入同一个市场，无需为每个插件再添加一个仓库。

- 仓库：[oiOxOio/codex-plugins](https://github.com/oiOxOio/codex-plugins)
- 市场标识：`why-ping`
- 安装格式：`<插件名>@why-ping`

这是个人维护的公开插件市场，不是 OpenAI 官方插件市场。公开仓库可以直接读取；各插件的运行权限、依赖和第三方服务授权仍以其说明为准。

## 插件目录

| 插件 | 能做什么 | 使用说明 |
| --- | --- | --- |
| `auto-thread-title` · 自动对话标题 | 首条请求主题明确后优先整理新任务标题；手动整理单个任务；预览确认后批量整理本机任务 | [查看说明](plugins/auto-thread-title/README.md) · [更新记录](plugins/auto-thread-title/CHANGELOG.md) |
| `dream-loop-safe` · 安全视觉迭代 | 手动启动概念、实现、截图与评审流程；适用于 Blender / Three.js，默认最多三轮，无自动钩子 | [查看说明](plugins/dream-loop-safe/README.md) · [更新记录](plugins/dream-loop-safe/CHANGELOG.md) |

目录只列出已经提供的插件。各插件的系统支持、作用范围、额度消耗及安全边界，请阅读对应说明后再安装。

## 市场发布与版本下载

[查看最新市场快照](https://github.com/oiOxOio/codex-plugins/releases/latest) · [全部发布与历史版本](https://github.com/oiOxOio/codex-plugins/releases) · [多插件发布规范](RELEASING.md)

仓库的 **Latest 是完整市场总览**，同时列出全部已注册插件及其独立版本，不再用某一个插件的版本代表整个仓库。市场快照采用 `marketplace-YYYY.MM.DD` 标签；单插件继续使用 `<插件名>-v<版本>`，历史标签不移动。

市场 Release 提供完整市场包、各插件独立包、版本清单与 SHA-256 校验。默认安装命令跟随所配置市场来源；需要复现某个 Release 时，使用该页面给出的完整 commit SHA，并在独立 `CODEX_HOME` 中验收。发布说明会区分自动化测试和未完成的实机验证。

新增插件或准备下一次发布时，更新 [发布计划](releases/marketplace.json)。发布工作流从市场目录自动收录所有插件，先通过六项平台/Node 组合验证，再发布缺少的独立版本并更新市场 Latest；普通代码提交不会自动发布。详见 [RELEASING.md](RELEASING.md)。

## 快速开始

需要支持 `codex plugin` 命令的 Codex CLI；使用桌面任务工具的插件还需要 Codex 桌面端。依赖按插件分别安装：当前标题插件的自动钩子和批量清单使用 Node.js 22+，不需要 Python 或 `npm install`；手动单任务只依赖桌面任务工具。安全视觉迭代是纯技能插件，Blender、项目运行时和截图工具按具体任务选用，不会随安装自动下载。

先添加远程市场：

```powershell
codex plugin marketplace add https://github.com/oiOxOio/codex-plugins.git
```

再按需选择插件安装，不必全部安装：

```powershell
codex plugin add auto-thread-title@why-ping
codex plugin add dream-loop-safe@why-ping
```

添加市场与安装插件是两件事。本市场按需提供插件，不会因为添加市场就批量安装所有插件；以后也可从 `why-ping` 选择其他插件。

安装后新建一个 Codex 任务使用。包含钩子的插件还需按 Codex 提示审核；发现插件内的钩子文件不等于自动信任它们。[钩子与信任说明](https://learn.chatgpt.com/docs/hooks)

标题插件默认跟随本机 Codex 中保存的项目，不必另行维护目录：新增、移除或迁移项目后，新任务启动时自动获取当前范围。切换到 macOS 或 Linux 时读取该机器的项目列表，不沿用 Windows 盘符；也可切换为手动目录范围。已有手动配置和停用状态保留，详见[插件说明](plugins/auto-thread-title/README.md#自动整理新任务)。Windows、macOS 和 Linux 共用同一份核心实现；平台 CI 和桌面实机验收的范围见插件说明，不把源码兼容性当成所有环境已经验证。

## 更新与卸载

### 更新已安装的插件

先刷新市场，再重新安装要更新的插件：

```powershell
codex plugin marketplace upgrade why-ping
codex plugin add auto-thread-title@why-ping
```

其他插件将第二行替换为对应的 `<插件名>@why-ping`。刷新市场目录不代表所有已安装插件都已更新；完成后在新任务中验证。

正式发布使用简洁的语义化版本号，例如标题插件的 `0.2.0`：修复递增末位，新增兼容功能递增中间位。各插件独立维护版本和更新记录；时间戳后缀仅用于可选的本地开发迭代。

### 查看当前来源

```powershell
codex plugin marketplace list --json
codex plugin list --json
```

此市场的 `marketplaceSource.source` 应为 `https://github.com/oiOxOio/codex-plugins.git`。远程市场会下载到本机缓存；插件条目里出现本地路径或 `source: local` 并不代表使用了个人本地开发市场，应结合 `marketplaceSource` 判断。

### 卸载单个插件

```powershell
codex plugin remove auto-thread-title@why-ping
```

这不会卸载同市场的其他插件。若不再需要整个市场，再移除市场来源：

```powershell
codex plugin marketplace remove why-ping
```

移除市场来源不等于卸载已经安装的插件，需要停用或卸载的插件请分别处理。

## 仓库结构

```text
codex-plugins/
├── .agents/plugins/marketplace.json   # why-ping 市场目录
├── plugins/
│   ├── dream-loop-safe/              # 中文纯技能插件，无运行时钩子
│   │   ├── .codex-plugin/plugin.json
│   │   ├── skills/dream-loop-safe/   # 技能、中文元数据与评审参考
│   │   ├── tests/                    # 结构测试与实机验收清单
│   │   ├── README.md
│   │   └── SECURITY-NOTES.md
│   └── auto-thread-title/
│       ├── .codex-plugin/plugin.json # 独立插件清单
│       ├── skills/                   # 手动调用的技能
│       ├── hooks/                    # 生命周期钩子
│       ├── scripts/                  # POSIX / Windows 启动入口
│       ├── src/                      # 跨平台 Node.js 实现
│       ├── tests/                    # 插件测试
│       ├── config.json               # 安全默认配置（用户配置独立保存）
│       ├── README.md                 # 使用说明
│       └── CHANGELOG.md              # 正式版本更新记录
├── releases/marketplace.json         # 明确的市场发布计划
├── scripts/release_marketplace.py    # 维护端发布与归档工具
├── RELEASING.md                      # 聚合市场与单插件两层发布规范
├── CONTRIBUTING.md                   # 新增插件、验证与发布
└── README.md                         # 市场总览与安装入口
```

新插件放在 `plugins/<插件名>/` 下，并加入市场目录。无需新建市场，也不要把新功能都塞进已有插件。完整流程见 [开发与发布指南](CONTRIBUTING.md)。

## 安全与反馈

- 安装前了解插件会读取什么、修改什么，以及是否调用外部服务或使用模型额度。
- 不要提交账号令牌、密钥、任务记录、真实业务数据或用户级 Codex 配置。
- 对任务改名等写操作，遵守各插件的确认规则，不扩大授权范围。
- 问题反馈请提供插件名称、版本、系统、复现步骤和脱敏错误信息，不要附带认证文件。

可通过 [GitHub Issues](https://github.com/oiOxOio/codex-plugins/issues) 反馈问题或提出新插件需求。
