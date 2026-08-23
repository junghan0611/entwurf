#!/usr/bin/env bash
# copilot-launch.sh — the managed Copilot launch, `entwurf copilot` (#82 RAIL 7).
#
# WHY THIS EXISTS. The receiver installer owns the extension artifact but it cannot
# arm anything by itself: Copilot scans for extensions only when the CLI is started
# with `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS`, and that lives in the
# environment of the operator's own launch. Without it the scan is skipped SILENTLY —
# no error, no log line, no receiver — so a perfectly installed unit stays inert and
# the citizen never becomes deliverable. entwurf does not own the operator's shell,
# and it will not write their rc files. What it can own is ONE invocation: this leaf
# sets the flag for the process it is about to become, and nothing outside it.
#
# WHAT IT IS NOT. It is not a launcher rail. It does not place a tmux window, it is
# not fresh-call, and it mints NO citizen: birth authority stays exactly where it was,
# on the Copilot session's FIRST PROMPT (Hard Rule 2 — the record is the sole garden
# address authority, and nothing here writes a record). It `exec`s in the caller's own
# terminal, so cwd, tty, pid and exit status are the vendor's, unchanged.
#
# CONSENT. Calling `entwurf copilot` IS the consent to the managed profile: EXTENSIONS
# on, `--model auto` when no model was given, and `--yolo` when no explicit permission
# or surface policy was given. An operator who wants the plain vendor behaviour keeps
# running `copilot` directly — that path is untouched and is not deprecated.
#
# FAIL-CLOSED SCAN. The argv scan is element-wise and deliberately naive: it does not
# model which options consume the next word. Both of its possible mistakes are safe.
# Reading an option's VALUE as a policy token suppresses an injected default; reading
# it as a model suppresses `--model auto`. Every error direction is "inject less",
# never "widen the operator's permissions behind their back".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"

UNIT="entwurf-receive"
EXT_ROOT="${COPILOT_EXTENSIONS_DIR:-$HOME/.copilot/extensions}"
DEST="$EXT_ROOT/$UNIT"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/copilot-receive"
STATE_FILE="$STATE_DIR/install-state.json"
FLAG_ENV="COPILOT_CLI_ENABLED_FEATURE_FLAGS"
FLAG_VALUE="EXTENSIONS"
REPAIR="entwurf install-copilot-receive"

# The vendor command this leaf manages. A CONSTANT, and deliberately not overridable:
# an env seam here would be a production switch for "which binary is the Copilot CLI",
# and anything that can redirect an exec is an authority, not a test convenience. The
# gate proves the real contract instead — it puts its fake vendor on a sandbox PATH under
# this exact name and drives the public address.
VENDOR_CMD="copilot"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# --- recursion fence -------------------------------------------------------
# A `copilot` earlier on PATH that itself calls `entwurf copilot` would spin forever,
# and the symptom would be a hung terminal rather than an error. One sentinel closes
# it: the flag is invocation-local, so seeing it already set means we are inside our
# own exec chain.
if [ -n "${ENTWURF_COPILOT_LAUNCH_ACTIVE:-}" ]; then
	fail "recursive managed launch detected (ENTWURF_COPILOT_LAUNCH_ACTIVE is already set).
  Something on PATH named '$VENDOR_CMD' resolves back to this launcher. Fix PATH so
  '$VENDOR_CMD' is the GitHub Copilot CLI, or run the vendor binary by its full path."
fi

# --- precondition: the receiver this launch promises to arm -----------------
# The flag is a PROMISE of a doorbell. Setting it while no receiver unit is installed
# would produce a session that looks managed and can never be delivered to, which is
# the exact false-success this repo refuses. Every failure below names the one command
# that repairs it.
[ -f "$STATE_FILE" ] \
	|| fail "no receiver install-state at $STATE_FILE.
  '$VENDOR_CMD' launched with $FLAG_ENV=$FLAG_VALUE would scan for an extension that is
  not there, and the session would never become deliverable. Run: $REPAIR"

claimed_path=""
claimed_unit=""
if ! claimed_path="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("path",""))' "$STATE_FILE" 2>/dev/null)"; then
	fail "receiver install-state at $STATE_FILE is not readable JSON — refusing to launch on a
  state file we cannot verify. Run: $REPAIR"
fi
claimed_unit="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("unit",""))' "$STATE_FILE" 2>/dev/null || true)"

[ -n "$claimed_path" ] \
	|| fail "receiver install-state at $STATE_FILE names no path. Run: $REPAIR"
[ "$claimed_unit" = "$UNIT" ] \
	|| fail "receiver install-state at $STATE_FILE claims unit '${claimed_unit:-<empty>}', expected '$UNIT'. Run: $REPAIR"
# Path mismatch is its own failure, not a missing file: it means the state file and the
# directory this launch would arm from disagree, and the extensions root the CLI will
# actually scan is $EXT_ROOT.
[ "$claimed_path" = "$DEST" ] \
	|| fail "receiver install-state points at '$claimed_path' but this environment scans '$DEST'.
  The CLI would read a different extensions root than the one that was installed
  (COPILOT_EXTENSIONS_DIR / HOME differ from install time). Run: $REPAIR"
[ -d "$claimed_path" ] \
	|| fail "receiver unit directory '$claimed_path' is missing. Run: $REPAIR"
[ -f "$claimed_path/extension.mjs" ] \
	|| fail "receiver unit at '$claimed_path' holds no extension.mjs — it is not our unit any more. Run: $REPAIR"

