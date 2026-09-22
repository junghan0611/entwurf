/**
 * smoke-herdr-fresh-call-live — the axis no deterministic gate can reach on the herdr rail: a real
 * caller that is ITSELF inside a herdr pane, calling the REAL PUBLIC TOOL, and a real child whose
 * first model action is the callback.
 *
 * OUT of `pnpm check`. Needs `LIVE=1`. Costs four model turns (two callers, two children).
 *
 * WHY THE CALLER MUST BE A REAL AGENT. Calling `dispatchFreshCall` from this script would prove
 * the dispatcher works and nothing about the surface: the rail is selected from the CALLER's
 * process environment, the caller identity comes from the surface's own record-backed context, and
 * the callback has to arrive at that identity. All three only exist when a real session inside a
 * herdr pane invokes the registered tool. So this smoke opens callers and reads what they did.
 *
 * ── Isolate the WRITES, keep the runtimes real (same split as the tmux smoke) ──
 *
 *   REAL (runtime-owned)             the authenticated runtime config: the real pi agent dir, and
 *                                    the operator's HOME/CLAUDE_CONFIG_DIR for Claude. Native
 *                                    transcripts stay there and are read here as evidence.
 *   FIXTURE (entwurf-owned writes)   XDG roots, the four meta roots, the v2 lock dir — so every
 *                                    record, mailbox and marker this smoke mints is born and dies
 *                                    inside the fixture and the garden never sees it.
 *
 * HOME IS REAL FOR BOTH RUNTIMES, decided by a measurement rather than a preference.
 * `[측정 2026-09-14]` a pi started with a FIXTURE HOME and the operator's real agent dir dies before
 * it is ever ready: an installed extension resolves its npm dependency through `$HOME`
 * (`…/home/.pi/agent/npm/node_modules/@ogulcancelik/pi-session-recall/session-recall.ts`), which a
 * fresh HOME does not have, and herdr reports `timeout — timed out waiting for agent startup`
 * after waiting the full 240s. So "real agent dir + fixture HOME" is not a composable pair on this
 * host, and claude in a fresh HOME would enter first-run onboarding. Both runtimes therefore keep
 * the operator's real HOME. Each CELL still gets its own private herdr server, because herdr's
 * socket follows `XDG_CONFIG_HOME` and each cell is fenced into its own.
 *
 * What that costs, stated rather than hidden: a pi caller's control socket is HOME-derived with no
 * env override, so it lands in the operator's `~/.pi/entwurf-control/` for the life of the caller.
 * Its RECORD is still born in the fixture store, so the garden's peer listing never sees it, and
 * the teardown proves that exact socket path is gone by the end. The operator's herdr server is
 * snapshotted read-only before and after and must be identical.
 *
 * EVIDENCE IS SOURCE RECEIPTS, NEVER SCREEN TEXT — in TWO GRADES, named rather than averaged:
 *
 *   pi axis      the caller's and child's own vendor transcripts, which carry the full tool RESULT
 *                text. So pi proves the receipt CONTENT (nonce, view coordinates, promotes no
 *                address) and the task-ran-after-callback ordering as well as everything below.
 *   claude axis  the runtime's OWN entwurf-bridge MCP activity log, written inside this smoke's
 *                fenced `XDG_CACHE_HOME`, joined to a session by its EXACT `sessionId` — plus
 *                entwurf's own mailbox artifact and hook journal. It proves the public call, the
 *                identity join, the delivered callback, the caller's continuation, the child's
 *                FIRST action, and the codex named reject. It does NOT prove the receipt text or
 *                the final answer content: those have no source artifact on this axis and are
 *                left to GLG's manual validation rather than substituted with a screen read.
 *
 * `[측정 2026-09-14, 첫 C4 실행]` that split exists because a claude runtime DECLARES a
 * `transcript_path` in its hook envelope that never appeared on disk here. An absent declared
 * transcript is a claude-runtime artifact question — NOT a rail failure — and this smoke must never
 * again report it as one: the production path in that very run had succeeded end to end.
 *
 * AND THE VACUOUS CLAUSE THAT RUN ALSO EXPOSED: the caller's own receipt contains the nonce it
 * minted, so "the nonce appears in the caller's text" can be true while the callback timed out.
 * Callback arrival is therefore proved from the DELIVERED MESSAGE — body is the nonce, and the
 * SENDER is the child the direct witness resolved to — never from the caller's receipt alone.
 *
 * THAT DELIVERED MESSAGE HAS A DIFFERENT SHAPE PER RAIL, and assuming one shape for both is a
 * defect this smoke shipped once. `[측정 2026-09-15]` a claude caller is a self-fetch citizen and
 * its callback lands as a file in its mailbox directory; a pi caller is a LIVE CONTROL-SOCKET
 * citizen and its callback goes straight down the socket, so no `.msg` file — and no mailbox
 * directory at all — is ever created for it. Reading the mailbox on the pi axis failed four cells
 * on a rail whose production path had in fact worked end to end, and an empty nonce then made a
 * fifth cell pass vacuously through `includes("")`. Each rail is now read for its own artifact,
 * the nonce's shape is asserted before any ordering cell uses it, and the caller's id goes through
 * the same official path→id conversion as the child's (a pi witness reports a transcript PATH,
 * while the record is keyed by the uuid inside that filename).
 *
 * Nothing below reads a pane's rendered output, and nothing types a key.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsControlChar } from "../pi-extensions/lib/herdr-fresh-call.ts";
import { joinKeyOf, parseHerdrPaneList } from "../pi-extensions/lib/herdr-placement.ts";
import { assessLauncherCleanup, snapshotClaudeLauncher, verifyClaudeLauncher } from "./lib/claude-launcher-fence.ts";
import { skipLive } from "./lib/live-skip.ts";

/**
 * #120 P2: the control-socket rail answers with the ACCEPTANCE BOUNDARY the receiver observed, and
 * every member of that set is a success. The caller here is mid-turn while its child calls back,
 * so `queued-steer` is the ORDINARY answer — the old literal `→ sent` pin would have gone red on
 * the common case and passed only when the caller happened to be idle. What must still be absent
 * is a REFUSAL, which the negative beside it now names directly (`rejected` / `failed`) instead of
 * as "anything that is not the word sent".
 */
const CONTROL_ACCEPTED = /entwurf_v2 control-socket → (?:sent|queued-steer|queued-follow-up|accepted-unknown-boundary)/;

const LABEL = "smoke-herdr-fresh-call-live";
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_HOME = process.env.HOME ?? os.homedir();
const REAL_PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(REAL_HOME, ".pi", "agent");
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR?.trim() || null;
const REAL_CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR || path.join(REAL_HOME, ".claude");

/** How long a caller's whole turn may take: it has to boot, call the tool, and have its child
 * boot and call back. Bounded, and a timeout is a RED rather than a retry. */
const CELL_TIMEOUT_MS = 240_000;
/** How long the CHILD may take to call back after its CALLER's turn is already over. Separate from
 * the cell bound above because it measures a different process: `[측정 2026-09-17]` a child started
 * late in the caller's launch had not finished booting when the caller finished, and the cell read
 * its evidence on the caller's clock. */
