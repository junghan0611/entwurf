#!/usr/bin/env bash
# copilot-receive-bridge.sh — install / uninstall / doctor for the Copilot RECEIVER
# extension (#82 RAIL 5). The fourth Copilot surface, and deliberately its own:
# birth (plugin hook), statusline, MCP hand and receive are four independent atoms
# with four independent failure modes, and one installer that owned all of them
# would make a broken statusline able to withhold a doorbell.
#
# WHY A DIFFERENT DISCOVERY SURFACE FROM THE BIRTH PLUGIN. Birth is a Copilot PLUGIN
# (a marketplace unit with hooks.json). This is a Copilot EXTENSION: a forked child
# process that speaks JSON-RPC over stdio. The vendor discovers extensions by scanning
# `.github/extensions/` (project, interactive only) and the user extensions directory —
# `~/.copilot/extensions/<name>/extension.mjs` — so USER scope is the one an installer
# can own for every cwd and hand back cleanly. A per-repository `.github/extensions/`
# would arm in one checkout and silently not arm anywhere else.
#
# WHAT IT OWNS, AND WHAT IT CANNOT. It owns the artifact (its own directory, recorded
# in an install-state file, removed only from that record) and it CHECKS the launch
# flag. It cannot set that flag from here: `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS`
# is read from the environment of the `copilot` launch itself, and an installer is not a
# launch. The managed launch `run.sh copilot` sets it for one invocation; a session started
# any other way without it never scans for extensions and never says so — which is exactly
# why the doctor reads the live CLI processes instead of trusting a green artifact.
#
# COMPILED JS ONLY. The extension is executed by the CLI's own Node, whose version and
# type-stripping support are not ours to assume, so the install copies the tsc-emitted
# closure. A dev clone that has not built the bridge is refused with the build command.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"
UNIT="entwurf-receive"
SRC="$REPO_DIR/pi/copilot-receive/$UNIT"
EXT_ROOT="${COPILOT_EXTENSIONS_DIR:-$HOME/.copilot/extensions}"
DEST="$EXT_ROOT/$UNIT"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/copilot-receive"
STATE_FILE="$STATE_DIR/install-state.json"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
RECEIVE_LOG="$AGENT_DIR/meta-bridge-receive-copilot.log"
RECEIVERS_DIR="$AGENT_DIR/meta-receivers"
FLAG_ENV="COPILOT_CLI_ENABLED_FEATURE_FLAGS"
FLAG_VALUE="EXTENSIONS"

log() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# The compiled closure the unit carries. Same layout split as the birth installer: an
# installed package ships dist beside the sources; a dev clone builds it with
# `pnpm run build-bridge`. Both resolve to the SAME dist path, so this is one branch
# fewer than birth needs (birth can fall back to `.ts` under the operator's own node;
# here the runtime is the vendor's).
#
# `ENTWURF_COPILOT_RECEIVE_LIB_DIR` exists for ONE caller, for one structural reason:
# dist is gitignored, and the gate-qualification snapshot replicates only the git
# surface — so inside that snapshot there IS no dist, and a gate that needed one would
# be red for every mutant regardless of the mutation. check-copilot-receive-arm emits
# the two-file closure into a temp dir and points this at it. It never changes WHAT the
# installer does, only where it reads the compiled writer from.
LIB_DIR="${ENTWURF_COPILOT_RECEIVE_LIB_DIR:-$REPO_DIR/mcp/entwurf-bridge/dist/pi-extensions/lib}"

