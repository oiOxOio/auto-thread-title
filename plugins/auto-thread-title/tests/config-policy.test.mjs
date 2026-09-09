import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configPath, loadConfig, saveConfig, validateConfig, isWithin, nativeAbsolute } from '../src/config.mjs';
import { buildContext, projectAliases } from '../src/policy.mjs';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const config = { enabled: true, projectRoots: [], timezone: 'Asia/Shanghai', topicMaxLength: 18 };
const event = { hook_event_name: 'SessionStart', source: 'startup', session_id: 'synthetic-thread-123', cwd: '/Users/alice/project/app' };
const posix = { platform: 'darwin', home: '/Users/alice', realpath: value => path.posix.normalize(value) };

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'title config 测试 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('POSIX scope preserves native case, backslashes, spaces and directory boundaries', () => {
  for (const cwd of ['/Users/alice/project', '/Users/alice/project/app', '/Users/alice/project/中文 空格']) {
    assert.equal(isWithin(cwd, '/Users/alice/project', posix), true);
  }
  for (const cwd of ['/Users/alice/project-old/app', '/Users/alice/Project/app', '/Users/alice/project\\outside/app', '/Users/alice/project/../elsewhere', 'project/app']) {
    assert.equal(isWithin(cwd, '/Users/alice/project', posix), false, cwd);
  }
  assert.equal(isWithin(event.cwd, '~/project', posix), true);
  assert.equal(isWithin(event.cwd, 'S:\\project', posix), false);
  assert.equal(nativeAbsolute('relative/path', posix), null);
  assert.equal(nativeAbsolute('/Users/alice/project ', posix), '/Users/alice/project ');
});

test('Windows drive and UNC scope works independently of test host', () => {
  const options = { platform: 'win32', home: 'C:\\Users\\Alice', realpath: value => path.win32.normalize(value) };
  assert.equal(isWithin('s:/PROJECT/app', 'S:\\project', options), true);
  assert.equal(isWithin('S:\\project-old\\app', 'S:\\project', options), false);
  assert.equal(isWithin('T:\\project\\app', 'S:\\project', options), false);
  assert.equal(isWithin('\\\\server\\share\\root\\app', '\\\\server\\share\\root', options), true);
  assert.equal(nativeAbsolute('S:project', options), null);
  assert.equal(nativeAbsolute('\\project', options), null);
  assert.equal(nativeAbsolute('~\\project', options), 'C:\\Users\\Alice\\project');
});

