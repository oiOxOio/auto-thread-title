"""只用临时 Git 仓库和伪 GitHub API；不联网、不接触用户账号。"""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).resolve().parents[2] / 'scripts/release_marketplace.py'
spec = importlib.util.spec_from_file_location('release_marketplace', MODULE)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class FakeAPI:
    def __init__(self):
        self.tags, self.releases, self.writes = {}, {}, []
        self.latest = None

    def request(self, method, route, data=None, missing=False, upload=False):
        if method != 'GET':
            self.writes.append((method, route))
        if route.startswith('git/ref/tags/'):
            tag = route[len('git/ref/tags/'):]
            return {'object': {'type': 'commit', 'sha': self.tags[tag]}} if tag in self.tags else None
        if route == 'git/refs':
            self.tags[data['ref'].removeprefix('refs/tags/')] = data['sha']
            return {}
        if route.startswith('releases?'):
            return copy.deepcopy(list(self.releases.values()))
        if route == 'releases/latest':
            return copy.deepcopy(self.releases[self.latest]) if self.latest is not None else None
        if route == 'releases' and method == 'POST':
            number = len(self.releases) + 1
            release = dict(data, id=number, html_url=f'{r.BASE}/releases/tag/{data["tag_name"]}', assets=[])
            self.releases[number] = release
            return copy.deepcopy(release)
        if route.startswith('releases/'):
            number = int(route.split('/')[1])
            if upload:
                filename = route.split('?name=')[1]
                self.releases[number]['assets'].append({'name': filename, 'digest': 'sha256:' + hashlib.sha256(data).hexdigest()})
                return {}
            if method == 'PATCH':
                self.releases[number].update(data)
                if data.get('make_latest') == 'true':
                    self.latest = number
                return copy.deepcopy(self.releases[number])
        raise AssertionError((method, route))


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'repo'
        self.root.mkdir()
        self.output = Path(self.tmp.name) / 'out'
        self.market = {'name': 'why-ping', 'plugins': []}
        self.plan = {'schemaVersion': 1, 'tag': 'marketplace-2026.09.09', 'title': '市场总览', 'summary': ['测试发布'], 'validation': {}}
        for name in ('alpha', 'beta'):
            self.market['plugins'].append({'name': name, 'source': {'source': 'local', 'path': './plugins/' + name}})
            self.plan['validation'][name] = {'command': ['node', '--test'], 'scope': '静态测试', 'runtime': '未执行实机验收'}
            self.write(f'plugins/{name}/.codex-plugin/plugin.json', {'name': name, 'version': '0.1.0', 'author': {'name': 'Why.Ping'}, 'interface': {'displayName': name + ' 中文'}})
            self.write(f'plugins/{name}/README.md', '# 测试说明\n')
            self.write(f'plugins/{name}/CHANGELOG.md', '# 更新\n\n## 0.1.0 — 2026-09-09\n\n新增测试。\n\n## 0.0.1\n\n旧内容。\n')
        self.save_config()
        self.command('init', '-q')
        self.command('config', 'user.email', 'fixture@example.invalid')
        self.command('config', 'user.name', 'Release fixture')
        self.command('config', 'core.autocrlf', 'false')
        self.sha = self.commit()

    def command(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root).decode().strip()

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content, ensure_ascii=False) + '\n' if isinstance(content, dict) else content, encoding='utf-8', newline='\n')

    def save_config(self):
        self.write('.agents/plugins/marketplace.json', self.market)
        self.write('releases/marketplace.json', self.plan)

    def commit(self):
        self.command('add', '.')
        self.command('commit', '-qm', 'fixture')
        return self.command('rev-parse', 'HEAD')

    def test_catalog_includes_every_plugin_in_order(self):
        _, catalog = r.load_catalog(self.root)
        self.assertEqual([p['name'] for p in catalog], ['alpha', 'beta'])

    def test_duplicate_names_rejected(self):
        self.market['plugins'].append(self.market['plugins'][0])
        self.save_config()
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_missing_validation_rejected(self):
        del self.plan['validation']['beta']
        self.save_config()
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_stale_validation_rejected(self):
        self.plan['validation']['unknown'] = self.plan['validation']['alpha']
        self.save_config()
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_path_escape_rejected(self):
        self.market['plugins'][0]['source']['path'] = '../../private'
        self.save_config()
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_remote_source_rejected(self):
        self.market['plugins'][0]['source'] = {'source': 'git', 'url': 'https://example.invalid/a'}
        self.save_config()
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_invalid_version_rejected(self):
        p = self.root / 'plugins/alpha/.codex-plugin/plugin.json'
        data = json.loads(p.read_text(encoding='utf-8'))
        data['version'] = '0.1.0+cache'
        self.write(str(p.relative_to(self.root)), data)
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_mismatched_manifest_name_rejected(self):
        p = self.root / 'plugins/alpha/.codex-plugin/plugin.json'
        data = json.loads(p.read_text(encoding='utf-8'))
        data['name'] = 'other'
        self.write(str(p.relative_to(self.root)), data)
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_missing_changelog_version_rejected(self):
        self.write('plugins/alpha/CHANGELOG.md', '# 更新\n## 0.0.1\n旧版\n')
        with self.assertRaises(ValueError):
            r.load_catalog(self.root)

    def test_current_changelog_only(self):
        _, catalog = r.load_catalog(self.root)
        self.assertEqual(r.version_changes(self.root, catalog[0]), '新增测试。')

    def test_marketplace_notes_include_both_install_commands_and_limits(self):
        plan, catalog = r.load_catalog(self.root)
        notes = r.marketplace_notes(plan, catalog, self.sha)
        for name in ('alpha', 'beta'):
            self.assertIn(f'codex plugin add {name}@why-ping', notes)
        self.assertIn('--ref ' + self.sha, notes)
        self.assertIn('独立 CODEX_HOME', notes)
        self.assertIn('未执行实机验收', notes)
        self.assertIn('不是签名或安全认证', notes)

    def test_scope_notice_preserves_history_and_is_idempotent(self):
        old = '# 原文\n\nold command\n'
        once = r.scope_notice(old, 'alpha-v0.1.0', self.sha)
        self.assertTrue(once.endswith(old))
        self.assertEqual(once, r.scope_notice(once, 'alpha-v0.1.0', self.sha))

    def test_broken_notice_rejected(self):
        with self.assertRaises(ValueError):
            r.scope_notice(r.START + 'missing end', 'alpha-v0.1.0', self.sha)

    def test_archives_and_checksum_manifest(self):
        _, _, payloads = r.build(self.root, self.sha, self.output)
        self.assertEqual(len(payloads), 5)
        manifest = json.loads(payloads['release-manifest.json'])
        self.assertEqual(manifest['commit'], self.sha)
        self.assertEqual(len(manifest['plugins']), 2)
        for plugin in manifest['plugins']:
            blob = payloads[plugin['asset']]
            self.assertEqual(hashlib.sha256(blob).hexdigest(), plugin['sha256'])
            names = zipfile.ZipFile(io.BytesIO(blob)).namelist()
            self.assertTrue(all(n.startswith(plugin['name'] + '/') for n in names))
            self.assertIn(plugin['name'] + '/.codex-plugin/plugin.json', names)
        all_names = zipfile.ZipFile(io.BytesIO(payloads[manifest['marketplaceAsset']])).namelist()
        self.assertIn('why-ping/.agents/plugins/marketplace.json', all_names)
        self.assertIn('why-ping/plugins/beta/.codex-plugin/plugin.json', all_names)
        for line in payloads['SHA256SUMS'].decode().splitlines():
            digest, filename = line.split('  ')
            self.assertEqual(digest, hashlib.sha256(payloads[filename]).hexdigest())

    def test_build_reproducible(self):
        one = r.build(self.root, self.sha, self.output)[2]
        two = r.build(self.root, self.sha, self.output)[2]
        self.assertEqual(one, two)

    def test_unrelated_repository_change_preserves_plugin_zip(self):
        one = r.build(self.root, self.sha, self.output)[2]
        self.write('README.md', '# 市场文档\n')
        newer = self.commit()
        two = r.build(self.root, newer, self.output)[2]
        self.assertEqual(one['alpha-0.1.0.zip'], two['alpha-0.1.0.zip'])

    def test_dirty_checkout_rejected(self):
        self.write('plugins/alpha/README.md', 'uncommitted\n')
        with self.assertRaises(ValueError):
            r.build(self.root, self.sha, self.output)

    def test_incorrect_commit_rejected(self):
        with self.assertRaises(ValueError):
            r.build(self.root, 'a' * 40, self.output)

    def test_committed_secret_file_rejected(self):
        self.write('.env', 'SYNTHETIC=not-a-secret\n')
        sha = self.commit()
        with self.assertRaises(ValueError):
            r.committed_files(self.root, sha)

    def test_committed_symlink_mode_rejected_without_os_symlink_privilege(self):
        oid = subprocess.check_output(['git', 'hash-object', '-w', '--stdin'], cwd=self.root, input=b'../../outside').decode().strip()
        self.command('update-index', '--add', '--cacheinfo', f'120000,{oid},link')
        self.command('commit', '-qm', 'synthetic symlink')
        with self.assertRaises(ValueError):
            r.committed_files(self.root, self.command('rev-parse', 'HEAD'))

    def test_publish_and_retry_no_duplicate_releases_or_assets(self):
        api = FakeAPI()
        r.publish(self.root, self.sha, self.output, api)
        self.assertEqual(len(api.releases), 3)
        self.assertEqual(api.releases[api.latest]['tag_name'], self.plan['tag'])
        before = copy.deepcopy(api.tags)
        count = sum(len(v['assets']) for v in api.releases.values())
        r.publish(self.root, self.sha, self.output, api)
        self.assertEqual(api.tags, before)
        self.assertEqual(len(api.releases), 3)
        self.assertEqual(sum(len(v['assets']) for v in api.releases.values()), count)
        self.assertTrue(all(not v['draft'] for v in api.releases.values()))
        for release in api.releases.values():
            if release['tag_name'] != self.plan['tag']:
                self.assertEqual(release['body'].count(r.START), 1)
                self.assertEqual(release['make_latest'], 'false')

    def test_marketplace_tag_conflict_fails_before_writes(self):
        api = FakeAPI()
        api.tags[self.plan['tag']] = 'a' * 40
        with self.assertRaises(ValueError):
            r.publish(self.root, self.sha, self.output, api)
        self.assertEqual(api.writes, [])

    def test_same_plugin_version_cannot_publish_changed_contents(self):
        api = FakeAPI()
        api.tags['alpha-v0.1.0'] = self.sha
        self.write('plugins/alpha/README.md', 'changed\n')
        changed = self.commit()
        with self.assertRaises(ValueError):
            r.publish(self.root, changed, self.output, api)
        self.assertEqual(api.writes, [])

    def test_asset_conflict_never_overwritten(self):
        api = FakeAPI()
        r.publish(self.root, self.sha, self.output, api)
        api.releases[api.latest]['assets'][0]['digest'] = 'sha256:incorrect'
        api.writes.clear()
        with self.assertRaises(ValueError):
            r.publish(self.root, self.sha, self.output, api)
        self.assertEqual(api.writes, [])

    def test_tag_conflict_never_moved(self):
        api = FakeAPI()
        api.tags['old'] = 'a' * 40
        with self.assertRaises(ValueError):
            r.ensure_tag(api, 'old', self.sha)
        self.assertEqual(api.writes, [])

    def test_historical_release_body_and_tag_preserved(self):
        api = FakeAPI()
        api.tags['alpha-v0.1.0'] = self.sha
        old = '# 历史正文\n\n原有更新说明。\n'
        release = api.request('POST', 'releases', {'tag_name': 'alpha-v0.1.0', 'name': '旧标题', 'body': old, 'draft': False})
        api.latest = release['id']
        r.publish(self.root, self.sha, self.output, api)
        self.assertEqual(api.tags['alpha-v0.1.0'], self.sha)
        self.assertTrue(api.releases[release['id']]['body'].endswith(old))
        self.assertEqual(api.releases[release['id']]['name'], 'alpha v0.1.0 · alpha 中文')

    def test_existing_plugin_draft_is_resumed(self):
        api = FakeAPI()
        api.tags['alpha-v0.1.0'] = self.sha
        release = api.request('POST', 'releases', {'tag_name': 'alpha-v0.1.0', 'name': '旧草稿', 'body': '正文', 'draft': True})
        r.publish(self.root, self.sha, self.output, api)
        self.assertFalse(api.releases[release['id']]['draft'])
        self.assertEqual(len(api.releases[release['id']]['assets']), 2)
        self.assertEqual(len(api.releases), 3)

    def test_older_commit_cannot_downgrade_marketplace_latest(self):
        api = FakeAPI()
        self.write('README.md', 'newer commit\n')
        newer = self.commit()
        api.tags['marketplace-2026.09.10'] = newer
        release = api.request('POST', 'releases', {'tag_name': 'marketplace-2026.09.10', 'name': '新快照', 'body': 'new', 'draft': False})
        api.latest = release['id']
        api.writes.clear()
        self.command('checkout', '-q', '--detach', self.sha)
        with self.assertRaises(ValueError):
            r.publish(self.root, self.sha, self.output, api)
        self.assertEqual(api.writes, [])

    def test_credential_redirect_disabled(self):
        self.assertIsNone(r.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.invalid'))


if __name__ == '__main__':
    unittest.main()
