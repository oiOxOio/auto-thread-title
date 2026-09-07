"""Read-only, cursor-complete inventory of locally indexed Codex tasks.

No database writes, transcript reads, model turns, or rename endpoints.
Only initialize / initialized / thread/list are sent to the local app-server.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


TYPES = ("功能", "设计", "修复", "优化", "发布", "探索", "文档", "研究")
TITLE_RE = re.compile(r"(\d{4}) \| (" + "|".join(TYPES) + r") \| ([^|｜·\r\n]{1,18})")
SOURCE_KINDS = ["cli", "vscode", "appServer", "exec", "unknown"]


def shanghai_mmdd(created_at):
    """Never substitute updatedAt; skip invalid/unsupported historical dates."""
    if isinstance(created_at, bool) or not isinstance(created_at, int):
        return None
    try:
        utc = datetime.fromtimestamp(created_at, timezone.utc)
        try:
            shanghai = ZoneInfo("Asia/Shanghai")
        except ZoneInfoNotFoundError:
            # Windows may have no IANA tzdata. Shanghai has used UTC+8 without
            # DST since 1992. Do not approximate older timestamps.
            if utc.year < 1992:
                return None
            shanghai = timezone(timedelta(hours=8))
        return utc.astimezone(shanghai).strftime("%m%d")
    except (ValueError, OverflowError, OSError):
        return None


def is_formatted(title, mmdd, cwd):
    if not isinstance(title, str) or not mmdd:
        return False
    match = TITLE_RE.fullmatch(title)
    if not match or match[1] != mmdd or match[3] != match[3].strip():
        return False
    folder = re.split(r"[/\\]", str(cwd).rstrip("/\\"))[-1]
    aliases = {folder.casefold(), re.sub(r"-mixing$", "", folder, flags=re.I).casefold()}
    topic = match[3].casefold()
    return not any(alias and alias in topic for alias in aliases)


def collect_tasks(request, page_size=100, max_pages=1000):
    """Finish BOTH archive states or raise; never return a partial success."""
    tasks = {}
    page_count = 0
    for archived in (False, True):
        cursor = None
        seen_cursors = set()
        for _ in range(max_pages):
            params = {
                "limit": page_size,
                "sortKey": "created_at",
                "sortDirection": "desc",
                "modelProviders": [],
                "sourceKinds": SOURCE_KINDS,
                "archived": archived,
                "useStateDbOnly": True,
            }
            if cursor is not None:
                params["cursor"] = cursor
            page = request("thread/list", params)
            page_count += 1
            if not isinstance(page, dict) or not isinstance(page.get("data"), list) or "nextCursor" not in page:
                raise RuntimeError("Invalid thread/list response; inventory is incomplete")
            for thread in page["data"]:
                if not isinstance(thread, dict) or not isinstance(thread.get("id"), str) or not thread["id"]:
                    raise RuntimeError("Invalid task identity; inventory is incomplete")
                source = thread.get("source")
                if (thread.get("ephemeral") or thread.get("parentThreadId")
                        or thread.get("agentRole") or thread.get("agentNickname")
                        or not isinstance(source, str) or source not in SOURCE_KINDS):
                    continue
                mmdd = shanghai_mmdd(thread.get("createdAt"))
                row = {
                    "id": thread["id"],
                    "title": thread.get("name"),
                    "createdAt": thread.get("createdAt"),
                    "mmdd": mmdd,
                    "cwd": thread.get("cwd"),
                    "archived": archived,
                    "formatted": is_formatted(thread.get("name"), mmdd, thread.get("cwd", "")),
                }
                if row["id"] in tasks and tasks[row["id"]] != row:
                    raise RuntimeError("Task changed during pagination; rerun the read-only inventory")
                tasks[row["id"]] = row
            cursor = page["nextCursor"]
            if cursor is None:
                break
            if not isinstance(cursor, str) or not cursor or cursor in seen_cursors:
                raise RuntimeError("Invalid or repeated pagination cursor; inventory is incomplete")
            seen_cursors.add(cursor)
        else:
            raise RuntimeError("Pagination safety limit reached; inventory is incomplete")
    rows = sorted(tasks.values(), key=lambda row: (
        row["createdAt"] if isinstance(row["createdAt"], int) else 0, row["id"]), reverse=True)
    return {"complete": True, "scope": "local-indexed-codex", "pages": page_count,
            "total": len(rows), "archived": sum(row["archived"] for row in rows),
            "needsReview": sum(not row["formatted"] for row in rows), "tasks": rows}


class ReadOnlyAppServer:
    def __init__(self, executable, timeout=30):
        self.executable = executable
        self.timeout = timeout
        self.responses = queue.Queue()
        self.sequence = 0
        self.process = None

    def __enter__(self):
        self.process = subprocess.Popen(
            [self.executable, "app-server", "--listen", "stdio://"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        try:
            self.request("initialize", {"clientInfo": {"name": "auto_thread_title_inventory", "version": "1.0.0"}})
            self._send({"method": "initialized", "params": {}})
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def _read_stdout(self):
        try:
            for line in self.process.stdout:
                try:
                    message = json.loads(line)
                except ValueError:
                    # Windows CLI launchers may print a code-page banner.
                    # It is not an RPC response and must not be executed.
                    continue
                if isinstance(message, dict) and "id" in message:
                    self.responses.put(message)
        except (OSError, ValueError):
            pass
        finally:
            self.responses.put(None)

    def _send(self, message):
        if message.get("method") not in {"initialize", "initialized", "thread/list"}:
            raise ValueError("Only read-only inventory methods are allowed")
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def request(self, method, params):
        if method not in {"initialize", "thread/list"}:
            raise ValueError("Only read-only inventory methods are allowed")
        self.sequence += 1
        request_id = self.sequence
        self._send({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                response = self.responses.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty as exc:
                raise RuntimeError("Local app-server request timed out; no titles changed") from exc
            if response is None:
                raise RuntimeError("Local app-server closed before completing inventory")
            if response.get("id") != request_id:
                continue
            if "error" in response:
                # Do not echo server data containing local paths or task content.
                raise RuntimeError("Local app-server rejected the read-only request; check CLI compatibility")
            return response.get("result")

    def __exit__(self, *_):
        if self.process is None:
            return
        self.process.stdin.close()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        self.process.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex", help="Path to the local Codex CLI (defaults to PATH)")
    parser.add_argument("--page-size", type=int, choices=range(1, 201), default=100, metavar="1..200")
    parser.add_argument("--needs-review", action="store_true", help="Omit structurally compliant titles from tasks")
    parser.add_argument("--summary-only", action="store_true", help="Print counts only, with no task data")
    args = parser.parse_args()
    executable = args.codex or shutil.which("codex")
    if not executable:
        parser.exit(1, "Codex CLI not found; no titles changed.\n")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        with ReadOnlyAppServer(executable) as client:
            result = collect_tasks(client.request, args.page_size)
        if args.summary_only:
            result.pop("tasks")
        elif args.needs_review:
            result["tasks"] = [row for row in result["tasks"] if not row["formatted"]]
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(json.dumps({"complete": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
