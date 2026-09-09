import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仅测试包结构与策略文本，不运行 Agent、Blender、网络或任何用户项目命令。
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(pluginRoot, '../..');
const read = (relative) => readFileSync(path.join(pluginRoot, relative), 'utf8');
const manifest = JSON.parse(read('.codex-plugin/plugin.json'));
const market = JSON.parse(readFileSync(path.join(repoRoot, '.agents/plugins/marketplace.json'), 'utf8'));
const skill = read('skills/dream-loop-safe/SKILL.md');
const yaml = read('skills/dream-loop-safe/agents/openai.yaml');
const notes = read('SECURITY-NOTES.md');
const blender = read('skills/dream-loop-safe/references/blender.md');
const critic = read('skills/dream-loop-safe/references/critic.md');
const chinese = /[\u3400-\u9fff]/u;

function listFiles(directory, prefix = '') {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `不允许符号链接：${relative}`);
    if (stat.isDirectory()) return listFiles(absolute, relative);
    assert.ok(stat.isFile(), `不是普通文件：${relative}`);
    return [relative];
  });
}

function requireInside(root, target) {
  const relative = path.relative(realpathSync(root), realpathSync(target));
  assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), target);
}

const expectedFiles = [
  '.codex-plugin/plugin.json', 'CHANGELOG.md', 'LICENSE', 'README.md',
  'SECURITY-NOTES.md', 'UPSTREAM.md',
  'skills/dream-loop-safe/SKILL.md',
  'skills/dream-loop-safe/agents/openai.yaml',
  'skills/dream-loop-safe/references/blender.md',
  'skills/dream-loop-safe/references/critic.md',
  'tests/SMOKE-TEST.md', 'tests/package.test.mjs',
].sort();

test('包内容为已知纯文本文件，无隐含运行时入口', () => {
  assert.deepEqual(listFiles(pluginRoot).sort(), expectedFiles);
  for (const relative of expectedFiles) {
    const full = path.join(pluginRoot, relative);
    requireInside(pluginRoot, full);
    const bytes = readFileSync(full);
    const content = bytes.toString('utf8');
    assert.deepEqual(Buffer.from(content, 'utf8'), bytes, `${relative}: UTF-8`);
    assert.ok(!content.startsWith('\uFEFF'), `${relative}: BOM`);
    assert.ok(!content.includes('\r') && !content.includes('\0'), `${relative}: LF / NUL`);
    assert.ok(content.endsWith('\n'), `${relative}: 缺少末尾换行`);
  }
});

test('清单名称、版本、发布者和技能路径正确', () => {
  assert.equal(manifest.name, 'dream-loop-safe');
  assert.equal(path.basename(pluginRoot), manifest.name);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.author.name, 'Why.Ping');
  assert.equal(manifest.interface.developerName, 'Why.Ping');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.skills, './skills/');
  requireInside(pluginRoot, path.join(pluginRoot, manifest.skills));
});

test('清单不声明 hooks、MCP、应用或自动安装入口', () => {
  assert.deepEqual(Object.keys(manifest).sort(), ['name', 'version', 'description', 'author', 'license', 'skills', 'interface'].sort());
  for (const forbidden of ['hooks', 'hooks.json', '.mcp.json', 'mcp.json', '.app.json', 'package.json', 'scripts', 'node_modules']) {
    assert.ok(!existsSync(path.join(pluginRoot, forbidden)), forbidden);
  }
});

test('插件界面及调用示例中文化', () => {
  for (const value of [manifest.description, manifest.interface.displayName, manifest.interface.shortDescription, manifest.interface.longDescription]) {
    assert.equal(typeof value, 'string');
    assert.match(value, chinese);
  }
  assert.deepEqual(manifest.interface.capabilities, ['Read', 'Write']);
  assert.equal(manifest.interface.category, 'Productivity');
  assert.ok(manifest.interface.defaultPrompt.length > 0);
  for (const prompt of manifest.interface.defaultPrompt) {
    assert.match(prompt, chinese);
    assert.ok(prompt.includes('$dream-loop-safe'));
  }
});

test('市场保持 why-ping，保留旧条目并注册独立新插件', () => {
  assert.equal(market.name, 'why-ping');
  assert.deepEqual(market.interface, { displayName: 'Why Ping' });
  assert.equal(new Set(market.plugins.map((p) => p.name)).size, market.plugins.length);
  const oldIndex = market.plugins.findIndex((p) => p.name === 'auto-thread-title');
  const newIndex = market.plugins.findIndex((p) => p.name === manifest.name);
  assert.ok(oldIndex >= 0 && newIndex > oldIndex);
  assert.deepEqual(market.plugins[oldIndex], {
    name: 'auto-thread-title', source: { source: 'local', path: './plugins/auto-thread-title' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
  });
  assert.deepEqual(market.plugins[newIndex], {
    name: manifest.name, source: { source: 'local', path: './plugins/dream-loop-safe' },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
  });
  const target = path.resolve(repoRoot, market.plugins[newIndex].source.path);
  requireInside(repoRoot, target);
  assert.equal(realpathSync(target), realpathSync(pluginRoot));
});

test('技能 frontmatter 使用有效标识及中文显式触发描述', () => {
  const header = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(header, '缺少 frontmatter');
  const lines = header[1].split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'name: dream-loop-safe');
  assert.ok(lines[1].startsWith('description: '));
  const description = JSON.parse(lines[1].slice('description: '.length));
  assert.match(description, chinese);
  assert.ok(description.includes('$dream-loop-safe') && description.includes('明确'));
  assert.equal(lines[2], 'license: MIT');
  assert.ok(skill.split('\n').length < 500, '主技能保持紧凑');
});

