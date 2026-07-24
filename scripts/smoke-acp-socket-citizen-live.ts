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
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchControlSocketRuntimeInfo, formatRuntimeModel } from "../pi-extensions/lib/entwurf-control-rpc.ts";
import { scanSocketProbes } from "../pi-extensions/lib/socket-discovery.ts";
import { terminateChild } from "./lib/acp-child-cleanup.ts";
import { waitForPiRecord } from "./lib/pi-record-discovery.ts";

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

async function main(): Promise<void> {
	if (process.env.LIVE !== "1") {
		console.log(
			"[smoke-acp-socket-citizen-live] skipped — set LIVE=1 to run (spawns a real pi --entwurf-control + opens a real socket).",
		);
		return;
	}

	const tmp = os.tmpdir();
	// Post-C2 the RECORD mints the address (`--session-id` injection is gone), so the
	// resident's store is isolated to a temp dir: discovery reads the freshly-born
	// record from an empty store, and no smoke garbage lands in the operator's live
	// store (a pre-rewrite run minted a stray cwd=/tmp V3 record there, 2026-07-23).
	// Only the STORE is redirected — the agent dir (auth.json = subscription login)
	// stays real, and the socket still stands up in the real control dir.
	const smokeStore = await fsp.mkdtemp(path.join(os.tmpdir(), "acp-s1-store-"));

	let gid = "";
	let sockPath = "";
	let stderrTail = "";
	let resident: ChildProcess | null = null;
	try {
		// Launch a real resident on the ACP model, in rpc mode (non-TTY safe, turn-free).
		resident = spawn(
			"pi",
			[...REPO_EXTENSION_ARGS, "--entwurf-control", "--provider", ACP_PROVIDER, "--model", ACP_MODEL, "--mode", "rpc"],
			{
				cwd: tmp,
				stdio: ["pipe", "ignore", "pipe"],
				detached: false,
				env: { ...process.env, ENTWURF_META_SESSIONS_DIR: smokeStore },
			},
		);
		resident.stderr?.on("data", (b: Buffer) => {
			stderrTail = (stderrTail + b.toString()).slice(-4000);
		});

		// QM2 (part 1): launch with an ACP model does not die — the resident births its
		// V3 record (the address authority) and stands the socket up on that gardenId.
		const bornGid = await waitForPiRecord(smokeStore, BOOT_TIMEOUT_MS);
		ok(`ACP-model resident birthed its own V3 record (${ACP_PROVIDER}/${ACP_MODEL})`, bornGid !== null);
		gid = bornGid as string;
		sockPath = path.join(REAL_CONTROL_DIR, `${gid}${SOCKET_SUFFIX}`);
		const up = await waitForSocket(sockPath, BOOT_TIMEOUT_MS);
		ok(`ACP-model resident stood up a control socket keyed on the record gardenId (${gid})`, up);

		// Citizenship + get_info: the resident answers the control RPC like a native sibling.
		const info = await fetchControlSocketRuntimeInfo(sockPath, { timeout: 3_000 });
		ok("get_info answers (control RPC reachable)", info !== undefined);

		// QM1: model-lock did NOT revert the launch model — provider is still entwurf.
		ok(
			`get_info model is the ACP model, not reverted (got ${formatRuntimeModel(info) ?? "none"})`,
			info.modelProvider === ACP_PROVIDER && info.modelId === ACP_MODEL,
		);

		// Citizen facts present on the control RPC surface (#50 C4: the peers listing
		// itself no longer get_info-enriches — cwd/model are record facts there).
		ok("get_info reports idle=true (no turn running)", info.idle === true);
		ok("get_info reports the resident cwd", info.cwd === tmp);

		// Peers-visible: the gid shows up in the REAL socket-discovery scan (the socket
		// axis entwurf_peers folds into citizen liveness) as alive — not just reachable
		// by a direct get_info, but discoverable on the production fact surface.
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
		await fsp.rm(smokeStore, { recursive: true, force: true }).catch(() => {});
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
