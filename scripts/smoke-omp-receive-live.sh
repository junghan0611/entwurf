#!/usr/bin/env bash
# LIVE acceptance for #87 bundle B — an already-open OMP citizen is woken by another
# harness, reads its inbox in that same session, and answers. Bundle A admitted OMP as
# an OUTBOUND-only citizen, so the garden is asymmetric for it: omp sends under its own
# garden id, and nothing can reply.
#
# This step exists so that asymmetry is EXECUTABLE rather than prose. It is always
# invoked and it decides its own outcome from the capability registry, never from a
# hardcoded verdict:
#
#   registry says omp has no drainable mailbox  → protocol SKIP (exit 97). Honest: there
#       is no receiver unit to arm, so no addressed receive can be attempted. Reported by
#       an unattended `release-gate`, and RED under `--cut`, which is what makes "no cut
#       while the garden is one-way for omp" executable.
#   registry claims a receive rail, no body here → FAIL. A grade that moved ahead of its
#       acceptance is exactly what this file is here to catch.
#   registry claims a receive rail and LIVE=1   → run the real acceptance (bundle B adds
#       the body; until then reaching this branch is itself the failure above).
#
# Deliberately NOT a hardcoded skip: when bundle B lands the receiver unit and moves
# `wakeMode`, this step starts demanding the LIVE receipt on its own.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"
REGISTRY="$REPO_DIR/pi/entwurf-capabilities.json"
SKIP_EXIT="${ENTWURF_STEP_SKIP_EXIT:-97}"

[ -f "$REGISTRY" ] || { echo "[smoke-omp-receive-live] capability registry missing: $REGISTRY" >&2; exit 1; }

wake_mode="$(python3 - "$REGISTRY" <<'PY'
import json, sys
registry = json.load(open(sys.argv[1]))
backend = registry.get("backends", {}).get("omp")
if backend is None:
    print("ABSENT")
else:
    print(backend.get("wakeMode") or "UNSET")
PY
)"

if [ "$wake_mode" = "ABSENT" ]; then
	echo "[smoke-omp-receive-live] omp is not in the capability registry — the backend must be registered before its receive rail can be accepted." >&2
	exit 1
fi

if [ "$wake_mode" != "self-fetch" ]; then
	echo "[entwurf:skip] smoke-omp-receive-live — omp declares wakeMode=$wake_mode, so it has no drainable mailbox and no receiver unit exists to arm (#87 bundle B). OMP is an outbound-only citizen: it sends under its own garden id and NOTHING can reply to it, which dispatch reports as mailbox-undeliverable. This is the designed boundary of bundle A, not a defect — and it is why a cut taken now would ship a one-way harness. Close it by landing bundle B (receiver unit, record-bound marker, vendor-owned wake), then this step demands the real roundtrip receipt."
	exit "$SKIP_EXIT"
fi

echo "[smoke-omp-receive-live] the capability registry declares omp wakeMode=self-fetch — a receive rail — but this acceptance has no body yet." >&2
echo "[smoke-omp-receive-live] A grade may not move ahead of its evidence (docs/adding-a-harness.md step 8). Land the bundle B LIVE acceptance here in the same change that moves the registry." >&2
exit 1
