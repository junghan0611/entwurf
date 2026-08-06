/**
 * check-mux-fresh-call — deterministic gate for the fresh-call composition
 * (`pi-extensions/lib/mux-fresh-call.ts`) and its two public surfaces.
 *
 * Same scope discipline as `check-mux-launch`: only what is decidable without tmux. There is no
 * fake tmux in this repo and this gate does not introduce one — the real-window axis is covered
 * by the manual B/C/C2 baseline and by the on-demand `smoke-mux-fresh-call-live`.
 *
 * Two things here are argv facts that were MEASURED to fail the other way round, which is why
 * they are pinned rather than described: with the flag before the prompt, pi opened a window and
 * never ran a turn; with `--allowedTools <tools...>` before the prompt, Claude Code swallowed the
 * prompt as an option value and did the same. Both times the window, the record and the socket
 * were all real — only the turn was missing.
 *
 *   FRESHCALL-PI-ARGV-PROMPT-FIRST         pi gets the prompt BEFORE --entwurf-control
 *   FRESHCALL-CLAUDE-ARGV-EQUALS-FORM      claude-code gets --allowedTools= as ONE token, after the prompt
 *   FRESHCALL-PI-SURFACE-IDENTITY-AND-SCHEMA      native pi passes its resident id; no identity parameter
 *   FRESHCALL-CLAUDE-SURFACE-IDENTITY-AND-SCHEMA  the bridge uses its canonical authoritative self
 *                                                 envelope (pi carrier OR trusted marker); no identity parameter
 *   FRESHCALL-CALLBACK-PRECEDES-TASK       the framing orders the callback before the task
 *   FRESHCALL-RECEIPT-WITHOUT-CORRELATION  the launch receipt is synchronous and claims no delivery
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildBackendArgs,
	buildFreshCallPrompt,
	FRESH_CALL_BACKENDS,
	FRESH_CALL_CALLBACK_TOOL,
	freshCall,
	renderFreshCall,
	TASK_MAX_CHARS,
} from "../pi-extensions/lib/mux-fresh-call.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const PI_SURFACE = read("pi-extensions/entwurf-control.ts");
const MCP_SURFACE = read("mcp/entwurf-bridge/src/index.ts");
const MCP_FRESH_BLOCK = (MCP_SURFACE.split('"entwurf_fresh_call",')[1] ?? "").split(
	"// ============================================================================\n// Main",
)[0];
const MODULE_SRC = read("pi-extensions/lib/mux-fresh-call.ts");

const GID = "20260805T000000-abcdef";
const NONCE = "mux-fresh-call-deadbeefdeadbeefdeadbeef";
const TASK = "summarise docs/mux-launch-rail.md";

/**
 * Give a check that needs to pass runtime resolution a hermetic executable `pi`.
 * The gate must not depend on the developer host having pi on PATH: GitHub's runner
 * deliberately does not, while every workstation that developed this rail does.
 */
