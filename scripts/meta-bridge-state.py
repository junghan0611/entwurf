#!/usr/bin/env python3
"""Stateful install/uninstall config manager for entwurf meta-bridge.

This is the Phase-2 honesty core: install records exactly what it touched before
writing, and uninstall restores/removes only those keys/items. No blind jq merge.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PLUGIN = "entwurf-meta-receive"
MARKETPLACE = "meta-bridge-local"
PLUGIN_REF = f"{PLUGIN}@{MARKETPLACE}"
STATE_VERSION = 1
OWNER = "entwurf meta-bridge"

PERMISSION_ALLOW = [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "WebFetch",
    "WebSearch",
    "Skill",
    "mcp__entwurf-bridge__*",
]

PERMISSION_DENY = [
    "Agent",
    "AskUserQuestion",
    "CronCreate",
    "CronDelete",
    "CronList",
    "EnterPlanMode",
    "ExitPlanMode",
    "EnterWorktree",
    "ExitWorktree",
    "Monitor",
    "NotebookEdit",
    "PushNotification",
    "TaskCreate",
    "TaskGet",
    "TaskList",
    "TaskOutput",
    "TaskStop",
    "TaskUpdate",
]

# Legacy permission-allow items from the pre-rename bridge name (pi-tools-bridge
# → entwurf-bridge). apply() prunes these so an old install's stale allow does
# not linger forever (append_unique only adds; it never removes). Parallel to
# install.sh's one-shot `claude mcp remove pi-tools-bridge`. Uninstall does not
# restore them — the tool no longer exists under the old name, and they were
# never user-authored items.
LEGACY_PERMISSION_ALLOW = ["mcp__pi-tools-bridge__*"]

# Claude Code single-driver policy scalars owned by entwurf for the native
# meta-bridge install. These are not theming/personal hooks; they close background
# autonomy/suggestion/compaction surfaces so Claude Code behaves like the same
# single forged screwdriver that entwurf already enforces for ACP backends.
MANAGED_SETTINGS_SCALARS: list[tuple[str, list[str], Any]] = [
    ("cleanupPeriodDays", ["cleanupPeriodDays"], 365),
    ("env.DISABLE_AUTOCOMPACT", ["env", "DISABLE_AUTOCOMPACT"], "1"),
    ("promptSuggestionEnabled", ["promptSuggestionEnabled"], False),
    ("awaySummaryEnabled", ["awaySummaryEnabled"], False),
    ("autoMemoryEnabled", ["autoMemoryEnabled"], False),
    ("skipDangerousModePermissionPrompt", ["skipDangerousModePermissionPrompt"], True),
    ("verbose", ["verbose"], False),
    ("autoCompactEnabled", ["autoCompactEnabled"], False),
    ("showTurnDuration", ["showTurnDuration"], False),
    ("terminalProgressBarEnabled", ["terminalProgressBarEnabled"], False),
    ("useAutoModeDuringPlan", ["useAutoModeDuringPlan"], False),
]


class StateError(RuntimeError):
    pass


def die(msg: str) -> None:
    raise StateError(msg)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def claude_config_dir() -> Path:
    raw = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(raw).expanduser().resolve() if raw else (Path.home() / ".claude")


def settings_path() -> Path:
    return claude_config_dir() / "settings.json"


def state_path() -> Path:
    return claude_config_dir() / "entwurf.install-state.json"


def claude_root_config_path() -> Path:
    # Claude Code user-scope MCP is stored in ~/.claude.json (not in
    # ~/.claude/settings.json). In tests HOME is isolated, so this remains safe.
    return Path.home() / ".claude.json"


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return copy.deepcopy(default)
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        die(f"{path} is not valid JSON: {exc}")


def write_json(path: Path, value: Any, mode: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")
    if mode is not None:
        os.chmod(tmp, mode)
    tmp.replace(path)


def load_state(required: bool) -> dict[str, Any] | None:
    path = state_path()
    if not path.exists():
        if required:
            die(f"install state missing: {path}. Honest uninstall/check requires the state file.")
        return None
    state = read_json(path, {})
    if not isinstance(state, dict) or state.get("schemaVersion") != STATE_VERSION or state.get("owner") != OWNER:
        die(f"invalid install state schema: {path}")
    return state


def init_state(repo: Path, asm: Path) -> dict[str, Any]:
    return {
        "schemaVersion": STATE_VERSION,
        "owner": OWNER,
        "createdAt": iso_now(),
        "updatedAt": iso_now(),
        "repo": str(repo.resolve()),
        "assembledMarketplacePath": str(asm.resolve()),
        "files": {
            "settings": {"path": str(settings_path()), "keys": {}},
            "claudeRoot": {"path": str(claude_root_config_path()), "keys": {}},
        },
    }


def ensure_object(parent: dict[str, Any], key: str, label: str) -> dict[str, Any]:
    value = parent.get(key)
    if value is None:
        value = {}
        parent[key] = value
    if not isinstance(value, dict):
        die(f"{label} must be an object before entwurf can manage a child key")
    return value


def get_nested(obj: dict[str, Any], path: list[str]) -> tuple[bool, Any]:
    cur: Any = obj
    for key in path[:-1]:
        if not isinstance(cur, dict) or key not in cur:
            return False, None
        cur = cur[key]
    if not isinstance(cur, dict) or path[-1] not in cur:
        return False, None
    return True, cur[path[-1]]


def set_nested(obj: dict[str, Any], path: list[str], value: Any) -> None:
    cur = obj
    for key in path[:-1]:
        cur = ensure_object(cur, key, ".".join(path[:-1]))
    cur[path[-1]] = value


def delete_nested(obj: dict[str, Any], path: list[str]) -> None:
    cur: Any = obj
    parents: list[tuple[dict[str, Any], str]] = []
    for key in path[:-1]:
        if not isinstance(cur, dict) or key not in cur:
            return
        parents.append((cur, key))
        cur = cur[key]
    if isinstance(cur, dict):
        cur.pop(path[-1], None)
    # Prune empty objects created only for our key path. Stop before deleting the
    # root document.
    for parent, key in reversed(parents):
        child = parent.get(key)
        if isinstance(child, dict) and not child:
            parent.pop(key, None)
        else:
            break


def snapshot_value(
    state: dict[str, Any],
    file_key: str,
    name: str,
    obj: dict[str, Any],
    path: list[str],
    kind: str,
    legacy_absent_if_equal: Any = None,
) -> None:
    keys = state["files"][file_key]["keys"]
    if name in keys:
        return
    existed, value = get_nested(obj, path)
    # Phase-2 migration path: GLG's machine already had the Phase-0/1 tribal
    # installer live before the state file existed. If an exact entwurf
    # managed value is present with no state, treating it as "original" would make
    # uninstall restore the legacy install instead of removing it. Exact-match
    # migration is limited to pi-owned identity keys (plugin/marketplace/MCP), not
    # user-like policy keys such as permissions/env.
    if existed and legacy_absent_if_equal is not None and value == legacy_absent_if_equal:
        existed = False
        value = None
    keys[name] = {"kind": kind, "path": path, "original": {"existed": existed, "value": copy.deepcopy(value)}}


def snapshot_array_items(
    state: dict[str, Any], file_key: str, name: str, obj: dict[str, Any], path: list[str], desired: list[str]
) -> None:
    keys = state["files"][file_key]["keys"]
    existed, value = get_nested(obj, path)
    if existed and not isinstance(value, list):
        die(f"{'.'.join(path)} exists but is not an array; refusing to merge managed permission items")
    current = value if isinstance(value, list) else []
    if name in keys:
        # Preserve the first-install additions, but if the managed baseline grew
        # since then, add only the truly new managed entries.
        entry = keys[name]
        if entry.get("kind") != "array-items":
            die(f"state entry {name} kind mismatch")
        added = list(entry.get("added", []))
        original_values = set(current) - set(added)
        for item in desired:
            if item not in original_values and item not in added:
                added.append(item)
        entry["added"] = added
        return
    added = [item for item in desired if item not in current]
    keys[name] = {"kind": "array-items", "path": path, "originalExisted": existed, "added": added}


def desired_marketplace(asm: Path) -> dict[str, Any]:
    return {"source": {"source": "directory", "path": str(asm.resolve())}}


def desired_mcp(repo: Path) -> dict[str, Any]:
    return {
        "type": "stdio",
        "command": "bash",
        "args": [str((repo / "mcp" / "entwurf-bridge" / "start.sh").resolve())],
        "env": {
            "ENTWURF_BRIDGE_EXTERNAL_AGENT_ID": "external-mcp/claude-code",
            # Anonymous sends are forbidden on the Claude Code install path: a send
            # with no pi-session identity AND no meta-sender marker is refused, not
            # delivered as an unidentified external. The SessionStart hook writes
            # the marker (parent-pid keyed), so a normally-opened session always has
            # an authoritative garden-id sender.
            "ENTWURF_BRIDGE_REQUIRE_META_SENDER": "1",
        },
    }


def desired_statusline(repo: Path) -> dict[str, Any]:
    return {"type": "command", "command": str((repo / "scripts" / "meta-bridge-statusline.sh").resolve())}


def prepare(repo: Path, asm: Path) -> None:
    existing = load_state(required=False)
    state = existing if existing is not None else init_state(repo, asm)
    state["updatedAt"] = iso_now()
    state["repo"] = str(repo.resolve())
    state["assembledMarketplacePath"] = str(asm.resolve())

    settings = read_json(settings_path(), {})
    root = read_json(claude_root_config_path(), {})
    if not isinstance(settings, dict):
        die(f"{settings_path()} root must be a JSON object")
    if not isinstance(root, dict):
        die(f"{claude_root_config_path()} root must be a JSON object")

    snapshot_value(
        state,
        "settings",
        f"enabledPlugins.{PLUGIN_REF}",
        settings,
        ["enabledPlugins", PLUGIN_REF],
        "map-entry",
        legacy_absent_if_equal=True,
    )
    snapshot_value(
        state,
        "settings",
        f"extraKnownMarketplaces.{MARKETPLACE}",
        settings,
        ["extraKnownMarketplaces", MARKETPLACE],
        "map-entry",
        legacy_absent_if_equal=desired_marketplace(asm),
    )
    snapshot_array_items(state, "settings", "permissions.allow", settings, ["permissions", "allow"], PERMISSION_ALLOW)
    snapshot_array_items(state, "settings", "permissions.deny", settings, ["permissions", "deny"], PERMISSION_DENY)
    for name, path_, _desired in MANAGED_SETTINGS_SCALARS:
        snapshot_value(state, "settings", name, settings, path_, "scalar")
    snapshot_value(
        state,
        "settings",
        "statusLine",
        settings,
        ["statusLine"],
        "map-entry",
        legacy_absent_if_equal=desired_statusline(repo),
    )
    snapshot_value(
        state,
        "claudeRoot",
        "mcpServers.entwurf-bridge",
        root,
        ["mcpServers", "entwurf-bridge"],
        "map-entry",
        legacy_absent_if_equal=desired_mcp(repo),
    )

    write_json(state_path(), state, mode=0o600)
    print(f"[meta-bridge-state] prepared {state_path()}")


def append_unique(current: list[Any], additions: list[str]) -> list[Any]:
    out = list(current)
    for item in additions:
        if item not in out:
            out.append(item)
    return out


def apply(repo: Path, asm: Path) -> None:
    state = load_state(required=True)
    assert state is not None
    settings = read_json(settings_path(), {})
    root = read_json(claude_root_config_path(), {})
    if not isinstance(settings, dict):
        die(f"{settings_path()} root must be a JSON object")
    if not isinstance(root, dict):
        die(f"{claude_root_config_path()} root must be a JSON object")

    set_nested(settings, ["enabledPlugins", PLUGIN_REF], True)
    set_nested(settings, ["extraKnownMarketplaces", MARKETPLACE], desired_marketplace(asm))
    for path_, desired in [(["permissions", "allow"], PERMISSION_ALLOW), (["permissions", "deny"], PERMISSION_DENY)]:
        existed, value = get_nested(settings, path_)
        if existed and not isinstance(value, list):
            die(f"{'.'.join(path_)} exists but is not an array; refusing to merge managed permission items")
        merged = append_unique(value if isinstance(value, list) else [], desired)
        if path_ == ["permissions", "allow"]:
            merged = [item for item in merged if item not in LEGACY_PERMISSION_ALLOW]
        set_nested(settings, path_, merged)
    for _name, path_, desired in MANAGED_SETTINGS_SCALARS:
        set_nested(settings, path_, desired)
    set_nested(settings, ["statusLine"], desired_statusline(repo))
    set_nested(root, ["mcpServers", "entwurf-bridge"], desired_mcp(repo))

    state["updatedAt"] = iso_now()
    state["repo"] = str(repo.resolve())
    state["assembledMarketplacePath"] = str(asm.resolve())
    write_json(settings_path(), settings)
    write_json(claude_root_config_path(), root)
    write_json(state_path(), state, mode=0o600)
    print("[meta-bridge-state] applied managed keyset (settings.json + user MCP)")


def restore_entry(obj: dict[str, Any], entry: dict[str, Any]) -> None:
    path = entry.get("path")
    if not isinstance(path, list) or not all(isinstance(p, str) for p in path):
        die("bad state entry path")
    kind = entry.get("kind")
    if kind in ("map-entry", "scalar"):
        original = entry.get("original")
        if not isinstance(original, dict):
            die("bad scalar/map original in state")
        if original.get("existed"):
            set_nested(obj, path, copy.deepcopy(original.get("value")))
        else:
            delete_nested(obj, path)
        return
    if kind == "array-items":
        existed, value = get_nested(obj, path)
        if existed and not isinstance(value, list):
            die(f"{'.'.join(path)} exists but is not an array; refusing to uninstall managed permission items")
        added = entry.get("added", [])
        if not isinstance(added, list):
            die("bad array added list in state")
        current = value if isinstance(value, list) else []
        remaining = [item for item in current if item not in added]
        if remaining or entry.get("originalExisted"):
            set_nested(obj, path, remaining)
        else:
            delete_nested(obj, path)
        return
    die(f"unknown state entry kind: {kind}")


def preflight_uninstall() -> None:
    load_state(required=True)
    print(f"[meta-bridge-state] uninstall preflight ok ({state_path()})")


def uninstall() -> None:
    state = load_state(required=True)
    assert state is not None
    settings = read_json(settings_path(), {})
    root = read_json(claude_root_config_path(), {})
    if not isinstance(settings, dict):
        die(f"{settings_path()} root must be a JSON object")
    if not isinstance(root, dict):
        die(f"{claude_root_config_path()} root must be a JSON object")

    for entry in state["files"]["settings"]["keys"].values():
        restore_entry(settings, entry)
    for entry in state["files"]["claudeRoot"]["keys"].values():
        restore_entry(root, entry)

    write_json(settings_path(), settings)
    write_json(claude_root_config_path(), root)
    state_path().unlink(missing_ok=True)
    print("[meta-bridge-state] restored managed keyset and removed install state")


def managed_keys() -> dict[str, Any]:
    """The SSOT of settings.json / ~/.claude.json keys entwurf OWNS.

    Derived from the same constants install/apply/check use, so there is one
    source of truth for "which keys are ours". Cross-repo consumers (the keyset
    overlap guard, agent-config's fragment) read THIS to know which keys they
    must NOT also set — the keyset-owner invariant ("each side sets only its own
    keys, never breaks the other's"). Paths are dotted; a parent path (e.g.
    `statusLine`) owns the whole subtree below it.
    """
    return {
        "owner": OWNER,
        "settings": {
            "scalar": [name for name, _path, _desired in MANAGED_SETTINGS_SCALARS],
            "array-items": ["permissions.allow", "permissions.deny"],
            "map-entry": [
                f"enabledPlugins.{PLUGIN_REF}",
                f"extraKnownMarketplaces.{MARKETPLACE}",
                "statusLine",
            ],
        },
        "claudeRoot": {
            "map-entry": ["mcpServers.entwurf-bridge"],
        },
    }


def check(repo: Path, asm: Path) -> None:
    state = load_state(required=True)
    assert state is not None
    settings = read_json(settings_path(), {})
    root = read_json(claude_root_config_path(), {})
    failures: list[str] = []
    if not isinstance(settings, dict):
        failures.append(f"{settings_path()} root is not an object")
        settings = {}
    if not isinstance(root, dict):
        failures.append(f"{claude_root_config_path()} root is not an object")
        root = {}

    checks = [
        (["enabledPlugins", PLUGIN_REF], True, "enabled plugin"),
        (["extraKnownMarketplaces", MARKETPLACE], desired_marketplace(asm), "known marketplace"),
        (["statusLine"], desired_statusline(repo), "statusLine"),
    ] + [(path_, desired, name) for name, path_, desired in MANAGED_SETTINGS_SCALARS]
    for path_, expected, label in checks:
        existed, value = get_nested(settings, path_)
        if not existed or value != expected:
            failures.append(f"settings {label} missing/drifted at {'.'.join(path_)}")
    for path_, desired, label in [(["permissions", "allow"], PERMISSION_ALLOW, "allow"), (["permissions", "deny"], PERMISSION_DENY, "deny")]:
        existed, value = get_nested(settings, path_)
        if not existed or not isinstance(value, list):
            failures.append(f"settings permissions.{label} missing/not array")
        else:
            missing = [item for item in desired if item not in value]
            if missing:
                failures.append(f"settings permissions.{label} missing managed item(s): {', '.join(missing)}")
            if path_ == ["permissions", "allow"]:
                legacy = [item for item in LEGACY_PERMISSION_ALLOW if item in value]
                if legacy:
                    failures.append(f"settings permissions.allow carries pruned legacy item(s): {', '.join(legacy)} (re-inject — re-run install-meta-bridge to prune)")
    existed, value = get_nested(root, ["mcpServers", "entwurf-bridge"])
    if not existed or value != desired_mcp(repo):
        failures.append("user MCP entwurf-bridge missing/drifted in ~/.claude.json")

    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        raise SystemExit(1)
    print(f"[meta-bridge-state] check ok ({state_path()})")


def main() -> int:
    parser = argparse.ArgumentParser(description="entwurf meta-bridge state manager")
    parser.add_argument(
        "command",
        choices=["prepare", "apply", "preflight-uninstall", "uninstall", "check", "managed-keys"],
    )
    parser.add_argument("--repo", default=Path(__file__).resolve().parents[1], type=Path)
    parser.add_argument("--asm", default=None, type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    asm = (args.asm or (repo / "pi" / "meta-bridge" / ".assembled")).resolve()
    try:
        if args.command == "prepare":
            prepare(repo, asm)
        elif args.command == "apply":
            apply(repo, asm)
        elif args.command == "preflight-uninstall":
            preflight_uninstall()
        elif args.command == "uninstall":
            uninstall()
        elif args.command == "check":
            check(repo, asm)
        elif args.command == "managed-keys":
            print(json.dumps(managed_keys(), indent=2))
    except StateError as exc:
        print(f"meta-bridge-state: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
