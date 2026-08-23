#!/usr/bin/env bash
# Deliver an async message INTO one already-running, IDLE Copilot CLI session.
#
# Addressed by sessionId: only the named session's receiver sees the poke, so
# siblings stay idle. Free — it is a file write plus a continuation of a session
# that is already running; no `copilot -p` spawn is involved.
#
#   ./copilot-enqueue-addressed.sh <session_id> "your async message"
#
# The receiving session must be running the copilot-extension-receive extension
# and must agree on COPILOT_MAILBOX_ROOT. `ready.json` is raw-probe discovery,
# not production liveness authority: this script does not close stale pid/PID-reuse.
# Inspect armed candidates with:
#   ls "${COPILOT_MAILBOX_ROOT:-$HOME/.copilot/mailbox}"/*/ready.json
set -euo pipefail

root="${COPILOT_MAILBOX_ROOT:-$HOME/.copilot/mailbox}"
session_id="${1:?usage: copilot-enqueue-addressed.sh <session_id> <message>}"
shift
message="${*:?usage: copilot-enqueue-addressed.sh <session_id> <message>}"

box="$root/$session_id"
# Refuse an address that never armed. A stale marker remains possible in this raw
# probe; the managed product must add record-backed pid + start-key certification.
if [[ ! -f "$box/ready.json" ]]; then
	echo "no receiver marker at $box (no ready.json) — not queued" >&2
	exit 1
fi

msg="$box/$(date +%s%N).msg"
printf '%s\n' "$message" > "$msg"
# The body lands before the doorbell rings, so the receiver never wakes to an
# empty box.
printf 'poke\n' >> "$box/inbox.signal"
echo "queued-and-poked $msg (raw probe; extension log is the delivery receipt)"
