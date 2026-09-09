#!/bin/sh
# raw-macos-measure/probe.sh — Darwin host measurement for the macOS parity lane (#78).
#
# MEASUREMENT ONLY. This script writes nothing outside its own temp dir, installs
# nothing, needs no entwurf installation, and touches no operator config. It is
# meant to be run ONCE on a borrowed Mac and its whole stdout pasted into
# scripts/raw-macos-measure/README.md.
#
# It is /bin/sh (not bash) on purpose: macOS ships bash 3.2 and one of the things
# under measurement is what a shell can assume here at all.
#
#   ./probe.sh            # human-readable ledger on stdout
#
# Every cell prints its own verdict token so a reader never has to interpret raw
# tool output: PRESENT / ABSENT / OK / DIFFERS / FAIL / UNKNOWN.

set -u

TMP=$(mktemp -d "${TMPDIR:-/tmp}/entwurf-macos-probe.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT INT TERM

hdr() {
	printf '\n== %s ==\n' "$1"
}

# `have <cmd>` -> PRESENT/ABSENT plus the resolved path.
have() {
	if p=$(command -v "$1" 2>/dev/null); then
		printf '  %-18s PRESENT  %s\n' "$1" "$p"
		return 0
	fi
	printf '  %-18s ABSENT\n' "$1"
	return 1
}

printf 'entwurf raw-macos-measure probe\n'
printf 'run at: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ') UTC"

hdr 'M1. host identity'
if command -v sw_vers >/dev/null 2>&1; then
	sw_vers | sed 's/^/  /'
else
	printf '  sw_vers ABSENT — this is not a Darwin host; the ledger cell is void.\n'
fi
printf '  uname -srm: %s\n' "$(uname -srm)"
printf '  hw.model:   %s\n' "$(sysctl -n hw.model 2>/dev/null || echo UNKNOWN)"
printf '  cpu:        %s\n' "$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo UNKNOWN)"

hdr 'M2. shell — what a script may assume'
printf '  /bin/sh   -> %s\n' "$(/bin/sh -c 'echo ${BASH_VERSION:-not-bash}' 2>/dev/null)"
printf '  /bin/bash -> %s\n' "$(/bin/bash -c 'echo ${BASH_VERSION:-unknown}' 2>/dev/null || echo ABSENT)"
printf '  env bash  -> %s (%s)\n' \
	"$(env bash -c 'echo ${BASH_VERSION:-unknown}' 2>/dev/null || echo ABSENT)" \
	"$(command -v bash 2>/dev/null || echo no-bash-on-PATH)"
# bash 4 features the repo's gates use: `declare -A`, `mapfile`.
if env bash -c 'declare -A _x' >/dev/null 2>&1; then
	printf '  declare -A (bash4)  OK\n'
else
	printf '  declare -A (bash4)  FAIL — associative arrays unavailable to `env bash`\n'
fi
if env bash -c 'mapfile -t _y < /dev/null' >/dev/null 2>&1; then
	printf '  mapfile   (bash4)   OK\n'
else
	printf '  mapfile   (bash4)   FAIL\n'
fi

hdr 'M3. runtime prerequisites'
have node && printf '  %-18s %s\n' 'node --version' "$(node --version 2>/dev/null)"
have npm && printf '  %-18s %s\n' 'npm --version' "$(npm --version 2>/dev/null)"
have pnpm && printf '  %-18s %s\n' 'pnpm --version' "$(pnpm --version 2>/dev/null)"
# python3 on macOS may be the CommandLineTools STUB at /usr/bin/python3, which
# prints nothing useful and pops a GUI installer instead. The shipped operator
# surface calls python3 in hundreds of places, so a stub is a total install
# failure, not a degraded cell.
if have python3; then
	printf '  %-18s %s\n' 'python3 -V' "$(python3 -V 2>&1)"
	if python3 -c 'print("live")' 2>/dev/null | grep -q live; then
		printf '  %-18s REAL (executes code, no install prompt)\n' 'python3 kind'
	else
		printf '  %-18s STUB/BROKEN — the whole install+doctor surface dies here\n' 'python3 kind'
	fi
fi
have git
have tmux && printf '  %-18s %s\n' 'tmux -V' "$(tmux -V 2>/dev/null)"

