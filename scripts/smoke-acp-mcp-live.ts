// S2g LIVE 1 — operator MCP passthrough acceptance. LIVE-gated, OUT of `pnpm check`.
//
//   LIVE=1 ./run.sh smoke-acp-mcp-live
//
// THE baseline proof. GLG's baseline finding was: an ACP model booted with
// `entwurf/<model>` saw 4 tools and NO MCP servers — the operator's
// `entwurfProvider.mcpServers` never reached the session. S2g wired that
// passthrough; the deterministic gate (check-acp-config / check-acp-session-reuse
// Section G) proved the config reaches `newSession` on a FAKE seam. This live
// smoke proves the LAST mile a fake cannot: a real ACP child spawns the operator
// MCP server and the live model can actually CALL its tool.
//
// Method (GPT `…2f9325` LIVE 1 — a TINY isolated probe, not entwurf-bridge, so a
// failure isolates to "did mcpServers reach newSession" without identity/env
// coupling): a scratch `.pi/settings.json` registers ONE stdio MCP server
// (scripts/fixtures/probe-mcp-server.ts) that exposes a single tool `probe_nonce`
// returning a per-run secret carried in its env. The prompt asks the model to
// CALL the tool and echo the nonce. The nonce lives ONLY inside the MCP server's
// env — the model cannot produce it unless the tool was visible AND callable.
//
// Pre-S2g (hardcoded `mcpServers:[]`) this smoke FAILS: the tool never exists.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE_SERVER = join(REPO_ROOT, "scripts", "fixtures", "probe-mcp-server.ts");
const MODEL = process.env.PI_SHELL_ACP_PROVIDER_MODEL?.trim() || "claude-sonnet-4-6";
const PROVIDER = "entwurf";
const TURN_TIMEOUT_MS = Number(process.env.PI_SHELL_ACP_PROVIDER_TIMEOUT_MS) || 240_000;

function fail(msg: string): never {
	console.error(`[smoke-acp-mcp-live] FAIL: ${msg}`);
	process.exit(1);
}

if (process.env.LIVE !== "1") {
	console.error("[smoke-acp-mcp-live] skipped — set LIVE=1 to run the real pi provider turn.");
	process.exit(0);
}

const STUB_PATTERN = /AcpBackendNotImplementedError|not implemented in S0/i;

const scratch = mkdtempSync(join(tmpdir(), "entwurf-s2g-mcp-"));
try {
	const nonce = `MCP_${process.pid.toString(36)}${Date.now().toString(36)}`;
	// Register the probe MCP server in the scratch project settings — the exact
	// `entwurfProvider.mcpServers` surface `./run.sh install` writes for real.
	mkdirSync(join(scratch, ".pi"), { recursive: true });
	writeFileSync(
		join(scratch, ".pi", "settings.json"),
		`${JSON.stringify(
			{
				entwurfProvider: {
					mcpServers: {
						probe: {
							command: process.execPath,
							args: ["--experimental-strip-types", PROBE_SERVER],
							env: { PROBE_NONCE: nonce },
						},
					},
				},
			},
			null,
			2,
		)}\n`,
	);

	const prompt =
		"Call the probe_nonce tool now, then reply with exactly the PROBE_NONCE value it returns " +
		"(the part after the '=' sign), and nothing else.";

	console.error(`[smoke-acp-mcp-live] repo:   ${REPO_ROOT}`);
	console.error(`[smoke-acp-mcp-live] cwd:    ${scratch}`);
	console.error(`[smoke-acp-mcp-live] model:  ${PROVIDER}/${MODEL}`);
	console.error(`[smoke-acp-mcp-live] nonce:  ${nonce} (only inside the probe MCP server env)`);

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
	const res = spawnSync("pi", args, { cwd: scratch, encoding: "utf8", timeout: TURN_TIMEOUT_MS, env: process.env });
	const stdout = res.stdout ?? "";
	const combined = `${stdout}\n${res.stderr ?? ""}`;
	const tail = combined.split("\n").slice(-30).join("\n");
	if (res.error) {
		console.error(`[smoke-acp-mcp-live] output tail:\n${tail}`);
		fail(`pi spawn failed: ${res.error.message}`);
	}
	assert.ok(!STUB_PATTERN.test(combined), "S0 stub fired — provider path did not open");
	if (res.status !== 0) {
		console.error(`[smoke-acp-mcp-live] output tail:\n${tail}`);
		fail(`pi exited ${res.status}`);
	}
	// The tool-start notice is corroborating evidence the model invoked the MCP tool.
	const sawToolCall = /\[tool:(start|running)\]\s+probe_nonce/i.test(combined);
	assert.ok(
		stdout.includes(nonce),
		`reply did not carry the probe nonce ${nonce} — the operator MCP server was not visible/callable ` +
			`(S2g passthrough failure). tool-call notice ${sawToolCall ? "WAS" : "was NOT"} seen. ` +
			`stdout tail: ${JSON.stringify(stdout.slice(-300))}`,
	);

	console.log("[smoke-acp-mcp-live] PASS — the operator-declared MCP server reached the live ACP session: the model");
	console.log(`  called probe_nonce and returned ${nonce} (the nonce lives only inside the MCP server env).`);
	console.log(
		`  model: ${PROVIDER}/${MODEL}; tool-call notice ${sawToolCall ? "observed" : "not observed (reply-only evidence)"}`,
	);
} finally {
	try {
		rmSync(scratch, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
}
