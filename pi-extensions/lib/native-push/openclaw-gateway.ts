/**
 * native-push/openclaw-gateway — the OpenClaw receive adapter (#160 S2 card §4). Sibling → OpenClaw.
 *
 * Rail class native-push (Hard Rule 10): record + probe-alive, no mailbox, no receiver marker, no
 * resume authority. Both halves are the vendor's own CLI against the declared Gateway:
 *
 *  probe = `openclaw gateway call sessions.describe --json --expect-url <url> --params {"key":…}`
 *          `session` object for that key → alive; `{"session":null}` → dead; any non-zero exit,
 *          timeout, unparsable output or foreign key → indeterminate. `hasActiveRun` does not
 *          choose the path: one steer call covers idle and busy ([측정] S2 `R/s2-steer-live.txt`,
 *          `R/s2-steer-busy-live.txt`).
 *  send  = `openclaw gateway call chat.send --json --expect-url <url> --params
 *          {sessionKey, message, idempotencyKey:"entwurf-<uuid>", queueMode:"steer"}`
 *          success = exit 0 ∧ `status ∈ {started, ok}` ([측정] M5: a first ack is `started`, a
 *          dedupe ack is `ok`). Not retriable (Codex's conservative choice): the Gateway may have
 *          admitted the turn before a receipt failed.
 *
 * Authentication (GLG 2026-11-13, card §7-1): the Gateway's operator owns it inside OpenClaw's own
 * config. This adapter never reads, copies, relays or puts a credential on argv; the one constraint
 * it adds is `--expect-url`, which makes the vendor CLI fail when its resolved Gateway differs
 * ([측정] S3 `R/s3-probe-shape.txt`: mismatched url → exit 1, "Gateway destination changed").
 * A declared `configPath` is passed as `OPENCLAW_CONFIG_PATH` to that one invocation only.
 *
 * Address: the record's `nativeSessionId` (`openclaw:<scope>:<sessionKey>`) is parsed back, and the
 * Gateway url comes from the operator's scope declaration, re-read per probe. A record whose key
 * has left the declaration is NOT delivered to; it reports `indeterminate` (never `dead`: dead is
 * read as "provably departed" by the fresh-cut quiesce gate, and a scope change says nothing about
 * the session). The reason text names `openclaw-scope-not-declared`.
 *
 * argv boundary (review O9): the vendor CLI takes its params only as `--params <json>`, so the
 * rendered message body (≤16000 chars plus the envelope) rides one argv word and is visible to
 * same-host process listings for the life of the call. Credentials never do.
 *
 * Visibility is not delivery: the session lives in the Gateway whether or not a TUI shows it, so a
 * send may start a turn nobody watches. This adapter does not look at screens.
 *
 * Registration: `OpenclawRoute` is one member of `NativePushRoute`, and the production instance
 * (`openclawNativePushAdapter`) is in `adapter.ts`'s ADAPTERS, reading THIS host's declaration.
 */

import * as crypto from "node:crypto";

import {
	type OpenclawCitizensDeclaration,
	parseOpenclawNativeSessionId,
	selectOpenclawScope,
} from "../openclaw-citizens.ts";
import type { NativePushAdapter, NativePushRunner } from "./adapter.ts";

export const OPENCLAW_PROBE_TIMEOUT_MS = 15_000;
export const OPENCLAW_SEND_TIMEOUT_MS = 30_000;
/**
 * The send entry's worst path, which the plugin's process timeout must exceed (review D2): the
 * sender's replyable probe, the decider's target probe and one send, plus the entry's own startup
 * and store read. `plugins/openclaw/core.test.mjs` binds the plugin constant to this value.
 */
export const OPENCLAW_ENTRY_STARTUP_MARGIN_MS = 15_000;
export const OPENCLAW_SEND_ENTRY_WORST_MS =
	2 * OPENCLAW_PROBE_TIMEOUT_MS + OPENCLAW_SEND_TIMEOUT_MS + OPENCLAW_ENTRY_STARTUP_MARGIN_MS;
/** The vendor CLI, by its bare name on PATH (AGENTS.md tooling SSOT). */
export const OPENCLAW_BINARY = "openclaw";

export interface OpenclawRoute {
	readonly backend: "openclaw";
	readonly url: string;
	readonly configPath?: string;
	readonly sessionKey: string;
}

export interface OpenclawGatewayAdapterDeps {
	runner: NativePushRunner;
	/** The scope declaration, read at the moment of use. `null` = absent. May throw (broken). */
	readDeclaration: () => OpenclawCitizensDeclaration | null;
	binary?: string;
	/** Test seam for the idempotency key. */
	newIdempotencyKey?: () => string;
}

export function openclawDescribeArgv(binary: string, route: Omit<OpenclawRoute, "backend">): string[] {
	return [
		binary,
		"gateway",
		"call",
		"sessions.describe",
		"--json",
		"--expect-url",
		route.url,
		"--params",
		JSON.stringify({ key: route.sessionKey }),
	];
}

export function openclawChatSendArgv(
	binary: string,
	route: OpenclawRoute,
	content: string,
	idempotencyKey: string,
): string[] {
	return [
		binary,
		"gateway",
		"call",
		"chat.send",
		"--json",
		"--expect-url",
		route.url,
		"--params",
		JSON.stringify({ sessionKey: route.sessionKey, message: content, idempotencyKey, queueMode: "steer" }),
	];
}

