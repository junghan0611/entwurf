/**
 * herdr-resume-call — the herdr launch of a same-id pi resume (#157 G1a), proven beside the module.
 *
 * Deterministic: herdr is a scripted table of replies, in call order, and an UNSCRIPTED call throws.
 * That is the point of the table — a stage that runs when it should not have is a failed test, not a
 * silent extra read. There is no fake herdr binary here for the reason the fresh rail gives: a fake
 * would agree with whatever we believed on the day we wrote it. The reply shapes are the fresh rail's
 * measured herdr 0.9.0 recordings (scripts/check-herdr-fresh-call.ts), with the pi axis spliced in.
 *
 * Each claim is its own test title, because `run_vitest` attributes a mutant kill from the failed
 * TEST TITLE (run.sh:104-113):
 *
 *   HRESUME-CONTEXT-NO-FALLBACK     outside a complete herdr context nothing runs and nothing goes to tmux
 *   HRESUME-PI-ONLY                 a Claude Code (or any non-pi) target is refused before any herdr call
 *   HRESUME-ARGV-CONTROL-REFUSED    a control character in the runtime argv is refused while it is free
 *   HRESUME-CALLER-WORKSPACE        the workspace is herdr's answer about the caller's OWN pane, or nothing
 *   HRESUME-TAB-ARGV-NO-CALLBACK    the tab create carries the placement policy and the scrub, no callback
 *   HRESUME-START-ARGV-IS-RECORD    pi is started with exactly the record's runtime argv
 *   HRESUME-SUCCESS-RECEIPT         three herdr calls, no settle read, and the receipt is the create reply's
 *   HRESUME-POST-CREATE-RECOVERY    a tab create failure says none or unknown by who failed, never more
 *   HRESUME-CREATED-WORKSPACE       a coherent create reply about another workspace is a named failure,
 *                                   reclaimed, and pi is never started
 *   HRESUME-ROOT-PANE-OCCUPIED      an agent in the created pane stops the start even with no session yet
 *   HRESUME-START-FAILURE-RECLAIMS  a start failure reclaims only through the within-generation witness
 *   HRESUME-PANE-DRIFT-NAMED        a start that names another pane is a named failure, reclaimed
 *   HRESUME-ARGV-DRIFT-NAMED        a start whose echoed argv is not the record's is a named failure
 *   HRESUME-OUTCOME-MAPPING         the v2 seam gets a herdr handle, a refusal, or a failure with recovery
 *   HRESUME-IMPORT-FENCE            the module imports the herdr primitives and node builtins only
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HerdrLayoutDeps, HerdrRun, HerdrSocketOutcome, SpawnFn } from "./herdr-fresh-call.ts";
import {
	buildHerdrResumeTabCreateArgs,
	HERDR_CLAUDE_CODE_SOCKET_PATH_HINT,
	HERDR_PI_DURABLE_RESUME_HINT,
	HERDR_RESUME_HINT,
	type HerdrResumeCallResult,
	herdrClaudeCodeResumeCall,
	herdrClaudeCodeResumeLaunchOutcome,
	herdrPiDurableResumeCall,
	herdrPiDurableResumeLaunchOutcome,
	herdrResumeCall,
	herdrResumeLaunchOutcome,
	launchHerdrResume,
	mintHerdrResumeAgentName,
} from "./herdr-resume-call.ts";
import type { PiDurablePackageLayout } from "./pi-durable-runtime.ts";

// The label is the contract, so it travels as expect's message.
function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const CWD = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-resume-call-"));
const ENV: NodeJS.ProcessEnv = { HERDR_ENV: "1", HERDR_BIN_PATH: "/opt/herdr/bin/herdr", HERDR_PANE_ID: "w7:p1" };
const NAME = "entwurf-resume-0123456789abcdef";
const RUNTIME_ARGS = [
	"--entwurf-control",
	"-e",
	"/opt/entwurf",
	"--session",
	"/home/op/.pi/agent/sessions/-p/2026-08-06T09-37-48-973Z_019fd66f.jsonl",
	"--provider",
	"entwurf",
	"--model",
	"claude-sonnet-5-5",
];
const PI = { backend: "pi", cwd: CWD, runtimeArgs: RUNTIME_ARGS } as const;

type Reply = { status: number; stdout: string; stderr: string };
const okReply = (stdout: string): Reply => ({ status: 0, stdout, stderr: "" });
/** herdr's own failure envelope on stderr with exit 1 (`[file:line @ c77af189]` `src/cli.rs:745-753`). */
const herdrError = (code: string): Reply => ({
	status: 1,
	stdout: "",
	stderr: JSON.stringify({ id: "cli", error: { code, message: code } }),
});
/** What our own runner reports when it never heard from herdr: nonzero, plain text, no envelope. */
const runnerTimeout: Reply = { status: 1, stdout: "", stderr: "herdr tab create: no exit status (timeout 30000ms)" };

function paneReply(pane: Record<string, unknown>): string {
	return JSON.stringify({ id: "cli:pane:get", result: { pane, type: "pane_info" } });
}
/** The CALLER's own pane: `w7:p1` in workspace `w7`. */
const CALLER_PANE = paneReply({
	agent_status: "unknown",
	pane_id: "w7:p1",
	tab_id: "w7:t0",
	terminal_id: "term_caller",
	workspace_id: "w7",
});
/** Verbatim `tab create` shape (herdr 0.9.0, 2026-09-15): the new tab and its initial pane together. */
const TAB_OK = JSON.stringify({
	id: "cli:tab:create",
	result: {
		root_pane: {
			agent_status: "unknown",
			pane_id: "w7:p7",
			tab_id: "w7:t1",
			terminal_id: "term_65b6e1ce2b3db16",
			workspace_id: "w7",
		},
		tab: { agent_status: "unknown", pane_count: 1, tab_id: "w7:t1", workspace_id: "w7" },
		type: "tab_created",
	},
});
/** `agent start` on the pi axis: herdr echoes the canonical executable plus our args. */
function startReply(over: { paneId?: string; argv?: readonly string[] } = {}): string {
	return JSON.stringify({
		id: "cli:agent:start",
		result: {
			agent: {
				agent: "pi",
				agent_status: "idle",
				interactive_ready: true,
				pane_id: over.paneId ?? "w7:p7",
				tab_id: "w7:t1",
				terminal_id: "term_65b6e1ce2b3db16",
				workspace_id: "w7",
			},
			argv: over.argv ?? ["pi", ...RUNTIME_ARGS],
			type: "agent_started",
		},
	});
}
/** The reclaim's within-generation read of the pane we created: empty, or holding an agent. */
const CREATED_PANE_EMPTY = paneReply({
	agent_status: "unknown",
	pane_id: "w7:p7",
	tab_id: "w7:t1",
	terminal_id: "term_65b6e1ce2b3db16",
	workspace_id: "w7",
});
const CREATED_PANE_OCCUPIED = paneReply({
	agent: "pi",
	agent_status: "working",
	pane_id: "w7:p7",
	tab_id: "w7:t1",
	terminal_id: "term_65b6e1ce2b3db16",
	workspace_id: "w7",
});
const CLOSE_OK = JSON.stringify({ id: "cli:pane:close", result: { type: "ok" } });

