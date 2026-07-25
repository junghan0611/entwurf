/**
 * check-native-push-adapter — deterministic gate for the native-push adapter LEAF
 * (봉인 3/8). Drives `createAntigravityAdapter` with a FAKE runner (no real agy / ss /
 * pgrep), so probe + send are gate-provable without a live host.
 *
 * Proves:
 *   - FULL pid scan (NOT head -1): with two host pids where only the SECOND serves the
 *     conversation, probe still finds the route — the raw-agy-send.sh:16 single-pid
 *     assumption is corrected.
 *   - dead vs indeterminate: no host process → dead; host(s) alive but no LS port served
 *     the conversation → indeterminate (never coerced to dead).
 *   - VOLATILE route / no cache (봉인 3): a repeated probe re-runs pgrep + ss + metadata
 *     and re-discovers the (changed) route — the adapter never stores it.
 *   - send argv + env: send-message argv === [binary, agentapi, send-message, conv, body]
 *     with ANTIGRAVITY_LS_ADDRESS === the route; a non-zero exit THROWS (fail-loud).
 *   - NO retry in the adapter: send is a single attempt (the 1-shot re-probe→re-send is
 *     the executor hand's job, step ⑥) — a failed send throws immediately, no re-probe.
 *   - resolver fail-fast: resolveNativePushAdapter("antigravity") resolves; unknown throws.
 *
 * Pure; no backend, no socket, no real process.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	AGY_METADATA_TIMEOUT_MS,
	AGY_SEND_TIMEOUT_MS,
	antigravityAdapter,
	createAntigravityAdapter,
	type NativePushRunner,
	resolveNativePushAdapter,
} from "../pi-extensions/lib/native-push/adapter.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}
function eq(label: string, actual: unknown, expected: unknown): void {
	assert.deepStrictEqual(actual, expected, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const FAKE_BINARY = "/fake/bin/agy";
const CONV = "conv-abc-123";

interface ExecCall {
	argv: string[];
	env?: Record<string, string>;
	timeoutMs?: number;
}

/** A recorded ss -lntp fixture line for a localhost listener owned by `pid`. */
function ssLine(port: number, pid: number): string {
	return `LISTEN 0 4096 127.0.0.1:${port} 0.0.0.0:* users:(("agy",pid=${pid},fd=7))`;
}

interface FakeConfig {
	pids: number[];
	ss: string;
	/** which (lsAddress, conv) answer get-conversation-metadata as the serving route. */
	serving: (lsAddress: string, conv: string) => boolean;
	/** exit codes for successive send-message calls (default: all 0). */
	sendCodes?: number[];
	/** simulate a TIMEOUT kill (code 124) on every get-conversation-metadata call. */
	metadataTimeout?: boolean;
	/**
	 * Override the exit code of the `pgrep` host scan. Default: derived from `pids`
	 * (0 with matches, 1 without) — pgrep's ONE nonzero that means "no such process".
	 * Anything else here is a scan FAILURE (2 usage, 3 fatal, 124 timeout kill, 127
	 * spawn failure), which must never read as a departed host.
	 */
	pgrepCode?: number;
	/** Override the `pgrep` stdout (to drive an exit-0 answer that names no pid). */
	pgrepStdout?: string;
}