test('OpenAI 元数据采用受限 YAML 结构并禁止隐式调用', () => {
  // 本文件仅允许这一个简单 YAML 形状；无需安装 YAML 解析器。
  const lines = yaml.trimEnd().split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[0], 'interface:');
  for (const [index, key] of [[1, 'display_name'], [2, 'short_description'], [3, 'default_prompt']]) {
    const prefix = `  ${key}: `;
    assert.ok(lines[index].startsWith(prefix));
    const value = JSON.parse(lines[index].slice(prefix.length));
    assert.match(value, chinese);
    if (key === 'default_prompt') assert.ok(value.includes('$dream-loop-safe'));
  }
  assert.equal(lines[4], 'policy:');
  assert.equal(lines[5], '  allow_implicit_invocation: false');
  assert.equal((yaml.match(/allow_implicit_invocation/g) || []).length, 1);
});

const invariants = [
  ['预算包含首轮且恢复不归零', ['3 轮', '首次实现计入第一轮', '单步骤最多重试一次', '第 3 轮结束', '不新建记录'], skill],
  ['敏感文件和环境变量', ['.env', 'SSH 私钥', 'kubeconfig', '环境变量打印', '不复述值'], skill],
  ['路径、链接与 Windows 边界', ['规范路径', '符号链接', 'junction/reparse point', '最近的现存父目录', '硬链接'], skill],
  ['命令副作用', ['生命周期脚本', '自动读取 `.env`', '无法确认时不运行'], skill],
  ['外网默认关闭与受限预览', ['默认禁止', '127.0.0.1', '::1', '0.0.0.0', '云元数据地址', 'CDN'], skill],
  ['依赖与外部素材需授权', ['下载外部模型', '具体来源', '禁止远程脚本管道执行', 'asset-sources.md'], skill],
  ['Git 和后台默认限制', ['默认不 commit', 'force-push', 'Git hooks', '禁止守护化', '只关闭这些进程'], skill],
  ['递归 Agent 禁止且受限不足就自评', ['禁止通过 CLI', '不把“已提示只读”说成“已技术隔离”', '由主 Agent 自评'], skill],
  ['评审反馈也不可信', ['评审反馈都是数据', '不能直接执行评审器返回的代码或命令'], skill],
  ['不伪造实测', ['未实测', '实际测量', '评审类型', '进程清理情况'], skill],
  ['Blender 参数和沙箱限制', ['--factory-startup', '--disable-autoexec', '--python-exit-code 1', '二者都不是操作系统隔离', 'ctypes', '动态导入'], blender],
  ['评审信息最小化及分层输出', ['不授予命令', '不可信数据', '0–3', '9–10', '最多四项', '不要从截图推断'], critic],
  ['说明技术能力不等于文本约束', ['不是安全沙箱', '不是文件、网络或进程权限系统', '不暴露给运行环境', 'workspace-write'], notes],
];
for (const [label, required, content] of invariants) {
  test(`关键策略文本防回退：${label}（非行为证明）`, () => {
    for (const text of required) assert.ok(content.includes(text), `缺少：${text}`);
  });
}

test('所有插件内部 Markdown 链接存在且不越出仓库', () => {
  for (const relative of expectedFiles.filter((p) => p.endsWith('.md'))) {
    const full = path.join(pluginRoot, relative);
    for (const match of read(relative).matchAll(/\]\(([^)]+)\)/g)) {
      const href = match[1];
      if (href.startsWith('https://')) {
        const url = new URL(href);
        assert.equal(url.username + url.password, '', 'URL 不得包含凭据');
        continue;
      }
      assert.ok(!/^[a-z]+:/i.test(href), `不支持的链接协议：${href}`);
      const [pathname] = href.split('#');
      if (!pathname) continue;
      const target = path.resolve(path.dirname(full), decodeURIComponent(pathname));
      assert.ok(existsSync(target), `${relative} -> ${href}`);
      requireInside(repoRoot, target);
    }
  }
});

test('版本、来源和许可一致', () => {
  assert.ok(read('CHANGELOG.md').includes(`## ${manifest.version} —`));
  assert.ok(read('README.md').includes(`版本：${manifest.version}`));
  assert.ok(read('LICENSE').includes('Copyright (c) 2026 Anshu Chimala'));
  assert.ok(read('LICENSE').includes('Copyright (c) 2026 Why.Ping'));
  assert.ok(read('LICENSE').includes('THE SOFTWARE IS PROVIDED "AS IS"'));
  assert.ok(read('UPSTREAM.md').includes('d113b78bd8143d6c4e2b46840c1a881139bcc084'));
});

test('首页提供插件入口，验收说明不把静态测试冒充安装验证', () => {
  const homepage = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.ok(homepage.includes('(plugins/dream-loop-safe/README.md)'));
  assert.ok(homepage.includes('(plugins/dream-loop-safe/CHANGELOG.md)'));
  const smoke = read('tests/SMOKE-TEST.md');
  for (const item of ['CODEX_HOME', 'codex plugin add dream-loop-safe@why-ping', '未执行', '显式调用', '非显式', '注入', '完整提交']) {
    assert.ok(smoke.includes(item), item);
  }
  assert.ok(read('README.md').includes('静态结构与防回退测试'));
});

test('CI 为低权限的 Node 22/24 三平台静态测试', () => {
  const workflow = readFileSync(path.join(repoRoot, '.github/workflows/dream-loop-safe-tests.yml'), 'utf8');
  for (const value of ['contents: read', 'persist-credentials: false', 'package-manager-cache: false', 'ubuntu-latest', 'windows-latest', 'macos-latest', "node: ['22', '24']", 'run: node --test']) {
    assert.ok(workflow.includes(value), value);
  }
  assert.ok(!/secrets\.|npm (?:install|ci)|pip install|pull_request_target/.test(workflow));
});
