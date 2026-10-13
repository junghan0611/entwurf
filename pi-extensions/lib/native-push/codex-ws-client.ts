import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

import type { NativePushBackend } from "../entwurf-v2-contract.js";

export interface CodexSocketEnv {
	HOME?: string;
	CODEX_HOME?: string;
}

export function resolveCodexHome(env: CodexSocketEnv): string {
	const explicit = env.CODEX_HOME?.trim();
	if (explicit) return explicit;
	const home = env.HOME?.trim();
	if (!home) throw new Error("codex app-server: neither CODEX_HOME nor HOME is available");
	return path.join(home, ".codex");
}

export function resolveCodexDefaultSocketPath(env: CodexSocketEnv): string {
	return path.join(resolveCodexHome(env), "app-server-control", "app-server-control.sock");
}

/**
 * What the advertised control-socket path is, and the one endpoint a caller may connect to.
 *
 * `connectPath` is a transport endpoint for one exchange: the socket this check verified. It is
 * not an address, a record field or a replacement for `resolveCodexDefaultSocketPath`. `dead`
 * names which absence it is, because the managed launcher treats them differently: an absent
 * path is a first launch, and a dangling rendezvous alias is the leftover of a crashed server
 * that the vendor removes on its next start.
 */
export type CodexSocketFileCheck =
	| { ok: true; connectPath: string }
	| { ok: false; status: "dead"; layout: "absent" | "dangling-alias"; reason: string }
	| { ok: false; status: "indeterminate"; reason: string };

/** Test seam only: the gate points these at a sandbox. Production callers pass nothing. */
export interface CodexSocketFileDeps {
	readonly daemonRoot?: string;
	readonly euid?: number;
}

/**
 * The advertised path is exactly one of two layouts, and anything else is refused.
 *
 * (A) A plain socket owned by the effective uid: Codex up to 0.153.4 binds the advertised
 *     path itself. `connectPath` is that path.
 * (B) Codex's rendezvous alias. From 0.162.1 the advertised path "is only an alias": the
 *     server binds a 0600 socket under `realpath(/tmp)/codex-daemon-<euid>/` named by the
 *     sha256 of the canonical advertised path, then symlinks the advertised path to it
 *     (`[source]` rust-v0.162.1 `app-server-transport/src/transport/unix_socket.rs:43-131,
 *     290-304`; `uds/src/daemon_directory.rs:1-38`). Upstream's reason is a privileged
 *     rendezvous root that sandboxes hide; the alias also keeps an over-long advertised path
 *     usable (`uds/src/lib.rs:167-174`). The alias is accepted only when every hop is the
 *     vendor's own: the link is owned by the effective uid; its target is BYTE-EQUAL to the
 *     path Codex derives (a relative, foreign, re-hashed or chained target is refused); the
 *     daemon directory is a real directory owned by the effective uid with `mode & 0o777`
 *     exactly 0700, the vendor's own rule; and the target is a socket owned by the effective
 *     uid that no group or other user can open. `connectPath` is the verified target, so the
 *     alias is never re-resolved between this check and the connect. A same-euid process can
 *     still replace the verified socket file itself; that residual is named, not locked.
 *
 * Only `lstat` and one `readlink` touch the alias; it is never followed or `realpath`ed.
 * The effective uid is the vendor's (`libc::geteuid`), not the real uid.
 */
export function checkCodexSocketFile(socketPath: string, deps: CodexSocketFileDeps = {}): CodexSocketFileCheck {
	const euid = deps.euid ?? process.geteuid?.();
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(socketPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return { ok: false, status: "dead", layout: "absent", reason: `app-server socket is absent: ${socketPath}` };
		}
		return { ok: false, status: "indeterminate", reason: error instanceof Error ? error.message : String(error) };
	}
	if (stat.isSymbolicLink()) return checkCodexRendezvousAlias(socketPath, stat, euid, deps);
	if (!stat.isSocket()) {
		return { ok: false, status: "indeterminate", reason: `app-server path is not a socket: ${socketPath}` };
	}
	if (euid !== undefined && stat.uid !== euid) {
		return {
			ok: false,
			status: "indeterminate",
			reason: `app-server socket is owned by uid ${stat.uid}, not the effective uid ${euid}`,
		};
	}
	return { ok: true, connectPath: socketPath };
}