hdr 'M4. GNU-vs-BSD tool matrix (the P1 substitution surface)'
have sha256sum || true
have shasum || true
have openssl || true
have realpath || true
have timeout || true
have gtimeout || true
have gsed || true
have gstat || true
printf '\n  -- behavioural probes (presence is not compatibility) --\n'
printf 'abc' >"$TMP/f"
# stat: GNU `-c %s` vs BSD `-f %z`
if stat -c %s "$TMP/f" >/dev/null 2>&1; then
	printf '  stat -c %%s        OK (GNU form works)\n'
else
	printf '  stat -c %%s        FAIL (GNU form rejected) — BSD `stat -f %%z` = %s\n' \
		"$(stat -f %z "$TMP/f" 2>/dev/null || echo FAIL)"
fi
# readlink -f
ln -s "$TMP/f" "$TMP/link"
if readlink -f "$TMP/link" >/dev/null 2>&1; then
	printf '  readlink -f       OK\n'
else
	printf '  readlink -f       FAIL (no GNU -f)\n'
fi
# stat: both fields the repo reads (size AND mtime), because a working `-f %z`
# does not promise `-f %m`.
printf '  stat -f %%z (size)  %s\n' "$(stat -f %z "$TMP/f" 2>/dev/null || echo FAIL)"
printf '  stat -f %%m (mtime) %s\n' "$(stat -f %m "$TMP/f" 2>/dev/null || echo FAIL)"
printf '  stat -c %%Y (mtime) %s\n' "$(stat -c %Y "$TMP/f" 2>/dev/null || echo FAIL)"
# sha256: which producer, and does the digest text match across producers?
S_SUM=$(sha256sum "$TMP/f" 2>/dev/null | awk '{print $1}')
S_SHA=$(shasum -a 256 "$TMP/f" 2>/dev/null | awk '{print $1}')
S_SSL=$(openssl dgst -sha256 "$TMP/f" 2>/dev/null | awk '{print $NF}')
printf '  sha256sum         %s\n' "${S_SUM:-ABSENT}"
printf '  shasum -a 256     %s\n' "${S_SHA:-ABSENT}"
printf '  openssl dgst      %s\n' "${S_SSL:-ABSENT}"
for v in "$S_SUM" "$S_SHA" "$S_SSL"; do
	[ -n "$v" ] && [ "$v" != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" ] &&
		printf '  DIGEST MISMATCH   a producer disagrees with the known sha256 of "abc"\n'
done
# NUL-delimited pipelines
if printf 'a\0b\0' | sort -z >/dev/null 2>&1; then
	printf '  sort -z           OK\n'
else
	printf '  sort -z           FAIL (no BSD equivalent flag)\n'
fi
if printf 'a\0' | xargs -0 true >/dev/null 2>&1; then
	printf '  xargs -0          OK\n'
else
	printf '  xargs -0          FAIL\n'
fi
if printf 'a\0' | xargs -0r true >/dev/null 2>&1; then
	printf '  xargs -0r         OK\n'
else
	printf '  xargs -0r         FAIL (GNU-only -r; BSD xargs already skips empty input)\n'
fi
# grep -P
if printf 'a\n' | grep -P 'a' >/dev/null 2>&1; then
	printf '  grep -P           OK\n'
else
	printf '  grep -P           FAIL (no PCRE); grep -E = %s\n' \
		"$(printf 'a\n' | grep -E 'a' >/dev/null 2>&1 && echo OK || echo FAIL)"
fi
# date -d
if date -d '@0' >/dev/null 2>&1; then
	printf '  date -d           OK\n'
else
	printf '  date -d           FAIL (BSD date uses -r/-j -f)\n'
fi
# mktemp with a template (both accept it, but confirm)
printf '  mktemp -d         %s\n' "$(mktemp -d "${TMPDIR:-/tmp}/probe.XXXXXX" >/dev/null 2>&1 && echo OK || echo FAIL)"

hdr 'M5. start-key sources — the identity rail (meta-session.ts:1554)'
printf '  /proc present?    %s\n' "$([ -d /proc ] && echo YES || echo NO)"
SELF=$$
printf '  ps -o lstart= self: %s\n' "$(ps -o lstart= -p "$SELF" 2>/dev/null | sed 's/^ *//;s/ *$//')"
printf '  ps -o command= self: %s\n' "$(ps -o command= -p "$SELF" 2>/dev/null | sed 's/^ *//' | cut -c1-100)"
# RESOLUTION TEST: two children started back to back. If their lstart strings are
# equal, the `ps:` scheme's pid-reuse defense is 1-second granular.
sleep 4 &
C1=$!
sleep 4 &
C2=$!
L1=$(ps -o lstart= -p "$C1" 2>/dev/null | sed 's/^ *//;s/ *$//')
L2=$(ps -o lstart= -p "$C2" 2>/dev/null | sed 's/^ *//;s/ *$//')
printf '  child A (%s): %s\n' "$C1" "$L1"
printf '  child B (%s): %s\n' "$C2" "$L2"
if [ "$L1" = "$L2" ]; then
	printf '  RESOLUTION        1-SECOND (two back-to-back starts share one key string)\n'
else
	printf '  RESOLUTION        SUB-SECOND (back-to-back starts differ) — re-run to confirm\n'
fi
# WIDENING candidate: would including argv in the key have separated them? Both
# children run the SAME argv on purpose — that is the WORST case for widening, and
# the worst case is the one a fail-closed identity rail has to survive.
W1=$(ps -o lstart=,command= -p "$C1" 2>/dev/null | sed 's/^ *//;s/ *$//')
W2=$(ps -o lstart=,command= -p "$C2" 2>/dev/null | sed 's/^ *//;s/ *$//')
printf '  widened key A     %s\n' "$W1"
printf '  widened key B     %s\n' "$W2"
if [ "$W1" = "$W2" ]; then
	printf '  WIDENING          INSUFFICIENT ALONE (identical argv collides even widened)\n'
else
	printf '  WIDENING          SEPARATES (argv distinguished two same-second starts)\n'
fi
kill "$C1" "$C2" 2>/dev/null
wait "$C1" 2>/dev/null
wait "$C2" 2>/dev/null
# MICROSECOND candidate: libproc proc_pidinfo(PROC_PIDTBSDINFO) via python3 ctypes.
if command -v python3 >/dev/null 2>&1; then
	python3 - "$SELF" <<'PY' 2>&1 | sed 's/^/  /'
import ctypes, ctypes.util, sys
pid = int(sys.argv[1])
lib = ctypes.util.find_library("proc") or "/usr/lib/libproc.dylib"
try:
    libproc = ctypes.CDLL(lib)
except OSError as e:
    print(f"libproc            UNAVAILABLE ({e})")
    raise SystemExit(0)

PROC_PIDTBSDINFO = 3
class ProcBsdInfo(ctypes.Structure):
    _fields_ = [
        ("pbi_flags", ctypes.c_uint32), ("pbi_status", ctypes.c_uint32),
        ("pbi_xstatus", ctypes.c_uint32), ("pbi_pid", ctypes.c_uint32),
        ("pbi_ppid", ctypes.c_uint32), ("pbi_uid", ctypes.c_uint32),
        ("pbi_gid", ctypes.c_uint32), ("pbi_ruid", ctypes.c_uint32),
        ("pbi_rgid", ctypes.c_uint32), ("pbi_svuid", ctypes.c_uint32),
        ("pbi_svgid", ctypes.c_uint32), ("rfu_1", ctypes.c_uint32),
        ("pbi_comm", ctypes.c_char * 16), ("pbi_name", ctypes.c_char * 32),
        ("pbi_nfiles", ctypes.c_uint32), ("pbi_pgid", ctypes.c_uint32),
        ("pbi_pjobc", ctypes.c_uint32), ("e_tdev", ctypes.c_uint32),
        ("e_tpgid", ctypes.c_uint32), ("pbi_nice", ctypes.c_int32),
        ("pbi_start_tvsec", ctypes.c_uint64), ("pbi_start_tvusec", ctypes.c_uint64),
    ]

info = ProcBsdInfo()
n = libproc.proc_pidinfo(pid, PROC_PIDTBSDINFO, ctypes.c_uint64(0),
                         ctypes.byref(info), ctypes.sizeof(info))
if n != ctypes.sizeof(info):
    print(f"proc_pidinfo       FAIL (returned {n}, expected {ctypes.sizeof(info)})")
else:
    print(f"proc_pidinfo       OK  pid={info.pbi_pid} "
          f"start={info.pbi_start_tvsec}.{info.pbi_start_tvusec:06d} "
          f"comm={info.pbi_comm.decode(errors='replace')}")
    print("RESOLUTION         MICROSECOND (a sub-second start key IS reachable here)")
PY
else
	printf '  proc_pidinfo      SKIPPED (no python3)\n'
fi

hdr 'M6. process discovery — can a reader see another process at all?'
# The bridge/receiver doctors narrow candidates through /proc/<pid>/{environ,cmdline}
# (scripts/omp-bridge-doctor.sh:258-267, scripts/copilot-receive-bridge.sh:264-289).
# Darwin has neither, so `ps -E` is the only candidate — and WHICH PROCESS IS ASKED
# decides the answer. Apple-signed, SIP-protected binaries refuse environ reads by
# construction, so probing `/bin/sleep` would report a false REJECTED.
#
# SCOPE, STATED EXACTLY: the node group below is a PROXY for entwurf's own MCP child,
# which is a node process this probe can start. It is NOT a measurement of the Copilot
# CLI or of omp: those are different binaries with their own signing and hardened-
# runtime state, and a proxy result does not transfer to them. The optional group 3
# probes a REAL copilot/omp process only if the operator already has one running; when
# it does not, that is reported as NOT MEASURED, never as coverage.
probe_environ() {
	# $1 = label, $2 = pid, $3 = marker expected in the environment (or "")
	_lbl=$1
	_pid=$2
	_marker=$3
	if ps -E -p "$_pid" >/dev/null 2>&1; then
		_out=$(ps -Eww -p "$_pid" 2>/dev/null | tail -1)
		if [ -n "$_marker" ]; then
			if printf '%s' "$_out" | grep -q "$_marker"; then
				printf '  %-22s VISIBLE — marker found in `ps -Eww` output\n' "$_lbl"
			else
				printf '  %-22s ACCEPTED-BUT-EMPTY — ps -E returned, marker ABSENT\n' "$_lbl"
			fi
		else
			printf '  %-22s ACCEPTED (width %s chars)\n' "$_lbl" \
				"$(printf '%s' "$_out" | wc -c | tr -d ' ')"
		fi
	else
		printf '  %-22s REJECTED by ps -E\n' "$_lbl"
	fi
}
# Group 1 — UNRESTRICTED target: a node process we start ourselves, carrying a marker.
# This is the group that decides whether the doctors' discovery path survives.
if command -v node >/dev/null 2>&1; then
	ENTWURF_PROBE_MARKER=hello-entwurf \
		node -e 'setTimeout(function(){}, 5000)' >/dev/null 2>&1 &
	N1=$!
	sleep 1
	printf '  node target pid   %s\n' "$N1"
	printf '  node argv         %s\n' \
		"$(ps -o command= -p "$N1" 2>/dev/null | sed 's/^ *//' | cut -c1-120)"
	probe_environ 'node environ' "$N1" 'ENTWURF_PROBE_MARKER=hello-entwurf'
	printf '  node ppid         %s (expect this shell, %s)\n' \
		"$(ps -o ppid= -p "$N1" 2>/dev/null | tr -d ' ')" "$SELF"
	kill "$N1" 2>/dev/null
	wait "$N1" 2>/dev/null
else
	printf '  node target       SKIPPED (no node on PATH) — THIS CELL IS THE IMPORTANT ONE\n'
fi
# Group 2 — RESTRICTED control: an Apple-signed system binary. A REJECTED here beside
# a VISIBLE above is the proof that the refusal is SIP, not a missing capability.
sleep 5 &
D1=$!
printf '  sleep argv        %s\n' \
	"$(ps -o command= -p "$D1" 2>/dev/null | sed 's/^ *//' | cut -c1-100)"
probe_environ '/bin/sleep environ' "$D1" ''
kill "$D1" 2>/dev/null
wait "$D1" 2>/dev/null
# Group 3 — THE REAL TARGETS, when the operator already has one running. Group 1 is a
# proxy; these are the binaries the doctors actually interrogate. A different signing
# or hardened-runtime state here than on our own node child is exactly the result that
# would invalidate the proxy, so an absent process is NOT MEASURED, never coverage.
for real in copilot omp claude; do
	_rp=$(pgrep -x "$real" 2>/dev/null | head -1)
	if [ -n "${_rp:-}" ]; then
		printf '  %-22s live pid %s\n' "$real (real target)" "$_rp"
		probe_environ "$real environ" "$_rp" ''
	else
		printf '  %-22s NOT MEASURED — no live `%s` process on this host\n' \
			"$real (real target)" "$real"
	fi
done
# Full-table scan: the fallback if environ is unreadable is argv-only matching over
# every process. Measure that it works AND what it costs.
SCAN_START=$(date +%s)
SCAN_N=$(ps -A -o pid=,ppid=,command= 2>/dev/null | wc -l | tr -d ' ')
SCAN_END=$(date +%s)
printf '  ps -A scan        %s rows in ~%ss\n' "$SCAN_N" "$((SCAN_END - SCAN_START))"
printf '  pgrep present?    %s\n' "$(command -v pgrep >/dev/null 2>&1 && echo YES || echo NO)"
printf '  lsof present?     %s\n' "$(command -v lsof >/dev/null 2>&1 && echo YES || echo NO)"

hdr 'M7. pid space — how reachable is a same-second pid reuse?'
printf '  kern.maxproc:     %s\n' "$(sysctl -n kern.maxproc 2>/dev/null || echo UNKNOWN)"
printf '  kern.maxprocperuid: %s\n' "$(sysctl -n kern.maxprocperuid 2>/dev/null || echo UNKNOWN)"
printf '  current pid:      %s\n' "$SELF"
printf '  (PID_MAX on Darwin is a compile-time 99999; a wrap needs that many spawns)\n'

hdr 'M8. filesystem semantics that installers depend on'
printf '  case-sensitive?   '
touch "$TMP/CaseFile"
if [ -e "$TMP/casefile" ]; then printf 'NO (case-INSENSITIVE volume)\n'; else printf 'YES\n'; fi
printf '  HOME:             %s\n' "${HOME:-UNSET}"
printf '  XDG_DATA_HOME:    %s\n' "${XDG_DATA_HOME:-unset (entwurf defaults apply)}"
printf '  symlink support:  %s\n' "$([ -L "$TMP/link" ] && echo OK || echo FAIL)"
printf '  ~/.local/bin on PATH? %s\n' \
	"$(printf '%s' "${PATH:-}" | tr ':' '\n' | grep -qx "$HOME/.local/bin" && echo YES || echo NO)"

hdr 'M9. fs.watch rename semantics — the mailbox doorbell'
# The receiver arms a watch and a sender delivers by writing then renaming into
# place. Darwin's fs.watch is FSEvents-backed, not inotify: confirm a rename-over
# actually raises an event for the WATCHED path.
if command -v node >/dev/null 2>&1; then
	mkdir -p "$TMP/watch"
	printf 'v1\n' >"$TMP/watch/target"
	node -e '
const fs = require("fs");
const dir = process.argv[1];
let fired = [];
let watchErr = null;
let w = null;
try {
  w = fs.watch(dir + "/target", (ev) => fired.push(ev));
  w.on("error", (e) => { watchErr = e; });
} catch (e) {
  watchErr = e;
}
setTimeout(() => {
  try {
    fs.writeFileSync(dir + "/staged", "v2\n");
    fs.renameSync(dir + "/staged", dir + "/target");
  } catch (e) {
    watchErr = watchErr || e;
  }
}, 200);
setTimeout(() => {
  try { if (w) w.close(); } catch (e) { /* closing a dead watcher is not the measurement */ }
  // EVERY path prints exactly one verdict token. An error is an honest UNKNOWN, not a
  // missing line: a borrowed host must never hand back a cell that simply is not there.
  if (watchErr) {
    console.log("  fs.watch rename   UNKNOWN — watcher errored: " + (watchErr.code || watchErr.message));
  } else if (fired.length) {
    console.log("  fs.watch rename   FIRED [" + fired.join(",") + "]");
  } else {
    console.log("  fs.watch rename   SILENT — doorbell would not ring");
  }
  try {
    const dw = fs.watch(dir, () => {});
    dw.close();
    console.log("  fs.watch on dir   SUPPORTED");
  } catch (e) {
    console.log("  fs.watch on dir   UNSUPPORTED — " + (e.code || e.message));
  }
}, 1200);
' "$TMP/watch" 2>&1 | sed 's/^/  /;s/^  \( *fs\.watch\)/\1/'
else
	printf '  fs.watch          SKIPPED (no node on PATH)\n'
fi

printf '\n== probe complete ==\n'
printf 'Paste this whole output into scripts/raw-macos-measure/README.md under the matching cell.\n'
