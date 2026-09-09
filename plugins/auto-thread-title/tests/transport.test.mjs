import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { collectTasks, SOURCE_KINDS } from '../src/inventory.mjs';
import { probeCapabilities, resolveCodex, withAppServer } from '../src/transport.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const launch = (scenario = 'normal', args = []) => ({ file: process.execPath, args: [fixture, '--scenario', scenario, ...args] });
const params = () => ({ limit: 1, sortKey: 'created_at', sortDirection: 'desc', modelProviders: [],
  sourceKinds: [...SOURCE_KINDS], archived: false, useStateDbOnly: true });
async function temporary(testContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'auto-thread-title-test-'));
  testContext.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function executable(file) { await writeFile(file, 'synthetic-placeholder'); await chmod(file, 0o755); }
async function assertNodeScriptLaunch(spec, script) {
  // Windows sync/native realpath APIs may choose equivalent DOS 8.3 and long
  // spellings. Compare both sides through the same native canonicalization,
  // while still requiring the current Node and exactly one script argument.
  assert.equal(spec.args.length, 1);
  assert.equal(await realpath(spec.file), await realpath(process.execPath));
  assert.equal(await realpath(spec.args[0]), await realpath(script));
}
async function audited(testContext, scenario = 'normal') {
  const directory = await temporary(testContext);
  const audit = path.join(directory, 'audit.jsonl');
  const pidFile = path.join(directory, 'pid.txt');
  return { spec: launch(scenario, ['--audit', audit, '--pid-file', pidFile]),
    readAudit: async () => (await readFile(audit, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)),
    assertStopped: async () => {
      const pid = Number(await readFile(pidFile, 'utf8'));
      assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
    } };
}

test('explicit nonexistent CLI overrides fail instead of silently falling back', () => {
  assert.throws(() => resolveCodex({ executable: '/nonexistent/fake-codex', env: { PATH: path.dirname(process.execPath) } }), /no fallback/);
  assert.throws(() => resolveCodex({ env: { AUTO_THREAD_TITLE_CODEX: '/nonexistent/fake-codex', PATH: path.dirname(process.execPath) } }), /no fallback/);
  assert.throws(() => resolveCodex({ executable: '' }), /Invalid/);
});

test('CLI lookup uses argument arrays and ignores relative/empty PATH entries', async (t) => {
  const directory = await temporary(t);
  const binary = path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
  await executable(binary);
  const separator = process.platform === 'win32' ? ';' : ':';
  const found = resolveCodex({ env: { PATH: `.${separator}${separator}${directory}` } });
  assert.deepEqual(found, { file: binary, args: [] });
  const spaced = path.join(directory, 'CLI with space');
  await executable(spaced);
  assert.deepEqual(resolveCodex({ executable: spaced }), { file: spaced, args: [] });
});

test('Windows official npm wrapper launches JavaScript through Node, never a shell', async (t) => {
  const directory = await temporary(t);
  const wrapper = path.join(directory, 'codex.cmd');
  await executable(wrapper);
  await assert.rejects(Promise.resolve().then(() => resolveCodex({ executable: wrapper, platform: 'win32' })), /Unsupported Windows/);
  const script = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(script, '// synthetic npm entry');
  await assertNodeScriptLaunch(resolveCodex({ executable: wrapper, platform: 'win32' }), script);
  await assertNodeScriptLaunch(resolveCodex({ env: { Path: directory }, platform: 'win32' }), script);
});

test('explicit JavaScript entry points use Node without requiring executable permissions', async (t) => {
  const directory = await temporary(t);
  for (const extension of ['js', 'mjs', 'cjs']) {
    const script = path.join(directory, `codex.${extension}`);
    await writeFile(script, '// synthetic entry');
    for (const platform of ['win32', 'darwin', 'linux']) {
      await assertNodeScriptLaunch(resolveCodex({ executable: script, platform }), script);
    }
  }
});

