#!/usr/bin/env bash
# OMP MCP install adapter (#87 step 5). The birth extension and the MCP hand stay separate
# surfaces: registration is TOOLS, not identity (`docs/external-mcp-host.md`), and the two
# fail in different ways for different reasons.
#
# Owns ONE `mcpServers.entwurf-bridge` key inside the omp-native user MCP file
# (`<omp agent dir>/mcp.json`). The key is a PINNED LITERAL — it is byte-identical to the
# key omp's Claude-import provider produces, which is what makes the native entry SHADOW
# the import instead of loading beside it (`capability/index.ts:84-91`, `:183`, `:203-207`).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HERE/.." && pwd)"
CONFIG_PY="$HERE/omp-mcp-config.py"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-mcp"
STATE_FILE="$STATE_DIR/install-state.json"

log() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# shellcheck source=scripts/omp-bridge-oracle.sh
. "$HERE/omp-bridge-oracle.sh"

AGENT_DIR="$(omp_agent_dir)" || fail "the omp agent directory this host reads is ambiguous (see above) — refusing to write a config file omp may never read."
# THE TARGET IS NOT CONFIGURABLE (#87 D1). It is exactly `<resolved omp agent dir>/mcp.json`
# and nothing else. The retired `ENTWURF_OMP_MCP_CONFIG` took an arbitrary path with no
# descendant check, so the "omp-only" writer could be aimed at ~/.claude.json, ~/.pi/... or
# any regular file — an explicit env seam lowers the odds of an accident but grants no
# ownership, and cross-harness non-disturbance is this lane's whole point. Sandboxing is
# still available where it belongs: `ENTWURF_OMP_AGENT_DIR` moves the AGENT DIR, and the
# target follows it by construction.
CONFIG="$AGENT_DIR/mcp.json"

# The invocation, split exactly the way the Claude installer splits it (meta-bridge-install.sh
# `desired_mcp`): an installed package wires the STABLE `entwurf-bridge` bin shim (baking a
# pnpm store path would go stale on any version bump), a dev clone pins this clone's own
# start.sh. Both carry the same env, and it is the omp label, not Claude's.
case "$REPO_DIR" in
	*/node_modules/@junghanacs/entwurf)
		COMMAND="entwurf-bridge"
		ARGS_JSON='[]' ;;
	*)
		COMMAND="bash"
		ARGS_JSON="$(python3 -c 'import json,sys;print(json.dumps([sys.argv[1]]))' "$REPO_DIR/mcp/entwurf-bridge/start.sh")" ;;
esac
COMMAND="${ENTWURF_OMP_MCP_COMMAND:-$COMMAND}"
[ -n "${ENTWURF_OMP_MCP_COMMAND:-}" ] && ARGS_JSON="${ENTWURF_OMP_MCP_ARGS:-[]}"

# The Claude-import sources omp translates on this platform, in the vendor's own order
# (`docs/mcp-config.md` "Imported tool configs"). Read-only: this adapter never writes to
# another tool's config (neither does the vendor — `mcp/config-writer.ts:301-304`).
IMPORT_PATHS=("$HOME/.claude.json" "$HOME/.claude/mcp.json" "$HOME/.mcp.json")

run_config() {
	local out rc
	set +e
	out="$(python3 "$CONFIG_PY" "$@" 2>&1)"
	rc=$?
	set -e
	printf '%s\n' "$out"
	return "$rc"
}

BOOT_PROBED_INVOCATION=""
BOOT_PROBED_RC=1
BOOT_PROBED_OUT=""
BOOT_DETAIL=""
command_boots() {
	local invocation="$1" out rc
	if [ "$invocation" = "$BOOT_PROBED_INVOCATION" ]; then
		BOOT_DETAIL="$BOOT_PROBED_OUT"
		return "$BOOT_PROBED_RC"
	fi
	set +e
	out="$("$REPO_DIR/run.sh" probe-bridge-command --invocation-json "$invocation" 2>&1)"
	rc=$?
	set -e
	BOOT_PROBED_INVOCATION="$invocation"; BOOT_PROBED_RC="$rc"; BOOT_PROBED_OUT="$out"; BOOT_DETAIL="$out"
	return "$rc"
}

