#!/usr/bin/env bash
# copilot-statusline — Copilot custom footer: garden id only.
#
# Copilot already draws directory/branch/model/context/quota. This fills the
# custom slot with the garden id. Vocabulary matches Claude and agy
# (ready / ? / !); rail `cop`. Fail-quiet: nonzero blanks the slot (bundle Fxi).
# Bare bin: entwurf-copilot-statusline. No cache, no git, no ANSI.
# Reads session_id only — any other envelope key is Copilot's, not ours.
set -euo pipefail

# Copilot silently blanks a nonzero statusline, so a read failure degrades to ready.
input=$(cat || true)
if ! command -v python3 >/dev/null 2>&1; then
  printf '🪛 ? cop'
  exit 0
fi
output="$(STATUSLINE_INPUT="$input" python3 - <<'PY'
import json, os, sys
from pathlib import Path

def load_input():
    raw = os.environ.get("STATUSLINE_INPUT", "")
    try:
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}

def meta_sessions_dir():
    override = os.environ.get("ENTWURF_META_SESSIONS_DIR")
    if override:
        return Path(override).expanduser().resolve()
    agent = os.environ.get("PI_CODING_AGENT_DIR")
    if agent:
        return Path(agent).expanduser().resolve() / "meta-sessions"
    return Path.home() / ".pi" / "agent" / "meta-sessions"

def garden_lookup(native_session_id):
    if not native_session_id:
        return "ready"
    root = meta_sessions_dir()
    if not root.exists():
        return "?"
    matches = []
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
            matches.append(garden if isinstance(garden, str) and garden else "!")
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        return "!"
    return "?"

data = load_input()
sid = data.get("session_id")
sys.stdout.write(f"🪛 {garden_lookup(sid if isinstance(sid, str) else '')} cop")
PY
)" || output='🪛 ? cop'
printf '%s' "$output"
