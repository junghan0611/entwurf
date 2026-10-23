/**
 * #107 rail 2c: T2 — two isolated hosts on one machine, A→B and the reverse dispatch B→A.
 * #149: a third host D and a second local citizen A2 on A's root, so A's ONE declaration carries
 * three routes (A↔B, A↔D, A2↔D): fan-out from A, a remote shared by A and A2, and both directions.
 *
 * Entry point of every cell: SURFACE-IN. Each direction spawns the REAL bridge (`entwurf_v2` over
 * MCP stdio) under that host's HOME, with no meta-root overrides, so its sender is resolved by the
 * bridge's own authoritative path: a durable sender marker owned by the bridge's parent (this test
 * process), joined to a fixture record. The opt-in file is read where the bridge reads it. The ONLY
 * substitution is the transport's `ssh`: a stand-in first on PATH that accepts the fixed argv,
 * starts the other host's REAL `run.sh remote-pair-receive` under `env -i HOME=<that host>`, and
 * logs each call. B's entry then runs the production dispatch into B's real mailbox. The remote
 * PATH is this process's PATH; the real one is U4's to measure.
 *
 * A2 is an OMP citizen: its receiver sits outside the durable owner join, and its sender marker is
 * handed to its bridge through the existing explicit carrier `ENTWURF_META_SENDER_MARKER` (as
 * check-pi-durable-receive does), so A's pid-keyed marker and A2's never meet in one pid scan.
 *
 * Oracles: each host's mailbox tree read raw, the one body and its provenance header, the sending
 * bridge's receipt text, and the stand-in's call log.
 *
 * Not claimed: sshd, its non-interactive environment or authentication; a durable host reading or
 * answering (B→A is a reverse DISPATCH, not a model reply); installed bytes (rail 3); a real host (T3).
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertMetaSession, writeMetaReceiverMarker, writeMetaSenderMarker } from "./meta-session.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Subject selection. By default the subject is this checkout's source. `check-remote-pair-installed`
// sets ENTWURF_REMOTE_PAIR_INSTALLED_PKG to a package installed from a candidate tarball, and then
// the SAME cells drive that package's bridge (`start.sh` → its compiled dist) and its `run.sh`.
// ENTWURF_REMOTE_PAIR_RESOLVE_HOOK (an absolute preload) and ENTWURF_REMOTE_PAIR_RESOLVE_LOG_DIR
// let that gate record what each subject process resolves. Only the subject changes; the fixture
// writer below stays this checkout's code (the orchestrator), which is not the subject.
const INSTALLED = process.env.ENTWURF_REMOTE_PAIR_INSTALLED_PKG;
const SUBJECT_ROOT = INSTALLED ?? REPO;
const BRIDGE_ARGV = INSTALLED
	? [path.join(INSTALLED, "mcp", "entwurf-bridge", "start.sh")]
	: [
			process.execPath,
			"--experimental-strip-types",
			"--no-warnings",
			path.join(REPO, "mcp", "entwurf-bridge", "src", "index.ts"),
		];
const RESOLVE_HOOK = process.env.ENTWURF_REMOTE_PAIR_RESOLVE_HOOK;
const RESOLVE_LOG_DIR = process.env.ENTWURF_REMOTE_PAIR_RESOLVE_LOG_DIR;
function subjectEnv(label: string): Record<string, string> {
	return RESOLVE_HOOK && RESOLVE_LOG_DIR
		? {
				NODE_OPTIONS: `--import=${RESOLVE_HOOK}`,
				ENTWURF_REMOTE_PAIR_RESOLVE_LOG: path.join(RESOLVE_LOG_DIR, `${label}-${process.hrtime.bigint()}.log`),
			}
		: {};
}

interface Host {
	home: string;
	agent: string;
	cwd: string;
	gid: string;
	optIn: string;
}

let root: string;
let bin: string;
let sshLog: string;
let a: Host;
let b: Host;
let d: Host;
/** A second citizen on A's root (same HOME, same opt-in file), with its own explicit sender marker. */
let a2: { gid: string; cwd: string; senderMarker: string };

