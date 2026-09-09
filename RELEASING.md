# 多插件市场发布规范

本仓库是 **Why Ping / why-ping 多插件聚合市场**，不是自动对话标题的单插件仓库。插件各自保持语义化版本，市场快照只是一次完整目录与版本组合；不为了聚合发布强行统一或提升插件版本。

## 两层 Release

| 层级 | 标签格式 | 用途 | Latest |
| --- | --- | --- | --- |
| 市场快照 | `marketplace-YYYY.MM.DD`，同日追加 `.2`、`.3` | 全量插件目录、独立版本、安装入口、完整市场包及校验 | 是 |
| 单插件 | `<plugin-name>-v<MAJOR.MINOR.PATCH>` | 该插件的更新记录、独立源码包与验证边界 | 否 |

例如本次市场快照包含 `auto-thread-title 0.2.1` 和 `dream-loop-safe 0.1.0`。原有 `auto-thread-title-v0.2.0` / `auto-thread-title-v0.2.1` 标签与历史正文保留；旧 Release 补充“单插件发布”提示，标题统一包含插件标识。不会把缺少新插件的旧标签改名伪装成全市场快照。

新增插件发布时不能只创建一个独立 Release 就结束：市场快照须同步列出所有已注册插件。市场列表和版本从 `.agents/plugins/marketplace.json` 及各插件 `plugin.json` 读取，不手写一份容易过期的版本表。

## 实际发布流程

1. 完成相关插件的版本与 CHANGELOG、清单和安装/实机验收；保留适用的审批与钩子信任检查。
2. 修改 [releases/marketplace.json](releases/marketplace.json)：选择从未使用过的市场标签，填写中文摘要和**每一个**插件的测试命令、测试覆盖范围与尚未完成的实机项目。`validation` 的键必须与市场目录完全一致，不能漏掉新插件。
3. 提交 PR。[Marketplace release](.github/workflows/marketplace-release.yml) 在 Ubuntu、Windows、macOS × Node.js 22/24 上验证发布脚本、全部插件及提交源码归档。PR 只能测试，不发布。
4. 合并发布计划到 `main` 后，同一工作流重新验证精确的合并提交。六项全部成功后，发布作业才获得 `contents: write`；创建草稿、上传完整附件，再发布缺失的单插件版本，最后将市场快照设为 Latest。
5. 核对实际 Release、完整 commit、插件清单、附件摘要和 `releases/latest`。未执行的 Codex 安装、桌面操作、模型行为或 Blender 渲染必须明确标注，不能把 CI 当成实机验收。

**只有发布计划文件合入 main，或维护者在 main 手动触发工作流，才会尝试发布。** 普通代码/文档提交不会自动生成大量 Release。变更插件而未提升版本、重用已指向其他提交的市场标签、已上传附件摘要冲突，都会中止，不强推标签、不删除附件或覆盖历史。

工作流失败后，优先重跑同一个提交的失败作业。新 main 提交复用旧快照标签会被拒绝，应创建新快照；不要通过删除旧标签“解决”。新独立插件包仍在草稿时可以恢复上传；已经发布的历史版本只规范展示提示，不重新打包或移动标签。发布步骤不是跨 GitHub API 的原子事务；中途失败应查看草稿与日志，并对同提交重试，不能声称已全部发布。

本次是**分发目录与发布机制整改**，不改变两个插件的代码、版本或权限，也不补造之前未完成的安装/运行验收。面向正式运行能力的验收要求仍按 [CONTRIBUTING.md](CONTRIBUTING.md) 及各插件说明执行。

## 附件与固定版本

市场 Release 的附件：完整 `why-ping-marketplace-*.zip`、所有 `<插件名>-<版本>.zip`、`release-manifest.json` 和 `SHA256SUMS`。独立 ZIP 只包含对应插件目录；完整市场 ZIP 保留市场清单与插件路径。全部只取**精确 commit 中的普通文件**，拒绝链接、子模块、凭据文件与缓存；不打包未提交文件。

ZIP 使用固定条目时间、顺序和文件权限，不受工作目录修改时间影响。版本清单记录完整 commit、每个插件版本与 SHA-256；校验值用于完整性核对，不是签名、安全认证或安装成功证明。

GitHub 自动附带的 Source code ZIP/TAR 无论在哪个单插件 Release 中，都是整个仓库源码，不能宣传成“只有该插件”。

默认命令安装所配置市场来源的当前版本：

```powershell
codex plugin marketplace upgrade why-ping
codex plugin add dream-loop-safe@why-ping
```

精确复现时，先使用独立 `CODEX_HOME`，再运行 Release 页面给出的 `marketplace add ... --ref <完整SHA>`；不要覆盖日常 `why-ping` 来源。市场 tag 不会被工作流移动，但完整 SHA 是最终精确标识。添加市场不等于已安装全部插件，仍须分别选择并在新任务验证。

## 本地检查

发布维护工具需要 Python 3.12 与 Git，仅使用 Python 标准库；各插件测试运行时由 `validation.command` 指定。本仓库现有两个插件测试使用 Node.js 22+。这些是**维护端/CI 依赖**，不会增加插件使用端的依赖。

```text
python scripts/release_marketplace.py check
python -m unittest discover -s tests/release -p "test_*.py" -v
python scripts/release_marketplace.py test-plugins
python scripts/release_marketplace.py build --commit <当前完整HEAD-SHA>
```

本地 `build` 只生成文件，不发布；`publish` 限定为本仓库 main 的 Actions，且提交必须等于该工作流 SHA。验证作业只读，发布 token 仅在发布步骤传入；不用个人 PAT、不安装 npm/pip 依赖、不保留 checkout 凭据。第三方 Actions 固定到本次核实的完整 commit。

发布脚本的网络端点限定为本仓库 GitHub API 与附件上传端点；不跟随携带凭据的重定向，不打印 token。未来替换 Actions 或扩展发布命令时仍需代码审查，不能因工具通过测试就扩大权限。
