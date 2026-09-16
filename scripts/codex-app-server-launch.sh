#!/usr/bin/env bash
# codex-app-server-launch.sh — the managed Codex app-server launch,
# `entwurf codex-app-server` (#95, the operator-UX half).
#
# WHY THIS EXISTS. Every Codex rail in this repo — native-push delivery, visible fresh,
# the loaded-thread probe — needs one thing the operator has to start themselves:
#
#   codex app-server --listen "unix://$CODEX_HOME/app-server-control/app-server-control.sock"
#
# That string is correct and nobody types it. It appeared in three documents and in the
# text of a refusal, which means the first time most operators meet it is AFTER something
# has already failed. This leaf owns the SPELLING of that command and nothing else.
#
# WHAT IT IS NOT — and this is the whole boundary. It is not a supervisor, a daemon, a
# restarter, a health loop or a pid file. It does not fork. It `exec`s in the caller's own
# terminal, so the server's cwd, tty, pid and exit status are the vendor's, and Ctrl-C is
# the operator's. Entwurf still does not own the app-server's lifecycle (AGENTS Hard Rule
# 16, NEXT CARRIED step 2): a missing app-server still REJECTS at fresh-call preflight
# rather than being started behind anyone's back. What changed is only that the refusal can
# now name a command a person can actually type.
#
# THE SOCKET PATH IS NOT SPELLED TWICE. `resolveCodexDefaultSocketPath`
# (pi-extensions/lib/native-push/codex-ws-client.ts) is where the product computes this
# path, and it is the leaf every OTHER Codex surface reads. A bash leaf cannot import it,
# so the gate binds them instead: `check-codex-app-server-launch` runs both over the same
# environment matrix and requires byte equality. A divergence is a gate failure, not a
# surprise at delivery time.
#
# THE TMUX LINE IS A FACT, NOT A REFUSAL. The MCP bridge is a CHILD of this server and
# inherits its `TMUX`, so the tmux server this process sits in is the one caller-seat
# lookups will read (docs/mux-launch-rail.md §Codex). Running outside tmux is a legitimate
# operator choice with a consequence, so it is reported as a consequence. Refusing it here
# would make this leaf an authority over the operator's terminal, which it is not.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"

# The vendor command this leaf manages. A CONSTANT, deliberately not overridable: an env
# seam here would be a production switch for "which binary is the Codex CLI", and anything
# that can redirect an exec is an authority, not a test convenience. The gate proves the
# real contract instead — it puts its fake vendor on a sandbox PATH under this exact name.
VENDOR_CMD="codex"
SOCKET_LEAF="app-server-control/app-server-control.sock"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
note() { printf '[entwurf] %s\n' "$*" >&2; }

# --- recursion fence -------------------------------------------------------
# A `codex` earlier on PATH that itself calls `entwurf codex-app-server` would spin
# forever, and the symptom would be a hung terminal rather than an error. The sentinel is
# invocation-local, so seeing it already set means we are inside our own exec chain.
if [ -n "${ENTWURF_CODEX_APP_SERVER_ACTIVE:-}" ]; then
	fail "recursive managed launch detected (ENTWURF_CODEX_APP_SERVER_ACTIVE is already set).
  Something on PATH named '$VENDOR_CMD' resolves back to this launcher. Fix PATH so
  '$VENDOR_CMD' is the OpenAI Codex CLI, or run the vendor binary by its full path."
fi

