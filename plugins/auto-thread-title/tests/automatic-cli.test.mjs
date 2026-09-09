import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveProjectCodex } from '../src/project-runtime.mjs';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'title automatic 项目 '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'actual-project'), other = path.join(root, 'unrelated');
  fs.mkdirSync(project); fs.mkdirSync(other);
  const registry = path.join(root, '.codex-global-state.json');
  const config = path.join(root, 'auto-thread-title', 'config.json');
  const marker = path.join(root, 'cli-started');
  const executable = path.join(root, 'codex.mjs');
  fs.writeFileSync(executable, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected'); process.exit(2);`);
  const env = { ...process.env, CODEX_HOME: root, AUTO_THREAD_TITLE_CONFIG: config, AUTO_THREAD_TITLE_CODEX: executable };
  const event = { hook_event_name: 'SessionStart', source: 'startup', session_id: 'synthetic-startup-123', cwd: project };
  const run = (args, input) => spawnSync(process.execPath, [CLI, ...args], {
    env, input: input === undefined ? undefined : JSON.stringify(input), encoding: 'utf8', timeout: 15000,
  });
  const saveProjects = roots => fs.writeFileSync(registry, JSON.stringify({ 'local-projects': { example: { rootPaths: roots } } }));
  return { root, project, other, config, registry, marker, executable, event, env, run, saveProjects };
}

function metadataServer(f) {
  const responseFile = path.join(f.root, 'metadata-response.json');
  const thread = { id: f.event.session_id, cwd: f.project, source: 'vscode', ephemeral: false,
    name: null, createdAt: Date.parse('2026-09-08T16:00:00Z') / 1000, turns: [], preview: 'PRIVATE-PREVIEW' };
  fs.writeFileSync(f.executable, `
import fs from 'node:fs';
import readline from 'node:readline';
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line', line => {
  const m = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(f.marker)}, JSON.stringify(m) + '\\n');
  const send = value => process.stdout.write(JSON.stringify({id:m.id,...value})+'\\n');
  if (m.method === 'initialize') send({result:{userAgent:'synthetic'}});
  else if (m.method === 'initialized') {}
  else if (m.method === 'thread/read') {
    const response = JSON.parse(fs.readFileSync(${JSON.stringify(responseFile)}, 'utf8'));
    if (response.hang) return;
    send(response);
  } else process.exit(9);
});
`);
  const respond = response => fs.writeFileSync(responseFile, JSON.stringify(response));
  respond({ result: { thread } });
  return { thread, respond, audit: () => fs.readFileSync(f.marker, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('normal startup reads only current metadata, emits a lean policy, and supports manual scope', t => {
  const f = fixture(t), server = metadataServer(f);
  f.saveProjects([f.project]);
  for (const manual of [false, true]) {
    if (manual) {
      fs.mkdirSync(path.dirname(f.config));
      fs.writeFileSync(f.config, JSON.stringify({ scope: 'manual', projectRoots: [f.project] }));
    }
    const result = f.run(['hook'], f.event);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /0909 \| 类型 \| 主题/u);
    assert.match(context, /省略 threadId/u);
    assert.doesNotMatch(context, /read_thread|PRIVATE-PREVIEW|synthetic-startup-123/u);
  }
  const audit = server.audit();
  assert.deepEqual(audit.map(m => m.method), ['initialize', 'initialized', 'thread/read', 'initialize', 'initialized', 'thread/read']);
  assert.equal(audit[0].params.capabilities, undefined);
  assert.deepEqual(audit[2].params, { threadId: f.event.session_id, includeTurns: false });
  // The extra preflight cannot run outside either scope.
  assert.equal(f.run(['hook'], { ...f.event, cwd: f.other }).stdout, '');
  assert.equal(server.audit().length, 6);
});

test('formatted titles and identity mismatches emit no context while transient unavailability falls back', t => {
  const f = fixture(t), server = metadataServer(f);
  f.saveProjects([f.project]);
  for (const change of [{ name: '0909 | 优化 | 内存占用' }, { id: 'different-thread-123' }, { cwd: f.other }]) {
    server.respond({ result: { thread: { ...server.thread, ...change } } });
    const result = f.run(['hook'], f.event);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  for (const response of [{ error: { code: -32601, message: 'PRIVATE-SERVER-ERROR' } }, { hang: true }]) {
    server.respond(response);
    const result = f.run(['hook'], f.event);
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /read_thread/u);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/u);
  }
  server.respond({ result: { thread: server.thread } });
  assert.doesNotMatch(JSON.parse(f.run(['hook'], f.event).stdout).hookSpecificOutput.additionalContext, /read_thread/u);
  assert.equal(fs.existsSync(f.config), false);
});

test('fresh installation follows additions/removals of saved project roots without writing config', t => {
  const f = fixture(t);
  f.saveProjects([f.other, f.project]);
  const first = f.run(['hook'], f.event);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(fs.existsSync(f.config), false);
  // This fixture simulates an older CLI; metadata failure keeps the full policy.
  assert.equal(fs.existsSync(f.marker), true);
  f.saveProjects([f.other]);
  assert.equal(f.run(['hook'], f.event).stdout, '');
  f.saveProjects([f.project]);
  assert.ok(f.run(['hook'], f.event).stdout);
  assert.equal(fs.existsSync(f.config), false);
  assert.equal(fs.existsSync(f.marker), true);
});

test('disabled, resumed and invalid startup events do not query projects', t => {
  const f = fixture(t);
  fs.writeFileSync(f.registry, '{broken-registry');
  for (const event of [{ ...f.event, source: 'resume' }, { ...f.event, source: 'compact' },
    { ...f.event, hook_event_name: 'UserPromptSubmit' }, { ...f.event, session_id: 'bad' }, { ...f.event, cwd: 'relative' }]) {
    const result = f.run(['hook'], event);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  fs.mkdirSync(path.dirname(f.config));
  fs.writeFileSync(f.config, JSON.stringify({ enabled: false }));
  assert.equal(f.run(['hook'], f.event).stderr, '');
  assert.equal(fs.existsSync(f.marker), false);
});

test('project doctor checks only saved project metadata and exposes current-directory mismatch', t => {
  const f = fixture(t);
  f.saveProjects([f.project]);
  const result = f.run(['doctor', '--projects']);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.scope, 'projects');
  assert.equal(status.automaticScopeReady, true);
  assert.equal(status.projectDiscovery.projectCount, 1);
  assert.equal(status.projectDiscovery.rootCount, 1);
  assert.equal(status.projectDiscovery.currentDirectoryMatched, false);
  assert.equal(result.stdout.includes(f.project), false);
  assert.equal(fs.existsSync(f.marker), false);
});

test('unreadable automatic source stays quiet on stdout with an actionable sanitized diagnostic', t => {
  const f = fixture(t);
  fs.writeFileSync(f.registry, '{synthetic-private-registry');
  const result = f.run(['hook'], f.event);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.length);
  assert.equal(result.stderr.includes('synthetic-private-registry'), false);
  assert.equal(fs.existsSync(f.marker), false);
});

