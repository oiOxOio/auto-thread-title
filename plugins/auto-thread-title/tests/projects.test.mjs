import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { discoverProjectRoots, matchesSavedProject, resolveGitExecutable } from '../src/projects.mjs';

const exec = promisify(execFile);
const registry = roots => ({ 'local-projects': Object.fromEntries(roots.map((rootPaths, i) => [`local-${i}`, { id: `local-${i}`, rootPaths, name: 'private-unused-name' }])) });
const noLaunch = () => { throw new Error('Unexpected CLI launch'); };
const fixture = fileURLToPath(new URL('./fixtures/fake-project-codex.mjs', import.meta.url));
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'title-projects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const windows = { platform: 'win32', home: 'C:\\Users\\Example', env: {} };
const mac = { platform: 'darwin', home: '/Users/example', env: {} };

test('current native Codex home selects Windows and macOS registry independently of title config', async () => {
  for (const options of [windows, mac]) {
    const api = options.platform === 'win32' ? path.win32 : path.posix;
    const root = api.join(options.home, 'projects', 'alpha');
    let filename;
    const result = await discoverProjectRoots({ ...options, env: { AUTO_THREAD_TITLE_CONFIG: '/irrelevant/config.json' },
      getLaunch: noLaunch, readRegistry: async file => { filename = file; return registry([[root]]); } });
    assert.equal(filename, api.join(options.home, '.codex', '.codex-global-state.json'));
    assert.deepEqual(result, { roots: [root], projectCount: 1, source: 'local-projects' });
    const override = api.join(options.home, 'codex-alt');
    await discoverProjectRoots({ ...options, env: { CODEX_HOME: override }, getLaunch: noLaunch,
      readRegistry: async file => { assert.equal(file, api.join(override, '.codex-global-state.json')); return registry([]); } });
  }
});

test('multi-root registration is fresh on every read and never uses stale workspace fields', async t => {
  const directory = await temporary(t);
  const filename = path.join(directory, '.codex-global-state.json');
  const first = path.join(directory, 'first');
  const second = path.join(directory, 'second');
  const options = { env: { CODEX_HOME: directory }, getLaunch: noLaunch };
  const save = state => writeFile(filename, JSON.stringify({ 'electron-saved-workspace-roots': [path.join(directory, 'stale')], ...state }));
  await save(registry([[first, second], [second]]));
  assert.deepEqual(await discoverProjectRoots(options), { roots: [first, second], projectCount: 2, source: 'local-projects' });
  await save(registry([[second]]));
  assert.deepEqual((await discoverProjectRoots(options)).roots, [second]);
  await save(registry([]));
  assert.deepEqual((await discoverProjectRoots(options)).roots, []);
});

test('valid empty project registry is authoritative and missing registry alone permits fallback', async () => {
  assert.deepEqual(await discoverProjectRoots({ ...mac, getLaunch: noLaunch, readRegistry: async () => registry([]) }),
    { roots: [], projectCount: 0, source: 'local-projects' });
  for (const state of [undefined, { 'electron-saved-workspace-roots': ['/stale'] }]) {
    let launches = 0;
    const result = await discoverProjectRoots({ ...mac, readRegistry: async () => state, getLaunch: () => { launches++; return 'launch'; },
      withServer: async (launch, callback, options) => {
        assert.equal(launch, 'launch');
        assert.equal(options.purpose, 'projects');
        assert.equal(options.env.CODEX_HOME, '/Users/example/.codex');
        return callback(async () => ({ data: [], nextCursor: null }));
      } });
    assert.equal(launches, 1);
    assert.deepEqual(result, { roots: [], projectCount: 0, source: 'project/list' });
  }
});

test('migrated current host uses RPC and never falls back to legacy project roots', async () => {
  const state = { ...registry([['/stale']]), 'app-server-projects-migration-by-host': {
    'local:/Users/example/.codex': { projectsMigrated: true },
    'local:/Users/other/.codex': { projectsMigrated: false },
  } };
  const options = { ...mac, readRegistry: async () => state, getLaunch: () => 'launch' };
  assert.deepEqual(await discoverProjectRoots({ ...options,
    withServer: async (_launch, callback) => callback(async () => ({ data: [{ id: 'current', roots: [{ path: '/current' }] }], nextCursor: null })),
  }), { roots: ['/current'], projectCount: 1, source: 'project/list' });
  await assert.rejects(discoverProjectRoots({ ...options, withServer: async () => { throw new Error('private-runtime-error'); } }),
    error => !error.message.includes('private-runtime-error') && /could not be listed/.test(error.message));
  state['app-server-projects-migration-by-host']['local:/Users/example/.codex'].projectsMigrated = false;
  assert.equal((await discoverProjectRoots({ ...options, getLaunch: noLaunch })).source, 'local-projects');
});

