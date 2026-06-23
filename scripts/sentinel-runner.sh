#!/usr/bin/env bash
# sentinel-runner.sh — 6-cell entwurf matrix sentinel.
#
# Covers the high-risk diagonal slice of parent_surface × target before
# committing to a full 18-cell positive matrix. Each cell runs:
#   spawn:  parent pi → entwurf(task, provider, model, mode=sync)
#   resume: parent pi → entwurf_resume(sessionId, prompt)
# and asserts structural evidence only — never the parent model's
# natural-language echo. Evidence comes from two sources:
#   1. raw `pi --mode json` stdout (for Session ID extraction)
#   2. the entwurf's session JSONL (for turn count, identity, cost)
#
# Usage:
#   scripts/sentinel-runner.sh                 # all 6 cells
#   scripts/sentinel-runner.sh 1,3,5           # subset by id
#   scripts/sentinel-runner.sh --help
#
# Env overrides:
#   SENTINEL_ARTIFACT — final JSON path (default: /tmp/sentinel-<ts>.json)
#   SENTINEL_TIMEOUT  — per-pi-call timeout seconds (default: 240)
#   SENTINEL_WAIT     — resume polling budget seconds (default: 180)
#   REPOS             — ~/repos/gh root (default: $HOME/repos/gh)
#
# Scope (this round, per PM): sync spawn + resume only. Out of scope:
#   - opus / mini target positive coverage
#   - async completion matrix
#   - remote/SSH
#   - full 18/18

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPOS="${REPOS:-$HOME/repos/gh}"
SESSIONS_BASE="$HOME/.pi/agent/sessions"
PROJECT_CWD="$(pwd -P)"
PROJECT_SESSION_SLUG="--${PROJECT_CWD#/}--"
PROJECT_SESSION_DIR="$SESSIONS_BASE/${PROJECT_SESSION_SLUG//\//-}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ARTIFACT="${SENTINEL_ARTIFACT:-/tmp/sentinel-${TIMESTAMP}.json}"
TIMEOUT="${SENTINEL_TIMEOUT:-240}"
WAIT_BUDGET="${SENTINEL_WAIT:-180}"
# Cold-start ready-gate (ACP parents only). When an ACP backend + its
# entwurf-bridge MCP child are still warming up, the parent can try to call the
# entwurf tool before it is registered and get "No such tool available", so no
# worker is spawned. That is a one-shot startup race; normal prompts often hide
# it because the model does a little natural warmup work before the tool call.
# Policy: ONE warmup-grace retry after a short backoff, then fail hard. A
# deterministic error like "No such tool" must never be retried in a loop. One
# grace re-run for the warmup window, then fail. (The raw --mode json spawn log
# balloons with streaming partials on this path — grepping it wholesale is what
# flooded an earlier investigation's context, so keep diagnostics scoped to
# final messages.) The 2026-06-01 green full sentinel did not need this retry;
# it remains a bounded backup until upstream exposes/awaits deterministic MCP
# readiness. If the tool is still uncallable on the retry, the normal checks
# fail and surface a real readiness gap rather than masking it.
READY_RETRIES="${SENTINEL_READY_RETRIES:-1}"
READY_BACKOFF="${SENTINEL_READY_BACKOFF:-3}"
LOG_DIR="/tmp/sentinel-${TIMESTAMP}"
mkdir -p "$LOG_DIR"

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_GRAY=$'\033[90m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_GRAY=''; C_BOLD=''; C_RESET=''
fi

log() { printf '[sentinel] %s\n' "$*" >&2; }

usage() {
  cat <<'EOF'
sentinel-runner.sh — 6-cell entwurf matrix sentinel

Usage: scripts/sentinel-runner.sh [cells]

Arguments:
  cells    comma-separated cell ids (1..6). Omit for all.

Environment:
  SENTINEL_ARTIFACT   JSON output path (default: /tmp/sentinel-<ts>.json)
  SENTINEL_TIMEOUT    per-pi-call timeout seconds (default: 240)
  SENTINEL_WAIT       resume polling budget seconds (default: 180)

Cells:
  1  native          → openai-codex/gpt-5.4
  2  native          → entwurf/claude-sonnet-4-6
  3  native          → entwurf/gpt-5.4 (explicitOnly)
  4  acp-claude      → openai-codex/gpt-5.4
  5  acp-claude      → entwurf/gpt-5.4 (explicitOnly)
  6  acp-codex       → openai-codex/gpt-5.4

Failure codes:
  S1 parent non-zero exit            (spawn stage)
  S2 no "Session ID:" in raw stream
  S3 session file not found for sessionId
  S4 session has no assistant turn
  S5 identity mismatch (lastModel vs target)
  S6 bridge path != new             (child stderr, ACP-target only)
  S7 entwurf absent from tool schema (parent never invoked it; no spawn)
  R1 parent non-zero exit            (resume stage)
  R2 turns did not increase within SENTINEL_WAIT
  R3 identity drift on resume (lastModel changed)
  R4 bridge path != resume|load      (child stderr, ACP-target only)
  R5 semantic recall missed          (token not in last assistant turn)
  R6 parent emitted no resume tool call (tool-omission; checked before R2)
EOF
}

# ----------------------------------------------------------------------------
# Prompt hygiene — 운영 룰 (2026-04-23 wording 오염 사건 교훈)
#
# 두 층은 별개다. 한 층의 통과를 다른 층의 통과로 외삽하지 말 것:
#   - bridge continuity : child stderr `[entwurf:bootstrap]` path=resume|load
#   - semantic continuity : 이전 turn의 사실을 다음 turn에서 회수
#
# 기억 토큰 선택 규칙:
#   - 반드시 의미 중립 명사(동물/식물/자연/사물). 문화·정치 함의 없는 것.
#   - 금지: "test-token-*", "password", "secret", "api key",
#           "credential", 영숫자 식별자 형태 전반. safety 해석을 유발함.
#   - 첫 turn 응답은 짧은 ack(READY)로 강제해 모델이 산만해지지 않게.
# ----------------------------------------------------------------------------
TOKEN_POOL=(올빼미 해바라기 단풍나무 갈대 벚꽃 호수 구름 바다 사슴 고래 보름달 소나무 매화 등불 돌탑)
pick_token() {
  echo "${TOKEN_POOL[$(( RANDOM % ${#TOKEN_POOL[@]} ))]}"
}