test('POSIX extensionless npm symlinks use resolved JavaScript and work when PATH has no node', { skip: process.platform === 'win32' }, async (t) => {
  const directory = await temporary(t);
  const bin = path.join(directory, 'bin');
  const packageBin = path.join(directory, 'lib', 'node_modules', '@openai', 'codex', 'bin');
  await mkdir(bin);
  await mkdir(packageBin, { recursive: true });
  const script = path.join(packageBin, 'codex.mjs');
  await writeFile(script, `#!/usr/bin/env node\n${await readFile(fixture, 'utf8')}`);
  await chmod(script, 0o755);
  const link = path.join(bin, 'codex');
  await symlink(path.relative(bin, script), link);
  const target = await realpath(script);
  assert.deepEqual(resolveCodex({ executable: link }), { file: process.execPath, args: [target] });
  // Simulate a GUI PATH containing the npm command but no Node executable.
  const helper = `
    import { resolveCodex, probeCapabilities, withAppServer } from ${JSON.stringify(new URL('../src/transport.mjs', import.meta.url).href)};
    import { collectTasks } from ${JSON.stringify(new URL('../src/inventory.mjs', import.meta.url).href)};
    const spec = resolveCodex();
    await probeCapabilities(spec);
    const result = await withAppServer(spec, collectTasks);
    console.log(JSON.stringify({total: result.total, file: spec.file, target: spec.args[0]}));
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', helper], {
    env: { ...process.env, PATH: bin, AUTO_THREAD_TITLE_CODEX: link }, timeout: 10000, maxBuffer: 1024 * 1024,
  });
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { total: 3, file: process.execPath, target });
});

test('capability probe accepts standalone v2, definitions and $defs schemas without reading tasks', async (t) => {
  for (const scenario of ['normal', 'schema-definitions', 'schema-defs']) {
    const child = await audited(t, scenario);
    assert.deepEqual(await probeCapabilities(child.spec), { stateDbOnly: true, archived: true, sourceKinds: true, pagination: true });
    const audit = await child.readAudit();
    assert.deepEqual(audit.map(({ action }) => action), ['schema']);
    await assert.rejects(access(audit[0].directory), (error) => error.code === 'ENOENT');
    await child.assertStopped();
  }
});

test('incompatible, invalid, failing and timed-out schema probes fail before thread/list', async (t) => {
  for (const scenario of ['schema-missing-field', 'schema-missing-cursor', 'schema-invalid', 'schema-error', 'schema-timeout']) {
    const child = await audited(t, scenario);
    await assert.rejects(probeCapabilities(child.spec, { timeoutMs: scenario === 'schema-timeout' ? 400 : 10000 }), (error) => {
      assert.equal(error.message.includes('synthetic-private'), false); return true;
    });
    const audit = await child.readAudit();
    assert.deepEqual(audit.map(({ action }) => action), ['schema']);
    await assert.rejects(access(audit[0].directory), (error) => error.code === 'ENOENT');
    await child.assertStopped();
  }
});

test('real synthetic subprocess completes handshake, both archive states and pagination', async (t) => {
  const child = await audited(t, 'banner');
  const result = await withAppServer(child.spec, (request) => collectTasks(request, { pageSize: 1 }));
  assert.deepEqual([result.complete, result.total, result.archived, result.pages], [true, 3, 1, 3]);
  const messages = await child.readAudit();
  assert.deepEqual(messages.map((message) => message.method), ['initialize', 'initialized', 'thread/list', 'thread/list', 'thread/list']);
  assert.equal(messages.filter((message) => message.method === 'initialize').length, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-private-preview'), false);
  await child.assertStopped();
});

test('actual CLI script paths containing spaces, Unicode and shell metacharacters remain single arguments', async (t) => {
  const directory = await temporary(t);
  const spaced = path.join(directory, 'App Support 中文 & %data%');
  await mkdir(spaced);
  const script = path.join(spaced, 'fake codex.mjs');
  await copyFile(fixture, script);
  const spec = resolveCodex({ executable: script });
  await probeCapabilities(spec);
  const result = await withAppServer(spec, (request) => collectTasks(request));
  assert.equal(result.total, 3);
});

test('mutation, transcript reads, second initialization and rollout-backed listings cannot be sent', async (t) => {
  const child = await audited(t);
  await withAppServer(child.spec, async (request) => {
    for (const method of ['thread/name/set', 'thread/archive', 'turn/start', 'thread/resume', 'thread/read', 'initialize', 'initialized']) {
      await assert.rejects(request(method, {}), /Only bounded/);
    }
    for (const changes of [{ useStateDbOnly: false }, { sourceKinds: ['subAgent'] }, { cwd: '/anything' }, { limit: 10000 }]) {
      await assert.rejects(request('thread/list', { ...params(), ...changes }), /Only bounded/);
    }
  });
  assert.deepEqual((await child.readAudit()).map((message) => message.method), ['initialize', 'initialized']);
  await child.assertStopped();
});

test('server errors, malformed output and interactive requests are sanitized and terminate the child', async (t) => {
  for (const scenario of ['error-list', 'malformed-list', 'interactive']) {
    const child = await audited(t, scenario);
    await assert.rejects(withAppServer(child.spec, (request) => request('thread/list', params())), (error) => {
      assert.equal(error.message.includes('synthetic-private'), false); return true;
    });
    await child.assertStopped();
  }
});

test('initialization failure, request timeout and oversized lines are bounded and cleaned up', async (t) => {
  for (const scenario of ['exit-init', 'timeout-init', 'timeout-list', 'oversized-line']) {
    const child = await audited(t, scenario);
    await assert.rejects(withAppServer(child.spec, (request) => request('thread/list', params()), { timeoutMs: 400 }));
    await child.assertStopped();
  }
});

test('whole inventory deadline bounds a hanging callback independently of request timeout', async (t) => {
  const child = await audited(t);
  await assert.rejects(withAppServer(child.spec, () => new Promise(() => {}), { timeoutMs: 10000, maxDurationMs: 400 }), /Whole inventory time limit/);
  await child.assertStopped();
});

test('throwing callback always stops the child and an uncooperative child is killed', async (t) => {
  const child = await audited(t, 'ignore-terminate');
  await assert.rejects(withAppServer(child.spec, () => { throw new Error('synthetic callback failure'); }), /synthetic callback/);
  await child.assertStopped();
});

test('invalid launch specifications and direct shell wrappers are rejected before spawn', async () => {
  await assert.rejects(withAppServer({ file: 'codex.cmd', args: [] }, () => {}), /Shell wrappers/);
  await assert.rejects(probeCapabilities({ file: 'codex', args: ['\0'] }), /Invalid CLI/);
});

const projectFixture = fileURLToPath(new URL('./fixtures/fake-project-codex.mjs', import.meta.url));
test('project RPC purpose permits only bounded project/list with experimental handshake', async (t) => {
  const directory = await temporary(t);
  const audit = path.join(directory, 'project-audit.jsonl');
  const spec = { file: process.execPath, args: [projectFixture, '--audit', audit] };
  await withAppServer(spec, async request => {
    for (const method of ['thread/list', 'thread/read', 'thread/name/set', 'project/create', 'project/update', 'project/delete', 'initialize']) {
      await assert.rejects(request(method, {}), /Only bounded/);
    }
    for (const changes of [{ limit: 0 }, { limit: 101 }, { cursor: '' }, { cursor: '\n' }, { cwd: '/outside' }, { archived: true }]) {
      await assert.rejects(request('project/list', { limit: 100, ...changes }), /Only bounded/);
    }
    assert.equal((await request('project/list', { limit: 100 })).data.length, 1);
  }, { purpose: 'projects' });
  const messages = (await readFile(audit, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(messages.map(message => message.method), ['initialize', 'initialized', 'project/list']);
  assert.equal(messages[0].params.capabilities.experimentalApi, true);
});

test('default task inventory denies project/list and does not enable experimental APIs', async (t) => {
  const child = await audited(t);
  await withAppServer(child.spec, request => assert.rejects(request('project/list', { limit: 100 }), /Only bounded/));
  assert.equal((await child.readAudit())[0].params.capabilities, undefined);
});

test('project RPC incompatibility and timeout are sanitized and stop subprocesses', async (t) => {
  for (const scenario of ['incompatible', 'malformed', 'timeout']) {
    const directory = await temporary(t);
    const pidFile = path.join(directory, 'project-pid.txt');
    const spec = { file: process.execPath, args: [projectFixture, '--scenario', scenario, '--pid-file', pidFile] };
    await assert.rejects(withAppServer(spec, request => request('project/list', { limit: 100 }), {
      purpose: 'projects', timeoutMs: 400,
    }), error => !error.message.includes('synthetic-private'));
    const pid = Number(await readFile(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  }
});
