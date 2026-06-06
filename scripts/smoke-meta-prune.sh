#!/usr/bin/env bash
# smoke-meta-prune — deterministic Phase-4 gate for the LISTING-ONLY meta-store
# janitor. Builds a synthetic meta-sessions store covering every class
# (keep / orphan / stale / duplicate / corrupt / drift), runs meta-bridge-prune,
# and proves it CLASSIFIES correctly, exits 0, and DELETES NOTHING. Offline /
# deterministic: no real claude CLI, no user config. Deps: bash + node.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
LIB="$REPO/pi-extensions/lib/meta-session.ts"
PRUNE="$REPO/scripts/meta-bridge-prune.ts"

command -v node >/dev/null || { echo "FAIL: node not on PATH"; exit 1; }

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

TMP="$(mktemp -d -t psa-meta-prune.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

# Deliberately a path WITH A SPACE so the printed manual rm command is proven to
# survive shell-quoting (a bare `rm <path>` would split on the space).
STORE="$TMP/meta sessions dir"
mkdir -p "$STORE"
LIVE_TRANSCRIPT="$TMP/live-transcript.jsonl"
: > "$LIVE_TRANSCRIPT"   # an EXISTING transcript file for keep/stale records

# Generate valid records through the real lib so the smoke tracks schema truth.
# keep  : transcript exists + recent lastSeen
# orphan: transcript path absent
# stale : transcript exists + lastSeen older than ttl
# dupA/B: same nativeSessionId, two files -> ambiguous (authority conflict)
# drift : valid body written under a wrong filename -> ambiguous
# corrupt: non-parseable json -> ambiguous
cat > "$TMP/gen.mjs" <<'JS'
const [libPath, store, liveTranscript] = process.argv.slice(2);
const fs = await import("node:fs");
const path = await import("node:path");
const { mintMetaRecord, serializeMetaRecord } = await import(libPath);

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const old = new Date(now.getTime() - 40 * DAY); // older than the 30d default ttl

function write(filename, record) {
  fs.writeFileSync(path.join(store, filename), serializeMetaRecord(record));
}

// keep — live transcript, recent
const keep = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-keep", transcriptPath: liveTranscript, cwd: "/tmp/keep" }, now);
write(`${keep.gardenId}.meta.json`, keep);

// orphan — transcript path that does not exist
const orphan = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-orphan", transcriptPath: "/no/such/transcript.jsonl", cwd: "/tmp/orphan" }, now);
write(`${orphan.gardenId}.meta.json`, orphan);

// stale — live transcript but old lastSeen
const stale = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-stale", transcriptPath: liveTranscript, cwd: "/tmp/stale" }, old);
write(`${stale.gardenId}.meta.json`, stale);

// duplicate nativeSessionId across two distinct files
const dupA = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-dup", transcriptPath: liveTranscript, cwd: "/tmp/a" }, now);
const dupB = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-dup", transcriptPath: liveTranscript, cwd: "/tmp/b" }, now);
write(`${dupA.gardenId}.meta.json`, dupA);
write(`${dupB.gardenId}.meta.json`, dupB);

// drift — valid body, wrong filename
const drift = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-drift", transcriptPath: liveTranscript, cwd: "/tmp/drift" }, now);
write(`20991231T235959-ffffff.meta.json`, drift);

// invalid lastSeen — parseMetaRecord passes (non-empty string) but Date.parse fails;
// live transcript so NOT orphan. Cannot prove "recent" -> must be ambiguous, not keep.
const badDate = mintMetaRecord({ backend: "claude-code", nativeSessionId: "n-baddate", transcriptPath: liveTranscript, cwd: "/tmp/baddate" }, now);
badDate.lastSeen = "not-a-date";
write(`${badDate.gardenId}.meta.json`, badDate);

// corrupt — non-parseable json
fs.writeFileSync(path.join(store, `20260101T000000-aaaaaa.meta.json`), "{ this is not valid json");

console.log(JSON.stringify({
  keep: keep.gardenId, orphan: orphan.gardenId, stale: stale.gardenId,
  dupA: dupA.gardenId, dupB: dupB.gardenId, drift: "20991231T235959-ffffff",
  badDate: badDate.gardenId, corrupt: "20260101T000000-aaaaaa",
}));
JS

META="$(node --experimental-strip-types "$TMP/gen.mjs" "$LIB" "$STORE" "$LIVE_TRANSCRIPT")"
ORPHAN_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).orphan)' "$META")"
STALE_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).stale)' "$META")"
KEEP_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).keep)' "$META")"
BADDATE_ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).badDate)' "$META")"

FILES_BEFORE="$(find "$STORE" -name '*.meta.json' | wc -l | tr -d ' ')"

set +e
OUT="$(node --experimental-strip-types "$PRUNE" "$STORE" 2>&1)"
CODE=$?
set -e

echo "$OUT"
echo "---"

# exit 0 — listing-only never errors on a scannable store (corrupt is classified, not fatal)
[ "$CODE" = "0" ] && ok "exit 0 on classifiable store" || bad "expected exit 0, got $CODE"