# ----------------------------------------------------------------------------
# Cell registry
# id|parent_key|target_provider|target_model
# ----------------------------------------------------------------------------
ALL_CELLS=(
  "1|native|openai-codex|gpt-5.4"
  "2|native|entwurf|claude-sonnet-4-6"
  "3|native|entwurf|gpt-5.4"
  "4|acp-claude|openai-codex|gpt-5.4"
  "5|acp-claude|entwurf|gpt-5.4"
  "6|acp-codex|openai-codex|gpt-5.4"
)

# ----------------------------------------------------------------------------
# Parent spawn — runs pi with the chosen parent surface, captures stdout.
# Uses `pi --mode json` so the tool_result payloads reach stdout verbatim,
# giving us a paraphrase-free anchor for `Session ID: <YYYYMMDDTHHMMSS-xxxxxx>`.
#
# child_stderr_log (4th arg, optional): when set, exported to the parent pi as
# PI_ENTWURF_CHILD_STDERR_LOG so entwurf-core's mirrorChildStderr() appends
# the entwurf child's stderr to that file. This is the only way to observe
# child-side `[entwurf:bootstrap]` bridge markers — parent stderr can't
# see the bridge when target provider is entwurf (bridge lives in child).
# ----------------------------------------------------------------------------
new_session_id() {
  bash "$SCRIPT_DIR/run.sh" new-session-id
}

parent_spawn() {
  local parent_key="$1" prompt="$2" out_file="$3" child_stderr_log="${4:-}"
  # The parent's OWN launched session id, exposed to the caller so the S2
  # session-file fallback can refuse to mistake the parent for its child (an
  # ACP parent that never spawns — e.g. entwurf tool not in the model schema —
  # otherwise leaves its own --session-id file as the newest, which the fallback
  # would wrongly adopt). Empty for native parents (they emit "Session ID:" and
  # never reach the fallback; they also run without an explicit --session-id).
  PARENT_LAUNCH_SID=""
  if [ -n "$child_stderr_log" ]; then
    export PI_ENTWURF_CHILD_STDERR_LOG="$child_stderr_log"
  else
    unset PI_ENTWURF_CHILD_STDERR_LOG
  fi
  case "$parent_key" in
    native)
      # --no-extensions -e entwurf.ts: load only our entwurf tool. This is the
      # same pattern as validate_pi_native_async_entwurf and avoids accidental
      # cross-loads from global extensions.
      timeout "$TIMEOUT" pi --mode json -p --no-extensions \
        -e "$SCRIPT_DIR/pi-extensions/entwurf.ts" \
        --provider openai-codex --model gpt-5.4-mini \
        "$prompt" >"$out_file" 2>&1
      ;;
    acp-claude)
      # ACP parent brings entwurf-bridge MCP into scope through the repo extension.
      # The MCP entwurf/entwurf_resume tools are what the parent will invoke; live
      # backend callability for this path is owned by sentinel itself.
      # --entwurf-control: ACP-parent async resume routes through the MCP
      # `spawn_async_resume` RPC, which needs this session's control socket
      # (mcp/entwurf-bridge/src/index.ts throws "No pi control socket" without it).
      # Native parents (cells 1/3) use the in-process callback and don't need it.
      # The operator's real-use alias (`pia`) always passes --entwurf-control, so this
      # matches prod. The flag is passed explicitly here — this script never relies on a
      # shell alias (non-interactive bash does not expand aliases, and `pi` resolves to the
      # pnpm binary), so renaming the alias `pi`→`pia` does not affect the sentinel.
      PARENT_LAUNCH_SID=$(new_session_id) || return 2
      timeout "$TIMEOUT" pi --mode json -p --session-id "$PARENT_LAUNCH_SID" --entwurf-control \
        -e "$REPOS/entwurf" \
        --provider entwurf --model claude-sonnet-4-6 \
        "$prompt" >"$out_file" 2>&1
      ;;
    acp-codex)
      PARENT_LAUNCH_SID=$(new_session_id) || return 2
      timeout "$TIMEOUT" pi --mode json -p --session-id "$PARENT_LAUNCH_SID" --entwurf-control \
        -e "$REPOS/entwurf" \
        --provider entwurf --model gpt-5.4 \
        "$prompt" >"$out_file" 2>&1
      ;;
    *)
      log "unknown parent_key: $parent_key"
      return 2 ;;
  esac
}

# ----------------------------------------------------------------------------
# Prompts. Each one is a REAL task with a purpose, not a "call this tool with
# these args" mechanical drill. A capable model handed a purposeless procedure
# ("entwurf_resume 도구를 정확히 1회 호출하고 즉시 턴을 종료하라") can rationally
# collapse it into a no-op — observed 2026-05-31 as a cell-5 tool-call omission:
# the parent Sonnet thought "call then end the turn immediately" and ended the
# turn WITHOUT emitting the call (toolResults:[], stopReason:stop). The fix is
# to hand the parent a goal it can only reach by calling the tool and reading
# the worker's answer, then reporting it.
#
# Both tasks run mode:"sync" so the parent BLOCKS on the worker and receives the
# answer inline. Every parent surface honors explicit mode:"sync" — the native
# entwurf_resume tool branch (pi-extensions/entwurf.ts) and the MCP bridge's
# runEntwurfResumeSync. The replyable-caller async default only applies when
# mode is OMITTED; pinning sync removes that variance from the matrix (the async
# resume path has its own live gate, smoke-async-resume).
#
# The spawn task plants a neutral memory token and asks the worker for a fixed
# ack (READY); the resume task asks the worker to recall the token. Token
# neutrality + short ack protects the check from safety-filter contamination
# (see Prompt hygiene rules at the top of this file).
# ----------------------------------------------------------------------------
build_spawn_prompt() {
  local provider="$1" model="$2" token="$3"
  printf '분신을 하나 띄워서 "%s" 라는 단어를 기억시켜라. entwurf 도구를 mode:"sync"로 호출하되 인수는 { task: "기억 단어는 %s 다. READY 한 단어만 답해라.", provider: "%s", model: "%s", mode: "sync" } 로 주고, 분신이 답한 한 단어를 너의 최종 답으로 보고하라.' \
    "$token" "$token" "$provider" "$model"
}