function scripted(replies: readonly Reply[]): {
	makeRun: (bin: string) => HerdrRun;
	calls: string[][];
	bins: string[];
} {
	const calls: string[][] = [];
	const bins: string[] = [];
	let next = 0;
	const run: HerdrRun = async (args) => {
		calls.push([...args]);
		const reply = replies[next++];
		if (reply === undefined) throw new Error(`unscripted herdr call #${next}: ${args.join(" ")}`);
		return reply;
	};
	return {
		makeRun: (bin) => {
			bins.push(bin);
			return run;
		},
		calls,
		bins,
	};
}

const EXPECTED_TAB_ARGV = [
	"tab",
	"create",
	"--workspace",
	"w7",
	"--no-focus",
	"--cwd",
	CWD,
	"--env",
	"PI_SESSION_ID=",
	"--env",
	"PI_AGENT_ID=",
];
const EXPECTED_START_ARGV = [
	"agent",
	"start",
	NAME,
	"--kind",
	"pi",
	"--pane",
	"w7:p7",
	"--timeout",
	"240000",
	"--",
	...RUNTIME_ARGS,
];
const same = (a: readonly unknown[], b: readonly unknown[]): boolean => JSON.stringify(a) === JSON.stringify(b);
const CALLER_GET = ["pane", "get", "w7:p1"];

describe("pre-mutation refusals", () => {
	it("[QK:HRESUME-CONTEXT-NO-FALLBACK] outside a complete herdr context the launch refuses by its herdr name — no runner is built, no herdr call is made, and nothing is handed to tmux", async () => {
		const noBin = scripted([]);
		const noPane = scripted([]);
		const missingBin = await herdrResumeCall(PI, noBin.makeRun, { HERDR_ENV: "1", HERDR_PANE_ID: "w7:p1" }, NAME);
		const missingPane = await herdrResumeCall(
			PI,
			noPane.makeRun,
			{ HERDR_ENV: "1", HERDR_BIN_PATH: "/opt/herdr/bin/herdr" },
			NAME,
		);
		ok(
			"no HERDR_BIN_PATH → herdr-context-missing; no HERDR_PANE_ID → herdr-caller-pane-missing; neither builds a runner",
			!missingBin.ok &&
				missingBin.reason === "herdr-context-missing" &&
				!missingPane.ok &&
				missingPane.reason === "herdr-caller-pane-missing" &&
				noBin.bins.length + noPane.bins.length === 0 &&
				noBin.calls.length + noPane.calls.length === 0,
		);
	});

	it("[QK:HRESUME-PI-ONLY] on the agent-start path a Claude Code target — or any non-pi one — is refused as herdr-resume-backend-unsupported before any herdr call: agent start types into the pane's shell, so the pane's direct child would not be the runtime its observation joins", async () => {
		const claude = scripted([]);
		const codex = scripted([]);
		const cc = await herdrResumeCall({ ...PI, backend: "claude-code" }, claude.makeRun, ENV, NAME);
		const cx = await herdrResumeCall({ ...PI, backend: "codex" }, codex.makeRun, ENV, NAME);
		ok(
			"claude-code and codex are both the named pi-only refusal, with no runner and no call",
			!cc.ok &&
				cc.reason === "herdr-resume-backend-unsupported" &&
				!cx.ok &&
				cx.reason === "herdr-resume-backend-unsupported" &&
				claude.calls.length + codex.calls.length === 0 &&
				claude.bins.length + codex.bins.length === 0,
		);
		ok(
			"its hint names the three backends herdr reopens, this path's pi alone, and that nothing went to tmux instead",
			/reopens pi, pi-durable and Claude Code;/.test(HERDR_RESUME_HINT["herdr-resume-backend-unsupported"]) &&
				/agent-start path carries pi alone/.test(HERDR_RESUME_HINT["herdr-resume-backend-unsupported"]) &&
				/nothing was sent to tmux/.test(HERDR_RESUME_HINT["herdr-resume-backend-unsupported"]),
		);
	});

	it("[QK:HRESUME-ARGV-CONTROL-REFUSED] a control character anywhere in the recorded runtime argv is refused before any herdr call — herdr would refuse it only after the tab exists", async () => {
		const table = scripted([]);
		const result = await herdrResumeCall(
			{ ...PI, runtimeArgs: [...RUNTIME_ARGS.slice(0, -1), "claude-sonnet\n5-5"] },
			table.makeRun,
			ENV,
			NAME,
		);
		ok(
			"herdr-argv-control-character, no call",
			!result.ok && result.reason === "herdr-argv-control-character" && table.calls.length === 0,
		);
	});

	it("a recorded start directory that is gone, relative or not a directory is refused by name before any herdr call", async () => {
		const gone = scripted([]);
		const relative = scripted([]);
		const file = path.join(CWD, "a-file");
		fs.writeFileSync(file, "");
		const notDir = scripted([]);
		const a = await herdrResumeCall({ ...PI, cwd: path.join(CWD, "gone") }, gone.makeRun, ENV, NAME);
		const b = await herdrResumeCall({ ...PI, cwd: "relative/dir" }, relative.makeRun, ENV, NAME);
		const c = await herdrResumeCall({ ...PI, cwd: file }, notDir.makeRun, ENV, NAME);
		ok(
			"cwd-missing, cwd-not-absolute, cwd-not-directory — and not one herdr call among them",
			!a.ok &&
				a.reason === "cwd-missing" &&
				!b.ok &&
				b.reason === "cwd-not-absolute" &&
				!c.ok &&
				c.reason === "cwd-not-directory" &&
				gone.calls.length + relative.calls.length + notDir.calls.length === 0,
		);
	});

	it("[QK:HRESUME-CALLER-WORKSPACE] the workspace is herdr's answer about the caller's OWN pane: a reply about another pane, or with no workspace, is a refusal and no tab is created", async () => {
		const drift = scripted([okReply(CALLER_PANE.replace('"w7:p1"', '"w7:p5"'))]);
		const noWorkspace = scripted([
			okReply(paneReply({ agent_status: "unknown", pane_id: "w7:p1", terminal_id: "term_caller" })),
		]);
		const unreadable = scripted([herdrError("pane_not_found")]);
		const a = await herdrResumeCall(PI, drift.makeRun, ENV, NAME);
		const b = await herdrResumeCall(PI, noWorkspace.makeRun, ENV, NAME);
		const c = await herdrResumeCall(PI, unreadable.makeRun, ENV, NAME);
		ok(
			"drift, missing workspace and a failed read are three named refusals, each after exactly the one read",
			!a.ok &&
				a.reason === "herdr-caller-pane-drift" &&
				!b.ok &&
				b.reason === "herdr-caller-workspace-missing" &&
				!c.ok &&
				c.reason === "herdr-caller-pane-get-failed" &&
				[drift, noWorkspace, unreadable].every((t) => t.calls.length === 1 && same(t.calls[0], CALLER_GET)),
		);
	});
});

