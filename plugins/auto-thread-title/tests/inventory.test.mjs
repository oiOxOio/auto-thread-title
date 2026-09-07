import assert from 'node:assert/strict';
import test from 'node:test';
import { collectTasks, isFormatted, shanghaiMmdd, TYPES, SOURCE_KINDS } from '../src/inventory.mjs';

const CREATED = Date.parse('2026-09-03T16:00:00Z') / 1000;
const task = (id = 'task-1', changes = {}) => ({ id, name: '待整理标题', createdAt: CREATED,
  updatedAt: CREATED + 86400, cwd: 'S:\\project\\sample-mixing', source: 'vscode', ephemeral: false, ...changes });
function pagedRequest(active, archived) {
  const calls = [];
  return { calls, request: async (method, params) => {
    calls.push({ method, params: structuredClone(params) });
    const rows = params.archived ? archived : active;
    const start = Number(params.cursor ?? 0);
    const end = start + params.limit;
    return { data: structuredClone(rows.slice(start, end)), nextCursor: end < rows.length ? String(end) : null };
  } };
}

test('Shanghai midnight uses creation time and safely rejects invalid timestamps', async () => {
  assert.equal(shanghaiMmdd(CREATED - 1), '0903');
  assert.equal(shanghaiMmdd(CREATED), '0904');
  for (const value of [null, undefined, true, '2026-09-04', 1.5, NaN, Infinity, 1e30, 1e12, Number.MAX_SAFE_INTEGER]) {
    assert.equal(shanghaiMmdd(value), null);
  }
  assert.equal(shanghaiMmdd(0), '0101');
  // Shanghai observed DST during summer 1991: UTC+8 fallback would be wrong.
  assert.equal(shanghaiMmdd(Date.parse('1991-06-01T15:30:00Z') / 1000), '0602');
  const result = await collectTasks(pagedRequest([task()], []).request);
  assert.equal(result.tasks[0].mmdd, '0904');
});

test('title policy preserves exact ASCII template, kind whitelist and codepoint length', () => {
  for (const kind of TYPES) assert.equal(isFormatted(`0904 | ${kind} | 批次文字显示`, '0904', '/sample'), true);
  const invalid = ['0904｜优化｜批次文字显示', '0904·优化·批次文字显示', '0904 | 分析 | 批次文字显示',
    '0903 | 优化 | 批次文字显示', '0904|优化|批次文字显示', '0904 | 优化 |  文字',
    '0904 | 优化 | 文字 ', '0904 | 优化 | 主题|额外', `0904 | 优化 | ${'字'.repeat(19)}`,
    '0904 | 优化 | 文字\n', '0904 | 优化 | \n', null];
  for (const title of invalid) assert.equal(isFormatted(title, '0904', '/sample'), false, String(title));
  assert.equal(isFormatted(`0904 | 优化 | ${'😀'.repeat(18)}`, '0904', '/sample'), true);
  assert.equal(isFormatted(`0904 | 优化 | ${'😀'.repeat(19)}`, '0904', '/sample'), false);
});

test('project aliases follow the source path dialect without splitting POSIX backslashes', () => {
  for (const cwd of ['S:\\sample-mixing\\', 'S:/sample-mixing/', '\\\\server\\share\\sample-mixing', '//server/share/sample-mixing/', '/Users/alice/sample-mixing/']) {
    for (const topic of ['sample管理页', 'SAMPLE-MIXING管理页']) assert.equal(isFormatted(`0904 | 功能 | ${topic}`, '0904', cwd), false);
  }
  assert.equal(isFormatted('0904 | 功能 | outside管理页', '0904', '/Users/alice/project\\outside'), true);
  assert.equal(isFormatted('0904 | 功能 | 中文 空格管理', '0904', '/Users/alice/中文 空格'), false);
  assert.equal(isFormatted('0904 | 功能 | 管理页面', '0904', undefined), true);
});