build_resume_prompt() {
  local session_id="$1"
  printf '방금 띄운 분신(sessionId=%s)에게 기억한 단어가 무엇인지 물어봐라. entwurf_resume 도구를 mode:"sync"로 호출하되 인수는 { sessionId: "%s", prompt: "기억 단어를 한 단어로만 답해라.", mode: "sync" } 로 주고, 분신이 답한 그 한 단어를 너의 최종 답으로 보고하라.' \
    "$session_id" "$session_id"
}

# ----------------------------------------------------------------------------
# Evidence extraction
# ----------------------------------------------------------------------------
# Session ID appears verbatim in the tool_result content of the entwurf tool
# response (see formatSyncSummary / async spawn). Grepping the raw --mode json
# stream is paraphrase-proof. sessionId grammar: YYYYMMDDTHHMMSS-[0-9a-f]{6}.
extract_session_id() {
  grep -oE 'Session ID: [0-9]{8}T[0-9]{6}-[0-9a-f]{6}' "$1" | head -1 | awk '{print $3}'
}

# Cold-start readiness signal: the parent's raw stream shows the entwurf MCP
# tool was uncallable ("No such tool available"), so the call never reached the
# core and no worker was spawned. Used by the ready-gate to distinguish an
# infra-warmup race (retry) from a genuine outcome (see READY_RETRIES).
entwurf_tool_uncallable() {
  grep -q 'No such tool available' "$1" 2>/dev/null
}

# Did the parent actually INVOKE the entwurf tool in its raw stream? This is the
# precondition for treating the cell as a real MCP-surface spawn. A genuine
# invocation shows a tool-call EVENT, in one of the parent surfaces' two shapes:
#   native pi : a toolCall event carrying  "name":"entwurf"
#   ACP       : [tool:start] Tool: entwurf-bridge/entwurf
# Both patterns are STRUCTURAL (the event envelope), deliberately NOT the bare
# word "entwurf": a parent that bypasses via Bash/Terminal — or narrates "the
# entwurf tool is not exposed" — mentions the word many times in tool
# descriptions / thinking / pi-CLI args (observed 35× in a pure-Bash bypass log)
# WITHOUT ever emitting the event. Matching the word would let a Bash bypass
# masquerade as a real spawn (and a bash-spawned `pi` even echoes a "Session ID:"
# — proving the CLI, not the MCP surface). Returns 0 (true) only on a real
# entwurf tool-call event.
parent_invoked_entwurf() {
  grep -qE '"name":"entwurf"|\[tool:start\] Tool: [a-zA-Z0-9/._-]*entwurf' "$1" 2>/dev/null
}

# Pi names entwurf session files `<created-at>_<sessionId>.jsonl` (0.9.0
# garden-native identity). The sessionId in the filename is the discovery aid;
# the JSONL header `id` is the real authority (findSessionFileById in core).
find_session_file() {
  local session_id="$1"
  find "$PROJECT_SESSION_DIR" -type f -name "*_${session_id}.jsonl" 2>/dev/null | head -1
}

# S2 fallback: find the most recent project-local session file created after $1
# (epoch). Needed when the parent surface does not echo tool_result text into
# the raw --mode json assistant content (observed with ACP Codex parent, where
# `[tool:done]` is emitted but the structured result lives outside the captured
# content stream). Keep the search scoped to the current project session dir;
# a global search can pick up an unrelated live user's session and turn a
# tool-call omission into a false identity failure. Entwurf-ness is no longer a
# filename species (0.9.0): the newest-after-threshold session in this isolated
# project dir is the one we just spawned. The sessionId is parsed from the
# Pi filename `<created-at>_<sessionId>.jsonl`.
# Emits: "<sessionId>\t<session_file>" on stdout, empty on miss.
find_new_entwurf_session() {
  local threshold_ts="$1"
  local newest
  newest=$(find "$PROJECT_SESSION_DIR" -type f -name '*_[0-9]*T[0-9]*-*.jsonl' \
           -newermt "@$threshold_ts" 2>/dev/null |
           xargs -r -I{} stat -c '%Y {}' "{}" 2>/dev/null |
           sort -nr | head -1 | awk '{ $1=""; sub(/^ /, ""); print }')
  [ -z "$newest" ] && return 1
  local sid
  sid=$(basename "$newest" | grep -oE '[0-9]{8}T[0-9]{6}-[0-9a-f]{6}' | head -1)
  [ -z "$sid" ] && return 1
  printf '%s\t%s\n' "$sid" "$newest"
}