do_install() {
	log "[copilot-receive install]"
	log "  source:  $SRC"
	log "  target:  $DEST"
	log "  state:   $STATE_FILE"
	[ -f "$SRC/extension.mjs" ] || fail "receiver source missing: $SRC/extension.mjs"
	[ -f "$LIB_DIR/meta-session.js" ] || fail "compiled lib missing: $LIB_DIR/meta-session.js — run 'pnpm run build-bridge' in a dev clone, or reinstall the package."
	[ -f "$LIB_DIR/session-id.js" ] || fail "compiled lib missing: $LIB_DIR/session-id.js (same build-bridge dist closure)."
	[ -f "$REPO_DIR/pi/entwurf-capabilities.json" ] || fail "capability registry missing: $REPO_DIR/pi/entwurf-capabilities.json"

	# OWNERSHIP BEFORE WRITING. A directory we did not install is somebody else's
	# extension that happens to share our name; overwriting it would delete their unit
	# and then hand them ours. Only an install-state that names THIS path licenses a
	# replacement (the same rule the MCP adapter holds for a config key).
	if [ -L "$DEST" ]; then
		fail "$DEST is a SYMLINK. Refusing to write through it — remove it by hand if it is yours."
	fi
	if [ -e "$DEST" ] && [ ! -f "$STATE_FILE" ]; then
		fail "$DEST already exists and no entwurf install-state claims it. Refusing to overwrite an extension this installer did not put there."
	fi
	if [ -e "$DEST" ] && [ -f "$STATE_FILE" ]; then
		local claimed
		claimed="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("path",""))' "$STATE_FILE" 2>/dev/null || true)"
		[ "$claimed" = "$DEST" ] || fail "install-state claims '$claimed' but the target is '$DEST' — refusing to overwrite an unclaimed path."
	fi

	# ATOMIC: stage beside the target and swap, so a failure never leaves a half-copied
	# extension that the CLI would fork on the operator's next launch.
	local stage="$DEST.staging.$$"
	rm -rf "$stage"
	trap 'rm -rf "$stage"' EXIT
	mkdir -p "$stage/lib"
	cp "$SRC/extension.mjs" "$stage/extension.mjs"
	cp "$LIB_DIR/meta-session.js" "$stage/lib/meta-session.js"
	cp "$LIB_DIR/session-id.js" "$stage/lib/session-id.js"
	# The registry must sit at the unit ROOT: metaCapabilitiesFilePath() resolves it via
	# `../` from lib/ in the bundle layout. Without it every record read throws.
	cp "$REPO_DIR/pi/entwurf-capabilities.json" "$stage/entwurf-capabilities.json"

	mkdir -p "$EXT_ROOT"
	local prev=""
	if [ -e "$DEST" ]; then
		prev="$DEST.previous.$$"
		mv "$DEST" "$prev" || fail "could not move the previous receiver aside ($DEST)."
	fi
	if ! mv "$stage" "$DEST"; then
		[ -n "$prev" ] && mv "$prev" "$DEST"
		fail "could not publish the staged receiver into $DEST (previous unit restored)."
	fi
	trap - EXIT
	[ -n "$prev" ] && rm -rf "$prev"

	mkdir -p "$STATE_DIR"
	# The LIB digest is recorded beside the entry's, and it is not bookkeeping: the unit
	# carries a COPY of the compiled writer, so an entwurf upgrade that is not followed by
	# a reinstall leaves a receiver running last release's writer. Measured while building
	# this lane — a unit holding a pre-`extension-join` lib threw on every arm and the only
	# symptom was a session that never became deliverable. The doctor compares both.
	DEST_PATH="$DEST" UNIT_NAME="$UNIT" STATE_PATH="$STATE_FILE" python3 - <<'PY'
import hashlib, json, os, pathlib
dest = os.environ["DEST_PATH"]
def sha(rel):
	return hashlib.sha256(pathlib.Path(dest, rel).read_bytes()).hexdigest()
state = {
	"schemaVersion": 1,
	"unit": os.environ["UNIT_NAME"],
	"path": dest,
	"entrySha256": sha("extension.mjs"),
	"libSha256": sha("lib/meta-session.js"),
	"installedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
}
pathlib.Path(os.environ["STATE_PATH"]).write_text(json.dumps(state, indent=2) + "\n")
PY
	log "  ok: installed the receiver unit at $DEST"
	log ""
	log "  LAUNCH FLAG — this install does NOT arm anything by itself. Copilot scans for"
	log "  extensions only when the CLI is launched with:"
	log ""
	log "      $FLAG_ENV=$FLAG_VALUE copilot"
	log ""
	log "  Without it the scan is skipped SILENTLY (no error, no log line, no receiver)."
	log "  A session already open when this ran is not armed either; it arms on its next"
	log "  launch, and only once it has been born (first prompt)."
	log "  Verify with: ./run.sh doctor-copilot-receive"
}

do_uninstall() {
	log "[copilot-receive uninstall]"
	if [ ! -f "$STATE_FILE" ]; then
		log "  note: no install-state at $STATE_FILE — nothing this installer owns to remove."
		return 0
	fi
	local claimed
	claimed="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("path",""))' "$STATE_FILE" 2>/dev/null || true)"
	[ -n "$claimed" ] || fail "install-state at $STATE_FILE names no path — refusing to guess what to remove."
	if [ -L "$claimed" ]; then
		fail "$claimed is a SYMLINK; the install never creates one. Refusing to follow it."
	fi
	if [ -d "$claimed" ]; then
		# Remove what we installed, identified by our own entry file — never a bare
		# recursive delete of a path a state file happens to name.
		[ -f "$claimed/extension.mjs" ] || fail "$claimed does not hold extension.mjs — refusing to remove a directory that is no longer our unit."
		rm -rf "$claimed"
		log "  ok: removed $claimed"
	else
		log "  note: $claimed is already gone"
	fi
	rm -f "$STATE_FILE"
	log "  ok: install-state cleared. Sessions launched from here on will not arm a receiver."
	log "  Already-running sessions keep their armed marker until the extension exits."
}

