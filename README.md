# 自动对话标题

开发者：**Why.Ping**。此仓库用于在自己的 GitHub 私有仓库中保存和安装 Codex 插件。

插件按 `MMDD | 类型 | 主题` 整理任务标题，例如 `0903 | 优化 | 批次文字显示`。日期仅取任务创建时间 `createdAt`，按 `Asia/Shanghai` 转换；类型限定为功能、设计、修复、优化、发布、探索、文档、研究。无法确定主题时保留原名。

## 安装

需要能读取此私有仓库的 GitHub 账号、支持插件和钩子的 Codex，以及可用的 Python 3.10 或更新版本。Windows 钩子调用 `python`；其他系统入口调用 `python3`，但当前版本的自动作用域按 Windows 路径处理，尚未验证跨平台运行。

先完成 GitHub 登录，让 Git 能访问私有仓库，再添加插件市场：

```powershell
gh auth login --hostname github.com --web
gh auth setup-git --hostname github.com
codex plugin marketplace add oiOxOio/auto-thread-title
codex plugin add auto-thread-title@why-ping
```

安装后，Codex 会自动发现插件内的 `hooks/hooks.json`，无需将钩子复制到用户配置。首次使用必须在 Codex CLI 的 `/hooks` 中审核并信任这个插件的钩子；安装插件不等于自动授权钩子运行。钩子定义变化后可能需要重新审核。完成后新建任务测试。

本机若已安装 `auto-thread-title@personal`，只保留其中一个版本启用，避免两个自动钩子重复触发；此仓库的发布不会替换原来的本机安装。

## 当前作用域

这是保留现有行为的个人私有分发版。`plugins/auto-thread-title/config.json` 仍使用 `S:\project` 作为自动模式的项目根目录，仅该目录下的新任务触发；其他路径不会自动改名。换电脑后若项目目录不同，需要调整该文件并更新插件。不要将空的 `projectRoots` 当成“全部项目”：当前实现会跳过全部任务。

命名时使用当前正在运行的任务模型，不调用独立模型接口、不增加后台轮询，也不需要插件专用 API Key。处理命名会占用当前回合的少量模型用量，并非完全零额度。插件依赖 Codex 桌面端的任务读取和改名工具；这些工具不可用时跳过。

## 手动整理已有任务

调用 `$rename-task-title`，同时提供一个 `codex://threads/<thread-id>` 链接。技能只处理这个任务，读取一次，最多改名一次。已有标题符合格式且准确时跳过。

自动和手动模式均只修改任务标题，不修改项目名称、任务内容、归属、排序、置顶或归档状态。手动模式不扫描其他任务，也不批量处理标题。

## 开发与验证

仓库中的插件本体位于 `plugins/auto-thread-title/`，市场清单位于 `.agents/plugins/marketplace.json`，市场名称为 `why-ping`。

```powershell
python -m unittest discover -s plugins/auto-thread-title/tests -v
```

插件代码、固定规则、测试和必要配置纳入版本控制；Python 缓存、环境文件、日志和认证文件不纳入版本控制。本仓库不包含 Codex 账号令牌、任务记录或用户级 Codex 配置。私有仓库的读取权限与 Codex 登录账号分别管理：切换 Codex 账号不会替代 GitHub 仓库访问授权。

更新插件时，在仓库的插件目录编辑并校验，更新插件版本后提交、推送；客户端更新对应市场后重新安装插件，在新任务中验证。若钩子提示需要审核，请重新审核当前定义。

参考：[Codex 插件打包](https://developers.openai.com/plugins/build/plugins)、[钩子发现与信任](https://learn.chatgpt.com/docs/hooks)。
