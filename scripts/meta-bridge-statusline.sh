#!/usr/bin/env bash
# meta-bridge-statusline — Claude Code native statusline with garden identity.
#
# Repo-owned Phase-3 statusline. It preserves GLG's current UX data
# (device, cwd[branch], model, context usage) while rendering it as a two-row
# Claude Code status area: row 1 = work context, row 2 = garden identity. The
# garden id is looked up by scanning meta-record BODIES via the native Claude
# `session_id`. No cache, no filename authority, no DB.
#
# Runtime dependency: python3 (already gated by install-meta-bridge/doctor).
set -euo pipefail

input=$(cat)
# The statusline must NEVER error out — Claude renders it every turn, so a broken
# exit would put a broken line in front of GLG on every prompt. If python3 is gone
# (e.g. a nix GC between installs) degrade to a quiet minimal line; if the parser
# itself dies, `|| true` keeps the shell alive with whatever (possibly empty) it
# wrote. doctor/smoke are the fail-LOUD surfaces; this surface stays silent.
if ! command -v python3 >/dev/null 2>&1; then
  device="$(cat "$HOME/.current-device" 2>/dev/null || echo UNKNOWN)"
  printf '%s ?\n🪛 ? cc' "$device"
  exit 0
fi
STATUSLINE_INPUT="$input" python3 - <<'PY' || true
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

RESET = "\033[0m"
DIM = "\033[2m"
CYAN_BOLD = "\033[1;36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED_BOLD = "\033[31;1m"


def load_input() -> dict[str, Any]:
    raw = os.environ.get("STATUSLINE_INPUT", "")
    try:
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def dig(obj: Any, *keys: str) -> Any:
    cur = obj
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def device_label() -> str:
    try:
        text = Path.home().joinpath(".current-device").read_text(encoding="utf-8").strip()
        return text or "UNKNOWN"
    except Exception:
        return "UNKNOWN"


def shorten_home(path_text: str) -> str:
    home = str(Path.home())
    if path_text == home:
        return "~"
    if path_text.startswith(home + os.sep):
        return "~" + path_text[len(home) :]
    return path_text


def split_cwd(cwd: str) -> tuple[str, str]:
    if "/" in cwd:
        return cwd.rsplit("/", 1)[0] + "/", cwd.rsplit("/", 1)[1]
    return "", cwd


def model_short(model_id: str) -> str:
    low = model_id.lower()
    if "opus" in low:
        return "o"
    if "sonnet" in low:
        return "s"
    if "haiku" in low:
        return "h"
    return "?"


def git_branch(cwd: str) -> str:
    real_cwd = os.path.abspath(os.path.expanduser(cwd)) if cwd else os.getcwd()
    try:
        subprocess.run(["git", "rev-parse", "--git-dir"], cwd=real_cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        result = subprocess.run(["git", "branch", "--show-current"], cwd=real_cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
        branch = result.stdout.strip()
        return f" [{branch}]" if branch else ""
    except Exception:
        return ""


def human_tokens(n: int) -> str:
    return f"{n / 1000:.1f}K" if n >= 1000 else str(n)


def limit_label(n: int) -> str:
    return f"{n / 1000000:.0f}M" if n >= 1000000 else f"{n / 1000:.0f}K"


def context_info(data: dict[str, Any]) -> str:
    ctx = data.get("context_window")
    if not isinstance(ctx, dict):
        return ""
    try:
        limit = int(ctx.get("context_window_size") or 0)
        pct = int(float(ctx.get("used_percentage") or 0))
        usage = ctx.get("current_usage") if isinstance(ctx.get("current_usage"), dict) else {}
        current = int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0) + int(usage.get("cache_creation_input_tokens") or 0) + int(usage.get("cache_read_input_tokens") or 0)
    except Exception:
        return ""
    if limit <= 0:
        return ""
    color = RED_BOLD if pct >= 85 else YELLOW if pct >= 70 else GREEN
    return f" | {color}{human_tokens(current)}/{limit_label(limit)} {pct}%{RESET}{DIM}"


def meta_sessions_dir() -> Path:
    override = os.environ.get("ENTWURF_META_SESSIONS_DIR")
    if override:
        return Path(override).expanduser().resolve()
    agent = os.environ.get("PI_CODING_AGENT_DIR")
    if agent:
        return Path(agent).expanduser().resolve() / "meta-sessions"
    return Path.home() / ".pi" / "agent" / "meta-sessions"


def garden_lookup(native_session_id: str) -> str:
    if not native_session_id:
        return "ready"
    root = meta_sessions_dir()
    if not root.exists():
        return "?"
    matches: list[str] = []
    try:
        entries = sorted(root.glob("*.meta.json"))
    except Exception:
        return "?"
    for file in entries:
        try:
            record = json.loads(file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(record, dict) and record.get("nativeSessionId") == native_session_id:
            garden = record.get("gardenId")
            if isinstance(garden, str) and garden:
                matches.append(garden)
            else:
                matches.append("!")
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        return "!"
    return "?"


def main() -> None:
    data = load_input()
    raw_cwd = dig(data, "workspace", "current_dir") or data.get("cwd") or "?"
    cwd = shorten_home(str(raw_cwd))
    cwd_dir, cwd_tail = split_cwd(cwd)

    model_id = dig(data, "model", "id") or "?"
    model = model_short(str(model_id))
    vterm = "v" if os.environ.get("INSIDE_EMACS") == "vterm" else ""

    native_session_id = data.get("session_id")
    garden = garden_lookup(native_session_id if isinstance(native_session_id, str) else "")
    line1 = (
        f"{DIM}{device_label()} {cwd_dir}{RESET}"
        f"{CYAN_BOLD}{cwd_tail}{RESET}"
        f"{DIM}{git_branch(str(raw_cwd))}{RESET}"
    )
    line2 = f"{DIM}🪛 {garden} cc | {model}{vterm}{context_info(data)}{RESET}"
    sys.stdout.write(f"{line1}\n{line2}")


if __name__ == "__main__":
    main()
PY
