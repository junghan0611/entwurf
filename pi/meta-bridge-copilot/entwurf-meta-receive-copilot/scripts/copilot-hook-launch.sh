#!/usr/bin/env bash
# copilot-hook-launch.sh — the single launch point for the Copilot birth hook (#82).
#
# WHY A SECOND LAUNCHER EXISTS (measured 2026-08-20, Copilot CLI 1.0.80)
#
# The Claude launcher `hook-launch.sh` refuses an EMPTY argv, on purpose: Claude
# Code 2.1.138 silently dropped the exec-form `args` array and still reported the
# hook as `exit_code: 0, outcome: success`, so an empty argv is the one detectable
# symptom of a runtime that discarded half the hook's contract.
#
# Copilot's hook schema has NO `args` KEY AT ALL. Its exec form is `exec`, a single
# string (`hooks.sessionStart[0].exec: Expected string` — an array is rejected at
# plugin load, before any prompt). So a Copilot hook ALWAYS arrives with argc=0, and
# routing it through the Claude launcher is precisely what happened until today: the
# hook fired, the launcher hit its no-argv refusal and exited 1 before node started,
# and Copilot held 0 of 409 meta-records. That refusal was correct for Claude and
# wrong for Copilot, which is why the two launchers are separate files and not one
# file with a flag.
#
# WHAT REPLACES THE ARGV CHECK. Nothing about identity travels in argv here — the
# session envelope arrives on STDIN and is read by the payload. What this launcher
# must prove instead is that it was BAKED: `__NODE_BIN__` is substituted by the
# installer, and an unsubstituted placeholder means the plugin was copied by hand or
# an install half-finished. That fails LOUD rather than exec'ing a path named after
# a placeholder.
#
# WHY IT STILL `exec`s. Same reason as the Claude launcher: `exec` replaces this
# process image, so the payload keeps THIS pid. Copilot's citizen writes no owner
# marker (there is no doorbell to arm, so no receiver to key), so the pid is not
# load-bearing for identity here — but keeping the topology identical means the two
# units cannot drift into two different process shapes, and a later delivery
# admission does not have to re-derive it.
#
# The payload is found by SELF-LOCATION (this script's own directory), not by a
# second baked path: the installer copies the entry to the plugin root exactly as it
# does for the Claude unit, so one baked value (node) is enough.
set -uo pipefail

NODE_BIN="__NODE_BIN__"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_ENTRY="$PLUGIN_ROOT/__HOOK_ENTRY__"

# The two comparison literals are SPLIT (`"__NODE_""BIN__"`) on purpose: the installer
# bakes by substituting the placeholder text everywhere in this file, and an unsplit
# literal here would be baked too — turning the guard into `baked = baked`, which is
# always true and would refuse every install. Do not "tidy" the quotes.
if [ "$NODE_BIN" = "__NODE_""BIN__" ] || [ "${HOOK_ENTRY##*/}" = "__HOOK_""ENTRY__" ]; then
	cat >&2 <<-'LOUD'
		entwurf meta-bridge (copilot): this launcher was never baked.

		`__NODE_BIN__` / `__HOOK_ENTRY__` are installer placeholders. Reaching them at
		runtime means the plugin directory was copied by hand, or an install did not
		finish. No record was written and this Copilot session is NOT a garden citizen.

		Fix: ./run.sh install-copilot-bridge && ./run.sh doctor-copilot-bridge
	LOUD
	exit 1
fi

if [ ! -x "$NODE_BIN" ]; then
	echo "entwurf meta-bridge (copilot): baked node is missing or not executable: $NODE_BIN" >&2
	exit 1
fi
if [ ! -f "$HOOK_ENTRY" ]; then
	echo "entwurf meta-bridge (copilot): hook entry missing beside this launcher: $HOOK_ENTRY" >&2
	exit 1
fi

# PROVENANCE. Same token the Claude unit stamps, so the payload can tell an
# authorized launch from a hand-invoked one. It carries no identity.
export ENTWURF_META_HOOK_LAUNCH="hook-launch/v1"

exec "$NODE_BIN" "$HOOK_ENTRY"
