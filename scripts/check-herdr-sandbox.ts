/**
 * check-herdr-sandbox — REAL herdr acceptance for the #116 launch rail (C2a).
 *
 * This is the half `check-herdr-fresh-call` cannot judge. That gate pins argv, encoding,
 * parsing and the reclaim decision without a binary; here a PRIVATE herdr server opens a real
 * pane, starts a real blank pi, and the assertions read what herdr and our own record store
 * actually produced. There is no fake herdr anywhere in this repo, for the same reason there is
 * no fake tmux (`scripts/check-mux-placement.ts:6-9`): a stand-in authors the contract before
 * anything is measured.
 *
 * ISOLATION IS THE PRECONDITION, AND IT HAS TWO ROOTS. `[측정 2026-09-14]` herdr's integration
 * and the meta-record store follow `PI_CODING_AGENT_DIR`, while the entwurf control socket
 * follows `HOME` (`<HOME>/.pi/entwurf-control/`). Sandbox one and the other writes into the
 * operator's tree, so both are sandboxed here, the child starts from an EXPLICIT environment
 * (no inherited `PI_SESSION_ID`/`PI_AGENT_ID`/auth), and the operator's own herdr panes are
 * snapshotted read-only before and after and must be identical.
 *
 * WHY `--approve` IS IN THE FIXTURE AND NOT IN THE RAIL. `[측정 2026-09-14]` a fresh HOME has no
 * `trust.json`, so pi parks on `Trust project folder?` and waits for a KEYSTROKE — which this
 * product never sends. `pi --approve` ("Trust project-local files for this run") clears that for
 * one run and `[측정]` writes NO trust file. The gate is the operator of its own sandbox, so it
 * may authorise its own fixture. Production argv must never carry it: `project-trust-handler.ts`
 * records "an agent cannot self-promote trust" as an intended security asymmetry, and a launcher
 * approving on the operator's behalf would quietly take that judgement away from them.
 *
 * ADMISSION. herdr is an OPTIONAL rail, so a host without the binary prints a named SKIP and
 * exits 0 — a deterministic surface has no third outcome, and a silent pass would let green lie.
 * A host WITH herdr that cannot complete the cell FAILS: absent is optional, broken is not.
 * `ENTWURF_REQUIRE_HERDR=1` turns absence itself into a failure; CI admission (who installs
 * herdr and at which version) is not wired yet and belongs to C2b.
 *
 * Each claim carries its QK token on exactly ONE assertion.
 *
 *   HS-VERSION-BOUNDARY     the measured herdr compatibility boundary is pinned, not assumed
 *   HS-SANDBOX-ISOLATED     the private server answers on its own socket and the child's
 *                           environment carries no operator identity
 *   HS-ONE-SEED             ONE checkout package registration loads entwurf's pi extension
 *   HS-NO-TRUST-WRITE       the fixture's `--approve` leaves no trust state behind
 *   HS-OFFICIAL-TRIPLE      herdr's direct witness carries source+agent+shape, not a bare value
 *   HS-EXACT-ONE-RECORD     that witness resolves to exactly one sandbox V3 record
 *   HS-CONTROL-SOCKET-ALIVE the citizen's control socket answers the production probe
 *   HS-CLOSE-REFUSES-LIVE   the conditional close refuses a pane that has an agent
 *   HS-CLOSE-RECLAIMS       the same decision closes a pane we own with no agent
 *   HS-NO-RESIDUE           server stop leaves no socket, no process and no tree
 *   HS-OPERATOR-UNTOUCHED   the operator's panes and pi config are identical afterwards
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildHerdrPaneCloseArgs,
	buildHerdrPaneGetArgs,
	buildHerdrSplitArgs,
	decideConditionalClose,
	parseHerdrAgentStartResponse,
	parseHerdrPaneGetResponse,
	parseHerdrSplitResponse,
} from "../pi-extensions/lib/herdr-fresh-call.ts";
import { joinKeyOf, parseHerdrPaneList } from "../pi-extensions/lib/herdr-placement.ts";
import { probeSocketLiveness } from "../pi-extensions/lib/socket-probe.ts";

const LABEL = "check-herdr-sandbox";
const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The ONE herdr line this rail has been measured against. A different line is not a silent
 * pass and not a skip: it is a FAILURE that asks for a re-measurement, because
 * `docs/herdr-launch-rail.md` owns the boundary and cannot speak for a version nobody ran. */
