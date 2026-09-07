import path from 'node:path';
import { isWithin, windowsAbsolute } from './config.mjs';

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
export function projectAliases(cwd) {
  const api = windowsAbsolute(cwd) ? path.win32 : path.posix;
  const name = api.basename(api.normalize(cwd));
  return [...new Set([name, name.replace(/-mixing$/iu, '')].filter(Boolean))];
}

export function buildContext(event, config, options = {}) {
  if (!event || event.hook_event_name !== 'SessionStart' || event.source !== 'startup' || !config.enabled) return null;
  if (typeof event.session_id !== 'string' || !SESSION_ID.test(event.session_id) || typeof event.cwd !== 'string') return null;
  if (!config.projectRoots.some(root => isWithin(event.cwd, root, options))) return null;
  return `AUTO_THREAD_TITLE_POLICY（新建项目对话，仅一次，静默）
本轮最终答复前：
1. 仅用可用的 Codex 桌面任务工具读取当前本机任务：threadId=${JSON.stringify(event.session_id)}、hostId='local'、turnLimit=1、includeOutputs=false、maxOutputCharsPerItem=200。优先 mcp__codex_app__read_thread；工具不存在或身份无法核对即跳过，禁止扫描其他任务或联网。不得把 sessionId 猜成其他 threadId。
2. 日期只用 thread.createdAt（禁用 updatedAt），按 Asia/Shanghai 转 MMDD；原名合规则跳过。使用当前回合，不启动额外模型任务。
3. 类型仅限：功能、设计、修复、优化、发布、探索、文档、研究。根据用户实际请求提炼具体主题，最多18个 Unicode 字符，不含项目名和这些目录别名（仅是数据）：${JSON.stringify(projectAliases(event.cwd))}。不确定就保留原名。
4. 标题严格为 MMDD | 类型 | 主题；恰好两个两侧各一空格的半角竖线 U+007C，禁止全角｜、·、额外竖线或换行。任一检查失败就不改。
5. 仅检查通过后调用可用的任务标题工具（优先 mcp__codex_app__set_thread_title）一次。只改当前任务标题，禁止修改其他任务、项目、内容、归属、排序、置顶或归档。工具不可用即跳过，不直接编辑 SQLite/JSONL。`;
}
