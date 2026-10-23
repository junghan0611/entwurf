/**
 * remote-pair-send — the SENDING half of the declared remote pairs (#107 rail 2a, #149 routes).
 *
 * It sits in front of the local v2 decider, at the surface. With no route declaration, or a target
 * no route names as remote, the local path runs unchanged. When a route names the target, any local
 * trace of that gid (a record entry in any state, or anything at its control socket path) fails
 * closed as an ambiguity before transport. Otherwise the call runs over one transport call: no
 * synthetic record, no new backend, no new rail plan, and no retry.
 *
 * Selection (#149): a route is one exact (local sender, remote target) pair. The route used is the
 * one whose two ends are the caller and the target; a target declared remote for some other sender
 * is refused, never sent under another route and never handed to the local path.
 *
 * Sender: only the caller's authoritative envelope becomes the claim. An anonymous envelope, or a
 * gid no route pairs with the target, is refused before transport. The model chooses neither host
 * nor command: both come from the operator's declaration.
 *
 * Remote command: ssh joins the remote words into one shell string. So the alias and the remote
 * declaration path are held to a narrow POSIX-safe charset that needs no quoting, and the command
 * is the fixed `entwurf remote-pair-receive --pair <path>`. There is no quoting engine here.
 *
 * Receipt: a result is decided only when the exit code and the one stdout JSON line agree
 * (see {@link classifyRemoteReceipt}). Everything else is `remote-indeterminate`: the other host
 * may or may not have enqueued. Read and answer stay unknown until a reply arrives.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { controlSocketPathIn } from "./control-socket-path.js";
import type { SenderEnvelope } from "./entwurf-control-rpc.ts";
import type { EntwurfV2SurfaceRendered, SurfaceEntwurfV2Params } from "./entwurf-v2-surface.ts";
import { defaultMetaSessionsDir, metaRecordExistsByGardenId, requireGardenId } from "./meta-session.ts";
import type { RemoteClaim, RemotePairRejectReason } from "./remote-pair-receive.ts";
import { inspectControlSocketPath } from "./socket-discovery.ts";

/** One declared route: an exact pair of a citizen on this host and one on another host. */
export interface RemoteRouteDeclaration {
	/** The target's garden id on the other host. */
	remoteGardenId: string;
	/** SSH alias for the other host (route label; never an identity). */
	ssh: string;
	/** The garden id on THIS host that may send to it. */
	localGardenId: string;
	/** Absolute path of the other host's pair declaration, passed to its receive entry. */
	remotePairFile: string;
}

export interface RemoteTransportResult {
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
}

export interface RemoteTransport {
	run(argv: readonly string[], stdin: string, timeoutMs: number): Promise<RemoteTransportResult>;
}

export type RemoteSendOutcome =
	| { kind: "remote-accepted"; text: string }
	| { kind: "remote-pair-refused"; reason: RemotePairRejectReason; detail: string }
	| { kind: "remote-reported-error"; text: string }
	| { kind: "remote-invalid"; detail: string }
	| { kind: "remote-indeterminate"; why: string; exitCode: number | null; stderrTail: string };

/** The operator's declaration file, as read: one or more routes. */
export interface RemotePairOptIn {
	routes: readonly RemoteRouteDeclaration[];
}

export class RemoteRouteDeclarationError extends Error {}

const SSH_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REMOTE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const CONNECT_TIMEOUT_SECONDS = 10;
export const REMOTE_SEND_TIMEOUT_MS = 30_000;
const PAIR_REJECT_REASONS: readonly string[] = ["remote-pair-from-mismatch", "remote-pair-target-mismatch"];

/** The one declaration version this reader accepts. The versionless single-pair form is refused. */
export const REMOTE_PAIR_DECLARATION_VERSION = 2;

function requireObject(raw: unknown, what: string): Record<string, unknown> {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new RemoteRouteDeclarationError(`${what}: must be a JSON object`);
	}
	return raw as Record<string, unknown>;
}

function requireKeys(obj: Record<string, unknown>, want: readonly string[], what: string): void {
	const got = Object.keys(obj).sort();
	if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
		throw new RemoteRouteDeclarationError(`${what}: keys must be exactly ${want.join(", ")} (got ${got.join(", ")})`);
	}
}

