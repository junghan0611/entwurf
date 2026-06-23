// S1 acceptance smoke — ACP-model session is a first-class socket-citizen.
//
// Proves, end-to-end against a REAL pi resident, the S1 claim: a
// `pi --entwurf-control` session whose model is an ACP model
// (entwurf/claude-*) is a first-class v2 socket-citizen — peers-visible and
// get_info-answerable — WITHOUT running a backend turn. Citizenship is supplied
// by the host control socket (model-agnostic), not by the ACP plugin.
//
// It also clears the two S1 question marks live:
//   QM1  model-lock.ts does NOT revert a launch-with-ACP-model: get_info still
//        reports provider "entwurf" after the resident anchors.
//   QM2  the fail-loud streamSimple stub does NOT fire at launch: the resident
//        stands its socket up and stays alive with no turn (no stub error on
//        stderr); the stub is a turn-only hard stop, never a launch-time crash.
//
// No prompt is ever sent, so streamSimple is never invoked — selecting the model
// and standing the control socket up is turn-free by construction. The real ACP
// backend turn is S2; this smoke must NOT exercise it.
//
// LIVE-only (spawns a real pi + opens a real socket) — kept OUT of `pnpm check`;
// honest skip when LIVE!=1 (skip = CI safety, NOT an acceptance PASS).
//   LIVE=1 ./run.sh smoke-acp-socket-citizen-live
//   override model via ENTWURF_S1_MODEL (default claude-opus-4-8).

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchControlSocketRuntimeInfo, formatRuntimeModel } from "../pi-extensions/lib/entwurf-control-rpc.ts";
import { generateSessionId } from "../pi-extensions/lib/entwurf-core.ts";
import { scanSocketProbes } from "../pi-extensions/lib/socket-discovery.ts";

const ACP_PROVIDER = "entwurf";
const ACP_MODEL = process.env.ENTWURF_S1_MODEL?.trim() || "claude-opus-4-8";

const REAL_CONTROL_DIR = path.join(os.homedir(), ".pi", "entwurf-control");
const SOCKET_SUFFIX = ".sock";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Load ONLY this checkout's extensions so the resident registers THIS acp-provider.ts.
const REPO_EXTENSION_ARGS = ["--no-extensions", "-e", REPO_ROOT] as const;

const BOOT_TIMEOUT_MS = 30_000;
const POLL_MS = 100;

let passed = 0;
function ok(label: string, cond: boolean): void {
	if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
	console.log(`  ok    ${label}`);
	passed++;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSocket(sockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(sockPath)) return true;
		await sleep(POLL_MS);
	}
	return false;
}

async function waitForGone(sockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!existsSync(sockPath)) return true;
		await sleep(POLL_MS);
	}
	return !existsSync(sockPath);
}

async function terminateChild(child: ChildProcess, graceMs = 2_000): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
	try {
		child.kill("SIGTERM");
	} catch {
		return;
	}
	const raced = await Promise.race([
		exited.then(() => "exited" as const),
		sleep(graceMs).then(() => "timeout" as const),
	]);
	if (raced === "timeout") {
		try {
			child.kill("SIGKILL");
		} catch {
			// already gone
		}
		await exited;
	}
}

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		console.log(
			"[smoke-acp-socket-citizen-live] skipped — set LIVE=1 to run (spawns a real pi --entwurf-control + opens a real socket).",
		);
		return;
	}

	const gid = generateSessionId();
	const sockPath = path.join(REAL_CONTROL_DIR, `${gid}${SOCKET_SUFFIX}`);
	const tmp = os.tmpdir();

	// B3: a fresh gid must not collide with a pre-existing socket (else teardown would
	// delete someone else's live socket). Fail loud rather than risk it.
	ok("fresh gid has no pre-existing control socket", !existsSync(sockPath));

	let stderrTail = "";
	let resident: ChildProcess | null = null;
	try {
		// Launch a real resident on the ACP model, in rpc mode (non-TTY safe, turn-free).
		resident = spawn(
			"pi",
			[
				...REPO_EXTENSION_ARGS,
				"--session-id",
				gid,
				"--entwurf-control",
				"--provider",
				ACP_PROVIDER,
				"--model",
				ACP_MODEL,
				"--mode",
				"rpc",
			],
			{ cwd: tmp, stdio: ["pipe", "ignore", "pipe"], detached: false },
		);
		resident.stderr?.on("data", (b: Buffer) => {
			stderrTail = (stderrTail + b.toString()).slice(-4000);
		});

		// QM2 (part 1): launch with an ACP model does not die — the socket comes up.
		const up = await waitForSocket(sockPath, BOOT_TIMEOUT_MS);
		ok(`ACP-model resident stood up a control socket (${ACP_PROVIDER}/${ACP_MODEL})`, up);

		// Citizenship + get_info: the resident answers the control RPC like a native sibling.
		const info = await fetchControlSocketRuntimeInfo(sockPath, { timeout: 3_000 });
		ok("get_info answers (control RPC reachable)", info !== undefined);

		// QM1: model-lock did NOT revert the launch model — provider is still entwurf.
		ok(
			`get_info model is the ACP model, not reverted (got ${formatRuntimeModel(info) ?? "none"})`,
			info.modelProvider === ACP_PROVIDER && info.modelId === ACP_MODEL,
		);

		// Citizen facts present: idle + cwd are get_info-enriched fields the peers surface shows.
		ok("get_info reports idle=true (no turn running)", info.idle === true);
		ok("get_info reports the resident cwd", info.cwd === tmp);

		// Peers-visible: the gid shows up in the REAL socket-discovery scan (the socket
		// axis that feeds entwurf_peers' socketOnly section) as a live citizen — not just
		// reachable by a direct get_info, but discoverable on the production fact surface.
		const scan = await scanSocketProbes([]);
		const probe = scan.probes.find((p) => p.gardenId === gid);
		ok("gid is peers-visible on the socket-discovery fact surface, liveness=alive", probe?.liveness === "alive");

		// QM2 (part 2): the fail-loud streamSimple stub never fired — no turn ran, so no
		// AcpBackendNotImplementedError on the resident's stderr.
		ok(
			"fail-loud backend stub did NOT fire at launch (turn-free)",
			!/AcpBackendNotImplementedError|not implemented in S0/i.test(stderrTail),
		);

		// Still alive after the probe (the socket is a live citizen, not a one-shot).
		ok(
			"resident still alive after get_info (live socket-citizen)",
			resident.exitCode === null && resident.signalCode === null,
		);
	} finally {
		if (resident) await terminateChild(resident);
	}

	// Hygiene (B): after teardown the resident's control socket file is gone — the
	// smoke leaves no process/socket residue. (The 0-turn session JSONL is the
	// denote-id memory layer and is intentionally NOT scrubbed — that is data, not
	// process residue.)
	ok("control socket file removed after teardown (no socket residue)", await waitForGone(sockPath, 5_000));

	console.log(
		`[smoke-acp-socket-citizen-live] PASS — ${passed} checks (ACP-model session is a first-class socket-citizen, turn-free)`,
	);
}

await main();
