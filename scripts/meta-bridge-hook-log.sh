#!/usr/bin/env bash
# Helper for doctor/smoke: decide whether an append-only meta-bridge hook log has
# an unrecovered ERROR. Recovery is intentionally narrow: only `INFO armed watch`
# proves the Claude SessionStart/CwdChanged hook re-armed the mailbox watch. A
# later `INFO attach record (event=UserPromptSubmit, ...)` is merely degraded
# backfill and must NOT clear an arm/upsert failure.
#
# THIS JUDGEMENT IS CLAUDE'S ONLY, and since #82 it has to say so. The Copilot birth
# unit appends to the SAME log file (one grep for the operator), tagging its lines
# `LEVEL [copilot]`. Those lines must be invisible here, for a reason stronger than
# tidiness: a copilot ERROR is often a CORRECT fail-closed refusal (a degraded envelope
# the unit refused to mint from), and its recovery token can never appear — `armed
# watch` is the Claude hook rail's token. Copilot's measured extension transport has a
# different, not-yet-admitted lifecycle and writes no token this doctor owns. Counting them
# would make the CLAUDE doctor permanently red for a refusal on a different rail, with
# a prescription pointing at a Claude wake failure that never happened (cross-review,
# glm, 2026-08-21). Copilot's own recovery rule lives in copilot-bridge-doctor.sh.
meta_bridge_hook_log_status() {
  local log="$1"
  local own
  own="$(grep -v ' \[copilot\] ' "$log" 2>/dev/null || true)"
  if ! printf '%s\n' "$own" | grep -q ' ERROR '; then
    echo "no-error"
    return 0
  fi

  local last_err last_recovery
  last_err="$(printf '%s\n' "$own" | grep -n ' ERROR ' | tail -1 | cut -d: -f1)"
  last_recovery="$(printf '%s\n' "$own" | grep -n ' INFO armed watch ' | tail -1 | cut -d: -f1)"

  if [ -z "$last_recovery" ] || [ "$last_err" -gt "$last_recovery" ]; then
    printf '%s\n' "$own" | grep ' ERROR ' | tail -1
    return 1
  fi

  echo "recovered-after-armed-watch"
  return 0
}