function invocationEnv(route: { configPath?: string }): Record<string, string> | undefined {
	return route.configPath ? { OPENCLAW_CONFIG_PATH: route.configPath } : undefined;
}

function tail(s: string): string {
	const t = s.trim();
	return t.length > 400 ? `…${t.slice(-400)}` : t || "(empty)";
}

function parseJsonObject(stdout: string): Record<string, unknown> | null {
	try {
		const v: unknown = JSON.parse(stdout);
		return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Classify a `sessions.describe` result for `sessionKey`. Pure. */
export function classifyOpenclawDescribe(
	code: number,
	stdout: string,
	stderr: string,
	sessionKey: string,
): "alive" | { status: "dead" | "indeterminate"; reason: string } {
	if (code !== 0) {
		return {
			status: "indeterminate",
			reason: `sessions.describe exited ${code}: ${tail(stderr) !== "(empty)" ? tail(stderr) : tail(stdout)}`,
		};
	}
	const obj = parseJsonObject(stdout);
	if (!obj || !Object.hasOwn(obj, "session")) {
		return { status: "indeterminate", reason: `sessions.describe output is not {"session":…}: ${tail(stdout)}` };
	}
	if (obj.session === null) return { status: "dead", reason: `Gateway has no session ${sessionKey}` };
	const s = obj.session;
	if (typeof s !== "object" || Array.isArray(s) || (s as Record<string, unknown>).key !== sessionKey) {
		const key = typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>).key : undefined;
		return { status: "indeterminate", reason: `sessions.describe answered for another key (${JSON.stringify(key)})` };
	}
	// An archived session still describes as an object, but the Gateway refuses new work on it
	// ([측정] S4 `s4-raw/o3.txt`: describe `archived:true`; `chat.send queueMode:"steer"` → "Session … is
	// archived. Restore it before starting new work.", retryable false). Alive would make the sender
	// falsely replyable; dead would read as "provably departed" to the fresh-cut gate. Indeterminate.
	if ((s as Record<string, unknown>).archived === true) {
		return {
			status: "indeterminate",
			reason: `openclaw session ${sessionKey} is archived; the Gateway refuses new work on it`,
		};
	}
	return "alive";
}

/** Classify a `chat.send` result. Throws unless exit 0 with `status` started|ok. Pure. */
export function assertOpenclawChatSendAccepted(code: number, stdout: string, stderr: string): void {
	const obj = code === 0 ? parseJsonObject(stdout) : null;
	if (code === 0 && obj && (obj.status === "started" || obj.status === "ok")) return;
	throw new Error(
		`native-push send failed (openclaw chat.send exit ${code}): ${code === 0 ? tail(stdout) : `${tail(stderr)} ${tail(stdout)}`}`,
	);
}

export function createOpenclawGatewayAdapter(deps: OpenclawGatewayAdapterDeps): NativePushAdapter {
	const binary = deps.binary ?? OPENCLAW_BINARY;
	const newKey = deps.newIdempotencyKey ?? (() => `entwurf-${crypto.randomUUID()}`);
	return {
		id: "openclaw",
		retriable: false,

		async probe(nativeSessionId) {
			let id: ReturnType<typeof parseOpenclawNativeSessionId>;
			try {
				id = parseOpenclawNativeSessionId(nativeSessionId);
			} catch (err) {
				return { status: "indeterminate", reason: err instanceof Error ? err.message : String(err) };
			}
			// A BROKEN declaration throws by name here (Rule 15, remote-pair precedent) — it is an
			// operator defect, not an unestablished probe. The decider's throw propagates (no receipt:
			// `runEntwurfV2` wraps none), and the fresh-cut quiesce gate records a probe that could not
			// run as a violation (`meta-bridge-fresh-cut.ts` catch → fail-closed).
			const decl = deps.readDeclaration();
			if (decl === null) {
				return {
					status: "indeterminate",
					reason: `openclaw-scope-not-declared: no openclaw citizens declaration on this host for ${nativeSessionId}`,
				};
			}
			const picked = selectOpenclawScope(decl, id.scope, id.agentId, id.sessionKey);
			if (!("gateway" in picked)) {
				return { status: "indeterminate", reason: `${picked.reason}: ${picked.detail}` };
			}
			const route: OpenclawRoute = {
				backend: "openclaw",
				url: picked.gateway.url,
				...(picked.gateway.configPath ? { configPath: picked.gateway.configPath } : {}),
				sessionKey: id.sessionKey,
			};
			const r = await deps.runner.exec(openclawDescribeArgv(binary, route), {
				env: invocationEnv(route),
				timeoutMs: OPENCLAW_PROBE_TIMEOUT_MS,
			});
			const verdict = classifyOpenclawDescribe(r.code, r.stdout, r.stderr, route.sessionKey);
			return verdict === "alive" ? { status: "alive", route } : verdict;
		},

		async send(route, nativeSessionId, content) {
			if (route.backend !== "openclaw") throw new Error(`openclaw adapter received ${route.backend} route`);
			if (parseOpenclawNativeSessionId(nativeSessionId).sessionKey !== route.sessionKey) {
				throw new Error(`openclaw adapter: route key ${route.sessionKey} is not ${nativeSessionId}`);
			}
			const r = await deps.runner.exec(openclawChatSendArgv(binary, route, content, newKey()), {
				env: invocationEnv(route),
				timeoutMs: OPENCLAW_SEND_TIMEOUT_MS,
			});
			assertOpenclawChatSendAccepted(r.code, r.stdout, r.stderr);
		},
	};
}
