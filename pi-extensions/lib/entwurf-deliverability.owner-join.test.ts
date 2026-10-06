/**
 * #101 owner join for `pi-durable-host`, through the PRODUCTION dispatch composition.
 *
 * A durable host keys its sender marker and holds its doorbell watch in one process, so its
 * receiver marker sits inside the join's scope (`SENDER_JOINED_RECEIVER_OWNER_KINDS`). These
 * cases drive `makeProductionEntwurfV2Deps` with no seam overridden on the receiver/target path:
 * the real record store, the real marker writers and readers on temp roots, the real enqueue.
 * The CALLER's `senderProvider` is a synthetic fixture, so nothing here certifies how a sending
 * bridge resolves its own identity. The receiver owner is this test process — live, with its real
 * start key — so every axis before the join reads "active" and only the join can refuse. The
 * oracle is the mailbox directory, read raw.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiverOwnerKindJoinsSender, SENDER_JOINED_RECEIVER_OWNER_KINDS } from "./entwurf-deliverability.ts";
import { makeProductionEntwurfV2Deps } from "./entwurf-v2-production.ts";
import { runEntwurfV2 } from "./entwurf-v2-runner.ts";
import { upsertMetaSession, writeMetaReceiverMarker, writeMetaSenderMarker } from "./meta-session.ts";

const ROOT_ENV = [
	"ENTWURF_META_SESSIONS_DIR",
	"ENTWURF_META_SENDERS_DIR",
	"ENTWURF_META_RECEIVERS_DIR",
	"ENTWURF_META_MAILBOX_DIR",
] as const;

let root: string;
let dirs: Record<"sessions" | "senders" | "receivers" | "mailbox" | "locks" | "sockets" | "cwd", string>;
let savedEnv: Partial<Record<(typeof ROOT_ENV)[number], string>>;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-owner-join-"));
	dirs = {
		sessions: path.join(root, "meta-sessions"),
		senders: path.join(root, "meta-senders"),
		receivers: path.join(root, "meta-receivers"),
		mailbox: path.join(root, "meta-mailbox"),
		locks: path.join(root, "locks"),
		sockets: path.join(root, "sockets"),
		cwd: path.join(root, "project"),
	};
	fs.mkdirSync(dirs.cwd);
	fs.mkdirSync(dirs.sockets);
	// The production marker readers resolve their roots from these carriers; no reader is injected.
	// All four point into the temp root, so no default can reach the operator's store.
	savedEnv = {};
	for (const key of ROOT_ENV) savedEnv[key] = process.env[key];
	process.env.ENTWURF_META_SESSIONS_DIR = dirs.sessions;
	process.env.ENTWURF_META_SENDERS_DIR = dirs.senders;
	process.env.ENTWURF_META_RECEIVERS_DIR = dirs.receivers;
	process.env.ENTWURF_META_MAILBOX_DIR = dirs.mailbox;
});

afterEach(() => {
	for (const key of ROOT_ENV) {
		const value = savedEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(root, { recursive: true, force: true });
});

function mint(nativeSessionId: string): string {
	return upsertMetaSession({
		input: { backend: "pi-durable", nativeSessionId, cwd: dirs.cwd, model: null, transcriptPath: null },
		dir: dirs.sessions,
	}).record.gardenId;
}

function senderMarker(gardenId: string, nativeSessionId: string): string {
	return writeMetaSenderMarker({
		backend: "pi-durable",
		gardenId,
		nativeSessionId,
		cwd: dirs.cwd,
		ownerPid: process.pid,
		sendersDir: dirs.senders,
	});
}

/** A durable host's doorbell: owned by this live process, as the contact writes it. */
function receiverMarker(gardenId: string, nativeSessionId: string): void {
	writeMetaReceiverMarker({
		gardenId,
		backend: "pi-durable",
		nativeSessionId,
		ownerPid: process.pid,
		ownerKind: "pi-durable-host",
		armProvenance: "session-start",
		receiversDir: dirs.receivers,
	});
}

function send(target: string) {
	const deps = makeProductionEntwurfV2Deps({
		senderProvider: () => ({
			sessionId: "20261005T000000-5e4de4",
			agentId: "pi-durable/test",
			cwd: dirs.cwd,
			timestamp: "2026-10-05T00:00:00.000Z",
			origin: "meta-session",
			replyable: false,
		}),
		lockDir: dirs.locks,
		sessionsDir: dirs.sessions,
		mailboxDir: dirs.mailbox,
		controlSocketDir: dirs.sockets,
	});
	return runEntwurfV2({ target, intent: "fire-and-forget", message: "hello durable" }, deps);
}

function bodies(gardenId: string): string[] {
	const dir = path.join(dirs.mailbox, gardenId);
	return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".msg")) : [];
}

const NATIVE = "1759622400000-0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5b";
const OTHER_NATIVE = "1759622499999-6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";

describe("#101 owner join — pi-durable-host through the production composition", () => {
	it("[QK:PDH-JOIN-MATCH-ENQUEUES] a live host whose sender marker names the target garden is deliverable: one body is enqueued", async () => {
		const gid = mint(NATIVE);
		senderMarker(gid, NATIVE);
		receiverMarker(gid, NATIVE);
		const result = await send(gid);
		expect(result.kind).toBe("executed");
		expect(result.kind === "executed" && result.transport).toBe("meta-mailbox");
		expect(bodies(gid)).toHaveLength(1);
	});

	it("[QK:PDH-JOIN-ABSENT-SENDER-REFUSED] the same live receiver with no sender marker for its owner is a retired watch: refused, nothing enqueued", async () => {
		const gid = mint(NATIVE);
		receiverMarker(gid, NATIVE);
		const result = await send(gid);
		expect(result.kind).toBe("rejected");
		expect(result.kind === "rejected" && result.receipt.reason).toBe("mailbox-undeliverable");
		expect(result.kind === "rejected" && result.diagnostic).toMatchObject({
			kind: "mailbox-undeliverable",
			reason: expect.stringMatching(/idle-watch not armed/),
		});
		expect(fs.existsSync(path.join(dirs.mailbox, gid))).toBe(false);
	});

	it("[QK:PDH-JOIN-FOREIGN-SENDER-REFUSED] the same live receiver whose owner's sender marker names another garden is refused, and nothing reaches either mailbox", async () => {
		const gid = mint(NATIVE);
		const other = mint(OTHER_NATIVE);
		receiverMarker(gid, NATIVE);
		senderMarker(other, OTHER_NATIVE);
		const result = await send(gid);
		expect(result.kind).toBe("rejected");
		expect(result.kind === "rejected" && result.receipt.reason).toBe("mailbox-undeliverable");
		expect(bodies(gid)).toEqual([]);
		expect(bodies(other)).toEqual([]);
	});

	it("[QK:PDH-JOIN-SCOPE] the join admits exactly the Claude CLI and the durable host; OMP stays outside", () => {
		expect([...SENDER_JOINED_RECEIVER_OWNER_KINDS]).toEqual(["claude-code-cli", "pi-durable-host"]);
		expect(receiverOwnerKindJoinsSender("pi-durable-host")).toBe(true);
		expect(receiverOwnerKindJoinsSender("omp-host")).toBe(false);
	});
});
