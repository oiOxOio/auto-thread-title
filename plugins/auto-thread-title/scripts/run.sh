#!/bin/sh
# No login shell, package manager, profile sourcing, or dependency installation.
# This wrapper deliberately leaves stdin untouched for the hook JSON payload.
set -u

mode=${1-}

fail() {
    printf '%s\n' "auto-thread-title: $*" >&2
    if [ "$mode" = hook ]; then
        exit 0
    fi
    exit 1
}

script_parent=${0%/*}
if [ "$script_parent" = "$0" ]; then script_parent=.; fi
script_dir=$(CDPATH= cd -P "$script_parent" 2>/dev/null && pwd -P) ||
    fail 'Cannot resolve the launcher directory. Reinstall the plugin from its trusted source.'
cli_path=$script_dir/../src/cli.mjs
[ -f "$cli_path" ] || fail 'Missing src/cli.mjs. Reinstall the complete plugin from its trusted source.'

usable_node() {
    [ -n "$1" ] && [ -f "$1" ] && [ -x "$1" ] || return 1
    # stdin belongs to the eventual CLI, not to runtime detection.
    version=$("$1" -p 'process.versions.node' </dev/null 2>/dev/null) || return 1
    major=${version%%.*}
    case "$major" in ''|*[!0-9]*) return 1 ;; esac
    [ "$major" -ge 22 ] 2>/dev/null
}

node_path=
if [ -n "${AUTO_THREAD_TITLE_NODE-}" ]; then
    usable_node "$AUTO_THREAD_TITLE_NODE" ||
        fail 'AUTO_THREAD_TITLE_NODE must name an executable Node.js 22+ binary. Correct or unset the override, then run doctor in the same Codex environment.'
    node_path=$AUTO_THREAD_TITLE_NODE
else
    if [ -n "${CODEX_PRIMARY_RUNTIME_NODE-}" ] && usable_node "$CODEX_PRIMARY_RUNTIME_NODE"; then
        node_path=$CODEX_PRIMARY_RUNTIME_NODE
    fi
    if [ -z "$node_path" ]; then
        path_node=$(command -v node 2>/dev/null || :)
        if usable_node "$path_node"; then node_path=$path_node; fi
    fi
    if [ -z "$node_path" ]; then
        for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
            if usable_node "$candidate"; then node_path=$candidate; break; fi
        done
    fi
fi

[ -n "$node_path" ] ||
    fail 'Node.js 22+ was not found. Install a supported Node.js runtime or set AUTO_THREAD_TITLE_NODE to its absolute executable path, restart Codex, then run doctor. Nothing was installed automatically.'

# exec preserves stdin, Unicode/space-containing arguments, signals, and exit code.
exec "$node_path" "$cli_path" "$@"
