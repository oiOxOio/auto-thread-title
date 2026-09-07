import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const isWindows = process.platform === 'win32';
const powerShell = isWindows ? 'powershell.exe' : 'pwsh';
const hasPowerShell = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { timeout: 5000 }).status === 0;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "auto-title launch 中文 $;()' "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'src'));
  for (const file of ['run.sh', 'run.ps1']) {
    copyFileSync(path.join(pluginRoot, 'scripts', file), path.join(root, 'scripts', file));
  }
  writeFileSync(path.join(root, 'src', 'cli.mjs'), `
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'exit') process.exit(Number(args[1]));
process.stdout.write(JSON.stringify({args, stdin: readFileSync(0).toString('base64')}));
`);
  const env = { ...process.env, AUTO_THREAD_TITLE_NODE: process.execPath };
  delete env.NODE_OPTIONS;
  delete env.CODEX_PRIMARY_RUNTIME_NODE;
  return { root, env };
}

function invoke(f, shell, args, input = Buffer.from('')) {
  const launcherArgs = shell === 'sh'
    ? [path.join(f.root, 'scripts', 'run.sh'), ...args]
    : ['-NoProfile', '-NonInteractive', '-File', path.join(f.root, 'scripts', 'run.ps1'), ...args];
  const result = spawnSync(shell === 'sh' ? '/bin/sh' : powerShell, launcherArgs, {
    env: f.env, input, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  return result;
}

for (const [shell, available] of [['sh', !isWindows], ['powershell', hasPowerShell]]) {
  test(`${shell}: preserves hook stdin bytes and Unicode/space/quote/backslash args`, { skip: !available }, t => {
    const f = fixture(t);
    const input = Buffer.from('\uFEFF{"cwd":"/Users/开发/project with spaces","source":"startup"}\r\n', 'utf8');
    const args = ['hook', 'a directory/中文', 'a"quoted"value', 'C:\\path with spaces\\', 'x\\"y'];
    const result = invoke(f, shell, args, input);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { args, stdin: input.toString('base64') });
    assert.equal(result.stderr, '');
  });

  test(`${shell}: propagates native child failure instead of claiming success`, { skip: !available }, t => {
    const f = fixture(t);
    const result = invoke(f, shell, ['exit', '7']);
    assert.equal(result.status, 7, result.stderr);
  });

  test(`${shell}: strict missing override fails manually and skips hook without context`, { skip: !available }, t => {
    const f = fixture(t);
    f.env.AUTO_THREAD_TITLE_NODE = path.join(f.root, 'not installed', 'node');
    f.env.CODEX_PRIMARY_RUNTIME_NODE = process.execPath;
    const manual = invoke(f, shell, ['doctor']);
    assert.equal(manual.status, 1);
    assert.equal(manual.stdout, '');
    assert.match(manual.stderr, /AUTO_THREAD_TITLE_NODE.*22\+/);
    const hook = invoke(f, shell, ['hook'], Buffer.from('{"source":"startup"}'));
    assert.equal(hook.status, 0);
    assert.equal(hook.stdout, '');
    assert.match(hook.stderr, /AUTO_THREAD_TITLE_NODE/);
  });

  test(`${shell}: rejects Node below 22`, { skip: !available }, t => {
    const f = fixture(t);
    const preload = path.join(f.root, 'old-version.cjs');
    writeFileSync(preload, "Object.defineProperty(process.versions, 'node', {value:'20.19.0'});\n");
    f.env.NODE_OPTIONS = `--require "${preload.replaceAll('\\', '/')}"`;
    const result = invoke(f, shell, ['doctor']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /22\+/);
  });

  test(`${shell}: uses the configured Codex runtime without Python or npm`, { skip: !available }, t => {
    const f = fixture(t);
    delete f.env.AUTO_THREAD_TITLE_NODE;
    f.env.CODEX_PRIMARY_RUNTIME_NODE = process.execPath;
    const result = invoke(f, shell, ['doctor'], Buffer.from('unchanged'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).stdin, Buffer.from('unchanged').toString('base64'));
  });

  test(`${shell}: reports incomplete installation without running CLI`, { skip: !available }, t => {
    const f = fixture(t);
    rmSync(path.join(f.root, 'src', 'cli.mjs'));
    const manual = invoke(f, shell, ['doctor']);
    assert.equal(manual.status, 1);
    assert.match(manual.stderr, /Missing src\/cli.mjs/);
    const hook = invoke(f, shell, ['hook']);
    assert.equal(hook.status, 0);
    assert.equal(hook.stdout, '');
  });
}

test('POSIX: falls back from unusable Codex runtime to PATH without a login profile', { skip: isWindows }, t => {
  const f = fixture(t);
  delete f.env.AUTO_THREAD_TITLE_NODE;
  f.env.CODEX_PRIMARY_RUNTIME_NODE = path.join(f.root, 'unavailable-node');
  const bin = path.join(f.root, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, path.join(bin, 'node'));
  f.env.PATH = bin;
  const result = invoke(f, 'sh', ['doctor']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, ['doctor']);
});

test('POSIX: missing all runtimes is actionable and hook remains quiet on stdout', {
  skip: isWindows || ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].some(existsSync),
}, t => {
  const f = fixture(t);
  delete f.env.AUTO_THREAD_TITLE_NODE;
  f.env.PATH = path.join(f.root, 'empty-path');
  const manual = invoke(f, 'sh', ['doctor']);
  assert.equal(manual.status, 1);
  assert.match(manual.stderr, /Node.js 22\+ was not found/);
  assert.match(manual.stderr, /Nothing was installed automatically/);
  const hook = invoke(f, 'sh', ['hook']);
  assert.equal(hook.status, 0);
  assert.equal(hook.stdout, '');
});