test('malformed, oversized, inaccessible and foreign-platform registry values fail closed', async t => {
  const malformed = [null, [], { 'local-projects': [] }, { 'local-projects': null }, registry([['relative/path']]),
    registry([['C:\\foreign\\root']]), registry([['/bad\nroot']]), { 'local-projects': { wrong: { id: 'different', rootPaths: ['/root'] } } },
    { 'app-server-projects-migration-by-host': [] }, { 'app-server-projects-migration-by-host': { 'local:/Users/example/.codex': { projectsMigrated: 'yes' } } }];
  for (const state of malformed) {
    await assert.rejects(discoverProjectRoots({ ...mac, readRegistry: async () => state, getLaunch: noLaunch }), /valid current-host/);
  }
  await assert.rejects(discoverProjectRoots({ ...mac, readRegistry: async () => { throw new Error('private EACCES'); }, getLaunch: noLaunch }),
    error => !error.message.includes('private') && /valid current-host/.test(error.message));
  const directory = await temporary(t);
  const filename = path.join(directory, '.codex-global-state.json');
  const options = { env: { CODEX_HOME: directory }, getLaunch: noLaunch };
  for (const contents of ['{', ' '.repeat(16 * 1024 * 1024 + 1)]) {
    await writeFile(filename, contents);
    await assert.rejects(discoverProjectRoots(options), /valid current-host/);
  }
});

test('RPC pagination keeps every root, bounds requests and rejects repeated conflicting records', async () => {
  let calls = 0;
  const result = await discoverProjectRoots({ ...mac, readRegistry: async () => undefined, getLaunch: () => 'launch',
    withServer: async (_launch, callback) => callback(async (method, params) => {
      calls++;
      assert.equal(method, 'project/list');
      assert.deepEqual(params, calls === 1 ? { limit: 100 } : { limit: 100, cursor: 'next' });
      return calls === 1
        ? { data: [{ id: 'a', roots: [{ path: '/one' }, { path: '/two' }], name: 'private' }], nextCursor: 'next' }
        : { data: [{ id: 'a', roots: [{ path: '/two' }, { path: '/one' }] }, { id: 'b', roots: [{ path: '/three' }] }], nextCursor: null };
    }),
  });
  assert.deepEqual(result, { roots: ['/one', '/two', '/three'], projectCount: 2, source: 'project/list' });
  assert.equal(JSON.stringify(result).includes('private'), false);
  for (const scenario of ['cursor', 'conflict', 'foreign', 'missing-cursor', 'too-many-pages']) {
    let page = 0;
    await assert.rejects(discoverProjectRoots({ ...mac, readRegistry: async () => undefined, getLaunch: () => 'launch',
      withServer: async (_launch, callback) => callback(async () => {
        page++;
        if (scenario === 'missing-cursor') return { data: [] };
        return { data: [{ id: 'a', roots: [{ path: scenario === 'foreign' ? 'C:\\root' : scenario === 'conflict' ? `/root${page}` : '/root' }] }],
          nextCursor: scenario === 'cursor' ? 'repeat' : scenario === 'too-many-pages' ? `page${page}` : page === 1 ? 'next' : null };
      }),
    }), /could not be listed/);
    assert.ok(page <= 100);
  }
});

test('real project RPC fixture discovers all pages without schema generation and bounds timeouts', async t => {
  const directory = await temporary(t);
  const audit = path.join(directory, 'rpc-audit.jsonl');
  const base = { env: { ...process.env, CODEX_HOME: directory }, getLaunch: () => ({ file: process.execPath,
    args: [fixture, '--scenario', 'pagination', '--audit', audit] }) };
  const result = await discoverProjectRoots(base);
  assert.equal(result.projectCount, 2);
  assert.equal(result.source, 'project/list');
  assert.equal(result.roots.length, 1);
  assert.deepEqual((await readFile(audit, 'utf8')).trim().split('\n').map(line => JSON.parse(line).method),
    ['initialize', 'initialized', 'project/list', 'project/list']);
  await assert.rejects(discoverProjectRoots({ ...base, timeoutMs: 400, getLaunch: () => ({ file: process.execPath,
    args: [fixture, '--scenario', 'timeout'] }) }), /could not be listed/);
});

test('realpath matching supports linked project entries and native case rules without Git', async () => {
  for (const options of [windows, mac]) {
    const api = options.platform === 'win32' ? path.win32 : path.posix;
    const cwd = api.join(options.home, 'physical', 'sub');
    const root = api.join(options.home, 'alias');
    const physical = api.join(options.home, 'physical');
    assert.equal(await matchesSavedProject(cwd, [root], { ...options, stat: () => ({ isDirectory: () => true }),
      realpath: value => value === root ? physical : value, runGit: noLaunch }), true);
    assert.equal(await matchesSavedProject(`${physical}-other`, [root], { ...options, stat: () => ({ isDirectory: () => true }),
      realpath: value => value === root ? physical : value, runGit: async () => { throw new Error('not git'); } }), false);
  }
});

