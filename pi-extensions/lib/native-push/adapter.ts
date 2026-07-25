/**
 * native-push adapter rail — the transport LEAF by which a native-push backend
 * (antigravity, the first) is (1) probed for a LIVE conversation and (2) direct-injected
 * with a message. Mirrors the ACP backend-adapter rail (acp/backend-adapter.ts §ADAPTERS
 * /resolveAcpBackendAdapter): one interface, one registry, a fail-fast resolver.
 *
 * Purity contract (봉인 3):
 *  - LEAF: this file imports NO entwurf-core / no decider / no meta-session — only node
 *    builtins + type-only contract types. So the pi-free MCP bridge (entwurf_register_native)
 *    can reach it at boot without re-coupling to pi, and the decider stays pure.
 *  - injectable runner: every process call goes through the injected `NativePushRunner`,
 *    so `check-native-push-adapter` drives probe/send with a fake — no real agy needed.
 *  - VOLATILE route: a probe's `route` (the live LS address serving the conversation) is
 *    NEVER stored — every probe re-scans and re-discovers it (the LS port is per-process
 *    and shifts). `check-native-push-adapter` asserts a repeated probe re-runs the scan.
 *  - NO retry HERE: `send` is a single attempt that throws on failure. The 1-shot
 *    re-probe→re-send on failure is the EXECUTOR hand's job (step ⑥ — decider purity /
 *    control-socket send-fallback mirror), NOT the adapter's.
 *
 * The probe corrects raw-agy-send.sh:16's `pgrep -x agy | head -1` single-pid assumption:
 * it scans EVERY host pid, since the conversation may be served by any live host process.
 */

import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

import type { NativePushBackend } from "../entwurf-v2-contract.ts";

// ── runner seam (injectable process exec) ───────────────────────────────────

export interface NativePushExecResult {
	/** Exit code (0 = success). A spawn error (command not found) surfaces as 127. */
	code: number;
	stdout: string;
	stderr: string;
}

export interface NativePushRunner {
	/**
	 * Run `argv[0]` with `argv[1..]`, optionally with an env overlay merged over
	 * process.env and a `timeoutMs` bound. Resolves with the exit code + captured output; it
	 * NEVER rejects on a non-zero exit — a non-zero code is DATA the adapter interprets (e.g.
	 * "no live agy"), not an exception. A genuine spawn failure resolves with code 127; a
	 * timeout kill resolves with code 124 (the `timeout(1)` convention), so a stalled LS
	 * route / hung `agy agentapi` call can NEVER wedge an entwurf_v2 dispatch (Q12).
	 */
	exec(
		argv: readonly string[],
		opts?: { env?: Record<string, string>; timeoutMs?: number },
	): Promise<NativePushExecResult>;
}

// The agy agentapi calls are bounded so a dead/stalled LS route cannot hang a dispatch
// (raw-agy-send.sh used `timeout 8` — production had lost that; Q12 restores it). pgrep/ss
// are fast local scans and stay unbounded.
export const AGY_METADATA_TIMEOUT_MS = 8000;
export const AGY_SEND_TIMEOUT_MS = 8000;

/** The production runner — `execFile` (no shell), env overlay, bounded, output captured. */
export const realNativePushRunner: NativePushRunner = {
	exec(argv, opts) {
		return new Promise((resolve) => {
			const [cmd, ...args] = argv;
			execFile(
				cmd ?? "",
				args,
				{
					env: opts?.env ? { ...process.env, ...opts.env } : process.env,
					maxBuffer: 8 * 1024 * 1024,
					timeout: opts?.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 0,
				},
				(err, stdout, stderr) => {
					const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
					// A timeout kill surfaces as `killed` — map it to 124 (timeout convention) so
					// probe reads it as "no serve" (→ indeterminate) and send reads it as failure.
					const code = e == null ? 0 : e.killed ? 124 : typeof e.code === "number" ? (e.code as number) : 127;
					resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
				},
			);
		});
	},
};

// ── route + probe result ────────────────────────────────────────────────────

/**
 * A VOLATILE native-push route — the live LS address (`127.0.0.1:PORT`) a probe found
 * serving the conversation. MUST NOT be stored (봉인 3): it is re-derived every dispatch
 * by a fresh probe (the LS port is per-process and shifts). Carried only within a single
 * `send` call, handed straight from a fresh `probe`.
 */
export interface NativePushRoute {
	readonly lsAddress: string;
}

