/** Read-only inventory policy. Never reads transcripts or changes any task. */
import path from 'node:path';

export const TYPES = Object.freeze(['功能', '设计', '修复', '优化', '发布', '探索', '文档', '研究']);
export const SOURCE_KINDS = Object.freeze(['cli', 'vscode', 'appServer', 'exec', 'unknown']);
const titlePattern = new RegExp(`^(\\d{4}) \\| (${TYPES.join('|')}) \\| ([^|｜·\\r\\n]+)$`, 'u');
let shanghaiFormatter;

export function shanghaiMmdd(createdAt) {
  // Never substitute updatedAt, accept a boolean, or guess the local timezone.
  if (!Number.isSafeInteger(createdAt)) return null;
  try {
    const date = new Date(createdAt * 1000);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
    shanghaiFormatter ??= new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', calendar: 'gregory', numberingSystem: 'latn',
      month: '2-digit', day: '2-digit',
    });
    const parts = shanghaiFormatter.formatToParts(date);
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return /^\d{2}$/.test(month) && /^\d{2}$/.test(day) ? month + day : null;
  } catch {
    // Incomplete ICU/timezone data must not silently generate a wrong date.
    return null;
  }
}

function projectFolder(cwd) {
  if (typeof cwd !== 'string') return '';
  // A backslash alone is legal in POSIX filenames. Infer Windows only from
  // an absolute drive path or UNC prefix, including slash-form UNC paths.
  const windows = /^[a-z]:[/\\]/i.test(cwd) || /^\\\\[^\\]+\\[^\\]+/.test(cwd) || /^\/\/[^/]+\/[^/]+/.test(cwd);
  return windows ? path.win32.basename(cwd.replace(/[/\\]+$/, '')) : path.posix.basename(cwd.replace(/\/+$/, ''));
}

export function isFormatted(title, mmdd, cwd) {
  if (typeof title !== 'string' || !mmdd) return false;
  const match = titlePattern.exec(title);
  if (!match || match[0] !== title || match[1] !== mmdd) return false;
  const topic = match[3];
  if (topic !== topic.trim() || Array.from(topic).length > 18) return false;
  const folder = projectFolder(cwd).toLowerCase();
  const aliases = new Set([folder, folder.replace(/-mixing$/i, '')]);
  return ![...aliases].some((alias) => alias && topic.toLowerCase().includes(alias));
}

function requireInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${label}; inventory was not started`);
  }
}

export async function collectTasks(request, { pageSize = 100, maxPages = 1000, maxTasks = 100000 } = {}) {
  requireInteger(pageSize, 1, 200, 'page size');
  requireInteger(maxPages, 2, 100000, 'page limit');
  requireInteger(maxTasks, 1, 1000000, 'task limit');
  if (typeof request !== 'function') throw new Error('A read-only request function is required');
  const tasks = new Map();
  let pageCount = 0;
  let examined = 0;
  for (const archived of [false, true]) {
    let cursor = null;
    const seenCursors = new Set();
    while (true) {
      if (pageCount >= maxPages) throw new Error('Pagination safety limit reached; inventory is incomplete');
      const params = {
        limit: pageSize, sortKey: 'created_at', sortDirection: 'desc',
        modelProviders: [], sourceKinds: [...SOURCE_KINDS], archived, useStateDbOnly: true,
      };
      if (cursor !== null) params.cursor = cursor;
      let page;
      try { page = await request('thread/list', params); }
      catch { throw new Error('Read-only task listing failed; inventory is incomplete'); }
      pageCount += 1;
      if (!page || typeof page !== 'object' || !Array.isArray(page.data)
          || !Object.hasOwn(page, 'nextCursor') || page.data.length > pageSize) {
        throw new Error('Invalid thread/list response; inventory is incomplete');
      }
      examined += page.data.length;
      // Bound all returned rows, including duplicates and excluded subagents.
      if (examined > maxTasks) throw new Error('Task safety limit reached; inventory is incomplete');
      for (const thread of page.data) {
        if (!thread || typeof thread !== 'object' || typeof thread.id !== 'string' || !thread.id) {
          throw new Error('Invalid task identity; inventory is incomplete');
        }
        if (thread.ephemeral || thread.parentThreadId || thread.agentRole || thread.agentNickname
            || thread.source === 'subAgent'
            || (thread.source && typeof thread.source === 'object' && Object.hasOwn(thread.source, 'subAgent'))) continue;
        if (typeof thread.source !== 'string' || !SOURCE_KINDS.includes(thread.source)) {
          throw new Error('Unrecognized task source; check CLI compatibility (inventory is incomplete)');
        }
        if ((thread.name !== undefined && thread.name !== null && typeof thread.name !== 'string')
            || (thread.cwd !== undefined && thread.cwd !== null && typeof thread.cwd !== 'string')) {
          throw new Error('Invalid task metadata; check CLI compatibility (inventory is incomplete)');
        }
        const mmdd = shanghaiMmdd(thread.createdAt);
        const row = {
          id: thread.id, title: thread.name ?? null, createdAt: thread.createdAt ?? null,
          mmdd, cwd: thread.cwd ?? null, archived,
          formatted: isFormatted(thread.name, mmdd, thread.cwd),
        };
        const previous = tasks.get(row.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(row)) {
          throw new Error('Task changed during pagination; rerun the read-only inventory');
        }
        tasks.set(row.id, row);
      }
      cursor = page.nextCursor;
      if (cursor === null) break;
      if (typeof cursor !== 'string' || !cursor || cursor.length > 16384 || seenCursors.has(cursor)) {
        throw new Error('Invalid or repeated pagination cursor; inventory is incomplete');
      }
      seenCursors.add(cursor);
    }
  }
  const rows = [...tasks.values()].sort((a, b) => {
    const left = Number.isSafeInteger(a.createdAt) ? a.createdAt : 0;
    const right = Number.isSafeInteger(b.createdAt) ? b.createdAt : 0;
    return right - left || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });
  return {
    complete: true, scope: 'local-indexed-codex', pages: pageCount,
    total: rows.length, archived: rows.filter((row) => row.archived).length,
    needsReview: rows.filter((row) => !row.formatted).length, tasks: rows,
  };
}