test('synthetic worktree matching requires both current membership and a saved root in the same repo', async () => {
  const options = { ...mac, stat: () => ({ isDirectory: () => true }), realpath: value => value };
  const output = '/repo/main /codex/worktrees/feature'.split(' ').map(root => `worktree ${root}\0HEAD abc\0\0`).join('');
  assert.equal(await matchesSavedProject('/codex/worktrees/feature/sub', ['/repo/main'], { ...options, runGit: async () => output }), true);
  assert.equal(await matchesSavedProject('/other/repo', ['/repo/main'], { ...options, runGit: async () => output }), false);
  assert.equal(await matchesSavedProject('/codex/worktrees/feature', ['/unrelated'], { ...options, runGit: async () => output }), false);
  assert.equal(await matchesSavedProject('/codex/worktrees/feature', ['/repo/main/sub'], { ...options, runGit: async () => output }), false);
  assert.equal(await matchesSavedProject('/codex/worktrees/feature', ['/repo/main'], { ...options,
    stat: value => { if (value === '/removed') throw new Error('ENOENT'); return { isDirectory: () => true }; },
    runGit: async () => `worktree /removed\0prunable gitdir file points to non-existent location\0\0${output}`,
  }), true);
  assert.equal(await matchesSavedProject('/missing', ['/repo/main'], { ...options,
    stat: () => { throw new Error('ENOENT'); }, runGit: noLaunch }), false);
  assert.equal(await matchesSavedProject('/repo/main', [], { ...options, runGit: noLaunch }), false);
  for (const stdout of ['worktree /repo/main', `worktree /repo/main\0worktree C:\\foreign\0\0`, 'a'.repeat(256 * 1024 + 1)]) {
    assert.equal(await matchesSavedProject('/other/repo', ['/repo/main'], { ...options, runGit: async () => stdout }), false);
  }
});

test('real Git worktree is included only for its saved repository and ignores redirected Git environment', async t => {
  try { await exec('git', ['--version'], { windowsHide: true }); }
  catch { t.skip('Git is not installed'); return; }
  const directory = await temporary(t);
  const saved = path.join(directory, 'saved');
  const worktree = path.join(directory, 'worktree');
  const unrelated = path.join(directory, 'unrelated');
  await mkdir(saved);
  await mkdir(unrelated);
  await exec('git', ['init', saved], { windowsHide: true });
  await exec('git', ['-C', saved, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture'], { windowsHide: true });
  await exec('git', ['-C', saved, 'worktree', 'add', '--detach', worktree], { windowsHide: true });
  await exec('git', ['init', unrelated], { windowsHide: true });
  assert.equal(await matchesSavedProject(worktree, [saved]), true);
  assert.equal(await matchesSavedProject(unrelated, [saved]), false);
  assert.equal(await matchesSavedProject(unrelated, [saved], { env: { ...process.env, GIT_DIR: path.join(saved, '.git'), GIT_WORK_TREE: worktree } }), false);
  assert.equal(await matchesSavedProject(worktree, [unrelated]), false);
});

test('saved monorepo subfolders map to the same worktree subfolder without admitting siblings', async () => {
  for (const platform of ['win32', 'darwin']) {
    const api = platform === 'win32' ? path.win32 : path.posix;
    const source = platform === 'win32' ? 'C:\\repos\\main' : '/repos/main';
    const target = platform === 'win32' ? 'D:\\codex\\worktree' : '/codex/worktree';
    const saved = api.join(source, 'packages', 'app');
    const output = `worktree ${source}\0HEAD abc\0\0worktree ${target}\0HEAD def\0\0`;
    const options = { platform, stat: () => ({ isDirectory: () => true }), realpath: value => value, runGit: async () => output };
    assert.equal(await matchesSavedProject(api.join(target, 'packages', 'app', 'src'), [saved], options), true);
    assert.equal(await matchesSavedProject(api.join(target, 'packages', 'other'), [saved], options), false);
    assert.equal(await matchesSavedProject(target, [saved], options), false);
  }
});

test('Git resolution ignores cwd, relative PATH entries and Windows shell wrappers', async t => {
  const directory = await temporary(t), bin = path.join(directory, 'bin'), wrappers = path.join(directory, 'wrappers');
  await mkdir(bin); await mkdir(wrappers);
  const git = path.join(bin, process.platform === 'win32' ? 'git.exe' : 'git');
  await writeFile(git, 'synthetic executable never run', { mode: 0o700 });
  await writeFile(path.join(wrappers, 'git.cmd'), 'must never run');
  assert.throws(() => resolveGitExecutable({ env: { PATH: `.${path.delimiter}relative${path.delimiter}` } }));
  assert.throws(() => resolveGitExecutable({ env: { PATH: wrappers } }));
  const env = { PATH: `${path.delimiter}.${path.delimiter}relative${path.delimiter}${wrappers}${path.delimiter}${bin}` };
  assert.equal(resolveGitExecutable({ env }), realpathSync.native(git));
});
