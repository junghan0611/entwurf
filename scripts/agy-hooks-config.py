#!/usr/bin/env python3
"""agy-hooks-config — JSON state ops for Antigravity hooks.json imprint wiring.

Owns one top-level named hook, `entwurf-agy-imprint`, preserving every other
hook. The command is the bare stable bin `entwurf-agy-imprint`.
"""

import json
import os
import sys
import time

HOOK_KEY = "entwurf-agy-imprint"
LEGACY_HOOK_KEYS = (HOOK_KEY, "agy-birth-probe")
EVENT = "PreInvocation"
OUR_COMMAND = "entwurf-agy-imprint"
STATE_SCHEMA_VERSION = 1


def die(code: int, msg: str) -> None:
    sys.stderr.write(msg.rstrip("\n") + "\n")
    sys.exit(code)


def atomic_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    if raw.strip() == "":
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        die(4, f"agy-hooks: {path} is not valid JSON: {err}")
    if not isinstance(data, dict):
        die(4, f"agy-hooks: {path} top-level must be a JSON object")
    return data


def dump(data: dict) -> str:
    return json.dumps(data, indent=2) + "\n"


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def hook_value(command: str) -> dict:
    return {EVENT: [{"type": "command", "command": command}]}


def hook_command(value) -> str | None:
    if not isinstance(value, dict):
        return None
    handlers = value.get(EVENT)
    if not isinstance(handlers, list):
        return None
    for item in handlers:
        if isinstance(item, dict) and item.get("type") == "command" and isinstance(item.get("command"), str):
            return item["command"]
    return None


def prior_state(state_path: str, hooks_path: str) -> dict:
    """The state of OUR FIRST install of this exact hooks file, if we are re-installing over it.

    Empty when there is no prior install, or when it managed a DIFFERENT path (a re-target is a
    fresh install for that path). See the note in cmd_install for why this exists.
    """
    if not os.path.exists(state_path):
        return {}
    prior = load_json(state_path)
    if prior.get("managedHooksPath") != os.path.abspath(hooks_path):
        return {}
    return prior


def cmd_install(hooks_path: str, command: str, state_path: str) -> None:
    if os.path.islink(hooks_path):
        die(3, f"agy-hooks: refusing to adopt {hooks_path} — it is a symlink to {os.readlink(hooks_path)} (someone else's SSOT).")
    existed = os.path.exists(hooks_path)
    if existed:
        data = load_json(hooks_path)
        mode = "adopt-regular-file"
    else:
        data = {}
        mode = "created-new"
    # Capture the preimage ONLY on the first install of this target. An installer is re-run on every
    # upgrade; re-capturing here would record OUR OWN previous hook as "what was there before", and
    # uninstall would then faithfully restore us — leaving behind the exact thing it exists to
    # remove. Provenance is a fact about a moment that has passed: record it once, carry it forward.
    prior = prior_state(state_path, hooks_path)
    if prior:
        preimage = prior.get("preimage", None)
        mode = prior.get("detectMode", mode)
        existed = prior.get("hooksExistedBefore", existed)
    else:
        preimage = data.get(HOOK_KEY, None)
    data[HOOK_KEY] = hook_value(command)
    atomic_write(hooks_path, dump(data))
    state = {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "managedHooksPath": os.path.abspath(hooks_path),
        "hookKey": HOOK_KEY,
        "event": EVENT,
        "command": command,
        "detectMode": mode,
        "hooksExistedBefore": existed,
        "preimage": preimage,
        "installedAt": now(),
    }
    atomic_write(state_path, dump(state))
    sys.stdout.write(f"{mode} {os.path.abspath(hooks_path)}\n")


def cmd_uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        die(2, f"agy-hooks: no install-state at {state_path} — nothing to uninstall")
    state = load_json(state_path)
    hooks_path = state.get("managedHooksPath")
    if not isinstance(hooks_path, str):
        die(4, f"agy-hooks: install-state {state_path} has no managedHooksPath")
    if os.path.islink(hooks_path):
        die(3, f"agy-hooks: refusing to uninstall — {hooks_path} became a symlink since install")
    if os.path.exists(hooks_path):
        data = load_json(hooks_path)
        preimage = state.get("preimage", None)
        if preimage is None:
            data.pop(HOOK_KEY, None)
        else:
            data[HOOK_KEY] = preimage
        created_new = state.get("detectMode") == "created-new" and state.get("hooksExistedBefore") is False
        if created_new and len(data) == 0:
            os.remove(hooks_path)
        else:
            atomic_write(hooks_path, dump(data))
    os.remove(state_path)
    sys.stdout.write(f"uninstalled {hooks_path}\n")


