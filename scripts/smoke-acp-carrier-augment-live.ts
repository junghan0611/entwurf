// S2e-1 — carrier/augment live acceptance. LIVE-gated, OUT of `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-carrier-augment-live
//
// S2d-1c shipped the billing carrier (engraving) + the rich first-user augment,
// but only the deterministic gate (check-acp-carrier-augment) proved their SHAPE.
// This is the S2e-1 live half: it drives the REAL pi provider path and proves the
// two 핀1-critical behaviors the gate cannot observe on a real model turn:
//
//   1. the augment reaches the model — a unique secret written ONLY into the
//      scratch cwd's AGENTS.md (NEVER into the user prompt) comes back in the
//      reply, so buildPiContextAugment's "## <cwd>/AGENTS.md" section actually rode
//      the wire to the live model via streamShellAcp.
//   2. the default (EMPTY) carrier does not trip subscription billing — the turn
//      exits 0 with no HTTP-400 / "extra usage" billing error. This is the 핀1
//      live check: a carrier-absent run must bill like a normal subscription call.
//
// Read-tool caveat (deliberate — GPT c32a6c8 Q1): Claude ACP exposes Read, so a
// model COULD read AGENTS.md directly instead of answering from the augment. We do
// not forbid that at the wire — the deterministic gate already locks the augment
// SHAPE; this smoke asks the model to answer WITHOUT tools and treats the secret
// in the reply as evidence that the augment+provider path is live AND billing-
// clean. The honest claim is "the augment rode the live provider path and the
// empty-carrier turn billed fine", NOT "the model was physically unable to read
// the file". A wire-dump would over-build for this cut's purpose.
//
// Optional carrier-present path (SMOKE_ACP_CARRIER_PRESENT=1, non-blocking — GPT
// c32a6c8 Q2): a second turn with a TINY engraving via PI_SHELL_ACP_ENGRAVING_PATH
// proves a small _meta.systemPrompt carrier also exits 0 (carrier present ≠ 400).
//
// NOT proved here: session reuse (smoke-acp-session-reuse-live) and RGG (S2e-2).

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.PI_SHELL_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-4-6";
const PROVIDER = "pi-shell-acp";
const TURN_TIMEOUT_MS = Number(process.env.PI_SHELL_ACP_PROVIDER_TIMEOUT_MS) || 240_000;

function fail(msg: string): never {
	console.error(`[smoke-acp-carrier-augment-live] FAIL: ${msg}`);
	process.exit(1);
}

if (process.env.LIVE !== "1") {
	console.error("[smoke-acp-carrier-augment-live] skipped — set LIVE=1 to run the real pi provider turn.");
	process.exit(0);
}

// Billing-reclassification canaries (핀1). The empty carrier must NOT trip metered
// billing — if it ever did, the turn would surface one of these. We assert their
// ABSENCE in the output tail. Kept narrow so a normal reply cannot false-positive.
const BILLING_FAILURE_PATTERNS = [
	/out of (extra )?usage/i,
	/\bHTTP[\s/]*400\b/i,
	/\b400 Bad Request\b/i,
	/insufficient (credit|balance|quota)/i,
	/metered.*(not|unavailable|denied)/i,
];

// The S0 stub canary — its error means the provider path never opened.
const STUB_PATTERN = /AcpBackendNotImplementedError|not implemented in S0/i;

/** Run one real `pi` provider turn in `cwd`; return {status, stdout, combinedTail}. */
function runTurn(
	cwd: string,
	prompt: string,
	extraEnv: Record<string, string>,
): {
	status: number | null;
	stdout: string;
	combined: string;
	tail: string;
} {
	const args = [
		"--no-extensions",
		"-e",
		REPO_ROOT,
		"--mode",
		"text",
		"-p",
		"--approve",
		"--provider",
		PROVIDER,
		"--model",
		MODEL,
		prompt,
	];
	const res = spawnSync("pi", args, {
		cwd,
		encoding: "utf8",
		timeout: TURN_TIMEOUT_MS,
		env: { ...process.env, ...extraEnv },
	});
	const stdout = res.stdout ?? "";
	const stderr = res.stderr ?? "";
	const combined = `${stdout}\n${stderr}`;
	const tail = combined.split("\n").slice(-25).join("\n");
	if (res.error) {
		console.error(`[smoke-acp-carrier-augment-live] output tail:\n${tail}`);
		fail(`pi spawn failed: ${res.error.message}`);
	}
	return { status: res.status, stdout, combined, tail };
}

