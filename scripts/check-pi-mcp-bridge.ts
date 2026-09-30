/**
 * check-pi-mcp-bridge — a real Pi session reaches the COMPILED entwurf-bridge through Pi's built-in
 * MCP, as the citizen it was born as (#125).
 *
 * The subject is the whole installed path, driven by `scripts/lib/pi-mcp-bridge-probe.mjs` in its own
 * process: Pi's AgentSessionRuntime, its extension loader, the built-in MCP extension registered the
 * way the CLI registers it, Pi's default stdio transport, entwurf-control's real record birth and
 * `registerMcpServer`, and the compiled bridge child. Only the model is faux (pi-ai `fauxProvider`):
 * it calls `mcp__entwurf-bridge__entwurf_self` once per session. No network, no paid call.
 *
 * WHAT THIS ADDS BESIDE `pi-extensions/entwurf-control.test.ts`. That beside test owns the
 * registration itself (factory 0 / session_start 1 / env = record / exposure / identity before UI).
 * This gate is the vendor-interpretation supplement it cannot be: what Pi actually SPAWNS from that
 * registration and what a model actually SEES. It does not replace the beside test.
 *
 * INDEPENDENT ORACLES. The probe reports raw facts; the judgement is here, against sources the
 * subject does not author:
 *   - the V3 record FILE the store holds for the session's native id (read from disk here),
 *   - Pi's own session FILE for that native id (the native join, read from disk here),
 *   - the kernel's view of the child (/proc argv, environ, cwd),
 *   - literal expected tool names and compiled entry path — deliberately NOT derived from
 *     `ENTWURF_MCP_HIDDEN_TOOLS`, the bridge's tool list or `entwurfBridgeCompiledEntry`, so a change
 *     to any of them cannot move its own oracle.
 *
 * Cells, in order (node:assert stops at the first failure, so each mutant dies at its own claim):
 *   DECLARED-SURFACE     the model is declared exactly the six caller verbs under the actual
 *                        `mcp__entwurf-bridge__` prefix; the two hidden tools and every bare
 *                        `entwurf_*` name are absent.
 *   SAME-CHILD-IDENTITY  session 1 has exactly one bridge child, running the compiled entry with
 *                        Pi's own node; its PI_SESSION_ID is the gardenId of the record for this
 *                        native session, and `entwurf_self` answered from that child names the same
 *                        id and the session's cwd, which is also the child's kernel cwd.
 * Then, not a QK claim — VENDOR CONFORMANCE of `runtime.newSession()` (reason "new", the CLI /new
 * contract): the old child is gone, the parent lives, the new session has its own record and a new
 * child carrying it, and the old record is preserved. These are Pi's lifecycle facts, observed; there
 * is no Entwurf source line a mutant could flip for them. Other lifecycles (quit / reload / switch /
 * fork / resume) are NOT observed here and inherit nothing from this.
 *
 * Isolation: HOME, PI_CODING_AGENT_DIR, XDG roots and TMPDIR are a throwaway short root (the control
 * socket lives under HOME and a unix socket path has a ~107-byte ceiling), no identity carrier is
 * inherited, and PI_OFFLINE=1. Requires the compiled bridge (`bash scripts/build-bridge.sh`); its
 * absence is a named failure, not a skip.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = path.join(ROOT, "scripts", "lib", "pi-mcp-bridge-probe.mjs");
// Literal, like the tool names below: the child-argv oracle is NOT derived from the production
// helper (`entwurfBridgeCompiledEntry`) whose answer it checks.
const ENTRY = path.join(ROOT, "mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js");
const PREFIX = "mcp__entwurf-bridge__";
const DECLARED = [
	"entwurf_callback",
	"entwurf_fresh_call",
	"entwurf_peers",
	"entwurf_resume_call",
	"entwurf_self",
	"entwurf_v2",
];
const HIDDEN = ["entwurf_inbox_read", "entwurf_register_native"];
const TIMEOUT_MS = 60_000;

interface Child {
	pid: number;
	state: string;
	starttime: string;
	argv: string[];
	env: { PI_SESSION_ID?: string; PI_AGENT_ID?: string };
	cwd: string | null;
	readError?: string;
}
interface ProbeOut {
	execPath: string;
	phases: {
		s1?: { native: string; children: Child[] };
		newSession?: { cancelled: boolean };
		afterNew?: {
			parentAlive: boolean;
			p1: Array<{ pid: number; starttime: string; now: { state: string; starttime: string } | null }>;
			children: Child[];
		};
		s2?: { native: string; children: Child[] };
	};
	declaredPerCall: string[][];
	toolResults: Array<{ tag: string; toolName: string; isError: boolean; text: string }>;
	errors: string[];
	fauxCalls?: number;
	fauxPending?: number;
}
interface RecordFile {
	gardenId: string;
	nativeSessionId: string;
	backend: string;
	cwd?: string;
}

if (!fs.existsSync(ENTRY)) {
	console.error(
		`check-pi-mcp-bridge: FAIL — compiled bridge entry missing: ${ENTRY}\n  build it first: bash scripts/build-bridge.sh`,
	);
	process.exit(1);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pmb-"));
const home = path.join(root, "h");
const agentDir = path.join(home, ".pi", "agent");
const cwd = path.join(root, "c");
fs.mkdirSync(agentDir, { recursive: true });
fs.mkdirSync(cwd, { recursive: true });
fs.mkdirSync(path.join(root, "t"), { recursive: true });

function recordsFor(nativeSessionId: string): RecordFile[] {
	const dir = path.join(agentDir, "meta-sessions");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".meta.json"))
		.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RecordFile)
		.filter((r) => r.nativeSessionId === nativeSessionId);
}
function sessionFilesFor(nativeSessionId: string): string[] {
	const dir = path.join(agentDir, "sessions");
	if (!fs.existsSync(dir)) return [];
	return (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(`_${nativeSessionId}.jsonl`));
}
function selfAnswer(out: ProbeOut, tag: string): { sessionId: string | null; cwd: string | null; raw: string } {
	const hit = out.toolResults.filter((r) => r.tag === tag && r.toolName === `${PREFIX}entwurf_self`);
	if (hit.length !== 1 || hit[0].isError) return { sessionId: null, cwd: null, raw: JSON.stringify(hit) };
	return {
		sessionId: /^sessionId:\s+(\S+)$/m.exec(hit[0].text)?.[1] ?? null,
		cwd: /^cwd:\s+(.+)$/m.exec(hit[0].text)?.[1]?.trim() ?? null,
		raw: hit[0].text,
	};
}

const started = Date.now();
try {
	const run = spawnSync(process.execPath, [PROBE, ROOT, cwd], {
		cwd: ROOT,
		encoding: "utf8",
		timeout: TIMEOUT_MS,
		env: {
			PATH: process.env.PATH,
			HOME: home,
			PI_CODING_AGENT_DIR: agentDir,
			TMPDIR: path.join(root, "t"),
			XDG_CONFIG_HOME: path.join(root, "x", "config"),
			XDG_DATA_HOME: path.join(root, "x", "data"),
			XDG_CACHE_HOME: path.join(root, "x", "cache"),
			XDG_STATE_HOME: path.join(root, "x", "state"),
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
		},
	});
	const elapsed = Date.now() - started;
	assert.ok(
		!run.error && run.signal === null,
		`probe did not finish: ${run.error?.message ?? `signal ${run.signal}`} after ${elapsed}ms (timeout ${TIMEOUT_MS}ms)\n${run.stderr}`,
	);
	assert.equal(run.status, 0, `probe exited ${run.status}\n${run.stdout}\n${run.stderr}`);
	const last = run.stdout.trim().split("\n").at(-1);
	assert.ok(last !== undefined && last.startsWith("{"), `probe printed no JSON report\n${run.stdout}\n${run.stderr}`);
	const out = JSON.parse(last) as ProbeOut;
	assert.deepEqual(out.errors, [], `probe reported errors:\n${out.errors.join("\n")}\n${run.stderr}`);
	assert.equal(out.fauxCalls, 4, `faux model: expected 4 calls (tool call + terminal, twice), got ${out.fauxCalls}`);
	assert.equal(out.fauxPending, 0, `faux model: ${out.fauxPending} scripted responses were never consumed`);
	assert.equal(
		out.declaredPerCall.length,
		2,
		`faux model saw ${out.declaredPerCall.length} tool-calling turns, expected 2`,
	);

	// --- DECLARED-SURFACE ---
	const expectedDeclared = DECLARED.map((v) => `${PREFIX}${v}`).sort();
	for (const [i, names] of out.declaredPerCall.entries()) {
		const bridge = names.filter((n) => n.startsWith(PREFIX)).sort();
		const bare = names.filter((n) => n.startsWith("entwurf_"));
		const hidden = HIDDEN.filter((h) => names.includes(`${PREFIX}${h}`));
		assert.ok(
			JSON.stringify(bridge) === JSON.stringify(expectedDeclared) && bare.length === 0 && hidden.length === 0,
			`[QK:PI-MCP-BRIDGE-DECLARED-SURFACE] model turn ${i + 1} must be declared exactly the six caller verbs under ${PREFIX}, no hidden tool and no bare entwurf_* name — got bridge=${JSON.stringify(bridge)} bare=${JSON.stringify(bare)} hidden=${JSON.stringify(hidden)}`,
		);
	}

	// --- SAME-CHILD-IDENTITY (session 1) ---
	const s1 = out.phases.s1;
	assert.ok(s1, "probe reported no session-1 phase");
	const r1 = recordsFor(s1.native);
	const self1 = selfAnswer(out, "s1");
	const kid1 = s1.children;
	assert.ok(
		r1.length === 1 &&
			r1[0].backend === "pi" &&
			sessionFilesFor(s1.native).length === 1 &&
			kid1.length === 1 &&
			kid1[0].readError === undefined &&
			JSON.stringify(kid1[0].argv) === JSON.stringify([out.execPath, ENTRY]) &&
			kid1[0].env.PI_SESSION_ID === r1[0].gardenId &&
			self1.sessionId === r1[0].gardenId &&
			self1.cwd === cwd &&
			kid1[0].cwd === cwd,
		`[QK:PI-MCP-BRIDGE-SAME-CHILD-IDENTITY] session 1: one pi record and one Pi session file for native ${s1.native}; exactly one child running [pi's node, compiled entry]; child PI_SESSION_ID = record gardenId = entwurf_self sessionId; self cwd = child cwd = session cwd ${cwd} — got records=${JSON.stringify(r1)} sessionFiles=${JSON.stringify(sessionFilesFor(s1.native))} children=${JSON.stringify(kid1)} self=${JSON.stringify(self1)}`,
	);
	const g1 = r1[0].gardenId;

	// --- vendor conformance: runtime.newSession() (not a QK claim; see header) ---
	const after = out.phases.afterNew;
	assert.ok(
		after && out.phases.newSession?.cancelled === false,
		`newSession was cancelled or unreported: ${JSON.stringify(out.phases.newSession)}`,
	);
	assert.ok(after.parentAlive, "newSession: the parent process must survive");
	for (const p of after.p1) {
		const same = p.now !== null && p.now.starttime === p.starttime && p.now.state !== "Z";
		assert.ok(
			!same,
			`newSession: the session-1 bridge child ${p.pid} must be gone after reason "new" — still ${JSON.stringify(p.now)}`,
		);
	}
	const s2 = out.phases.s2;
	assert.ok(
		s2 && s2.native !== s1.native,
		`newSession: session 2 must have a new native id (s1 ${s1.native}, s2 ${s2?.native})`,
	);
	const r2 = recordsFor(s2.native);
	const self2 = selfAnswer(out, "s2");
	assert.ok(
		r2.length === 1 &&
			r2[0].backend === "pi" &&
			r2[0].gardenId !== g1 &&
			s2.children.length === 1 &&
			!kid1.some((k) => k.pid === s2.children[0].pid) &&
			s2.children[0].env.PI_SESSION_ID === r2[0].gardenId &&
			self2.sessionId === r2[0].gardenId &&
			s2.children[0].cwd === cwd,
		`newSession: session 2 has its own pi record, one NEW child carrying it, and entwurf_self names it — got records=${JSON.stringify(r2)} children=${JSON.stringify(s2.children)} self=${JSON.stringify(self2)}`,
	);
	assert.equal(recordsFor(s1.native).length, 1, "newSession: the session-1 record must be preserved");
	assert.equal(recordsFor(s1.native)[0].gardenId, g1, "newSession: the session-1 record keeps its gardenId");

	console.log(
		`check-pi-mcp-bridge: PASS (${elapsed}ms) — declared ${expectedDeclared.length} verbs ×2 turns; s1 ${g1} child ${kid1[0].pid}; new → s2 ${r2[0].gardenId} child ${s2.children[0].pid}; s1 record preserved`,
	);
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
