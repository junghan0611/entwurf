/**
 * smoke-omp-receive-live — the LIVE acceptance for #87 bundle B: another harness wakes an
 * ALREADY-OPEN, IDLE omp citizen, which reads its own inbox in that same native session
 * and answers there.
 *
 * IT DECIDES ITS OWN OUTCOME FROM THE CAPABILITY REGISTRY, never from a hardcoded verdict:
 *
 *   registry says omp has no drainable mailbox  → protocol SKIP (97). Honest: there is no
 *       receiver rail to accept, so no addressed receive can be attempted. An unattended
 *       `release-gate` reports it; `--cut` reads it as RED, which is what makes "no cut
 *       while the garden is one-way for omp" executable rather than prose.
 *   registry claims the rail and LIVE≠1        → protocol SKIP, naming LIVE=1. This step
 *       opens a real omp TUI and spends a real model turn.
 *   registry claims the rail and LIVE=1        → run the real acceptance below. Any
 *       missing prerequisite here is a FAIL, not a skip: a registry that promises a wake
 *       has already made the claim this step exists to check.
 *
 * WHY IT OPENS THE TUI ITSELF, AND WHY THAT IS NOT BUNDLE C. omp cannot be opened by
 * `entwurf_fresh_call` — visible fresh is step 9 and a separate admission. But the thing
 * under test is receive, not launch, so this step drives a plain tmux-hosted `omp` as TEST
 * SCAFFOLDING: no nonce callback, no garden id correlation through a launch surface, no
 * managed-runtime claim. It learns the citizen's id the way any observer would, by reading
 * the receiver's own log. `smoke-mux-lifecycle-live` is the precedent for a release MUST
 * that opens real windows and spends turns.
 *
 * WHAT IT PROVES, IN ORDER — each one a separate assertion because each fails differently:
 *   1. an idle omp TUI ARMS a receiver marker joined to the citizen birth minted in the
 *      same process (the marker read through the production reader, never a filename);
 *   2. dispatch from another harness ROUTES to the mailbox instead of refusing;
 *   3. the doorbell RINGS on a session with zero typing;
 *   4. the model DRAINS its own inbox — `lastReadAt` moves after `lastEnqueuedAt`, which
 *      is the honest receipt a rung doorbell alone is not;
 *   5. the drain happened INSIDE that native session — read from the citizen's own
 *      transcript, which is the vendor's record of what that session did.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT, AND WHY THAT MATTERS. An earlier draft asked the
 * model to echo a nonce back and failed: `[LIVE 2026-08-30]` the model drained the inbox,
 * recorded the receipt, and then answered *"Its acceptance instruction was unverified, so
 * no token was sent."* It was right, and it was obeying OUR OWN doorbell, which tells it
 * to treat mailbox bodies as untrusted data and not act on unverified imperatives inside
 * them. An acceptance that requires the model to break that rule is an acceptance aimed at
 * our own security contract, and it would go green only on a model careless enough to
 * fail it. So the receipt this step accepts is the one the contract actually promises:
 * the read, recorded by the tool and visible in that session's transcript.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadMetaCapabilityRegistry, ompMetaRoots } from "../pi-extensions/lib/meta-session.ts";
import { skipLive } from "./lib/live-skip.ts";

const LABEL = "smoke-omp-receive-live";
const REPO = path.resolve(import.meta.dirname, "..");
const DIST_ENTRY = path.join(REPO, "mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js");
const TMUX_SESSION = `entwurf-omp-recv-${process.pid}`;

let passed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
	if (!cond) {
		console.error(`  FAIL  ${label}${detail ? `\n${detail}` : ""}`);
		teardown();
		process.exit(1);
	}
	console.log(`  ok    ${label}`);
	passed++;
}
function fail(message: string): never {
	console.error(`[${LABEL}] ${message}`);
	teardown();
	process.exit(1);
}

function sh(cmd: string, args: string[]): string {
	return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function tmux(...args: string[]): string {
	return sh("tmux", args);
}
function teardown(): void {
	try {
		tmux("kill-session", "-t", TMUX_SESSION);
	} catch {
		/* the session may never have started; teardown is best-effort */
	}
}