function parseRoute(raw: unknown, what: string): RemoteRouteDeclaration {
	const obj = requireObject(raw, what);
	requireKeys(obj, ["localGardenId", "remoteGardenId", "remotePairFile", "ssh"], what);
	const { ssh, remotePairFile } = obj;
	if (typeof ssh !== "string" || !SSH_ALIAS.test(ssh)) {
		throw new RemoteRouteDeclarationError(`${what}: "ssh" must be an alias matching ${SSH_ALIAS}`);
	}
	if (
		typeof remotePairFile !== "string" ||
		!REMOTE_PATH.test(remotePairFile) ||
		remotePairFile.split("/").includes("..")
	) {
		throw new RemoteRouteDeclarationError(
			`${what}: "remotePairFile" must be an absolute path matching ${REMOTE_PATH} with no ".." segment`,
		);
	}
	return {
		remoteGardenId: requireGardenId(obj.remoteGardenId),
		ssh,
		localGardenId: requireGardenId(obj.localGardenId),
		remotePairFile,
	};
}

/**
 * The set rules, decided on the whole file and independent of route order: nothing is chosen by
 * position. Legal repeats: one local gid paired with several remotes, one remote gid paired with
 * several locals, one alias carrying several routes. Refused: the same exact pair twice; a gid that
 * is local in one route and remote in another (including a route to itself); one remote gid reached
 * through two different aliases or files; one alias naming two different remote files, since the
 * receive entry on that host accepts only its one canonical file.
 */
function checkRouteSet(routes: readonly RemoteRouteDeclaration[], what: string): void {
	const locals = new Set(routes.map((r) => r.localGardenId));
	const pairs = new Set<string>();
	const remoteHost = new Map<string, RemoteRouteDeclaration>();
	const aliasFile = new Map<string, string>();
	routes.forEach((r, i) => {
		const at = `${what}: routes[${i}]`;
		const pair = `${r.localGardenId} -> ${r.remoteGardenId}`;
		if (pairs.has(pair)) {
			throw new RemoteRouteDeclarationError(`${at}: duplicate-pair: ${pair} is declared more than once`);
		}
		pairs.add(pair);
		if (locals.has(r.remoteGardenId)) {
			throw new RemoteRouteDeclarationError(
				`${at}: local-remote-overlap: ${r.remoteGardenId} is declared remote here and local in a route of this file`,
			);
		}
		const host = remoteHost.get(r.remoteGardenId);
		if (host && (host.ssh !== r.ssh || host.remotePairFile !== r.remotePairFile)) {
			throw new RemoteRouteDeclarationError(
				`${at}: remote-host-conflict: ${r.remoteGardenId} is declared via ${host.ssh} ${host.remotePairFile} and via ${r.ssh} ${r.remotePairFile}`,
			);
		}
		remoteHost.set(r.remoteGardenId, host ?? r);
		const file = aliasFile.get(r.ssh);
		if (file !== undefined && file !== r.remotePairFile) {
			throw new RemoteRouteDeclarationError(
				`${at}: alias-file-conflict: alias ${r.ssh} names both ${file} and ${r.remotePairFile}`,
			);
		}
		aliasFile.set(r.ssh, file ?? r.remotePairFile);
	});
}

export function parseRemotePairDeclaration(text: string): RemotePairOptIn {
	const what = "remote pair declaration";
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		throw new RemoteRouteDeclarationError(`${what}: not JSON (${err instanceof Error ? err.message : String(err)})`);
	}
	const obj = requireObject(raw, what);
	if (!Object.hasOwn(obj, "version")) {
		throw new RemoteRouteDeclarationError(
			`${what}: no "version" — the versionless single-pair form is no longer read. Rewrite it by hand as ` +
				`{"version":${REMOTE_PAIR_DECLARATION_VERSION},"routes":[<the four-key object>]} (setup §2c)`,
		);
	}
	requireKeys(obj, ["routes", "version"], what);
	if (obj.version !== REMOTE_PAIR_DECLARATION_VERSION) {
		throw new RemoteRouteDeclarationError(
			`${what}: "version" must be ${REMOTE_PAIR_DECLARATION_VERSION} (got ${JSON.stringify(obj.version)})`,
		);
	}
	if (!Array.isArray(obj.routes) || obj.routes.length === 0) {
		throw new RemoteRouteDeclarationError(`${what}: "routes" must be a non-empty array; remove the file to switch off`);
	}
	const routes = obj.routes.map((r, i) => parseRoute(r, `${what}: routes[${i}]`));
	checkRouteSet(routes, what);
	return { routes };
}

/** The one argv the transport runs. Every word is inside the no-quoting charset above. */
export function remoteReceiveArgv(route: RemoteRouteDeclaration): string[] {
	return [
		"ssh",
		"-o",
		"BatchMode=yes",
		"-o",
		`ConnectTimeout=${CONNECT_TIMEOUT_SECONDS}`,
		route.ssh,
		"entwurf",
		"remote-pair-receive",
		"--pair",
		route.remotePairFile,
	];
}

function tail(s: string): string {
	return s.length > 400 ? s.slice(-400) : s;
}