function makeHost(name: string, nativeSessionId: string): Host {
	const home = path.join(root, name);
	const agent = path.join(home, ".pi", "agent");
	const cwd = path.join(home, "project");
	fs.mkdirSync(cwd, { recursive: true });
	const gid = upsertMetaSession({
		input: { backend: "pi-durable", nativeSessionId, cwd, model: null, transcriptPath: null },
		dir: path.join(agent, "meta-sessions"),
	}).record.gardenId;
	// A live durable host on each side: doorbell + sender marker, both owned by this process.
	writeMetaReceiverMarker({
		gardenId: gid,
		backend: "pi-durable",
		nativeSessionId,
		ownerPid: process.pid,
		ownerKind: "pi-durable-host",
		armProvenance: "session-start",
		receiversDir: path.join(agent, "meta-receivers"),
	});
	writeMetaSenderMarker({
		backend: "pi-durable",
		gardenId: gid,
		nativeSessionId,
		cwd,
		ownerPid: process.pid,
		sendersDir: path.join(agent, "meta-senders"),
	});
	return { home, agent, cwd, gid, optIn: path.join(agent, "entwurf-remote-pair.json") };
}

function declare(self: Host, other: Host, alias: string): void {
	declareRoutes(self, [[self.gid, other.gid, alias, other.optIn]]);
}

/** Write `self`'s one version-2 declaration: [localGardenId, remoteGardenId, ssh, remotePairFile]. */
function declareRoutes(self: Host, routes: [string, string, string, string][]): void {
	fs.writeFileSync(
		self.optIn,
		JSON.stringify({
			version: 2,
			routes: routes.map(([localGardenId, remoteGardenId, ssh, remotePairFile]) => ({
				localGardenId,
				remoteGardenId,
				ssh,
				remotePairFile,
			})),
		}),
	);
}