function makeFakeRunner(config: FakeConfig): { runner: NativePushRunner; calls: ExecCall[] } {
	const calls: ExecCall[] = [];
	let sendIdx = 0;
	const runner: NativePushRunner = {
		async exec(argv, opts) {
			calls.push({ argv: [...argv], env: opts?.env, timeoutMs: opts?.timeoutMs });
			const a = [...argv];
			if (a[0] === "pgrep") {
				const code = config.pgrepCode ?? (config.pids.length > 0 ? 0 : 1);
				const stdout = config.pgrepStdout ?? (config.pids.length ? `${config.pids.join("\n")}\n` : "");
				return { code, stdout, stderr: code === 0 || code === 1 ? "" : "pgrep: scan failed" };
			}
			if (a[0] === "ss") {
				return { code: 0, stdout: config.ss, stderr: "" };
			}
			if (a.includes("get-conversation-metadata")) {
				if (config.metadataTimeout) {
					return { code: 124, stdout: "", stderr: "" }; // timeout kill (bounded, no hang)
				}
				const conv = a[a.length - 1];
				const ls = opts?.env?.ANTIGRAVITY_LS_ADDRESS ?? "";
				const serves = config.serving(ls, conv);
				return {
					code: serves ? 0 : 1,
					stdout: serves ? '{"conversationMetadata":{"id":"x"}}' : "",
					stderr: serves ? "" : "conversation not found",
				};
			}
			if (a.includes("send-message")) {
				const code = config.sendCodes ? (config.sendCodes[sendIdx++] ?? 0) : 0;
				return { code, stdout: "", stderr: code === 0 ? "" : "send failed" };
			}
			return { code: 127, stdout: "", stderr: `unknown command ${a[0]}` };
		},
	};
	return { runner, calls };
}

// ── FULL pid scan (not head -1): only the 2nd pid serves the conversation ────
{
	const { runner, calls } = makeFakeRunner({
		pids: [123, 456],
		ss: `${ssLine(5001, 123)}\n${ssLine(5002, 456)}`,
		serving: (ls) => ls === "127.0.0.1:5002", // only pid 456's port serves it
	});
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	const result = await adapter.probe(CONV);
	ok("full-scan: probe finds the route on the SECOND pid (not head -1)", result.status === "alive");
	eq(
		"full-scan: route is pid 456's port (5002)",
		result.status === "alive" ? result.route.lsAddress : "(dead)",
		"127.0.0.1:5002",
	);
	// proof it did NOT stop at pid 123: it probed BOTH 5001 (miss) and 5002 (hit).
	const metaTargets = calls
		.filter((c) => c.argv.includes("get-conversation-metadata"))
		.map((c) => c.env?.ANTIGRAVITY_LS_ADDRESS);
	ok("full-scan: probed pid 123's port 5001 before pid 456 (no head -1)", metaTargets.includes("127.0.0.1:5001"));
	ok("full-scan: probed pid 456's serving port 5002", metaTargets.includes("127.0.0.1:5002"));
	// pgrep scanned WITHOUT `head -1` — the adapter never invokes head, it parses all pids.
	ok(
		"full-scan: pgrep invoked as `pgrep -x agy` (no head)",
		calls.some((c) => c.argv.join(" ") === "pgrep -x agy"),
	);
}

// ── dead: no host process ────────────────────────────────────────────────────
{
	const { runner } = makeFakeRunner({ pids: [], ss: "", serving: () => false });
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	const result = await adapter.probe(CONV);
	ok("no-host: probe → dead", result.status === "dead");
	ok(
		"no-host: dead reason names the missing host process",
		result.status === "dead" && /no live agy process/.test(result.reason),
	);
}

// ── a FAILED host scan is not a departed host ────────────────────────────────
// pgrep(1) uses exit 1 for "no match" and 2/3 for its own errors; the runner reports a
// missing binary as 127 and a timeout kill as 124. Folding every nonzero into "no host"
// was survivable while only a dispatch consumed it (a false dead just refuses delivery)
// and became fail-OPEN when the fresh-cut quiesce gate began reading the same verdict as
// proof that nothing is running (2026-07-25 fresh-eyes review).
for (const [code, what] of [
	[127, "pgrep missing from PATH (spawn failure)"],
	[2, "pgrep usage error"],
	[124, "host scan timed out"],
] as const) {
	const { runner } = makeFakeRunner({ pids: [], ss: "", serving: () => false, pgrepCode: code });
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	const result = await adapter.probe(CONV);
	ok(`scan-failure ${code} (${what}): probe → indeterminate, NOT dead`, result.status === "indeterminate");
	ok(
		`scan-failure ${code}: the reason says the scan failed and names the exit code`,
		result.status === "indeterminate" && /host scan failed/.test(result.reason) && result.reason.includes(String(code)),
	);
}
{
	// Exit 0 promises a match, so unparsable output means we misread the scan — never that
	// the host is gone.
	const { runner } = makeFakeRunner({
		pids: [],
		ss: "",
		serving: () => false,
		pgrepCode: 0,
		pgrepStdout: "not-a-pid\n",
	});
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	const result = await adapter.probe(CONV);
	ok("scan exit 0 naming no parsable pid: probe → indeterminate", result.status === "indeterminate");
}

