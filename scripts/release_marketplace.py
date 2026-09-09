#!/usr/bin/env python3
"""发布市场快照与缺失的单插件版本；仅使用标准库，不移动旧标签。"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = "oiOxOio/codex-plugins"
BASE = f"https://github.com/{REPOSITORY}"
NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
VERSION = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
START = "<!-- why-ping:release-scope:start -->"
END = "<!-- why-ping:release-scope:end -->"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, timeout=60)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_catalog(root):
    root = Path(root).resolve()
    plan = read_json(root / "releases/marketplace.json")
    market = read_json(root / ".agents/plugins/marketplace.json")
    require(plan.get("schemaVersion") == 1, "不支持的发布计划版本")
    require(re.fullmatch(r"marketplace-\d{4}\.\d{2}\.\d{2}(?:\.\d+)?", plan.get("tag", "")), "非法市场标签")
    require(isinstance(plan.get("title"), str) and plan["title"].strip(), "缺少市场标题")
    require(isinstance(plan.get("summary"), list) and all(isinstance(s, str) for s in plan["summary"]), "发布摘要必须为文本数组")
    require(market.get("name") == "why-ping" and market.get("plugins"), "必须是非空 why-ping 市场")
    catalog = []
    seen = set()
    for entry in market["plugins"]:
        name = entry.get("name", "")
        require(NAME.fullmatch(name) and name not in seen, "插件名称无效或重复")
        seen.add(name)
        relative = f"plugins/{name}"
        require(entry.get("source") == {"source": "local", "path": f"./{relative}"}, "插件来源必须指向同名仓库内目录")
        directory = root / relative
        require(directory.resolve() == directory and not directory.is_symlink(), "拒绝插件路径链接或越界")
        manifest = read_json(directory / ".codex-plugin/plugin.json")
        require(manifest.get("name") == name, "市场与插件清单名称不一致")
        version = manifest.get("version", "")
        require(VERSION.fullmatch(version), "正式插件版本必须是 MAJOR.MINOR.PATCH")
        require(manifest.get("author", {}).get("name") == "Why.Ping", "发布者不一致")
        for document in ("README.md", "CHANGELOG.md"):
            p = directory / document
            require(p.is_file() and p.resolve().is_relative_to(directory), f"缺少有效文档：{name}/{document}")
        changes = (directory / "CHANGELOG.md").read_text(encoding="utf-8")
        require(re.search(r"^##\s+\[?" + re.escape(version) + r"(?:\]|\s|$)", changes, re.M), f"更新记录缺少 {version}")
        validation = plan.get("validation", {}).get(name, {})
        command = validation.get("command")
        require(isinstance(command, list) and command and all(isinstance(v, str) and v and "\n" not in v and "\x00" not in v for v in command), f"缺少测试命令：{name}")
        require(all(isinstance(validation.get(k), str) and validation[k] for k in ("scope", "runtime")), f"缺少验证边界：{name}")
        catalog.append({"name": name, "version": version, "displayName": manifest.get("interface", {}).get("displayName", name),
                        "description": manifest.get("interface", {}).get("shortDescription", manifest.get("description", "")),
                        "path": relative, "tag": f"{name}-v{version}", "validation": validation})
    require(set(plan.get("validation", {})) == seen, "测试计划必须覆盖且仅覆盖市场的全部插件")
    return plan, catalog


def version_changes(root, plugin):
    text = (Path(root) / plugin["path"] / "CHANGELOG.md").read_text(encoding="utf-8")
    header = re.search(r"^##\s+\[?" + re.escape(plugin["version"]) + r"(?:\]|\s|$).*\n", text, re.M)
    require(header, "缺少版本更新记录")
    return re.split(r"^##\s+", text[header.end():], maxsplit=1, flags=re.M)[0].strip()


def scope_notice(body, tag, commit):
    # 只替换本工具维护的提示区块；历史更新正文原样保留。
    if body.startswith(START):
        require(END in body, "历史提示区块损坏，拒绝覆盖")
        body = body.split(END, 1)[1].lstrip("\n")
    return (f"{START}\n> **单插件发布，不代表整个市场。** 全部插件请查看 [Why Ping 市场最新快照]({BASE}/releases/latest)。\n"
            f"> 本版本标签：`{tag}`；原始提交：`{commit}`。下方不带 `--ref` 的安装命令跟随所配置市场来源的当前版本，并非固定此版本。\n"
            f"> 精确复现请在独立 `CODEX_HOME` 中添加市场并指定 `--ref {commit}`，不要覆盖日常市场配置。\n{END}\n\n{body}")


def marketplace_notes(plan, catalog, commit, run_url=None):
    rows = []
    for p in catalog:
        rows.append(f"| `{p['name']}` · {p['displayName']} | `{p['version']}` | [说明]({BASE}/blob/{commit}/{p['path']}/README.md) · [单插件发布]({BASE}/releases/tag/{p['tag']}) |")
    install = "\n".join(f"codex plugin add {p['name']}@why-ping" for p in catalog)
    verification = "\n".join(f"- **{p['name']}**：{p['validation']['scope']} {p['validation']['runtime']}" for p in catalog)
    run = f"\n本次门禁运行：[GitHub Actions]({run_url})。\n" if run_url else "\n发布须通过对应提交的六平台/Node 组合门禁；本地生成不表示 CI 已通过。\n"
    return (f"# {plan['title']}\n\n这是 **why-ping 多插件市场快照**，不是任何单一插件的统一版本号。插件独立版本、独立安装；市场日期只标识这一组发布内容。\n\n"
            + "\n".join(f"- {s}" for s in plan["summary"])
            + f"\n\n## 本快照包含的全部插件\n\n| 插件 | 版本 | 入口 |\n| --- | --- | --- |\n" + "\n".join(rows)
            + f"\n\n## 安装当前市场版本\n\n首次添加市场：\n\n```powershell\ncodex plugin marketplace add https://github.com/{REPOSITORY}.git\n```\n\n已添加市场时先刷新，再按需选择插件；不必全部安装：\n\n```powershell\ncodex plugin marketplace upgrade why-ping\n{install}\ncodex plugin list --json\n```\n\n"
            + f"以上命令跟随已配置的市场来源，不保证一直安装本快照版本；新任务中检查技能发现和必要的钩子授权。\n\n## 固定本快照\n\n市场标签：`{plan['tag']}`；完整提交：`{commit}`。\n\n在**独立 CODEX_HOME** 中使用以下来源，避免改写日常 why-ping 配置：\n\n```powershell\ncodex plugin marketplace add https://github.com/{REPOSITORY}.git --ref {commit}\n```\n\n再按上表安装所需插件。完整 SHA 才是精确来源；不会移动或重用旧发布标签。\n\n"
            + "## 下载与校验\n\n附件提供完整市场 ZIP、每个插件的独立 ZIP、`release-manifest.json` 及 `SHA256SUMS`。完整市场包解压后保留 `.agents/plugins/marketplace.json` 与 `plugins/` 相对布局；单插件 ZIP 不是市场包，不能直接当作 marketplace 来源。GitHub 自动 Source code ZIP/TAR 始终是整个仓库，不是某一个插件的专属包。校验值用于一致性核对，不是签名或安全认证。\n\n"
            + "## 已验证范围与未验证事项\n\n" + verification + run
            + "\nCI 是结构/单元/合成数据验证，不等于真实 Codex 安装、桌面操作或视觉渲染验收。此发布不改变插件代码、权限或用户配置，也不宣称未经完成的实机验收已通过。\n")


def committed_files(root, commit):
    require(SHA.fullmatch(commit), "必须提供完整 commit SHA")
    records = git(root, "ls-tree", "-r", "-z", commit).split(b"\0")
    files = {}
    total = 0
    for record in records:
        if not record:
            continue
        metadata, encoded = record.split(b"\t", 1)
        mode, kind, oid = metadata.decode("ascii").split()
        name = encoded.decode("utf-8")
        path = PurePosixPath(name)
        require(mode in ("100644", "100755") and kind == "blob", f"拒绝链接、子模块或非常规文件：{name}")
        require(not path.is_absolute() and ".." not in path.parts and "\\" not in name and "\n" not in name, "非法归档路径")
        require(not any(part in (".git", "node_modules", ".dream-loop") for part in path.parts), "拒绝缓存或工作记录")
        require(not any(part == ".env" or (part.startswith(".env.") and part != ".env.example") for part in path.parts), "拒绝环境凭据文件")
        blob = git(root, "cat-file", "blob", oid)
        total += len(blob)
        require(total <= 50 * 1024 * 1024, "仓库超过 50 MiB 归档预算，请人工检查")
        files[name] = (mode, blob)
    return files


def make_zip(files, prefix, subset=""):
    # 固定 ZIP 时间与顺序；版本相同且文件字节相同，插件包校验值不随发布日变化。
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, (mode, data) in sorted(files.items()):
            if subset and not name.startswith(subset + "/"):
                continue
            relative = name[len(subset) + 1:] if subset else name
            info = zipfile.ZipInfo(prefix + "/" + relative, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (int(mode, 8) << 16)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return result.getvalue()


def build(root, commit, destination):
    root, destination = Path(root).resolve(), Path(destination).resolve()
    require(SHA.fullmatch(commit) and git(root, "rev-parse", "HEAD").decode().strip() == commit, "工作树不在待发布提交")
    require(not git(root, "diff", "--name-only", "HEAD"), "存在已跟踪文件改动，拒绝发布")
    plan, catalog = load_catalog(root)
    files = committed_files(root, commit)
    # 计划、清单和文档必须来自提交，不能让未跟踪文件冒充发布输入。
    for name in ["releases/marketplace.json", ".agents/plugins/marketplace.json"] + [f"{p['path']}/{f}" for p in catalog for f in (".codex-plugin/plugin.json", "README.md", "CHANGELOG.md")]:
        require(name in files and (root / name).read_bytes() == files[name][1], "发布输入不是提交中的文件")
    payloads = {f"why-ping-{plan['tag']}.zip": make_zip(files, "why-ping")}
    manifest = {"schemaVersion": 1, "repository": REPOSITORY, "marketplace": "why-ping", "tag": plan["tag"], "commit": commit, "plugins": []}
    for p in catalog:
        filename = f"{p['name']}-{p['version']}.zip"
        payloads[filename] = make_zip(files, p["name"], p["path"])
        manifest["plugins"].append({k: p[k] for k in ("name", "displayName", "version", "path", "tag", "validation")} | {"asset": filename, "sha256": hashlib.sha256(payloads[filename]).hexdigest()})
    manifest["marketplaceAsset"] = next(iter(payloads))
    manifest["marketplaceSha256"] = hashlib.sha256(payloads[manifest["marketplaceAsset"]]).hexdigest()
    payloads["release-manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    payloads["SHA256SUMS"] = "".join(f"{hashlib.sha256(v).hexdigest()}  {k}\n" for k, v in sorted(payloads.items())).encode()
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in payloads.items():
        target = destination / name
        require(not target.is_symlink(), "拒绝输出符号链接")
        target.write_bytes(data)
    return plan, catalog, payloads


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # 不把凭据随重定向带到其他主机。


class GitHubAPI:
    def __init__(self, token):
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, method, route, data=None, missing=False, upload=False):
        host = "uploads.github.com" if upload else "api.github.com"
        url = f"https://{host}/repos/{REPOSITORY}/{route}"
        raw = data if isinstance(data, bytes) else (json.dumps(data).encode() if data is not None else None)
        request = urllib.request.Request(url, data=raw, method=method, headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "why-ping-marketplace-release", "Content-Type": "application/octet-stream" if upload else "application/json"})
        try:
            with self.opener.open(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            raise RuntimeError(f"GitHub {method} {route.split('?')[0]} 返回 HTTP {error.code}；未记录凭据或响应正文") from None


def tag_commit(api, tag):
    ref = api.request("GET", "git/ref/tags/" + urllib.parse.quote(tag, safe=""), missing=True)
    if ref is None:
        return None
    obj = ref["object"]
    for _ in range(8):
        if obj["type"] == "commit":
            return obj["sha"]
        require(obj["type"] == "tag", "标签不是 commit/tag")
        obj = api.request("GET", "git/tags/" + obj["sha"])["object"]
    raise ValueError("嵌套标签过深")


def ensure_tag(api, tag, commit):
    existing = tag_commit(api, tag)
    require(existing in (None, commit), f"拒绝移动已存在标签：{tag}")
    if existing is None:
        api.request("POST", "git/refs", {"ref": f"refs/tags/{tag}", "sha": commit})


def ensure_asset(api, release, filename, data):
    existing = next((a for a in release.get("assets", []) if a["name"] == filename), None)
    if existing:
        require(existing.get("digest") == "sha256:" + hashlib.sha256(data).hexdigest(), f"现有附件摘要不匹配或不可验证，拒绝覆盖：{filename}")
        return
    api.request("POST", f"releases/{release['id']}/assets?name=" + urllib.parse.quote(filename, safe=""), data, upload=True)


def publish(root, commit, destination, api):
    plan, catalog, payloads = build(root, commit, destination)
    current = tag_commit(api, plan["tag"])
    require(current in (None, commit), "市场标签已绑定其他提交；请创建新的快照编号，不能重写历史")
    releases = []
    for page in range(1, 11):
        batch = api.request("GET", f"releases?per_page=100&page={page}")
        releases.extend(batch)
        if len(batch) < 100:
            break
    else:
        raise ValueError("Release 超过分页预算，请人工检查")
    by_tag = {r["tag_name"]: r for r in releases}
    latest_release = api.request("GET", "releases/latest", missing=True)
    if latest_release and latest_release["tag_name"].startswith("marketplace-") and latest_release["tag_name"] != plan["tag"]:
        latest_commit = tag_commit(api, latest_release["tag_name"])
        require(latest_commit and subprocess.run(["git", "merge-base", "--is-ancestor", latest_commit, commit], cwd=root, timeout=30).returncode == 0,
                "拒绝让旧提交覆盖较新的市场 Latest")
    run_url = f"{BASE}/actions/runs/{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID", "").isdigit() else None
    planned_new, historical = [], []
    # 先验证所有历史绑定与当前独立版本，再进行任何远端写入。
    for release in releases:
        for p in catalog:
            version = release["tag_name"].removeprefix(p["name"] + "-v")
            if not release["tag_name"].startswith(p["name"] + "-v") or not VERSION.fullmatch(version):
                continue
            original_commit = tag_commit(api, release["tag_name"])
            require(original_commit and SHA.fullmatch(original_commit), "历史发布缺少有效标签")
            old_manifest = json.loads(git(root, "show", f"{original_commit}:{p['path']}/.codex-plugin/plugin.json"))
            require(old_manifest["name"] == p["name"] and old_manifest["version"] == version, "历史标签与插件版本不符")
            historical.append((release, p, version, original_commit))
    for p in catalog:
        original_commit = tag_commit(api, p["tag"])
        if original_commit:
            require(git(root, "rev-parse", f"{original_commit}:{p['path']}") == git(root, "rev-parse", f"{commit}:{p['path']}"), f"{p['name']} 内容已变但版本未变，拒绝发布")
        if p["tag"] not in by_tag:
            planned_new.append((p, original_commit or commit))
    ensure_tag(api, plan["tag"], commit)
    aggregate = by_tag.get(plan["tag"])
    if aggregate is None:
        aggregate = api.request("POST", "releases", {"tag_name": plan["tag"], "target_commitish": commit, "name": plan["title"], "body": marketplace_notes(plan, catalog, commit, run_url), "draft": True, "prerelease": False, "make_latest": "false"})
    for name, data in payloads.items():
        ensure_asset(api, aggregate, name, data)
    pending = []
    for p, target in planned_new:
        ensure_tag(api, p["tag"], target)
        body = scope_notice(f"## {p['displayName']} {p['version']}\n\n{version_changes(root, p)}\n\n[版本说明]({BASE}/blob/{target}/{p['path']}/README.md)\n\n**验证边界**：{p['validation']['scope']} {p['validation']['runtime']}\n", p["tag"], target)
        release = api.request("POST", "releases", {"tag_name": p["tag"], "target_commitish": target, "name": f"{p['name']} v{p['version']} · {p['displayName']}", "body": body, "draft": True, "prerelease": False, "make_latest": "false"})
        pending.append((release, p))
    # 恢复上次中断时尚未发布的当前独立版本草稿。
    for p in catalog:
        if p["tag"] in by_tag and by_tag[p["tag"]]["draft"]:
            pending.append((by_tag[p["tag"]], p))
    for release, p in pending:
        filename = f"{p['name']}-{p['version']}.zip"
        ensure_asset(api, release, filename, payloads[filename])
        ensure_asset(api, release, filename + ".sha256", f"{hashlib.sha256(payloads[filename]).hexdigest()}  {filename}\n".encode())
    for release, p, version, original_commit in historical:
        api.request("PATCH", f"releases/{release['id']}", {"name": f"{p['name']} v{version} · {p['displayName']}", "body": scope_notice(release.get("body") or "", release["tag_name"], original_commit), "make_latest": "false"})
    for release, _ in pending:
        api.request("PATCH", f"releases/{release['id']}", {"draft": False, "make_latest": "false"})
    final = api.request("PATCH", f"releases/{aggregate['id']}", {"name": plan["title"], "body": marketplace_notes(plan, catalog, commit, run_url), "draft": False, "prerelease": False, "make_latest": "true"})
    latest = api.request("GET", "releases/latest")
    require(latest["id"] == final["id"], "Latest 未指向市场快照")
    require(tag_commit(api, plan["tag"]) == commit, "发布后标签核验失败")
    print(json.dumps({"release": final["html_url"], "tag": plan["tag"], "commit": commit, "plugins": [p["name"] for p in catalog], "latestVerified": True}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "test-plugins", "build", "publish"))
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--commit")
    parser.add_argument("--output", type=Path, default=Path("dist/releases"))
    args = parser.parse_args()
    plan, catalog = load_catalog(args.root)
    if args.command == "check":
        print(f"{plan['tag']}：{len(catalog)} 个插件，目录/版本/验证范围一致")
    elif args.command == "test-plugins":
        for p in catalog:
            print(f"验证 {p['name']} {p['version']}", flush=True)
            subprocess.run(p["validation"]["command"], cwd=args.root / p["path"], check=True, timeout=300, shell=False)
    elif args.command == "build":
        build(args.root, args.commit, args.output)
    else:
        require(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY and os.environ.get("GITHUB_REF") == "refs/heads/main", "只允许本仓库 main 的 Actions 发布")
        require(os.environ.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch"), "不允许从 PR 等事件发布")
        require(args.commit == os.environ.get("GITHUB_SHA"), "发布 SHA 必须等于已验证工作流提交")
        token = os.environ.get("GITHUB_TOKEN")
        require(token, "缺少 Actions 发布令牌")
        publish(args.root, args.commit, args.output, GitHubAPI(token))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"发布中止：{error}", file=sys.stderr)
        sys.exit(1)