do_install() {
	log "[omp-mcp install]"
	log "  target:  $CONFIG"
	log "  command: $COMMAND $ARGS_JSON"
	log "  key:     entwurf-bridge (pinned literal — same key as the Claude import, which is what shadows it)"
	log "  state:   $STATE_FILE"
	local out rc
	set +e
	out="$(run_config install "$CONFIG" "$COMMAND" "$ARGS_JSON" "$STATE_FILE")"
	rc=$?
	set -e
	case "$rc" in
		0) log "  ok: $out" ;;
		3) fail "refused — $out" ;;
		4) fail "invalid config/state — $out" ;;
		5) fail "usage — $out" ;;
		*) fail "install error (rc=$rc) — $out" ;;
	esac
	log "  installed. Verify with: ./run.sh doctor-omp-mcp"
	log "  NOTE: an omp session that is ALREADY OPEN keeps the servers it connected at start;"
	log "  restart it to pick the native entry up."
}

do_uninstall() {
	log "[omp-mcp uninstall]"
	local out rc
	set +e
	out="$(run_config uninstall "$STATE_FILE")"
	rc=$?
	set -e
	case "$rc" in
		0) log "  ok: $out" ;;
		2) log "  note: $out" ;;
		3) fail "refused — $out" ;;
		*) fail "uninstall error (rc=$rc) — $out" ;;
	esac
	log "  the Claude import (if this host has one) becomes the effective source again —"
	log "  which is exactly the borrowed provenance this surface exists to replace."
}

state_target() {
	python3 - "$STATE_FILE" <<'PY'
import json, os, sys
try:
    state = json.load(open(sys.argv[1]))
    required = ("serverKey", "command", "args", "detectMode", "configExistedBefore", "preimage")
    if state.get("schemaVersion") != 1 or any(key not in state for key in required): raise ValueError()
    if state.get("serverKey") != "entwurf-bridge": raise ValueError()
    value = state.get("managedConfigPath")
    if not isinstance(value, str) or not os.path.isabs(value): raise ValueError()
    print(os.path.abspath(value))
except Exception:
    raise SystemExit(1)
PY
}