test('both archive states are cursor-complete beyond the recent fifty', async () => {
  const active = Array.from({ length: 123 }, (_, i) => task(`active-${i}`));
  const archived = Array.from({ length: 88 }, (_, i) => task(`archived-${i}`));
  const original = structuredClone([active, archived]);
  const { request, calls } = pagedRequest(active, archived);
  const result = await collectTasks(request, { pageSize: 20 });
  assert.deepEqual([result.complete, result.total, result.archived, result.pages], [true, 211, 88, 12]);
  assert.deepEqual([active, archived], original);
  for (const { method, params } of calls) {
    assert.equal(method, 'thread/list'); assert.equal(params.useStateDbOnly, true);
    assert.deepEqual(params.modelProviders, []); assert.deepEqual(params.sourceKinds, SOURCE_KINDS);
    assert.equal(params.sortKey, 'created_at'); assert.equal(Object.hasOwn(params, 'cwd'), false);
    assert.equal(Object.hasOwn(params, 'isPinned'), false); assert.equal(params.sourceKinds.includes('subAgent'), false);
  }
});

test('ephemeral/subagent tasks are excluded and preview is never used as title or emitted', async () => {
  const rows = [task('normal', { name: null, preview: 'private instructions' }), task('temporary', { ephemeral: true }),
    task('child', { parentThreadId: 'normal' }), task('role', { agentRole: 'review' }),
    task('agent', { source: { subAgent: 'review' } }), task('nickname', { agentNickname: 'test' })];
  const result = await collectTasks(pagedRequest(rows, []).request);
  assert.deepEqual(result.tasks.map((row) => row.id), ['normal']);
  assert.equal(result.tasks[0].title, null); assert.equal(result.tasks[0].formatted, false);
  assert.equal(Object.hasOwn(result.tasks[0], 'preview'), false); assert.equal(Object.hasOwn(result.tasks[0], 'updatedAt'), false);
  assert.equal(JSON.stringify(result).includes('private instructions'), false);
});

test('duplicates deduplicate, conflicts and archive-state changes stop', async () => {
  assert.equal((await collectTasks(pagedRequest([task(), task()], []).request, { pageSize: 1 })).total, 1);
  await assert.rejects(collectTasks(pagedRequest([task(), task('task-1', { name: 'changed' })], []).request, { pageSize: 1 }), /changed during pagination/);
  await assert.rejects(collectTasks(pagedRequest([task()], [task()]).request), /changed during pagination/);
});

test('malformed pages, cursors, late failures and safety caps fail without partial output', async () => {
  for (const page of [null, {}, { data: [], nextCursor: 3 }, { data: [{}], nextCursor: null }]) {
    await assert.rejects(collectTasks(async () => page));
  }
  await assert.rejects(collectTasks(async () => ({ data: [], nextCursor: 'same' })), /repeated/);
  await assert.rejects(collectTasks(async (_, params) => {
    if (params.cursor) throw new Error('private remote payload');
    return { data: [task()], nextCursor: 'next' };
  }), (error) => /incomplete/.test(error.message) && !error.message.includes('private'));
  await assert.rejects(collectTasks(pagedRequest([task('1'), task('2')], []).request, { pageSize: 1, maxPages: 2 }), /Pagination safety limit/);
  await assert.rejects(collectTasks(pagedRequest([task('1'), task('2')], []).request, { maxTasks: 1 }), /Task safety limit/);
  await assert.rejects(collectTasks(async () => ({ data: [task('1'), task('2')], nextCursor: null }), { pageSize: 1 }), /Invalid thread\/list/);
  for (const options of [{ pageSize: 0 }, { pageSize: 201 }, { maxPages: 0 }, { maxTasks: -1 }]) await assert.rejects(collectTasks(async () => {}, options));
});

test('invalid creation dates are retained for explicit skip and never replaced with update time', async () => {
  const result = await collectTasks(pagedRequest([task('valid'), task('missing', { createdAt: null }), task('string', { createdAt: 'bad' })], []).request);
  assert.equal(result.total, 3); assert.equal(result.tasks.filter((row) => row.mmdd === null).length, 2);
});

test('unknown/missing sources and incompatible title/path metadata fail closed', async () => {
  for (const changes of [{ source: undefined }, { source: 'future-source' }, { source: { other: 'value' } }, { name: {} }, { cwd: [] }]) {
    await assert.rejects(collectTasks(pagedRequest([task('bad', changes)], []).request), /incomplete/);
  }
  assert.equal((await collectTasks(pagedRequest([task('subagent', { source: 'subAgent' })], []).request)).total, 0);
});
