#!/usr/bin/env bash
set -euo pipefail

SHA="${1:-}"
MODE="${2:-wait}"

case "$SHA" in
  ''|*[!0-9a-f]*) echo "ABORT: first argument must be a full hexadecimal commit SHA" >&2; exit 1 ;;
esac
[ "${#SHA}" -eq 40 ] || { echo "ABORT: commit SHA must be the full 40-character SHA" >&2; exit 1; }
case "$MODE" in
  wait|verify) ;;
  *) echo "ABORT: mode must be wait or verify" >&2; exit 1 ;;
esac

command -v gh >/dev/null 2>&1 || { echo "ABORT: gh is not on PATH" >&2; exit 1; }
gh auth status >/dev/null
REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
[ -n "$REPO" ] || { echo "ABORT: cannot resolve the GitHub repository" >&2; exit 1; }

# The witness is the ordinary branch PUSH run, and only that (#144). A
# workflow_dispatch run is the optional qualification diagnostic now, never
# release evidence, so a dispatch that is still running or that went red must not
# become the newest run judged here. The event is filtered twice: `--event push`
# asks GitHub for push runs, and the jq keeps only push runs of this exact SHA
# (a pull_request run for the same --commit is a merge preview, not this SHA).
find_run() {
  gh run list \
    --repo "$REPO" \
    --workflow ci.yml \
    --commit "$SHA" \
    --event push \
    --limit 10 \
    --json databaseId,headSha,createdAt,event \
    --jq "map(select(.headSha == \"$SHA\" and .event == \"push\")) | sort_by(.createdAt) | reverse | .[0].databaseId // empty"
}

RUN_ID="$(find_run)"
if [ "$MODE" = wait ]; then
  for _ in $(seq 1 60); do
    [ -n "$RUN_ID" ] && break
    sleep 5
    RUN_ID="$(find_run)"
  done
fi
[ -n "$RUN_ID" ] || {
  echo "ABORT: no push-triggered ci.yml run exists for exact SHA $SHA (a [skip ci] commit has none: get a push run whose head is this SHA, or re-run the existing push run; a dispatch run is not release evidence)" >&2
  exit 1
}

if [ "$MODE" = wait ]; then
  gh run watch "$RUN_ID" --repo "$REPO" --exit-status
fi

# The newest run at the SHA is the one judged, deliberately: the rule is
# deterministic and an operator who re-ran CI meant the newer run. In verify mode
# a still-running newest run therefore ABORTs on status != completed, which is the
# correct answer -- "not finished" is not evidence.
RUN_JSON="$(gh run view "$RUN_ID" --repo "$REPO" --json databaseId,headSha,status,conclusion,url,event,jobs)"
RUN_JSON="$RUN_JSON" EXPECTED_SHA="$SHA" python3 - <<'PY'
import json
import os
import sys

run = json.loads(os.environ["RUN_JSON"])
expected_sha = os.environ["EXPECTED_SHA"]
required = ("check", "install-surface", "artifact-consumer", "macos-install-surface")
# The qualification BODY is not a release axis (#144): it runs only on the weekly
# schedule or a manual `qualify=true` dispatch, as a drift diagnostic. This oracle
# reads no step of it and says so, so its PASS is never read as kill-power evidence.
errors = []

# headSha is checked unconditionally: the run list query and this read are two
# calls, and the run judged must still be this SHA's.
if run.get("headSha") != expected_sha:
    errors.append(f"headSha={run.get('headSha')!r}, expected {expected_sha!r}")
if run.get("status") != "completed":
    errors.append(f"workflow status={run.get('status')!r}, expected 'completed'")
if run.get("conclusion") != "success":
    errors.append(f"workflow conclusion={run.get('conclusion')!r}, expected 'success'")

jobs = {job.get("name"): job for job in run.get("jobs", [])}
for name in required:
    conclusion = (jobs.get(name) or {}).get("conclusion")
    if conclusion != "success":
        errors.append(f"job {name!r} conclusion={conclusion!r}, expected 'success'")

if errors:
    print("ABORT: exact-SHA CI contract failed:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    print(f"  run={run.get('url')} event={run.get('event')!r}", file=sys.stderr)
    sys.exit(1)

print(f"exact-ci: PASS sha={expected_sha} run={run.get('databaseId')} event={run.get('event')} url={run.get('url')}")
for name in required:
    print(f"exact-ci: job {name}=success")
print("exact-ci: qualification BODY is not a release axis (#144)")
PY