function withPiRuntime<T>(run: (env: NodeJS.ProcessEnv) => T): T {
	const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-fresh-call-runtime-"));
	try {
		fs.writeFileSync(path.join(runtimeDir, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		return run({ PATH: runtimeDir });
	} finally {
		fs.rmSync(runtimeDir, { recursive: true, force: true });
	}
}

function main(): void {
	// ── argv dialects ────────────────────────────────────────────────────────
	const piArgs = buildBackendArgs("pi", "PROMPT");
	ok(
		"[QK:FRESHCALL-PI-ARGV-PROMPT-FIRST] pi argv is the prompt FIRST, then --entwurf-control — the flag-first order was measured to open a window whose turn never ran",
		piArgs[0] === "PROMPT" && piArgs[1] === "--entwurf-control" && piArgs.length === 2,
	);

	const clArgs = buildBackendArgs("claude-code", "PROMPT");
	ok(
		"[QK:FRESHCALL-CLAUDE-ARGV-EQUALS-FORM] claude-code argv is the prompt then a SINGLE --allowedTools=<tool> token — the space form is variadic and was measured to eat the prompt",
		clArgs[0] === "PROMPT" &&
			clArgs.length === 2 &&
			clArgs[1] === `--allowedTools=${FRESH_CALL_CALLBACK_TOOL["claude-code"]}` &&
			!clArgs[1].includes(" ") &&
			!clArgs.includes("--allowedTools"),
	);
	ok(
		"argv: neither backend passes a shell string, a window name, a cwd or an env carrier",
		[...piArgs, ...clArgs].every((a) => !/^-(n|c|e|b)$/.test(a)),
	);
	ok(
		"argv: the two backends are the whole fixed set",
		FRESH_CALL_BACKENDS.length === 2 &&
			FRESH_CALL_BACKENDS.includes("pi") &&
			FRESH_CALL_BACKENDS.includes("claude-code"),
	);

	// ── first-turn framing ───────────────────────────────────────────────────
	const prompt = buildFreshCallPrompt({ backend: "pi", task: TASK, callerGardenId: GID, nonce: NONCE });
	const callbackAt = prompt.indexOf("FIRST ACTION");
	const taskAt = prompt.indexOf(TASK);
	ok(
		"[QK:FRESHCALL-CALLBACK-PRECEDES-TASK] the framing puts the callback instruction BEFORE the task, so a sibling that stalls in the task has already named itself",
		callbackAt >= 0 && taskAt > callbackAt,
	);
	ok("framing: carries the caller garden id and the exact nonce", prompt.includes(GID) && prompt.includes(NONCE));
	ok(
		"framing: names the backend's own callback tool (native entwurf_v2 vs the MCP-namespaced one)",
		buildFreshCallPrompt({ backend: "pi", task: TASK, callerGardenId: GID, nonce: NONCE }).includes("entwurf_v2") &&
			buildFreshCallPrompt({ backend: "claude-code", task: TASK, callerGardenId: GID, nonce: NONCE }).includes(
				FRESH_CALL_CALLBACK_TOOL["claude-code"],
			),
	);
	ok(
		"framing: forbids the three detours that were measured to produce a confidently wrong self-report",
		/environment variables/.test(prompt) &&
			/entwurf_self/.test(prompt) &&
			/MCP\s*\n?server yourself|start an MCP/.test(prompt),
	);

	// ── refusals, before any mutation ────────────────────────────────────────
	const noTmux = {} as NodeJS.ProcessEnv;
	ok(
		"refusal: a null caller identity is named, never defaulted — the sibling would have nowhere to call home",
		(freshCall({ backend: "pi", task: TASK, callerGardenId: null }, noTmux) as unknown as { reason: string }) &&
			(freshCall({ backend: "pi", task: TASK, callerGardenId: null }, noTmux) as { ok: false; reason: string })
				.reason === "caller-identity-unavailable",
	);
	ok(
		"refusal: identity is checked BEFORE the tmux context, so an anonymous caller never learns whether tmux was there",
		(freshCall({ backend: "pi", task: TASK, callerGardenId: "" }, noTmux) as { ok: false; reason: string }).reason ===
			"caller-identity-unavailable",
	);
	ok(
		"refusal: an empty (or whitespace-only) task is refused",
		(freshCall({ backend: "pi", task: "   \n ", callerGardenId: GID }, noTmux) as { ok: false; reason: string })
			.reason === "task-empty",
	);
	ok(
		`refusal: a task over ${TASK_MAX_CHARS} chars is refused at the interface, not truncated`,
		TASK_MAX_CHARS === 16000 &&
			(
				freshCall({ backend: "pi", task: "x".repeat(TASK_MAX_CHARS + 1), callerGardenId: GID }, noTmux) as {
					ok: false;
					reason: string;
				}
			).reason === "task-too-long",
	);
	const outsideTmux = withPiRuntime((env) => freshCall({ backend: "pi", task: TASK, callerGardenId: GID }, env));
	ok(
		"refusal: outside tmux the reason is the leaf's own no-tmux-context, not a fallback launch",
		(outsideTmux as { ok: false; reason: string }).reason === "no-tmux-context",
	);
	for (const reason of ["caller-identity-unavailable", "task-empty", "task-too-long", "no-tmux-context"] as const) {
		const { text, isError } = renderFreshCall({ ok: false, reason });
		ok(
			`refusal renders as a named reason a caller can act on (${reason})`,
			isError && text.includes(reason) && text.includes("No window was opened"),
		);
	}

	// ── the two receipts stay apart ──────────────────────────────────────────
	const returned = outsideTmux;
	ok(
		"[QK:FRESHCALL-RECEIPT-WITHOUT-CORRELATION] freshCall answers SYNCHRONOUSLY and its receipt type carries no callback/garden-id/delivered field — the correlation receipt arrives later on the caller's own inbound surface",
		!(returned instanceof Promise) &&
			/export interface FreshCallReceipt extends WindowHandle \{[^}]*\}/.test(MODULE_SRC) &&
			!/export interface FreshCallReceipt extends WindowHandle \{[^}]*(callback|gardenId|delivered|siblingId)/.test(
				MODULE_SRC,
			),
	);
	const rendered = renderFreshCall({
		ok: true,
		receipt: {
			serverPid: "1",
			sessionId: "$1",
			windowId: "@1",
			windowIndex: "2",
			paneId: "%1",
			panePid: "3",
			backend: "pi",
			runtimePath: "/usr/bin/pi",
			nonce: NONCE,
		},
	});
	ok(
		"receipt: the success text DENIES delivery in words, so a caller cannot read 'launched' as 'delivered'",
		!rendered.isError && /does NOT mean/.test(rendered.text) && /LAUNCH receipt/.test(rendered.text),
	);
	ok(
		"receipt: the text says nothing is polling and points at the visible window instead",
		/Nothing is polling/.test(rendered.text) && /window is visible/.test(rendered.text),
	);
	// Word-matching would fail on the receipt's own prose ("Nothing is polling for it"), which is
	// the opposite of the defect. Look for the scheduling APIs a watcher would actually need.
	const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	ok(
		"no watcher: the module schedules nothing after the mutation — no timer, no loop, nothing awaited",
		!/setTimeout|setInterval|setImmediate|while\s*\(|for\s*\(;;|await\s/.test(MODULE_CODE),
	);

	// ── surfaces own identity; the composition never does ────────────────────
	ok(
		"[QK:FRESHCALL-PI-SURFACE-IDENTITY-AND-SCHEMA] native pi supplies callerGardenId from its own resident closure and exposes only {backend, task}",
		/callerGardenId:\s*residentGardenId/.test(PI_SURFACE) &&
			/name:\s*"entwurf_fresh_call"/.test(PI_SURFACE) &&
			!/callerGardenId:\s*(params|Type)\./.test(PI_SURFACE) &&
			!/nonce:\s*(params|Type)\./.test(PI_SURFACE),
	);
	ok(
		"[QK:FRESHCALL-CLAUDE-SURFACE-IDENTITY-AND-SCHEMA] the MCP bridge resolves callerGardenId through the canonical authoritative self envelope — the inherited pi carrier OR a trusted meta-sender marker, both certified — and exposes only {backend, task}",
		/const self = await buildAuthoritativeSelfEnvelope\(\);\s*callerGardenId = self\.envelope\.sessionId;/.test(
			MCP_FRESH_BLOCK,
		) &&
			!/process\.env\.PI_SESSION_ID/.test(MCP_FRESH_BLOCK) &&
			/backend:\s*z\s*\n?\s*\.enum\(\["pi", "claude-code"\]\)/.test(MCP_FRESH_BLOCK) &&
			!/callerGardenId:\s*z\./.test(MCP_FRESH_BLOCK) &&
			!/nonce:\s*z\./.test(MCP_FRESH_BLOCK),
	);
	ok(
		"identity: the composition itself never reads env or a store for the caller id — it is given one or it refuses",
		!/process\.env\.PI_SESSION_ID|readMetaIdentity|resolveTrustedMetaSender/.test(MODULE_SRC),
	);
	// ── the leaf stays carrier-free (existing MUX-LAUNCH-NO-CARRIER owns the claim) ──
	const LEAF = read("pi-extensions/lib/mux-placement.ts");
	ok(
		"boundary: the placement leaf still takes no prompt/command/backend — fresh-call builds its own argv on top of it",
		!/prompt|task|backend/i.test(LEAF.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")),
	);
	ok(
		"boundary: fresh-call does not import entwurf delivery — it only names the callback tool in prose the sibling reads",
		!/from "\.\/entwurf-/.test(MODULE_SRC),
	);

	// ── one world map on both surfaces ───────────────────────────────────────
	ok(
		"prose: both peers surfaces now say the same thing — facts-only, and fresh siblings come from entwurf_fresh_call",
		/facts-only[\s\S]{0,120}entwurf_fresh_call/.test(PI_SURFACE) &&
			/facts-only[\s\S]{0,160}entwurf_fresh_call/.test(MCP_SURFACE),
	);
	for (const [label, src] of [
		["pi", PI_SURFACE],
		["mcp", MCP_SURFACE],
	] as const) {
		for (const literal of ["LAUNCH receipt", "entwurf_peers only reports", "no secrets", "fixed per backend"]) {
			ok(`${label} description carries the contract literal: ${literal}`, src.includes(literal));
		}
	}
	// Host description cap is 2048 chars. Measure BOTH rendered descriptions — a cap that is only
	// checked on one surface cannot see the other being truncated, and truncation is invisible from
	// inside (v2 lost its whole INTENT contract that way). Ordinary assertions: the cap SUBSYSTEM
	// belongs to v2's own gate, this is the same discipline applied locally.
	const piDesc = (PI_SURFACE.split('name: "entwurf_fresh_call"')[1] ?? "").split("parameters:")[0] ?? "";
	const piRendered = (piDesc.match(/`([\s\S]*?)`/)?.[1] ?? "").trim();
	const mcpBlock = (MCP_SURFACE.split('"entwurf_fresh_call",')[1] ?? "").split("\t{\n\t\tbackend:")[0] ?? "";
	const mcpRendered = [...mcpBlock.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
		.map((m) => m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"))
		.join("")
		.trim();
	ok(
		`pi rendered description fits the 2048-char host cap (${piRendered.length} chars)`,
		piRendered.length > 400 && piRendered.length < 2048,
	);
	ok(
		`mcp rendered description fits the 2048-char host cap (${mcpRendered.length} chars)`,
		mcpRendered.length > 400 && mcpRendered.length < 2048,
	);
	ok(
		"both rendered descriptions carry the same world map: fresh_call creates, v2 delivers, peers reports",
		[piRendered, mcpRendered].every(
			(d) => d.includes("entwurf_v2") && d.includes("entwurf_peers only reports") && d.includes("LAUNCH receipt"),
		),
	);

	console.log(`\ncheck-mux-fresh-call: ${passed} checks passed`);
}

main();
