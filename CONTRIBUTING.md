# 开发与发布指南

本仓库按“一个市场、多个独立插件”维护。市场标识固定为 `why-ping`，每个插件独立命名、独立版本，不因为新增插件而重命名已有插件。

## 开发前

```powershell
git clone https://github.com/oiOxOio/codex-plugins.git
cd codex-plugins
```

先阅读 [市场总览](README.md) 和相关插件的 README。只编辑本次涉及的插件，保留其他插件的代码、配置、注册顺序和安装策略。

## 新增插件

### 1. 建立独立目录

新插件放在 `plugins/<插件名>/` 下。名称使用简短、稳定的小写连字符形式，表达用途，不使用某一次任务的标题。

可以在 Codex 中请求：

```text
使用 $plugin-creator 在当前仓库 plugins/ 下创建新插件。
将插件加入当前仓库 .agents/plugins/marketplace.json 的 why-ping 市场，
不要写入个人 marketplace，也不要改动已有插件和市场名称。
开发者使用 Why.Ping，补齐独立 README 和必要测试。
```

每个插件必须包含 `.codex-plugin/plugin.json`。按实际需要加入 `skills/`、`hooks/`、`scripts/`、`tests/`、资源和配置文件，不要为尚未实现的能力放置空目录或占位入口。[官方插件结构说明](https://developers.openai.com/plugins/build/plugins#plugin-structure)

### 2. 注册到同一市场

在 [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json) 的 `plugins` 数组末尾添加一个条目；保持已有条目的顺序。优先通过 `$plugin-creator` 完成注册并校验，不要误操作用户级市场配置。

注册条目示例，以下 `example-plugin` 只是名称占位，不是本仓库已发布的插件：

```json
{
  "name": "example-plugin",
  "source": {
    "source": "local",
    "path": "./plugins/example-plugin"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

`source.path` 相对于仓库根目录，必须以 `./` 开头并留在仓库内。这里的 `local` 表示市场仓库内的插件子目录；用户依然通过 GitHub 远程市场获取它，而不是加载开发者电脑上的文件。

核对插件文件夹名、市场条目的 `name`、插件清单的 `name` 三者一致。发布者的 `author.name` 和界面的 `interface.developerName` 使用 `Why.Ping`；声明的技能、钩子或外部服务必须真实存在。

### 3. 补齐插件说明

每个插件的 README 至少说明：

- 插件做什么、不做什么，以及适用的 Codex 环境和操作系统。
- 安装方式、运行依赖和可直接使用的调用示例。
- 自动触发条件、默认作用范围，以及读取和写入边界。
- 是否需要外部账号、API Key、网络或额外模型调用；不要宣称未经验证的零额度。
- 用户确认规则、失败时的处理方式、停用与卸载方法。
- 测试命令、已验证范围和已知限制。

根 README 只维护市场总览、通用流程和插件目录；具体插件规则放回对应 README。新增插件时同步更新首页目录，不能只创建文件却漏掉市场注册或文档入口。

## 验证要求

发布前完成与风险相称的检查：

1. 插件和市场清单可解析，名称唯一，引用路径存在且未越出仓库。
2. 使用 Codex 的 `$plugin-creator` 校验插件结构；技能由 `$skill-creator` 校验。
3. 运行受影响插件的测试。只改文档也要检查链接、示例命令及现有功能是否被误改。
4. 写操作先用模拟数据或只读预览测试；不要拿真实用户任务进行未经确认的批量修改。
5. 在新 Codex 任务中检查安装入口、技能发现和必要的钩子授权，不要仅凭源码存在就声称安装生效。

当前标题插件使用 Node.js 22+ 的内置测试运行器，没有 npm 依赖。从仓库根目录执行（Windows、macOS、Linux 相同）：

```text
cd plugins/auto-thread-title
node --test
```

无参数的 `node --test` 在插件目录发现测试，不依赖 Bash 的通配符展开。测试使用临时配置、合成任务和假 App Server，不需要 Codex 账号、不读取真实任务，也不运行真实改名。

[标题插件 CI](.github/workflows/title-plugin-tests.yml) 配置了 Ubuntu、Windows、macOS × Node.js 22/24 的六种组合。工作流仅有 `contents: read`，不保留 checkout 凭据、不安装 npm 依赖、不访问仓库 secrets。只有对应提交的 CI 实际通过，才可记录该矩阵的测试结果；首次发布仍需检查各平台的桌面环境、钩子信任和运行时路径。

标题插件的补充验收：

- POSIX 大小写、Windows 盘符/UNC、中文和空格路径、符号链接作用域边界。
- 配置替换与追加分开验证：追加只验证新目录，保留离线或其他平台的旧目录及启停状态；拒绝混用替换/追加选项。
- 原生启动器、UTF-8/BOM 标准输入、解释器缺失、进程退出与超时；Windows 运行 PowerShell 启动器，不设置执行策略绕过。
- `doctor` 只检查环境；`doctor --probe` 验证已安装 CLI 的 schema，不能用新版本在线文档替代本机能力检查。
- 批量分页、活动/归档范围、输出分片、冲突检测和只读 RPC 白名单；预览确认规则不能被性能优化削弱。
- 手动实机检查在隔离测试任务上进行，改名必须明确获批。CI 通过不等于完成真实桌面改名验收。

其他插件仍应提供自己的验证方式，不强制使用标题插件的运行时或测试框架。

## 版本与发布

- 每个插件使用独立的 `version`。安装产物改变后应发布新的版本标识，避免沿用已有缓存。
- 本地迭代可使用 `$plugin-creator` 的版本缓存后缀更新工具；保留基础版本，只替换单个 `+codex.<标记>` 后缀。
- 只改市场首页或贡献指南、不涉及插件安装产物时，无需变更所有插件的版本。
- 不直接修改 Codex 下载的市场快照或安装缓存作为发布方式，也不重新启用用户已移除的本地开发市场。

完成校验后提交需要的文件并推送到本仓库，再更新客户端：

```powershell
codex plugin marketplace upgrade why-ping
codex plugin add auto-thread-title@why-ping
```

上面的第二行以标题插件为例，发布其他插件时替换为相应名称。刷新市场后需安装或更新目标插件，并在新任务中验证；修改钩子定义时按 Codex 提示重新审核。

## 安全检查

提交前检查差异，不纳入以下内容：

- Codex、GitHub 或第三方服务令牌，以及认证文件、私钥、带凭据的 URL。
- 真实任务内容、任务清单、内部业务数据、运行日志或包含敏感信息的截图。
- 用户级 Codex 配置、个人市场配置、插件安装缓存、运行时缓存和 `node_modules`。

新的自动化或外部服务能力应先说明触发时机、费用、权限及停用方式，不应通过新增插件扩大已有插件的权限。市场代码公开不代表已通过官方审核，也不代表用户授权任意操作。
