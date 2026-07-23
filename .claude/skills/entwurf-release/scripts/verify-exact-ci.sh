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

find_run() {
  gh run list \
    --repo "$REPO" \
    --workflow ci.yml \
    --event push \
    --commit "$SHA" \
    --limit 10 \
    --json databaseId,headSha,createdAt \
    --jq "map(select(.headSha == \"$SHA\")) | sort_by(.createdAt) | reverse | .[0].databaseId // empty"
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
  echo "ABORT: no push-triggered ci.yml run exists for exact SHA $SHA" >&2
  exit 1
}

if [ "$MODE" = wait ]; then
  gh run watch "$RUN_ID" --repo "$REPO" --exit-status
fi

RUN_JSON="$(gh run view "$RUN_ID" --repo "$REPO" --json databaseId,headSha,status,conclusion,url,jobs)"
RUN_JSON="$RUN_JSON" EXPECTED_SHA="$SHA" python3 - <<'PY'
import json
import os
import sys

run = json.loads(os.environ["RUN_JSON"])
expected_sha = os.environ["EXPECTED_SHA"]
required = ("check", "install-surface", "artifact-consumer")
errors = []

if run.get("headSha") != expected_sha:
    errors.append(f"headSha={run.get('headSha')!r}, expected {expected_sha!r}")
if run.get("status") != "completed":
    errors.append(f"workflow status={run.get('status')!r}, expected 'completed'")
if run.get("conclusion") != "success":
    errors.append(f"workflow conclusion={run.get('conclusion')!r}, expected 'success'")

jobs = {job.get("name"): job.get("conclusion") for job in run.get("jobs", [])}
for name in required:
    if jobs.get(name) != "success":
        errors.append(f"job {name!r} conclusion={jobs.get(name)!r}, expected 'success'")

if errors:
    print("ABORT: exact-SHA CI contract failed:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    print(f"  run={run.get('url')}", file=sys.stderr)
    sys.exit(1)

print(f"exact-ci: PASS sha={expected_sha} run={run.get('databaseId')} url={run.get('url')}")
for name in required:
    print(f"exact-ci: job {name}=success")
PY