# classification counts: 1 orphan, 1 stale, 1 keep, 4 ambiguous (duplicate(dupA+dupB -> one line) + drift + invalid-lastSeen + corrupt)
echo "$OUT" | grep -q "ORPHAN transcript-gone (1):"   && ok "orphan count 1" || bad "orphan count != 1"
echo "$OUT" | grep -q "STALE lastSeen>30d (1):"       && ok "stale count 1"  || bad "stale count != 1"
echo "$OUT" | grep -q "KEEP (live/recent): 1 record"  && ok "keep count 1"   || bad "keep count != 1"
# ambiguous lines: duplicate(1) + drift(1) + invalid-lastSeen(1) + corrupt(1) = 4
echo "$OUT" | grep -q "AMBIGUOUS manual-only (4):"     && ok "ambiguous count 4" || bad "ambiguous count != 4"

# the right records land in the right class
echo "$OUT" | grep -A1 "ORPHAN" | grep -q "$ORPHAN_ID" && ok "orphan id correct" || bad "orphan id missing from ORPHAN section"
echo "$OUT" | grep -A1 "STALE"  | grep -q "$STALE_ID"  && ok "stale id correct"  || bad "stale id missing from STALE section"

# ambiguous specifics
echo "$OUT" | grep -q "duplicate nativeSessionId"      && ok "duplicate classified ambiguous" || bad "duplicate not classified"
echo "$OUT" | grep -q "corrupt"                        && ok "corrupt classified ambiguous"   || bad "corrupt not classified"
echo "$OUT" | grep -q "body/filename drift"            && ok "drift classified ambiguous"     || bad "drift not classified"
# invalid lastSeen cannot prove recency -> manual-only, NOT keep
echo "$OUT" | grep -q "unparseable lastSeen"           && ok "invalid lastSeen classified ambiguous" || bad "invalid lastSeen not classified"
echo "$OUT" | grep -A6 "AMBIGUOUS" | grep -q "$BADDATE_ID" && ok "invalid-lastSeen id in AMBIGUOUS section" || bad "invalid-lastSeen id missing from AMBIGUOUS"

# keep is NOT offered as a removal command
echo "$OUT" | grep -q "rm .*${KEEP_ID}.meta.json" && bad "keep record wrongly offered for removal" || ok "keep not offered for removal"
# invalid-lastSeen is ambiguous, so it must NOT be offered as a removal command either
echo "$OUT" | grep -q "rm .*${BADDATE_ID}.meta.json" && bad "invalid-lastSeen wrongly offered for removal" || ok "invalid-lastSeen not offered for removal"
# orphan IS offered as a manual rm
echo "$OUT" | grep -q "rm .*${ORPHAN_ID}.meta.json" && ok "orphan offered for manual rm" || bad "orphan rm command missing"

# the printed manual rm command is POSIX-quoted so a store path with spaces survives.
# Extract the orphan rm line and replay it against a COPY of the store: the quoted
# command must remove exactly that one file and nothing splits on the space.
RMLINE="$(echo "$OUT" | grep -F "${ORPHAN_ID}.meta.json" | grep '^  rm -- ' | head -1)"
echo "$RMLINE" | grep -q "rm -- '" && ok "manual rm command is single-quoted" || bad "manual rm command not quoted: $RMLINE"
COPY="$TMP/store copy"
cp -r "$STORE" "$COPY"
# rewrite the command's path from the live store to the copy, then execute it
REPLAY="${RMLINE/$STORE/$COPY}"
COPY_BEFORE="$(find "$COPY" -name '*.meta.json' | wc -l | tr -d ' ')"
eval "$REPLAY"
COPY_AFTER="$(find "$COPY" -name '*.meta.json' | wc -l | tr -d ' ')"
[ ! -e "$COPY/${ORPHAN_ID}.meta.json" ] && [ "$COPY_AFTER" = "$((COPY_BEFORE - 1))" ] \
  && ok "quoted rm replays correctly on spaced path (removed exactly the orphan)" \
  || bad "quoted rm failed on spaced path ($COPY_BEFORE -> $COPY_AFTER, orphan present=$( [ -e "$COPY/${ORPHAN_ID}.meta.json" ] && echo yes || echo no ))"

# the no-deletion invariant — wording + actual files on disk
echo "$OUT" | grep -q "No files removed." && ok "prints 'No files removed.'" || bad "missing no-deletion wording"
FILES_AFTER="$(find "$STORE" -name '*.meta.json' | wc -l | tr -d ' ')"
[ "$FILES_BEFORE" = "$FILES_AFTER" ] && ok "deleted nothing ($FILES_BEFORE files before and after)" || bad "file count changed: $FILES_BEFORE -> $FILES_AFTER"

# nonexistent store is a clean 0-record listing, not an error
set +e
OUT2="$(node --experimental-strip-types "$PRUNE" "$TMP/does-not-exist" 2>&1)"
CODE2=$?
set -e
[ "$CODE2" = "0" ] && echo "$OUT2" | grep -q "does not exist yet" && ok "missing store -> clean 0-record exit 0" || bad "missing store not handled cleanly"

# custom ttl moves the stale boundary: ttl 100d demotes the 40d-old record to keep
set +e
OUT3="$(node --experimental-strip-types "$PRUNE" "$STORE" --ttl-days 100 2>&1)"
set -e
echo "$OUT3" | grep -q "STALE lastSeen>100d (0):" && echo "$OUT3" | grep -q "KEEP (live/recent): 2 record" && ok "--ttl-days widens keep window" || bad "--ttl-days did not move stale boundary"

if [ "$fail" = "0" ]; then
  echo "smoke-meta-prune PASS"
else
  echo "smoke-meta-prune FAIL"
  exit 1
fi
