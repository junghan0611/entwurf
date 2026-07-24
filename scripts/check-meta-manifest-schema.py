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
# Scope correction (#51, 2026-07-22): "minimal" means no DECORATIVE keys. It never
# meant "no load-bearing keys", and the hook `args` array is load-bearing — it is the
# exec form. Measurement also retired the fear that motivated excluding it: an older
# Claude does not reject unknown hook keys, it accepts them and then silently discards
# the value at runtime while reporting success. A closed schema you cannot detect is
# not protection, so the protection moved to the version floor and the launcher.
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
                # asyncRewake/timeout are load-bearing on the FileChanged doorbell and
                # `args` is load-bearing on every hook (it IS the exec form) — allowed,
                # NOT decorative. Anything beyond this set must be reviewed.
                #
                # `args` was previously excluded on the theory that an older Claude's
                # closed schema might REJECT it. #51 B measured that theory and it is
                # false: 2.1.138 accepts the key (unknown-key passthrough), then drops
                # the array at runtime and reports the hook as `exit_code: 0,
                # outcome: success`. So the minimal keyset never bought protection from
                # that version — it only kept us on a launch form whose topology no host
                # could guarantee. The real defenses are the `>=2.1.217` floor
                # (check-claude-floor-coherence) and hook-launch.sh refusing an empty
                # argv. The marketplace/plugin manifests below stay minimal: the closed-
                # schema lesson that produced this gate was about a DECORATIVE key
                # (`description`), and that lesson is untouched.
                subset(f"hooks.{event}[{j}].hooks[{k}]", h, {"type", "command", "args", "asyncRewake", "timeout"})

    # Every hook launches through the shipped launcher in EXEC form: `command` is
    # hook-launch.sh and the baked argv travels in `args`. No shell is on the path, so
    # the hook's parent is Claude itself on every host — that is the identity contract
    # the retired `$PPID` carrier used to approximate. Asserted here as committed text;
    # check-hook-launch-topology drives it for real.
    expected_owner_command = "${CLAUDE_PLUGIN_ROOT}/scripts/hook-launch.sh"
    expected_owner_args = ["__NODE_BIN__", "${CLAUDE_PLUGIN_ROOT}/__HOOK_ENTRY__"]
    for event in ("SessionStart", "CwdChanged", "UserPromptSubmit"):
        try:
            leaf = hooks["hooks"][event][0]["hooks"][0]
            command, args = leaf["command"], leaf.get("args")
        except (KeyError, IndexError, TypeError):
            bad(f"hooks.{event}: cannot find load-bearing command hook")
            continue
        if command == expected_owner_command and args == expected_owner_args:
            ok(f"hooks.{event}: exec form through the shipped hook-launch.sh")
        else:
            bad(
                f"hooks.{event}: owner launch drifted; got command={command!r} args={args!r}, "
                f"want command={expected_owner_command!r} args={expected_owner_args!r}"
            )

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

# both modes must keep the canonical sender env. #50 C4: identity-required is the
# bridge DEFAULT, so the retired REQUIRE flag must stay gone — an installer that
# re-grows it would imply the default flipped back.
for label, entry in (("installed", installed), ("clone", clone)):
    if entry is None:
        continue
    env = entry.get("env", {})
    if env.get("ENTWURF_BRIDGE_EXTERNAL_AGENT_ID") == "external-mcp/claude-code" and \
       "ENTWURF_BRIDGE_REQUIRE_META_SENDER" not in env and \
       "ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER" not in env:
        ok(f"desired_mcp({label}) carries canonical sender env (no retired/escape flags)")
    else:
        bad(f"desired_mcp({label}) sender env drifted: {env}")

if fail:
    print("check-meta-manifest-schema FAIL")
    sys.exit(1)
print("check-meta-manifest-schema PASS")