do_doctor() {
	log "[omp-mcp doctor]"
	log "  agent dir: $AGENT_DIR"
	local hard_fail=0 status out rc installed=0
	[ -f "$STATE_FILE" ] && installed=1
	set +e
	out="$(run_config doctor-static "$CONFIG" "$COMMAND")"
	rc=$?
	set -e
	status="${out##*$'\n'}"
	if [ "$rc" -ne 0 ]; then
		log "  config: unexpected config reader failure (rc=$rc): $out"
		[ "$installed" -eq 1 ] && hard_fail=1
	else
		case "$status" in
			configured\ *)
				local invocation
				if ! invocation="$(python3 "$CONFIG_PY" doctor-invocation "$CONFIG" "$COMMAND")"; then
					log "  config: configured → '$COMMAND' but its exact invocation is unreadable"
					[ "$installed" -eq 1 ] && hard_fail=1
				elif command_boots "$invocation"; then
					log "  config: configured → the exact configured invocation boots the entwurf MCP surface"
				else
					log "  config: configured → '$COMMAND' does NOT serve MCP with its configured args/env"
					log "        $BOOT_DETAIL"
					[ "$installed" -eq 1 ] && hard_fail=1
				fi ;;
			foreign-provenance)
				# The one status that is red even with no install-state: an entwurf-bridge
				# entry under the omp-native key that introduces this session as some other
				# harness is worse than no entry at all.
				log "  config: FOREIGN PROVENANCE — the native entry does not carry ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/omp, so omp sessions would speak under another harness's name"
				hard_fail=1 ;;
			self-disabled)
				log "  config: DENYLISTED — 'entwurf-bridge' is in disabledServers. Suppression is by NAME and a suppressed item still claims the dedupe key, so this kills the native entry AND the Claude import (mcp/config.ts:123-127, capability/index.ts:191-196). Remove the denylist entry; it is never the way to hide an import"
				hard_fail=1 ;;
			symlink)
				log "  config: REFUSED symlink (someone else's SSOT)"
				[ "$installed" -eq 1 ] && hard_fail=1 ;;
			invalid-json|invalid-entry)
				# RUNTIME truth, independent of OWNERSHIP truth (Hard Rule 13, #87 B4). An
				# unreadable file or a malformed entry under our key is broken for omp
				# whether or not entwurf installed anything here — and the entry still
				# claims the dedupe slot, so the import is suppressed too. Red either way.
				log "  config: $status — the effective omp-native configuration is BROKEN (runtime axis; ownership state is a separate question)"
				hard_fail=1 ;;
			file-absent|not-ours)
				if [ "$installed" -eq 1 ]; then
					log "  config: $status (owned state present — this is drift)"
					hard_fail=1
				else
					log "  config: $status (not ours; run install-omp-mcp to write the native entry)"
				fi ;;
			*)
				log "  config: unexpected status '$out'"
				[ "$installed" -eq 1 ] && hard_fail=1 ;;
		esac
	fi

	# ── the EFFECTIVE source ────────────────────────────────────────────────
	# A CONFIGURATION read, not a runtime receipt, and it says so. It answers the one
	# question the independent-harness stance turns on: when this host's omp starts, is the
	# `entwurf-bridge` it loads OURS, or the Claude import carrying Claude Code's label?
	# Vendor precedence decides it (native=100 > claude=80, first-wins by NAME), so the
	# answer is decidable from the files — but the vendor's own `/mcp list` pane remains
	# the live oracle, taken once as a LIVE receipt rather than re-derived here.
	local shadow verdict
	shadow="$(run_config doctor-shadow "$CONFIG" "${IMPORT_PATHS[@]}")" || true
	verdict="$(printf '%s\n' "$shadow" | sed -n 's/^verdict //p' | tail -1)"
	printf '%s\n' "$shadow" | sed -n 's/^/        /p'
	case "$verdict" in
		native-wins)
			log "  effective: the NATIVE entry wins by vendor precedence (native=100 > claude=80, first-wins on the shared key). Any Claude import of the same name is fully suppressed — not both-loaded, not merged, no warning" ;;
		native-invalid)
			# The worst of both: nothing loads, AND the import is still suppressed because a
			# malformed value under the key keeps claiming the dedupe slot. Never reported
			# as native-wins, and never softened by the absence of install-state.
			log "  effective: NOTHING — the entry under the native key is malformed, so omp loads no entwurf-bridge, and it still suppresses any Claude import by claiming the key. Repair or remove that entry (run install-omp-mcp to write a valid one)"
			hard_fail=1 ;;
		import-wins)
			if [ "$installed" -eq 1 ]; then
				log "  effective: the CLAUDE IMPORT would win — our native entry is missing while ownership state exists. This is the borrowed-provenance state (#87): omp sessions introduce themselves as claude-code"
				hard_fail=1
			else
				log "  effective: the CLAUDE IMPORT is currently the only source (not ours; run install-omp-mcp)"
			fi ;;
		both-suppressed)
			log "  effective: NOTHING — 'entwurf-bridge' is denylisted, which suppresses the native entry and the import together"
			hard_fail=1 ;;
		*)
			if [ "$installed" -eq 1 ]; then
				log "  effective: no entwurf-bridge source at all while ownership state exists — drift"
				hard_fail=1
			else
				log "  effective: no entwurf-bridge source on this host yet"
			fi ;;
	esac

	if [ -f "$STATE_FILE" ]; then
		local managed expected managed_status
		expected="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$CONFIG")"
		if ! managed="$(state_target)"; then
			log "  state: CORRUPT — $STATE_FILE has no absolute managedConfigPath"
			hard_fail=1
		elif [ "$managed" != "$expected" ]; then
			log "  state: FOREIGN TARGET — state manages '$managed', omp reads '$expected'"
			hard_fail=1
		else
			managed_status="$(run_config doctor-static "$managed" "$COMMAND" | tail -1)"
			case "$managed_status" in
				configured\ *) log "  state: install-state present; managed config still configures entwurf-bridge under the pinned key." ;;
				file-absent)
					log "  state: ORPHANED — managed config disappeared; removing stale state."
					rm -f "$STATE_FILE" ;;
				*)
					log "  state: DRIFT — managed config no longer satisfies the MCP contract ($managed_status)."
					hard_fail=1 ;;
			esac
		fi
	else
		log "  state: absent (no MCP ownership recorded)"
	fi

	if [ "$hard_fail" -ne 0 ]; then
		fail "doctor found a broken OMP MCP configuration."
	fi
	log "doctor: ok."
}

case "${1:-}" in
	install) do_install ;;
	uninstall) do_uninstall ;;
	doctor) do_doctor ;;
	*) echo "usage: omp-mcp-bridge.sh <install|uninstall|doctor>" >&2; exit 2 ;;
esac
