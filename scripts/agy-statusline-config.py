#!/usr/bin/env python3
"""agy-statusline-config — JSON state ops for the agy (Antigravity) statusLine install adapter
(#46 Task 1). SEPARATE from agy-bridge (mcp_config) and from the Claude meta-bridge; only the
reporting/runner shell is shared. stdlib only.

Owns the WHOLE `statusLine` subtree of agy's settings.json (봉인계약 4 statusLine판 + GPT G5-2:
statusLine.command partial-ownership collides with whole-subtree ownership). The command written
is ALWAYS the bare stable bin `entwurf-agy-statusline` (dev AND installed — #46 tripwire; the
checkout path lives only in the dev-bin symlink state, never in this settings file).

Subcommands (argv[1]):
  install   <settings_path> <command> <state_path>
      Adopt agy settings.json and set statusLine = {type:"custom", command:<command>,
      enabled:true} (the WHOLE subtree). REFUSES a symlink target (exit 3 — someone else's SSOT,
      e.g. an agent-config link). The prior statusLine subtree (or None if absent) is captured as
      the preimage for an honest inverse. Unrelated keys (model/permissions/…) are preserved.
      Absent file is created. Invalid JSON fails loud (exit 4). Writes install-state atomically.

  uninstall <state_path>
      Honest inverse: restore the captured statusLine preimage (remove the key if it was absent,
      else set it back). If WE created the whole file and nothing else remains, remove it. REFUSES
      if the settings file became a symlink since install (exit 3). No state → nothing (exit 2).

  doctor-static <settings_path>
      Print one shell-parseable status token line: `absent` / `invalid-json` / `not-ours`
      (statusLine present but command != entwurf-agy-statusline) / `configured <command>`.
      Never mutates.

Exit codes: 0 ok · 2 no-state · 3 refuse-symlink · 4 invalid-json · 5 usage.
"""

import json
import os
import sys

KEY = "statusLine"
OUR_COMMAND = "entwurf-agy-statusline"
STATE_SCHEMA_VERSION = 1


def _die(code: int, msg: str) -> "None":
    sys.stderr.write(msg.rstrip("\n") + "\n")
    sys.exit(code)


def _atomic_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def _load(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    if raw.strip() == "":
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        _die(4, f"agy-statusline: {path} is not valid JSON: {err}")
    if not isinstance(data, dict):
        _die(4, f"agy-statusline: {path} top-level must be a JSON object")
    return data


def _dump(data: dict) -> str:
    return json.dumps(data, indent=2) + "\n"


def _now() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cmd_install(settings_path: str, command: str, state_path: str) -> None:
    # REFUSE a symlink — someone else's SSOT (an agent-config link). Never clobber.
    if os.path.islink(settings_path):
        target = os.readlink(settings_path)
        _die(3, f"agy-statusline: refusing to adopt {settings_path} — it is a symlink to {target} "
                f"(someone else's SSOT). Manage it there, or replace it with a regular file, then retry.")

    settings_existed = os.path.exists(settings_path)
    if settings_existed:
        data = _load(settings_path)
        detect_mode = "adopt-regular-file"
    else:
        data = {}
        detect_mode = "created-new"

    # Capture the WHOLE prior statusLine subtree (None = absent) for the honest inverse.
    preimage = data.get(KEY, None)
    data[KEY] = {"type": "custom", "command": command, "enabled": True}

    _atomic_write(settings_path, _dump(data))

    state = {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "managedSettingsPath": os.path.abspath(settings_path),
        "key": KEY,
        "command": command,
        "detectMode": detect_mode,
        "settingsExistedBefore": settings_existed,
        "preimage": preimage,  # null = statusLine was absent before install
        "installedAt": _now(),
    }
    _atomic_write(state_path, _dump(state))
    sys.stdout.write(f"{detect_mode} {os.path.abspath(settings_path)}\n")


def cmd_uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        _die(2, f"agy-statusline: no install-state at {state_path} — nothing to uninstall "
                f"(never installed, or already uninstalled).")
    state = _load(state_path)
    settings_path = state.get("managedSettingsPath")
    if not isinstance(settings_path, str):
        _die(4, f"agy-statusline: install-state {state_path} has no managedSettingsPath")

    if os.path.islink(settings_path):
        _die(3, f"agy-statusline: refusing to uninstall — {settings_path} became a symlink since "
                f"install (someone else's SSOT now). Resolve by hand.")

    if os.path.exists(settings_path):
        data = _load(settings_path)
        preimage = state.get("preimage", None)
        if preimage is None:
            data.pop(KEY, None)
        else:
            data[KEY] = preimage
        # If WE created the whole file and nothing else remains, remove it (honest inverse).
        created_new = state.get("detectMode") == "created-new" and state.get("settingsExistedBefore") is False
        only_ours_empty = created_new and len(data) == 0
        if only_ours_empty:
            os.remove(settings_path)
        else:
            _atomic_write(settings_path, _dump(data))

    os.remove(state_path)
    sys.stdout.write(f"uninstalled {settings_path}\n")


def cmd_doctor_static(settings_path: str) -> None:
    real = os.path.realpath(settings_path)
    if not os.path.exists(real):
        sys.stdout.write("absent\n")
        return
    try:
        with open(real, "r", encoding="utf-8") as fh:
            data = json.loads(fh.read() or "{}")
    except (json.JSONDecodeError, OSError):
        sys.stdout.write("invalid-json\n")
        return
    sl = data.get(KEY) if isinstance(data, dict) else None
    cmd = sl.get("command") if isinstance(sl, dict) else None
    if not cmd:
        sys.stdout.write("absent\n")
        return
    if cmd != OUR_COMMAND:
        # present but points elsewhere (e.g. still the agent-config path) — not ours.
        sys.stdout.write("not-ours\n")
        return
    sys.stdout.write(f"configured {cmd}\n")


def main(argv: list) -> None:
    if len(argv) < 2:
        _die(5, "usage: agy-statusline-config.py <install|uninstall|doctor-static> ...")
    sub = argv[1]
    if sub == "install":
        if len(argv) != 5:
            _die(5, "usage: agy-statusline-config.py install <settings_path> <command> <state_path>")
        cmd_install(argv[2], argv[3], argv[4])
    elif sub == "uninstall":
        if len(argv) != 3:
            _die(5, "usage: agy-statusline-config.py uninstall <state_path>")
        cmd_uninstall(argv[2])
    elif sub == "doctor-static":
        if len(argv) != 3:
            _die(5, "usage: agy-statusline-config.py doctor-static <settings_path>")
        cmd_doctor_static(argv[2])
    else:
        _die(5, f"agy-statusline-config.py: unknown subcommand {sub!r}")


if __name__ == "__main__":
    main(sys.argv)
