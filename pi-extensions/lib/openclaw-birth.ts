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
 * S3 flip boundary: `upsert` is injected because the record backend `openclaw` is not yet a
 * `MetaBackend`; production wiring (`upsertMetaSession({backend:"openclaw", …})`) is a flip line.
 */

import * as path from "node:path";
import {
	composeOpenclawNativeSessionId,
	type OpenclawCitizensDeclaration,
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
	probe: (
		nativeSessionId: string,
	) => Promise<{ status: "alive" } | { status: "dead" | "indeterminate"; reason: string }>;
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

	const probe = await deps.probe(nativeSessionId);
	if (probe.status !== "alive") {
		throw new OpenclawBirthError(
			`openclaw-birth: Gateway ${picked.gateway.url} does not confirm ${id.sessionKey} (${probe.status}: ${probe.reason}); no record written`,
		);
	}

	const written = deps.upsert(nativeSessionId, input.cwd);
	return { action: written.action, gardenId: written.gardenId, nativeSessionId, cwd: input.cwd };
}
