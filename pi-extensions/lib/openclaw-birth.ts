/**
 * openclaw-birth — the ONE writer that turns a declared OpenClaw session into a V3 citizen
 * (#160 S2 card §1). Wrapped by `entwurf openclaw-birth --scope <s> --session-key <k> --cwd <abs>`.
 *
 * OpenClaw fires no hook at `sessions.create` (S1 M3 [측정]), so there is no lifecycle event to
 * hang birth on; this writer is invoked explicitly, by the operator for an existing fixed session
 * or by the fresh composition for a key it just created. The plugin and the send entry never write
 * a record: a session must be a citizen BEFORE it speaks, or it has no address to be answered at.
 *
 * Order (each step refuses by name, nothing written before the last):
 *  1. the key is inside the operator's scope declaration;
 *  2. the declared Gateway knows the key — the receive adapter's own `sessions.describe` probe,
 *     so birth and delivery read liveness through one surface (`alive` only; `dead` and
 *     `indeterminate` refuse);
 *  3. `upsert(openclaw:<scope>:<sessionKey>, cwd)` — idempotent by native id: a re-birth attaches
 *     to the existing garden id, never a new one (meta-session upsert, 3-value merge).
 *
 * cwd: an explicit absolute path, never inferred. [측정] S3 `R/s3-sessionroot-read.txt`: no read
 * RPC (`sessions.list`, `sessions.describe`, `sessions.resolve`) returns a session root; only the
 * `sessions.create` reply carries `entry.sessionRoot`. So an existing session's birth takes the
 * operator's `--cwd`, and the fresh composition passes the create reply's `entry.sessionRoot`
 * (coordinator decision 2026-11-13).
 *
 * `upsert` is injected so this decision stays testable without a store; production wiring
 * (`scripts/openclaw-birth.ts`) passes `upsertMetaSession({ backend: "openclaw", … })`.
 */

import * as path from "node:path";
import type { OpenclawDeskPin } from "./native-push/openclaw-gateway.ts";
import {
	checkOpenclawHome,
	composeOpenclawNativeSessionId,
	type OpenclawCitizensDeclaration,
	type OpenclawHomeRecord,
	parseOpenclawNativeSessionId,
	selectOpenclawScope,
} from "./openclaw-citizens.ts";

export interface OpenclawBirthInput {
	scope: string;
	sessionKey: string;
	cwd: string;
}

export interface OpenclawBirthDeps {
	readDeclaration: () => OpenclawCitizensDeclaration | null;
	/** The active records — including ones whose key has left the declaration (#160 S6 §7 (2)). */
	listIdentities: () => readonly OpenclawHomeRecord[];
	/** The receive adapter's probe; an alive answer carries the desk's pin verdict (`judgeOpenclawDeskPin`). */
	probe: (
		nativeSessionId: string,
	) => Promise<{ status: "alive"; deskPin: OpenclawDeskPin } | { status: "dead" | "indeterminate"; reason: string }>;
	upsert: (nativeSessionId: string, cwd: string) => { action: "create" | "attach"; gardenId: string };
}

export interface OpenclawBirthResult {
	action: "create" | "attach";
	gardenId: string;
	nativeSessionId: string;
	cwd: string;
}

export class OpenclawBirthError extends Error {}

export async function birthOpenclawCitizen(
	input: OpenclawBirthInput,
	deps: OpenclawBirthDeps,
): Promise<OpenclawBirthResult> {
	if (!path.isAbsolute(input.cwd) || path.normalize(input.cwd) !== input.cwd) {
		throw new OpenclawBirthError(`openclaw-birth: --cwd must be an absolute, normalized path (got ${input.cwd})`);
	}
	const m = /^agent:([^:]*):/.exec(input.sessionKey);
	if (!m) {
		throw new OpenclawBirthError(
			`openclaw-birth: session key must start with "agent:<agentId>:" (got ${input.sessionKey})`,
		);
	}
	// Composing validates scope/agentId/key grammar; the parse confirms the round trip.
	const nativeSessionId = composeOpenclawNativeSessionId(input.scope, m[1], input.sessionKey);
	const id = parseOpenclawNativeSessionId(nativeSessionId);

	const decl = deps.readDeclaration();
	if (decl === null) {
		throw new OpenclawBirthError(
			"openclaw-birth: openclaw-scope-not-declared: this host has no openclaw citizens declaration",
		);
	}
	const picked = selectOpenclawScope(decl, id.scope, id.agentId, id.sessionKey);
	if (!("gateway" in picked)) {
		throw new OpenclawBirthError(`openclaw-birth: ${picked.reason}: ${picked.detail}`);
	}

	// One home, one garden: the same key re-attaches; another key, or an ambiguous home, is refused
	// before the Gateway is asked and before anything is written.
	const home = checkOpenclawHome(deps.listIdentities(), id.scope, id.agentId, id.sessionKey);
	if (!("ok" in home)) {
		throw new OpenclawBirthError(`openclaw-birth: ${home.reason}: ${home.detail}; no record written`);
	}

	const probe = await deps.probe(nativeSessionId);
	if (probe.status !== "alive") {
		throw new OpenclawBirthError(
			`openclaw-birth: Gateway ${picked.gateway.url} does not confirm ${id.sessionKey} (${probe.status}: ${probe.reason}); no record written`,
		);
	}

	// The desk must be pinned (#160 S6 §1b, GLG): OpenClaw keeps a pinned session out of its
	// maintenance archive. This closes that one automatic archive path; it does not guarantee the
	// session against deletion, an unpin or another Gateway. The verdict is the adapter's one pin
	// judgment; an answer it cannot read as a pin is refused, never guessed.
	if (probe.deskPin === "unpinned") {
		throw new OpenclawBirthError(
			`openclaw-birth: openclaw-desk-not-pinned: ${id.sessionKey} is alive but not pinned on ${picked.gateway.url}; pin it first (sessions.patch {"key":…,"pinned":true}); no record written`,
		);
	}
	if (probe.deskPin !== "pinned") {
		throw new OpenclawBirthError(
			`openclaw-birth: openclaw-desk-pin-indeterminate: the describe of ${id.sessionKey} on ${picked.gateway.url} carries no boolean pinned; no record written`,
		);
	}

	const written = deps.upsert(nativeSessionId, input.cwd);
	return { action: written.action, gardenId: written.gardenId, nativeSessionId, cwd: input.cwd };
}