# --- the socket path, resolved exactly as the product resolves it ----------
# Mirrors resolveCodexHome: an explicit CODEX_HOME wins, whitespace is trimmed, and a value
# that is empty AFTER trimming is not a value. Neither carrier present is a hard error
# rather than a guess, because every other Codex surface would compute a different path
# than whatever this one invented.
trim() {
	local v="$1"
	v="${v#"${v%%[![:space:]]*}"}"
	v="${v%"${v##*[![:space:]]}"}"
	printf '%s' "$v"
}
codex_home="$(trim "${CODEX_HOME:-}")"
if [ -z "$codex_home" ]; then
	home_dir="$(trim "${HOME:-}")"
	[ -n "$home_dir" ] \
		|| fail "codex app-server: neither CODEX_HOME nor HOME is available, so the default
  control-socket path cannot be resolved. Set CODEX_HOME to your Codex home."
	codex_home="$home_dir/.codex"
fi
SOCK="$codex_home/$SOCKET_LEAF"

# --- operator argv: forwarded, never reinterpreted -------------------------
# Everything the operator passes is appended after the injected pair and crosses
# byte-identical. The single exception is a second `--listen`: injecting ours beside theirs
# would hand the vendor two listen addresses and let one of them win silently, and a silent
# winner is exactly the false success this repo refuses. `--opt=value` and `--opt value` are
# the same option, so the head is what is compared.
for tok in "$@"; do
	if [ "${tok%%=*}" = "--listen" ]; then
		fail "codex-app-server-listen-override: this verb exists to spell ONE --listen address
  (unix://$SOCK), and you passed your own. Run the vendor directly if you mean a
  different address: $VENDOR_CMD app-server --listen <your-address>"
	fi
done

# --- resolve the vendor executable -----------------------------------------
# `type -P` returns the PATH hit only — never a shell function, alias or builtin — so what
# is exec'd is a real external file. `exec command codex` is deliberately NOT used: it would
# re-enter shell lookup at exec time and could pick up something other than the file
# validated here.
codex_bin="$(type -P "$VENDOR_CMD" 2>/dev/null || true)"
[ -n "$codex_bin" ] \
	|| fail "no '$VENDOR_CMD' executable found on PATH.
  The managed launch runs the OpenAI Codex CLI; install it, or put it on PATH."
[ -f "$codex_bin" ] && [ -x "$codex_bin" ] \
	|| fail "'$codex_bin' is not an executable regular file — refusing to exec it."

# Self-exec fence, the second half of the recursion guard: resolve symlinks and refuse
# anything that is one of our own entrypoints even if the sentinel was stripped. POSIX walk,
# same shape as scripts/copilot-launch.sh — BSD readlink has no -f.
resolve_path() {
	local SOURCE="$1" DIR TARGET
	while [ -L "$SOURCE" ]; do
		DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
		TARGET="$(readlink "$SOURCE")"
		case "$TARGET" in
			/*) SOURCE="$TARGET" ;;
			*) SOURCE="$DIR/$TARGET" ;;
		esac
	done
	DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
	printf '%s/%s\n' "$DIR" "$(basename "$SOURCE")"
}
resolved_bin="$(resolve_path "$codex_bin")"
for own in "$HERE/codex-app-server-launch.sh" "$REPO_DIR/run.sh"; do
	own_resolved="$(resolve_path "$own")"
	[ "$resolved_bin" = "$own_resolved" ] \
		&& fail "'$VENDOR_CMD' on PATH resolves to entwurf's own '$own_resolved' — that is a launch loop, not the vendor CLI."
done

# --- is somebody already listening there? ----------------------------------
# Three outcomes, and they are NOT the same repair. A live socket means a second server
# would either lose the bind race or silently replace the endpoint every citizen's record
# already points at — refuse and name the holder. An indeterminate path (symlink, not a
# socket, owned by another uid) is the classification `checkCodexSocketFile` already uses in
# the product, and a launcher that guessed past it would be clobbering something it cannot
# identify. A dead socket file is the ordinary leftover of a Ctrl-C, and the vendor replaces
# it — that one is a fact line, not a refusal.
probe="$(python3 - "$SOCK" <<'PY'
import os, socket, stat, sys

path = sys.argv[1]
try:
	st = os.lstat(path)
except FileNotFoundError:
	print("absent")
	raise SystemExit(0)
except OSError as exc:
	print(f"indeterminate\t{exc.strerror or exc}")
	raise SystemExit(0)

if stat.S_ISLNK(st.st_mode):
	print("indeterminate\tthe path is a symlink")
	raise SystemExit(0)
if not stat.S_ISSOCK(st.st_mode):
	print("indeterminate\tthe path exists and is not a socket")
	raise SystemExit(0)
if st.st_uid != os.getuid():
	print(f"indeterminate\tthe socket is owned by uid {st.st_uid}, not {os.getuid()}")
	raise SystemExit(0)

probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
probe.settimeout(2)
try:
	probe.connect(path)
except (ConnectionRefusedError, FileNotFoundError):
	print("stale")
except OSError as exc:
	print(f"indeterminate\t{exc.strerror or exc}")
else:
	print("live")
finally:
	probe.close()
PY
)" || fail "could not classify the control socket at $SOCK (python3 is required by this launcher)."

probe_status="${probe%%	*}"
probe_reason="${probe#*	}"
case "$probe_status" in
	live)
		# Show what the host actually says, and say so when it says nothing. The owner is read
		# out of /proc rather than inferred from the socket: a socket file names no pid, so the
		# only honest answer when no cmdline matches is that no match was found.
		owner=""
		if [ -d /proc ]; then
			for cl in /proc/[0-9]*/cmdline; do
				[ -r "$cl" ] || continue
				if tr '\0' ' ' < "$cl" 2>/dev/null | grep -qF "$SOCK"; then
					owner="${owner}    pid $(basename "$(dirname "$cl")"): $(tr '\0' ' ' < "$cl")
"
				fi
			done
		fi
		[ -n "$owner" ] || owner="    (no process on this host spells that socket in its cmdline — read, not inferred)
"
		fail "codex-app-server-already-listening: a live app-server is answering on
  unix://$SOCK
  Entwurf never replaces one. What /proc reports about it:
$owner  Use that server, or stop it first."
		;;
	indeterminate)
		fail "codex-app-server-socket-indeterminate: $probe_reason
  Path: $SOCK
  This is the same classification the delivery rail's socket check uses, and a launcher that
  guessed past it would be clobbering something it cannot identify. Inspect that path."
		;;
	stale)
		note "a dead control socket is already at $SOCK (nothing is listening); the vendor replaces it."
		;;
esac

# --- the control directory the address lives in ----------------------------
# The same `mkdir -p` the three documents told the operator to run by hand. It is inside
# their own CODEX_HOME, and without it a first launch fails on a directory rather than on
# anything meaningful.
mkdir -p "$(dirname "$SOCK")" \
	|| fail "could not create $(dirname "$SOCK") — the control socket has nowhere to live."

# --- the tmux fact, stated once --------------------------------------------
note "this app-server's tmux seat: ${TMUX:-(none — not inside tmux)}"
note "the bridge is this server's MCP child and inherits that TMUX, so caller-seat lookups read THAT tmux server's panes."
note "entwurf neither supervises nor restarts this process — Ctrl-C is yours."

export ENTWURF_CODEX_APP_SERVER_ACTIVE=1

# --- foreign identity carriers, removed before exec ------------------------
# The MCP bridge trusts a COMPLETE `PI_SESSION_ID` + `PI_AGENT_ID` pair ahead of a native
# sender marker when it resolves who is speaking. Inside the pi process that planted them
# from record birth that is correct. Here they would be somebody else's identity inherited by
# the app-server and by EVERY bridge child it spawns — start the server from a pi citizen's
# bash and each Codex thread's MCP child could speak under the parent pi garden id.
#
# Both go, together: clearing one only changes the wording of a later failure while leaving a
# carrier for a partial reader. Nothing is substituted — a Codex thread's identity comes from
# its own trusted birth hook, which is where the record authority already lives.
unset PI_SESSION_ID PI_AGENT_ID

exec "$codex_bin" app-server --listen "unix://$SOCK" "$@"
