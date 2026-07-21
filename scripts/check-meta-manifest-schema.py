#!/usr/bin/env python3
# check-meta-manifest-schema — deterministic, CLI-version-INDEPENDENT guard for the
# meta-bridge plugin manifests + the installed-vs-clone MCP wiring decision.
#
# Why this exists (0.12.2): `claude plugin validate` is a CLOSED schema — it REJECTS
# unrecognized keys, and the allowed keyset differs by Claude Code version. 0.12.1
# shipped a marketplace.json carrying a root `description`; Claude 2.1.195 (the dev
# box) accepted it, Claude 2.1.97 (the install floor) rejected it with
# `Unrecognized key: "description"`, so `entwurf install-meta-bridge` died on the
# floor host while the release looked green. The lesson: a "nice to have" decorative
# key in a closed-schema manifest is a future regression surface. This guard pins the
# committed manifests to the MINIMAL keyset confirmed to validate on the lowest
# supported Claude, independent of whatever CLI version happens to run here.
#
# It also asserts meta-bridge-state.py::desired_mcp() picks the stable `entwurf-bridge`
# bin for an installed package and the clone's start.sh for a dev clone (the other
# 0.12.1 install-surface fragility: baking the pnpm store path goes stale on peer bumps).
#
# Offline / hermetic. Deps: python3 only.
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
MB = REPO / "pi" / "meta-bridge"
STATE = HERE / "meta-bridge-state.py"

fail = 0


def ok(msg: str) -> None:
    print(f"  ok    {msg}")


def bad(msg: str) -> None:
    global fail
    print(f"  FAIL  {msg}")
    fail = 1


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        bad(f"cannot parse {path}: {exc}")
        return None


def subset(label: str, got, allowed: set[str]) -> None:
    if not isinstance(got, dict):
        bad(f"{label}: expected an object, got {type(got).__name__}")
        return
    extra = set(got) - allowed
    if extra:
        bad(f"{label}: keys {sorted(extra)} outside minimal allowed set {sorted(allowed)} "
            f"(closed-schema risk: an older Claude may reject them)")
    else:
        ok(f"{label}: keys ⊆ {sorted(allowed)}")


# --- marketplace.json --------------------------------------------------------
mkt = load(MB / ".claude-plugin" / "marketplace.json")
if mkt is not None:
    subset("marketplace root", mkt, {"name", "owner", "plugins"})
    subset("marketplace.owner", mkt.get("owner", {}), {"name"})
    plugins = mkt.get("plugins")
    if not isinstance(plugins, list) or not plugins:
        bad("marketplace.plugins must be a non-empty array")
    else:
        for i, p in enumerate(plugins):
            subset(f"marketplace.plugins[{i}]", p, {"name", "source", "description"})

# --- plugin.json -------------------------------------------------------------
plug = load(MB / "entwurf-meta-receive" / ".claude-plugin" / "plugin.json")
if plug is not None:
    subset("plugin.json", plug, {"name", "version", "description"})

# --- hooks.json --------------------------------------------------------------
hooks = load(MB / "entwurf-meta-receive" / "hooks" / "hooks.json")
if hooks is not None:
    subset("hooks.json root", hooks, {"hooks"})
    # Pin the hook EVENT names too — an unrecognized event key is the same closed-schema
    # risk as an unrecognized field. These four are the meta-bridge's load-bearing events.
    subset("hooks.json events", hooks.get("hooks") or {},
           {"SessionStart", "CwdChanged", "UserPromptSubmit", "FileChanged"})
    for event, entries in (hooks.get("hooks") or {}).items():
        if not isinstance(entries, list):
            bad(f"hooks.{event} must be an array")
            continue
        for j, entry in enumerate(entries):
            subset(f"hooks.{event}[{j}]", entry, {"matcher", "hooks"})
            for k, h in enumerate(entry.get("hooks", []) if isinstance(entry, dict) else []):
                # asyncRewake/timeout are load-bearing on the FileChanged doorbell —
                # allowed, NOT decorative. Anything beyond this set must be reviewed.
                subset(f"hooks.{event}[{j}].hooks[{k}]", h, {"type", "command", "asyncRewake", "timeout"})

    # Clean installed hosts may retain Claude's `/bin/bash -c` wrapper while NixOS
    # tail-execs the final hook command. Capture shell `$PPID` explicitly before
    # `exec`: the hook ancestry-validates this as the Claude/MCP owner. This is an
    # identity/liveness contract, not command decoration.
    expected_hook_command = (
        "ENTWURF_META_HOOK_OWNER_PID=$PPID exec "
        "__NODE_BIN__ ${CLAUDE_PLUGIN_ROOT}/__HOOK_ENTRY__"
    )
    for event in ("SessionStart", "CwdChanged", "UserPromptSubmit"):
        try:
            command = hooks["hooks"][event][0]["hooks"][0]["command"]
        except (KeyError, IndexError, TypeError):
            bad(f"hooks.{event}: cannot find load-bearing command hook")
            continue
        if command == expected_hook_command:
            ok(f"hooks.{event}: explicit $PPID owner carrier + exec topology contract")
        else:
            bad(f"hooks.{event}: owner command drifted; got {command!r}, want {expected_hook_command!r}")

# --- desired_mcp() installed-vs-clone dual-mode ------------------------------
def desired_mcp(repo: str):
    out = subprocess.run(
        [sys.executable, str(STATE), "desired-mcp", "--repo", repo],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        bad(f"desired-mcp --repo {repo} exited {out.returncode}: {out.stderr.strip()}")
        return None
    return json.loads(out.stdout)


# Both probes use SYNTHETIC paths that need not exist — never REPO. If this guard ran
# from an installed package (e.g. `entwurf check-meta-manifest-schema`), REPO would
# itself end in node_modules/@junghanacs/entwurf and a REPO-based clone probe would
# wrongly resolve to the installed shape and self-fail. Fixed, installed-vs-clone-shaped
# literals make the assertion location-independent.
installed = desired_mcp("/opt/x/node_modules/@junghanacs/entwurf")
if installed is not None:
    if installed.get("command") == "entwurf-bridge" and installed.get("args") == []:
        ok("desired_mcp(installed-shaped) → stable `entwurf-bridge` bin (no store path baked)")
    else:
        bad(f"desired_mcp(installed-shaped) should wire the `entwurf-bridge` bin, got {installed.get('command')} {installed.get('args')}")

clone = desired_mcp("/opt/entwurf-dev-clone")
if clone is not None:
    args = clone.get("args") or [""]
    if clone.get("command") == "bash" and str(args[0]).endswith("mcp/entwurf-bridge/start.sh"):
        ok("desired_mcp(clone-shaped) → that clone's start.sh (not the global bin)")
    else:
        bad(f"desired_mcp(clone-shaped) should wire bash start.sh, got {clone.get('command')} {args}")

# both modes must keep the canonical sender env
for label, entry in (("installed", installed), ("clone", clone)):
    if entry is None:
        continue
    env = entry.get("env", {})
    if env.get("ENTWURF_BRIDGE_REQUIRE_META_SENDER") == "1" and \
       env.get("ENTWURF_BRIDGE_EXTERNAL_AGENT_ID") == "external-mcp/claude-code":
        ok(f"desired_mcp({label}) carries canonical sender env")
    else:
        bad(f"desired_mcp({label}) dropped canonical sender env: {env}")

if fail:
    print("check-meta-manifest-schema FAIL")
    sys.exit(1)
print("check-meta-manifest-schema PASS")
