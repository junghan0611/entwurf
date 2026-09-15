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
import { encodeBirthPrompt } from "../pi-extensions/lib/herdr-fresh-call.ts";
import { joinKeyOf, parseHerdrPaneList } from "../pi-extensions/lib/herdr-placement.ts";
import { skipLive } from "./lib/live-skip.ts";

const LABEL = "smoke-herdr-fresh-call-live";
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_HOME = process.env.HOME ?? os.homedir();
const REAL_PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(REAL_HOME, ".pi", "agent");
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR?.trim() || null;
const REAL_CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR || path.join(REAL_HOME, ".claude");

/** How long a caller's whole turn may take: it has to boot, call the tool, and have its child
 * boot and call back. Bounded, and a timeout is a RED rather than a retry. */
const CELL_TIMEOUT_MS = 240_000;
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
			childModel: "opus",
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
			// The CALLER gets the transport (one physical line) but NOT the production framing:
			// `composeFreshCallPrompt` would order it to call back to a garden id, and this fixture
			// has none to give — the first run did exactly that and sent the caller dispatching at
			// an id that does not exist. The child's framing is composed by PRODUCTION when the
			// caller invokes the tool, which is the thing under test.
			const encodedCaller = encodeBirthPrompt(callerTask);
			if (!encodedCaller.ok) throw new Error(`${LABEL}: the caller prompt could not be encoded`);
			const callerArgs =
				cell.callerKind === "pi"
					? [encodedCaller.argv, "--approve", "--entwurf-control", "--model", cell.callerModel]
					: [encodedCaller.argv, `--model=${cell.callerModel}`];
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
				callbackArrived =
					delivered.length === 1 &&
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
				const childText = readTranscript(String(childRow?.sessionValue ?? ""));
				ok(
					`${cell.label}: the child decoded the one-line birth argv and ran the task only AFTER its callback`,
					childText.includes(token) &&
						childText.indexOf(nonce) > 0 &&
						childText.indexOf(nonce) < childText.indexOf(token),
				);
				ok(
					`${cell.label}: the child's OWN tool result says the callback was DELIVERED on the rail its caller answers on — \`entwurf_v2 control-socket → sent\` — not a timeout, not a reject, not a dirty lock`,
					childText.includes("entwurf_v2 control-socket → sent") &&
						!/entwurf_v2 [a-z-]+ (?:execution failed:|DELIVERED \()/.test(childText) &&
						!/entwurf_v2 control-socket → (?!sent)[a-z-]+/.test(childText),
				);
			} else {
				const childActivity = mcpActivityBySession(root).get(childNative) ?? [];
				const order = toolCallOrder(childActivity);
				ok(
					`${cell.label}: the child decoded the one-line birth argv and its FIRST tool action was the callback — entwurf_v2, completed successfully, with no failed or timed-out entwurf_v2 anywhere in its log`,
					childActivity.length > 0 &&
						order[0] === "entwurf_v2" &&
						childActivity.some((e) => (e.debug ?? "").startsWith("Tool 'entwurf_v2' completed successfully")) &&
						!childActivity.some(
							(e) => (e.debug ?? "").startsWith("Tool 'entwurf_v2' failed") || (e.error ?? "").includes("entwurf_v2"),
						),
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
		console.log(`\n[${LABEL}] receipts: ${artifact}`);
	}

	if (failures.length > 0) {
		console.error(`\n[${LABEL}] ${failures.length} FAILED, ${passed} ok`);
		process.exit(1);
	}
	console.log(`\n[${LABEL}] ${passed} assertions ok`);
}

await main();