// ── indeterminate: host alive but no LS port serves the conversation ─────────
{
	const { runner } = makeFakeRunner({
		pids: [123],
		ss: ssLine(5001, 123),
		serving: () => false, // agy up, but the conv is nowhere
	});
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	const result = await adapter.probe(CONV);
	ok("host-no-conv: probe → indeterminate (NOT dead)", result.status === "indeterminate");
	ok(
		"host-no-conv: indeterminate reason names the unserved conversation",
		result.status === "indeterminate" && /no LS port served/.test(result.reason),
	);
}

// ── VOLATILE route / no cache (봉인 3): a repeated probe re-discovers a CHANGED route ──
{
	let servingPort = 5002;
	const { runner, calls } = makeFakeRunner({
		pids: [123],
		ss: `${ssLine(5002, 123)}\n${ssLine(5003, 123)}`,
		serving: (ls) => ls === `127.0.0.1:${servingPort}`,
	});
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });

	const r1 = await adapter.probe(CONV);
	eq("volatile-route: probe #1 route = 5002", r1.status === "alive" ? r1.route.lsAddress : "(dead)", "127.0.0.1:5002");
	const pgrepAfter1 = calls.filter((c) => c.argv[0] === "pgrep").length;

	// the LS port shifts (per-process, volatile) — a fresh probe must RE-DISCOVER it.
	servingPort = 5003;
	const r2 = await adapter.probe(CONV);
	eq(
		"volatile-route: probe #2 RE-DISCOVERS the changed route = 5003 (no cache)",
		r2.status === "alive" ? r2.route.lsAddress : "(dead)",
		"127.0.0.1:5003",
	);
	ok(
		"volatile-route: probe #2 re-ran the pgrep scan (route never stored across dispatches)",
		calls.filter((c) => c.argv[0] === "pgrep").length === pgrepAfter1 + 1,
	);
	ok("volatile-route: probe #2 re-ran the ss scan", calls.filter((c) => c.argv[0] === "ss").length === 2);
}

// ── send: argv + env; single attempt; non-zero exit throws (fail-loud) ───────
{
	const { runner, calls } = makeFakeRunner({ pids: [123], ss: ssLine(5002, 123), serving: () => true });
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	await adapter.send({ lsAddress: "127.0.0.1:5002" }, CONV, "hello world");
	const sendCall = calls.find((c) => c.argv.includes("send-message"));
	eq("send: argv === [binary, agentapi, send-message, conv, content]", sendCall?.argv, [
		FAKE_BINARY,
		"agentapi",
		"send-message",
		CONV,
		"hello world",
	]);
	eq("send: env ANTIGRAVITY_LS_ADDRESS === the route", sendCall?.env?.ANTIGRAVITY_LS_ADDRESS, "127.0.0.1:5002");
}
{
	const { runner, calls } = makeFakeRunner({
		pids: [123],
		ss: ssLine(5002, 123),
		serving: () => true,
		sendCodes: [1], // first (and only) attempt fails
	});
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	let threw = false;
	try {
		await adapter.send({ lsAddress: "127.0.0.1:5002" }, CONV, "hi");
	} catch (err) {
		threw = true;
		ok("send-fail: error names the non-zero exit", /native-push send failed/.test((err as Error).message));
	}
	ok("send-fail: a non-zero exit THROWS (fail-loud)", threw);
	// NO retry in the adapter: exactly ONE send-message call, no re-probe.
	eq(
		"send-fail: adapter makes exactly ONE send attempt (retry is executor-owned, not here)",
		calls.filter((c) => c.argv.includes("send-message")).length,
		1,
	);
	ok(
		"send-fail: adapter did NOT re-probe after failure (no pgrep/ss triggered by send)",
		!calls.some((c) => c.argv[0] === "pgrep"),
	);
}

