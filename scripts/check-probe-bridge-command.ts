#!/usr/bin/env node
// check-probe-bridge-command — deterministic contract gate for the #81 boot probe.
//
// The probe is what two doctors now stake their verdict on, so its reason taxonomy is a contract,
// not an implementation detail: each value names a DIFFERENT operator situation, and collapsing two
// of them would put the wrong repair in front of an operator. This gate pins the classification and
// the one side effect the probe owns — reaping the child it spawned.
//
// Hermetic: every subject is a stub script in a mktemp dir. No network, no operator state, no MCP
// server of ours is booted (check-entwurf-bridge-boot owns that axis).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_TOOLS, probeBridgeCommand } from "./probe-bridge-command.ts";

let passed = 0;
// The `[QK:…]` token must land on a FAILURE line (qualification does not count a token printed on
// an `ok` line — a later red must not self-certify an earlier claim), and it must appear exactly
// once in this file. So: strip it from the green line, print it verbatim on the red one.
function ok(label: string, cond: boolean, detail?: string): void {
	if (!cond) {
		console.error(`FAIL: ${label}`);
		if (detail) console.error(detail);
		process.exit(1);
	}
	console.log(`  ok    ${label.replace(/\[QK:[^\]]+\]\s*/, "")}`);
	passed++;
}

const dir = mkdtempSync(join(tmpdir(), "entwurf-probe-gate-"));
const stub = (name: string, body: string): string => {
	const p = join(dir, name);
	writeFileSync(p, body);
	chmodSync(p, 0o755);
	return p;
};

/** An MCP stub that answers tools/list with exactly the given verb names. */
const mcpStub = (name: string, names: readonly string[]): string => {
	const tools = names.map((n) => `{"name":"${n}"}`).join(",");
	return stub(
		name,
		`#!/usr/bin/env bash
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fake-entwurf-bridge","version":"0"}}}' ;;
    *'"id":2'*) printf '%s\\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[${tools}]}}' ;;
  esac
done
`,
	);
};

