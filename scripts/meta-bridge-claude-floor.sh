#!/usr/bin/env bash
# meta-bridge-claude-floor.sh — the ONE resolution + comparison of the Claude Code
# support floor, sourced by both the installer and the doctor.
#
# WHY A SHARED FILE (#51 policy A, 2026-07-22)
#
# The floor is a full three-part version, not a major lane: the discriminator sits
# in the PATCH position (2.1.138 drops `args`, 2.1.139 introduced the exec form,
# 2.1.217 is the version this repo actually proved in a live session). A major-only
# comparison like the Node floor's `-lt 24` cannot express it, so a real semver
# compare has to exist — and it must exist exactly ONCE. Two hand-rolled compares in
# two shell scripts is how "the installer blessed a version the doctor refuses"
# happens, which is this cut's own disease one layer down.
#
# The floor VALUE is likewise derived, never retyped: `package.json`
# `entwurf.claudeCodeFloor` is the SSOT and everything here reads it. There is one
# number to move. `check-claude-floor-coherence` binds every other spelling of it.
#
# WHY THE FLOOR IS 2.1.217 AND NOT 2.1.139
#
# 2.1.139 is where the exec-form strings enter the binary, but no session was ever
# run on it — the floor would have been an inference. 2.1.217 is the version whose
# runtime behavior was actually observed end to end (#51 B2: `args` honored per
# element, no shell on the launch path, `asyncRewake` exit 2 waking an idle session).
# GLG's decision (2026-07-22): Claude Code auto-updates, so entwurf does not carry
# back-compat for versions it never verified. Declare the proven floor, not the
# earliest plausible one.
#
# Requires: python3 (already a hard dependency of both callers).

# Print the floor SPEC (">=X.Y.Z") from the package.json SSOT. Fails loud: a missing
# field must not degrade into "no floor", which would silently bless every version.
claude_floor_spec() {
	python3 - "$1" <<-'PY'
		import json, sys
		from pathlib import Path
		pkg = json.loads(Path(sys.argv[1], "package.json").read_text(encoding="utf-8"))
		spec = (pkg.get("entwurf") or {}).get("claudeCodeFloor")
		if not isinstance(spec, str) or not spec.startswith(">="):
		    raise SystemExit("package.json entwurf.claudeCodeFloor missing or not a '>=X.Y.Z' spec")
		print(spec)
	PY
}

# Print the bare floor version ("X.Y.Z") for messages/comparison.
claude_floor_version() { claude_floor_spec "$1" | sed 's/^>=//'; }

# Print the running Claude CLI's version, or nothing if it cannot be read. Takes the
# first dotted triple in the output ("2.1.217 (Claude Code)" -> "2.1.217").
#
# Always return 0 with an empty result for a failed/unparseable probe. Both callers run
# under `set -euo pipefail` and intentionally diagnose that empty result themselves;
# propagating grep/Claude's nonzero status from a bare assignment would kill the caller
# before its fail-loud `NOT CERTIFIED` message. Read the whole output before matching —
# no `head` producer/consumer pipeline, so a verbose CLI cannot recreate the SIGPIPE
# false negative the installer/doctor already paid for in #51.
claude_detected_version() {
	local output
	if ! output="$(claude --version 2>/dev/null)"; then
		return 0
	fi
	# Parse the already-complete string in-process. There is no producer/consumer pipe
	# left to close early, no argv-size copy, and no parser subprocess that could hide
	# the caller's own diagnosis if it failed.
	if [[ "$output" =~ ([0-9]+\.[0-9]+\.[0-9]+) ]]; then
		printf '%s\n' "${BASH_REMATCH[1]}"
	fi
	return 0
}

# rc 0 iff $1 (detected) >= $2 (floor), comparing numerically component-wise. An
# unparseable version is NOT satisfied — fail closed, never bless the unknown.
claude_floor_satisfied() {
	python3 - "$1" "$2" <<-'PY'
		import sys
		def parts(v):
		    try:
		        return tuple(int(x) for x in v.split("."))
		    except Exception:
		        return None
		got, floor = parts(sys.argv[1]), parts(sys.argv[2])
		raise SystemExit(0 if got is not None and floor is not None and got >= floor else 1)
	PY
}
