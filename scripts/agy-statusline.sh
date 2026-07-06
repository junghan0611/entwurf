#!/usr/bin/env bash
# agy-statusline — Antigravity (agy) native statusline with garden identity.
#
# The agy mirror of meta-bridge-statusline.sh (봉인 7: separate adapter, shared
# PATTERN not code). It preserves GLG's ambient UX (device, cwd[branch], model,
# context usage) and adds the garden id, looked up by the agy native
# `conversation_id` (== `session_id`) against the meta-session record BODIES —
# the SAME authority meta-bridge uses, no cwd back-match, no gid invention.
#
# Why a SEPARATE renderer (not the cc one): agy's stdin schema differs
# (conversation_id / total_input_tokens / agent_state) and "cc" labels are
# Claude-specific. The garden-lookup logic is duplicated deliberately for now;
# extracting a shared helper is a follow-up (harness-specific honesty > DRY).
#
# The command written into agy settings.statusLine is ALWAYS the bare stable bin
# `entwurf-agy-statusline` (dev AND installed) — never a repo/checkout path. dev
# resolves it via `expose-dev-bin`; installed via the npm bin-link (#46 원문
# tripwire; oracle dangling 교훈). This DIFFERS from meta-bridge's dev repo-path
# branch, which is claude-side legacy by-design — claude 동형화는 후속 판단.
#
# Runtime dependency: python3. High-frequency surface → the lookup is BOUNDED
# (conversation_id→gid file cache + a wall-clock scan timeout + duplicate
# early-exit) so it never full-scans 300+ records on every render.
set -euo pipefail

input=$(cat)
# NEVER error out — agy renders this every turn; a broken exit would put a broken
# line in front of GLG on every prompt. python3 gone → quiet minimal line; parser
# dies → `|| true` keeps the shell alive. doctor/smoke are the fail-LOUD surfaces.
if ! command -v python3 >/dev/null 2>&1; then
  device="$(cat "$HOME/.current-device" 2>/dev/null || echo UNKNOWN)"
  printf '%s ?\n🪛 ? agy' "$device"
  exit 0
fi
STATUSLINE_INPUT="$input" python3 - <<'PY' || true
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

RESET = "\033[0m"
DIM = "\033[2m"
CYAN_BOLD = "\033[1;36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED_BOLD = "\033[31;1m"

# Bounded-lookup knobs. The cache keys on conversation_id (stable per session) so
# the common case (same conversation, every turn) never re-scans. The wall clock
# caps a cache-miss scan; overrun degrades to an honest "?" rather than a stall.
CACHE_TTL_S = 30.0
SCAN_BUDGET_S = 0.4


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
    # agy ships Gemini; keep the single-letter cadence of the cc renderer.
    low = model_id.lower()
    if "gemini" in low:
        return "g"
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
    # agy's context_window carries flat totals (total_input_tokens/…) and a
    # possibly-null current_usage — distinct from cc's current_usage.* sub-object.
    ctx = data.get("context_window")
    if not isinstance(ctx, dict):
        return ""
    try:
        limit = int(ctx.get("context_window_size") or 0)
        pct = int(float(ctx.get("used_percentage") or 0))
        current = int(ctx.get("total_input_tokens") or 0) + int(ctx.get("total_output_tokens") or 0)
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


def cache_path() -> Path:
    root = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(root).expanduser() / "entwurf" / "agy-statusline-gid.json"


def cache_get(native_id: str) -> str | None:
    try:
        rec = json.loads(cache_path().read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(rec, dict):
        return None
    if rec.get("nativeId") != native_id:
        return None
    ts = rec.get("ts")
    if not isinstance(ts, (int, float)) or (time.time() - ts) > CACHE_TTL_S:
        return None
    gid = rec.get("gid")
    return gid if isinstance(gid, str) else None


def cache_put(native_id: str, gid: str) -> None:
    try:
        p = cache_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(f".tmp-{os.getpid()}")
        tmp.write_text(json.dumps({"nativeId": native_id, "gid": gid, "ts": time.time()}), encoding="utf-8")
        tmp.replace(p)
    except Exception:
        pass  # cache is best-effort; a write failure must never break the line


def scan_gid(native_id: str) -> str:
    # BOUNDED scan: newest records first (an agy conversation is freshly
    # registered), duplicate early-exit, and a wall-clock budget. Overrun → "?".
    root = meta_sessions_dir()
    if not root.exists():
        return "?"
    try:
        entries = sorted(root.glob("*.meta.json"), key=lambda f: f.stat().st_mtime, reverse=True)
    except Exception:
        return "?"
    deadline = time.monotonic() + SCAN_BUDGET_S
    matches: list[str] = []
    for file in entries:
        if time.monotonic() > deadline:
            return "?"  # honest degrade, never a stall or an invented gid
        try:
            record = json.loads(file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(record, dict) and record.get("nativeSessionId") == native_id:
            garden = record.get("gardenId")
            matches.append(garden if isinstance(garden, str) and garden else "!")
            if len(matches) > 1:
                return "!"  # duplicate fail-fast (also caps the scan)
    if len(matches) == 1:
        return matches[0]
    return "?"


def garden_lookup(native_id: str) -> str:
    if not native_id:
        return "ready"
    cached = cache_get(native_id)
    if cached is not None:
        return cached
    gid = scan_gid(native_id)
    # Only memoize a settled, unambiguous answer — never cache a "?"/"!"/"ready"
    # so a still-registering conversation is re-checked next turn.
    if gid not in ("?", "!", "ready"):
        cache_put(native_id, gid)
    return gid


def main() -> None:
    data = load_input()
    raw_cwd = dig(data, "workspace", "current_dir") or data.get("cwd") or "?"
    cwd = shorten_home(str(raw_cwd))
    cwd_dir, cwd_tail = split_cwd(cwd)

    model_id = dig(data, "model", "display_name") or dig(data, "model", "id") or "?"
    model = model_short(str(model_id))
    vterm = "v" if os.environ.get("INSIDE_EMACS") == "vterm" else ""

    # agy gives both conversation_id and session_id (same value); prefer the
    # canonical conversation_id, fall back to session_id.
    native_id = data.get("conversation_id") or data.get("session_id")
    garden = garden_lookup(native_id if isinstance(native_id, str) else "")
    line1 = (
        f"{DIM}{device_label()} {cwd_dir}{RESET}"
        f"{CYAN_BOLD}{cwd_tail}{RESET}"
        f"{DIM}{git_branch(str(raw_cwd))}{RESET}"
    )
    line2 = f"{DIM}🪛 {garden} agy | {model}{vterm}{context_info(data)}{RESET}"
    sys.stdout.write(f"{line1}\n{line2}")


if __name__ == "__main__":
    main()
PY