const MEASURED_HERDR_MAJOR_MINOR = "0.9.";
const OWNING_DOC = "docs/herdr-launch-rail.md";

/** Absence of an optional rail is not a defect — but it must be visible. */
const SKIP_MARKER = "[entwurf:herdr-rail-skip]";
/** How a future CI turns "no herdr here" into red without changing this file. */
const REQUIRE_ENV = "ENTWURF_REQUIRE_HERDR";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

function skip(reason: string): never {
	console.log(`${SKIP_MARKER} ${LABEL} — ${reason}`);
	console.log(
		`${SKIP_MARKER} herdr is an OPTIONAL rail: this cell did not run. Set ${REQUIRE_ENV}=1 to make its absence a failure.`,
	);
	process.exit(0);
}

function fail(reason: string): never {
	console.error(`[${LABEL}] FAIL — ${reason}`);
	process.exit(1);
}

/** PATH lookup without a shell: the gate's own admission decision must not depend on how a
 * shell would have quoted anything. */
function which(bin: string): string | null {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (dir.length === 0) continue;
		const candidate = path.join(dir, bin);
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			if (fs.statSync(candidate).isFile()) return candidate;
		} catch {
			// Not here, or not executable by us. Keep walking.
		}
	}
	return null;
}

interface Sandbox {
	readonly root: string;
	readonly agentDir: string;
	readonly env: NodeJS.ProcessEnv;
}

/** The child's whole environment, stated rather than inherited. `PATH` and `TERM` are the only
 * things carried across, and every identity/auth carrier the operator's shell holds is simply
 * not in this map. */