def same_path(left: str, right: str) -> bool:
    try:
        return os.path.realpath(left) == os.path.realpath(right)
    except Exception:
        return os.path.abspath(left) == os.path.abspath(right)


def legacy_owned_keys(data: dict) -> list[str]:
    return [key for key in LEGACY_HOOK_KEYS if key in data]


def cmd_cleanup_legacy(legacy_path: str, active_path: str) -> None:
    if same_path(legacy_path, active_path):
        sys.stdout.write("same-path\n")
        return
    if not os.path.lexists(legacy_path):
        sys.stdout.write("absent\n")
        return
    if os.path.islink(legacy_path):
        die(3, f"agy-hooks: refusing to clean legacy {legacy_path} — it is a symlink to {os.readlink(legacy_path)} (someone else's SSOT).")
    data = load_json(legacy_path)
    removed = legacy_owned_keys(data)
    if not removed:
        sys.stdout.write("clean\n")
        return
    for key in removed:
        data.pop(key, None)
    if data:
        atomic_write(legacy_path, dump(data))
    else:
        os.remove(legacy_path)
    sys.stdout.write(f"removed {','.join(removed)}\n")


def cmd_doctor_legacy(legacy_path: str, active_path: str) -> None:
    if same_path(legacy_path, active_path):
        sys.stdout.write("same-path\n")
        return
    if not os.path.lexists(legacy_path):
        sys.stdout.write("absent\n")
        return
    if os.path.islink(legacy_path):
        sys.stdout.write(f"symlink {os.readlink(legacy_path)}\n")
        return
    try:
        data = load_json(legacy_path)
    except SystemExit:
        sys.stdout.write("invalid-json\n")
        return
    owned = legacy_owned_keys(data)
    if owned:
        sys.stdout.write(f"owned {','.join(owned)}\n")
        return
    sys.stdout.write("clean\n")


def cmd_doctor_static(hooks_path: str) -> None:
    real = os.path.realpath(hooks_path)
    if not os.path.exists(real):
        sys.stdout.write("file-absent\n")
        return
    try:
        with open(real, "r", encoding="utf-8") as fh:
            data = json.loads(fh.read() or "{}")
    except (json.JSONDecodeError, OSError):
        sys.stdout.write("invalid-json\n")
        return
    if not isinstance(data, dict):
        sys.stdout.write("invalid-json\n")
        return
    value = data.get(HOOK_KEY)
    cmd = hook_command(value)
    if not cmd:
        sys.stdout.write("not-configured\n")
        return
    if cmd != OUR_COMMAND:
        sys.stdout.write("not-ours\n")
        return
    sys.stdout.write(f"configured {cmd}\n")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: agy-hooks-config.py <install|uninstall|doctor-static> ...")
    if argv[1] == "install":
        if len(argv) != 5:
            die(5, "usage: agy-hooks-config.py install <hooks_path> <command> <state_path>")
        cmd_install(argv[2], argv[3], argv[4])
    elif argv[1] == "uninstall":
        if len(argv) != 3:
            die(5, "usage: agy-hooks-config.py uninstall <state_path>")
        cmd_uninstall(argv[2])
    elif argv[1] == "doctor-static":
        if len(argv) != 3:
            die(5, "usage: agy-hooks-config.py doctor-static <hooks_path>")
        cmd_doctor_static(argv[2])
    elif argv[1] == "cleanup-legacy":
        if len(argv) != 4:
            die(5, "usage: agy-hooks-config.py cleanup-legacy <legacy_hooks_path> <active_hooks_path>")
        cmd_cleanup_legacy(argv[2], argv[3])
    elif argv[1] == "doctor-legacy":
        if len(argv) != 4:
            die(5, "usage: agy-hooks-config.py doctor-legacy <legacy_hooks_path> <active_hooks_path>")
        cmd_doctor_legacy(argv[2], argv[3])
    else:
        die(5, f"agy-hooks-config.py: unknown subcommand {argv[1]!r}")


if __name__ == "__main__":
    main(sys.argv)
