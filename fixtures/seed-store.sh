#!/usr/bin/env bash
# seed-store.sh — plant one frozen host state into a store dir.
#
#   seed-store.sh <host-state> <dest-store-dir>
#
# The ONE seeding path all three upgrade cells share (source gate, installed
# package gate, container gate), so "what the host already had" is the same bytes
# everywhere and a cell cannot quietly disagree with its siblings about the
# fixture. Copies frozen bytes; it never serializes a record. The `absent` state
# deliberately leaves the dest MISSING (a host that never ran the bridge) while
# `empty` creates the dir with no records — the two are different filesystem
# facts and the gates assert both.
#
# Verifies each copied file against MANIFEST.sha256 after the copy: a fixture
# edited by accident (or by a serializer "fix") fails here rather than silently
# re-baselining an upgrade proof.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX="$HERE/meta-store"
STATE="${1:?usage: seed-store.sh <host-state> <dest-store-dir>}"
DEST="${2:?usage: seed-store.sh <host-state> <dest-store-dir>}"

die() { echo "seed-store: $*" >&2; exit 1; }

# Verify the composition authority (`hosts.json`) as well as every record before
# reading either. Otherwise a standalone pack cell could consume a silently
# edited host-state list even though all copied record bytes still matched.
(cd "$FIX" && sha256sum -c MANIFEST.sha256 >/dev/null 2>&1) ||
  die "fixture payload drifted from MANIFEST.sha256 (hosts.json or record bytes changed)"

ids="$(python3 -c '
import json, sys
hosts = json.load(open(sys.argv[1]))
state = sys.argv[2]
if state not in hosts or state.startswith("_"):
    raise SystemExit(f"unknown host state {state!r}; known: " + ", ".join(k for k in hosts if not k.startswith("_")))
print("\n".join(hosts[state]))
' "$FIX/hosts.json" "$STATE")" || die "$STATE"

if [ "$STATE" = "absent" ]; then
  rm -rf "$DEST"
  echo "[seed-store] $STATE -> $DEST (left absent: no store dir)"
  exit 0
fi

rm -rf "$DEST"
mkdir -p "$DEST"
for id in $ids; do
  src="$FIX/records/${id}.meta.json"
  [ -f "$src" ] || die "fixture record missing: $src"
  cp "$src" "$DEST/${id}.meta.json"
  # Frozen-bytes fence: the seeded file must hash to the manifest entry. The
  # manifest is the contract; the copy is just transport.
  want="$(awk -v f="records/${id}.meta.json" '$2 == f || $2 == "*" f { print $1 }' "$FIX/MANIFEST.sha256")"
  [ -n "$want" ] || die "MANIFEST.sha256 has no entry for records/${id}.meta.json"
  got="$(sha256sum "$DEST/${id}.meta.json" | cut -d' ' -f1)"
  [ "$want" = "$got" ] || die "fixture bytes drifted for ${id}.meta.json (manifest $want, seeded $got). A frozen upgrade fixture changed — re-baselining it silently would void every proof built on it."
done
echo "[seed-store] $STATE -> $DEST ($(printf '%s\n' "$ids" | grep -c . || true) record(s), sha256-verified)"