describe("the launch", () => {
	it("[QK:HRESUME-TAB-ARGV-NO-CALLBACK] the tab create is a NEW tab in the caller's workspace, named explicitly, without focus, at the record's cwd, with the fixed identity scrub — and no callback or correlation env", async () => {
		const table = scripted([okReply(CALLER_PANE), okReply(TAB_OK), okReply(startReply())]);
		await herdrResumeCall(PI, table.makeRun, ENV, NAME);
		ok(
			"the second herdr call is exactly the resume tab-create argv, and the builder carries no callback env",
			same(table.calls[1] ?? [], EXPECTED_TAB_ARGV) &&
				same(buildHerdrResumeTabCreateArgs({ workspaceId: "w7", cwd: CWD }), EXPECTED_TAB_ARGV) &&
				!table.calls.flat().some((token) => /ENTWURF_CALLBACK|NONCE/i.test(token)),
		);
	});

	it("[QK:HRESUME-START-ARGV-IS-RECORD] pi is started in the created pane with exactly the record's runtime argv after `--`, under herdr's bounded readiness timeout", async () => {
		const table = scripted([okReply(CALLER_PANE), okReply(TAB_OK), okReply(startReply())]);
		await herdrResumeCall(PI, table.makeRun, ENV, NAME);
		ok("the third herdr call is exactly the start argv", same(table.calls[2] ?? [], EXPECTED_START_ARGV));
	});

	it("[QK:HRESUME-SUCCESS-RECEIPT] a launch is exactly three herdr calls with no settle read, and its receipt names the agent it asked herdr to start and the coordinates the CREATE reply gave", async () => {
		const table = scripted([okReply(CALLER_PANE), okReply(TAB_OK), okReply(startReply())]);
		const result = await herdrResumeCall(PI, table.makeRun, ENV, NAME);
		ok(
			"pane get, tab create, agent start — and nothing after: no agent get, no close",
			table.calls.length === 3 &&
				same(table.bins, ["/opt/herdr/bin/herdr"]) &&
				!table.calls.some((c) => c[0] === "agent" && c[1] === "get"),
		);
		ok(
			"the receipt is the requested kind, the record cwd, our agent name and the created tab/pane",
			result.ok &&
				result.receipt.requestedKind === "pi" &&
				result.receipt.cwd === CWD &&
				result.receipt.herdrAgentName === NAME &&
				result.receipt.herdrWorkspaceId === "w7" &&
				result.receipt.herdrTabId === "w7:t1" &&
				result.receipt.herdrPaneId === "w7:p7" &&
				result.receipt.herdrTerminalId === "term_65b6e1ce2b3db16",
		);
	});

	it("the default agent name is random per call and inside herdr's name grammar", () => {
		const a = mintHerdrResumeAgentName();
		const b = mintHerdrResumeAgentName();
		ok(
			"two calls, two names, both `[a-z][a-z0-9_-]{0,31}`",
			a !== b && [a, b].every((n) => /^[a-z][a-z0-9_-]{0,31}$/.test(n)),
		);
	});
});

