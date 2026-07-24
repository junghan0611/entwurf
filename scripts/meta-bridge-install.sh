#!/usr/bin/env bash
# meta-bridge-install.sh — operator-grade global installer for the garden-native
# meta-bridge plugin (1.0.0 step 5). Makes the exact Claude Code wiring the repo
# needs, so a user never hand-edits hook/plugin settings or passes --plugin-dir.
#
# Mechanism (all proven on 2026-06-05):
#   1. ASSEMBLE a self-contained plugin under the version-stable XDG data dir
#      ($XDG_DATA_HOME/entwurf/meta-bridge/.assembled) — NEVER inside the checkout:
#      copy the committed skeleton, copy the entry shell + its lib (so
#      ${CLAUDE_PLUGIN_ROOT} self-locates them), and BAKE the node abspath into
#      hooks.json. The node path is the ONLY templated surface — the mailbox /
#      meta-record dirs resolve at runtime inside entry.ts (<pi-agent-dir>, a
#      fixed ~/ path). The plugin is wake/record hooks ONLY; the receiver-side
#      entwurf_inbox_read tool comes from USER-scope entwurf-bridge MCP wiring
#      (`claude mcp add -s user ...`). Project-scoped .mcp.json is deliberately
#      not enough: a /tmp native session would wake without a receipt tool.
#   2. marketplace add <stable XDG .assembled>  (both dev clone and installed
#      package assemble into the same version-stable XDG data dir; NOT /tmp —
#      ephemeral source would break `claude plugin marketplace update`, and NOT
#      the checkout — repo housekeeping must never cut the live user-scope wiring).
#   3. install entwurf-meta-receive@meta-bridge-local --scope user  (= global:
#      every native session auto-loads it; no manual --plugin-dir).
#   4. install/update USER-scope entwurf-bridge MCP, so every native session has
#      entwurf_inbox_read without duplicating MCP inside the plugin.
# Idempotent: re-running removes the prior marketplace/plugin first, so a
# `nix rebuild` that moved node just re-bakes and re-installs cleanly.
#
# Platform: Linux only for the #51 repair cut. macOS cannot reach the strict
# live-owner certification tier, so accepting an install there would advertise a
# surface this release can never certify. Windows and every other platform fail fast.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MKT_NAME="meta-bridge-local"
PLUGIN="entwurf-meta-receive"
SRC="$REPO/pi/meta-bridge"
# The live marketplace artifact ALWAYS assembles under the version-stable XDG data
# dir — dev clone and installed package alike. Claude settings store this directory
# path and package-manager upgrades do not rewrite it (a pnpm-store path would go
# stale on version/peer churn). Critically it lives OUTSIDE the checkout, so repo
# housekeeping (git clean -xfd, check/smoke) can never cut the global user-scope
# wiring: dev vs installed is a difference of SOURCE ORIGIN (repo tree vs npm
# package we assemble FROM), never of where the live artifact lands.
ASM="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/meta-bridge/.assembled"
# The hook ARTIFACT form still splits by install shape (0.12.5): an installed
# package lives below node_modules, where Node REFUSES `--experimental-strip-types`
# on `.ts` (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so it runs the tsc-emitted
# `meta-bridge-hook.js` closure (mirrors start.sh/store-doctor). A dev clone lives
# outside node_modules — and so does the XDG artifact — so it runs the `.ts` source
# directly. HOOK_ENTRY is baked into hooks.json.
case "$REPO" in
  */node_modules/@junghanacs/entwurf)
    HOOK_ENTRY="meta-bridge-hook.js"
    HOOK_SRC="$REPO/mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-hook.js"
    LIB_SRC="$REPO/mcp/entwurf-bridge/dist/pi-extensions/lib/meta-session.js"
    LIB_EXT="js" ;;
  *)
    HOOK_ENTRY="meta-bridge-hook.ts"
    HOOK_SRC="$REPO/pi-extensions/meta-bridge-hook.ts"
    LIB_SRC="$REPO/pi-extensions/lib/meta-session.ts"
    LIB_EXT="ts" ;;
esac

die() { echo "meta-bridge-install: $*" >&2; exit 1; }

