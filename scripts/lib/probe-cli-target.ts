// §11-7-c CLI-target precondition seam (docs/acp-backend-rail.md).
//
// The B-name-snapshot oracle rides a probe-only shim at CLAUDE_CODE_EXECUTABLE,
// and the ONE way that override seam stays closed without duplicating upstream
// launch semantics is to narrow the precondition honestly instead of proving
// "operator override meaning is preserved" in general. Measured facts the
// narrowing rests on (installed dists, pinned by check-probe-ordering):
//
//   - `claudeCliPath()` returns an ambient CLAUDE_CODE_EXECUTABLE VERBATIM —
//     no resolution, no validation (acp-agent.js:204-207). Only with the env
//     unset does it resolve the platform native binary to an ABSOLUTE path.
//   - The SDK picks its launch branch off a pure suffix test: a path ending in
//     one of SDK_SCRIPT_SUFFIXES is run as `node|bun <path> <flags>`, anything
//     else is spawned DIRECTLY (sdk.mjs, claude-agent-sdk 0.3.219). The list
//     has live sharp edges (`.cjs` is absent), which is exactly why this repo
//     asserts against it instead of re-implementing it: a second copy of
//     upstream semantics is a drift channel, not a contract.
//
// So the probe REFUSES to run under an ambient override (a named precondition
// failure, not a fallback), resolves the target once in that ambient-clean
// state, and then only ASSERTS the result is the shape the native branch
// spawns directly. The asserts are a gate, never launch logic.

import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

/** The upstream executable-override env var this seam refuses to run under. */
export const AMBIENT_OVERRIDE_ENV = "CLAUDE_CODE_EXECUTABLE";

/** The SDK's script-branch suffix list — a path ending in one of these is run
 *  as `node|bun <path>`, anything else is spawned directly. PINNED against the
 *  installed sdk.mjs by check-probe-ordering; asserted here, never implemented:
 *  the probe refuses a script-suffixed target rather than reproducing the
 *  interpreter choice. */
export const SDK_SCRIPT_SUFFIXES = [".js", ".mjs", ".tsx", ".ts", ".jsx"] as const;

/** Env names the probe runner sets for the shim on the ACP child (the SDK's
 *  `{...process.env}` spread carries them into the CLI child's env, which is
 *  where the shim reads them). Single source — the shim, the runner, and the
 *  scrub list below must agree exactly. */
export const PROBE_SHIM_ENV = {
	/** Absolute native CLI path the shim must exec — resolved HERE, never by the shim. */
	target: "PROBE_SHIM_TARGET",
	/** The shared NDJSON event log path (same file every other writer appends to). */
	eventLog: "PROBE_SHIM_EVENT_LOG",
	/** The §11-7 runId the shim stamps on every event it writes. */
	runId: "PROBE_SHIM_RUN_ID",
} as const;

/** The EXACT allowlist of env vars the shim removes from the real CLI child's
 *  env before exec — the override itself plus every probe-private var, each by
 *  its literal name. Deliberately NOT a prefix/wildcard scrub: a pattern like
 *  `PROBE_*` would also delete operator env this probe has no claim on (GPT
 *  review 2026-07-29). Under the ambient-override refusal above, deletion is
 *  exact preservation — there is no prior operator value to restore. */
export const SHIM_SCRUB_ENV_VARS: ReadonlyArray<string> = [
	AMBIENT_OVERRIDE_ENV,
	PROBE_SHIM_ENV.target,
	PROBE_SHIM_ENV.eventLog,
	PROBE_SHIM_ENV.runId,
];

export type ProbeCliPreconditionReason =
	| "ambient-override-present"
	| "target-not-absolute"
	| "target-script-suffix"
	| "target-missing"
	| "target-not-regular-file"
	| "target-not-executable";

/** A named precondition failure — the P0-style refusal §11-7-c condition 1
 *  requires. Callers must surface `reason` on the artifact, never soften it
 *  into a fallback. */
