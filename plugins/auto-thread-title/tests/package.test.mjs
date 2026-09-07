import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('marketplace and manifest preserve plugin identity and actual installed entrypoints', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, '..', '..', '.agents', 'plugins', 'marketplace.json'), 'utf8'));
  assert.equal(marketplace.name, 'why-ping');
  assert.equal(manifest.name, 'auto-thread-title');
  const entry = marketplace.plugins.find(item => item.name === manifest.name);
  assert.equal(path.resolve(root, '..', '..', entry.source.path), path.resolve(root));
  assert.equal(entry.policy.installation, 'AVAILABLE');
  assert.equal(manifest.author.name, 'Why.Ping');
  assert.equal(manifest.interface.developerName, 'Why.Ping');
  assert.equal(manifest.skills, './skills/');
  assert.ok(manifest.interface.capabilities.includes('Write'));
  const skills = fs.readdirSync(path.join(root, manifest.skills));
  for (const name of ['rename-task-title', 'rename-all-task-titles', 'configure-task-titles']) {
    assert.ok(skills.includes(name));
    const skill = fs.readFileSync(path.join(root, manifest.skills, name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^---\\r?\\nname: ${name}\\r?\\n`));
    assert.ok(fs.existsSync(path.join(root, manifest.skills, name, 'agents', 'openai.yaml')));
    assert.ok(manifest.interface.defaultPrompt.some(prompt => prompt.includes(`$${name}`)));
  }
  for (const filename of ['src/cli.mjs', 'src/config.mjs', 'src/policy.mjs', 'src/inventory.mjs', 'src/transport.mjs', 'scripts/run.sh', 'scripts/run.ps1', 'hooks/hooks.json']) {
    assert.ok(fs.statSync(path.join(root, filename)).isFile());
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.equal(packageJson.engines.node, '>=22');
});

test('single-task skill preserves original title-only policy and UI routing', () => {
  const skill = fs.readFileSync(path.join(root, 'skills/rename-task-title/SKILL.md'), 'utf8');
  for (const required of ['thread.createdAt', 'Asia/Shanghai', 'MMDD | 类型 | 主题',
    '18 characters or fewer', 'mcp__codex_app__set_thread_title', 'Do not call `list_threads`']) {
    assert.ok(skill.includes(required), required);
  }
  assert.ok(!skill.includes('MMDD｜类型｜主题'));
  const metadata = fs.readFileSync(path.join(root, 'skills/rename-task-title/agents/openai.yaml'), 'utf8');
  assert.ok(metadata.includes('display_name: "手动整理对话标题"'));
  assert.ok(metadata.includes('$rename-task-title'));
});

test('batch skill requires exact proposal confirmation and preserves read-only inventory boundaries', () => {
  const skill = fs.readFileSync(path.join(root, 'skills/rename-all-task-titles/SKILL.md'), 'utf8');
  for (const required of ['complete: true', 'outputComplete', 'nextOffset', 'useStateDbOnly: true',
    '确认按表格修改以上任务标题吗？只改标题，其他信息保持不变。', 'Then stop.',
    'Do not add newly discovered tasks to the approved set.', 'never unarchive a task just to rename it']) {
    assert.ok(skill.includes(required), required);
  }
});