describe("failures after the first mutation", () => {
	it("[QK:HRESUME-POST-CREATE-RECOVERY] a failed tab create says WHO failed: herdr's own envelope is recovery none with its code, our runner's silence or an unreadable reply is UNKNOWN — and no reclaim is attempted on a tab nobody can name", async () => {
		const declined = scripted([okReply(CALLER_PANE), herdrError("workspace_not_found")]);
		const silent = scripted([okReply(CALLER_PANE), runnerTimeout]);
		const garbled = scripted([okReply(CALLER_PANE), okReply("not json")]);
		const a = await herdrResumeCall(PI, declined.makeRun, ENV, NAME);
		const b = await herdrResumeCall(PI, silent.makeRun, ENV, NAME);
		const c = await herdrResumeCall(PI, garbled.makeRun, ENV, NAME);
		const recovery = (r: HerdrResumeCallResult): string =>
			!r.ok && "recovery" in r ? `${r.reason}:${r.recovery.outcome}:${r.herdrErrorCode ?? "-"}:${"created" in r}` : "?";
		ok(
			"declined → none with the code; silent → unknown with no code; unparsable → unknown; none of them names a created tab",
			recovery(a) === "herdr-tab-create-failed:none:workspace_not_found:false" &&
				recovery(b) === "herdr-tab-create-failed:unknown:-:false" &&
				recovery(c) === "herdr-tab-create-unparsable:unknown:-:false" &&
				[declined, silent, garbled].every((t) => t.calls.length === 2),
		);
	});

	it("[QK:HRESUME-CREATED-WORKSPACE] a create reply that agrees with ITSELF but names another workspace than the caller's one this call asked for is herdr-tab-create-workspace-drift: the created tab is named, the existing conditional reclaim runs, and pi is never started", async () => {
		// Caller in w7, tab create sent `--workspace w7`; herdr answers with a tab AND root pane that
		// both say w8. The shared parser accepts it — it checks the reply against itself — so only the
		// comparison with the request can refuse it.
		const tabInW8 = JSON.stringify({
			id: "cli:tab:create",
			result: {
				root_pane: {
					agent_status: "unknown",
					pane_id: "w8:p2",
					tab_id: "w8:t1",
					terminal_id: "term_w8_root",
					workspace_id: "w8",
				},
				tab: { agent_status: "unknown", pane_count: 1, tab_id: "w8:t1", workspace_id: "w8" },
				type: "tab_created",
			},
		});
		const w8Empty = paneReply({
			agent_status: "unknown",
			pane_id: "w8:p2",
			tab_id: "w8:t1",
			terminal_id: "term_w8_root",
			workspace_id: "w8",
		});
		const table = scripted([okReply(CALLER_PANE), okReply(tabInW8), okReply(w8Empty), okReply(CLOSE_OK)]);
		const result = await herdrResumeCall(PI, table.makeRun, ENV, NAME);
		const outcome = herdrResumeLaunchOutcome(result);
		ok(
			"the request named w7, the reply named w8: a named post-create failure carrying the w8 coordinates, reclaimed through the within-generation witness, with no agent start — and the v2 seam receives a failure, not a handle to observe",
			same(table.calls[1] ?? [], EXPECTED_TAB_ARGV) &&
				!result.ok &&
				result.reason === "herdr-tab-create-workspace-drift" &&
				"recovery" in result &&
				result.recovery.outcome === "closed" &&
				JSON.stringify(result.created) ===
					JSON.stringify({
						herdrWorkspaceId: "w8",
						herdrTabId: "w8:t1",
						herdrPaneId: "w8:p2",
						herdrTerminalId: "term_w8_root",
					}) &&
				same(table.calls[2] ?? [], ["pane", "get", "w8:p2"]) &&
				same(table.calls[3] ?? [], ["pane", "close", "w8:p2"]) &&
				table.calls.length === 4 &&
				!table.calls.some((c) => c[0] === "agent") &&
				!outcome.ok &&
				"failure" in outcome &&
				outcome.failure.created?.herdrWorkspaceId === "w8",
		);
	});

	it("[QK:HRESUME-ROOT-PANE-OCCUPIED] a created root pane in which herdr names an agent stops the start even when no agent_session has been reported yet — the created tab is named and the existing conditional reclaim leaves that pane open as agent-present", async () => {
		const tabAgentNoSession = JSON.stringify({
			id: "cli:tab:create",
			result: {
				root_pane: {
					agent: "pi",
					agent_status: "working",
					pane_id: "w7:p7",
					tab_id: "w7:t1",
					terminal_id: "term_65b6e1ce2b3db16",
					workspace_id: "w7",
				},
				tab: { agent_status: "working", pane_count: 1, tab_id: "w7:t1", workspace_id: "w7" },
				type: "tab_created",
			},
		});
		// The fourth reply is never consumed by the guarded code (three calls, asserted below). It bounds
		// the table for a start that should not have happened: start-unparsable, then a reclaim read, so
		// such a run ends at this test's own assertion instead of an unscripted-call throw.
		const table = scripted([
			okReply(CALLER_PANE),
			okReply(tabAgentNoSession),
			okReply(CREATED_PANE_OCCUPIED),
			okReply(CREATED_PANE_OCCUPIED),
		]);
		const result = await herdrResumeCall(PI, table.makeRun, ENV, NAME);
		ok(
			"herdr-tab-root-pane-occupied before any start, the created w7 coordinates, orphan-unreclaimed:agent-present and no close",
			!result.ok &&
				result.reason === "herdr-tab-root-pane-occupied" &&
				"recovery" in result &&
				result.recovery.outcome === "orphan-unreclaimed" &&
				result.recovery.reason === "agent-present" &&
				JSON.stringify(result.created) ===
					JSON.stringify({
						herdrWorkspaceId: "w7",
						herdrTabId: "w7:t1",
						herdrPaneId: "w7:p7",
						herdrTerminalId: "term_65b6e1ce2b3db16",
					}) &&
				table.calls.length === 3 &&
				same(table.calls[2] ?? [], ["pane", "get", "w7:p7"]) &&
				!table.calls.some((c) => c[0] === "agent" || c[1] === "close"),
		);
	});

	it("[QK:HRESUME-START-FAILURE-RECLAIMS] a start failure reclaims through the within-generation witness only: an empty created pane is closed, a pane holding an agent is left open and named — and either way the created tab and herdr's code come back", async () => {
		const closed = scripted([
			okReply(CALLER_PANE),
			okReply(TAB_OK),
			herdrError("timeout"),
			okReply(CREATED_PANE_EMPTY),
			okReply(CLOSE_OK),
		]);
		const occupied = scripted([
			okReply(CALLER_PANE),
			okReply(TAB_OK),
			herdrError("timeout"),
			okReply(CREATED_PANE_OCCUPIED),
		]);
		const a = await herdrResumeCall(PI, closed.makeRun, ENV, NAME);
		const b = await herdrResumeCall(PI, occupied.makeRun, ENV, NAME);
		const created = {
			herdrWorkspaceId: "w7",
			herdrTabId: "w7:t1",
			herdrPaneId: "w7:p7",
			herdrTerminalId: "term_65b6e1ce2b3db16",
		};
		ok(
			"empty → closed exactly that pane; occupied → orphan-unreclaimed:agent-present with no close call",
			!a.ok &&
				"recovery" in a &&
				a.reason === "herdr-agent-start-failed" &&
				a.herdrErrorCode === "timeout" &&
				a.recovery.outcome === "closed" &&
				same(closed.calls[4] ?? [], ["pane", "close", "w7:p7"]) &&
				JSON.stringify(a.created) === JSON.stringify(created) &&
				!b.ok &&
				"recovery" in b &&
				b.recovery.outcome === "orphan-unreclaimed" &&
				b.recovery.reason === "agent-present" &&
				occupied.calls.length === 4 &&
				!occupied.calls.some((c) => c[1] === "close") &&
				JSON.stringify(b.created) === JSON.stringify(created),
		);
	});

	it("[QK:HRESUME-PANE-DRIFT-NAMED] a start that reports a different pane than the one created is herdr-agent-start-pane-drift, not a launch, and the reclaim starts from the create reply", async () => {
		const table = scripted([
			okReply(CALLER_PANE),
			okReply(TAB_OK),
			okReply(startReply({ paneId: "w7:p8" })),
			okReply(CREATED_PANE_OCCUPIED),
		]);
		const result = await herdrResumeCall(PI, table.makeRun, ENV, NAME);
		ok(
			"pane drift is named, and the reclaim read is of the CREATED pane",
			!result.ok &&
				result.reason === "herdr-agent-start-pane-drift" &&
				same(table.calls[3] ?? [], ["pane", "get", "w7:p7"]),
		);
	});

	it("[QK:HRESUME-ARGV-DRIFT-NAMED] a start whose echoed argv is not the canonical executable plus the record's argv is herdr-agent-start-argv-drift — a pi started on something else is not the citizen this call reopened", async () => {
		const table = scripted([
			okReply(CALLER_PANE),
			okReply(TAB_OK),
			okReply(startReply({ argv: ["pi", "--entwurf-control"] })),
			okReply(CREATED_PANE_OCCUPIED),
		]);
		const result = await herdrResumeCall(PI, table.makeRun, ENV, NAME);
		ok(
			"argv drift is named and reclaimed conditionally (here: an agent is present, so nothing is closed)",
			!result.ok &&
				result.reason === "herdr-agent-start-argv-drift" &&
				"recovery" in result &&
				result.recovery.outcome === "orphan-unreclaimed",
		);
	});
});