# --- platform gate (Linux-only repair contract) -----------------------------
case "$(uname -s)" in
  Linux) ;;
  Darwin) die "macOS is not yet verified/certified for this repair cut. Strict live-owner certification currently requires /proc, so Darwin install is refused rather than left NOT CERTIFIED; future validation may reopen this lane." ;;
  *) die "unsupported platform '$(uname -s)'. The Claude meta-bridge repair cut supports Linux only (no unverified fallback)." ;;
esac

# --- toolchain gate, part 1: this machine's own runtime ---------------------
# Split deliberately. Everything here is a fact about the local host that costs
# nothing to read; the Claude CLI contact comes AFTER the store gate below, so a
# host that must be refused over its own data is refused without entwurf having
# invoked an external CLI at all. That is what lets the upgrade cells fence the
# refusal at "zero claude invocations" rather than "no MUTATING claude call".
command -v python3 >/dev/null || die "'python3' not on PATH. The FileChanged doorbell parses hook JSON with python3; install refuses a silently-dead wake runtime."
NODE_BIN="$(command -v node)" || die "'node' not on PATH (the hook needs it to run the entry shell)."
# Node 24+ is the SINGLE supported axis (GLG, 2026-07-21) — see run.sh setup
# preflight for why the floor is 24 and not the 23.6 type-stripping feature gate.
NODE_VER="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VER%%.*}"
if [ "$NODE_MAJOR" -lt 24 ]; then
  die "node $NODE_VER too old; entwurf requires Node >= 24 (single supported runtime axis, no Node 22 lane)."
fi

# --- pre-cut store gate (#50 M1 / #51) --------------------------------------
# The meta-record store this host ALREADY carries decides whether an install may
# proceed at all. Every surface this install wires up (parse, birth, peers, self,
# v2, inbox, store-doctor) is V3-only, so on a host whose store still holds v1/v2
# records the install would validate clean, install clean, and then reject at
# runtime — the exact "installs healthy, never works" shape the Claude floor gate
# below exists to prevent. Refuse HERE instead.
#
# Placement is the contract: this runs BEFORE meta-bridge-state.py takes its
# pre-install snapshot, which is the first line that can touch user config. A
# refused install therefore leaves settings.json / ~/.claude.json / the plugin
# registry byte-untouched. The verdict chooses the next move: migrate cleanly
# readable pre-cut records, or repair malformed/unreadable records first.
#
# The verdict comes from the migrate command's OWN `verify` verb, not a bash
# re-read of the store: store resolution (env + default) and the aggregated
# non-V3 count live there, and a second implementation here would be a second
# truth that can drift. An absent store and a v3-only store both exit 0, so a
# clean host and an already-migrated host need no special case.
case "$REPO" in
  */node_modules/@junghanacs/entwurf)
    MIGRATE_ENTRY="$REPO/mcp/entwurf-bridge/dist/scripts/meta-bridge-migrate-v3.js"
    MIGRATE_CMD=("$NODE_BIN" "$MIGRATE_ENTRY") ;;
  *)
    MIGRATE_ENTRY="$REPO/scripts/meta-bridge-migrate-v3.ts"
    MIGRATE_CMD=("$NODE_BIN" --experimental-strip-types "$MIGRATE_ENTRY") ;;
esac
[ -f "$MIGRATE_ENTRY" ] || die "store-migration artifact missing: $MIGRATE_ENTRY (installed package ships it via prepack build-bridge → dist; reinstall @junghanacs/entwurf, or run 'pnpm run build-bridge' in a dev clone). Install refuses rather than skip the pre-cut store gate."
if STORE_VERDICT="$("${MIGRATE_CMD[@]}" verify 2>&1)"; then
  echo "[meta-bridge-install] meta-record store certifies V3-only ($(printf '%s\n' "$STORE_VERDICT" | grep -o 'non-V3=[0-9]*' | head -1)) — install may proceed"