/**
 * A probe outcome. `alive` carries the volatile route; `dead`/`indeterminate` carry a
 * human reason. The three `status` values ARE the NativePushLiveness vocabulary, so the
 * decider maps `status` → dispatch verdict directly (no re-derivation).
 */
export type NativePushProbeResult =
	| { status: "alive"; route: NativePushRoute }
	| { status: "dead" | "indeterminate"; reason: string };

// ── the adapter interface ────────────────────────────────────────────────────

export interface NativePushAdapter {
	/** Backend discriminator (a member of NATIVE_PUSH_BACKENDS). */
	readonly id: NativePushBackend;
	/**
	 * Full-scan probe: find a LIVE route serving `nativeSessionId`, else report
	 * dead/indeterminate. Scans EVERY host pid (never `head -1`) and re-discovers the
	 * route on every call (no cache — volatile-route discipline, 봉인 3).
	 */
	probe(nativeSessionId: string): Promise<NativePushProbeResult>;
	/**
	 * Direct-inject `content` into the conversation over `route`. Single attempt: throws
	 * on failure (fail-loud). Does NOT probe and does NOT retry — the executor hand owns
	 * re-probe/retry (봉인 3), so the adapter can never silently paper over a dead route.
	 */
	send(route: NativePushRoute, nativeSessionId: string, content: string): Promise<void>;
}

// ── antigravity adapter ──────────────────────────────────────────────────────

export interface AntigravityAdapterDeps {
	runner: NativePushRunner;
	/** Resolved agy binary path (argv[0] for agentapi calls). Default: $AGY_BIN or ~/.local/bin/agy. */
	binary?: string;
	/** Host process name to scan for (`pgrep -x`). Default "agy". */
	processName?: string;
}

/** Resolve the agy binary — $AGY_BIN, else ~/.local/bin/agy (raw-agy-send.sh:14). */
export function resolveAgyBinary(): string {
	const env = process.env.AGY_BIN?.trim();
	if (env) return env;
	return path.join(os.homedir(), ".local", "bin", "agy");
}

/** Parse `ss -lntp` output into a pid → [127.0.0.1:PORT, …] map (localhost listeners). */
function parseSsListeners(ssStdout: string): Map<number, string[]> {
	const byPid = new Map<number, string[]>();
	for (const line of ssStdout.split("\n")) {
		const addr = line.match(/127\.0\.0\.1:([0-9]+)/);
		if (!addr) continue;
		// ss -lntp tags the owner as `pid=<n>,`; a line may carry several `pid=` when the
		// socket is shared, so collect them all.
		for (const m of line.matchAll(/pid=([0-9]+),/g)) {
			const pid = Number(m[1]);
			const list = byPid.get(pid) ?? [];
			list.push(`127.0.0.1:${addr[1]}`);
			byPid.set(pid, list);
		}
	}
	return byPid;
}