test('migrated installations use current project RPC and never stale desktop roots', t => {
  const f = fixture(t);
  fs.writeFileSync(f.registry, JSON.stringify({
    'local-projects': { stale: { rootPaths: [f.other] } },
    'app-server-projects-migration-by-host': { [`local:${f.root}`]: { projectsMigrated: true } },
  }));
  const installServer = roots => fs.writeFileSync(f.executable, `
import fs from 'node:fs';
import readline from 'node:readline';
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  const m = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(f.marker)}, m.method + '\\n');
  const send = result => process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
  if (m.method === 'initialize') {
    if (m.params.capabilities?.experimentalApi !== true) process.exit(4);
    send({userAgent:'synthetic'});
  } else if (m.method === 'initialized') {} else if (m.method === 'project/list') {
    send({data:[{id:'current',roots:${JSON.stringify(roots.map(root => ({ path: root })))} }],nextCursor:null});
  } else process.exit(5);
});
`);
  installServer([f.project]);
  const result = f.run(['hook'], f.event);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout, result.stderr);
  assert.deepEqual(fs.readFileSync(f.marker, 'utf8').trim().split('\n'), ['initialize', 'initialized', 'project/list', 'initialize']);
  installServer([f.other]);
  assert.equal(f.run(['hook'], f.event).stdout, '');
  // API failure after migration must not reactivate the stale scope.
  fs.writeFileSync(f.executable, 'process.exit(2);');
  const rejected = f.run(['hook'], { ...f.event, cwd: f.other });
  assert.equal(rejected.stdout, '');
  assert.ok(rejected.stderr);
  assert.equal(fs.existsSync(f.config), false);
});

test('project runtime prefers the desktop copy and respects explicit overrides and Codex homes', t => {
  const f = fixture(t);
  const desktopDir = path.join(f.root, 'plugins', '.plugin-appserver');
  fs.mkdirSync(desktopDir, { recursive: true });
  const desktop = path.join(desktopDir, process.platform === 'win32' ? 'codex.exe' : 'codex');
  fs.writeFileSync(desktop, 'synthetic executable never run', { mode: 0o700 });
  const env = { CODEX_HOME: f.root, PATH: '' };
  assert.equal(resolveProjectCodex({ env }).file, desktop);
  assert.deepEqual(resolveProjectCodex({ env, executable: f.executable }), { file: process.execPath, args: [fs.realpathSync(f.executable)] });
  assert.deepEqual(resolveProjectCodex({ env: { ...env, AUTO_THREAD_TITLE_CODEX: f.executable } }), { file: process.execPath, args: [fs.realpathSync(f.executable)] });
  assert.throws(() => resolveProjectCodex({ env, executable: path.join(f.root, 'missing') }));
  assert.throws(() => resolveProjectCodex({ env: { CODEX_HOME: 'relative' } }));
  assert.throws(() => resolveProjectCodex({ env: { CODEX_HOME: path.join(f.root, 'different-home'), PATH: '' } }));
});