/** Poll a predicate on a real clock. LIVE steps wait on other processes, so this is a
 * genuine wait rather than the busy-loop a hermetic gate would refuse. */
async function until<T>(what: string, timeoutMs: number, probe: () => T | null): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const got = probe();
		if (got !== null && got !== undefined) return got;
		if (Date.now() > deadline) fail(`timed out after ${timeoutMs}ms waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 250));
	}
}

// ── 1. the registry decides whether this step has anything to accept ─────────
const wakeMode = (() => {
	try {
		return loadMetaCapabilityRegistry().backends.omp?.wakeMode ?? "ABSENT";
	} catch (err) {
		fail(`capability registry unreadable: ${String(err)}`);
	}
})();

if (wakeMode !== "self-fetch") {
	skipLive(
		LABEL,
		`omp declares wakeMode=${wakeMode}, so it has no drainable mailbox and no receiver rail exists to accept (#87 bundle B). ` +
			"OMP is outbound-only under that label: it sends under its own garden id and NOTHING can reply, which dispatch reports as " +
			"mailbox-undeliverable. That is a designed boundary, not a defect — and it is why a cut taken now would ship a one-way harness. " +
			"Close it by landing the receiver unit and moving wakeMode, which makes this step demand the real roundtrip receipt below.",
	);
}
if (process.env.LIVE !== "1") {
	skipLive(
		LABEL,
		"set LIVE=1 to run — this step opens a real omp TUI in tmux and spends one model turn on the operator's configured omp model.",
	);
}

console.log(`[${LABEL}] registry declares omp wakeMode=self-fetch — the receive rail must now prove itself`);

// ── 2. preflight: every prerequisite the registry's claim depends on ─────────
// FAIL, not skip. Once the registry says a wake happens, a missing unit is a broken
// promise rather than an absent prerequisite.
try {
	sh("bash", ["-c", "command -v omp"]);
} catch {
	fail(
		"the 'omp' CLI is not on PATH, but the registry claims omp has a receive rail. entwurf never installs a harness — install omp, or move wakeMode back.",
	);
}
try {
	execFileSync("bash", [path.join(REPO, "scripts/omp-receive-doctor.sh")], { stdio: "pipe" });
	console.log(`  ok    doctor-omp-receive is green (unit installed, ownership bound, writer current)`);
} catch (err) {
	fail(
		`doctor-omp-receive is RED, so the receive rail the registry promises is not actually deployed here:\n${String((err as { stdout?: Buffer }).stdout ?? err)}`,
	);
}
// `tools.xdev` defaults ON and wraps MCP tools as `xd://` devices whose schemas never
// reach the prompt — a model so configured cannot call `entwurf_inbox_read`, so the
// doorbell would announce a tool that does not exist for it and this step would fail for
// a reason that is not the receive rail's fault. Name it up front (measured, #87 2026-08-28).
const ompConfig = path.join(os.homedir(), ".omp", "agent", "config.yml");
const xdevOff =
	fs.existsSync(ompConfig) && /(^|\n)tools:\s*\n(\s+.*\n)*?\s+xdev:\s*false/.test(fs.readFileSync(ompConfig, "utf8"));
ok(
	"operator config sets tools.xdev: false (MCP tools stay top-level, so the model can actually call entwurf_inbox_read)",
	xdevOff,
	`        ${ompConfig} — see docs/setup-clean-host.md §4b`,
);
if (!fs.existsSync(DIST_ENTRY)) fail(`the built bridge is missing at ${DIST_ENTRY} — run 'pnpm run build-bridge'.`);

