#!/usr/bin/env bash
# smoke-claude-native-resume-live — LIVE-only Claude Code native resume + meta-bridge neutrality probe.
#
# This smoke is deliberately NOT a entwurf ACP backend test. It exercises
# Claude Code's own native persistence/resume path while the meta-bridge hook is
# installed, then checks that entwurf only records the native identity:
#   - a fresh `claude -p --output-format=json` turn returns a native session_id;
#   - exactly one meta-record body binds backend=claude-code + nativeSessionId;
#   - the recorded transcriptPath exists and stays attached to that native id;
#   - `claude -p --resume <session_id>` can continue the native conversation;
#   - the meta-record remains unique after resume (no duplicate garden citizen).
#
# It creates real Claude Code turns and writes normal Claude transcripts plus
# entwurf meta-records. It never edits Claude config, credentials, or
# transcripts, and it does not go through the ACP provider.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${LIVE:-0}" != "1" ]; then
  echo "[smoke-claude-native-resume-live] skipped — set LIVE=1 to run (spawns two real Claude Code native turns)."
  exit 0
fi

command -v claude >/dev/null || { echo "FAIL: claude not on PATH" >&2; exit 1; }
command -v node >/dev/null || { echo "FAIL: node not on PATH" >&2; exit 1; }
command -v python3 >/dev/null || { echo "FAIL: python3 not on PATH" >&2; exit 1; }

pass=0
fail=0
ok()  { echo "  ok    $*"; pass=$((pass + 1)); }
bad() { echo "  FAIL  $*"; fail=$((fail + 1)); }
section() { echo; echo "== $* =="; }

TMP="$(mktemp -d -t psa-cc-native-resume.XXXXXX)"
cleanup() {
  if [ "${KEEP_SMOKE_TMP:-0}" != "1" ]; then rm -rf "$TMP"; else echo "  keep tmp: $TMP"; fi
}
trap cleanup EXIT

SCRATCH="$TMP/project"
mkdir -p "$SCRATCH"

MODEL_ARGS=()
# Pin the smoke to Sonnet by default so an operator's Opus default does not make
# a tiny continuity probe fail the budget gate. Set CLAUDE_CODE_NATIVE_RESUME_MODEL=""
# to use Claude Code's configured default, or any explicit alias/model id.
if [ "${CLAUDE_CODE_NATIVE_RESUME_MODEL-sonnet}" != "" ]; then
  MODEL_ARGS+=(--model "${CLAUDE_CODE_NATIVE_RESUME_MODEL-sonnet}")
fi

FALLBACK_ARGS=()
if [ -n "${CLAUDE_CODE_NATIVE_RESUME_FALLBACK_MODEL:-}" ]; then
  FALLBACK_ARGS+=(--fallback-model "$CLAUDE_CODE_NATIVE_RESUME_FALLBACK_MODEL")
fi

BUDGET_ARGS=()
if [ -n "${CLAUDE_CODE_NATIVE_RESUME_MAX_BUDGET_USD:-0.20}" ]; then
  BUDGET_ARGS+=(--max-budget-usd "${CLAUDE_CODE_NATIVE_RESUME_MAX_BUDGET_USD:-0.20}")
fi

EFFECTIVE_MODEL="${CLAUDE_CODE_NATIVE_RESUME_MODEL-sonnet}"
EFFECTIVE_FALLBACK="${CLAUDE_CODE_NATIVE_RESUME_FALLBACK_MODEL:-}"
EFFECTIVE_BUDGET="${CLAUDE_CODE_NATIVE_RESUME_MAX_BUDGET_USD:-0.20}"
echo "[smoke-claude-native-resume-live] model=${EFFECTIVE_MODEL:-<claude-default>} fallback=${EFFECTIVE_FALLBACK:-<none>} max_budget_usd=${EFFECTIVE_BUDGET:-<none>} scratch=$SCRATCH"

# Keep the prompts tiny and tool-free. Do not use "secret" wording; this is a
# continuity marker, not a safety-sensitive secret.
NONCE="native-resume-$(date +%Y%m%dT%H%M%S)-$RANDOM"
FIRST_PROMPT="Remember the marker word ${NONCE}. Reply exactly READY ${NONCE}."
SECOND_PROMPT="What marker word did I ask you to remember? Reply exactly WORD ${NONCE}."

classify_error() {
  python3 - "$@" <<'PY'
import re, sys
text = "\n".join(open(p, errors='replace').read() for p in sys.argv[1:] if p)
lo = text.lower()
if 'api error: 400 messages' in lo or '400 messages:' in lo:
    if 'cache_control cannot be set for empty text blocks' in lo or 'text content blocks must be non-empty' in lo:
        print('classification=transcript-poison-empty-text-400')
    elif 'thinking' in lo and 'cannot be modified' in lo:
        print('classification=transcript-poison-thinking-block-400')
    else:
        print('classification=anthropic-messages-400')
elif 'prompt is too long' in lo or 'context window' in lo or 'reduce the length' in lo:
    print('classification=context-overflow')
elif 'out of extra usage' in lo or 'usage' in lo and 'claude.ai/settings/usage' in lo:
    print('classification=usage-or-billing')
elif 'overloaded' in lo or 'rate_limit' in lo or 'rate limit' in lo or '529' in lo:
    print('classification=service-overload-or-rate-limit')
elif 'error_max_budget_usd' in lo or 'reached maximum budget' in lo:
    print('classification=max-budget-too-low')
elif text.strip():
    print('classification=unknown-error')
else:
    print('classification=no-output')
for line in text.splitlines()[-12:]:
    if line.strip(): print('output-tail: ' + line[:500])
PY
}

