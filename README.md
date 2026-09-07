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
| `auto-thread-title` · 自动对话标题 | 自动整理新任务标题；手动整理单个任务；预览确认后批量整理本机任务 | [查看说明](plugins/auto-thread-title/README.md) |

目录只列出已经提供的插件。各插件的系统支持、作用范围、额度消耗及安全边界，请阅读对应说明后再安装。

## 快速开始

需要支持 `codex plugin` 命令的 Codex CLI；使用桌面任务工具的插件还需要 Codex 桌面端。其他依赖按插件分别安装，例如当前标题插件需要 Python 3.10+。

先添加远程市场：

```powershell
codex plugin marketplace add https://github.com/oiOxOio/codex-plugins.git
```

再安装需要的插件，例如：

```powershell
codex plugin add auto-thread-title@why-ping
```

添加市场与安装插件是两件事。本市场按需提供插件，不会因为添加市场就批量安装所有插件；以后也可从 `why-ping` 选择其他插件。

安装后新建一个 Codex 任务使用。包含钩子的插件还需按 Codex 提示审核；发现插件内的钩子文件不等于自动信任它们。[钩子与信任说明](https://learn.chatgpt.com/docs/hooks)

## 更新与卸载

### 更新已安装的插件

先刷新市场，再重新安装要更新的插件：

```powershell
codex plugin marketplace upgrade why-ping
codex plugin add auto-thread-title@why-ping
```

其他插件将第二行替换为对应的 `<插件名>@why-ping`。刷新市场目录不代表所有已安装插件都已更新；完成后在新任务中验证。

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
│   └── auto-thread-title/
│       ├── .codex-plugin/plugin.json # 独立插件清单
│       ├── skills/                   # 手动调用的技能
│       ├── hooks/                    # 生命周期钩子
│       ├── scripts/                  # 运行脚本
│       ├── tests/                    # 插件测试
│       ├── config.json               # 插件配置
│       └── README.md                 # 使用说明
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