describe("the v2 seam and the fence", () => {
	it("[QK:HRESUME-OUTCOME-MAPPING] the v2 seam receives a rail-herdr handle on success, a bare reason and hint on a refusal, and on a post-create failure the rail, herdr's code, the recovery and the created tab", () => {
		const receipt = {
			requestedKind: "pi",
			cwd: CWD,
			herdrAgentName: NAME,
			herdrWorkspaceId: "w7",
			herdrTabId: "w7:t1",
			herdrPaneId: "w7:p7",
			herdrTerminalId: "term_65b6e1ce2b3db16",
		};
		const success = herdrResumeLaunchOutcome({ ok: true, receipt });
		const refusal = herdrResumeLaunchOutcome({ ok: false, reason: "herdr-resume-backend-unsupported" });
		const failure = herdrResumeLaunchOutcome({
			ok: false,
			reason: "herdr-agent-start-failed",
			herdrErrorCode: "timeout",
			recovery: { outcome: "orphan-unreclaimed", paneId: "w7:p7", reason: "agent-present" },
			created: {
				herdrWorkspaceId: "w7",
				herdrTabId: "w7:t1",
				herdrPaneId: "w7:p7",
				herdrTerminalId: "term_65b6e1ce2b3db16",
			},
		});
		ok(
			"success → {rail:herdr, …receipt}; refusal → no failure key; failure → rail, vendorCode, recovery, created",
			success.ok &&
				JSON.stringify(success.handle) === JSON.stringify({ rail: "herdr", ...receipt }) &&
				!refusal.ok &&
				!("failure" in refusal) &&
				refusal.hint === HERDR_RESUME_HINT["herdr-resume-backend-unsupported"] &&
				!failure.ok &&
				"failure" in failure &&
				failure.failure.rail === "herdr" &&
				failure.failure.vendorCode === "timeout" &&
				failure.failure.recovery.outcome === "orphan-unreclaimed" &&
				failure.failure.created?.herdrTabId === "w7:t1",
		);
		ok(
			"every reason this rail can answer with has a non-empty hint",
			Object.values(HERDR_RESUME_HINT).length === 19 &&
				Object.values(HERDR_RESUME_HINT).every((hint) => typeof hint === "string" && hint.length > 0),
		);
	});

	it("[QK:HRESUME-IMPORT-FENCE] the module imports the herdr primitives and two node builtins, and nothing else — no mux, no entwurf core, no record store, no dynamic import", () => {
		const src = fs.readFileSync(new URL("./herdr-resume-call.ts", import.meta.url), "utf8");
		const specifiers = [
			...src.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm),
			...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
		].map((m) => m[1]);
		ok(
			"exactly ./herdr-fresh-call.ts, node:child_process and node:crypto",
			same([...specifiers].sort(), ["./herdr-fresh-call.ts", "node:child_process", "node:crypto"]) &&
				!/\bimport\s*\(|\brequire\s*\(/.test(src),
		);
	});
});

// ══ #157 B3: the pi-durable same-id resume, ONE layout.apply ═══════════════════════
// herdr is a scripted socket here, in request order, and an unscripted request throws — the same
// discipline as the CLI table above. Replies are built from the request they answer, in the shapes the
// fresh layout branch's own gate records (scripts/check-herdr-fresh-call.ts).
describe("the pi-durable layout resume (#157 B3)", () => {
	const ENV_PD: NodeJS.ProcessEnv = { ...ENV, HERDR_SOCKET_PATH: "/run/herdr/herdr.sock" };
	const BASE = "entwurf-resume-fedcba9876543210";
	const ADOPT_ENV = {
		PI_CODING_AGENT_DIR: "/home/op/profiles/../profiles/pd/",
		ENTWURF_META_SESSIONS_DIR: "/home/op/meta/meta-sessions",
		ENTWURF_META_MAILBOX_DIR: "/home/op/meta/meta-mailbox",
		ENTWURF_META_SENDERS_DIR: "/home/op/meta/meta-senders",
		ENTWURF_META_RECEIVERS_DIR: "/home/op/meta/meta-receivers",
	} as const;
	const PD_ARGS = [
		"pi-durable",
		"--entwurf-adopt",
		JSON.stringify({
			v: 1,
			gardenId: "20261102T000000-abcdef",
			metaRoot: "/home/op/meta",
			sourceGeneration: "a".repeat(32),
		}),
	];
	const PD = { cwd: CWD, runtimeArgs: PD_ARGS, adoptEnv: ADOPT_ENV };
	const PKG = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-resume-pd-pkg-"));
	const LAUNCHER = path.join(PKG, "run.sh");
	fs.writeFileSync(LAUNCHER, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const NO_LAUNCHER = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-resume-pd-nolauncher-"));
	const layoutAt = (root: string) => ({ root }) as unknown as PiDurablePackageLayout;

	type Responder = (requestLine: string) => HerdrSocketOutcome;
	function socketScript(replies: readonly Responder[]) {
		const requests: Record<string, unknown>[] = [];
		const paths: string[] = [];
		let next = 0;
		const factory = (socketPath: string) => {
			paths.push(socketPath);
			return async (line: string): Promise<HerdrSocketOutcome> => {
				requests.push(JSON.parse(line));
				const reply = replies[next++];
				if (reply === undefined) throw new Error(`unscripted herdr socket request #${next}: ${line}`);
				return reply(line);
			};
		};
		return { factory, requests, paths };
	}
	const idOf = (line: string): string => (JSON.parse(line) as { id: string }).id;
	const paneGetOk: Responder = (line) => ({
		kind: "reply",
		line: JSON.stringify({
			id: idOf(line),
			result: {
				type: "pane_info",
				pane: {
					pane_id: "w7:p1",
					terminal_id: "term_caller",
					tab_id: "w7:t0",
					focused: true,
					revision: 3,
					agent_status: "unknown",
					workspace_id: "w7",
				},
			},
		}),
	});
	const errorReply =
		(code: string): Responder =>
		(line) => ({ kind: "reply", line: JSON.stringify({ id: idOf(line), error: { code, message: code } }) });
	const layoutOk: Responder = (line) => {
		const request = JSON.parse(line) as {
			id: string;
			params: { workspace_id: string; root: { cwd: string; command: string[] } };
		};
		return {
			kind: "reply",
			line: JSON.stringify({
				id: request.id,
				result: {
					type: "layout_apply",
					layout: {
						workspace_id: request.params.workspace_id,
						tab_id: "w7:t9",
						zoomed: false,
						focused_pane_id: "w7:p9",
						root: {
							type: "pane",
							pane_id: "w7:p9",
							cwd: request.params.root.cwd,
							command: request.params.root.command,
						},
					},
				},
			}),
		};
	};
	const deps = (factory: HerdrLayoutDeps["socket"], over: Partial<HerdrLayoutDeps> = {}): HerdrLayoutDeps => ({
		socket: factory,
		callerProcessCwd: () => {
			throw new Error("a resume never reads the caller's process cwd — its directory is the reservation's");
		},
		packageLayout: () => layoutAt(PKG),
		runtimeVerdict: () => null,
		...over,
	});
	const noSpawn = (() => {
		throw new Error("the pi-durable resume never spawns the herdr CLI");
	}) as unknown as SpawnFn;

	it("[QK:HRESUME-PD-ROUTED] inside herdr a pi-durable resume goes to the layout launch — refused here for the absent socket endpoint the pi path never asks for — while a backend herdr does not reopen still reaches the pi-only path; a pi-durable input without its projection is a wiring defect", async () => {
		const routed = await launchHerdrResume(
			{ backend: "pi-durable", cwd: CWD, runtimeArgs: PD_ARGS, piDurableAdoptEnv: ADOPT_ENV },
			ENV,
			noSpawn,
		);
		const claude = await launchHerdrResume({ backend: "codex", cwd: CWD, runtimeArgs: [] }, ENV, noSpawn);
		let unprojected: unknown = null;
		try {
			await launchHerdrResume({ backend: "pi-durable", cwd: CWD, runtimeArgs: PD_ARGS }, ENV_PD, noSpawn);
		} catch (err) {
			unprojected = err;
		}
		ok(
			"pi-durable → herdr-socket-path-missing; codex → the pi-only refusal; no projection → throws",
			!routed.ok &&
				routed.reason === "herdr-socket-path-missing" &&
				!claude.ok &&
				claude.reason === "herdr-resume-backend-unsupported" &&
				unprojected instanceof Error &&
				/without its adopt projection/.test(unprojected.message),
		);
	});

	it("[QK:HRESUME-PD-PRE-WRITE-REFUSALS] every refusal is decided before the layout write: context, cwd, endpoint, package, runtime, launcher and a control character with no socket request at all, and a failed caller-pane read with that one read only", async () => {
		const zero = socketScript([]);
		const cases = [
			await herdrPiDurableResumeCall(PD, { HERDR_ENV: "1" }, deps(zero.factory), BASE),
			await herdrPiDurableResumeCall({ ...PD, cwd: path.join(CWD, "gone") }, ENV_PD, deps(zero.factory), BASE),
			await herdrPiDurableResumeCall(PD, ENV, deps(zero.factory), BASE),
			await herdrPiDurableResumeCall(PD, ENV_PD, deps(zero.factory, { packageLayout: () => null }), BASE),
			await herdrPiDurableResumeCall(
				PD,
				ENV_PD,
				deps(zero.factory, { runtimeVerdict: () => "pi-durable-carrier-drift" }),
				BASE,
			),
			await herdrPiDurableResumeCall(
				PD,
				ENV_PD,
				deps(zero.factory, { packageLayout: () => layoutAt(NO_LAUNCHER) }),
				BASE,
			),
			await herdrPiDurableResumeCall(
				{ ...PD, adoptEnv: { ...ADOPT_ENV, PI_CODING_AGENT_DIR: "/home/op/pd\u0085" } },
				ENV_PD,
				deps(zero.factory),
				BASE,
			),
		];
		ok(
			"seven named refusals, no socket opened, nothing written",
			same(
				cases.map((c) => (c.ok ? "ok" : c.reason)),
				[
					"herdr-context-missing",
					"cwd-missing",
					"herdr-socket-path-missing",
					"pi-durable-package-incomplete",
					"pi-durable-carrier-drift",
					"pi-durable-launcher-missing",
					"herdr-argv-control-character",
				],
			) &&
				cases.every((c) => !c.ok && !("recovery" in c)) &&
				zero.paths.length === 0 &&
				zero.requests.length === 0,
		);
		const paneFailed = socketScript([errorReply("pane_not_found")]);
		const refused = await herdrPiDurableResumeCall(PD, ENV_PD, deps(paneFailed.factory), BASE);
		ok(
			"a caller-pane read herdr declined is a refusal with herdr's code reported, after that read alone",
			!refused.ok &&
				refused.reason === "herdr-caller-pane-get-failed" &&
				!("recovery" in refused) &&
				refused.reported?.errorCode === "pane_not_found" &&
				paneFailed.requests.length === 1 &&
				paneFailed.requests[0]?.method === "pane.get",
		);
	});

	it("[QK:HRESUME-PD-LAYOUT-PACKET] the ONE layout write opens an unfocused pane tab in the caller's own workspace at the reservation's cwd, runs the verified launcher with the record-derived argv untouched, and carries an env map of exactly the identity scrub plus the five adopt names", async () => {
		const script = socketScript([paneGetOk, layoutOk]);
		await herdrPiDurableResumeCall(PD, ENV_PD, deps(script.factory), BASE);
		const write = script.requests[1] as {
			id: string;
			method: string;
			params: { workspace_id: string; focus: boolean; root: Record<string, unknown> };
		};
		ok(
			"one endpoint, a read then the write, ids from this call's base",
			same(script.paths, ["/run/herdr/herdr.sock"]) &&
				script.requests.length === 2 &&
				script.requests[0]?.method === "pane.get" &&
				script.requests[0]?.id === `${BASE}:pane.get` &&
				write.method === "layout.apply" &&
				write.id === `${BASE}:layout.apply`,
		);
		ok(
			"workspace w7, no focus, the reservation's cwd, [launcher, ...argv] and the exact env map",
			write.params.workspace_id === "w7" &&
				write.params.focus === false &&
				write.params.root.type === "pane" &&
				write.params.root.cwd === CWD &&
				same(write.params.root.command as unknown[], [LAUNCHER, ...PD_ARGS]) &&
				JSON.stringify(write.params.root.env) === JSON.stringify({ PI_SESSION_ID: "", PI_AGENT_ID: "", ...ADOPT_ENV }),
		);
	});

	it("[QK:HRESUME-PD-SUCCESS-RECEIPT] a layout reply that proves THIS launch is the receipt — launcher, requested cwd and herdr's view coordinates, no agent name or terminal — and the v2 seam gets a herdr-layout handle", async () => {
		const result = await herdrPiDurableResumeCall(PD, ENV_PD, deps(socketScript([paneGetOk, layoutOk]).factory), BASE);
		const seam = herdrPiDurableResumeLaunchOutcome(result);
		ok(
			"receipt and handle",
			result.ok &&
				JSON.stringify(result.receipt) ===
					JSON.stringify({
						runtime: LAUNCHER,
						cwd: CWD,
						herdrWorkspaceId: "w7",
						herdrTabId: "w7:t9",
						herdrPaneId: "w7:p9",
					}) &&
				seam.ok &&
				seam.handle.rail === "herdr-layout" &&
				!("herdrAgentName" in seam.handle) &&
				!("herdrTerminalId" in seam.handle),
		);
	});

	it("[QK:HRESUME-PD-WRITE-CERTAINTY] after the write, nothing-created is only the layout classifier's own none — a request never written, or a pre-create herdr code — and every other answer is unknown; the v2 seam receives that recovery unchanged with herdr's code", async () => {
		const afterWrite = async (reply: Responder) => {
			const result = await herdrPiDurableResumeCall(PD, ENV_PD, deps(socketScript([paneGetOk, reply]).factory), BASE);
			return { result, seam: herdrPiDurableResumeLaunchOutcome(result) };
		};
		const neverWritten = await afterWrite(() => ({ kind: "connect-failed", code: "ECONNREFUSED" }));
		const declined = await afterWrite(errorReply("workspace_not_found"));
		const applyFailed = await afterWrite(errorReply("layout_apply_failed"));
		const timedOut = await afterWrite(() => ({ kind: "timeout" }));
		const drifted = await afterWrite((line) => {
			const base = layoutOk(line);
			return base.kind === "reply"
				? { kind: "reply", line: base.line.replace('"workspace_id":"w7"', '"workspace_id":"w8"') }
				: base;
		});
		const outcome = (x: Awaited<ReturnType<typeof afterWrite>>) =>
			!x.seam.ok && "failure" in x.seam ? x.seam.failure.recovery.outcome : "not-a-failure";
		ok(
			"none / none / unknown / unknown / unknown, each a seam failure carrying it",
			same([neverWritten, declined, applyFailed, timedOut, drifted].map(outcome), [
				"none",
				"none",
				"unknown",
				"unknown",
				"unknown",
			]),
		);
		ok(
			"herdr's own code travels as the vendor code",
			!declined.seam.ok &&
				"failure" in declined.seam &&
				declined.seam.failure.vendorCode === "workspace_not_found" &&
				!applyFailed.seam.ok &&
				"failure" in applyFailed.seam &&
				applyFailed.seam.failure.vendorCode === "layout_apply_failed",
		);
		ok(
			"every pi-durable reason this rail can answer with has a non-empty hint",
			Object.values(HERDR_PI_DURABLE_RESUME_HINT).length === 21 &&
				Object.values(HERDR_PI_DURABLE_RESUME_HINT).every((hint) => typeof hint === "string" && hint.length > 0),
		);
	});

	it("[QK:HRESUME-PD-FAILURE-RAIL] a pi-durable layout failure reaches the v2 seam tagged `herdr-layout`, never the pi rail's `herdr`, so its receipt names the layout.apply step and no tab create", async () => {
		const declined = await herdrPiDurableResumeCall(
			PD,
			ENV_PD,
			deps(socketScript([paneGetOk, errorReply("workspace_not_found")]).factory),
			BASE,
		);
		const timedOut = await herdrPiDurableResumeCall(
			PD,
			ENV_PD,
			deps(socketScript([paneGetOk, () => ({ kind: "timeout" })]).factory),
			BASE,
		);
		ok(
			"a none and an unknown failure, each tagged herdr-layout",
			[declined, timedOut].every((result) => {
				const seam = herdrPiDurableResumeLaunchOutcome(result);
				return !seam.ok && "failure" in seam && seam.failure.rail === "herdr-layout";
			}),
		);
	});

	// ── #157 stage 4: the Claude Code same-id resume, ONE layout.apply + ONE pane.process_info ──
	describe("the Claude Code layout resume (#157 stage 4)", () => {
		const CC_ARGS = ["--resume", "0b5e2a4c-1f3d-4e8a-9c7b-2d6f8e1a3c5d"];
		const CC = { cwd: CWD, runtimeArgs: CC_ARGS };
		const processInfo =
			(over: { paneId?: string; shellPid?: unknown; type?: string } = {}): Responder =>
			(line) => ({
				kind: "reply",
				line: JSON.stringify({
					id: idOf(line),
					result: {
						type: over.type ?? "pane_process_info",
						process_info: {
							pane_id: over.paneId ?? "w7:p9",
							shell_pid: "shellPid" in over ? over.shellPid : 424242,
							foreground_process_group_id: 424242,
							foreground_processes: [],
						},
					},
				}),
			});

		it("[QK:HRESUME-CC-LAYOUT-VECTOR] inside herdr a Claude Code resume is routed to ONE layout.apply running `claude` plus the record's argv untouched, at the record's cwd, with exactly the identity scrub as its env — a read before it, ONE process read of the pane it created after it, and nothing else", async () => {
			const script = socketScript([paneGetOk, layoutOk, processInfo()]);
			await herdrClaudeCodeResumeCall(CC, ENV_PD, { socket: script.factory }, BASE);
			const write = script.requests[1] as {
				method: string;
				params: { workspace_id: string; focus: boolean; root: Record<string, unknown> };
			};
			const read = script.requests[2] as { id: string; method: string; params: { pane_id: string } };
			ok(
				"pane.get, layout.apply, pane.process_info on the created pane — three requests on one endpoint",
				same(script.paths, ["/run/herdr/herdr.sock"]) &&
					same(
						script.requests.map((r) => r.method),
						["pane.get", "layout.apply", "pane.process_info"],
					) &&
					read.id === `${BASE}:pane.process_info` &&
					read.params.pane_id === "w7:p9",
			);
			ok(
				"workspace w7, no focus, the record's cwd, [claude, ...argv] and the scrub alone",
				write.params.workspace_id === "w7" &&
					write.params.focus === false &&
					write.params.root.cwd === CWD &&
					same(write.params.root.command as unknown[], ["claude", ...CC_ARGS]) &&
					JSON.stringify(write.params.root.env) === JSON.stringify({ PI_SESSION_ID: "", PI_AGENT_ID: "" }),
			);
			const routed = await launchHerdrResume({ backend: "claude-code", cwd: CWD, runtimeArgs: CC_ARGS }, ENV, noSpawn);
			ok(
				"the production router sends claude-code to the layout launch (refused here for the absent endpoint), not the pi-only path",
				!routed.ok && routed.reason === "herdr-socket-path-missing",
			);
		});

		it("[QK:HRESUME-CC-PANE-CHILD] the process read yields a join pid only when herdr describes THIS pane with a direct child above 1; another pane, a null child, an error or a lost reply is `unread` with its cause — and the launch is still a receipt, because the tab exists", async () => {
			const run = async (reply: Responder) =>
				herdrClaudeCodeResumeCall(CC, ENV_PD, { socket: socketScript([paneGetOk, layoutOk, reply]).factory }, BASE);
			const good = await run(processInfo());
			const otherPane = await run(processInfo({ paneId: "w7:p1" }));
			const exited = await run(processInfo({ shellPid: null }));
			const failed = await run(errorReply("pane_not_found"));
			const lost = await run(() => ({ kind: "timeout" }));
			const child = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? r.receipt.paneChild : null);
			ok(
				"pid 424242 from the created pane",
				good.ok &&
					JSON.stringify(good.receipt) ===
						JSON.stringify({
							runtime: "claude",
							cwd: CWD,
							herdrWorkspaceId: "w7",
							herdrTabId: "w7:t9",
							herdrPaneId: "w7:p9",
							paneChild: { pid: "424242" },
						}),
			);
			ok(
				"four receipts whose paneChild is unread, each with a cause",
				[otherPane, exited, failed, lost].every((r) => {
					const c = child(r);
					return c !== null && "unread" in c && c.unread.length > 0;
				}) &&
					/does not describe the pane/.test(JSON.stringify(child(otherPane))) &&
					/shell_pid null/.test(JSON.stringify(child(exited))) &&
					/pane_not_found/.test(JSON.stringify(child(failed))) &&
					/timeout/.test(JSON.stringify(child(lost))),
			);
			const seam = herdrClaudeCodeResumeLaunchOutcome(good);
			ok(
				"the v2 seam gets its own herdr-layout-claude handle carrying the pid",
				seam.ok && seam.handle.rail === "herdr-layout-claude" && JSON.stringify(seam.handle).includes('"pid":"424242"'),
			);
		});

		it("[QK:HRESUME-CC-FAILURE-SHARED] a refusal or layout failure of the Claude Code launch is the pi-durable layout branch's own word and certainty — a refusal before the write sends nothing, after the write the seam gets the layout's none or unknown, never a process read, and the one shared hint that names a backend names Claude Code", async () => {
			const zero = socketScript([]);
			const refused = await herdrClaudeCodeResumeCall(
				{ ...CC, cwd: "relative" },
				ENV_PD,
				{ socket: zero.factory },
				BASE,
			);
			const controlChar = await herdrClaudeCodeResumeCall(
				{ ...CC, runtimeArgs: ["--resume", "x\u0085"] },
				ENV_PD,
				{ socket: zero.factory },
				BASE,
			);
			const noEndpoint = herdrClaudeCodeResumeLaunchOutcome(
				await herdrClaudeCodeResumeCall(CC, ENV, { socket: zero.factory }, BASE),
			);
			const declined = socketScript([paneGetOk, errorReply("workspace_not_found")]);
			const declinedResult = await herdrClaudeCodeResumeCall(CC, ENV_PD, { socket: declined.factory }, BASE);
			const seam = herdrClaudeCodeResumeLaunchOutcome(declinedResult);
			ok(
				"cwd-not-absolute and herdr-argv-control-character with no socket request",
				!refused.ok &&
					refused.reason === "cwd-not-absolute" &&
					!controlChar.ok &&
					controlChar.reason === "herdr-argv-control-character" &&
					zero.requests.length === 0,
			);
			ok(
				"a declined write is the layout's none, tagged herdr-layout, worded as the pi-durable table words it, and no process read follows",
				!seam.ok &&
					"failure" in seam &&
					seam.failure.rail === "herdr-layout" &&
					seam.failure.recovery.outcome === "none" &&
					seam.hint.startsWith(HERDR_PI_DURABLE_RESUME_HINT["herdr-layout-apply-refused"]) &&
					declined.requests.length === 2,
			);
			ok(
				"the one shared word whose hint names a backend names Claude Code here, never pi-durable",
				!noEndpoint.ok &&
					noEndpoint.reason === "herdr-socket-path-missing" &&
					noEndpoint.hint === HERDR_CLAUDE_CODE_SOCKET_PATH_HINT &&
					/Claude Code's one layout request/.test(noEndpoint.hint) &&
					!/pi-durable/.test(noEndpoint.hint),
			);
		});
	});
});