run_claude_json() {
  local out="$1" err="$2"; shift 2
  (cd "$SCRATCH" && claude -p --output-format=json --tools "" "${MODEL_ARGS[@]}" "${FALLBACK_ARGS[@]}" "${BUDGET_ARGS[@]}" "$@") >"$out" 2>"$err"
}

json_field() {
  local file="$1" expr="$2"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const keys=process.argv[2].split("."); let v=o; for (const k of keys) v=v?.[k]; if (v !== undefined && v !== null) process.stdout.write(String(v));' "$file" "$expr"
}

model_usage_keys() {
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(Object.keys(o.modelUsage || {}).join(",") || "<none>");' "$1"
}

find_meta_record_json() {
  local native_id="$1"
  node - "$native_id" <<'JS'
const fs = require('fs');
const path = require('path');
const nativeId = process.argv[2];
const dir = process.env.ENTWURF_META_SESSIONS_DIR || path.join(process.env.HOME, '.pi/agent/meta-sessions');
const matches = [];
if (fs.existsSync(dir)) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.meta.json')) continue;
    const file = path.join(dir, name);
    try {
      const r = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (r && r.backend === 'claude-code' && r.nativeSessionId === nativeId) matches.push({ file, record: r });
    } catch {}
  }
}
console.log(JSON.stringify({ dir, count: matches.length, matches }));
JS
}

FIRST_OUT="$TMP/first.json"
FIRST_ERR="$TMP/first.err"
SECOND_OUT="$TMP/second.json"
SECOND_ERR="$TMP/second.err"

section "A. first native Claude Code turn"
if run_claude_json "$FIRST_OUT" "$FIRST_ERR" "$FIRST_PROMPT"; then
  ok "first native claude -p completed"
else
  bad "first native claude -p failed"
  classify_error "$FIRST_ERR" "$FIRST_OUT"
  exit 1
fi

SESSION_ID="$(json_field "$FIRST_OUT" session_id)"
if [ -z "$SESSION_ID" ]; then SESSION_ID="$(json_field "$FIRST_OUT" sessionId)"; fi
RESULT1="$(json_field "$FIRST_OUT" result || true)"
[ -n "$SESSION_ID" ] && ok "first turn returned session_id=$SESSION_ID" || bad "first turn JSON did not include session_id"
if printf '%s' "$RESULT1" | grep -Fq "$NONCE"; then ok "first response echoed marker"; else bad "first response did not echo marker"; fi
ok "first turn modelUsage=$(model_usage_keys "$FIRST_OUT")"

section "B. meta-record after first turn (record-only, no transcript mutation)"
META1="$TMP/meta1.json"
find_meta_record_json "$SESSION_ID" > "$META1"
COUNT1="$(json_field "$META1" count)"
if [ "$COUNT1" = "1" ]; then ok "exactly one meta-record binds nativeSessionId after first turn"; else bad "expected 1 meta-record after first turn, got $COUNT1"; fi
META_FILE="$(node -e 'const o=require(process.argv[1]); process.stdout.write(o.matches?.[0]?.file || "")' "$META1")"
TRANSCRIPT_PATH="$(node -e 'const o=require(process.argv[1]); process.stdout.write(o.matches?.[0]?.record?.transcriptPath || "")' "$META1")"
GARDEN_ID="$(node -e 'const o=require(process.argv[1]); process.stdout.write(o.matches?.[0]?.record?.gardenId || "")' "$META1")"
[ -n "$GARDEN_ID" ] && ok "meta-record gardenId=$GARDEN_ID" || bad "meta-record missing gardenId"
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then ok "meta-record transcriptPath exists"; else bad "meta-record transcriptPath missing or absent: $TRANSCRIPT_PATH"; fi

section "C. native Claude Code resume"
if run_claude_json "$SECOND_OUT" "$SECOND_ERR" --resume "$SESSION_ID" "$SECOND_PROMPT"; then
  ok "claude --resume $SESSION_ID completed"
else
  bad "claude --resume $SESSION_ID failed"
  classify_error "$SECOND_ERR" "$SECOND_OUT"
  echo "  first-json: $FIRST_OUT"
  echo "  meta-json:  $META1"
  exit 1
fi
RESULT2="$(json_field "$SECOND_OUT" result || true)"
if printf '%s' "$RESULT2" | grep -Fq "$NONCE"; then ok "resume response recalled marker"; else bad "resume response did not recall marker"; fi
ok "resume turn modelUsage=$(model_usage_keys "$SECOND_OUT")"

section "D. meta-record after resume"
META2="$TMP/meta2.json"
find_meta_record_json "$SESSION_ID" > "$META2"
COUNT2="$(json_field "$META2" count)"
if [ "$COUNT2" = "1" ]; then ok "resume did not create duplicate meta-records for nativeSessionId"; else bad "expected 1 meta-record after resume, got $COUNT2"; fi
TRANSCRIPT_PATH2="$(node -e 'const o=require(process.argv[1]); process.stdout.write(o.matches?.[0]?.record?.transcriptPath || "")' "$META2")"
if [ "$TRANSCRIPT_PATH2" = "$TRANSCRIPT_PATH" ]; then ok "resume kept the same transcriptPath binding"; else bad "transcriptPath drifted: first=$TRANSCRIPT_PATH second=$TRANSCRIPT_PATH2"; fi
if [ -n "$META_FILE" ] && [ -f "$META_FILE" ]; then ok "meta-record file remains on disk: $META_FILE"; else bad "meta-record file missing after resume"; fi

section "SUMMARY"
echo "  pass=$pass fail=$fail session_id=$SESSION_ID garden_id=$GARDEN_ID"
echo "  scratch=$SCRATCH"
echo "  transcript=$TRANSCRIPT_PATH"
if [ "$fail" -gt 0 ]; then exit 1; fi
echo "  OK: Claude Code native resume works while meta-bridge only records identity."