// ── Q12: bounded agy calls — no hang on a stalled LS route ───────────────────
{
	// every get-conversation-metadata + send-message call carries a timeout bound.
	const { runner, calls } = makeFakeRunner({ pids: [123], ss: ssLine(5002, 123), serving: () => true });
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	await adapter.probe(CONV);
	await adapter.send({ lsAddress: "127.0.0.1:5002" }, CONV, "hi");
	const metaCall = calls.find((c) => c.argv.includes("get-conversation-metadata"));
	const sendCall = calls.find((c) => c.argv.includes("send-message"));
	eq("timeout: get-conversation-metadata carries the metadata timeout", metaCall?.timeoutMs, AGY_METADATA_TIMEOUT_MS);
	eq("timeout: send-message carries the send timeout", sendCall?.timeoutMs, AGY_SEND_TIMEOUT_MS);
	ok(
		"timeout: pgrep is unbounded (fast local scan)",
		calls.find((c) => c.argv[0] === "pgrep")?.timeoutMs === undefined,
	);
}
{
	// a metadata TIMEOUT (code 124) on the only port → probe INDETERMINATE (never hangs, never dead).
	const { runner } = makeFakeRunner({
		pids: [123],
		ss: ssLine(5002, 123),
		serving: () => true,
		metadataTimeout: true,
	});
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	const result = await adapter.probe(CONV);
	ok(
		"timeout: metadata timeout → probe indeterminate (bounded, not a hang, not dead)",
		result.status === "indeterminate",
	);
}
{
	// a send TIMEOUT (code 124) → throws (fail-loud; executor owns the 1-shot re-probe).
	const { runner } = makeFakeRunner({ pids: [123], ss: ssLine(5002, 123), serving: () => true, sendCodes: [124] });
	const adapter = createAntigravityAdapter({ runner, binary: FAKE_BINARY });
	let threw = false;
	try {
		await adapter.send({ lsAddress: "127.0.0.1:5002" }, CONV, "hi");
	} catch {
		threw = true;
	}
	ok("timeout: send timeout (124) → throws (fail-loud)", threw);
}

// ── resolver fail-fast (mirror resolveAcpBackendAdapter) ─────────────────────
eq("resolve: antigravity → the antigravity adapter", resolveNativePushAdapter("antigravity").id, "antigravity");
eq("adapter id: antigravityAdapter.id === antigravity", antigravityAdapter.id, "antigravity");
{
	let threw = false;
	try {
		resolveNativePushAdapter("codex");
	} catch {
		threw = true;
	}
	ok("resolve: unknown backend (codex) → throw (no silent default)", threw);
}
{
	let threw = false;
	try {
		resolveNativePushAdapter("bogus");
	} catch {
		threw = true;
	}
	ok("resolve: bogus backend → throw", threw);
}

// ── Q13 (보정① long-term defense): the native-push file group never reaches for a ──
// mailbox atom. If either the adapter leaf OR the send hand imported
// computeMetaReceiverActive / readMetaReceiverMarker / mailboxConversationalDeliverable, a
// future edit could quietly fold mailbox liveness (watchArmed) into the native-push axis.
{
	const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "pi-extensions", "lib");
	const FORBIDDEN = ["computeMetaReceiverActive", "readMetaReceiverMarker", "mailboxConversationalDeliverable"];
	for (const rel of ["native-push/adapter.ts", "entwurf-v2-native-push.ts", "native-push/register.ts"]) {
		const src = readFileSync(path.join(libDir, rel), "utf8");
		for (const atom of FORBIDDEN) {
			ok(`axis-guard: ${rel} does NOT reference the mailbox atom ${atom} (보정①)`, !src.includes(atom));
		}
	}
}

console.log(`\ncheck-native-push-adapter: ${passed} assertions passed`);