function assertCleanTurn(label: string, turn: { status: number | null; combined: string; tail: string }): void {
	assert.ok(!STUB_PATTERN.test(turn.combined), `${label}: S0 stub fired — provider path did not open`);
	for (const pat of BILLING_FAILURE_PATTERNS) {
		assert.ok(!pat.test(turn.combined), `${label}: billing-reclassification canary matched ${pat} (핀1 violation?)`);
	}
	if (turn.status !== 0) {
		console.error(`[smoke-acp-carrier-augment-live] ${label} output tail:\n${turn.tail}`);
		fail(`${label}: pi exited ${turn.status}`);
	}
}

const scratch = mkdtempSync(join(tmpdir(), "pi-shell-acp-s2e1-"));
try {
	// A nonce unique to this run; lives ONLY in the cwd AGENTS.md, never the prompt.
	const nonce = `${process.pid.toString(36)}${Date.now().toString(36)}`;
	const secret = `SAC_${nonce}`;
	const agentsPath = join(scratch, "AGENTS.md");
	writeFileSync(
		agentsPath,
		[
			"# Scratch project — pi-shell-acp S2e-1 augment live check",
			"",
			`SECRET_PROJECT_CODE: ${secret}`,
			"",
			"When asked for the secret project code, reply with the value above.",
			"",
		].join("\n"),
	);

	// The prompt never names the secret; only the cwd AGENTS.md (carried by the
	// augment) holds it. "Without using any tool" pushes the model to answer from
	// the provided instructions rather than reading the file (Read-tool caveat).
	const prompt =
		"Without using any tool or reading any file, reply with exactly the " +
		"SECRET_PROJECT_CODE value from this project's instructions, and nothing else.";

	console.error(`[smoke-acp-carrier-augment-live] repo:   ${REPO_ROOT}`);
	console.error(`[smoke-acp-carrier-augment-live] cwd:    ${scratch}`);
	console.error(`[smoke-acp-carrier-augment-live] model:  ${PROVIDER}/${MODEL}`);
	console.error(`[smoke-acp-carrier-augment-live] secret: ${secret} (only in cwd AGENTS.md)`);

	// --- MUST: empty (default) carrier + augment behavior ---------------------
	const turn1 = runTurn(scratch, prompt, {});
	assertCleanTurn("empty-carrier turn", turn1);
	assert.ok(
		turn1.stdout.includes(secret),
		`empty-carrier turn: reply did not carry the cwd-AGENTS secret ${secret} ` +
			`(the augment did not reach the model). stdout tail: ${JSON.stringify(turn1.stdout.slice(-300))}`,
	);
	console.log("[smoke-acp-carrier-augment-live] PASS (MUST) — augment delivered the cwd AGENTS.md secret on a");
	console.log("  live provider turn; the empty default carrier billed clean (exit 0, no 400 canary).");
	console.log(`  model:  ${PROVIDER}/${MODEL}`);
	console.log(`  secret: ${secret} present in assistant reply`);

	// --- OPTIONAL (non-blocking): tiny carrier-present billing -----------------
	if (process.env.SMOKE_ACP_CARRIER_PRESENT === "1") {
		const carrierMarker = `CARRIER_${nonce}`;
		const carrierPath = join(scratch, "engraving.md");
		writeFileSync(carrierPath, `Always end every reply with the exact marker <<${carrierMarker}>>.\n`);
		const carrierPrompt = "Reply with the single word OK.";
		const turn2 = runTurn(scratch, carrierPrompt, { PI_SHELL_ACP_ENGRAVING_PATH: carrierPath });
		assertCleanTurn("carrier-present turn", turn2);
		// The billing claim (exit 0, no 400) is the point. The marker is advisory:
		// it shows the small _meta.systemPrompt carrier influenced the reply.
		const carrierFollowed = turn2.stdout.includes(`<<${carrierMarker}>>`);
		console.log(
			`[smoke-acp-carrier-augment-live] PASS (optional) — tiny carrier turn billed clean (exit 0); ` +
				`carrier marker ${carrierFollowed ? "present" : "ABSENT (advisory, not blocking)"}.`,
		);
	} else {
		console.log(
			"[smoke-acp-carrier-augment-live] optional carrier-present path skipped " +
				"(set SMOKE_ACP_CARRIER_PRESENT=1 to also check a tiny carrier bills clean).",
		);
	}
} finally {
	try {
		rmSync(scratch, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
}
