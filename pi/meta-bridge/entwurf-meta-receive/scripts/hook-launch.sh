#!/usr/bin/env bash
# hook-launch.sh — the single EXEC-FORM launch point for every meta-bridge hook.
#
# WHY THIS EXISTS (measured, #51 B/B2, 2026-07-22 — not inferred)
#
# Claude Code >= 2.1.217 supports the shell-less EXEC form: `command` is the
# executable and `args` is argv, each element substituted as a plain string, with
# no shell anywhere on the path. Measured at 2.1.217: a hook declared that way
# receives every `args` element verbatim (a literal `${HOME}` arrives LITERAL —
# nothing parsed it), and its process parent is the Claude process itself.
#
# An older Claude does NOT fail on the unknown key. Measured at 2.1.138: it drops
# the `args` array entirely, runs `command` alone through a shell, and then reports
# the hook as `exit_code: 0, outcome: "success"`. There is no diagnostic in stdout,
# stderr, the stream, or the result — upstream never tells anyone that half the
# hook's contract was discarded. A hook launched that way would look perfectly
# healthy while being structurally broken.
#
# So the fail-loud has to be ours. Every real payload arrives in ARGV; therefore
# an empty argv means the runtime dropped it, and that is a hard error, never a
# silent no-op. This is the launcher's whole job.
#
# WHY IT MUST BE THE LAST SHELL
#
# `exec "$@"` replaces this process image, so the payload keeps THIS pid and its
# parent remains Claude. That is what makes the owner join structural rather than
# a bet on whether some host's /bin/sh elides a trailing command — the bet #51
# lost when the same Claude version produced a direct join on one host and a
# retained `/bin/bash -c` wrapper on another. The `exec` here is unconditional and
# lives in a script WE ship with a shebang WE choose, so no host's shell selection
# or command-assembly heuristic can move it. `check-hook-launch-topology` drives
# this file for real and asserts the pid survives.
#
# Deliberately NOT done here: writing the hook log. That path is resolved by
# `defaultMetaSessionsDir()` (with two env overrides) and re-deriving it in bash
# would create a second source of truth for a path — the exact drift this repo
# keeps paying for. The durable fail-loud surface for an unsupported Claude is
# `doctor-meta-bridge`, which reads the real version and refuses it by contract.
set -uo pipefail

if [ "$#" -eq 0 ]; then
	cat >&2 <<-'LOUD'
		entwurf meta-bridge: this hook was launched with NO arguments.

		That means the Claude Code runtime discarded the hook's `args` array and ran
		`command` on its own. A Claude without exec-form support does this SILENTLY and
		still reports the hook as `exit_code: 0, outcome: success` (measured on 2.1.138),
		so nothing upstream will ever tell you.

		entwurf supports Claude Code >= 2.1.217 — the version whose runtime behavior was
		actually verified end to end. There is no shell-form fallback.

		Fix: update Claude Code, then re-run
		    ./run.sh install-meta-bridge && ./run.sh doctor-meta-bridge
	LOUD
	exit 1
fi

# EXEC-LAUNCH PROVENANCE. Not an identity carrier — it carries no pid and the hook does
# no ancestry work with it. It answers one question the pid cannot: "did this hook come
# through the authorized launch path at all?"
#
# The case it closes is the upgrade mismatch. A Claude session that is ALREADY OPEN holds
# the OLD cached hook command; after `install-meta-bridge` replaces the artifact, that
# live session keeps invoking the NEW hook through the OLD shell-form command. The hook's
# parent is then whatever that shell left behind — possibly a retained wrapper — and a
# hook that trusts `process.ppid` unconditionally would happily key a marker to it. The
# retired `$PPID` carrier used to fail closed here by being absent; deleting it without a
# replacement quietly reopened the hole (cross-review, 2026-07-22).
#
# So: only a hook reached THROUGH this launcher may write sender/receiver markers. A hook
# reached any other way still mints its meta-record (best-effort, as always) but writes no
# presence it cannot back, and logs ERROR for the doctor. That is why README can keep
# saying an old cached command fails closed.
export ENTWURF_META_HOOK_LAUNCH="hook-launch/v1"

exec "$@"
