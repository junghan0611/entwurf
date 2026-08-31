#!/usr/bin/env bash
# OMP operator-setting adapter (`tools.xdev: false`) — the WRITER for the runtime cell
# `doctor-omp-mcp` already judges and `omp-tool-surface.py` already reads.
#
# Separate surface from the MCP hand on purpose: registering the server is TOOLS, and
# `tools.xdev` decides whether those registered tools are REACHABLE at all. omp's default
# (`xdev: true`, no inline allowlist) wraps every MCP tool behind `xd://`, so a host with a
# perfect mcp.json still announces a doorbell tool the model cannot call. Until this adapter
# existed the fix was a documented hand-edit, which is exactly the kind of step a one-command
# setup is supposed to end.
#
# Target confinement follows the MCP hand's rule (#87 D1): the file is exactly
# `<resolved omp agent dir>/config.yml`, never a configurable path. `ENTWURF_OMP_AGENT_DIR`
# moves the agent dir and the target follows by construction.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PY="$HERE/omp-config-xdev.py"
STATE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf/omp-config"
STATE_FILE="$STATE_DIR/install-state.json"

log() { printf '%s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# shellcheck source=scripts/omp-bridge-oracle.sh
. "$HERE/omp-bridge-oracle.sh"

AGENT_DIR="$(omp_agent_dir)" || fail "the omp agent directory this host reads is ambiguous (see above) — refusing to write a config file omp may never read."
CONFIG="$AGENT_DIR/config.yml"

do_install() {
	log "[omp-config install]"
	log "  target:  $CONFIG"
	log "  setting: tools.xdev: false"
	log "  state:   $STATE_FILE"
	local out rc
	set +e
	out="$(python3 "$CONFIG_PY" install "$CONFIG" "$STATE_FILE" 2>&1)"
	rc=$?
	set -e
	case "$rc" in
		0) log "  ok: $out" ;;
		3) fail "refused (symlink) — $out" ;;
		4) fail "unreadable config — $out" ;;
		5) fail "refused (the operator set tools.xdev: true explicitly) — $out" ;;
		*) fail "install error (rc=$rc) — $out" ;;
	esac
	log "  installed. The runtime axis is verified by: ./run.sh doctor-omp-mcp"
	log "  NOTE: an omp session that is ALREADY OPEN keeps the tool surface it started with;"
	log "  restart it for the top-level tools to appear."
}

do_uninstall() {
	log "[omp-config uninstall]"
	local out rc
	set +e
	out="$(python3 "$CONFIG_PY" uninstall "$STATE_FILE" 2>&1)"
	rc=$?
	set -e
	case "$rc" in
		0) log "  ok: $out" ;;
		2) log "  note: $out" ;;
		3) fail "refused (symlink) — $out" ;;
		4) fail "invalid state — $out" ;;
		6) fail "refused (the config changed since install) — $out" ;;
		*) fail "uninstall error (rc=$rc) — $out" ;;
	esac
}

case "${1:-}" in
	install) do_install ;;
	uninstall) do_uninstall ;;
	*)
		echo "usage: omp-config-xdev.sh install | uninstall" >&2
		exit 2
		;;
esac