else
  printf '%s\n' "$STORE_VERDICT" >&2
  # Prescription must match diagnosis (same rule as run.sh's preflight_v3_store).
  # The axes are independent: a store may contain BOTH pre-cut records and a
  # malformed/unreadable one. M1 converts the former only after every problem is
  # repaired; recommending migrate first would send the operator at a command
  # that is guaranteed to refuse.
  STORE_HAS_PROBLEMS=1
  STORE_HAS_PRECUT=1
  printf '%s\n' "$STORE_VERDICT" | grep -q ' / 0 problem(s)' && STORE_HAS_PROBLEMS=0
  printf '%s\n' "$STORE_VERDICT" | grep -q 'pre-cut v[0-9][0-9]* record' && STORE_HAS_PRECUT=0
  if [ "$STORE_HAS_PROBLEMS" -eq 0 ] && [ "$STORE_HAS_PRECUT" -eq 0 ]; then
    die "this host's meta-record store still holds pre-cut records (see the verify output above). Every surface this install wires up is V3-only, so installing over them would produce a plugin that installs clean and then rejects at runtime. NO user config was touched. Migrate the store with the command the verdict names, then re-run install-meta-bridge."
  fi
  if [ "$STORE_HAS_PROBLEMS" -ne 0 ] && [ "$STORE_HAS_PRECUT" -eq 0 ]; then
    die "this host's meta-record store has BOTH pre-cut records and problems migration cannot convert. NO user config was touched. Repair the reported problems FIRST — migration refuses to start while any remain. After repair, if the pre-cut records remain, run the migrate command named above, then re-run install-meta-bridge."
  fi
  die "this host's meta-record store did not certify as V3-only (see the verify output above), and this is NOT a migration case — the verdict reports records the store migration cannot convert (malformed, unreadable, or ambiguous). NO user config was touched. Resolve those records, then re-run install-meta-bridge."
fi

# --- toolchain gate, part 2: the external Claude CLI ------------------------
# FIRST contact with anything outside this machine's own runtime. Everything
# above — platform, python3, node, and the host's own meta-record store — is
# decided without invoking `claude` even once, so a refusal there is provably
# free of external side effects.
command -v claude >/dev/null || die "'claude' CLI not on PATH. Install Claude Code first."
# Claude Code floor (#51 policy A, 2026-07-22). This gate is the entwurf-side
# fail-loud, and it has to exist because UPSTREAM GIVES NONE: an older Claude passes
# `claude plugin validate` on the exec-form manifest (unknown-key passthrough) and
# then at runtime drops `args`, runs `command` alone, and reports the hook as
# `exit_code: 0, outcome: "success"` (measured on 2.1.138). Nothing about that install
# looks wrong from the outside. If we do not refuse the version here, the user gets a
# meta-bridge that installs clean, validates clean, and never wakes.
# shellcheck source=scripts/meta-bridge-claude-floor.sh
source "$REPO/scripts/meta-bridge-claude-floor.sh"
CLAUDE_FLOOR="$(claude_floor_version "$REPO")" || die "cannot read the Claude Code floor from package.json (entwurf.claudeCodeFloor)."
CLAUDE_VER="$(claude_detected_version)"
[ -n "$CLAUDE_VER" ] || die "could not read a version from 'claude --version'. entwurf requires Claude Code >= $CLAUDE_FLOOR and refuses to install against an unidentifiable runtime."
claude_floor_satisfied "$CLAUDE_VER" "$CLAUDE_FLOOR" || die "claude $CLAUDE_VER is below the supported floor >= $CLAUDE_FLOOR. The meta-bridge hooks use the shell-less exec form; an older Claude silently DROPS the hook's args and still reports success, so this install would look healthy and never wake. There is no shell-form fallback — update Claude Code and re-run."
echo "[meta-bridge-install] platform=$(uname -s) node=$NODE_VER ($NODE_BIN) claude=$CLAUDE_VER (floor >= $CLAUDE_FLOOR) python3=$(command -v python3)"

# Capture the user's pre-install values BEFORE any Claude CLI helper can mutate
# settings.json / ~/.claude.json. Re-runs preserve the first snapshot, so
# uninstall restores the true pre-entwurf state rather than the last install
# run's already-managed values.
python3 "$REPO/scripts/meta-bridge-state.py" prepare --repo "$REPO" --asm "$ASM"

