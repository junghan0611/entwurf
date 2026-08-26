#!/usr/bin/env bash
# copilot-bridge-oracle.sh — the ONE structural oracle for an assembled Copilot birth
# unit (#86 C3a). Sourced by the installer (adoption preflight) and the doctor
# (ownership axis) so "valid assembly" cannot mean two different things: a unit the
# doctor would flag must never be silently adopted as ours.
#
# copilot_assembly_valid <asm-root> <plugin-name>
#   rc 0  = the assembly at <asm-root> is a complete, baked unit
#   rc 1  = it is not; the first failing reason is printed to stderr
#
# copilot_state_read <state_file> <qualified> <mkt_name> <asm>
#   Fail-closed EXACT-schema reader for the ownership state — one validator for the
#   installer, the inverse and the doctor so "valid state" cannot drift into three
#   copies. rc 0 prints `<ownedMarketplace> <ownedAssembly> <pluginVersion>`; any
#   missing/unknown key, wrong type, empty string, relative assemblyPath, constant
#   drift or effective-ASM mismatch is rc 1 with the reason on stderr. Flags are never
#   coerced: a missing or non-boolean owned* refuses instead of defaulting to false.
#
# Deliberately BOUNDED: structure, one state schema, one list-row grammar. Registration,
# records, and hook-log truth stay with the doctor's own axes.
copilot_state_read() {
	local state_file="$1" qualified="$2" mkt="$3" asm="$4"
	STATE_FILE_ENV="$state_file" QUALIFIED_ENV="$qualified" MKT_ENV="$mkt" ASM_ENV="$asm" python3 - <<'PY'
import json, os, sys
try:
    state = json.load(open(os.environ["STATE_FILE_ENV"]))
except (OSError, json.JSONDecodeError) as err:
    print(f"state parse failed: {err}", file=sys.stderr)
    sys.exit(1)
EXACT_KEYS = {
    "schemaVersion", "qualifiedId", "marketplaceName", "assemblyPath",
    "pluginVersion", "ownedMarketplace", "ownedAssembly", "installedAt",
}
if not isinstance(state, dict) or set(state) != EXACT_KEYS:
    print(f"state keyset drifted: {sorted(state) if isinstance(state, dict) else type(state).__name__} != {sorted(EXACT_KEYS)}", file=sys.stderr)
    sys.exit(1)
if state["schemaVersion"] != 1:
    print(f"state schemaVersion is {state['schemaVersion']!r}, want the literal 1", file=sys.stderr)
    sys.exit(1)
for key in ("qualifiedId", "marketplaceName", "assemblyPath", "pluginVersion", "installedAt"):
    if not isinstance(state[key], str) or not state[key]:
        print(f"state {key} must be a nonempty string, got {state[key]!r}", file=sys.stderr)
        sys.exit(1)
for key in ("ownedMarketplace", "ownedAssembly"):
    if not isinstance(state[key], bool):
        print(f"state {key} must be a boolean, got {state[key]!r} — flags are never coerced", file=sys.stderr)
        sys.exit(1)
if not os.path.isabs(state["assemblyPath"]):
    print(f"state assemblyPath must be absolute, got {state['assemblyPath']!r}", file=sys.stderr)
    sys.exit(1)
for key, want in (("qualifiedId", os.environ["QUALIFIED_ENV"]), ("marketplaceName", os.environ["MKT_ENV"])):
    if state[key] != want:
        print(f"state {key} is {state[key]!r}, want {want!r}", file=sys.stderr)
        sys.exit(1)
if state["assemblyPath"] != os.path.abspath(os.environ["ASM_ENV"]):
    print(f"state assemblyPath is {state['assemblyPath']!r}, but this host's effective assembly is {os.path.abspath(os.environ['ASM_ENV'])!r}", file=sys.stderr)
    sys.exit(1)
print(f"{'true' if state['ownedMarketplace'] else 'false'} {'true' if state['ownedAssembly'] else 'false'} {state['pluginVersion']}")
PY
}