# Analyze a entwurf session JSONL and emit {turns, cost, lastModel, lastProvider, lastStopReason, lastError}.
# Matches analyzeSessionFileLike in entwurf-core.ts — we deliberately re-implement here to keep
# the sentinel free of module-resolution concerns (no TS build dependency).
analyze_session() {
  SENTINEL_FILE="$1" node -e '
const fs = require("fs");
const f = process.env.SENTINEL_FILE;
let turns = 0, cost = 0;
let lastModel = "", lastProvider = "", lastStopReason = "", lastError = "";
try {
  const content = fs.readFileSync(f, "utf-8");
  for (const line of content.trim().split("\n")) {
    try {
      const e = JSON.parse(line);
      if (e.type !== "message" || e.message?.role !== "assistant") continue;
      turns++;
      if (typeof e.message.model === "string") lastModel = e.message.model;
      if (typeof e.message.provider === "string") lastProvider = e.message.provider;
      if (typeof e.message.stopReason === "string") lastStopReason = e.message.stopReason;
      if (typeof e.message.errorMessage === "string" && e.message.errorMessage.trim())
        lastError = e.message.errorMessage.trim();
      const c = e.message.usage?.cost?.total;
      if (typeof c === "number") cost += c;
    } catch {}
  }
} catch (e) {
  lastError = "read_error:" + (e instanceof Error ? e.message : String(e));
}
console.log(JSON.stringify({turns, cost, lastModel, lastProvider, lastStopReason, lastError}));
'
}

# Sum the parent pi's assistant-turn cost by walking its --mode json stdout.
parent_cost() {
  SENTINEL_FILE="$1" node -e '
const fs = require("fs");
let cost = 0;
try {
  const content = fs.readFileSync(process.env.SENTINEL_FILE, "utf-8");
  for (const line of content.split("\n")) {
    try {
      const e = JSON.parse(line);
      if (e.type === "message_end" && e.message?.role === "assistant") {
        const c = e.message.usage?.cost?.total;
        if (typeof c === "number") cost += c;
      }
    } catch {}
  }
} catch {}
console.log(cost);
'
}

# Poll the session file until turns exceed `target`, up to WAIT_BUDGET seconds.
# Returns the final analyze_session JSON on stdout. Exit code 0 = turns grew,
# 1 = budget exhausted (but we still emit the last reading so R2 can report it).
wait_for_turns_gt() {
  local session_file="$1" target="$2"
  local elapsed=0 analysis turns
  while [ "$elapsed" -lt "$WAIT_BUDGET" ]; do
    analysis=$(analyze_session "$session_file")
    turns=$(echo "$analysis" | jq -r '.turns')
    if [ "$turns" -gt "$target" ]; then
      echo "$analysis"
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  analyze_session "$session_file"
  return 1
}

# Last assistant turn's textual content from a entwurf session JSONL.
# Used for semantic recall assertion (R5). We concatenate text blocks only.
last_assistant_text() {
  SENTINEL_FILE="$1" node -e '
const fs = require("fs");
const f = process.env.SENTINEL_FILE;
let last = "";
try {
  const content = fs.readFileSync(f, "utf-8");
  for (const line of content.trim().split("\n")) {
    try {
      const e = JSON.parse(line);
      if (e.type !== "message" || e.message?.role !== "assistant") continue;
      const c = e.message.content;
      if (typeof c === "string") { last = c; continue; }
      if (Array.isArray(c)) {
        const text = c.filter(b => b && b.type === "text").map(b => b.text || "").join("\n").trim();
        if (text) last = text;
      }
    } catch {}
  }
} catch {}
console.log(last);
'
}

# Bridge continuity anchor — grep the child stderr mirror for entwurf's
# bootstrap marker. Returns the path= value (new|resume|load|invalidated) or
# empty if no marker is present.
bridge_path_from_log() {
  local log="$1"
  [ -f "$log" ] || return 0
  grep -oE '^\[entwurf:bootstrap\] path=[a-z-]+' "$log" | tail -1 | sed 's/^.*path=//'
}

# Identity pass: session's recorded model equals the registry target,
# modulo the known ACP prefix stripping. See PM-confirmed normalization:
#   openai-codex/X   → session may record "X" or "openai-codex/X"
#   entwurf/X   → session records bare "X" (ACP strips provider prefix)
identity_matches() {
  local tp="$1" tm="$2" session_model="$3"
  [ "$session_model" = "$tm" ] && return 0
  [ "$session_model" = "${tp}/${tm}" ] && return 0
  return 1
}

# ----------------------------------------------------------------------------
# Per-cell execution. Globals declared here serve as the payload carried into
# finalize_cell via bash dynamic scoping (local vars visible to called funcs).
# ----------------------------------------------------------------------------
declare -a RESULTS_JSON=()
PASS_COUNT=0
FAIL_COUNT=0

