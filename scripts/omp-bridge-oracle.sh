#!/usr/bin/env bash
# omp-bridge-oracle.sh — the ONE structural oracle for the OMP birth unit (#87).
# Sourced by the installer, the inverse and the doctor so "valid assembly", "valid
# ownership state" and "which agent dir does omp actually read" cannot mean three
# different things in three files.
#
# omp_agent_dir
#   Resolve the agent directory omp itself would read, or REFUSE. Prints the absolute
#   path on rc 0; prints the reason on stderr and returns rc 1 when the environment is
#   ambiguous. See the function header for why an inherited `PI_*` knob is a refusal
#   rather than a guess.
#
# omp_assembly_valid <asm-root> <unit-name>
#   rc 0 = the assembly is a complete unit (entry + lib + registry + package.json with
#   `type: module`); rc 1 with the first failing reason on stderr.
#
# omp_state_read <state_file> <unit_dir> <asm>
#   Fail-closed EXACT-schema reader for the ownership state — one validator for all
#   three surfaces. rc 0 prints `<unitVersion> <entryName>`; any missing/unknown key,
#   wrong type, empty string, relative path or constant drift is rc 1.
#
# Deliberately BOUNDED: environment, structure, one state schema. Records, markers and
# hook-log truth stay on the doctor's own axes.

# The vendor's own agent-dir resolution, reproduced only as far as this lane needs.
#
# `[source]` omp reads `PI_CONFIG_DIR` (default `.omp`) and `PI_CODING_AGENT_DIR`
# (`packages/utils/src/dirs.ts:23`, `:210`, `:358`), and selects a profile from
# `OMP_PROFILE` first, `PI_PROFILE` second (`dirs.ts:57`, `:85-91`), which moves the
# agent dir to `~/.omp/profiles/<name>/agent`.
#
# WHY A `PI_*` KNOB IS A REFUSAL AND NOT A LOOKUP (ledger M6). omp is a pi fork and kept
# pi's env vocabulary, so those three variables now steer TWO harnesses: entwurf's own pi
# rail sandboxes `PI_CODING_AGENT_DIR` (AGENTS.md Hard Rule 12) and omp reads the same
# name. A value in the installing shell therefore does not say WHICH harness it is
# addressing. Installing into a directory chosen by that guess is how an operator ends up
# with a unit no live omp reads, or a unit written into the pi rail's sandbox. `OMP_PROFILE`
# is omp's own name and is honoured; the pi-shaped names refuse, and `ENTWURF_OMP_AGENT_DIR`
# is the explicit override every gate and smoke passes.
omp_agent_dir() {
	if [ -n "${ENTWURF_OMP_AGENT_DIR:-}" ]; then
		python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$ENTWURF_OMP_AGENT_DIR"
		return 0
	fi
	if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
		echo "PI_CODING_AGENT_DIR is set ($PI_CODING_AGENT_DIR). omp reads it too (utils/src/dirs.ts:358), so it does not say whether it is addressing omp or entwurf's pi rail — refusing to guess. Unset it, or pass ENTWURF_OMP_AGENT_DIR explicitly." >&2
		return 1
	fi
	if [ -n "${PI_CONFIG_DIR:-}" ]; then
		echo "PI_CONFIG_DIR is set ($PI_CONFIG_DIR). It renames omp's whole config root (utils/src/dirs.ts:23, :210) and is a pi-shaped name — refusing to guess. Unset it, or pass ENTWURF_OMP_AGENT_DIR explicitly." >&2
		return 1
	fi
	if [ -n "${PI_PROFILE:-}" ] && [ -z "${OMP_PROFILE:-}" ]; then
		echo "PI_PROFILE is set ($PI_PROFILE) with no OMP_PROFILE. omp falls back to it (utils/src/dirs.ts:85-91) but so does pi — refusing to guess which harness this profile addresses. Set OMP_PROFILE explicitly, or pass ENTWURF_OMP_AGENT_DIR." >&2
		return 1
	fi
	local root="$HOME/.omp"
	if [ -n "${OMP_PROFILE:-}" ]; then
		case "$OMP_PROFILE" in
			[a-z0-9]*)
				case "$OMP_PROFILE" in
					*[!a-z0-9._-]*)
						echo "OMP_PROFILE '$OMP_PROFILE' is not a valid omp profile name (utils/src/dirs.ts PROFILE_NAME_RE)." >&2
						return 1 ;;
				esac
				root="$HOME/.omp/profiles/$OMP_PROFILE" ;;
			*)
				echo "OMP_PROFILE '$OMP_PROFILE' is not a valid omp profile name (utils/src/dirs.ts PROFILE_NAME_RE)." >&2
				return 1 ;;
		esac
	fi
	printf '%s\n' "$root/agent"
}

