import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'title CLI 测试 '));
  const executable = path.join(root, 'fake codex.mjs');
  fs.copyFileSync(FAKE, executable);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, CODEX_HOME: root, AUTO_THREAD_TITLE_CONFIG: path.join(root, 'config.json'), AUTO_THREAD_TITLE_CODEX: executable };
  const run = args => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', timeout: 15000 });
  return { root, executable, run };
}

test('doctor does not execute a CLI until --probe is explicit', t => {
  const { root, executable, run } = fixture(t);
  const marker = path.join(root, 'executed');
  fs.writeFileSync(executable, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected'); process.exit(2);`);
  const check = run(['doctor']);
  assert.equal(check.status, 0, check.stderr);
  const result = JSON.parse(check.stdout);
  assert.equal(result.cliFound, true);
  assert.equal(result.api.checked, false);
  assert.equal(result.automaticScopeReady, null);
  assert.equal(result.scope, 'projects');
  assert.equal(result.projectDiscovery.checked, false);
  assert.equal(fs.existsSync(marker), false);
  const probe = run(['doctor', '--probe']);
  assert.equal(probe.status, 1);
  assert.equal(JSON.parse(probe.stdout).api.supported, false);
  assert.equal(fs.existsSync(marker), true);
});

test('CLI probes schema and lists fake active+archived metadata without previews', t => {
  const { run } = fixture(t);
  const probe = run(['doctor', '--probe']);
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(JSON.parse(probe.stdout).api.supported, true);
  const inventory = run(['inventory', '--page-size', '1']);
  assert.equal(inventory.status, 0, inventory.stderr);
  const result = JSON.parse(inventory.stdout);
  assert.equal(result.complete, true);
  assert.equal(result.total, 3);
  assert.equal(result.archived, 1);
  assert.equal(result.outputComplete, true);
  assert.equal(result.tasks.length, 3);
  assert.equal(inventory.stdout.includes('synthetic-private-preview'), false);
});

test('output slicing follows complete enumeration, does not confuse RPC page size with output size', t => {
  const { run } = fixture(t);
  const first = run(['inventory', '--needs-review', '--offset', '0', '--limit', '1', '--page-size', '1']);
  assert.equal(first.status, 0, first.stderr);
  const a = JSON.parse(first.stdout);
  assert.equal(a.complete, true);
  assert.equal(a.total, 3);
  assert.equal(a.outputComplete, false);
  assert.equal(a.outputTotal, 3);
  assert.equal(a.nextOffset, 1);
  assert.equal(a.tasks.length, 1);
  const next = JSON.parse(run(['inventory', '--offset', '1', '--limit', '2']).stdout);
  assert.equal(next.nextOffset, null);
  assert.equal(new Set([...a.tasks, ...next.tasks].map(task => task.id)).size, 3);
  const summary = run(['inventory', '--summary-only']);
  assert.equal(summary.status, 0, summary.stderr);
  const counts = JSON.parse(summary.stdout);
  assert.equal(counts.total, 3);
  assert.equal(Object.hasOwn(counts, 'tasks'), false);
  assert.equal(summary.stdout.includes('待整理标题'), false);
});

test('bad CLI override and unsupported CLI never produce partial success', t => {
  const { root, executable, run } = fixture(t);
  const missing = run(['inventory', '--codex', path.join(root, 'missing.exe')]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.equal(JSON.parse(missing.stderr).complete, false);
  fs.writeFileSync(executable, "process.stderr.write('private-synthetic-content'); process.exit(3);");
  const rejected = run(['inventory']);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.equal(rejected.stderr.includes('private-synthetic-content'), false);
});

test('invalid arguments never start inventory or silently fall back', t => {
  const { root, executable, run } = fixture(t), marker = path.join(root, 'executed');
  fs.writeFileSync(executable, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
  for (const args of [['inventory', '--page-size', '0'], ['inventory', '--page-size', '201'],
    ['inventory', '--offset', '-1'], ['inventory', '--limit', '0'], ['inventory', '--wat'],
    ['inventory', '--codex'], ['inventory', '--summary-only', '--summary-only'], ['rename']]) {
    assert.equal(run(args).status, 1, args.join(' '));
  }
  assert.equal(fs.existsSync(marker), false);
});