export function createAntigravityAdapter(deps: AntigravityAdapterDeps): NativePushAdapter {
	const { runner } = deps;
	const binary = deps.binary ?? resolveAgyBinary();
	const processName = deps.processName ?? "agy";

	/**
	 * ALL matching host pids (raw-agy-send.sh:16's `head -1` corrected here). Throws when
	 * the scan itself failed — the caller turns that into `indeterminate`.
	 *
	 * NOT EVERY NONZERO EXIT IS THE SAME ANSWER. pgrep(1): 0 = matched, **1 = no match**,
	 * 2 = usage error, 3 = fatal; the runner additionally reports a spawn failure (pgrep
	 * missing from PATH) as 127 and a timeout kill as 124. Folding all of those into "no
	 * matching process" made a BROKEN SCAN indistinguishable from a quiet host. That was
	 * survivable while the only consumer was a dispatch — a false `dead` merely refuses a
	 * delivery — but it is fail-OPEN the moment a destructive caller reads the same verdict
	 * as "provably hostless" and archives a live conversation's address (2026-07-25
	 * fresh-eyes review, on the fresh-cut quiesce gate).
	 */
	async function scanHostPids(): Promise<number[]> {
		const r = await runner.exec(["pgrep", "-x", processName]);
		if (r.code === 1) return []; // the ONE nonzero that means "no such process"
		if (r.code !== 0) {
			throw new Error(
				`\`pgrep -x ${processName}\` exited ${r.code} (${r.stderr.trim() || "no stderr"}) — the host scan FAILED, ` +
					"so whether a host process exists is unknown; that is not the same as pgrep's exit 1 (no match).",
			);
		}
		const pids = r.stdout
			.split("\n")
			.map((s) => s.trim())
			.filter((s) => /^[0-9]+$/.test(s))
			.map((s) => Number(s));
		// Exit 0 promises at least one match, so an empty parse means we misread the output
		// rather than that the host is gone.
		if (pids.length === 0) {
			throw new Error(
				`\`pgrep -x ${processName}\` exited 0 but named no parsable pid — the host scan output could not be read.`,
			);
		}
		return pids;
	}

	async function servesConversation(lsAddress: string, conversationId: string): Promise<boolean> {
		const r = await runner.exec([binary, "agentapi", "get-conversation-metadata", conversationId], {
			env: { ANTIGRAVITY_LS_ADDRESS: lsAddress },
			timeoutMs: AGY_METADATA_TIMEOUT_MS,
		});
		// A non-zero code — not-found, error, OR a timeout kill (124) — means this port does not
		// serve the conversation; the scan moves on (a timeout never blocks the whole probe).
		return r.code === 0 && r.stdout.includes("conversationMetadata");
	}

	return {
		id: "antigravity",

		async probe(nativeSessionId) {
			let pids: number[];
			try {
				pids = await scanHostPids();
			} catch (err) {
				// A scan we could not run is not a departed host. `indeterminate` is the honest
				// value and it already carries the right consequence on both rails: a dispatch
				// rejects as `native-push-probe-indeterminate`, and the fresh-cut quiesce gate
				// refuses the cut instead of archiving a maybe-live conversation.
				return {
					status: "indeterminate",
					reason: `host scan failed: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
			if (pids.length === 0) {
				return { status: "dead", reason: `no live ${processName} process (native-push target has no host)` };
			}
			// ONE ss scan per probe (re-derived every call — no cross-dispatch cache).
			const ss = await runner.exec(["ss", "-lntp"]);
			const portsByPid = ss.code === 0 ? parseSsListeners(ss.stdout) : new Map<number, string[]>();
			// Scan EVERY pid's ports — the conversation may be served by any live host, so a
			// head -1 single-pid assumption (raw-agy-send.sh:16) would misroute.
			for (const pid of pids) {
				for (const lsAddress of portsByPid.get(pid) ?? []) {
					if (await servesConversation(lsAddress, nativeSessionId)) {
						return { status: "alive", route: { lsAddress } };
					}
				}
			}
			// Host(s) alive but no LS port served this conversation: INDETERMINATE, not dead
			// (a WAL/loading race or a different host instance). Never coerce absence-of-proof
			// into `dead` — that would be a hard reject on a maybe-live conversation.
			return {
				status: "indeterminate",
				reason: `${processName} live (${pids.length} pid(s)) but no LS port served conversation ${nativeSessionId}`,
			};
		},

		async send(route, nativeSessionId, content) {
			const r = await runner.exec([binary, "agentapi", "send-message", nativeSessionId, content], {
				env: { ANTIGRAVITY_LS_ADDRESS: route.lsAddress },
				timeoutMs: AGY_SEND_TIMEOUT_MS,
			});
			// A non-zero code — including a timeout kill (124) on a stalled route — THROWS
			// (fail-loud); the executor hand owns the 1-shot re-probe→re-send on that throw.
			if (r.code !== 0) {
				throw new Error(
					`native-push send failed (agentapi send-message exit ${r.code}) via ${route.lsAddress}: ${
						r.stderr.trim() || "(no stderr)"
					}`,
				);
			}
		},
	};
}

/** The production antigravity adapter (real runner + env-resolved binary). */
export const antigravityAdapter: NativePushAdapter = createAntigravityAdapter({ runner: realNativePushRunner });

// ── registry + fail-fast resolver (mirror resolveAcpBackendAdapter) ──────────

const ADAPTERS: readonly NativePushAdapter[] = [antigravityAdapter];

/**
 * Resolve the native-push adapter that owns backend `id`. Fail-fast, like
 * resolveAcpBackendAdapter: 0 matches → throw (unknown backend, no silent default);
 * 2+ matches → throw (a startup-visible registry bug). A second native-push backend
 * appends to ADAPTERS with its own id and this proves no two adapters claim one id.
 */
export function resolveNativePushAdapter(id: string): NativePushAdapter {
	const matches = ADAPTERS.filter((a) => a.id === id);
	if (matches.length === 0) {
		throw new Error(`entwurf: no native-push adapter owns backend id ${JSON.stringify(id)}`);
	}
	if (matches.length > 1) {
		throw new Error(`entwurf: backend id ${JSON.stringify(id)} is claimed by multiple native-push adapters`);
	}
	return matches[0];
}