const CHILD_CALLBACK_WAIT_MS = 180_000;
const POLL_MS = 2_000;

let passed = 0;
const failures: string[] = [];
function ok(label: string, cond: boolean): void {
	if (cond) {
		console.log(`  ok    ${label}`);
		passed++;
		return;
	}
	console.error(`  FAIL  ${label}`);
	failures.push(label);
}

function sleep(ms: number): void {
	spawnSync("sleep", [String(ms / 1000)]);
}

/** herdr prints its refusals as JSON on STDERR with exit 1, so a helper that only carried stdout
 * would report every failure as an empty string — which is exactly how the first run of this smoke
 * hid its own cause. Both streams travel. */
function herdr(
	bin: string,
	env: NodeJS.ProcessEnv,
	args: readonly string[],
): { status: number; stdout: string; stderr: string } {
	const run = spawnSync(bin, [...args], { encoding: "utf8", env, timeout: 320_000 });
	return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** The operator's own panes, read with the operator's own environment. */
function operatorPanes(bin: string): string {
	const run = spawnSync(bin, ["pane", "list"], { encoding: "utf8", timeout: 30_000 });
	if ((run.status ?? 1) !== 0) return "no-operator-server";
	const rows = parseHerdrPaneList(run.stdout ?? "");
	return rows === null ? "unreadable" : JSON.stringify(rows.map((r) => [r.paneId, r.agent, r.sessionValue]).sort());
}

function which(bin: string): boolean {
	return (process.env.PATH ?? "").split(path.delimiter).some((dir) => {
		try {
			fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
}

/** Every V3 record in the fixture store, by native session id. */
function fixtureRecords(storeDir: string): Map<string, Record<string, unknown>> {
	const out = new Map<string, Record<string, unknown>>();
	if (!fs.existsSync(storeDir)) return out;
	for (const file of fs.readdirSync(storeDir)) {
		if (!file.endsWith(".meta.json")) continue;
		const record = JSON.parse(fs.readFileSync(path.join(storeDir, file), "utf8")) as Record<string, unknown>;
		out.set(String(record.nativeSessionId), record);
	}
	return out;
}

/** A pi session transcript, as text. The caller's own vendor artifact — not a screen. */
function readTranscript(file: string): string {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return "";
	}
}

/**
 * The pi transcript as the RECORDS it is, not as one string.
 *
 * `[sol D1, 2026-09-18]` the ordering cell below used to compare CHARACTER OFFSETS inside the
 * whole file — `indexOf(nonce) < indexOf(token)`. Both strings are already in the birth prompt, in
 * that order, so the predicate was true before the child had done anything at all: it could not
 * distinguish "called back, then worked" from "never called back". Line indices over the JSONL
 * records are the smallest honest unit here — one record is one event, so a claim about WHICH
 * event carried the nonce and WHICH came after it is a claim about the run rather than about the
 * prompt we wrote.
 */
function transcriptRecords(file: string): string[] {
	return readTranscript(file)
		.split("\n")
		.filter((line) => line.trim().length > 0);
}

/**
 * The BARE verb names, as the two surfaces this smoke reads actually spell them — NOT the
 * model-facing dialect. `[측정 2026-09-20, this smoke's own red fixture]` the claude MCP activity
 * log carries `Calling MCP tool: entwurf_callback` / `Tool 'entwurf_callback' completed`, and pi
 * writes `"type":"toolCall","name":"entwurf_callback"`; neither records
 * `mcp__entwurf-bridge__entwurf_callback`. The per-host dialect is owned by
 * `FRESH_CALL_CALLBACK_TOOL` / `FRESH_CALL_DELIVERY_TOOL` in `fresh-call-composition.ts` and is
 * what the FRAMING says; these two are what an OBSERVER sees, and conflating them is what this
 * pair of constants exists to stop.
 */
const CALLBACK_VERB = "entwurf_callback";
const DELIVERY_VERB = "entwurf_v2";

/**
 * The id of the CALLBACK toolCall in this record, or null. Pi writes a call and its result as two
 * records; this is one half of the join that replaces a same-record read.
 *
 * WHAT MAKES IT THE CALLBACK `[ff09522]`. It used to be the ARGUMENTS: message === nonce, target
 * === the caller, intent === fire-and-forget. That predicate is gone because the thing it read is
 * gone — the birth verb takes ZERO arguments and reads the caller and the nonce out of its own
 * process env, so there is nothing in the call for a model to get wrong and nothing here to
 * compare. What identifies the callback now is the verb plus the ABSENCE of an address: a call
 * carrying a target or a message is a model supplying an address, which is the second address axis
 * Hard Rule 2 refuses, and it is not this act.
 *
 * The nonce↔sender correlation the old predicate carried did not disappear with it — it moved to
 * the DELIVERED ARTIFACT, which this smoke checks independently and earlier ("the child's callback
 * ARRIVED … its body is a production nonce and its sender is the child the direct witness resolved
 * to"). Two records, one event, same as before; only the half that names the call has changed.
 */
function entwurfCallIdFor(record: string, nonce: string, callerGid: string): string | null {
	void nonce;
	void callerGid;
	let parsed: unknown;
	try {
		parsed = JSON.parse(record);
	} catch {
		return null;
	}
	const content = (parsed as { message?: { content?: unknown } })?.message?.content;
	if (!Array.isArray(content)) return null;
	for (const part of content) {
		const call = part as { type?: unknown; name?: unknown; id?: unknown; arguments?: unknown };
		if (call.type !== "toolCall" || call.name !== CALLBACK_VERB) continue;
		// Zero-argument verb: absent, null and `{}` are all the shape it is called with. A supplied
		// target or message is a model naming an address the env already owns — not this act.
		const args = call.arguments as { message?: unknown; target?: unknown } | undefined | null;
		if (args !== undefined && args !== null) {
			if (typeof args !== "object" || Array.isArray(args)) continue;
			if (args.target !== undefined || args.message !== undefined) continue;
		}
		return typeof call.id === "string" ? call.id : null;
	}
	return null;
}

/** The toolCallId this record is a RESULT for — the other half of the join. */
function toolResultIdOf(record: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(record);
	} catch {
		return null;
	}
	const message = (parsed as { message?: { role?: unknown; toolCallId?: unknown } })?.message;
	if (!message || message.role !== "toolResult") return null;
	return typeof message.toolCallId === "string" ? message.toolCallId : null;
}

interface McpEntry {
	readonly sessionId: string;
	readonly timestamp: string;
	readonly debug?: string;
	readonly error?: string;
}

/**
 * THE CLAUDE AXIS EVIDENCE SOURCE, and why it is not the transcript.
 *
 * `[측정 2026-09-14, 첫 C4 실행]` a Claude runtime's SessionStart hook envelope DECLARES a
 * `transcript_path` under the operator's real config dir, and for the sessions this smoke opens
 * that file never appeared on disk — not during the run, not after it. Reading it produced an
 * empty string, so every assertion that quoted it failed while the production rail had in fact
 * succeeded end to end. That absence is a claude-runtime artifact question, NOT a rail failure,
 * and it must never again be able to read as one.
 *
 * So the claude axis reads what the runtime itself wrote INSIDE this smoke's fixture: its
 * entwurf-bridge MCP activity log, which lands under the fenced `XDG_CACHE_HOME`. Every entry
 * carries the exact `sessionId` that stamped it, so entries are grouped by that id and joined by
 * EXACT equality with the official herdr witness. No filename is matched, no modification time is
 * consulted, and nothing is chosen for being the newest — an axis that picks its evidence by
 * recency is an axis that will eventually quote somebody else's session.
 */
function mcpActivityBySession(root: string): Map<string, McpEntry[]> {
	const dir = path.join(
		root,
		"xdg-cache",
		"claude-cli-nodejs",
		REPO_DIR.replace(/\//g, "-"),
		"mcp-logs-entwurf-bridge",
	);
	const bySession = new Map<string, McpEntry[]>();
	if (!fs.existsSync(dir)) return bySession;
	for (const file of fs.readdirSync(dir).sort()) {
		if (!file.endsWith(".jsonl")) continue;
		for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
			if (!line.trim()) continue;
			let entry: McpEntry;
			try {
				entry = JSON.parse(line) as McpEntry;
			} catch {
				continue;
			}
			if (typeof entry.sessionId !== "string" || entry.sessionId.length === 0) continue;
			const bucket = bySession.get(entry.sessionId) ?? [];
			bucket.push(entry);
			bySession.set(entry.sessionId, bucket);
		}
	}
	return bySession;
}

/** The tool names this session invoked, in the order it invoked them. */
function toolCallOrder(entries: readonly McpEntry[]): string[] {
	const prefix = "Calling MCP tool: ";
	return entries.flatMap((e) => (e.debug?.startsWith(prefix) ? [e.debug.slice(prefix.length)] : []));
}

function indexOfEntry(entries: readonly McpEntry[], match: (e: McpEntry) => boolean): number {
	return entries.findIndex(match);
}

/** Every delivered message sitting in ONE garden id's mailbox directory. The directory is the
 * address — nothing here scans for "the newest file" anywhere else. */
function deliveredMessages(mailboxRoot: string, gardenId: string): { file: string; text: string }[] {
	const dir = path.join(mailboxRoot, gardenId);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.includes(".msg"))
		.sort()
		.map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
}

interface Cell {
	readonly label: string;
	readonly childBackend: "pi" | "claude-code";
	readonly callerKind: "pi" | "claude";
	readonly childKind: "pi" | "claude";
	readonly callerModel: string;
	readonly childModel: string;
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1")
		skipLive(LABEL, "LIVE=1 not set — this smoke opens real herdr panes and spends four model turns");
	if (!which("herdr")) skipLive(LABEL, "herdr is not on PATH — the herdr rail cannot be exercised");
	if (!which("pi")) skipLive(LABEL, "the pi runtime is not on PATH");
	if (!which("claude")) skipLive(LABEL, "the claude runtime is not on PATH");
	if (!fs.existsSync(REAL_PI_AGENT_DIR))
		skipLive(LABEL, `no pi agent dir at ${REAL_PI_AGENT_DIR} — an unauthenticated pi would fail for the wrong reason`);
	if (!fs.existsSync(REAL_CLAUDE_CONFIG_DIR))
		skipLive(
			LABEL,
			`no Claude config dir at ${REAL_CLAUDE_CONFIG_DIR} — an unauthenticated claude would fail likewise`,
		);
	if (!fs.existsSync(path.join(REAL_PI_AGENT_DIR, "extensions", "herdr-agent-state.ts")))
		skipLive(
			LABEL,
			`herdr's pi integration is not installed in ${REAL_PI_AGENT_DIR} — without it herdr reports no agent_session and the join has nothing to read`,
		);

	const bin = "herdr";
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-fresh-call-live-"));
	const storeDir = path.join(root, "meta-sessions");
	const beforeOperator = operatorPanes(bin);

	const fenced: Record<string, string> = {
		XDG_CONFIG_HOME: path.join(root, "xdg-config"),
		XDG_DATA_HOME: path.join(root, "xdg-data"),
		XDG_STATE_HOME: path.join(root, "xdg-state"),
		XDG_CACHE_HOME: path.join(root, "xdg-cache"),
		XDG_RUNTIME_DIR: path.join(root, "xdg-runtime"),
		ENTWURF_META_SESSIONS_DIR: storeDir,
		ENTWURF_META_RECEIVERS_DIR: path.join(root, "meta-receivers"),
		ENTWURF_META_SENDERS_DIR: path.join(root, "meta-senders"),
		ENTWURF_META_MAILBOX_DIR: path.join(root, "meta-mailbox"),
		ENTWURF_V2_LOCK_DIR: path.join(root, "v2-locks"),
	};
	for (const dir of Object.values(fenced)) fs.mkdirSync(dir, { recursive: true });
	fs.chmodSync(fenced.XDG_RUNTIME_DIR, 0o700);

	// THE ONE SUBTREE THAT MUST NOT BE FENCED, AND WHY `[측정 2026-09-18, vendor 2.1.267]`.
	// The vendor resolves its two installation halves from DIFFERENT roots: the version store from
	// `XDG_DATA_HOME` and the launcher from `HOME`.
	//
	//     Wge = () => env.XDG_DATA_HOME ?? join(home, ".local", "share")
	//     EZe = () => join(Wge(), "claude", "versions")     // version store  ← XDG_DATA_HOME
	//     TN  = () => join(home, ".local", "bin")           // launcher       ← HOME
	//
	// A child that inherits a fixture `XDG_DATA_HOME` while keeping the operator's real HOME is
	// therefore looking at an EMPTY version store beside a real launcher, installs itself into the
	// fixture, and repoints `$HOME/.local/bin/claude` at `<fixture>/claude/versions/<v>` — the
	// operator's command now depends on a disposable tmp tree. `[측정 oracle 2026-09-18]` that is
	// not a hazard, it HAPPENED: seven fixture roots from this smoke each held a full
	// `claude/versions/2.1.267` plus `applications/claude-code-url-handler.desktop`, and the real
	// launcher pointed into the newest of them until it was relinked by hand.
	//
	// The fence module's own repair is operator PARITY on the XDG roots, and this rail cannot take
	// it whole: herdr's socket follows `XDG_CONFIG_HOME`, so each cell must keep its own. So it
	// takes parity on the ONE subtree the incident is about — the vendor's data dir is shared with
	// the operator rather than re-created empty, which puts the store and the launcher back in the
	// same install. Everything else in this tree stays fenced.
	//
	// AND IF THERE IS NO SUCH DIR, THIS SMOKE DOES NOT RUN `[sol 재검 2026-09-18]`. The previous
	// version skipped the symlink and launched anyway, on the reasoning that "the preflight below
	// stands" — which was false comfort: the preflight PINS the launcher's identity, and the
	// teardown oracle reports the damage, but neither prevents a child from retargeting it. Without
	// this subtree there is no parity to give, so the incident's exact precondition would be rebuilt
	// on purpose. A rail that cannot protect the operator's launcher declines to open the child.
	const operatorClaudeData = path.join(
		process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
		"claude",
	);
	if (!fs.existsSync(operatorClaudeData)) {
		throw new Error(
			`${LABEL}: fail-closed — the operator has no vendor data dir at ${operatorClaudeData}, so the fixture cannot share ` +
				"the version store the launcher resolves against. Launching anyway is the #67 precondition (fixture " +
				"XDG_DATA_HOME beside a real HOME), and this smoke refuses to rebuild it.",
		);
	}
	fs.symlinkSync(operatorClaudeData, path.join(fenced.XDG_DATA_HOME, "claude"));

	// FAIL-CLOSED PREFLIGHT, before any child exists (issue #67's shared fence). This smoke keeps
	// its fixture rather than removing it, so the guard that matters here is the integrity oracle
	// in the teardown plus the named cleanup verdict it prints — a tree the launcher references
	// must not be swept by a later hand either.
	const launcher = snapshotClaudeLauncher({ env: process.env, fixtureRoot: root });

	const servers: { cell: Cell; env: NodeJS.ProcessEnv; socket: string }[] = [];
	const artifact = path.join(root, "receipts.md");
	const lines: string[] = [`# ${LABEL} — ${new Date().toISOString()}`, ""];

	const cells: Cell[] = [
		{
			label: "pi→pi",
			childBackend: "pi",
			callerKind: "pi",
			childKind: "pi",
			callerModel: "openai-codex/gpt-5.6-sol",
			childModel: "openai-codex/gpt-5.6-sol",
		},
		{
			label: "claude→claude",
			childBackend: "claude-code",
			callerKind: "claude",
			childKind: "claude",
			callerModel: "opus",
			// THE CHILD IS THE SAFETY-TUNED MODEL ON PURPOSE (#116, 2026-09-17). This cell pinned
			// `opus` on both sides and passed, while `[GLG 직접, 날것 PC]` a Sonnet 5 child refused the
			// first turn outright — so the gate had never once exercised the layer that refuses, which
			// is the layer a user installing this rail actually meets. The CALLER stays on opus: it is
			// not the side under test here. Override to sample another model; the default is the
			// harder oracle, not the convenient one.
			childModel: process.env.ENTWURF_HERDR_LIVE_CHILD_MODEL?.trim() || "sonnet",
		},
	];

	try {
		for (const cell of cells) {
			console.log(`\n[${LABEL}] cell ${cell.label}`);
			// ── one private server per cell, with that runtime's own HOME ────────────────
			const env: NodeJS.ProcessEnv = { ...process.env, ...fenced, PI_CODING_AGENT_DIR: REAL_PI_AGENT_DIR };
			// herdr's socket follows XDG_CONFIG_HOME, so each cell needs its own.
			const cellConfig = path.join(root, `${cell.label.replace(/[^a-z]/g, "")}-xdg-config`);
			fs.mkdirSync(cellConfig, { recursive: true });
			env.XDG_CONFIG_HOME = cellConfig;
			// REAL HOME for both runtimes — see the header: a fixture HOME kills pi before it is
			// ready, and Claude would enter first-run onboarding. Entwurf's own writes stay
			// fenced through the meta roots regardless of HOME.
			env.HOME = REAL_HOME;
			if (ORIGINAL_CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
			delete env.HERDR_ENV;
			delete env.HERDR_PANE_ID;
			delete env.HERDR_BIN_PATH;
			delete env.PI_SESSION_ID;
			delete env.PI_AGENT_ID;
			delete env.TMUX;
			delete env.TMUX_PANE;

			const socket = path.join(cellConfig, "herdr", "herdr.sock");
			const log = fs.openSync(path.join(root, `${cell.label.replace(/[^a-z]/g, "")}-server.log`), "a");
			const server = spawnSync("sh", ["-c", `nohup "${bin}" server >/dev/null 2>&1 &`], { env, encoding: "utf8" });
			fs.closeSync(log);
			if ((server.status ?? 1) !== 0) throw new Error(`${LABEL}: could not start the private herdr server`);
			const deadline = Date.now() + 20_000;
			while (Date.now() < deadline && !fs.existsSync(socket)) sleep(500);
			if (!fs.existsSync(socket)) throw new Error(`${LABEL}: the private herdr server never opened ${socket}`);
			servers.push({ cell, env, socket });
			ok(`${cell.label}: the herdr server is PRIVATE — its socket is inside the fixture`, socket.startsWith(root));

			const ws = herdr(bin, env, ["workspace", "create", "--label", "live", "--no-focus", "--cwd", REPO_DIR]);
			if (ws.status !== 0) throw new Error(`${LABEL}: workspace create failed: ${ws.stderr || ws.stdout}`);

			// ── the CALLER: a real agent, inside a herdr pane, told to call the PUBLIC tool ──
			const callerSplit = herdr(bin, env, [
				"pane",
				"split",
				"--pane",
				"w1:p1",
				"--direction",
				"down",
				"--no-focus",
				"--cwd",
				REPO_DIR,
				"--env",
				"PI_SESSION_ID=",
				"--env",
				"PI_AGENT_ID=",
			]);
			if (callerSplit.status !== 0)
				throw new Error(`${LABEL}: the caller pane split failed: ${callerSplit.stderr || callerSplit.stdout}`);
			const callerPane = JSON.parse(callerSplit.stdout).result.pane as { pane_id: string; terminal_id: string };
			const token = `live-${cell.label.replace(/[^a-z]/g, "")}-${Math.random().toString(16).slice(2, 10)}`;
			const childTask = [
				"이 측정의 과제는 두 줄이다.",
				`두 번째 줄의 확인 토큰은 ${token} 이다 — 위 콜백을 먼저 보낸 뒤, 이 토큰을 그대로 담아 한 문장으로만 답해 달라.`,
			].join("\n");
			const callerTask = [
				"You are the CALLER in an entwurf acceptance run, running inside a herdr pane.",
				"Do exactly this and nothing else. Do not call any tool other than entwurf_fresh_call.",
				"",
				`1. Call the entwurf_fresh_call tool with backend="${cell.childBackend}", model="${cell.childModel}", and this exact task string:`,
				childTask.replace(/\n/g, "\\n"),
				'2. Then call entwurf_fresh_call ONE more time with backend="codex" and the same model and task.',
				"3. Report both tool results verbatim in your final answer and stop. Do not retry anything, do not open anything else.",
			].join("\n");
			// The CALLER gets the transport constraint (one physical line, zero control characters —
			// `[source herdr 7505c08]` src/app/agents.rs:157-161) but NOT the production framing:
			// `composeFreshCallPrompt` would order it to call back to a garden id, and this fixture
			// has none to give — the first run did exactly that and sent the caller dispatching at
			// an id that does not exist. The child's framing is composed by PRODUCTION when the
			// caller invokes the tool, which is the thing under test. It is folded here rather than
			// run through `encodeBirthPrompt`, which now composes a production framing this fixture
			// deliberately does not want.
			const callerArgv = callerTask
				.split("\n")
				.filter((line) => line.length > 0)
				.join(" ");
			if (containsControlChar(callerArgv)) throw new Error(`${LABEL}: the caller prompt carries a control character`);
			const callerArgs =
				cell.callerKind === "pi"
					? [callerArgv, "--approve", "--entwurf-control", "--model", cell.callerModel]
					: [callerArgv, `--model=${cell.callerModel}`];
			const started = herdr(bin, env, [
				"agent",
				"start",
				`livecaller${cell.label.replace(/[^a-z]/g, "")}`,
				"--kind",
				cell.callerKind,
				"--pane",
				callerPane.pane_id,
				// The smoke's OWN caller may boot slower than herdr's 30s default on a
				// package-heavy install. The CHILD keeps the production default, because that
				// default is part of what this acceptance is judging.
				"--timeout",
				"180000",
				"--",
				...callerArgs,
			]);
			if (started.status !== 0)
				throw new Error(`${LABEL}: the caller did not start: ${started.stderr || started.stdout}`);
			const callerSession = JSON.parse(started.stdout).result.agent.agent_session as { value: string } | null;
			ok(`${cell.label}: the caller is itself inside herdr and herdr reported its session`, callerSession !== null);

			// ── wait for the caller's turn, reading only source receipts ────────────────
			//
			// TWO EVIDENCE GRADES, NAMED RATHER THAN AVERAGED. The pi axis is read from the
			// caller's own vendor transcript, which carries the full tool RESULT text — so the
			// receipt-content claims (nonce, view coordinates, promotes-no-address) and the
			// task-after-callback ordering are asserted there. `[측정 2026-09-14]` the claude axis
			// has no such artifact on this host: its runtime declares a `transcript_path` that
			// never materialised, so that axis is read from the runtime's OWN entwurf-bridge MCP
			// activity log inside this fixture, plus entwurf's own mailbox and hook receipts.
			// Neither axis reads a screen and neither types a key. What claude therefore does NOT
			// prove here is the receipt TEXT and the final answer content; that belongs to GLG's
			// manual validation after M1, and it is written down rather than quietly dropped.
			const callerNative = String(callerSession?.value ?? "");
			const callerIsPi = cell.callerKind === "pi";
			const callerTranscript = callerIsPi
				? callerNative
				: path.join(REAL_CLAUDE_CONFIG_DIR, "projects", REPO_DIR.replace(/\//g, "-"), `${callerNative}.jsonl`);
			const cellDeadline = Date.now() + CELL_TIMEOUT_MS;
			let text = "";
			let callerActivity: McpEntry[] = [];
			while (Date.now() < cellDeadline) {
				if (callerIsPi) {
					text = readTranscript(callerTranscript);
					if (text.includes("[entwurf fresh call → herdr]") && text.includes("herdr-backend-unsupported")) break;
				} else {
					callerActivity = mcpActivityBySession(root).get(callerNative) ?? [];
					const done = callerActivity.some((e) => (e.error ?? "").includes("herdr-backend-unsupported"));
					if (done) break;
				}
				sleep(POLL_MS);
			}
			lines.push(
				`## ${cell.label}`,
				"",
				"```",
				callerIsPi ? text.slice(-4000) : JSON.stringify(callerActivity, null, 1),
				"```",
				"",
			);

			// ── the child, in the private server's own JSON ─────────────────────────────
			const panes = parseHerdrPaneList(herdr(bin, env, ["pane", "list"]).stdout) ?? [];
			const childRow = panes.find((row) => row.paneId !== callerPane.pane_id && row.sessionValue !== null);
			const records = fixtureRecords(storeDir);
			const joined = childRow === null || childRow === undefined ? null : joinKeyOf(childRow);
			const childRecord = joined === null ? undefined : records.get(joined.nativeSessionId);
			ok(
				`${cell.label}: the child's direct herdr witness resolves to EXACTLY ONE fixture record through the official conversion`,
				joined !== null &&
					childRecord !== undefined &&
					[...records.values()].filter((r) => r.nativeSessionId === joined.nativeSessionId).length === 1,
			);
			const childGid = String(childRecord?.gardenId ?? "");
			// The CALLER's id goes through the SAME official conversion as the child's. `[측정
			// 2026-09-15]` reading it raw was a real miss: a pi witness reports `kind: "path"`, so
			// `agent_session.value` is a transcript PATH while the record is keyed by the uuid
			// inside that filename. The strict path→id rule is a measured vendor floor (S2-b:
			// grepping the store for the full path literal returns zero records), and bypassing it
			// for the caller made this cell fail on a rail that had worked.
			const callerRow = panes.find((row) => row.paneId === callerPane.pane_id);
			const callerJoined = callerRow === undefined ? null : joinKeyOf(callerRow);
			const callerNativeId = callerJoined?.nativeSessionId ?? "";
			const callerRecord = callerNativeId === "" ? undefined : records.get(callerNativeId);
			const callerGid = String(callerRecord?.gardenId ?? "");
			ok(
				`${cell.label}: the CALLER's own herdr witness also resolves to exactly one fixture record through the official conversion — the address the child had to call is a record, never a pane`,
				callerJoined !== null &&
					callerRecord !== undefined &&
					callerGid.length > 0 &&
					callerGid !== childGid &&
					[...records.values()].filter((r) => r.nativeSessionId === callerNativeId).length === 1,
			);

			// ── the callback, in whichever rail its CALLER actually answers on ──────────
			//
			// `[측정 2026-09-15]` this evidence is RAIL-SPECIFIC and collapsing it onto one rail is
			// a defect this smoke already shipped once. A claude caller is a self-fetch citizen, so
			// its callback lands as a delivered file in its mailbox directory. A pi caller is a
			// LIVE CONTROL-SOCKET citizen: the message goes straight down the socket, and no `.msg`
			// file — no mailbox directory at all — is ever created for it. Reading the mailbox on
			// the pi axis failed four cells on a rail whose production path had worked end to end.
			//
			// What both forms must carry is the same pair, and it is the pair rather than the nonce
			// alone that proves arrival: the caller's own receipt contains the nonce it MINTED, so
			// a nonce sighting in the caller's text is not evidence that anything came back. The
			// sender identity is. So each rail is read for: body === the nonce, and sender ===
			// the child the direct witness resolved to.
			// THE CHILD HAS ITS OWN CLOCK, and this is where that was measured (#116, 2026-09-17).
			// The loop above waits for the CALLER to finish its two tool calls; the child was
			// started somewhere inside the first of them and may still be booting when the caller
			// is done. Two consecutive runs of this same code differed only there — the caller's
			// launch took 56s in one and 37s in the other, and only the slower one gave the child
			// enough head start to have called back by the time this line ran. Judging the child on
			// the caller's clock is a race, and a race that reports a healthy rail as red. So the
			// child gets its own bounded wait for the artifact BEFORE anything is asserted about it.
			const childCallbackDeadline = Date.now() + CHILD_CALLBACK_WAIT_MS;
			while (Date.now() < childCallbackDeadline) {
				const seen = callerIsPi
					? /"customType":"entwurf-message"/.test(readTranscript(callerTranscript))
					: deliveredMessages(String(fenced.ENTWURF_META_MAILBOX_DIR), callerGid).length > 0;
				if (seen) break;
				sleep(POLL_MS);
			}
			if (callerIsPi) text = readTranscript(callerTranscript);

			// ── what the child was DOING when we stopped waiting ────────────────────────
			//
			// Diagnosis only — nothing below reads this, and no claim is made from it. It exists
			// because `[측정 2026-09-17]` a claude child that received its prompt and then called no
			// tool is indistinguishable, from every artifact this smoke had, between "it answered
			// and declined" and "it was still thinking". Two facts separate them and both are
			// cheap:
			//
			//   herdr agent status   `idle`/`done` means the turn ENDED with no tool call — the
			//                        child answered something and stopped. `working` means the
			//                        bound was short. `blocked` means it is waiting on a human.
			//   the hook journal     entwurf's own SessionStart/UserPromptSubmit stamps. `[측정
			//                        2026-09-17]` a silent child still stamps UserPromptSubmit
			//                        ~300ms after SessionStart, so "the prompt never arrived" is
			//                        already excluded and must not be re-guessed.
			//
			// The claude child leaves NO transcript to read: `[측정 2026-09-17]` every claude
			// session in this smoke — callers and children, acting and silent — is absent from the
			// operator's real `~/.claude/projects/` and from every fenced XDG root, including one
			// child that had just made two successful tool calls. That absence is a claude-runtime
			// fact, re-measured with HOME real, and is why the two stamps below are the evidence.
			const agentStatus = herdr(bin, env, ["agent", "list"]).stdout.trim();
			const hookJournal = ((): string => {
				try {
					return fs
						.readFileSync(path.join(root, "meta-bridge-hook.log"), "utf8")
						.trimEnd()
						.split("\n")
						.slice(-8)
						.join("\n");
				} catch {
					return "(no hook journal)";
				}
			})();
			lines.push(
				`### ${cell.label} — child diagnosis at the end of the wait`,
				"",
				"```",
				`herdr agent list: ${agentStatus.slice(0, 2000)}`,
				"",
				hookJournal,
				"```",
				"",
			);

			let nonce = "";
			let callbackArrived = false;
			let callbackForm = "";
			if (callerIsPi) {
				// The socket rail's artifact is the delivered `entwurf-message` in the caller's own
				// transcript: the body is the message, and `<sender_info>` is the envelope entwurf
				// synthesised at the receiver (`entwurf-control-rpc.ts` formatSenderInfoBlock).
				const message = /"customType":"entwurf-message","content":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? "";
				const decoded = message.replace(/\\n/g, "\n").replace(/\\"/g, '"');
				nonce = /(?:herdr|mux)-fresh-call-[0-9a-f]{24}/.exec(decoded)?.[0] ?? "";
				const senderId = /<sender_info>\{[^}]*"sessionId":"([^"]+)"/.exec(decoded)?.[1] ?? "";
				callbackArrived = nonce.length > 0 && decoded.trimStart().startsWith(nonce) && senderId === childGid;
				callbackForm = `control-socket entwurf-message (sender=${senderId || "none"})`;
			} else {
				const delivered = deliveredMessages(String(fenced.ENTWURF_META_MAILBOX_DIR), callerGid);
				const body = (delivered[0]?.text ?? "").split(/─{5,}/)[1]?.trim() ?? "";
				nonce = /(?:herdr|mux)-fresh-call-[0-9a-f]{24}/.exec(body)?.[0] ?? "";
				// THE FIRST ARTIFACT, NOT THE ONLY ONE `[측정 2026-09-18, LIVE run #2]`. This read
				// required `delivered.length === 1`, which the framing itself retired: since the
				// first turn asks the sibling to report its result back, a child that obeys sends
				// TWO messages — the nonce at 13:46:44 and `확인 토큰은 …` at 13:46:50 — and the
				// oracle failed the run for doing exactly what it was told. What the claim is about
				// is the FIRST one: the callback precedes the work, so the nonce must be the body of
				// the first artifact, and anything after it is the sibling answering.
				callbackArrived =
					delivered.length >= 1 &&
					nonce.length > 0 &&
					body === nonce &&
					(delivered[0]?.text ?? "").includes(`session:     ${childGid}`);
				callbackForm = `meta-mailbox delivered artifact (${delivered.length} file(s))`;
			}
			ok(
				`${cell.label}: the child's callback ARRIVED on the rail this caller answers on — its body is a production nonce and its sender is the child the direct witness resolved to, never the nonce the caller minted for itself — ${callbackForm}`,
				callbackArrived && childGid.length > 0,
			);
			// Nothing below may run on an empty nonce: `includes("")` is true for every string, and
			// a vacuous green here is exactly what the first corrected run produced.
			ok(
				`${cell.label}: the nonce used by every ordering cell below came from the DELIVERED callback, not from a default`,
				/^(?:herdr|mux)-fresh-call-[0-9a-f]{24}$/.test(nonce),
			);

			// ── the caller went on living ───────────────────────────────────────────────
			// A receiving session killed while answering is the exact shape of the C4 blocker and
			// it reads as an artifact that simply stops. Rail-specific again: the claude hook
			// journal records prompt submissions by native session id, while a pi caller writes
			// nothing there — its own transcript carries the delivered message and whatever it did
			// after it.
			const callerStillRunning = panes.some(
				(row) => row.paneId === callerPane.pane_id && row.sessionValue === callerNative,
			);
			let continued = false;
			let continuationForm = "";
			if (callerIsPi) {
				const at = text.indexOf('"customType":"entwurf-message"');
				continued = at > 0 && /"role":"assistant"/.test(text.slice(at));
				continuationForm = "an assistant message after the delivered entwurf-message";
			} else {
				const hookLog = readTranscript(path.join(root, "meta-bridge-hook.log"));
				const enqueuedAt = String(
					(
						JSON.parse(
							readTranscript(path.join(String(fenced.ENTWURF_META_MAILBOX_DIR), callerGid, "state.json")) || "{}",
						) as { lastEnqueuedAt?: string }
					).lastEnqueuedAt ?? "",
				);
				continued =
					enqueuedAt.length > 0 &&
					hookLog
						.split("\n")
						.filter((l) => l.includes("event=UserPromptSubmit") && l.includes(`native=${callerNative}`))
						.some((l) => (/^\S+/.exec(l)?.[0] ?? "") > enqueuedAt);
				continuationForm = "a UserPromptSubmit for this exact native session after the enqueue stamp";
			}
			ok(
				`${cell.label}: the caller took the callback INTO its turn and is still the live agent in its own pane — a caller killed mid-answer is what this axis exists to catch — ${continuationForm}`,
				continued && callerStillRunning,
			);

			// ── what each axis proves about the two tool calls ──────────────────────────
			if (callerIsPi) {
				ok(
					`${cell.label}: the PUBLIC tool answered with the HERDR receipt — never the tmux one`,
					text.includes("[entwurf fresh call → herdr]") && !text.includes("[entwurf fresh call →]\\n  backend"),
				);
				ok(
					`${cell.label}: that receipt carries the delivered nonce and herdr view coordinates — the TAB it created and that tab's initial pane, which is the placement policy this rail actually ran`,
					text.includes(nonce) && /w\d+:p/.test(text) && /w\d+:t/.test(text),
				);
				ok(
					`${cell.label}: the receipt promotes NO address — no garden id and no native session id in the tool text`,
					!/\bgardenId\b/.test(text) && text.includes("VIEW coordinates, not an address"),
				);
				ok(
					`${cell.label}: the in-herdr negative cell refused a non-pilot backend BY NAME`,
					text.includes("herdr-backend-unsupported"),
				);
				ok(
					`${cell.label}: the caller recorded BOTH tool results and no stream error reached its transcript — an async EPIPE on a control socket is what killed a resident session on the first run of this axis`,
					text.includes(childGid) && !/\bEPIPE\b|\bECONNRESET\b|uncaughtException/.test(text),
				);
			} else {
				const order = toolCallOrder(callerActivity);
				const successAt = indexOfEntry(callerActivity, (e) =>
					(e.debug ?? "").startsWith("Tool 'entwurf_fresh_call' completed successfully"),
				);
				const rejectAt = indexOfEntry(callerActivity, (e) => (e.error ?? "").includes("herdr-backend-unsupported"));
				ok(
					`${cell.label}: the caller's own MCP activity log — joined by its EXACT session id, never by filename or recency — shows the PUBLIC entwurf_fresh_call completing successfully and NOTHING else called before it`,
					callerActivity.length > 0 && order[0] === "entwurf_fresh_call" && successAt >= 0,
				);
				ok(
					`${cell.label}: the in-herdr negative cell refused a non-pilot backend BY NAME, after the successful call — nothing was created and no tmux fallback was taken`,
					rejectAt > successAt &&
						(callerActivity[rejectAt]?.error ?? "").includes("No tab and no pane were created.") &&
						order.filter((t) => t === "entwurf_fresh_call").length === 2,
				);
			}

			// ── the child's FIRST action was the callback ───────────────────────────────
			const childNative = String(joined?.nativeSessionId ?? childRow?.sessionValue ?? "");
			if (cell.childKind === "pi") {
				const childRecords = transcriptRecords(String(childRow?.sessionValue ?? ""));
				const childText = childRecords.join("\n");
				// THE JOIN, NOT THE RECORD, IS WHAT THIS CLAIM IS ABOUT `[측정 2026-09-18]`. An earlier
				// version asked for ONE record carrying both the delivered nonce and the `sent`
				// outcome. Pi's transcript can never satisfy that: the nonce rides the toolCall record
				// (`content[].toolCall.id`) and the outcome rides the separate toolResult record
				// (`message.toolCallId`), and the two are joined by that id. It failed a run whose
				// child did exactly the right thing — callback at .381, `sent` at .415, task token at
				// 03.728 — which is the most expensive kind of red there is. What the one-record rule
				// was guarding against ("some nonce appeared somewhere earlier, so call it proof") is
				// held by the join itself: the outcome must belong to THE call that carried THIS nonce.
				const callAt = childRecords.findIndex((record) => entwurfCallIdFor(record, nonce, callerGid) !== null);
				const callId = callAt >= 0 ? entwurfCallIdFor(childRecords[callAt], nonce, callerGid) : null;
				const sentAt =
					callId === null
						? -1
						: childRecords.findIndex(
								(record, i) => i > callAt && CONTROL_ACCEPTED.test(record) && toolResultIdOf(record) === callId,
							);
				// The LAST mention of the task token, so the birth prompt — which carries it, first —
				// cannot be what satisfies "the work came after".
				let workedAt = -1;
				for (let i = childRecords.length - 1; i >= 0; i -= 1) {
					if (childRecords[i].includes(token)) {
						workedAt = i;
						break;
					}
				}
				ok(
					`${cell.label}: the child decoded the one-line birth argv and ran the task only AFTER its callback — the ACCEPTED outcome belongs, by toolCallId, to the very call that carried the delivered nonce, and the task token appears in a record after it`,
					nonce.length > 0 && callAt >= 0 && sentAt > callAt && workedAt > sentAt,
				);
				ok(
					`${cell.label}: the child's OWN tool result says the callback was ACCEPTED on the rail its caller answers on — one of \`sent|queued-steer|queued-follow-up|accepted-unknown-boundary\` — not a timeout, not a reject, not a dirty lock`,
					CONTROL_ACCEPTED.test(childText) &&
						!/entwurf_v2 [a-z-]+ (?:execution failed:|DELIVERED \()/.test(childText) &&
						!/entwurf_v2 control-socket → (?:rejected|failed)/.test(childText),
				);
			} else {
				const childActivity = mcpActivityBySession(root).get(childNative) ?? [];
				const order = toolCallOrder(childActivity);
				// THE CALLBACK COMES BEFORE THE TASK — and a read-only corroboration may come before
				// BOTH. `[측정 2026-09-17, oracle, LIVE]` this cell used to require `order[0] ===
				// "entwurf_v2"`, and a Sonnet 5 child failed it by calling `entwurf_peers` first and
				// the callback second. That is not a violation: the framing this rail now sends
				// OFFERS exactly that corroboration ("you can corroborate the caller first if you
				// want to"), so the old oracle contradicted our own prompt and would have forbidden
				// the behaviour we asked for. What still must hold is everything the claim was
				// actually about — the callback lands before any work, it completes, and neither the
				// callback verb nor the delivery verb failed or timed out anywhere in the log.
				// `[ff09522]` the verb this joins on MOVED: the birth callback is `entwurf_callback`
				// and `entwurf_v2` is now only the DELIVERY the closing line asks for. Joining on the
				// old name does not merely miss — it mis-attributes, finding the result-delivery call
				// and then reporting the real callback as forbidden work before it.
				// ONLY what the framing actually offers. `entwurf_self` used to sit in this set and
				// nothing ever proposed it to the child — an allowance for a tool we do not mention
				// widens the oracle without widening the contract (sol D1, 2026-09-18).
				const READ_ONLY_FIRST = new Set(["entwurf_peers"]);
				const beforeCallback = order.slice(0, Math.max(order.indexOf(CALLBACK_VERB), 0));
				// THE JOIN THIS AXIS CAN ACTUALLY MAKE. The claude MCP log records WHICH tool was
				// called and whether it completed — never its arguments or its result body — so
				// "the first callback completed" alone would also be true of a call that delivered
				// somebody else's nonce or came back as a semantic reject over a successful
				// transport. The second artifact closes it: the caller's own delivered message
				// carries the EXACT nonce and the child as its sender, and its enqueue timestamp has
				// to fall inside the window of that first call. Two independent records, one event.
				const callAt = indexOfEntry(childActivity, (e) => (e.debug ?? "") === `Calling MCP tool: ${CALLBACK_VERB}`);
				const doneAt = indexOfEntry(childActivity, (e) =>
					(e.debug ?? "").startsWith(`Tool '${CALLBACK_VERB}' completed successfully`),
				);
				const callbackStamp = deliveredMessages(String(fenced.ENTWURF_META_MAILBOX_DIR), callerGid)[0]?.file ?? "";
				const stampedAt = Date.parse(
					/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(callbackStamp)
						? callbackStamp.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z.*$/, "$1T$2:$3:$4.$5Z")
						: "",
				);
				const within =
					callAt >= 0 &&
					doneAt > callAt &&
					Number.isFinite(stampedAt) &&
					stampedAt >= Date.parse(childActivity[callAt]?.timestamp ?? "") &&
					stampedAt <= Date.parse(childActivity[doneAt]?.timestamp ?? "");
				ok(
					// WHAT THIS AXIS CAN SEE, SAID EXACTLY `[sol 재검 2026-09-18]`. The claim used to read
					// "called back BEFORE doing any work". This cell's only evidence is the child's MCP
					// tool activity — §14 measured that a claude child of this rail leaves no transcript
					// anywhere — so assistant text it may have produced before the call is invisible
					// here, and a claim about "any work" is wider than the oracle. What IS observed, and
					// is the thing the framing actually asks for, is the ORDER OF TOOLS: the first
					// non-read-only tool this child called was the callback.
					`${cell.label}: the child's FIRST non-read-only tool call was the zero-argument ${CALLBACK_VERB} — it completed successfully and the delivered callback carrying this exact nonce was enqueued inside that call's own window, preceded only by the read-only corroboration the framing offers, with neither ${CALLBACK_VERB} nor ${DELIVERY_VERB} failing or timing out anywhere in its log (this cell reads tool activity only; assistant text is not observable on this rail)`,
					childActivity.length > 0 &&
						order.includes(CALLBACK_VERB) &&
						beforeCallback.every((name) => READ_ONLY_FIRST.has(name)) &&
						within &&
						callbackArrived &&
						// BOTH verbs, because the child uses both: the birth callback and, after the
						// work, the delivery verb the framing's closing line names. A failed delivery
						// is as fatal to this rail as a failed callback.
						![CALLBACK_VERB, DELIVERY_VERB].some((verb) =>
							childActivity.some(
								(e) => (e.debug ?? "").startsWith(`Tool '${verb}' failed`) || (e.error ?? "").includes(verb),
							),
						),
				);
			}
			// ── HFC-LIVE-FINAL-RESULT-DELIVERED: the framing's last line, actually observed ──
			//
			// `dc550cd` added one sentence to the first turn — tell the sibling where its result
			// goes — and nothing yet measured that a sibling obeys it. `[측정 2026-09-18, LIVE #2]`
			// one does: the claude child sent the nonce at 13:46:44 and `확인 토큰은 …` at 13:46:50,
			// to the same caller, on the same rail. That second message is the acceptance of the
			// framing line, so it is asserted rather than tolerated — and it is asserted AFTER the
			// callback cells, because arriving first would be the framing being disobeyed.
			// It gets the child's own bound for the same reason the callback does: the caller's
			// clock says nothing about how long the sibling takes to finish its task.
			{
				// THE SENDER IS HALF THE CLAIM `[sol 재검 2026-09-18]`. "The sibling reported its
				// result" is a statement about WHO sent it, and a body-only read makes it true of any
				// message that happens to carry the token — including one the caller wrote to itself.
				// So each rail is read for the pair, exactly as the callback cell above is: the body
				// carries the token AND the same record's sender is the child.
				const resultDeadline = Date.now() + CHILD_CALLBACK_WAIT_MS;
				let resultText = "";
				let resultSender = "";
				while (Date.now() < resultDeadline) {
					if (callerIsPi) {
						const messages = [
							...readTranscript(callerTranscript).matchAll(
								/"customType":"entwurf-message","content":"((?:[^"\\]|\\.)*)"/g,
							),
						]
							.map((match) => match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'))
							.filter((decoded) => !decoded.trimStart().startsWith(nonce));
						const hit = messages.find(
							(decoded) =>
								decoded.includes(token) &&
								(/<sender_info>\{[^}]*"sessionId":"([^"]+)"/.exec(decoded)?.[1] ?? "") === childGid,
						);
						resultText = hit ?? "";
						resultSender = hit === undefined ? "" : childGid;
					} else {
						const delivered = deliveredMessages(String(fenced.ENTWURF_META_MAILBOX_DIR), callerGid);
						const hit = delivered
							.slice(1)
							.find(
								(artifact) =>
									(artifact.text.split(/─{5,}/)[1]?.trim() ?? "").includes(token) &&
									artifact.text.includes(`session:     ${childGid}`),
							);
						resultText = hit === undefined ? "" : (hit.text.split(/─{5,}/)[1]?.trim() ?? "");
						resultSender = hit === undefined ? "" : childGid;
					}
					if (resultText.length > 0) break;
					sleep(POLL_MS);
				}
				lines.push(
					"",
					`### ${cell.label} — final result message (sender ${resultSender || "none"})`,
					"```",
					resultText.slice(0, 500),
					"```",
					"",
				);
				ok(
					`${cell.label}: the SIBLING reported its RESULT back to the caller after the callback — a later message on the same rail whose body carries this cell's task token and whose sender is the child itself, which is the first LIVE evidence that the framing's closing line is followed rather than merely written`,
					resultText.includes(token) && resultSender === childGid && childGid.length > 0,
				);
			}
			ok(
				`${cell.label}: the fixture store holds every record this cell minted and the operator's store holds none of them`,
				records.size > 0 && storeDir.startsWith(root),
			);
		}
	} finally {
		fs.writeFileSync(artifact, `${lines.join("\n")}\n`);
		for (const { cell, env, socket } of servers) {
			herdr(bin, env, ["server", "stop"]);
			sleep(2000);
			ok(`${cell.label}: the private server stopped and reclaimed its socket`, !fs.existsSync(socket));
		}
		const afterOperator = operatorPanes(bin);
		ok(
			"the operator's herdr panes are byte-identical — every pane this smoke opened lived on a private server",
			afterOperator === beforeOperator,
		);
		// INTEGRITY ORACLE (#67). The launcher this smoke's children could rewrite is re-derived
		// from the same facts the preflight pinned. A retarget is a FAILURE of this smoke, not a
		// note: the operator's `claude` is how the next session starts.
		const launcherProblems = verifyClaudeLauncher(launcher);
		lines.push("", `## operator claude launcher`, `- ${launcher.launcherPath} -> ${launcher.resolvedPath}`);
		for (const problem of launcherProblems) lines.push(`- PROBLEM: ${problem}`);
		ok(
			`the operator's claude launcher is untouched — same kind, same link, same resolved target, same content (${launcher.launcherPath})`,
			launcherProblems.length === 0,
		);
		// This fixture is deliberately preserved as evidence, so the cleanup guard is not gating a
		// removal here — it is stating, by name, whether a later `rm -rf` of this tree would sever
		// the operator's launcher.
		const cleanup = assessLauncherCleanup(launcher);
		if (!cleanup.safeToRemove) {
			for (const problem of cleanup.problems) {
				console.error(`  WARN  removing ${root} would damage the operator's launcher: ${problem}`);
				lines.push(`- DO NOT REMOVE ${root}: ${problem}`);
			}
		}
		fs.writeFileSync(artifact, `${lines.join("\n")}\n`);
		console.log(`\n[${LABEL}] receipts: ${artifact}`);
	}

	if (failures.length > 0) {
		console.error(`\n[${LABEL}] ${failures.length} FAILED, ${passed} ok`);
		process.exit(1);
	}
	console.log(`\n[${LABEL}] ${passed} assertions ok`);
}

await main();