export class ProbeCliPreconditionError extends Error {
	readonly reason: ProbeCliPreconditionReason;
	constructor(reason: ProbeCliPreconditionReason, message: string) {
		super(message);
		this.name = "ProbeCliPreconditionError";
		this.reason = reason;
	}
}

export interface ResolvedProbeCliTarget {
	path: string;
	sha256: string;
}

export function hashFileSha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Refuse if the given env carries the upstream override — KEY PRESENCE is the
 *  predicate, an empty string included. Upstream consumers disagree about
 *  empty (`??` at acp-agent.js:4083 treats "" as set and passes it on; a
 *  truthy check treats it as unset), and the probe refuses the ambiguity
 *  instead of picking a side. Used twice: on the runner's own process.env
 *  before resolving, and on the COMPOSED spawn env of every ACP child (adapter
 *  launch defaults / overlay overrides could inject what process.env did not
 *  carry). */
export function assertNoAmbientOverride(env: Record<string, string | undefined>, context: string): void {
	if (env[AMBIENT_OVERRIDE_ENV] !== undefined) {
		throw new ProbeCliPreconditionError(
			"ambient-override-present",
			`${AMBIENT_OVERRIDE_ENV}=${JSON.stringify(env[AMBIENT_OVERRIDE_ENV])} is present (${context}) — §11-7-c ` +
				"refuses to run under an ambient executable override, empty included: claudeCliPath() would return it " +
				"VERBATIM (relative paths, bare PATH commands and script overrides all change launch semantics), and " +
				"preserving arbitrary operator override shapes is explicitly out of probe scope. Unset it and re-run.",
		);
	}
}

/** Resolve the CLI target for the pair, under the §11-7-c precondition gate:
 *  ambient-clean env → upstream resolution → assert absolute ∧ native-branch ∧
 *  present → content hash. The resolver is injected so the deterministic gate
 *  can drive every refusal without touching the installed dist; the LIVE runner
 *  passes upstream `claudeCliPath` (a version-pinned deep import whose
 *  disappearance breaks check-probe-ordering, not a LIVE run). */
export async function resolveProbeCliTarget(opts: {
	env: Record<string, string | undefined>;
	resolveNative: () => Promise<string>;
}): Promise<ResolvedProbeCliTarget> {
	assertNoAmbientOverride(opts.env, "probe runner env");
	const path = await opts.resolveNative();
	if (!isAbsolute(path)) {
		throw new ProbeCliPreconditionError(
			"target-not-absolute",
			`resolved CLI target ${JSON.stringify(path)} is not an absolute path — a bare PATH command or relative ` +
				"path resolves against the SESSION cwd at spawn time (child_process.spawn semantics), which is " +
				"stimulus drift, not the pinned native binary",
		);
	}
	if (SDK_SCRIPT_SUFFIXES.some((s) => path.endsWith(s))) {
		throw new ProbeCliPreconditionError(
			"target-script-suffix",
			`resolved CLI target ${path} ends in a script suffix — the SDK would run it as \`node|bun <path>\`, a ` +
				"different launch branch than the direct spawn this seam is specified against; the probe asserts the " +
				"native branch instead of reproducing the interpreter choice",
		);
	}
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(path);
	} catch {
		throw new ProbeCliPreconditionError(
			"target-missing",
			`resolved CLI target ${path} does not exist — refusing before a LIVE turn spends money on a spawn error`,
		);
	}
	if (!stat.isFile()) {
		throw new ProbeCliPreconditionError(
			"target-not-regular-file",
			`resolved CLI target ${path} is not a regular file — a directory or special file cannot be the native binary`,
		);
	}
	try {
		accessSync(path, fsConstants.X_OK);
	} catch {
		throw new ProbeCliPreconditionError(
			"target-not-executable",
			`resolved CLI target ${path} is not executable (X_OK) — spawning it would fail after the pair started`,
		);
	}
	return { path, sha256: hashFileSha256(path) };
}
