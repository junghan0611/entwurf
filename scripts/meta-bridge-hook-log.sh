#!/usr/bin/env bash
# Helper for doctor/smoke: decide whether an append-only meta-bridge hook log has
# an unrecovered ERROR. Recovery is intentionally narrow: only `INFO armed watch`
# proves the Claude SessionStart/CwdChanged hook re-armed the mailbox watch. A
# later `INFO attach record (event=UserPromptSubmit, ...)` is merely degraded
# backfill and must NOT clear an arm/upsert failure.

meta_bridge_hook_log_status() {
  local log="$1"
  if ! grep -q ' ERROR ' "$log" 2>/dev/null; then
    echo "no-error"
    return 0
  fi

  local last_err last_recovery
  last_err="$(grep -n ' ERROR ' "$log" | tail -1 | cut -d: -f1)"
  last_recovery="$(grep -n ' INFO armed watch ' "$log" | tail -1 | cut -d: -f1)"

  if [ -z "$last_recovery" ] || [ "$last_err" -gt "$last_recovery" ]; then
    grep ' ERROR ' "$log" | tail -1
    return 1
  fi

  echo "recovered-after-armed-watch"
  return 0
}
