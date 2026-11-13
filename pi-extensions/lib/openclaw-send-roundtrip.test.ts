/**
 * #160 review O7: the REAL `run.sh openclaw-send` entry, end to end, classified by the REAL plugin.
 *
 * Entry point: SURFACE-IN at the entry the plugin runs. One isolated HOME holds a certified store
 * with an `openclaw` sender record and a live pi-durable target (receiver and sender markers owned
 * by this process), and the scope declaration where the entry reads it. The entry runs under `env -i` with
 * that HOME. The ONLY substitution is the vendor CLI: a stand-in `openclaw` first on PATH answers
 * `sessions.describe` for the declared key (the sender's replyable probe) and logs each call.
 *
 * Oracles: the exit code and the one stdout line, read through `plugins/openclaw/dist/core.js`
 * `classifyEntryResult` (the plugin's own decision), the target's mailbox read raw, and the stand-in
 * log. Cells close the plugin's four determinate codes: 0, 4, 3, 2.
 *
 * Not claimed: a real Gateway, the plugin loaded inside OpenClaw, or `runCommandWithTimeout` itself.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyEntryResult } from "../../plugins/openclaw/dist/core.js";
import { upsertMetaSession, writeMetaReceiverMarker, writeMetaSenderMarker } from "./meta-session.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY = "agent:main:s1m1";

let root: string;
let home: string;
let agent: string;
let bin: string;
let log: string;
let decl: string;
let target: string;
let sender: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-send-roundtrip-"));
	home = path.join(root, "home");
	agent = path.join(home, ".pi", "agent");
	const cwd = path.join(home, "project");
	fs.mkdirSync(cwd, { recursive: true });
	const store = path.join(agent, "meta-sessions");
	const nativeSessionId = "1759622499999-6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
	target = upsertMetaSession({
		input: { backend: "pi-durable", nativeSessionId, cwd, model: null, transcriptPath: null },
		dir: store,
	}).record.gardenId;
	writeMetaReceiverMarker({
		gardenId: target,
		backend: "pi-durable",
		nativeSessionId,
		ownerPid: process.pid,
		ownerKind: "pi-durable-host",
		armProvenance: "session-start",
		receiversDir: path.join(agent, "meta-receivers"),
	});
	// The durable owner join: a pi-durable-host receiver counts as armed only while the same owner
	// also names this garden as its sender (entwurf-deliverability `receiverOwnerServesGarden`).
	writeMetaSenderMarker({
		backend: "pi-durable",
		gardenId: target,
		nativeSessionId,
		cwd,
		ownerPid: process.pid,
		sendersDir: path.join(agent, "meta-senders"),
	});
	sender = upsertMetaSession({
		input: { backend: "openclaw", nativeSessionId: `openclaw:lab:${KEY}`, cwd, model: null, transcriptPath: null },
		dir: store,
	}).record.gardenId;
	decl = path.join(agent, "openclaw-citizens.json");
	fs.writeFileSync(
		decl,
		JSON.stringify({
			version: 1,
			gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
			allow: [{ scope: "lab", agentId: "main", sessionKey: KEY }],
		}),
	);
	bin = path.join(root, "bin");
	fs.mkdirSync(bin);
	log = path.join(root, "openclaw.log");
	fs.writeFileSync(
		path.join(bin, "openclaw"),
		[
			"#!/usr/bin/env bash",
			"set -u",
			`printf '%s\\n' "$*" >> '${log}'`,
			'[ "$1 $2 $3" = "gateway call sessions.describe" ] || { echo "stand-in openclaw: unexpected $*" >&2; exit 9; }',
			`printf '%s\\n' '{"session":{"key":"${KEY}"}}'`,
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function claim(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		v: 1,
		scope: "lab",
		agentId: "main",
		sessionKey: KEY,
		target,
		message: "nonce-oc2t",
		wantsReply: true,
		...over,
	});
}

function runEntry(input: string, declArg = decl) {
	const r = spawnSync(
		"env",
		[
			"-i",
			`HOME=${home}`,
			`PATH=${bin}:${path.dirname(process.execPath)}:${process.env.PATH ?? ""}`,
			path.join(REPO, "run.sh"),
			"openclaw-send",
			"--decl",
			declArg,
		],
		{ input, encoding: "utf8", timeout: 60_000 },
	);
	return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function bodies(): string[] {
	const dir = path.join(agent, "meta-mailbox", target);
	return fs.existsSync(dir)
		? fs
				.readdirSync(dir)
				.filter((n) => n.endsWith(".msg"))
				.map((n) => fs.readFileSync(path.join(dir, n), "utf8"))
		: [];
}

const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);

describe("O7 surface-in: the real openclaw-send entry, read by the real plugin classifier", () => {
	it("[QK:OPENCLAW-ROUNDTRIP-DISPATCHED] exit 0: one body in the target's mailbox naming the openclaw sender, replyable from the probe", () => {
		const r = runEntry(claim());
		const o = classifyEntryResult(r);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
		expect(o.outcome, JSON.stringify(o)).toBe("dispatched");
		const got = bodies();
		expect(got).toHaveLength(1);
		expect(got[0]).toContain(sender);
		expect(got[0]).toContain("nonce-oc2t");
		expect(calls()).toHaveLength(1);
		expect(calls()[0]).toContain("sessions.describe --json --expect-url ws://127.0.0.1:18811");
	}, 60_000);

	it("[QK:OPENCLAW-ROUNDTRIP-DISPATCH-ERROR] exit 4: an unknown target is dispatched and reported as an error, nothing written", () => {
		const r = runEntry(claim({ target: "20261007T132839-0ddddd" }));
		const o = classifyEntryResult(r);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(4);
		expect(o.outcome).toBe("dispatch-reported-error");
		expect(bodies()).toEqual([]);
	}, 60_000);

	it("[QK:OPENCLAW-ROUNDTRIP-SCOPE-REFUSED] exit 3: a key outside the declaration is refused before any probe or dispatch", () => {
		const r = runEntry(claim({ sessionKey: "agent:main:other" }));
		const o = classifyEntryResult(r);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(3);
		expect(o).toMatchObject({ outcome: "rejected", reason: "openclaw-scope-not-declared" });
		expect(calls()).toEqual([]);
		expect(bodies()).toEqual([]);
	}, 60_000);

	it("[QK:OPENCLAW-ROUNDTRIP-WRONG-DECL] exit 2: --decl that is not this host's declaration is invalid before the claim is read", () => {
		const other = path.join(root, "elsewhere.json");
		fs.copyFileSync(decl, other);
		const r = runEntry(claim(), other);
		const o = classifyEntryResult(r);
		expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(2);
		expect(o.outcome).toBe("invalid");
		expect(calls()).toEqual([]);
		expect(bodies()).toEqual([]);
	}, 60_000);
});