omp_assembly_valid() {
	local asm="$1" unit="$2"
	local dir="$asm/$unit"
	if [ ! -d "$dir" ]; then
		echo "assembly has no unit directory: $dir" >&2
		return 1
	fi
	local entry=""
	if [ -f "$dir/index.ts" ]; then entry="index.ts"; elif [ -f "$dir/index.js" ]; then entry="index.js"; fi
	if [ -z "$entry" ]; then
		echo "assembly has no index.ts/index.js entry: $dir (omp discovers a subdirectory extension by that name, discovery/helpers.ts:700-710)" >&2
		return 1
	fi
	local libext="ts"
	[ "$entry" = "index.js" ] && libext="js"
	for required in "package.json" "entwurf-capabilities.json" "lib/meta-session.$libext" "lib/session-id.js"; do
		if [ ! -f "$dir/$required" ]; then
			echo "assembly is missing $required: $dir/$required" >&2
			return 1
		fi
	done
	# `type: module` is not cosmetic on the installed-package shape: an ESM `index.js`
	# under a directory with no nearest package.json type field is read as CommonJS.
	if ! DIR_ENV="$dir" python3 - <<'PY'
import json, os, sys
pkg = json.load(open(os.path.join(os.environ["DIR_ENV"], "package.json")))
if pkg.get("type") != "module":
    print(f"assembly package.json type is {pkg.get('type')!r}, want the literal \"module\"", file=sys.stderr)
    sys.exit(1)
if not isinstance(pkg.get("version"), str) or not pkg["version"]:
    print("assembly package.json has no non-empty version", file=sys.stderr)
    sys.exit(1)
PY
	then
		return 1
	fi
	return 0
}

omp_state_read() {
	local state_file="$1" unit_dir="$2" asm="$3"
	STATE_FILE_ENV="$state_file" UNIT_DIR_ENV="$unit_dir" ASM_ENV="$asm" python3 - <<'PY'
import json, os, sys
try:
    state = json.load(open(os.environ["STATE_FILE_ENV"]))
except (OSError, json.JSONDecodeError) as err:
    print(f"state parse failed: {err}", file=sys.stderr)
    sys.exit(1)
EXACT_KEYS = {"schemaVersion", "unitDir", "assemblyPath", "unitVersion", "entryName", "ownedUnitDir", "installedAt"}
if not isinstance(state, dict) or set(state) != EXACT_KEYS:
    got = sorted(state) if isinstance(state, dict) else type(state).__name__
    print(f"state keyset drifted: {got} != {sorted(EXACT_KEYS)}", file=sys.stderr)
    sys.exit(1)
if state["schemaVersion"] != 1:
    print(f"state schemaVersion is {state['schemaVersion']!r}, want the literal 1", file=sys.stderr)
    sys.exit(1)
for key in ("unitDir", "assemblyPath", "unitVersion", "entryName", "installedAt"):
    if not isinstance(state[key], str) or not state[key]:
        print(f"state {key} must be a nonempty string, got {state[key]!r}", file=sys.stderr)
        sys.exit(1)
if any(ord(c) < 0x21 or ord(c) == 0x7f for c in state["unitVersion"]):
    print(f"state unitVersion contains whitespace/control characters: {state['unitVersion']!r} — "
          "the space-separated fact transport would truncate it into a fabricated version", file=sys.stderr)
    sys.exit(1)
if state["entryName"] not in ("index.ts", "index.js"):
    print(f"state entryName is {state['entryName']!r}, want index.ts or index.js", file=sys.stderr)
    sys.exit(1)
if not isinstance(state["ownedUnitDir"], bool):
    print(f"state ownedUnitDir must be a boolean, got {state['ownedUnitDir']!r} — flags are never coerced", file=sys.stderr)
    sys.exit(1)
for key, want in (("unitDir", os.environ["UNIT_DIR_ENV"]), ("assemblyPath", os.environ["ASM_ENV"])):
    if not os.path.isabs(state[key]):
        print(f"state {key} is not absolute: {state[key]!r}", file=sys.stderr)
        sys.exit(1)
    if os.path.abspath(state[key]) != os.path.abspath(want):
        print(f"state {key} names {state[key]!r}, not this installation's {want!r}", file=sys.stderr)
        sys.exit(1)
print(f"{state['unitVersion']} {state['entryName']}")
PY
}