function checkCodexRendezvousAlias(
	socketPath: string,
	link: fs.Stats,
	euid: number | undefined,
	deps: CodexSocketFileDeps,
): CodexSocketFileCheck {
	const refuse = (reason: string): CodexSocketFileCheck => ({ ok: false, status: "indeterminate", reason });
	if (euid === undefined) {
		return refuse(`app-server socket is a symlink and this platform has no effective uid to verify it: ${socketPath}`);
	}
	if (link.uid !== euid) {
		return refuse(`app-server socket symlink is owned by uid ${link.uid}, not the effective uid ${euid}`);
	}
	let daemonRoot: string;
	let expected: string;
	let target: string;
	try {
		daemonRoot = deps.daemonRoot ?? path.join(fs.realpathSync("/tmp"), `codex-daemon-${euid}`);
		const canonical = path.join(fs.realpathSync(path.dirname(socketPath)), path.basename(socketPath));
		expected = path.join(daemonRoot, crypto.createHash("sha256").update(canonical).digest("hex"));
		target = fs.readlinkSync(socketPath);
	} catch (error) {
		return refuse(
			`could not verify the app-server socket symlink ${socketPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (target !== expected) {
		return refuse(`app-server socket is a symlink that is not Codex's rendezvous alias: ${socketPath} -> ${target}`);
	}
	let directory: fs.Stats;
	try {
		directory = fs.lstatSync(daemonRoot);
	} catch (error) {
		return refuse(`Codex's socket directory cannot be read: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!directory.isDirectory() || directory.uid !== euid || (directory.mode & 0o777) !== 0o700) {
		return refuse(
			`Codex's socket directory ${daemonRoot} must be a real directory owned by uid ${euid} with mode 0700`,
		);
	}
	let physical: fs.Stats;
	try {
		physical = fs.lstatSync(expected);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				ok: false,
				status: "dead",
				layout: "dangling-alias",
				reason: `app-server socket is a dangling rendezvous alias: ${socketPath} -> ${expected}`,
			};
		}
		return refuse(error instanceof Error ? error.message : String(error));
	}
	if (!physical.isSocket() || physical.uid !== euid || (physical.mode & 0o077) !== 0) {
		return refuse(
			`Codex's physical socket ${expected} must be a socket owned by uid ${euid} that no group or other user can open`,
		);
	}
	return { ok: true, connectPath: expected };
}

export interface CodexRpcProtocol {
	request(method: string, params: Record<string, unknown>): Promise<unknown>;
	notify(method: string, params?: Record<string, unknown>): void;
	close(): void;
}

export interface CodexProtocolOpener {
	open(socketPath: string): Promise<CodexRpcProtocol>;
}

function promiseResolvers<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	return (
		Promise as unknown as {
			withResolvers<U>(): {
				promise: Promise<U>;
				resolve: (value: U | PromiseLike<U>) => void;
				reject: (reason?: unknown) => void;
			};
		}
	).withResolvers<T>();
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_MESSAGE_BYTES = 1024 * 1024;

function clientFrame(opcode: number, payload: Buffer): Buffer {
	const mask = crypto.randomBytes(4);
	let header: Buffer;
	if (payload.length < 126) {
		header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
	} else if (payload.length <= 0xffff) {
		header = Buffer.allocUnsafe(4);
		header[0] = 0x80 | opcode;
		header[1] = 0x80 | 126;
		header.writeUInt16BE(payload.length, 2);
	} else {
		header = Buffer.allocUnsafe(10);
		header[0] = 0x80 | opcode;
		header[1] = 0x80 | 127;
		header.writeBigUInt64BE(BigInt(payload.length), 2);
	}
	const masked = Buffer.allocUnsafe(payload.length);
	for (let index = 0; index < payload.length; index++) masked[index] = payload[index]! ^ mask[index % 4]!;
	return Buffer.concat([header, mask, masked]);
}