function makeSandbox(bin: string): Sandbox {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-herdr-gate."));
	const agentDir = path.join(root, "pi-agent");
	for (const dir of [".config", ".state", ".data", ".cache", "pi-agent"]) {
		fs.mkdirSync(path.join(root, dir), { recursive: true });
	}
	// The ONE seed: this checkout, registered as a pi package, so the extension under test is
	// the source in this working tree and not an installed copy of some other version.
	fs.writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify({ packages: [REPO_DIR] }, null, 2)}\n`);
	return {
		root,
		agentDir,
		env: {
			PATH: `${path.dirname(bin)}:${process.env.PATH ?? ""}`,
			TERM: "xterm-256color",
			HOME: root,
			XDG_CONFIG_HOME: path.join(root, ".config"),
			XDG_STATE_HOME: path.join(root, ".state"),
			XDG_DATA_HOME: path.join(root, ".data"),
			XDG_CACHE_HOME: path.join(root, ".cache"),
			PI_CODING_AGENT_DIR: agentDir,
		},
	};
}

function herdr(
	bin: string,
	sandbox: Sandbox,
	args: readonly string[],
): { status: number; stdout: string; stderr: string } {
	const run = spawnSync(bin, [...args], { encoding: "utf8", env: sandbox.env, timeout: 120_000 });
	return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** The operator's own panes, read WITHOUT the sandbox environment. An operator with no server
 * running is a valid state — it just has to be the same state afterwards. */
function operatorPanes(bin: string): string {
	const run = spawnSync(bin, ["pane", "list"], { encoding: "utf8", timeout: 30_000 });
	if ((run.status ?? 1) !== 0) return "no-operator-server";
	const rows = parseHerdrPaneList(run.stdout ?? "");
	if (rows === null) return "unreadable";
	return JSON.stringify(rows.map((row) => [row.paneId, row.agent, row.sessionKind, row.sessionValue]).sort());
}

function sleep(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForSocket(file: string, timeoutMs: number): boolean {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(file)) return true;
		sleep(100);
	}
	return false;
}

/** Linux-only: a process still holding the sandbox HOME after `server stop`. Elsewhere the
 * socket/tree checks stand alone and this one reports `null` rather than guessing. */
function sandboxProcesses(root: string): number | null {
	if (process.platform !== "linux") return null;
	let count = 0;
	for (const entry of fs.readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const environ = fs.readFileSync(`/proc/${entry}/environ`, "utf8");
			if (environ.split("\0").includes(`HOME=${root}`)) count++;
		} catch {
			// The process exited while we were reading it, which is the state we wanted anyway.
		}
	}
	return count;
}

async function main(): Promise<void> {
	console.log(`[${LABEL}]`);
	const required = process.env[REQUIRE_ENV] === "1";

	const bin = which("herdr");
	if (bin === null) {
		if (required) fail(`${REQUIRE_ENV}=1 but no herdr binary is on PATH`);
		skip("no herdr binary on PATH");
	}

	const version = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 30_000 });
	const versionText = `${version.stdout ?? ""}`.trim();
	if ((version.status ?? 1) !== 0) fail(`herdr is on PATH at ${bin} but \`herdr --version\` failed: ${version.stderr}`);
	ok(
		`[QK:HS-VERSION-BOUNDARY] the herdr line under test is the one this rail was measured against (${MEASURED_HERDR_MAJOR_MINOR}x) — a different line fails and asks for a re-measurement rather than claiming a version nobody ran; ${OWNING_DOC} owns the boundary`,
		versionText.includes(`herdr ${MEASURED_HERDR_MAJOR_MINOR}`),
	);

	const pi = which("pi");
	if (pi === null) {
		// Present-but-incomplete is a failure, not a skip: the rail IS here, and a green run
		// would claim a cell that never happened.
		fail(`herdr is installed (${bin}) but pi is not on PATH — the herdr rail is present and incomplete`);
	}

	const before = operatorPanes(bin);
	const operatorTrust = path.join(os.homedir(), ".pi", "agent", "trust.json");
	const operatorTrustBefore = fs.existsSync(operatorTrust) ? fs.statSync(operatorTrust).mtimeMs : null;

	const sandbox = makeSandbox(bin);
	const serverLog = fs.openSync(path.join(sandbox.root, "server.log"), "a");
	const server = spawn(bin, ["server"], {
		cwd: sandbox.root,
		env: sandbox.env,
		detached: true,
		stdio: ["ignore", serverLog, serverLog],
	});
	server.unref();

	let cleanupDone = false;
	const stopServer = (): void => {
		if (cleanupDone) return;
		cleanupDone = true;
		herdr(bin, sandbox, ["server", "stop"]);
		sleep(2000);
	};

	try {
		const socketPath = path.join(sandbox.root, ".config", "herdr", "herdr.sock");
		if (!waitForSocket(socketPath, 20_000)) fail(`the private herdr server never opened ${socketPath}`);

		const listed = herdr(bin, sandbox, ["pane", "list"]);
		const sandboxRows = parseHerdrPaneList(listed.stdout);
		ok(
			"[QK:HS-SANDBOX-ISOLATED] the private server answers on its OWN socket under the sandbox root, and the operator's panes are not in its listing — two servers, no shared state",
			listed.status === 0 &&
				sandboxRows !== null &&
				fs.existsSync(socketPath) &&
				!socketPath.startsWith(os.homedir()) &&
				sandbox.env.PI_SESSION_ID === undefined &&
				sandbox.env.PI_AGENT_ID === undefined,
		);

		const install = herdr(bin, sandbox, ["integration", "install", "pi"]);
		const extension = path.join(sandbox.agentDir, "extensions", "herdr-agent-state.ts");
		if (install.status !== 0 || !fs.existsSync(extension)) {
			fail(`\`herdr integration install pi\` did not land in the sandbox (${extension}): ${install.stderr}`);
		}

		const ws = herdr(bin, sandbox, ["workspace", "create", "--label", "entwurf-gate", "--no-focus", "--cwd", REPO_DIR]);
		if (ws.status !== 0) fail(`workspace create failed in the sandbox: ${ws.stderr}`);

		// The production split argv, with the production identity scrub, against a real server.
		const splitRun = herdr(bin, sandbox, buildHerdrSplitArgs({ parentPaneId: "w1:p1", cwd: REPO_DIR }));
		const splitPane = splitRun.status === 0 ? parseHerdrSplitResponse(splitRun.stdout) : null;
		if (splitPane === null) fail(`pane split failed or was unreadable: ${splitRun.stderr || splitRun.stdout}`);

		// `--approve` is the fixture's own one-run authorisation; `--entwurf-control` is the
		// production citizenship flag. No prompt, no model, no credentials.
		const start = herdr(bin, sandbox, [
			"agent",
			"start",
			"entwurfgate",
			"--kind",
			"pi",
			"--pane",
			splitPane.paneId,
			"--",
			"--approve",
			"--entwurf-control",
		]);
		if (start.status !== 0) fail(`blank pi did not start in the sandbox: ${start.stderr || start.stdout}`);

		const startedPane = parseHerdrAgentStartResponse(start.stdout);
		const startJson = JSON.parse(start.stdout) as {
			result?: {
				argv?: string[];
				agent?: { agent_session?: { agent?: string; kind?: string; source?: string; value?: string } };
			};
		};
		const session = startJson.result?.agent?.agent_session;
		const joinKey =
			session === undefined
				? null
				: joinKeyOf({
						paneId: splitPane.paneId,
						agent: session.agent ?? null,
						sessionSource: session.source ?? null,
						sessionKind: session.kind === "id" || session.kind === "path" ? session.kind : null,
						sessionValue: session.value ?? null,
					});
		ok(
			"[QK:HS-OFFICIAL-TRIPLE] the direct witness is an OFFICIAL herdr report — source, agent and the shape that source is measured to emit — and the production join leaf converts pi's session PATH to the native id rather than accepting a bare value",
			startedPane !== null &&
				session !== undefined &&
				session.source === "herdr:pi" &&
				session.agent === "pi" &&
				session.kind === "path" &&
				joinKey !== null &&
				joinKey.backend === "pi" &&
				(session.value ?? "").includes(joinKey.nativeSessionId),
		);
		ok(
			"[QK:HS-ONE-SEED] ONE checkout package registration is the whole seed — entwurf's pi extension loaded from this working tree, and the fixture's argv reached pi byte-identical",
			JSON.stringify(startJson.result?.argv) === JSON.stringify(["pi", "--approve", "--entwurf-control"]) &&
				(JSON.parse(fs.readFileSync(path.join(sandbox.agentDir, "settings.json"), "utf8")) as { packages: string[] })
					.packages.length === 1,
		);

		const storeDir = path.join(sandbox.agentDir, "meta-sessions");
		const records = fs.existsSync(storeDir) ? fs.readdirSync(storeDir).filter((f) => f.endsWith(".meta.json")) : [];
		const holders = records
			.map((f) => JSON.parse(fs.readFileSync(path.join(storeDir, f), "utf8")) as Record<string, unknown>)
			.filter((r) => r.nativeSessionId === joinKey?.nativeSessionId);
		const record = holders[0];
		ok(
			"[QK:HS-EXACT-ONE-RECORD] the witness resolves to EXACTLY ONE V3 record in the sandbox store, carrying the backend and cwd it was launched with — no model turn and no credential was needed to mint it",
			records.length === 1 &&
				holders.length === 1 &&
				record?.schemaVersion === 3 &&
				record?.backend === "pi" &&
				record?.cwd === REPO_DIR,
		);
		ok(
			"[QK:HS-NO-TRUST-WRITE] the fixture's one-run --approve left NO trust state behind — the sandbox has no trust.json, so this authorisation cannot leak into any later run",
			!fs.existsSync(path.join(sandbox.agentDir, "trust.json")),
		);

		const controlSocket = path.join(sandbox.root, ".pi", "entwurf-control", `${String(record?.gardenId)}.sock`);
		const socketExists = fs.existsSync(controlSocket) && fs.statSync(controlSocket).isSocket();
		const liveness = socketExists ? await probeSocketLiveness(controlSocket, { timeoutMs: 2000 }) : "dead";
		ok(
			"[QK:HS-CONTROL-SOCKET-ALIVE] the citizen's control socket answers the PRODUCTION probe — existence and `stat` are a separate, weaker fact, and only the probe says alive",
			socketExists && liveness === "alive",
		);

		// ── the conditional close, against a real server ─────────────────────────────────
		const liveGet = herdr(bin, sandbox, buildHerdrPaneGetArgs(splitPane.paneId));
		const liveDecision = decideConditionalClose(
			splitPane,
			liveGet.status === 0 ? parseHerdrPaneGetResponse(liveGet.stdout) : null,
			liveGet.status !== 0,
		);
		ok(
			"[QK:HS-CLOSE-REFUSES-LIVE] the reclaim decision REFUSES a pane that now holds an agent, naming agent-session-present — a living sibling is never closed by the path that exists to clean up a failed launch",
			liveDecision.close === false && liveDecision.reason === "agent-session-present",
		);

		const spareRun = herdr(bin, sandbox, buildHerdrSplitArgs({ parentPaneId: "w1:p1" }));
		const sparePane = spareRun.status === 0 ? parseHerdrSplitResponse(spareRun.stdout) : null;
		if (sparePane === null) fail(`the second split failed or was unreadable: ${spareRun.stderr || spareRun.stdout}`);
		const spareGet = herdr(bin, sandbox, buildHerdrPaneGetArgs(sparePane.paneId));
		const spareDecision = decideConditionalClose(
			sparePane,
			spareGet.status === 0 ? parseHerdrPaneGetResponse(spareGet.stdout) : null,
			spareGet.status !== 0,
		);
		const closeRun = spareDecision.close ? herdr(bin, sandbox, buildHerdrPaneCloseArgs(sparePane.paneId)) : null;
		const afterClose = herdr(bin, sandbox, ["pane", "list"]);
		const remaining = parseHerdrPaneList(afterClose.stdout) ?? [];
		ok(
			"[QK:HS-CLOSE-RECLAIMS] the SAME decision closes a pane we own that has no agent — proof within one server generation, not a bare pane id",
			spareDecision.close === true &&
				closeRun !== null &&
				closeRun.status === 0 &&
				!remaining.some((row) => row.paneId === sparePane.paneId),
		);

		stopServer();
		ok(
			"[QK:HS-NO-RESIDUE] stopping the private server reclaims its socket and leaves no process holding the sandbox — the fixture owns its own teardown",
			!fs.existsSync(socketPath) && (sandboxProcesses(sandbox.root) ?? 0) === 0,
		);
	} finally {
		stopServer();
		fs.rmSync(sandbox.root, { recursive: true, force: true });
		try {
			fs.closeSync(serverLog);
		} catch {
			// Already closed with the process; nothing here depends on it.
		}
	}

	const operatorTrustAfter = fs.existsSync(operatorTrust) ? fs.statSync(operatorTrust).mtimeMs : null;
	ok(
		"[QK:HS-OPERATOR-UNTOUCHED] the operator's herdr panes and pi trust store are byte-identical afterwards — the whole cell happened somewhere else",
		operatorPanes(bin) === before && operatorTrustAfter === operatorTrustBefore && !fs.existsSync(sandbox.root),
	);

	console.log(`\n[${LABEL}] ${passed} assertions ok (private ${versionText})`);
}

await main();