/**
 * Decide only on agreement. 0 + dispatched/!isError = accepted; 3 + rejected(pair reason) = pair
 * refused; 4 + dispatched/isError = the other host reported an error while processing (its own text
 * says what is known, e.g. `retry-safe: false` after a possible write; this line infers neither
 * delivery nor non-delivery); 2 + invalid = it refused our
 * input. Any other exit, a signal, a timeout, no line, more than one line, non-JSON, or a JSON
 * kind/field that disagrees with the exit is indeterminate.
 */
export function classifyRemoteReceipt(r: RemoteTransportResult): RemoteSendOutcome {
	const indeterminate = (why: string): RemoteSendOutcome => ({
		kind: "remote-indeterminate",
		why,
		exitCode: r.exitCode,
		stderrTail: tail(r.stderr),
	});
	if (r.timedOut) return indeterminate("timed out");
	if (r.signal !== null) return indeterminate(`ended by signal ${r.signal}`);
	if (r.exitCode === null) {
		return indeterminate(
			r.stderr.startsWith("spawn failed")
				? "the transport did not start (spawn failed)"
				: "did not exit (no exit code)",
		);
	}
	if (![0, 2, 3, 4].includes(r.exitCode)) return indeterminate(`exit ${r.exitCode}`);
	const nl = r.stdout.indexOf("\n");
	if (nl === -1 || nl !== r.stdout.length - 1) return indeterminate("stdout is not exactly one line");
	let j: unknown;
	try {
		j = JSON.parse(r.stdout);
	} catch {
		return indeterminate("stdout is not JSON");
	}
	if (j === null || typeof j !== "object" || Array.isArray(j)) return indeterminate("stdout is not a JSON object");
	const o = j as Record<string, unknown>;
	const keys = Object.keys(o).sort().join(",");
	if (r.exitCode === 0 && keys === "isError,kind,text" && o.kind === "dispatched" && o.isError === false) {
		if (typeof o.text === "string") return { kind: "remote-accepted", text: o.text };
	}
	if (r.exitCode === 4 && keys === "isError,kind,text" && o.kind === "dispatched" && o.isError === true) {
		if (typeof o.text === "string") return { kind: "remote-reported-error", text: o.text };
	}
	if (r.exitCode === 3 && keys === "detail,kind,reason" && o.kind === "rejected") {
		if (typeof o.reason === "string" && PAIR_REJECT_REASONS.includes(o.reason) && typeof o.detail === "string") {
			return { kind: "remote-pair-refused", reason: o.reason as RemotePairRejectReason, detail: o.detail };
		}
	}
	if (r.exitCode === 2 && keys === "detail,kind" && o.kind === "invalid" && typeof o.detail === "string") {
		return { kind: "remote-invalid", detail: o.detail };
	}
	return indeterminate(`exit ${r.exitCode} disagrees with its receipt`);
}

function render(route: RemoteRouteDeclaration, o: RemoteSendOutcome): EntwurfV2SurfaceRendered {
	const via = `via ${route.ssh}`;
	switch (o.kind) {
		case "remote-accepted":
			return {
				isError: false,
				text: `entwurf_v2 remote ${via} → accepted by the other host (its fact; read/answer unknown until a reply arrives; paths below are on the other host)\n${o.text}`,
			};
		case "remote-reported-error":
			// The other host's dispatch returned isError. That can follow a write (an enqueue whose
			// stamp or signal then threw is `retry-safe: false`), so this header claims neither
			// non-delivery nor safety to resend: the other host's own text below is the fact.
			return {
				isError: true,
				text: `entwurf_v2 remote ${via} → the other host reported an error while processing; read its receipt below, delivery is not inferred from this line; not retried (paths below are on the other host)\n${o.text}`,
			};
		case "remote-pair-refused":
			return {
				isError: true,
				text: `entwurf_v2 remote ${via} → refused by the other host's pair: ${o.reason} (${o.detail})`,
			};
		case "remote-invalid":
			return { isError: true, text: `entwurf_v2 remote ${via} → the other host refused the input: ${o.detail}` };
		case "remote-indeterminate":
			return {
				isError: true,
				text:
					`entwurf_v2 remote ${via} → indeterminate: ${o.why}. The other host may or may not have enqueued; ` +
					`not retried.${o.stderrTail ? `\n${o.stderrTail}` : ""}`,
			};
	}
}

function refuse(text: string): EntwurfV2SurfaceRendered {
	return { isError: true, text: `entwurf_v2 rejected: ${text}` };
}