class CodexWebSocketRpc implements CodexRpcProtocol {
	private nextId = 1;
	private buffer = Buffer.alloc(0);
	private fragmentOpcode: number | null = null;
	private fragments: Buffer[] = [];
	private fragmentBytes = 0;
	private terminalError: Error | null = null;
	private readonly pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
	>();

	private readonly socket: net.Socket;

	private constructor(socket: net.Socket) {
		this.socket = socket;
		socket.on("data", (chunk) => this.feed(chunk));
		socket.on("error", (error) => this.failAll(error));
		socket.on("close", () => this.failAll(new Error("codex app-server WebSocket closed")));
	}

	static open(socketPath: string): Promise<CodexWebSocketRpc> {
		const { promise, resolve, reject } = promiseResolvers<CodexWebSocketRpc>();
		const socket = net.createConnection(socketPath);
		const key = crypto.randomBytes(16).toString("base64");
		const expectedAccept = crypto
			.createHash("sha1")
			.update(key + WS_GUID)
			.digest("base64");
		let header = Buffer.alloc(0);
		const timer = setTimeout(() => {
			const error = Object.assign(new Error("codex app-server WebSocket handshake timed out"), { code: "ETIMEDOUT" });
			socket.destroy(error);
		}, REQUEST_TIMEOUT_MS);
		const onError = (error: Error): void => {
			clearTimeout(timer);
			reject(error);
		};
		const onData = (chunk: Buffer): void => {
			header = Buffer.concat([header, chunk]);
			if (header.length > 16 * 1024) {
				socket.destroy(new Error("codex app-server WebSocket handshake exceeded 16 KiB"));
				return;
			}
			const boundary = header.indexOf("\r\n\r\n");
			if (boundary < 0) return;
			clearTimeout(timer);
			const lines = header.subarray(0, boundary).toString("utf8").split("\r\n");
			const headers = new Map<string, string>();
			for (const line of lines.slice(1)) {
				const colon = line.indexOf(":");
				if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
			}
			if (lines[0] !== "HTTP/1.1 101 Switching Protocols" || headers.get("sec-websocket-accept") !== expectedAccept) {
				socket.destroy(new Error("codex app-server refused the WebSocket upgrade"));
				return;
			}
			socket.off("error", onError);
			socket.off("data", onData);
			const rpc = new CodexWebSocketRpc(socket);
			const remainder = header.subarray(boundary + 4);
			if (remainder.length > 0) rpc.feed(remainder);
			resolve(rpc);
		};
		socket.once("error", onError);
		socket.on("data", onData);
		socket.once("connect", () => {
			socket.write(
				`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
			);
		});
		return promise;
	}

	request(method: string, params: Record<string, unknown>): Promise<unknown> {
		if (this.terminalError) return Promise.reject(this.terminalError);
		const id = this.nextId++;
		const { promise, resolve, reject } = promiseResolvers<unknown>();
		const timer = setTimeout(() => {
			this.pending.delete(id);
			reject(new Error(`codex app-server request timed out: ${method}`));
		}, REQUEST_TIMEOUT_MS);
		this.pending.set(id, { resolve, reject, timer });
		this.socket.write(clientFrame(0x1, Buffer.from(JSON.stringify({ id, method, params }))));
		return promise;
	}

	notify(method: string, params: Record<string, unknown> = {}): void {
		if (this.terminalError) return;
		this.socket.write(clientFrame(0x1, Buffer.from(JSON.stringify({ method, params }))));
	}

	close(): void {
		if (!this.socket.destroyed) this.socket.destroy();
	}

	private feed(chunk: Buffer): void {
		if (this.terminalError) return;
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (!this.terminalError && this.takeFrame()) {
			// Drain every complete frame already buffered.
		}
	}

	private takeFrame(): boolean {
		if (this.buffer.length < 2) return false;
		const first = this.buffer[0]!;
		const second = this.buffer[1]!;
		if ((second & 0x80) !== 0) return this.protocolFailure("server sent a masked WebSocket frame");
		let length = second & 0x7f;
		let offset = 2;
		if (length === 126) {
			if (this.buffer.length < 4) return false;
			length = this.buffer.readUInt16BE(2);
			offset = 4;
		} else if (length === 127) {
			if (this.buffer.length < 10) return false;
			const wide = this.buffer.readBigUInt64BE(2);
			if (wide > BigInt(MAX_MESSAGE_BYTES)) return this.protocolFailure("WebSocket frame exceeds 1 MiB");
			length = Number(wide);
			offset = 10;
		}
		if (length > MAX_MESSAGE_BYTES) return this.protocolFailure("WebSocket frame exceeds 1 MiB");
		if (this.buffer.length < offset + length) return false;
		const payload = this.buffer.subarray(offset, offset + length);
		this.buffer = this.buffer.subarray(offset + length);
		const opcode = first & 0x0f;
		const final = (first & 0x80) !== 0;
		if (opcode === 0x9) {
			this.socket.write(clientFrame(0xa, payload));
			return true;
		}
		if (opcode === 0x8) return this.protocolFailure("codex app-server closed the WebSocket");
		if (opcode === 0x1 && final) return this.receiveJson(payload);
		if (opcode === 0x1 && !final && this.fragmentOpcode === null) {
			this.fragmentOpcode = opcode;
			this.fragments = [payload];
			this.fragmentBytes = payload.length;
			return true;
		}
		if (opcode === 0x0 && this.fragmentOpcode === 0x1) {
			this.fragmentBytes += payload.length;
			if (this.fragmentBytes > MAX_MESSAGE_BYTES) return this.protocolFailure("fragmented message exceeds 1 MiB");
			this.fragments.push(payload);
			if (final) {
				const message = Buffer.concat(this.fragments, this.fragmentBytes);
				this.fragmentOpcode = null;
				this.fragments = [];
				this.fragmentBytes = 0;
				return this.receiveJson(message);
			}
			return true;
		}
		return this.protocolFailure(`unsupported WebSocket opcode ${opcode}`);
	}

	private receiveJson(payload: Buffer): boolean {
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload.toString("utf8"));
		} catch {
			return this.protocolFailure("codex app-server returned invalid JSON");
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return this.protocolFailure("codex app-server returned a non-object JSON message");
		const message = parsed as { id?: unknown; result?: unknown; error?: unknown };
		if (typeof message.id !== "number") return true;
		const entry = this.pending.get(message.id);
		if (!entry) return true;
		clearTimeout(entry.timer);
		this.pending.delete(message.id);
		if (message.error !== undefined)
			entry.reject(new Error(`codex app-server error: ${JSON.stringify(message.error)}`));
		else entry.resolve(message.result);
		return true;
	}

	private protocolFailure(message: string): false {
		if (this.terminalError) return false;
		const error = new Error(message);
		this.terminalError = error;
		this.buffer = Buffer.alloc(0);
		this.fragmentOpcode = null;
		this.fragments = [];
		this.fragmentBytes = 0;
		this.failAll(error);
		if (!this.socket.destroyed) this.socket.destroy(error);
		return false;
	}

	private failAll(error: Error): void {
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(error);
		}
		this.pending.clear();
	}
}

export const realCodexProtocolOpener: CodexProtocolOpener = {
	open: (socketPath) => CodexWebSocketRpc.open(socketPath),
};

const CODEX_CLIENT_INFO = { name: "entwurf-native-push/codex", title: "entwurf-native-push/codex", version: "0" };

async function initialize(protocol: CodexRpcProtocol): Promise<void> {
	await protocol.request("initialize", {
		clientInfo: CODEX_CLIENT_INFO,
		capabilities: { experimentalApi: true, requestAttestation: false },
	});
	protocol.notify("initialized");
}

export interface CodexRoute {
	readonly backend: "codex";
	/** The endpoint `checkCodexSocketFile` verified for this probe, which the send also uses. Not an address. */
	readonly socketPath: string;
}

export type CodexProbeResult =
	| { status: "alive"; route: CodexRoute }
	| { status: "dead" | "indeterminate"; reason: string };

export interface CodexExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface CodexExecRunner {
	exec(argv: readonly string[], timeoutMs: number): Promise<CodexExecResult>;
}

const realCodexExecRunner: CodexExecRunner = {
	exec(argv, timeoutMs) {
		const { promise, resolve } = promiseResolvers<CodexExecResult>();
		const [command, ...args] = argv;
		execFile(command ?? "", args, { maxBuffer: MAX_MESSAGE_BYTES, timeout: timeoutMs }, (error, stdout, stderr) => {
			const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
			resolve({
				code: failure == null ? 0 : failure.killed ? 124 : typeof failure.code === "number" ? failure.code : 127,
				stdout: stdout ?? "",
				stderr: stderr ?? "",
			});
		});
		return promise;
	},
};

export interface CodexAdapterDeps {
	env?: CodexSocketEnv;
	openProtocol?: CodexProtocolOpener;
	checkSocket?: (socketPath: string) => CodexSocketFileCheck;
	runner?: CodexExecRunner;
}

export async function probeCodexThread(
	nativeSessionId: string,
	deps: CodexAdapterDeps = {},
): Promise<CodexProbeResult> {
	const socketCheck = (deps.checkSocket ?? checkCodexSocketFile)(
		resolveCodexDefaultSocketPath(deps.env ?? process.env),
	);
	if (!socketCheck.ok) return { status: socketCheck.status, reason: socketCheck.reason };
	// The probe, and the queue send its route carries, both use the endpoint just verified. The
	// advertised path is not resolved again: on 0.162.1 it is an alias that could be retargeted
	// between the check and a second transport.
	const socketPath = socketCheck.connectPath;
	let protocol: CodexRpcProtocol;
	try {
		protocol = await (deps.openProtocol ?? realCodexProtocolOpener).open(socketPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return {
			status: code === "ENOENT" || code === "ECONNREFUSED" ? "dead" : "indeterminate",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	try {
		await initialize(protocol);
		let cursor: string | undefined;
		for (let page = 0; page < 64; page++) {
			const result = (await protocol.request("thread/loaded/list", cursor ? { cursor } : {})) as {
				data?: unknown;
				nextCursor?: unknown;
			};
			if (!Array.isArray(result?.data) || !result.data.every((item) => typeof item === "string")) {
				throw new Error("codex app-server returned an invalid thread/loaded/list page");
			}
			if (result.data.includes(nativeSessionId)) return { status: "alive", route: { backend: "codex", socketPath } };
			if (result.nextCursor == null)
				return { status: "dead", reason: `Codex app-server has no loaded thread ${nativeSessionId}` };
			if (typeof result.nextCursor !== "string" || result.nextCursor === cursor) {
				throw new Error("codex app-server returned a non-advancing thread cursor");
			}
			cursor = result.nextCursor;
		}
		return { status: "indeterminate", reason: "Codex loaded-thread inventory exceeded 64 pages" };
	} catch (error) {
		return { status: "indeterminate", reason: error instanceof Error ? error.message : String(error) };
	} finally {
		protocol.close();
	}
}

const QUEUE_TIMEOUT_MS = 8_000;
const QUEUE_ACK = /^Queued message (\S+) for thread (\S+)\.$/;

export async function sendViaCodexQueue(
	route: CodexRoute,
	nativeSessionId: string,
	content: string,
	runner: CodexExecRunner = realCodexExecRunner,
): Promise<void> {
	const result = await runner.exec(
		["codex", "queue", "--remote", `unix://${route.socketPath}`, "--thread", nativeSessionId, "--message", content],
		QUEUE_TIMEOUT_MS,
	);
	if (result.code !== 0) {
		throw new Error(
			`codex queue exited ${result.code}: ${result.stderr.trim() || result.stdout.trim() || "no output"}`,
		);
	}
	const match = QUEUE_ACK.exec(result.stdout.trim());
	if (!match || match[2] !== nativeSessionId) {
		throw new Error(`codex queue returned an invalid acknowledgement: ${JSON.stringify(result.stdout.trim())}`);
	}
}

export async function setCodexThreadName(
	socketPath: string,
	threadId: string,
	name: string,
	opener: CodexProtocolOpener = realCodexProtocolOpener,
): Promise<void> {
	const protocol = await opener.open(socketPath);
	try {
		await initialize(protocol);
		const result = await protocol.request("thread/name/set", { threadId, name });
		if (result == null || typeof result !== "object" || Array.isArray(result) || Object.keys(result).length !== 0) {
			throw new Error(
				`codex app-server returned an invalid thread/name/set acknowledgement: ${JSON.stringify(result)}`,
			);
		}
	} finally {
		protocol.close();
	}
}

export interface CodexThreadItem {
	type?: string;
	tool?: string;
	server?: string;
	result?: { content?: unknown[] } | null;
}

export interface CodexThreadView {
	id?: string;
	name?: string | null;
	turns?: Array<{ items?: CodexThreadItem[] }>;
}

/**
 * Read one thread's app-server view. `[source]` rust-v0.153.4
 * `app-server-protocol/src/protocol/v2/thread.rs:1656-1671` — params `{ threadId, includeTurns? }`,
 * response `{ thread: Thread }`; `thread_data.rs:203-281` — `name: Option<String>` is the visible
 * title this unit arms at birth, and `turns` is populated ONLY when `includeTurns` is true.
 *
 * This is a READ, so it is not part of the delivery rail: it carries no retry and no liveness
 * meaning. `probeCodexThread` remains the only reachability answer.
 */
export async function readCodexThread(
	socketPath: string,
	threadId: string,
	includeTurns = false,
	opener: CodexProtocolOpener = realCodexProtocolOpener,
): Promise<CodexThreadView> {
	const protocol = await opener.open(socketPath);
	try {
		await initialize(protocol);
		const result = (await protocol.request("thread/read", { threadId, includeTurns })) as {
			thread?: unknown;
		} | null;
		const thread = result?.thread;
		if (thread == null || typeof thread !== "object" || Array.isArray(thread)) {
			throw new Error(`codex app-server returned an invalid thread/read response: ${JSON.stringify(result)}`);
		}
		return thread as CodexThreadView;
	} finally {
		protocol.close();
	}
}

export interface CodexNativePushAdapter {
	readonly id: NativePushBackend;
	readonly retriable: false;
	probe(nativeSessionId: string): Promise<CodexProbeResult>;
	send(route: CodexRoute, nativeSessionId: string, content: string): Promise<void>;
}

export function createCodexNativePushAdapter(deps: CodexAdapterDeps = {}): CodexNativePushAdapter {
	return {
		id: "codex",
		retriable: false,
		probe: (nativeSessionId) => probeCodexThread(nativeSessionId, deps),
		send: (route, nativeSessionId, content) => sendViaCodexQueue(route, nativeSessionId, content, deps.runner),
	};
}

export const codexNativePushAdapter = createCodexNativePushAdapter();