try {
	// ── the healthy shape ─────────────────────────────────────────────────────
	const healthy = mcpStub("healthy", EXPECTED_TOOLS);
	const rHealthy = await probeBridgeCommand({ command: healthy });
	ok("the exact verb set is the only green", rHealthy.ok && rHealthy.reason === "ok", JSON.stringify(rHealthy));

	// ── identity: booting an MCP server is not being THIS bridge ──────────────
	// Missing one verb is the observed #81 shape (a session whose schema had no entwurf_self).
	const partial = mcpStub(
		"partial",
		EXPECTED_TOOLS.filter((t) => t !== "entwurf_self"),
	);
	const rPartial = await probeBridgeCommand({ command: partial });
	ok(
		"[QK:PROBE-REASON-MISSING-VERB] a served MCP surface MISSING a verb is a mismatch, not ok",
		!rPartial.ok && rPartial.reason === "tool-set-mismatch" && rPartial.detail.includes("missing entwurf_self"),
		JSON.stringify(rPartial),
	);
	// The other direction: a stale build still serving a retired verb must not read as this bridge.
	const extra = mcpStub("extra", [...EXPECTED_TOOLS, "entwurf_retired_verb"]);
	const rExtra = await probeBridgeCommand({ command: extra });
	ok(
		"an EXTRA verb is a mismatch too (stale build / foreign binary)",
		!rExtra.ok && rExtra.reason === "tool-set-mismatch" && rExtra.detail.includes("unexpected entwurf_retired_verb"),
		JSON.stringify(rExtra),
	);

	// ── the defect that started #81: resolves, then dies on exec ──────────────
	const dead = stub("dead", "#!/usr/bin/env bash\necho 'boom: no such file or directory' >&2\nexit 127\n");
	const rDead = await probeBridgeCommand({ command: dead });
	ok(
		"a launcher that exits before tools/list is classified as such, with its stderr",
		!rDead.ok && rDead.reason === "exited-before-tools-list" && rDead.detail.includes("boom"),
		JSON.stringify(rDead),
	);

	// ── not executable at all ─────────────────────────────────────────────────
	const rMissing = await probeBridgeCommand({ command: join(dir, "does-not-exist") });
	ok(
		"an unexecutable command is spawn-failed, NOT a boot failure",
		!rMissing.ok && rMissing.reason === "spawn-failed",
		JSON.stringify(rMissing),
	);

	// ── initialize is a handshake, not a frame we merely write ───────────────
	const noInitialize = stub(
		"no-initialize",
		`#!/usr/bin/env bash
printf '%s\\n' '{"jsonrpc":"2.0","id":2,"result":{"tools":[${EXPECTED_TOOLS.map((n) => `{"name":"${n}"}`).join(",")}]}}'
while IFS= read -r _line; do :; done
`,
	);
	const rNoInitialize = await probeBridgeCommand({ command: noInitialize, timeoutMs: 700 });
	ok(
		"[QK:PROBE-REQUIRES-INITIALIZE] an exact tools/list sent before initialize completes is not a healthy MCP bridge",
		!rNoInitialize.ok && rNoInitialize.reason === "initialize-failed",
		JSON.stringify(rNoInitialize),
	);

	// ── not an MCP server (answers id:2, no tools array) ──────────────────────
	const notMcp = stub(
		"not-mcp",
		`#!/usr/bin/env bash
while IFS= read -r line; do
  case "$line" in
    *'"id":1'*) printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"not-mcp","version":"0"}}}' ;;
    *'"id":2'*) printf '%s\\n' '{"jsonrpc":"2.0","id":2,"result":{}}' ;;
  esac
done
`,
	);
	const rNotMcp = await probeBridgeCommand({ command: notMcp });
	ok(
		"an id:2 reply without result.tools is not an MCP server",
		!rNotMcp.ok && rNotMcp.reason === "no-tools-array",
		JSON.stringify(rNotMcp),
	);

	// ── timeout + bounded cleanup ─────────────────────────────────────────────
	// The probe runs whatever the operator configured, including a launcher that ignores SIGTERM.
	// If it resolved without escalating, that process would outlive the doctor. The stub records
	// its own pid so this gate can assert the reap actually happened — an unobserved kill is a
	// claim, not evidence.
	const pidFile = join(dir, "hung.pid");
	const hung = stub(
		"hung",
		`#!/usr/bin/env bash
trap '' TERM
echo $$ > ${JSON.stringify(pidFile)}
while true; do sleep 0.05; done
`,
	);
	const rHung = await probeBridgeCommand({ command: hung, timeoutMs: 700 });
	ok(
		"a launcher that stays up but never answers is a timeout",
		!rHung.ok && rHung.reason === "timeout",
		JSON.stringify(rHung),
	);
	const hungPid = Number(readFileSync(pidFile, "utf8").trim());
	ok(
		"timeout stub recorded a usable pid (the cleanup assertion below has a subject)",
		Number.isInteger(hungPid) && hungPid > 0,
	);
	// SIGTERM is trapped, so only the SIGKILL escalation can end it — and the probe must have
	// completed that escalation BEFORE returning. Checking right here (no polling, no grace loop)
	// is what pins that ordering: a probe that merely scheduled the kill would fail this cell,
	// which is exactly the state a doctor's immediate process.exit() would leave behind.
	const alive = spawnSync("kill", ["-0", String(hungPid)], { stdio: "ignore" }).status === 0;
	// Clean up BEFORE asserting. When this claim's mutant re-plants the leak, `alive` is true and
	// the assertion exits the process immediately — so without this line the gate that exists to
	// prove nothing is orphaned would itself orphan the stub on the host, once per qualification
	// run. A killed mutant must still leave zero residue.
	if (alive) spawnSync("kill", ["-9", String(hungPid)], { stdio: "ignore" });
	ok(
		"[QK:PROBE-CLEANUP-ESCALATES] a SIGTERM-ignoring child is escalated to SIGKILL, never left orphaned",
		!alive,
		`pid ${hungPid} was still alive after the probe returned — the probe leaked the process it spawned`,
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check-probe-bridge-command: ${passed} checks passed`);