run_cell() {
  local CELL_ID="$1" CELL_PARENT="$2" CELL_TP="$3" CELL_TM="$4"
  local CELL_STATUS="FAIL" CELL_FCODE="" CELL_NOTE=""
  local SPAWN_SESSION_ID="" SPAWN_SESSION=""
  local SPAWN_TURNS=0 SPAWN_PROV="" SPAWN_MODEL="" SPAWN_STOP="" SPAWN_COST=0
  local RESUME_TB=0 RESUME_TA=0 RESUME_PROV="" RESUME_MODEL="" RESUME_STOP="" RESUME_COST=0
  local PARENT_COST=0
  # Per-cell neutral token for semantic recall (R5). Fresh each cell so we
  # can't accidentally pass via cached state from a prior run.
  local CELL_TOKEN
  CELL_TOKEN=$(pick_token)
  # Whether this cell's entwurf child uses entwurf bridge — decides
  # if S6/R4 bridge-path anchors apply. Only ACP target provider qualifies;
  # native target provider means no bridge in the child.
  local CELL_BRIDGE_CHILD=0
  [ "$CELL_TP" = "entwurf" ] && CELL_BRIDGE_CHILD=1
  # For Codex via ACP the second-load path is "load" (persisted state hydrate),
  # for Claude via ACP it is "resume" (live ACP session reuse). See entwurf
  # smoke-continuity for the canonical mapping.
  local CELL_EXPECTED_RESUME_PATH=""
  if [ "$CELL_BRIDGE_CHILD" -eq 1 ]; then
    case "$CELL_TM" in
      claude-*) CELL_EXPECTED_RESUME_PATH="resume" ;;
      gpt-*)    CELL_EXPECTED_RESUME_PATH="load" ;;
      *)        CELL_EXPECTED_RESUME_PATH="resume" ;;
    esac
  fi

  printf '%s▶ cell %s: parent=%s → %s/%s  token=%s%s\n' \
    "$C_BOLD" "$CELL_ID" "$CELL_PARENT" "$CELL_TP" "$CELL_TM" "$CELL_TOKEN" "$C_RESET" >&2

  # --- Spawn stage --------------------------------------------------------
  local spawn_prompt spawn_log="$LOG_DIR/cell${CELL_ID}-spawn.log"
  local spawn_child_log="$LOG_DIR/cell${CELL_ID}-spawn-child.log"
  spawn_prompt=$(build_spawn_prompt "$CELL_TP" "$CELL_TM" "$CELL_TOKEN")

  # Spawn with a cold-start ready-gate. Retry ONLY when no worker was spawned
  # AND the parent hit "No such tool available" (entwurf MCP not yet callable).
  # A successful spawn breaks immediately — structural evidence (Session ID or the
  # project-local session-file fallback) wins even if the raw stream also
  # contains an earlier uncallable-tool diagnostic. A genuine omission (no
  # such-tool signal at all) is not retried. See READY_RETRIES.
  local spawn_attempt=0 rc=0
  while : ; do
    spawn_attempt=$((spawn_attempt + 1))

    # Snapshot the pre-spawn wall clock (minus a second for race safety) for the
    # S2 session-file fallback. Re-taken each attempt so a retry's fallback only
    # matches files this attempt created.
    local spawn_threshold=$(( $(date +%s) - 1 ))

    rc=0
    parent_spawn "$CELL_PARENT" "$spawn_prompt" "$spawn_log" "$spawn_child_log" || rc=$?
    if [ "$rc" -ne 0 ]; then
      CELL_FCODE="S1"
      CELL_NOTE="parent exit rc=$rc (timeout or crash) — see $spawn_log"
      finalize_cell; return
    fi

    SPAWN_SESSION_ID=$(extract_session_id "$spawn_log")
    if ! parent_invoked_entwurf "$spawn_log"; then
      # HARD GATE — this cell exists to prove the MCP entwurf SURFACE. If the
      # parent did not invoke `mcp__entwurf-bridge__entwurf` (it bypassed via
      # Bash/Terminal or the pi CLI, or declined), the cell has FAILED, full
      # stop. A "Session ID:" echoed by a bash-spawned `pi` does NOT count — it
      # proves the CLI works, not the MCP surface. Discard any such id so the
      # cell falls through to the honest S7 classification below. The whole
      # point (GLG): MCP-surface-or-bust — a Bash fallback is an error, not a
      # pass, and must blow up immediately.
      SPAWN_SESSION_ID=""
    elif [ -z "$SPAWN_SESSION_ID" ]; then
      # S2 fallback — entwurf WAS invoked, but the surface did not echo the id
      # into the raw stream (ACP Codex). The fs is truth — but never adopt the
      # parent's OWN launched session: a no-spawn would otherwise leave it as
      # the newest delta and get mislabeled as an S5 model mismatch.
      local fb cand_sid
      if fb=$(find_new_entwurf_session "$spawn_threshold"); then
        cand_sid="${fb%%$'\t'*}"
        if [ -n "$PARENT_LAUNCH_SID" ] && [ "$cand_sid" = "$PARENT_LAUNCH_SID" ]; then
          log "  [fallback] rejected: newest delta is the parent's own session ($cand_sid), not a child"
        else
          SPAWN_SESSION_ID="$cand_sid"
          SPAWN_SESSION="${fb##*$'\t'}"
          log "  [fallback] sessionId=$SPAWN_SESSION_ID from session-file delta"
        fi
      fi
    fi

    # Worker spawned → success.
    [ -n "$SPAWN_SESSION_ID" ] && break

    # No worker. Cold-start race? Back off and re-run, up to READY_RETRIES.
    if entwurf_tool_uncallable "$spawn_log" && [ "$spawn_attempt" -le "$READY_RETRIES" ]; then
      log "  [ready-gate] entwurf MCP tool not yet callable (No such tool); backoff ${READY_BACKOFF}s, retry ${spawn_attempt}/${READY_RETRIES}"
      SPAWN_SESSION=""
      sleep "$READY_BACKOFF"
      continue
    fi

    CELL_FCODE="S2"
    if entwurf_tool_uncallable "$spawn_log"; then
      CELL_NOTE="entwurf MCP tool stayed uncallable ('No such tool') after the warmup-grace retry — real backend-readiness defect, not a warmup race — see $spawn_log"
    elif ! parent_invoked_entwurf "$spawn_log"; then
      CELL_FCODE="S7"
      CELL_NOTE="parent did NOT invoke the MCP entwurf tool — no '[tool:start] ...entwurf' in the raw stream. It bypassed via Bash/Terminal or the pi CLI, or declined to call it. The MCP entwurf surface was NOT exercised (a Session ID echoed by a bash-spawned pi does not count). This is a real cell failure, NOT a spawn/model-identity defect — see $spawn_log"
    else
      CELL_NOTE="no 'Session ID:' in raw stream and no new entwurf session file after parent exit — see $spawn_log"
    fi
    finalize_cell; return
  done
  log "  spawn sessionId=$SPAWN_SESSION_ID"

  # Reuse session file from fallback if already resolved; otherwise look it up.
  if [ -z "$SPAWN_SESSION" ]; then
    SPAWN_SESSION=$(find_session_file "$SPAWN_SESSION_ID")
  fi
  if [ -z "$SPAWN_SESSION" ] || [ ! -f "$SPAWN_SESSION" ]; then
    CELL_FCODE="S3"
    CELL_NOTE="no session JSONL found for sessionId=$SPAWN_SESSION_ID under $PROJECT_SESSION_DIR"
    finalize_cell; return
  fi

  local spawn_analysis
  spawn_analysis=$(analyze_session "$SPAWN_SESSION")
  SPAWN_TURNS=$(echo "$spawn_analysis" | jq -r '.turns')
  SPAWN_PROV=$(echo "$spawn_analysis" | jq -r '.lastProvider')
  SPAWN_MODEL=$(echo "$spawn_analysis" | jq -r '.lastModel')
  SPAWN_STOP=$(echo "$spawn_analysis" | jq -r '.lastStopReason')
  SPAWN_COST=$(echo "$spawn_analysis" | jq -r '.cost')

  if [ "${SPAWN_TURNS:-0}" -lt 1 ]; then
    CELL_FCODE="S4"
    CELL_NOTE="session has 0 assistant turns — entwurf never reached a message_end"
    finalize_cell; return
  fi

  if ! identity_matches "$CELL_TP" "$CELL_TM" "$SPAWN_MODEL"; then
    CELL_FCODE="S5"
    CELL_NOTE="expected model=$CELL_TM (or $CELL_TP/$CELL_TM), session recorded lastModel=$SPAWN_MODEL"
    finalize_cell; return
  fi

  # Bridge continuity on spawn (ACP-target only): child's entwurf should
  # announce path=new for the fresh session. If missing or different, the
  # bridge did not engage as expected.
  if [ "$CELL_BRIDGE_CHILD" -eq 1 ]; then
    local spawn_bridge_path
    spawn_bridge_path=$(bridge_path_from_log "$spawn_child_log")
    if [ "$spawn_bridge_path" != "new" ]; then
      CELL_FCODE="S6"
      CELL_NOTE="bridge spawn path expected=new, got=${spawn_bridge_path:-<absent>} — see $spawn_child_log"
      finalize_cell; return
    fi
  fi

  # --- Resume stage -------------------------------------------------------
  RESUME_TB="$SPAWN_TURNS"
  local resume_prompt resume_log="$LOG_DIR/cell${CELL_ID}-resume.log"
  local resume_child_log="$LOG_DIR/cell${CELL_ID}-resume-child.log"
  resume_prompt=$(build_resume_prompt "$SPAWN_SESSION_ID")

  # Resume with the same cold-start ready-gate as the spawn stage. Retry fast
  # (before spending WAIT_BUDGET) only when the entwurf_resume tool was
  # uncallable AND the worker's turn has not landed — the warmup race. A normal
  # sync resume has the worker turn appended by the time the parent returns, so
  # it breaks on the first pass and proceeds to the R6/turn-growth checks below.
  local resume_attempt=0 rc=0
  while : ; do
    resume_attempt=$((resume_attempt + 1))
    rc=0
    parent_spawn "$CELL_PARENT" "$resume_prompt" "$resume_log" "$resume_child_log" || rc=$?
    if [ "$rc" -ne 0 ]; then
      CELL_FCODE="R1"
      CELL_NOTE="resume parent exit rc=$rc — see $resume_log"
      finalize_cell; return
    fi
    if entwurf_tool_uncallable "$resume_log" && [ "$resume_attempt" -le "$READY_RETRIES" ]; then
      local quick_turns
      quick_turns=$(analyze_session "$SPAWN_SESSION" | jq -r '.turns')
      if [ "${quick_turns:-0}" -le "$RESUME_TB" ]; then
        log "  [ready-gate] entwurf_resume MCP tool not yet callable (No such tool); backoff ${READY_BACKOFF}s, retry ${resume_attempt}/${READY_RETRIES}"
        sleep "$READY_BACKOFF"
        continue
      fi
    fi
    break
  done

  # Tool-omission guard (R6) — classify a no-op parent immediately instead of
  # blocking the full WAIT_BUDGET on a turn that will never grow. The resume
  # prompt pins mode:"sync", so a parent that actually invoked the tool blocks
  # on the worker and the child turn is already appended by the time the parent
  # returns; a parent that omitted the call returns fast with no tool invocation
  # in its own stream. The marker is the parent's tool-call event, matched
  # across all three surfaces (native `toolCall`/`toolName`/`toolUse`, Claude
  # `mcp__entwurf-bridge__…`, Codex `entwurf-bridge/…`). The prompt echoes
  # `entwurf_resume` but none of these tokens, so an omission cannot be masked
  # by prompt echo. Non-authoritative for PASS — a genuine call still has to
  # clear the turn-growth + identity + continuity checks below.
  if ! grep -qE 'toolName|toolUse|"type":"tool[cC]all|tool_execution_start|mcp__entwurf-bridge__|entwurf-bridge/entwurf' "$resume_log"; then
    CELL_FCODE="R6"
    CELL_NOTE="parent emitted no entwurf_resume tool call (tool-omission) — see $resume_log"
    finalize_cell; return
  fi

  # Resume prompt pins mode:"sync" on every parent surface, so the worker runs
  # synchronously and its turn is appended before the parent returns. Poll the
  # saved session file to confirm the turn landed (instant on the sync path; the
  # budget only absorbs slow backends).
  local resume_analysis
  if resume_analysis=$(wait_for_turns_gt "$SPAWN_SESSION" "$RESUME_TB"); then
    :
  else
    CELL_FCODE="R2"
    RESUME_TA=$(echo "$resume_analysis" | jq -r '.turns')
    CELL_NOTE="turns did not increase within ${WAIT_BUDGET}s (before=$RESUME_TB, after=$RESUME_TA)"
    RESUME_PROV=$(echo "$resume_analysis" | jq -r '.lastProvider')
    RESUME_MODEL=$(echo "$resume_analysis" | jq -r '.lastModel')
    RESUME_STOP=$(echo "$resume_analysis" | jq -r '.lastStopReason')
    RESUME_COST=$(echo "$resume_analysis" | jq -r '.cost')
    finalize_cell; return
  fi

  RESUME_TA=$(echo "$resume_analysis" | jq -r '.turns')
  RESUME_PROV=$(echo "$resume_analysis" | jq -r '.lastProvider')
  RESUME_MODEL=$(echo "$resume_analysis" | jq -r '.lastModel')
  RESUME_STOP=$(echo "$resume_analysis" | jq -r '.lastStopReason')
  RESUME_COST=$(echo "$resume_analysis" | jq -r '.cost')

  # Identity preservation: lastModel must not drift between spawn and resume.
  # This is tighter than "matches target" — we want the EXACT recorded identity
  # to survive across the resume.
  if [ "$RESUME_MODEL" != "$SPAWN_MODEL" ]; then
    CELL_FCODE="R3"
    CELL_NOTE="identity drift: spawn recorded $SPAWN_MODEL, resume recorded $RESUME_MODEL"
    finalize_cell; return
  fi

  # Bridge continuity on resume (ACP-target only): child's entwurf must
  # announce path=resume (Claude) or path=load (Codex). Anything else — new,
  # invalidated, absent — means the bridge did not reconnect the session and
  # we're seeing structural turn growth over a freshly replayed history rather
  # than true continuity. R3 identity check alone cannot distinguish these.
  if [ "$CELL_BRIDGE_CHILD" -eq 1 ]; then
    local resume_bridge_path
    resume_bridge_path=$(bridge_path_from_log "$resume_child_log")
    if [ "$resume_bridge_path" != "$CELL_EXPECTED_RESUME_PATH" ]; then
      CELL_FCODE="R4"
      CELL_NOTE="bridge resume path expected=$CELL_EXPECTED_RESUME_PATH, got=${resume_bridge_path:-<absent>} — see $resume_child_log"
      finalize_cell; return
    fi
  fi

  # Semantic continuity: the token planted on spawn must appear in the last
  # assistant turn after resume. This is the layer that R2/R3 cannot cover
  # (a cache-miss replay can still pass R2/R3). Neutral token + short ack
  # prompt design — see Prompt hygiene rules at top of file.
  local last_text
  last_text=$(last_assistant_text "$SPAWN_SESSION")
  if [[ "$last_text" != *"$CELL_TOKEN"* ]]; then
    CELL_FCODE="R5"
    CELL_NOTE="semantic recall missed: token='$CELL_TOKEN' not in last assistant turn — got: ${last_text:0:120}"
    finalize_cell; return
  fi

  CELL_STATUS="PASS"
  CELL_FCODE=""
  finalize_cell
}

