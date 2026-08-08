#!/usr/bin/env bash
# check-elapsed — total wall-time reporter for the tiered check entrypoints (#70).
#
# Usage: bash scripts/check-elapsed.sh <label> <pnpm-script>...
#
# Runs each named pnpm script IN ORDER (fail-fast), then prints exactly one
# summary line — total elapsed wall seconds plus the exit code — on success AND
# on failure, and exits with the first failing script's code. Tier MEMBERSHIP
# lives in package.json (the executable SSOT); this wrapper owns only the
# wall-clock line. It is deliberately not a profiler: no per-step timing, no
# cache, no history, no thresholds. The core tier's ≤60s acceptance is an
# operator measurement on the reference host (oracle), never a hard fail here —
# an arbitrary CI host's variance must not turn wall time into a flaky gate.
set -u

label="$1"
shift
start=$(date +%s)
code=0
for script in "$@"; do
	pnpm run "$script" || { code=$?; break; }
done
elapsed=$(($(date +%s) - start))
echo "[${label}] total elapsed ${elapsed}s exit ${code}"
exit "$code"