# copilot_exact_row_version <list-text> <qualified>
#   The finer read of the SAME row grammar (final amendment): reports whether the exact
#   QUALIFIED is absent, present exactly once with a parsed nonempty version, or in a
#   shape nobody may act on. rc 0 prints `absent` or `one <version>`; rc 1 with the
#   reason on stderr for a MALFORMED exact row (claims our qualified id but does not
#   parse as `<qualified> (v<nonempty>)`) or MULTIPLE exact rows. Longer tokens that
#   merely contain the qualified id remain foreign and are ignored, same as above.
copilot_exact_row_version() {
	local list_text="$1" qualified="$2"
	LIST_TEXT_ENV="$list_text" QUALIFIED_ENV="$qualified" python3 - <<'PY'
import os, sys
qualified = os.environ["QUALIFIED_ENV"]
versions = []
for raw in os.environ["LIST_TEXT_ENV"].splitlines():
    row = raw.strip()
    for glyph in ("•", "◆", "-"):
        if row.startswith(glyph):
            row = row[len(glyph):].strip()
    if row == qualified or (row.startswith(f"{qualified} ") and not row.startswith(f"{qualified} (v")):
        print(f"malformed exact row for {qualified}: {row!r} does not parse as '(v<version>)'", file=sys.stderr)
        sys.exit(1)
    if row.startswith(f"{qualified} (v") and row.endswith(")"):
        version = row[len(f"{qualified} (v"):-1]
        if not version:
            print(f"malformed exact row for {qualified}: empty version in {row!r}", file=sys.stderr)
            sys.exit(1)
        versions.append(version)
if len(versions) > 1:
    print(f"multiple exact rows for {qualified}: versions {versions} — nobody may act on an ambiguous listing", file=sys.stderr)
    sys.exit(1)
print(f"one {versions[0]}" if versions else "absent")
PY
}

copilot_assembly_valid() {
	local asm="$1" plugin="$2"
	local unit="$asm/$plugin"
	local launcher="$unit/scripts/copilot-hook-launch.sh"
	local hooks="$unit/hooks/hooks.json"
	[ -d "$unit" ] || { echo "structural oracle: unit dir missing: $unit" >&2; return 1; }
	[ -x "$launcher" ] || { echo "structural oracle: launcher missing or not executable: $launcher" >&2; return 1; }
	if grep -q "__NODE_BIN__\|__HOOK_ENTRY__" "$launcher"; then
		echo "structural oracle: launcher still carries an installer placeholder (unbaked): $launcher" >&2
		return 1
	fi
	local baked_node
	baked_node="$(sed -n 's/^NODE_BIN="\(.*\)"$/\1/p' "$launcher" | head -1)"
	[ -n "$baked_node" ] && [ -x "$baked_node" ] || {
		echo "structural oracle: baked node missing or not executable: ${baked_node:-(unparsed)}" >&2
		return 1
	}
	local baked_entry
	baked_entry="$(sed -n 's|^HOOK_ENTRY="\$PLUGIN_ROOT/\(.*\)"$|\1|p' "$launcher" | head -1)"
	[ -n "$baked_entry" ] && [ -f "$unit/$baked_entry" ] || {
		echo "structural oracle: hook entry missing beside the launcher: ${baked_entry:-(unparsed)}" >&2
		return 1
	}
	[ -f "$unit/entwurf-capabilities.json" ] || {
		echo "structural oracle: capability registry missing at the plugin root" >&2
		return 1
	}
	[ -f "$hooks" ] || { echo "structural oracle: hooks.json missing: $hooks" >&2; return 1; }
	if ! HOOKS_PATH="$hooks" ORACLE_LAUNCHER="$launcher" python3 - <<'PY'
import json, os, sys
from pathlib import Path
try:
    hooks = json.loads(Path(os.environ["HOOKS_PATH"]).read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as err:
    print(f"structural oracle: hooks.json unreadable: {err}", file=sys.stderr)
    sys.exit(1)
launcher = os.environ["ORACLE_LAUNCHER"]
if hooks.get("version") != 1:
    print("structural oracle: hooks.json version is not the literal 1", file=sys.stderr)
    sys.exit(1)
events = hooks.get("hooks") or {}
if set(events) != {"sessionStart", "userPromptSubmitted"}:
    print(f"structural oracle: hook events drifted: {sorted(events)}", file=sys.stderr)
    sys.exit(1)
for name, entries in events.items():
    for i, entry in enumerate(entries if isinstance(entries, list) else []):
        exec_value = entry.get("exec")
        if not isinstance(exec_value, str) or exec_value != launcher or "args" in entry:
            print(f"structural oracle: hooks.{name}[{i}] is not the baked exec-string form", file=sys.stderr)
            sys.exit(1)
sys.exit(0)
PY
	then
		return 1
	fi
	return 0
}