finalize_cell() {
  PARENT_COST=$(
    {
      [ -s "$LOG_DIR/cell${CELL_ID}-spawn.log" ] && parent_cost "$LOG_DIR/cell${CELL_ID}-spawn.log"
      [ -s "$LOG_DIR/cell${CELL_ID}-resume.log" ] && parent_cost "$LOG_DIR/cell${CELL_ID}-resume.log"
    } | jq -s 'add // 0'
  )

  if [ "$CELL_STATUS" = "PASS" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf '%s  ✓ cell %s PASS — turns %d→%d, model=%s%s\n' \
      "$C_GREEN" "$CELL_ID" "$RESUME_TB" "$RESUME_TA" "$RESUME_MODEL" "$C_RESET" >&2
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf '%s  ✗ cell %s FAIL [%s] — %s%s\n' \
      "$C_RED" "$CELL_ID" "$CELL_FCODE" "$CELL_NOTE" "$C_RESET" >&2
  fi

  local json
  json=$(
    CELL_ID="$CELL_ID" CELL_PARENT="$CELL_PARENT" CELL_TP="$CELL_TP" CELL_TM="$CELL_TM" \
    CELL_STATUS="$CELL_STATUS" CELL_FCODE="$CELL_FCODE" CELL_NOTE="$CELL_NOTE" \
    SPAWN_SESSION_ID="$SPAWN_SESSION_ID" SPAWN_SESSION="$SPAWN_SESSION" \
    SPAWN_TURNS="$SPAWN_TURNS" SPAWN_PROV="$SPAWN_PROV" SPAWN_MODEL="$SPAWN_MODEL" \
    SPAWN_STOP="$SPAWN_STOP" SPAWN_COST="$SPAWN_COST" \
    RESUME_TB="$RESUME_TB" RESUME_TA="$RESUME_TA" \
    RESUME_PROV="$RESUME_PROV" RESUME_MODEL="$RESUME_MODEL" \
    RESUME_STOP="$RESUME_STOP" RESUME_COST="$RESUME_COST" \
    PARENT_COST="$PARENT_COST" \
    SPAWN_LOG="$LOG_DIR/cell${CELL_ID}-spawn.log" \
    RESUME_LOG="$LOG_DIR/cell${CELL_ID}-resume.log" \
    node -e '
const env = process.env;
const num = (k) => { const v = env[k]; if (!v) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; };
const str = (k) => (env[k] && env[k].length) ? env[k] : null;
const obj = {
  cellId: str("CELL_ID"),
  parentSurface: str("CELL_PARENT"),
  target: { provider: str("CELL_TP"), model: str("CELL_TM") },
  status: str("CELL_STATUS"),
  failureCode: str("CELL_FCODE"),
  note: str("CELL_NOTE"),
  spawn: {
    sessionId: str("SPAWN_SESSION_ID"),
    sessionFile: str("SPAWN_SESSION"),
    turns: num("SPAWN_TURNS"),
    lastProvider: str("SPAWN_PROV"),
    lastModel: str("SPAWN_MODEL"),
    lastStopReason: str("SPAWN_STOP"),
    cost: num("SPAWN_COST"),
    parentLog: str("SPAWN_LOG"),
  },
  resume: {
    turnsBefore: num("RESUME_TB"),
    turnsAfter: num("RESUME_TA"),
    lastProvider: str("RESUME_PROV"),
    lastModel: str("RESUME_MODEL"),
    lastStopReason: str("RESUME_STOP"),
    cost: num("RESUME_COST"),
    parentLog: str("RESUME_LOG"),
  },
  parentCost: num("PARENT_COST"),
  costTotal: num("RESUME_COST") + num("PARENT_COST"),
};
console.log(JSON.stringify(obj));
'
  )
  RESULTS_JSON+=("$json")
}

# ----------------------------------------------------------------------------
# Final reporting: human-readable table + machine-readable JSON artifact.
# ----------------------------------------------------------------------------
print_table() {
  printf '\n%s══════════════════════════════════════════════════════════════════════════════%s\n' \
    "$C_BOLD" "$C_RESET"
  printf '%s Sentinel matrix — %d/%d PASS (artifact: %s)%s\n' \
    "$C_BOLD" "$PASS_COUNT" "$((PASS_COUNT + FAIL_COUNT))" "$ARTIFACT" "$C_RESET"
  printf '%s══════════════════════════════════════════════════════════════════════════════%s\n' \
    "$C_BOLD" "$C_RESET"
  printf '%-3s %-12s %-30s %-9s %-8s %-9s\n' '#' 'parent' 'target' 'spawn' 'resume' 'cost($)'
  printf '%s\n' '─────────────────────────────────────────────────────────────────────────────'
  local obj
  for obj in "${RESULTS_JSON[@]}"; do
    echo "$obj"
  done | jq -r '
    . as $o
    | ($o.failureCode // "") as $fc
    | (if $o.status == "PASS"
         then "✓ \($o.spawn.turns)t"
         else (if ($fc | startswith("S")) then "✗ " + $fc else "✓ \($o.spawn.turns)t" end)
       end) as $sp
    | (if $o.status == "PASS"
         then "✓ +\($o.resume.turnsAfter - $o.resume.turnsBefore)t"
         else (if ($fc | startswith("R")) then "✗ " + $fc
               elif ($fc | startswith("S")) then "-"
               else "?" end)
       end) as $rs
    | [ $o.cellId, $o.parentSurface,
        "\($o.target.provider)/\($o.target.model)",
        $sp, $rs, ($o.costTotal | tostring | .[0:7]) ]
    | @tsv' |
  while IFS=$'\t' read -r id parent target sp rs cost; do
    printf '%-3s %-12s %-30s %-9s %-8s %-9s\n' "$id" "$parent" "$target" "$sp" "$rs" "$cost"
  done

  # Failures detail
  local any_fail=0
  for obj in "${RESULTS_JSON[@]}"; do
    if echo "$obj" | jq -e '.status == "FAIL"' >/dev/null; then
      if [ "$any_fail" -eq 0 ]; then
        printf '\n%sFailure details:%s\n' "$C_BOLD" "$C_RESET"
        any_fail=1
      fi
      echo "$obj" | jq -r '"  cell \(.cellId) [\(.failureCode)]: \(.note)"'
    fi
  done
}

write_artifact() {
  {
    echo '{'
    printf '  "generatedAt": "%s",\n' "$(date -u +%FT%TZ)"
    printf '  "artifactPath": "%s",\n' "$ARTIFACT"
    printf '  "logDir": "%s",\n' "$LOG_DIR"
    printf '  "pass": %d,\n' "$PASS_COUNT"
    printf '  "fail": %d,\n' "$FAIL_COUNT"
    echo '  "cells": ['
    local i
    for i in "${!RESULTS_JSON[@]}"; do
      if [ "$i" -gt 0 ]; then echo ','; fi
      printf '    %s' "${RESULTS_JSON[$i]}"
    done
    echo ''
    echo '  ]'
    echo '}'
  } | jq '.' > "$ARTIFACT"
  log "wrote artifact: $ARTIFACT"
}

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
main() {
  # Merge ALL positional args, not just $1: accept both space- and
  # comma-separated cell lists (`sentinel 4 5 6` and `sentinel 4,5,6`).
  # The selection loop below replaces commas with spaces and word-splits,
  # so "$*" ("4 5 6") and a single "4,5,6" arg both resolve correctly.
  local selection="${*:-all}"
  if [ "$selection" = "--help" ] || [ "$selection" = "-h" ]; then
    usage; exit 0
  fi

  # Sanity: we need pi, jq, node, and the entwurf repo for ACP cells.
  command -v pi   >/dev/null || { log "missing binary: pi";   exit 2; }
  command -v jq   >/dev/null || { log "missing binary: jq";   exit 2; }
  command -v node >/dev/null || { log "missing binary: node"; exit 2; }

  # Resolve selected cells
  local selected=()
  if [ "$selection" = "all" ]; then
    selected=("${ALL_CELLS[@]}")
  else
    local id
    for id in ${selection//,/ }; do
      local match=""
      for cell in "${ALL_CELLS[@]}"; do
        [ "${cell%%|*}" = "$id" ] && match="$cell" && break
      done
      if [ -z "$match" ]; then
        log "unknown cell id: $id (valid: 1..6)"; exit 2
      fi
      selected+=("$match")
    done
  fi

  log "log dir: $LOG_DIR"
  log "artifact: $ARTIFACT"
  log "project session dir: $PROJECT_SESSION_DIR"
  log "running ${#selected[@]} cell(s): $(printf '%s ' "${selected[@]%%|*}")"

  local cell id parent tp tm
  for cell in "${selected[@]}"; do
    IFS='|' read -r id parent tp tm <<<"$cell"
    run_cell "$id" "$parent" "$tp" "$tm"
  done

  print_table
  write_artifact

  if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
  fi
  exit 0
}

main "$@"