# --- 1. assemble a self-contained, node-baked plugin ------------------------
rm -rf "$ASM"
mkdir -p "$ASM"
cp -r "$SRC/.claude-plugin" "$ASM/.claude-plugin"
cp -r "$SRC/$PLUGIN" "$ASM/$PLUGIN"
# entry shell + its lib travel WITH the plugin so the install copy is self-contained.
# Installed → tsc-emitted JS (dist, node_modules-safe); dev clone → strip-types .ts.
[ -f "$HOOK_SRC" ] || die "hook artifact missing: $HOOK_SRC (installed package ships it via prepack build-bridge → dist; reinstall @junghanacs/entwurf, or run 'pnpm run build-bridge' in a dev clone)."
[ -f "$LIB_SRC" ]  || die "hook lib artifact missing: $LIB_SRC (same build-bridge dist closure)."
cp "$HOOK_SRC" "$ASM/$PLUGIN/$HOOK_ENTRY"
mkdir -p "$ASM/$PLUGIN/lib"
cp "$LIB_SRC" "$ASM/$PLUGIN/lib/meta-session.$LIB_EXT"
cp "$REPO/pi-extensions/lib/session-id.js" "$ASM/$PLUGIN/lib/session-id.js"
# v2 writer (3D-3+) reads the capability registry at runtime
# (loadMetaCapabilityRegistry). It MUST travel at the plugin ROOT — meta-session's
# metaCapabilitiesFilePath() resolves it via `../` from lib/ in the bundle layout
# (the repo `../../pi` path escapes the plugin dir under the cache version dir).
# Without this, a v2 writer throws on every mint/parse. doctor-meta-bridge asserts it.
cp "$REPO/pi/entwurf-capabilities.json" "$ASM/$PLUGIN/entwurf-capabilities.json"
# Both shipped hook scripts must be executable: the exec form names them as the
# executable directly (no shell to fall back on), so a lost +x bit is a hard
# ENOEXEC at session open rather than a degraded path.
chmod +x "$ASM/$PLUGIN/scripts/doorbell.sh" "$ASM/$PLUGIN/scripts/hook-launch.sh"
# Bake the node abspath AND the hook entry filename into hooks.json — the two
# templated surfaces (0.12.5: HOOK_ENTRY is meta-bridge-hook.js when installed,
# .ts in a dev clone). They now live inside the exec form's `args` array, so the
# textual bake is unchanged while the launch contract is not: every hook is
# `command` = the shipped hook-launch.sh, `args` = the real argv. No shell is on the
# path, so the hook's parent is Claude on every host (#51 B2) — that is what retired
# the shell `$PPID` carrier and its ancestry walk. hook-launch.sh refuses an empty
# argv, which is the only visible symptom an older Claude gives when it drops `args`.
# mailbox / meta-record dirs resolve at runtime inside the hook itself
# (<pi-agent-dir>, fixed ~/).
# The plugin owns ONLY the wake/record hooks; the receiver-side entwurf_inbox_read
# tool is NOT the plugin's job. It comes from USER-scope entwurf-bridge MCP
# wiring (`claude mcp add -s user ...`), never a plugin .mcp.json duplicate.
HOOKS="$ASM/$PLUGIN/hooks/hooks.json"
HOOKS_PATH="$HOOKS" NODE_PATH_TO_BAKE="$NODE_BIN" HOOK_ENTRY_TO_BAKE="$HOOK_ENTRY" python3 - <<'PY'
from pathlib import Path
import os
hooks = Path(os.environ["HOOKS_PATH"])
node = os.environ["NODE_PATH_TO_BAKE"]
hook_entry = os.environ["HOOK_ENTRY_TO_BAKE"]
text = hooks.read_text(encoding="utf-8")
for placeholder in ("__NODE_BIN__", "__HOOK_ENTRY__"):
    if placeholder not in text:
        raise SystemExit(f"hooks bake failed before replacement ({placeholder} absent in {hooks})")
hooks.write_text(text.replace("__NODE_BIN__", node).replace("__HOOK_ENTRY__", hook_entry), encoding="utf-8")
PY
for placeholder in "__NODE_BIN__" "__HOOK_ENTRY__"; do
  grep -q "$placeholder" "$HOOKS" && die "hooks bake failed ($placeholder still present in $HOOKS)."
done
echo "[meta-bridge-install] assembled $ASM (node baked, entry+lib bundled; MCP wiring is NOT plugin-owned)"