test('POSIX: original hook command safely resolves PLUGIN_ROOT with spaces and shell metacharacters', { skip: isWindows }, t => {
  const f = fixture(t);
  f.env.PLUGIN_ROOT = f.root;
  const hook = JSON.parse(readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0];
  const payload = Buffer.from('{"cwd":"/Users/中文/project","source":"startup"}\n');
  const result = spawnSync('sh', ['-c', hook.command], { env: f.env, input: payload, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['hook'], stdin: payload.toString('base64') });
});

for (const outerShell of ['cmd', 'powershell']) {
  test(`Windows: exact installed hook via ${outerShell} preserves input and metacharacter PLUGIN_ROOT`, {
    skip: !isWindows || !hasPowerShell,
  }, t => {
    const f = fixture(t);
    f.env.PLUGIN_ROOT = f.root;
    const hook = JSON.parse(readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks.SessionStart[0].hooks[0];
    const payload = Buffer.from('\uFEFF{"cwd":"S:\\\\项目\\\\app","source":"startup"}\r\n');
    const executable = outerShell === 'cmd' ? process.env.ComSpec || 'cmd.exe' : powerShell;
    const args = outerShell === 'cmd'
      ? ['/d', '/s', '/c', hook.commandWindows]
      : ['-NoProfile', '-NonInteractive', '-Command', hook.commandWindows];
    // Run the exact installed command, not a reconstructed equivalent: the
    // outer PowerShell must not expand PLUGIN_ROOT into nested command source.
    const result = spawnSync(executable, args, {
      env: f.env, input: payload, encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { args: ['hook'], stdin: payload.toString('base64') });
    assert.equal(result.stderr, '');
  });
}

test('hook is startup-only with bounded timeout/context and never bypasses PowerShell policy', () => {
  const config = JSON.parse(readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(config.hooks.SessionStart[0].matcher, '^startup$');
  const hook = config.hooks.SessionStart[0].hooks[0];
  assert.equal(hook.timeout, 10);
  assert.equal(hook.additionalContextLimit, 1400);
  assert.doesNotMatch(hook.commandWindows, /ExecutionPolicy|Bypass/i);
  assert.match(hook.commandWindows, /-NoProfile -NonInteractive/);
  assert.doesNotMatch(hook.commandWindows, /\$env:PLUGIN_ROOT/i);
  assert.match(hook.commandWindows, /\[Environment\]::GetEnvironmentVariable\('PLUGIN_ROOT'\)/);
  for (const file of ['run.sh', 'run.ps1']) {
    assert.ok(existsSync(path.join(pluginRoot, 'scripts', file)));
    assert.doesNotMatch(readFileSync(path.join(pluginRoot, 'scripts', file), 'utf8'), /Set-ExecutionPolicy|ExecutionPolicy\s+Bypass|npm install|brew install|curl\s/i);
  }
});