function makeOmpCitizen(host: Host, nativeSessionId: string): { gid: string; cwd: string; senderMarker: string } {
	const cwd = path.join(host.home, "project-2");
	fs.mkdirSync(cwd, { recursive: true });
	const gid = upsertMetaSession({
		input: { backend: "omp", nativeSessionId, cwd, model: null, transcriptPath: null },
		dir: path.join(host.agent, "meta-sessions"),
	}).record.gardenId;
	writeMetaReceiverMarker({
		gardenId: gid,
		backend: "omp",
		nativeSessionId,
		ownerPid: process.pid,
		ownerKind: "omp-host",
		armProvenance: "session-start",
		receiversDir: path.join(host.agent, "meta-receivers"),
	});
	const senderMarker = writeMetaSenderMarker({
		backend: "omp",
		gardenId: gid,
		nativeSessionId,
		cwd,
		ownerPid: process.pid,
		sendersDir: path.join(root, "a2-explicit-sender"),
	});
	return { gid, cwd, senderMarker };
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "remote-pair-roundtrip-"));
	a = makeHost("host-a", "1759622400000-0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5b");
	b = makeHost("host-b", "1759622499999-6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d");
	d = makeHost("host-d", "1759622555555-1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d");
	a2 = makeOmpCitizen(a, "1759622466666-2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e");
	bin = path.join(root, "bin");
	fs.mkdirSync(bin);
	sshLog = path.join(root, "ssh.log");
	const nodeDir = path.dirname(process.execPath);
	fs.writeFileSync(
		path.join(bin, "ssh"),
		[
			"#!/usr/bin/env bash",
			"set -u",
			`printf '%s\\n' "$*" >> '${sshLog}'`,
			'while [ "$#" -gt 0 ] && [ "$1" = "-o" ]; do shift 2; done',
			'alias="$1"; shift',
			'case "$alias" in',
			`  a-host) H='${a.home}' ;;`,
			`  b-host) H='${b.home}' ;;`,
			`  d-host) H='${d.home}' ;;`,
			'  *) echo "stand-in ssh: unknown alias $alias" >&2; exit 255 ;;',
			"esac",
			'{ [ "$#" -gt 0 ] && [ "$1" = entwurf ]; } || { echo "stand-in ssh: unexpected remote command" >&2; exit 255; }',
			"shift",
			// The remote PATH is not under test (U4 measures the real one): pass this process's PATH,
			// and nothing else of its environment.
			`exec env -i HOME="$H" PATH='${nodeDir}:${process.env.PATH ?? ""}' ${Object.entries(subjectEnv("entry"))
				.map(([k, v]) => `${k}='${v}'`)
				.join(" ")} '${SUBJECT_ROOT}/run.sh' "$@"`,
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function mailboxDigest(h: Host): string {
	const dir = path.join(h.agent, "meta-mailbox");
	if (!fs.existsSync(dir)) return "ABSENT";
	const hash = crypto.createHash("sha256");
	const walk = (d: string) => {
		for (const name of fs.readdirSync(d).sort()) {
			const p = path.join(d, name);
			const st = fs.lstatSync(p);
			hash.update(`${path.relative(dir, p)}\0${st.isDirectory() ? "d" : "f"}\0`);
			if (st.isDirectory()) walk(p);
			else hash.update(fs.readFileSync(p));
		}
	};
	walk(dir);
	return hash.digest("hex");
}

function bodies(h: Host): string[] {
	const dir = path.join(h.agent, "meta-mailbox", h.gid);
	return fs.existsSync(dir)
		? fs
				.readdirSync(dir)
				.filter((n) => n.endsWith(".msg"))
				.map((n) => fs.readFileSync(path.join(dir, n), "utf8"))
		: [];
}

/** The bodies a host holds for one of its citizens (the host's first citizen by default). */
function bodiesOf(h: Host, gid: string): string[] {
	const dir = path.join(h.agent, "meta-mailbox", gid);
	return fs.existsSync(dir)
		? fs
				.readdirSync(dir)
				.filter((n) => n.endsWith(".msg"))
				.map((n) => fs.readFileSync(path.join(dir, n), "utf8"))
		: [];
}

/** A2's bridge: A's host, A2's cwd, A2's sender marker handed over explicitly. */
function sendAsA2(target: string, message: string) {
	return sendAs(a, target, message, { ENTWURF_META_SENDER_MARKER: a2.senderMarker }, a2.cwd);
}

function sshCalls(): string[] {
	return fs.existsSync(sshLog) ? fs.readFileSync(sshLog, "utf8").trim().split("\n").filter(Boolean) : [];
}

/** One `entwurf_v2` call through the real bridge running as `from` (on `from`'s host, from `cwd`). */
async function sendAs(
	from: Host,
	target: string,
	message: string,
	extraEnv: Record<string, string> = {},
	cwd: string = from.cwd,
): Promise<{ text: string; isError: boolean }> {
	const transport = new StdioClientTransport({
		command: BRIDGE_ARGV[0],
		args: BRIDGE_ARGV.slice(1),
		cwd,
		env: {
			HOME: from.home,
			PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH ?? ""}`,
			XDG_CONFIG_HOME: path.join(from.home, ".config"),
			XDG_DATA_HOME: path.join(from.home, ".local", "share"),
			XDG_STATE_HOME: path.join(from.home, ".local", "state"),
			XDG_CACHE_HOME: path.join(from.home, ".cache"),
			...subjectEnv("bridge"),
			...extraEnv,
		},
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.on("data", (d) => {
		stderr += String(d);
	});
	const client = new Client({ name: "remote-pair-roundtrip", version: "1" });
	await client.connect(transport);
	try {
		const r = await client.callTool({
			name: "entwurf_v2",
			arguments: { target, intent: "fire-and-forget", message, wants_reply: true },
		});
		const content = r.content as { type: string; text?: string }[];
		return {
			text: content.map((c) => c.text ?? "").join("\n") + (stderr ? `\n[bridge stderr]\n${stderr}` : ""),
			isError: r.isError === true,
		};
	} finally {
		await client.close();
	}
}

describe("T2 surface-in: the real bridge over one pair between two hosts", () => {
	it("[QK:REMOTE-ROUNDTRIP-A-TO-B] A's bridge sends to B's gid over its declared route: one ssh call, one body in B's mailbox naming A, A's mailbox untouched", async () => {
		declare(a, b, "b-host");
		declare(b, a, "a-host");
		const aBefore = mailboxDigest(a);
		const r = await sendAs(a, b.gid, "nonce-a2b");
		expect(r.isError, r.text).toBe(false);
		expect(r.text).toContain("entwurf_v2 remote via b-host → accepted by the other host");
		expect(sshCalls()).toEqual([
			`-o BatchMode=yes -o ConnectTimeout=10 b-host entwurf remote-pair-receive --pair ${b.optIn}`,
		]);
		const got = bodies(b);
		expect(got).toHaveLength(1);
		expect(got[0]).toContain(`session:     ${a.gid} (remote via a-host; reply route declared, not probed)`);
		expect(got[0]).toContain(`@ ${a.cwd} (sender-host path)`);
		expect(got[0]).toContain("wants reply: yes");
		expect(got[0]).toContain("nonce-a2b");
		expect(mailboxDigest(a)).toBe(aBefore);
	}, 60_000);

	it("[QK:REMOTE-ROUNDTRIP-REVERSE-DISPATCH] B's bridge dispatches back to A's gid the same way — a reverse dispatch, not a model reply", async () => {
		declare(a, b, "b-host");
		declare(b, a, "a-host");
		const bBefore = mailboxDigest(b);
		const r = await sendAs(b, a.gid, "nonce-b2a");
		expect(r.isError, r.text).toBe(false);
		expect(sshCalls()).toEqual([
			`-o BatchMode=yes -o ConnectTimeout=10 a-host entwurf remote-pair-receive --pair ${a.optIn}`,
		]);
		const got = bodies(a);
		expect(got).toHaveLength(1);
		expect(got[0]).toContain(`session:     ${b.gid} (remote via b-host; reply route declared, not probed)`);
		expect(got[0]).toContain("nonce-b2a");
		expect(mailboxDigest(b)).toBe(bBefore);
	}, 60_000);

	it("[QK:REMOTE-ROUNDTRIP-OPT-IN-ABSENT-OFF] with no opt-in file on A, the same call takes the unchanged local path: bad-target, no ssh, nothing written on either host", async () => {
		declare(b, a, "a-host");
		const before = [mailboxDigest(a), mailboxDigest(b)];
		const r = await sendAs(a, b.gid, "nonce-off");
		expect(r.isError).toBe(true);
		expect(r.text).toMatch(/bad-target/);
		expect(sshCalls()).toEqual([]);
		expect([mailboxDigest(a), mailboxDigest(b)]).toEqual(before);
	}, 60_000);

	it("[QK:REMOTE-ROUNDTRIP-OTHER-HOST-REFUSES] a claim B's own pair does not cover is refused on B and reported to A as B's named refusal, with nothing written", async () => {
		declare(a, b, "b-host");
		// B pairs with someone else.
		declareRoutes(b, [[b.gid, "20261007T132839-0ddddd", "a-host", a.optIn]]);
		const before = [mailboxDigest(a), mailboxDigest(b)];
		const r = await sendAs(a, b.gid, "nonce-refused");
		expect(r.isError).toBe(true);
		expect(r.text).toContain("refused by the other host's pair: remote-pair-from-mismatch");
		expect(sshCalls()).toHaveLength(1);
		expect([mailboxDigest(a), mailboxDigest(b)]).toEqual(before);
	}, 60_000);

	it("[QK:REMOTE-ROUNDTRIP-LOCAL-TRACE-BOTH-SOCKET-DIRS] a socket for the declared gid in either the decider's canonical dir or the bridge's own ENTWURF_DIR stops the remote send before ssh", async () => {
		declare(a, b, "b-host");
		declare(b, a, "a-host");
		const bridgeDir = path.join(a.home, "bridge-entwurf-dir");
		const canonicalDir = path.join(a.home, ".pi", "entwurf-control");
		fs.mkdirSync(bridgeDir, { recursive: true });
		fs.mkdirSync(canonicalDir, { recursive: true });
		const before = [mailboxDigest(a), mailboxDigest(b)];
		for (const dir of [canonicalDir, bridgeDir]) {
			const sock = path.join(dir, `${b.gid}.sock`);
			fs.writeFileSync(sock, "");
			const r = await sendAs(a, b.gid, "nonce-trace", { ENTWURF_DIR: bridgeDir });
			expect(r.isError, dir).toBe(true);
			expect(r.text, dir).toMatch(/remote-route-local-conflict/);
			fs.rmSync(sock);
		}
		expect(sshCalls()).toEqual([]);
		expect([mailboxDigest(a), mailboxDigest(b)]).toEqual(before);
	}, 60_000);
});

describe("T2 surface-in: one declaration, three routes across three hosts (#149)", () => {
	/** A's root: A↔B, A↔D, A2↔D. B: B↔A. D: D↔A, D↔A2. */
	function declareAll(): void {
		declareRoutes(a, [
			[a.gid, b.gid, "b-host", b.optIn],
			[a.gid, d.gid, "d-host", d.optIn],
			[a2.gid, d.gid, "d-host", d.optIn],
		]);
		declareRoutes(b, [[b.gid, a.gid, "a-host", a.optIn]]);
		declareRoutes(d, [
			[d.gid, a.gid, "a-host", a.optIn],
			[d.gid, a2.gid, "a-host", a.optIn],
		]);
	}
	const call = (alias: string, h: Host) =>
		`-o BatchMode=yes -o ConnectTimeout=10 ${alias} entwurf remote-pair-receive --pair ${h.optIn}`;

	it("[QK:REMOTE-ROUNDTRIP-MULTI-INDEPENDENT] A→B, A→D and A2→D each take their own route: one ssh call each, each body naming its own sender, A's root untouched", async () => {
		declareAll();
		const aBefore = mailboxDigest(a);
		for (const [send, nonce] of [
			[() => sendAs(a, b.gid, "nonce-a2b"), "a2b"],
			[() => sendAs(a, d.gid, "nonce-a2d"), "a2d"],
			[() => sendAsA2(d.gid, "nonce-a22d"), "a22d"],
		] as const) {
			const r = await send();
			expect(r.isError, `${nonce}: ${r.text}`).toBe(false);
		}
		expect(sshCalls()).toEqual([call("b-host", b), call("d-host", d), call("d-host", d)]);
		const atB = bodiesOf(b, b.gid);
		expect(atB).toHaveLength(1);
		expect(atB[0]).toContain(`session:     ${a.gid} (remote via a-host; reply route declared, not probed)`);
		expect(atB[0]).toContain("nonce-a2b");
		const atD = bodiesOf(d, d.gid).sort();
		expect(atD).toHaveLength(2);
		expect(atD.find((x) => x.includes("nonce-a2d"))).toContain(`session:     ${a.gid} (remote via a-host;`);
		expect(atD.find((x) => x.includes("nonce-a22d"))).toContain(`session:     ${a2.gid} (remote via a-host;`);
		expect(atD.find((x) => x.includes("nonce-a22d"))).toContain(`@ ${a2.cwd} (sender-host path)`);
		expect(mailboxDigest(a)).toBe(aBefore);
	}, 120_000);

	it("[QK:REMOTE-ROUNDTRIP-MULTI-REVERSE] B→A, D→A and D→A2 arrive at the exact citizen on A, each labelled with the route it came over", async () => {
		declareAll();
		for (const [r, nonce] of [
			[await sendAs(b, a.gid, "nonce-b2a"), "b2a"],
			[await sendAs(d, a.gid, "nonce-d2a"), "d2a"],
			[await sendAs(d, a2.gid, "nonce-d2a2"), "d2a2"],
		] as const)
			expect(r.isError, `${nonce}: ${r.text}`).toBe(false);
		expect(sshCalls()).toEqual([call("a-host", a), call("a-host", a), call("a-host", a)]);
		const atA = bodiesOf(a, a.gid);
		expect(atA).toHaveLength(2);
		expect(atA.find((x) => x.includes("nonce-b2a"))).toContain(`session:     ${b.gid} (remote via b-host;`);
		expect(atA.find((x) => x.includes("nonce-d2a"))).toContain(`session:     ${d.gid} (remote via d-host;`);
		const atA2 = bodiesOf(a, a2.gid);
		expect(atA2).toHaveLength(1);
		expect(atA2[0]).toContain(`session:     ${d.gid} (remote via d-host; reply route declared, not probed)`);
		expect(atA2[0]).toContain("nonce-d2a2");
	}, 120_000);

	it("[QK:REMOTE-ROUNDTRIP-MULTI-UNDECLARED-SENDER-ZERO-SSH] A2 sending to B, which A's file pairs only with A, is refused on A with no ssh and nothing written on any host", async () => {
		declareAll();
		const before = [mailboxDigest(a), mailboxDigest(b), mailboxDigest(d)];
		const r = await sendAsA2(b.gid, "nonce-a22b");
		expect(r.isError).toBe(true);
		expect(r.text).toContain(
			`remote-sender-not-declared: only ${a.gid} may send to ${b.gid} via b-host (sender: ${a2.gid})`,
		);
		expect(sshCalls()).toEqual([]);
		expect([mailboxDigest(a), mailboxDigest(b), mailboxDigest(d)]).toEqual(before);
	}, 60_000);

	it("[QK:REMOTE-ROUNDTRIP-MULTI-CROSS-CLAIM-REFUSED] B's own file claiming A2 does not widen A's: A refuses B→A2 as a target mismatch and nothing is written", async () => {
		declareAll();
		declareRoutes(b, [
			[b.gid, a.gid, "a-host", a.optIn],
			[b.gid, a2.gid, "a-host", a.optIn],
		]);
		const before = [mailboxDigest(a), mailboxDigest(b), mailboxDigest(d)];
		const r = await sendAs(b, a2.gid, "nonce-b2a2");
		expect(r.isError).toBe(true);
		expect(r.text).toContain("refused by the other host's pair: remote-pair-target-mismatch");
		expect(sshCalls()).toEqual([call("a-host", a)]);
		expect([mailboxDigest(a), mailboxDigest(b), mailboxDigest(d)]).toEqual(before);
	}, 60_000);
});