export interface RemoteRouteOptions {
	senderProvider: () => SenderEnvelope | undefined;
	/** The declaration, already read; null = no remote pair on this host. */
	optIn: RemotePairOptIn | null;
	/** Any local trace of this gid: a record entry in any state, or anything at its socket path. */
	localTrace: (gardenId: string) => Promise<boolean>;
	transport: RemoteTransport;
	/** The existing local surface, run unchanged when the route does not apply. */
	runLocal: (
		params: SurfaceEntwurfV2Params,
		opts: { senderProvider: () => SenderEnvelope | undefined },
	) => Promise<EntwurfV2SurfaceRendered>;
	timeoutMs?: number;
}

export async function runEntwurfV2WithRemoteRoute(
	params: SurfaceEntwurfV2Params,
	opts: RemoteRouteOptions,
): Promise<EntwurfV2SurfaceRendered> {
	const declared = (opts.optIn?.routes ?? []).filter((r) => r.remoteGardenId === params.target);
	if (declared.length === 0) {
		return opts.runLocal(params, { senderProvider: opts.senderProvider });
	}
	// One remote gid has one alias and file (checkRouteSet), so any declared route names its host.
	const via = `via ${declared[0].ssh}`;
	if (await opts.localTrace(params.target)) {
		return refuse(
			`remote-route-local-conflict: ${params.target} is declared remote ${via} but this host also has a local trace of it; not choosing`,
		);
	}
	const sender = opts.senderProvider();
	const route =
		sender && sender.origin !== "external-mcp" ? declared.find((r) => r.localGardenId === sender.sessionId) : undefined;
	if (!sender || !route) {
		return refuse(
			`remote-sender-not-declared: only ${declared.map((r) => r.localGardenId).join(", ")} may send to ${params.target} ${via} (sender: ${sender ? sender.sessionId : "none"}); not sent, and not handed to the local path`,
		);
	}
	const claim: RemoteClaim = {
		from: sender.sessionId,
		fromAgentId: sender.agentId,
		fromCwd: sender.cwd,
		target: params.target,
		message: params.message,
		wantsReply: params.wants_reply ?? false,
	};
	const result = await opts.transport.run(
		remoteReceiveArgv(route),
		JSON.stringify(claim),
		opts.timeoutMs ?? REMOTE_SEND_TIMEOUT_MS,
	);
	return render(route, classifyRemoteReceipt(result));
}

/**
 * The production local-trace fact: the store's own record-entry inspection (absent vs anything
 * else — readable, unreadable, symlinked or drifted all count) and the control-socket path
 * inspection, in EVERY socket dir the caller names. The bridge's `ENTWURF_DIR` can differ from the
 * decider's canonical dir, so both are passed and a trace in either one means this host already
 * answers to the gid.
 */
export function makeLocalTraceFact(dirs: { sessionsDir: string; controlSocketDirs: readonly string[] }) {
	const socketDirs = [...new Set(dirs.controlSocketDirs.map((d) => path.resolve(d)))];
	return async (gardenId: string): Promise<boolean> => {
		if (metaRecordExistsByGardenId(gardenId, dirs.sessionsDir)) return true;
		for (const dir of socketDirs) {
			const inspection = await inspectControlSocketPath(controlSocketPathIn(dir, gardenId));
			if (inspection.kind !== "absent") return true;
		}
		return false;
	};
}

/** The operator's opt-in file name. One per host; it declares that host's remote routes. */
export const REMOTE_PAIR_OPT_IN_FILE = "entwurf-remote-pair.json";

/**
 * Where the opt-in file lives: beside the meta-record store, i.e. the pi agent dir unless an
 * `ENTWURF_META_SESSIONS_DIR` override relocates the store (then the file follows the store it
 * pairs). Read-only reuse of the existing root resolution; nothing here writes.
 */
export function remotePairOptInPath(): string {
	return path.join(path.dirname(defaultMetaSessionsDir()), REMOTE_PAIR_OPT_IN_FILE);
}

/**
 * Read the opt-in file once, at the moment of use (no cache). Absent is the ONLY "off". A
 * symlink, a non-regular entry, an unreadable file or an invalid declaration throws: the operator
 * opted in, so a broken opt-in is refused rather than read as off.
 *
 * The bridge this declares is the operator's to build and secure (for example a private network
 * such as Tailscale, plus SSH authentication and permissions). Entwurf only walks the declared
 * route: it installs, configures, discovers and verifies none of it, and never retries.
 */
export function readRemotePairOptIn(file: string): RemotePairOptIn | null {
	let st: fs.Stats;
	try {
		st = fs.lstatSync(file);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	if (!st.isFile()) {
		throw new RemoteRouteDeclarationError(`remote pair opt-in ${file} must be a regular non-symlink file`);
	}
	try {
		return parseRemotePairDeclaration(fs.readFileSync(file, "utf8"));
	} catch (err) {
		throw new RemoteRouteDeclarationError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
	}
}