test('realpath scope excludes symlink escape and accepts root aliases', t => {
  const root = temporary(t), project = path.join(root, 'project'), outside = path.join(root, 'outside');
  fs.mkdirSync(project); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(project, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(project, path.join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(isWithin(path.join(project, 'escape'), project), false);
  assert.equal(isWithin(project, path.join(root, 'alias')), true);
  assert.equal(isWithin(path.join(project, 'missing'), project), false);
});

test('project aliases recognize Windows history without corrupting native POSIX names', () => {
  assert.deepEqual(projectAliases('/Users/alice/MyProject-mixing/'), ['MyProject-mixing', 'MyProject']);
  assert.deepEqual(projectAliases('/Users/alice/My\\Project'), ['My\\Project']);
  assert.deepEqual(projectAliases('S:\\project\\MyProject-mixing'), ['MyProject-mixing', 'MyProject']);
});

test('automatic hook emits only for explicitly configured startup sessions', () => {
  const scoped = { ...config, projectRoots: ['~/project'] };
  assert.match(buildContext(event, scoped, posix), /synthetic-thread-123/);
  assert.equal(buildContext(event, config, posix), null);
  assert.equal(buildContext(event, { ...scoped, enabled: false }, posix), null);
  for (const source of ['resume', 'clear', 'compact', undefined]) assert.equal(buildContext({ ...event, source }, scoped, posix), null);
  for (const session_id of ['', 'bad\nid', 'x', null]) assert.equal(buildContext({ ...event, session_id }, scoped, posix), null);
  assert.equal(buildContext({ ...event, cwd: '/Users/alice/project-other' }, scoped, posix), null);
});

test('config rejects typo fields, dangerous ambiguity and inconsistent title policies', () => {
  for (const change of [{ enabled: 1 }, { projectRoots: ['relative'] }, { projectRoots: [null] },
    { projectRoots: ['/Users/alice\nRULES'] }, { projectRoots: 'all' }, { timezone: 'UTC' },
    { topicMaxLength: 30 }, { codexPath: 'codex' }, { scope: 'all' }, { unknown: true }]) {
    assert.throws(() => validateConfig({ ...config, ...change }));
  }
  assert.deepEqual(validateConfig(config), config);
});

test('user config path is stable across installed versions, respects existing Codex home', () => {
  assert.equal(configPath({ env: {}, home: '/Users/alice', platform: 'darwin' }), '/Users/alice/.codex/auto-thread-title/config.json');
  assert.equal(configPath({ env: { CODEX_HOME: '/data/codex' }, home: '/Users/alice', platform: 'darwin' }), '/data/codex/auto-thread-title/config.json');
  assert.equal(configPath({ env: { AUTO_THREAD_TITLE_CONFIG: '/config/title.json', PLUGIN_ROOT: '/cache/version2' }, platform: 'darwin' }), '/config/title.json');
  assert.throws(() => configPath({ env: { AUTO_THREAD_TITLE_CONFIG: 'relative.json' }, platform: 'darwin' }));
  assert.equal(configPath({ env: {}, home: 'C:\\Users\\Alice', platform: 'win32' }), 'C:\\Users\\Alice\\.codex\\auto-thread-title\\config.json');
});

test('config changes are explicit, BOM is accepted, invalid config is not silently ignored', t => {
  const root = temporary(t), filename = path.join(root, 'settings', 'config.json');
  const options = { env: { AUTO_THREAD_TITLE_CONFIG: filename } };
  assert.deepEqual(loadConfig(options).config.projectRoots, []);
  assert.equal(loadConfig(options).config.scope, 'projects');
  assert.equal(fs.existsSync(filename), false);
  saveConfig({ ...config, projectRoots: [root] }, options);
  assert.deepEqual(loadConfig(options).config.projectRoots, [root]);
  assert.deepEqual(fs.readdirSync(path.dirname(filename)), ['config.json']);
  fs.writeFileSync(filename, '\uFEFF' + JSON.stringify({ enabled: false }));
  assert.equal(loadConfig(options).config.enabled, false);
  fs.writeFileSync(filename, '{broken');
  assert.throws(() => loadConfig(options), /configuration/);
});

test('real Node CLI handles configured UTF8 BOM hook without invoking Codex', t => {
  const root = temporary(t), filename = path.join(root, 'config.json'), project = path.join(root, '项目');
  fs.mkdirSync(project);
  saveConfig({ ...config, projectRoots: [project] }, { env: { AUTO_THREAD_TITLE_CONFIG: filename } });
  const env = { ...process.env, AUTO_THREAD_TITLE_CONFIG: filename, AUTO_THREAD_TITLE_CODEX: path.join(root, 'MUST-NOT-RUN') };
  const before = fs.readFileSync(filename, 'utf8');
  const run = input => spawnSync(process.execPath, [CLI, 'hook'], { env, input, encoding: 'utf8', timeout: 5000 });
  const result = run('\uFEFF' + JSON.stringify({ ...event, cwd: project }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(run('{invalid').stdout, '');
  assert.equal(run(JSON.stringify({ ...event, cwd: root })).stdout, '');
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
});

test('configure validates roots and only writes designated user config', t => {
  const root = temporary(t), filename = path.join(root, 'config.json');
  const env = { ...process.env, AUTO_THREAD_TITLE_CONFIG: filename };
  const run = args => spawnSync(process.execPath, [CLI, 'configure', ...args], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(run(['--project-root', 'relative']).status, 1);
  assert.equal(fs.existsSync(filename), false);
  assert.equal(run(['--project-root', root]).status, 0);
  assert.deepEqual(loadConfig({ env }).config.projectRoots, [fs.realpathSync.native(root)]);
  assert.equal(run(['--disable']).status, 0);
  assert.equal(loadConfig({ env }).config.enabled, false);
  assert.equal(run(['--disable', '--enable']).status, 1);
});

test('adding roots preserves inaccessible/other-OS roots and disabled state', t => {
  const root = temporary(t), filename = path.join(root, 'config.json');
  const env = { ...process.env, AUTO_THREAD_TITLE_CONFIG: filename };
  const original = { ...config, enabled: false, projectRoots: ['S:\\offline-projects', '/Volumes/offline/projects'] };
  saveConfig(original, { env });
  const result = spawnSync(process.execPath, [CLI, 'configure', '--add-project-root', root], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(loadConfig({ env }).config, { ...original, scope: 'manual', projectRoots: [...original.projectRoots, fs.realpathSync.native(root)] });
  const ambiguous = spawnSync(process.execPath, [CLI, 'configure', '--project-root', root, '--add-project-root', root], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(ambiguous.status, 1);
});

test('legacy custom ranges including empty ranges preserve the manual scope and disabled state', t => {
  const root = temporary(t), filename = path.join(root, 'config.json');
  for (const projectRoots of [[], [root]]) {
    fs.writeFileSync(filename, JSON.stringify({ enabled: false, projectRoots }));
    const loaded = loadConfig({ env: { AUTO_THREAD_TITLE_CONFIG: filename } }).config;
    assert.equal(loaded.scope, 'manual');
    assert.equal(loaded.enabled, false);
    assert.deepEqual(loaded.projectRoots, projectRoots);
  }
  fs.writeFileSync(filename, JSON.stringify({ enabled: false }));
  assert.equal(loadConfig({ env: { AUTO_THREAD_TITLE_CONFIG: filename } }).config.scope, 'projects');
  assert.equal(loadConfig({ env: { AUTO_THREAD_TITLE_CONFIG: filename } }).config.enabled, false);
});

test('scope switches preserve stored roots and require an explicit enable', t => {
  const root = temporary(t), filename = path.join(root, 'config.json');
  const env = { ...process.env, AUTO_THREAD_TITLE_CONFIG: filename, CODEX_HOME: root };
  const run = args => spawnSync(process.execPath, [CLI, 'configure', ...args], { env, encoding: 'utf8', timeout: 5000 });
  fs.writeFileSync(filename, JSON.stringify({ enabled: false, projectRoots: [root] }));
  assert.equal(run(['--scope', 'projects']).status, 0);
  assert.equal(loadConfig({ env }).config.enabled, false);
  assert.equal(loadConfig({ env }).config.scope, 'projects');
  assert.deepEqual(loadConfig({ env }).config.projectRoots, [root]);
  assert.equal(run(['--scope', 'projects', '--enable']).status, 0);
  assert.equal(loadConfig({ env }).config.enabled, true);
  assert.equal(run(['--add-project-root', root]).status, 0);
  assert.equal(loadConfig({ env }).config.scope, 'manual');
  const before = fs.readFileSync(filename, 'utf8');
  for (const args of [['--scope', 'all'], ['--scope', 'projects', '--project-root', root], ['--scope', 'projects', '--add-project-root', root]]) {
    assert.equal(run(args).status, 1);
    assert.equal(fs.readFileSync(filename, 'utf8'), before);
  }
});
