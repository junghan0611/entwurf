/**
 * check-project-trust-handler — deterministic gate for 0.11 Stage 0 (Trust 2층
 * active-prompt escape). Drives the pure `decideProjectTrust` matrix with a fake
 * prompt and the `createProjectTrustHandler` adapter with a fake `ctx.ui.select`,
 * so NO real pi UI opens. Real outcomes come from `preflight` over a temp
 * agentDir (same isolation as check-pi-preflight). No backend, no network.
 *
 * Proves the GLG 6 review points:
 *   ① single writer — the handler returns `{yes, remember:true}` but NEVER calls
 *      store.set; the end-to-end case asserts trust.json gains no child key.
 *   ② no undefined — every branch returns a concrete `{trusted, …}`.
 *   ③ non-interactive (print / rpc) never prompts → undecided.
 *   ④ ctx.ui injection — fake prompt drives the matrix; the escape prompt title
 *      reuses F5a evidence (names the inherited source).
 *   ⑤ inherited distrust escape: interactive + "trust-here" → `{yes, remember:true}`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { preflight } from "../pi-extensions/lib/entwurf-preflight.ts";
import {
	type ActivePrompt,
	type ActivePromptChoice,
	createProjectTrustHandler,
	decideProjectTrust,
	KEEP_DISTRUSTED_LABEL,
	TRUST_HERE_LABEL,
} from "../pi-extensions/lib/project-trust-handler.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

function fakePrompt(answer: ActivePromptChoice): { prompt: ActivePrompt; calls: () => number } {
	let calls = 0;
	const prompt: ActivePrompt = async () => {
		calls += 1;
		return answer;
	};
	return { prompt, calls: () => calls };
}

const TUI = { hasUI: true, mode: "tui" as const };
const PRINT = { hasUI: false, mode: "print" as const };
const RPC = { hasUI: true, mode: "rpc" as const }; // hasUI but not a human at a TUI

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-pth-")));
const agentDir = path.join(tmpRoot, "agent");
const reposRoot = path.join(tmpRoot, "repos");
fs.mkdirSync(agentDir, { recursive: true });
fs.mkdirSync(reposRoot, { recursive: true });
const store = new ProjectTrustStore(agentDir);

function mkdir(p: string): string {
	fs.mkdirSync(p, { recursive: true });
	return p;
}
function seedTrustInput(dir: string): string {
	fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
	return dir;
}

try {
	// Build REAL outcomes via preflight (exact evidence shape), then decide.
	// approve (saved-true)
	const cwdApprove = seedTrustInput(mkdir(path.join(reposRoot, "approve")));
	store.set(cwdApprove, true);
	const oApprove = preflight({ cwd: cwdApprove, agentDir });
	// trusted-no-arg (no trust input)
	const cwdNoArg = mkdir(path.join(reposRoot, "no-inputs"));
	const oNoArg = preflight({ cwd: cwdNoArg, agentDir });
	// direct distrust
	const cwdDirect = seedTrustInput(mkdir(path.join(reposRoot, "direct-false")));
	store.set(cwdDirect, false);
	const oDirect = preflight({ cwd: cwdDirect, agentDir });
	// inherited distrust (parent false, child has its OWN trust input but no direct
	// decision). The child trust input is load-bearing for THIS gate: pi's
	// resolveProjectTrusted returns true early when !hasProjectTrustInputs(cwd), so
	// WITHOUT a child trust input the project_trust event never fires and the escape
	// prompt is unreachable in the real pi path. With it, the event fires and the
	// inherited parent false is exactly what the escape overrides (GPT review).
	const inheritParent = seedTrustInput(mkdir(path.join(reposRoot, "inherit")));
	store.set(inheritParent, false);
	const inheritChild = seedTrustInput(mkdir(path.join(inheritParent, "nested", "child")));
	const oInherit = preflight({ cwd: inheritChild, agentDir });
	// fail-fast (trust input, no prefix root)
	const cwdFailFast = seedTrustInput(mkdir(path.join(reposRoot, "fail-fast")));
	const oFailFast = preflight({ cwd: cwdFailFast, agentDir });

	// Sanity: outcomes are the shapes we expect to decide over.
	ok(
		"setup: outcome kinds as expected",
		oApprove.kind === "approve" &&
			oNoArg.kind === "trusted-no-arg" &&
			oDirect.kind === "deny" &&
			oInherit.kind === "deny" &&
			oFailFast.kind === "deny",
	);
	ok(
		"setup: inherited fixture is event-reachable (parent false + child trust input)",
		oInherit.kind === "deny" &&
			oInherit.reason === "saved-false" &&
			oInherit.trustStoreInherited === true &&
			oInherit.hasTrustInputs === true && // pi fires project_trust only when this is true
			oDirect.kind === "deny" &&
			oDirect.trustStoreInherited === false,
	);

	// ── decideProjectTrust matrix ──────────────────────────────────────────
	{
		const fp = fakePrompt("trust-here");
		const r = await decideProjectTrust(oApprove, TUI, fp.prompt);
		ok("approve → {yes, remember:false}, no prompt", r.trusted === "yes" && r.remember === false && fp.calls() === 0);
	}
	{
		const fp = fakePrompt("trust-here");
		const r = await decideProjectTrust(oNoArg, TUI, fp.prompt);
		ok(
			"trusted-no-arg → {yes, remember:false}, no prompt",
			r.trusted === "yes" && r.remember === false && fp.calls() === 0,
		);
	}
	{
		const fp = fakePrompt("trust-here");
		const r = await decideProjectTrust(oDirect, TUI, fp.prompt);
		ok(
			"direct distrust → {no, remember:false}, no prompt (already stored)",
			r.trusted === "no" && r.remember === false && fp.calls() === 0,
		);
	}
	{
		// ⑤ THE ESCAPE: inherited false + interactive + trust-here → {yes, remember:true}
		const fp = fakePrompt("trust-here");
		const r = await decideProjectTrust(oInherit, TUI, fp.prompt);
		ok(
			"inherited false + interactive + trust-here → {yes, remember:true} (escape)",
			r.trusted === "yes" && r.remember === true && fp.calls() === 1,
		);
	}
	{
		const fp = fakePrompt("no");
		const r = await decideProjectTrust(oInherit, TUI, fp.prompt);
		ok(
			"inherited false + interactive + no → {no, remember:false} (R3a: no child false)",
			r.trusted === "no" && r.remember === false && fp.calls() === 1,
		);
	}
	{
		const fp = fakePrompt("cancel");
		const r = await decideProjectTrust(oInherit, TUI, fp.prompt);
		ok(
			"inherited false + interactive + cancel/ESC → {undecided} (defer = safe deny)",
			r.trusted === "undecided" && fp.calls() === 1,
		);
	}
	{
		// ③ non-interactive: pi -p (print) never prompts
		const fp = fakePrompt("trust-here");
		const r = await decideProjectTrust(oInherit, PRINT, fp.prompt);
		ok("inherited false + print (pi -p) → {undecided}, NO prompt", r.trusted === "undecided" && fp.calls() === 0);
	}
	{
		// ③ hasUI but not a TUI (rpc) — still no active prompt
		const fp = fakePrompt("trust-here");
		const r = await decideProjectTrust(oInherit, RPC, fp.prompt);
		ok(
			"inherited false + rpc (hasUI, not tui) → {undecided}, NO prompt",
			r.trusted === "undecided" && fp.calls() === 0,
		);
	}
	{
		const fp = fakePrompt("trust-here");
		const r = await decideProjectTrust(oFailFast, TUI, fp.prompt);
		ok("fail-fast → {undecided}, no active prompt (defer to pi's own)", r.trusted === "undecided" && fp.calls() === 0);
	}

	// ② no undefined: every outcome×ctx returns a concrete trusted field.
	{
		const all = [oApprove, oNoArg, oDirect, oInherit, oFailFast];
		const ctxs = [TUI, PRINT, RPC];
		let everReturned = 0;
		let everUndefined = 0;
		for (const o of all) {
			for (const c of ctxs) {
				const r = await decideProjectTrust(o, c, fakePrompt("cancel").prompt);
				everReturned += 1;
				if (r.trusted === undefined) everUndefined += 1;
			}
		}
		ok("② every branch returns a concrete result (never undefined)", everReturned === 15 && everUndefined === 0);
	}

	// ── adapter end-to-end (① single writer + ④ ctx.ui injection) ───────────
	{
		let selectTitle = "";
		const handler = createProjectTrustHandler({ prefixRoots: [], agentDir });
		const fakeCtx = {
			cwd: inheritChild,
			mode: "tui" as const,
			hasUI: true,
			ui: {
				select: async (title: string, _options: string[]) => {
					selectTitle = title;
					return TRUST_HERE_LABEL;
				},
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
		};
		const r = await handler({ type: "project_trust", cwd: inheritChild }, fakeCtx);
		ok(
			"adapter: inherited child + select(trust-here) → {yes, remember:true}",
			r.trusted === "yes" && r.remember === true,
		);
		ok(
			"④ adapter prompt title reuses F5a evidence (names inherited source)",
			selectTitle.includes(inheritParent) && selectTitle.includes("interactive pi"),
		);
		// ① single writer: the handler did NOT persist. Only pi's resolveProjectTrusted
		// would, on remember:true. So trust.json still has parent=false and NO child key.
		const fresh = new ProjectTrustStore(agentDir);
		ok(
			"① handler never wrote the child key (pi is the single writer)",
			fresh.getEntry(inheritChild)?.path === inheritParent,
		);
	}

	// label sanity: the no-label maps to "no", an unknown label maps to cancel.
	{
		let selected = "";
		const handler = createProjectTrustHandler({ prefixRoots: [], agentDir });
		const ctx = {
			cwd: inheritChild,
			mode: "tui" as const,
			hasUI: true,
			ui: {
				select: async () => {
					selected = KEEP_DISTRUSTED_LABEL;
					return KEEP_DISTRUSTED_LABEL;
				},
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
		};
		const r = await handler({ type: "project_trust", cwd: inheritChild }, ctx);
		ok(
			"adapter: select(keep-distrusted) → {no, remember:false}",
			r.trusted === "no" && r.remember === false && selected === KEEP_DISTRUSTED_LABEL,
		);
	}
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`[check-project-trust-handler] ${passed} assertions ok`);