# --- resolve the vendor executable -----------------------------------------
# `type -P` returns the PATH hit only — never a shell function, alias or builtin — so
# what is exec'd is a real external file. `exec command copilot` is deliberately NOT
# used: it would re-enter shell lookup at exec time and could pick up something other
# than the file that was validated here.
copilot_bin="$(type -P "$VENDOR_CMD" 2>/dev/null || true)"
[ -n "$copilot_bin" ] \
	|| fail "no '$VENDOR_CMD' executable found on PATH.
  The managed launch runs the GitHub Copilot CLI; install it, or put it on PATH."
[ -f "$copilot_bin" ] && [ -x "$copilot_bin" ] \
	|| fail "'$copilot_bin' is not an executable regular file — refusing to exec it."

# Self-exec fence, the second half of the recursion guard: resolve symlinks and refuse
# anything that is one of our own entrypoints even if the sentinel was stripped.
resolved_bin="$(readlink -f "$copilot_bin" 2>/dev/null || printf '%s' "$copilot_bin")"
for own in "$HERE/copilot-launch.sh" "$REPO_DIR/run.sh"; do
	own_resolved="$(readlink -f "$own" 2>/dev/null || printf '%s' "$own")"
	[ "$resolved_bin" = "$own_resolved" ] \
		&& fail "'$VENDOR_CMD' on PATH resolves to entwurf's own '$own_resolved' — that is a launch loop, not the vendor CLI."
done

# --- argv scan: everything BEFORE the first literal `--` --------------------
# The terminator and everything after it belong to the user/vendor as data. We neither
# read policy out of it nor inject into it: injected defaults go immediately BEFORE the
# terminator so they remain options, and every original element crosses byte-identical.
args=("$@")
term_index=-1
for i in "${!args[@]}"; do
	if [ "${args[$i]}" = "--" ]; then
		term_index="$i"
		break
	fi
done
scan_end=$(( term_index >= 0 ? term_index : ${#args[@]} ))

# The explicit permission / surface policy overrides, measured against GitHub Copilot
# CLI 1.0.80 `--help`. Two groups, one rule: if the operator named ANY of them before
# the terminator, they have stated their own policy and we add none.
#   authorization: --yolo, --allow-all{,-tools,-paths,-urls}, --allow-tool, --deny-tool,
#                  --allow-url, --deny-url
#   tool surface : --available-tools, --excluded-tools
# Narrowing flags count too: appending `--yolo` (= all tools + paths + URLs) beside an
# operator's `--allow-url=https://one.example` would silently widen exactly what they
# were narrowing.
# NOT overrides, deliberately: `--allow-all-mcp-server-instructions` is prompt content,
# not authorization, and `--autopilot` is a mode. Matching is EXACT on the token head,
# so neither is caught by the `--allow-all` entry that is a prefix of one of them.
POLICY_OVERRIDES=(
	--yolo
	--allow-all
	--allow-all-tools
	--allow-all-paths
	--allow-all-urls
	--allow-tool
	--deny-tool
	--allow-url
	--deny-url
	--available-tools
	--excluded-tools
)

has_model=0
has_policy=0
for (( i = 0; i < scan_end; i++ )); do
	tok="${args[$i]}"
	# `--opt=value` and `--opt value` are the same option; compare the head only.
	head="${tok%%=*}"
	if [ "$head" = "--model" ]; then
		has_model=1
	fi
	for ov in "${POLICY_OVERRIDES[@]}"; do
		if [ "$head" = "$ov" ]; then
			has_policy=1
			break
		fi
	done
done

injected=()
[ "$has_model" -eq 0 ] && injected+=(--model auto)
[ "$has_policy" -eq 0 ] && injected+=(--yolo)

# Rebuild argv with the defaults before the terminator. Original elements are copied by
# index, so empty strings, embedded spaces and post-terminator data all survive intact.
final_args=()
for (( i = 0; i < scan_end; i++ )); do final_args+=("${args[$i]}"); done
if [ "${#injected[@]}" -gt 0 ]; then final_args+=("${injected[@]}"); fi
for (( i = scan_end; i < ${#args[@]}; i++ )); do final_args+=("${args[$i]}"); done

# --- the feature flag, invocation-local ------------------------------------
# Preserve the operator's existing tokens and their order, drop empties, drop
# duplicates, and guarantee EXTENSIONS is present exactly once. Nothing is written to
# any config or rc file: this export reaches only the image this process becomes.
flags_out=""
seen_extensions=0
if [ -n "${!FLAG_ENV:-}" ]; then
	IFS=',' read -r -a existing <<< "${!FLAG_ENV}"
	for tok in "${existing[@]}"; do
		# Vendor tokens are comma-separated names; surrounding whitespace is noise, and an
		# empty field (",," or a trailing comma) is not a token.
		tok="${tok#"${tok%%[![:space:]]*}"}"
		tok="${tok%"${tok##*[![:space:]]}"}"
		[ -n "$tok" ] || continue
		case ",$flags_out," in *",$tok,"*) continue ;; esac
		[ "$tok" = "$FLAG_VALUE" ] && seen_extensions=1
		flags_out="${flags_out:+$flags_out,}$tok"
	done
fi
[ "$seen_extensions" -eq 1 ] || flags_out="${flags_out:+$flags_out,}$FLAG_VALUE"

export "$FLAG_ENV=$flags_out"
export ENTWURF_COPILOT_LAUNCH_ACTIVE=1

exec "$copilot_bin" "${final_args[@]}"