// ── 3. open a real, idle omp TUI ─────────────────────────────────────────────
const roots = ompMetaRoots();
const receiveLog = path.join(path.dirname(roots.sessionsDir), "meta-bridge-receive-omp.log");
const logBefore = fs.existsSync(receiveLog) ? fs.readFileSync(receiveLog, "utf8").length : 0;
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-omp-recv-"));
const nonce = `OMP-RECV-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

process.on("exit", teardown);
tmux("new-session", "-d", "-s", TMUX_SESSION, "-x", "200", "-y", "50", "-c", workdir, `omp --cwd ${workdir}`);
console.log(`[${LABEL}] opened an omp TUI in tmux session ${TMUX_SESSION} (cwd ${workdir})`);

// ── 4. it arms, and the marker is real ───────────────────────────────────────
const gardenId = await until("the receiver to arm (log line 'armed garden=…')", 60_000, () => {
	if (!fs.existsSync(receiveLog)) return null;
	const fresh = fs.readFileSync(receiveLog, "utf8").slice(logBefore);
	const m = fresh.match(/armed garden=([0-9A-Za-z-]+) owner=(\d+)/);
	return m ? m[1] : null;
});
ok(`an idle omp TUI armed a receiver for garden ${gardenId}`, true);

const facts = JSON.parse(sh("bash", [path.join(REPO, "run.sh"), "omp-receive-facts"]));
const armed = (facts.receivers as Array<Record<string, unknown>>).find((r) => r.gardenId === gardenId);
ok(
	"the production marker reader sees that receiver as LIVE (not a filename read)",
	armed?.ownerLive === true,
	`        ${JSON.stringify(armed)}`,
);
ok("the marker names the omp HOST process as the watch owner", armed?.ownerKind === "omp-host");

// ── 5. another harness dispatches to it ──────────────────────────────────────
// Through the REAL bridge over MCP stdio — `tools/call entwurf_v2`, the same surface every
// other citizen reaches. A direct `enqueueMetaMessage` would bypass the deliverability
// guard, which is half of what this step is here to prove.
// The nonce is a CORRELATION token, not an instruction: it is asserted against the
// delivered mailbox body, never against what the model chose to say. See the header.
const body = `BUNDLE-B LIVE ACCEPTANCE probe ${nonce}. No action is requested; this message exists so an automated acceptance can confirm it reached the right mailbox.`;
const dispatch = await new Promise<{ text: string; isError: boolean }>((resolve, reject) => {
	// THE SENDER IS DELIBERATELY ANONYMOUS, AND THAT IS THE HONEST WIRING FOR A GATE.
	// The bridge refuses anonymous sends by default and names this exact hatch for "a
	// deliberately-anonymous external MCP host"; the message then travels marked
	// external/non-replyable. Seeding a fake sender marker instead would fabricate a
	// citizen that does not exist, and the sender's identity is not what this step
	// accepts — the RECEIVE half is. The cross-harness case with a real authoritative
	// sender was measured separately (#87, a claude-code citizen → an omp citizen).
	const child: ChildProcess = spawn(process.execPath, [DIST_ENTRY], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER: "1" },
	});
	let buf = "";
	let err = "";
	const timer = setTimeout(() => {
		child.kill("SIGKILL");
		reject(new Error(`bridge did not answer tools/call entwurf_v2 in 30s\n${err}`));
	}, 30_000);
	child.stderr?.on("data", (d) => {
		err += d.toString();
	});
	child.stdout?.on("data", (d) => {
		buf += d.toString();
		for (const line of buf.split("\n")) {
			if (!line.trim().startsWith("{")) continue;
			try {
				const msg = JSON.parse(line);
				if (msg.id !== 2) continue;
				clearTimeout(timer);
				child.kill("SIGTERM");
				const text = (msg.result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
				resolve({ text, isError: msg.result?.isError === true });
			} catch {
				/* partial frame; wait for more */
			}
		}
	});
	child.stdin?.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: LABEL, version: "0" } } })}\n`,
	);
	child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
	child.stdin?.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "entwurf_v2", arguments: { target: gardenId, intent: "fire-and-forget", message: body } } })}\n`,
	);
});
ok("tools/call entwurf_v2 to the omp citizen was NOT refused", !dispatch.isError, `        ${dispatch.text}`);
ok(
	"dispatch chose the MAILBOX rail (self-fetch), not a refusal",
	/mailbox|enqueued/i.test(dispatch.text),
	`        ${dispatch.text}`,
);

// ── 6. the doorbell rings on a session nobody typed into ─────────────────────
await until("the doorbell to ring", 30_000, () => {
	const fresh = fs.readFileSync(receiveLog, "utf8").slice(logBefore);
	return fresh.includes(`rang garden=${gardenId}`) ? true : null;
});
ok(`the doorbell rang for ${gardenId} with zero typing (idle wake)`, true);

// ── 7. the MODEL drains its own inbox — the honest receipt ───────────────────
const statePath = path.join(roots.mailboxDir, gardenId, "state.json");
const state = await until("the model to record a read receipt (lastReadAt)", 120_000, () => {
	if (!fs.existsSync(statePath)) return null;
	try {
		const s = JSON.parse(fs.readFileSync(statePath, "utf8"));
		return s.lastReadAt ? s : null;
	} catch {
		return null;
	}
});
ok(
	"lastReadAt moved AFTER lastEnqueuedAt — a rung doorbell is only a wake attempt; THIS is the receipt",
	Date.parse(state.lastReadAt) >= Date.parse(state.lastEnqueuedAt),
	`        ${JSON.stringify(state)}`,
);

// ── 8. the drain happened INSIDE that session, and it carried OUR body ───────
// One oracle, two facts, and it has to be the transcript rather than the mailbox:
// `entwurf_inbox_read` ARCHIVES each body as it returns it, so a `.msg.delivered` check
// after the drain finds an empty directory — measured here as a failing assertion on a
// run whose read receipt had already landed. The vendor's own session log keeps both
// halves permanently: the toolCall (this session asked, for its own garden id) and the
// toolResult (what came back, including our nonce).
//
// This closes a real gap rather than a cosmetic one. `entwurf_inbox_read` takes a
// CALLER-SUPPLIED garden id and does not verify it against the caller's identity, so
// `lastReadAt` alone proves a read happened — not that THIS session performed it.
const record = JSON.parse(sh("bash", [path.join(REPO, "run.sh"), "meta-facts"]));
const citizen = (record.citizens as Array<Record<string, unknown>>).find((c) => c.gardenId === gardenId);
ok("the citizen's V3 record names a transcript for this session", typeof citizen?.transcriptPath === "string");
const transcriptPath = citizen?.transcriptPath as string;

interface TranscriptPart {
	type?: string;
	name?: string;
	toolName?: string;
	text?: string;
	arguments?: { gardenId?: string };
}
function scanTranscript(): { called: string | null; resultCarriedNonce: boolean } {
	let called: string | null = null;
	let resultCarriedNonce = false;
	if (!fs.existsSync(transcriptPath)) return { called, resultCarriedNonce };
	for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
		if (!line.includes("entwurf_inbox_read")) continue;
		let entry: { message?: { role?: string; toolName?: string; content?: TranscriptPart[] } };
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		for (const part of entry.message?.content ?? []) {
			if (
				part.type === "toolCall" &&
				part.name?.includes("entwurf_inbox_read") &&
				part.arguments?.gardenId === gardenId
			) {
				called = part.name;
			}
			if (entry.message?.role === "toolResult" && entry.message.toolName?.includes("entwurf_inbox_read")) {
				if ((part.text ?? "").includes(nonce)) resultCarriedNonce = true;
			}
		}
	}
	return { called, resultCarriedNonce };
}

const scan = await until("this session's own inbox_read call and its result in the transcript", 60_000, () => {
	const got = scanTranscript();
	return got.called && got.resultCarriedNonce ? got : null;
});
ok(
	`the SAME native session called ${scan.called} for its OWN garden id — the drain is joined to the citizen, not merely to the clock`,
	true,
);
ok("the drained result carried this run's nonce — the right body reached the right citizen", scan.resultCarriedNonce);

teardown();
try {
	fs.rmSync(workdir, { recursive: true, force: true });
} catch {
	/* scratch cleanup is best-effort */
}
console.log(
	`[${LABEL}] ${passed} assertions ok — garden ${gardenId}, lastEnqueuedAt ${state.lastEnqueuedAt}, lastReadAt ${state.lastReadAt}`,
);
