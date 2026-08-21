#!/usr/bin/env python3
"""Stateful Copilot statusLine settings adapter; stdlib only.

Owns the whole ``statusLine`` subtree and the one prerequisite leaf
``footer.showCustom``.  It adopts regular settings.json files, refuses symlinks,
and records first-install preimages for an honest inverse.
"""

import datetime
import json
import os
import sys
import tempfile

STATE_SCHEMA_VERSION = 1
STATUSLINE_KEY = "statusLine"
FOOTER_KEY = "footer"
SHOW_CUSTOM_KEY = "showCustom"


def die(code: int, message: str) -> "None":
    sys.stderr.write(message.rstrip("\n") + "\n")
    raise SystemExit(code)


def load_object(path: str, label: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except OSError as error:
        die(4, f"copilot-statusline: cannot read {label} {path}: {error}")
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        die(4, f"copilot-statusline: {label} {path} is not valid JSON: {error}")
    if not isinstance(value, dict):
        die(4, f"copilot-statusline: {label} {path} top-level must be a JSON object")
    return value


def atomic_write(path: str, value: dict) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=directory, prefix=".copilot-statusline-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def checked_state(state_path: str) -> dict:
    state = load_object(state_path, "install-state")
    required = (
        "managedSettingsPath",
        "settingsExistedBefore",
        "statusLineExisted",
        "statusLinePreimage",
        "footerExisted",
        "showCustomExisted",
        "showCustomPreimage",
    )
    if state.get("schemaVersion") != STATE_SCHEMA_VERSION or any(key not in state for key in required):
        die(4, f"copilot-statusline: install-state {state_path} has an unsupported shape")
    return state


def prior_state(state_path: str, settings_path: str) -> dict | None:
    if not os.path.exists(state_path):
        return None
    state = checked_state(state_path)
    return state if state["managedSettingsPath"] == os.path.abspath(settings_path) else None


def install(settings_path: str, command: str, state_path: str) -> None:
    if os.path.islink(settings_path):
        die(3, f"copilot-statusline: refusing to adopt {settings_path} — symlink to {os.readlink(settings_path)} (someone else's SSOT)")

    existed = os.path.exists(settings_path)
    settings = load_object(settings_path, "settings") if existed else {}
    footer_existed = FOOTER_KEY in settings
    footer = settings.get(FOOTER_KEY) if footer_existed else {}
    if not isinstance(footer, dict):
        die(4, f"copilot-statusline: {settings_path} footer must be a JSON object")

    prior = prior_state(state_path, settings_path)
    if prior is None:
        state = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "managedSettingsPath": os.path.abspath(settings_path),
            "command": command,
            "detectMode": "adopt-regular-file" if existed else "created-new",
            "settingsExistedBefore": existed,
            "statusLineExisted": STATUSLINE_KEY in settings,
            "statusLinePreimage": settings.get(STATUSLINE_KEY),
            "footerExisted": footer_existed,
            "showCustomExisted": SHOW_CUSTOM_KEY in footer,
            "showCustomPreimage": footer.get(SHOW_CUSTOM_KEY),
            "installedAt": now(),
        }
    else:
        state = prior

    settings[STATUSLINE_KEY] = {"command": command}
    footer[SHOW_CUSTOM_KEY] = True
    settings[FOOTER_KEY] = footer
    atomic_write(settings_path, settings)
    atomic_write(state_path, state)
    sys.stdout.write(f"{state['detectMode']} {os.path.abspath(settings_path)}\n")


def uninstall(state_path: str) -> None:
    if not os.path.exists(state_path):
        die(2, f"copilot-statusline: no install-state at {state_path} — nothing to undo")
    state = checked_state(state_path)
    settings_path = state.get("managedSettingsPath")
    if not isinstance(settings_path, str) or not os.path.isabs(settings_path):
        die(4, f"copilot-statusline: install-state {state_path} has no absolute managedSettingsPath")
    if os.path.islink(settings_path):
        die(3, f"copilot-statusline: refusing to uninstall — {settings_path} became a symlink (someone else's SSOT)")

    if os.path.exists(settings_path):
        settings = load_object(settings_path, "settings")
        if state.get("statusLineExisted"):
            settings[STATUSLINE_KEY] = state.get("statusLinePreimage")
        else:
            settings.pop(STATUSLINE_KEY, None)

        footer = settings.get(FOOTER_KEY)
        if not isinstance(footer, dict):
            die(4, f"copilot-statusline: {settings_path} footer changed to a non-object; refusing to guess")
        if state.get("showCustomExisted"):
            footer[SHOW_CUSTOM_KEY] = state.get("showCustomPreimage")
        else:
            footer.pop(SHOW_CUSTOM_KEY, None)
        if footer or state.get("footerExisted"):
            settings[FOOTER_KEY] = footer
        else:
            settings.pop(FOOTER_KEY, None)

        created = state.get("detectMode") == "created-new" and state.get("settingsExistedBefore") is False
        if created and not settings:
            os.remove(settings_path)
        else:
            atomic_write(settings_path, settings)

    os.remove(state_path)
    sys.stdout.write(f"uninstalled {settings_path}\n")


def doctor_static(settings_path: str, command: str) -> None:
    if os.path.islink(settings_path):
        sys.stdout.write("symlink\n")
        return
    if not os.path.exists(settings_path):
        sys.stdout.write("file-absent\n")
        return
    try:
        settings = load_object(settings_path, "settings")
    except SystemExit:
        sys.stdout.write("invalid-json\n")
        return
    status_line = settings.get(STATUSLINE_KEY)
    if not isinstance(status_line, dict) or status_line.get("command") != command:
        sys.stdout.write("not-ours\n")
        return
    footer = settings.get(FOOTER_KEY)
    if not isinstance(footer, dict) or footer.get(SHOW_CUSTOM_KEY) is not True:
        sys.stdout.write("custom-disabled\n")
        return
    sys.stdout.write(f"configured {command}\n")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        die(5, "usage: copilot-statusline-config.py <install|uninstall|doctor-static> ...")
    match argv[1]:
        case "install" if len(argv) == 5:
            install(argv[2], argv[3], argv[4])
        case "uninstall" if len(argv) == 3:
            uninstall(argv[2])
        case "doctor-static" if len(argv) == 4:
            doctor_static(argv[2], argv[3])
        case _:
            die(5, "usage: copilot-statusline-config.py <install settings command state|uninstall state|doctor-static settings command>")


if __name__ == "__main__":
    main(sys.argv)