# --- validate the manifests before touching user config ---------------------
claude plugin validate "$ASM" >/dev/null || die "marketplace manifest validation failed for $ASM"
echo "[meta-bridge-install] manifest validate: ok"

# --- 2 + 3. (re)register the marketplace and (re)install globally -----------
claude plugin uninstall "$PLUGIN@$MKT_NAME" >/dev/null 2>&1 || true
claude plugin marketplace remove "$MKT_NAME" >/dev/null 2>&1 || true
claude plugin marketplace add "$ASM" >/dev/null
claude plugin install "$PLUGIN@$MKT_NAME" --scope user >/dev/null
echo "[meta-bridge-install] installed $PLUGIN@$MKT_NAME (scope: user = global)"

# --- 4. ensure USER-scope receiver MCP wiring -------------------------------
# One canonical MCP entry only: user-scope entwurf-bridge via the repo-managed
# start.sh. This reaches /tmp and every other native Claude Code cwd. Do not put
# entwurf-bridge in the plugin (.mcp.json): that duplicates the server and drops
# the canonical external identity env.
claude mcp remove entwurf-bridge -s user >/dev/null 2>&1 || true
# 0.11 S2 cutover: drop any stale USER-scope pi-tools-bridge entry written by a
# prior version (one-shot rename cleanup, not a runtime alias).
claude mcp remove pi-tools-bridge -s user >/dev/null 2>&1 || true
# 0.12.2 installed-vs-clone dual-mode — MUST mirror meta-bridge-state.py::desired_mcp(),
# which the trailing `apply` re-asserts as the SSOT. An installed package ($REPO ends
# in node_modules/@junghanacs/entwurf) wires the STABLE `entwurf-bridge` bin shim; baking
# the pnpm store path here would go stale on any peer/version bump. A dev clone pins to
# this clone's start.sh. Both branches carry the same env desired_mcp() writes.
case "$REPO" in
  */node_modules/@junghanacs/entwurf)
    claude mcp add -s user entwurf-bridge \
      -e ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code \
      -- entwurf-bridge >/dev/null ;;
  *)
    claude mcp add -s user entwurf-bridge \
      -e ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code \
      -- bash "$REPO/mcp/entwurf-bridge/start.sh" >/dev/null ;;
esac
# Capture, THEN match — and require BOTH the exit code and the content.
# `<cli> | grep -q` under `set -o pipefail` is a race, not a test: grep exits at the
# first match and closes the pipe, the still-writing CLI dies of SIGPIPE (141), and
# pipefail reports that as a failed check — a FALSE "not reachable" die on a correctly
# wired host. But `$(... || true)` is the opposite error: it discards the CLI's exit
# code, so a FAILING `claude mcp get` that still printed a plausible line would PASS.
# The honest test needs both halves, so the assignment IS the if-condition (which also
# keeps `set -e` from killing the script on a nonzero probe).
if MCP_REACH_OUT="$(cd /tmp && claude mcp get entwurf-bridge 2>/dev/null)"; then
  case "$MCP_REACH_OUT" in
    *"Scope: User config"*) ;;
    *) die "post-install: entwurf-bridge is not reachable as USER-scope MCP from /tmp" ;;
  esac
else
  MCP_REACH_RC=$?
  die "post-install: 'claude mcp get entwurf-bridge' failed (exit $MCP_REACH_RC) — the USER-scope MCP wiring could not be verified, so this install is not confirmed."
fi
echo "[meta-bridge-install] installed entwurf-bridge MCP (scope: user = global receiver tools)"

# Re-assert the repo-owned keyset through our stateful manager. The Claude CLI
# calls above are allowed to maintain their cache/registry files, but the
# operator-facing JSON keys are owned here so uninstall can be honest.
python3 "$REPO/scripts/meta-bridge-state.py" apply --repo "$REPO" --asm "$ASM"

# --- evidence ---------------------------------------------------------------
echo "--- claude plugin list ---"
claude plugin list 2>/dev/null | grep -A3 "$PLUGIN" || die "post-install: plugin not in list (install did not take)."
echo
echo "[meta-bridge-install] DONE. Open a Claude Code session, then verify with:"
echo "    ./run.sh doctor-meta-bridge"
