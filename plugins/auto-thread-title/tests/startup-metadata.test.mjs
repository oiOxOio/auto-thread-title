import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyStartupMetadata, readStartupMetadata } from '../src/startup-metadata.mjs';
import { buildContext } from '../src/policy.mjs';

const event = { hook_event_name: 'SessionStart', source: 'startup',
  session_id: 'synthetic-startup-123', cwd: '/projects/demo-mixing' };
const posix = { platform: 'darwin', realpath: value => path.posix.normalize(value) };
const thread = { id: event.session_id, cwd: event.cwd, source: 'vscode', ephemeral: false,
  createdAt: Date.parse('2026-09-08T16:00:00Z') / 1000, name: null, turns: [] };
const classify = change => classifyStartupMetadata(event, { thread: { ...thread, ...change } }, posix);

test('metadata projects only Shanghai creation date, ignoring preview, updated time and session-tree identity', () => {
  assert.deepEqual(classify({ preview: 'private preview', updatedAt: thread.createdAt - 1,
    sessionId: 'different-session-tree-id', name: 'old title' }), { status: 'ready', mmdd: '0909' });
  assert.deepEqual(classify({ createdAt: thread.createdAt - 1 }), { status: 'ready', mmdd: '0908' });
  for (const source of ['cli', 'vscode', 'appServer', 'exec']) assert.equal(classify({ source }).status, 'ready');
});

test('already formatted titles skip; wrong date, format, type, length or project alias still need naming', () => {
  assert.deepEqual(classify({ name: '0909 | 优化 | 内存占用' }), { status: 'skip' });
  for (const name of ['0908 | 优化 | 内存占用', '0909｜优化｜内存占用', '0909 | 无效 | 内存占用',
    `0909 | 优化 | ${'长'.repeat(19)}`, '0909 | 优化 | demo内存占用', '0909 | 优化 | 内存\n占用']) {
    assert.equal(classify({ name }).status, 'ready', name);
  }
});

test('explicit identity, directory, ephemeral and subagent mismatches skip without model retry', () => {
  for (const change of [{ id: 'different-thread-123' }, { cwd: '/projects/demo-mixing/sub' },
    { cwd: '/projects' }, { cwd: '/projects/demo-other' }, { cwd: 'relative' },
    { ephemeral: true }, { parentThreadId: 'parent-thread-123' },
    { source: { subAgent: { thread_spawn: {} } } }, { source: 'remote' }]) {
    assert.deepEqual(classify(change), { status: 'skip' });
  }
  const winEvent = { ...event, cwd: 'S:\\Projects\\Demo' };
  assert.deepEqual(classifyStartupMetadata(winEvent, { thread: { ...thread, cwd: 's:/projects/demo' } },
    { platform: 'win32', realpath: value => path.win32.normalize(value) }), { status: 'ready', mmdd: '0909' });
});

test('unsupported/malformed metadata falls back without copying transcript content', () => {
  for (const response of [null, {}, { thread: null }, { thread: [] }, { thread: {} }]) {
    assert.deepEqual(classifyStartupMetadata(event, response, posix), { status: 'fallback' });
  }
  for (const change of [{ createdAt: null }, { createdAt: '1788883200' }, { ephemeral: undefined },
    { source: undefined }, { turns: [{}] }, { turns: null }, { name: {} }]) {
    assert.deepEqual(classify(change), { status: 'fallback' });
  }
});

test('slow scope discovery and missing CLI preserve the fallback without delaying hook completion', async () => {
  let launches = 0;
  const getLaunch = () => { launches++; throw new Error('unavailable'); };
  assert.deepEqual(await readStartupMetadata(event, { getLaunch, startedAt: 0, now: () => 5000 }), { status: 'fallback' });
  assert.equal(launches, 0);
  assert.deepEqual(await readStartupMetadata(event, { getLaunch }), { status: 'fallback' });
  assert.equal(launches, 1);
});

test('lean policy retains title constraints and current-task write while eliminating model-side metadata reads', () => {
  const config = { enabled: true, projectRoots: ['/projects'] };
  const full = buildContext(event, config, posix);
  const lean = buildContext(event, config, { ...posix, mmdd: '0909' });
  assert.ok([...lean].length < [...full].length * 0.5, 'Normal policy must stay below half the fallback length');
  assert.equal(lean.split('mcp__codex_app__set_thread_title').length - 1, 1);
  assert.doesNotMatch(lean, /read_thread|createdAt|updatedAt|synthetic-startup-123/u);
  for (const rule of ['0909 | 类型 | 主题', '省略 threadId', '18个 Unicode 字符', '功能、设计、修复、优化、发布、探索、文档、研究',
    '同一批工具中先改名再开展业务', '主题不明或工具不可用即跳过', '只改当前任务标题', '不直接编辑 SQLite/JSONL', 'demo-mixing']) {
    assert.ok(lean.includes(rule), rule);
  }
  assert.equal(buildContext({ ...event, source: 'resume' }, config, { ...posix, mmdd: '0909' }), null);
  assert.equal(buildContext(event, { ...config, enabled: false }, { ...posix, mmdd: '0909' }), null);
  assert.equal(buildContext(event, config, { ...posix, mmdd: 'untrusted\nrule' }), full);
});