do_doctor() {
	local fail_flag=0
	digest() { python3 -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1" 2>/dev/null || true; }
	ok() { echo "  ok    $*"; }
	bad() { echo "  FAIL  $*"; fail_flag=1; }
	note() { echo "  note  $*"; }

	echo "[copilot-receive-doctor] artifact"
	if [ -f "$STATE_FILE" ]; then
		ok "install-state present at $STATE_FILE"
	else
		# Same rule as the Copilot MCP doctor: with nothing installed there is nothing to
		# certify, and a red here would train the operator to ignore the doctor.
		note "no install-state at $STATE_FILE — the receiver is not installed on this host."
		note "Install it with: ./run.sh install-copilot-receive"
		echo
		echo "[copilot-receive-doctor] PASS (nothing installed)"
		return 0
	fi
	local claimed
	claimed="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("path",""))' "$STATE_FILE" 2>/dev/null || true)"
	[ -n "$claimed" ] && ok "install-state names $claimed" || bad "install-state names no path"
	if [ -d "$claimed" ]; then
		ok "unit directory present"
		[ -f "$claimed/extension.mjs" ] && ok "extension.mjs present (the vendor's required entry name)" \
			|| bad "extension.mjs missing — Copilot discovers a unit by that exact file name"
		[ -f "$claimed/lib/meta-session.js" ] && ok "compiled meta-session lib travels with the unit" \
			|| bad "lib/meta-session.js missing — the extension cannot resolve a garden id without it"
		[ -f "$claimed/entwurf-capabilities.json" ] && ok "capability registry travels at the unit root" \
			|| bad "entwurf-capabilities.json missing at the unit root — every record read would throw"
		if [ -f "$claimed/extension.mjs" ]; then
			local want have
			want="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("entrySha256",""))' "$STATE_FILE" 2>/dev/null || true)"
			have="$(digest "$claimed/extension.mjs")"
			if [ -n "$want" ] && [ "$want" = "$have" ]; then
				ok "installed entry matches the install-state digest"
			else
				bad "installed entry does NOT match the install-state digest — it was edited or half-replaced; reinstall"
			fi
		fi
		# STALE DEPLOYMENT — the failure this section exists for. The unit carries a COPY of
		# the compiled writer, so upgrading entwurf without reinstalling the receiver leaves
		# a session running the previous release's writer. It fails at ARM time, inside the
		# extension, where the only symptom is a citizen that never becomes deliverable.
		if [ -f "$claimed/lib/meta-session.js" ] && [ -f "$LIB_DIR/meta-session.js" ]; then
			local dep cur
			dep="$(digest "$claimed/lib/meta-session.js")"
			cur="$(digest "$LIB_DIR/meta-session.js")"
			if [ "$dep" = "$cur" ]; then
				ok "the deployed writer matches this checkout's compiled writer (${dep:0:12})"
			else
				bad "the deployed writer is STALE: unit has ${dep:0:12}, this checkout builds ${cur:0:12}. An arm can fail on a contract the deployed copy does not know, and the only symptom is a session that never becomes deliverable. Re-run ./run.sh install-copilot-receive"
			fi
		elif [ ! -f "$LIB_DIR/meta-session.js" ]; then
			note "no compiled writer in this checkout ($LIB_DIR) — cannot judge whether the deployed one is stale. Build it with 'pnpm run build-bridge'"
		fi
	else
		bad "unit directory missing at $claimed — run ./run.sh install-copilot-receive"
	fi

	echo "[copilot-receive-doctor] launch flag on live sessions"
	# THE INVISIBLE FAILURE. A Copilot launched without the flag never scans for
	# extensions and prints nothing at all, so a perfectly installed unit stays inert
	# with no symptom anywhere. Reading the live processes' own environment is the only
	# place that silence becomes visible. Linux /proc only; elsewhere it is a note.
	#
	# WHY NOT `pgrep -x copilot` (what this used to do). It matched nothing, ever, and
	# reported that as the benign "no live copilot" note — so the detector built to break
	# a silence was itself silent. Measured 2026-08-23: `type -P copilot` is a pnpm shim,
	# a POSIX shell script whose every branch ends `exec node …/@github/copilot/
	# npm-loader.js "$@"`. `exec` REPLACES the process image, so the thing that survives
	# is node and the comm can never read `copilot`.
	#
	# AND `comm` IS NOT THE FIX EITHER. On the same host `ps -eo comm=` showed 44
	# processes named `MainThread` — that is just what nodejs-slim 24 calls its main
	# thread, shared by the entwurf MCP bridge child and by 42 stub extension children a
	# gate had left behind; other node builds report plain `node`. A cell asserting
	# "comm == MainThread means native Copilot" would be green today and quietly false
	# after a node bump, so comm is used NOWHERE below, as predicate or as claim.
	#
	# WHAT IDENTIFIES A NATIVE CLI is its argv: the vendor entry `@github/copilot/*.js`
	# it was exec'd with, or an argv[0] the operator invoked as `copilot`. What must be
	# EXCLUDED is the vendor's own extension children — they are node processes launched
	# from OUR unit and carry `COPILOT_EXTENSION_PARENT_PID`; counting one as a session
	# would report a receiver as its own missing session.
	if [ ! -d /proc ]; then
		note "no /proc on this platform — cannot read the live CLI environments"
	else
		local pid_seam="" scan_json
		# WHICH PROCESSES ARE CANDIDATES. Normally every pid under /proc.
		# `ENTWURF_COPILOT_RECEIVE_PIDS` (set, even to empty) narrows the candidate set so
		# the gate can hand this branch REAL processes it launched and read their real
		# `/proc/<pid>/{cmdline,environ}`. It narrows candidates ONLY — the identity and
		# flag predicates below are the same production code either way, so the seam can
		# never certify a process the real scan would have rejected.
		if [ -n "${ENTWURF_COPILOT_RECEIVE_PIDS+x}" ]; then
			pid_seam="$ENTWURF_COPILOT_RECEIVE_PIDS"
		fi
		# OWNED FAILURE. Under `set -euo pipefail` a bare `x="$(python3 …)"` hands the
		# interpreter's exit status to the assignment, and `-e` ends the script THERE — before
		# any verdict line, so the operator sees a doctor that stopped mid-section and cannot
		# tell "fine" from "crashed". Same shape as the clean-log grep defect this lane already
		# stepped on once. The status is captured instead, and a broken scan becomes a verdict.
		local scan_rc=0
		scan_json="$(ENTWURF_PID_SEAM="${pid_seam}" ENTWURF_PID_SEAM_SET="${ENTWURF_COPILOT_RECEIVE_PIDS+1}" FLAG_ENV="$FLAG_ENV" FLAG_VALUE="$FLAG_VALUE" python3 - <<'PY'
import os, pathlib

flag_env = os.environ["FLAG_ENV"]
flag_value = os.environ["FLAG_VALUE"]

if os.environ.get("ENTWURF_PID_SEAM_SET"):
	candidates = [p for p in os.environ["ENTWURF_PID_SEAM"].split() if p.isdigit()]
else:
	candidates = [p.name for p in pathlib.Path("/proc").iterdir() if p.name.isdigit()]

def read_nul(pid, what):
	try:
		return pathlib.Path(f"/proc/{pid}/{what}").read_bytes().split(b"\0")
	except OSError:
		return None

armed_ok, armed_missing, unreadable = 0, 0, 0
missing_pids, unreadable_pids = [], []

for pid in candidates:
	argv = read_nul(pid, "cmdline")
	# No cmdline at all is a kernel thread or a process that exited mid-scan; neither is
	# a Copilot session and neither is evidence of anything.
	if not argv:
		continue
	argv = [a.decode("utf-8", "replace") for a in argv if a != b""]
	if not argv:
		continue

	# EXCLUDE the vendor's extension children first, before any positive match: they are
	# node processes whose argv names an `extension.mjs`. That entry name is the vendor's
	# REQUIRED one — it is what the CLI scans for — so argv alone is load-bearing here and
	# no second signal is read. (The bootstrap also hands these children a
	# COPILOT_EXTENSION_PARENT_PID, but this predicate does not consult it; do not describe
	# an exclusion the code does not perform.)
	if any(a.endswith("extension.mjs") for a in argv):
		continue

	# The positive identity. `@github/copilot/<entry>.js` is the vendor package entry the
	# launcher execs; an argv[0] basename of `copilot` covers an install that ships a
	# real binary under that name instead of a node shim.
	is_native = any("/@github/copilot/" in a and a.endswith(".js") for a in argv)
	if not is_native and os.path.basename(argv[0]) == "copilot":
		is_native = True
	if not is_native:
		continue

	env = read_nul(pid, "environ")
	if env is None:
		# FAIL-CLOSED: we identified a native CLI but cannot read its environment, so its
		# flag state is unknown. That is reported, never rounded to armed.
		unreadable += 1
		unreadable_pids.append(pid)
		continue
	env_map = {}
	for item in env:
		if b"=" in item:
			k, _, v = item.partition(b"=")
			env_map[k.decode("utf-8", "replace")] = v.decode("utf-8", "replace")
	# An absent flag and a flag without the token are the same failure: no scan happened.
	tokens = [t.strip() for t in (env_map.get(flag_env) or "").split(",")]
	if flag_value in tokens:
		armed_ok += 1
	else:
		armed_missing += 1
		missing_pids.append(pid)

print(f"{armed_ok} {armed_missing} {unreadable}")
print(" ".join(missing_pids))
print(" ".join(unreadable_pids))
PY
)" || scan_rc=$?
		local counts armed_ok armed_missing unreadable missing_pids unreadable_pids
		counts="$(printf '%s\n' "$scan_json" | sed -n '1p')"
		missing_pids="$(printf '%s\n' "$scan_json" | sed -n '2p')"
		unreadable_pids="$(printf '%s\n' "$scan_json" | sed -n '3p')"
		armed_ok="$(printf '%s' "$counts" | awk '{print $1}')"
		armed_missing="$(printf '%s' "$counts" | awk '{print $2}')"
		unreadable="$(printf '%s' "$counts" | awk '{print $3}')"
		if [ "$scan_rc" -ne 0 ] || [ -z "$armed_ok" ]; then
			bad "the /proc scan for live Copilot CLIs FAILED (exit $scan_rc) — the flag axis is UNKNOWN, so an inert session cannot be ruled out. This is a broken doctor, not a clean host."
		elif [ "$armed_ok" -eq 0 ] && [ "$armed_missing" -eq 0 ] && [ "$unreadable" -eq 0 ]; then
			note "no live GitHub Copilot CLI process — start one with 'entwurf copilot' (or $FLAG_ENV=$FLAG_VALUE copilot) to arm a receiver"
		else
			[ "$armed_ok" -gt 0 ] && ok "$armed_ok live Copilot CLI process(es) carry $FLAG_ENV=$FLAG_VALUE"
			if [ "$unreadable" -gt 0 ]; then
				# RED, not a note. These ARE Copilot CLIs — identity already succeeded — and the one
				# thing this section exists to decide about them is unknown. A note would let the
				# doctor end in PASS while a session that can never arm is running, which is the
				# exact false-success the section was written to break.
				bad "$unreadable live Copilot CLI process(es) have an unreadable environment (pids: $unreadable_pids) — their $FLAG_ENV state is UNKNOWN and is NOT assumed armed. Re-run this doctor as the user that owns those sessions."
			fi
			if [ "$armed_missing" -gt 0 ]; then
				bad "$armed_missing live Copilot CLI process(es) lack $FLAG_ENV=$FLAG_VALUE while the receiver is installed (pids: $missing_pids) — relaunch them with 'entwurf copilot', or uninstall the receiver so nothing promises a doorbell"
			fi
		fi
	fi

	echo "[copilot-receive-doctor] armed receivers"
	# The production predicate, not a re-implementation: readMetaReceiverMarker folds a
	# dead owner / reused pid to null, so what is counted here is what a sender would
	# actually be allowed to deliver to.
	if [ -d "$RECEIVERS_DIR" ]; then
		local armed_json
		armed_json="$(RECEIVERS_DIR="$RECEIVERS_DIR" LIB="$LIB_DIR/meta-session.js" node --input-type=module -e '
			const { readMetaReceiverMarker } = await import(process.env.LIB);
			const fs = await import("node:fs");
			const path = await import("node:path");
			const dir = process.env.RECEIVERS_DIR;
			let live = 0, stale = 0;
			for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
				const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
				if (raw.backend !== "copilot") continue;
				const m = readMetaReceiverMarker({ markerPath: path.join(dir, f) });
				if (m && m.ownerKind === "copilot-extension") live++; else stale++;
			}
			console.log(JSON.stringify({ live, stale }));
		' 2>/dev/null || echo '{"live":-1,"stale":-1}')"
		local live stale
		live="$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["live"])' "$armed_json" 2>/dev/null || echo -1)"
		stale="$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["stale"])' "$armed_json" 2>/dev/null || echo -1)"
		if [ "$live" = "-1" ]; then
			bad "could not read the receiver markers with the production reader (is the compiled lib present at $LIB_DIR?)"
		elif [ "$live" -gt 0 ]; then
			ok "$live live Copilot receiver marker(s) — those citizens are deliverable right now"
			[ "$stale" -gt 0 ] && note "$stale Copilot marker(s) whose owner is gone — retired by the start-key guard, not an error"
		else
			note "no live Copilot receiver marker. A session arms only after it is BORN (first prompt)"
			note "and only when its CLI was launched with $FLAG_ENV=$FLAG_VALUE."
			[ "$stale" -gt 0 ] && note "$stale historical Copilot marker(s) present; all owners are gone"
		fi
	else
		note "no receiver directory yet at $RECEIVERS_DIR (nothing has armed on this host)"
	fi

	echo "[copilot-receive-doctor] receiver log"
	if [ -f "$RECEIVE_LOG" ]; then
		# Same recovery rule as the birth doctor: this log is append-only, so an ERROR
		# that a later successful arm followed is history, not a live fault.
		#
		# WHY THE `{ grep … || [ "$?" -eq 1 ]; }` GUARD, AND WHY NOT `|| true`: the whole
		# script runs under `set -euo pipefail` (install/uninstall lean on -e for their
		# fail-loud writes), and a no-match grep exits 1 — pipefail turns that into the
		# assignment's status and -e kills the doctor MID-SECTION on a perfectly healthy
		# log, printing no verdict at all (measured on this lane). The guard admits
		# exactly exit 1 ("no match" — an ordinary answer here, kept one line per
		# assignment like the birth doctor's rule) and lets every other grep status
		# propagate: a real read error stays loud and still ends the doctor with a
		# nameable failure.
		local last_err last_ok total_err
		last_err="$({ grep -n ' ERROR \[copilot-receive\] ' "$RECEIVE_LOG" 2>/dev/null || [ "$?" -eq 1 ]; } | tail -1 | cut -d: -f1)"
		last_ok="$({ grep -n ' INFO \[copilot-receive\] armed ' "$RECEIVE_LOG" 2>/dev/null || [ "$?" -eq 1 ]; } | tail -1 | cut -d: -f1)"
		total_err="$({ grep -c ' ERROR \[copilot-receive\] ' "$RECEIVE_LOG" 2>/dev/null || [ "$?" -eq 1 ]; } | head -1)"
		total_err="${total_err:-0}"
		if [ -z "$last_err" ]; then
			ok "no ERROR lines in $RECEIVE_LOG"
		elif [ -n "$last_ok" ] && [ "$last_ok" -gt "$last_err" ]; then
			note "$total_err historical ERROR line(s), all followed by a successful arm (line $last_ok > $last_err) — recovered, not red"
		else
			bad "the newest receiver line in $RECEIVE_LOG is an unrecovered ERROR:"
			grep ' ERROR \[copilot-receive\] ' "$RECEIVE_LOG" | tail -3 | sed 's/^/        /'
		fi
		local refused
		refused="$({ grep -c ' WARN \[copilot-receive\] arm-refused ' "$RECEIVE_LOG" 2>/dev/null || [ "$?" -eq 1 ]; } | head -1)"
		if [ "${refused:-0}" -gt 0 ]; then
			note "${refused} arm refusal(s) — fail-closed answers (id drift or an untrusted parent), not faults:"
			grep ' WARN \[copilot-receive\] arm-refused ' "$RECEIVE_LOG" | tail -2 | sed 's/^/        /'
		fi
	else
		note "no receiver log yet at $RECEIVE_LOG — no extension has joined a session on this host"
	fi

	echo
	if [ "$fail_flag" -ne 0 ]; then
		echo "[copilot-receive-doctor] FAIL"
		return 1
	fi
	echo "[copilot-receive-doctor] PASS"
	return 0
}

case "${1:-}" in
	install) shift; do_install "$@" ;;
	uninstall) shift; do_uninstall "$@" ;;
	doctor) shift; do_doctor "$@" ;;
	*) fail "usage: copilot-receive-bridge.sh {install|uninstall|doctor}" ;;
esac
