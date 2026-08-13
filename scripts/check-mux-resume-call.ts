/**
 * check-mux-resume-call — deterministic gate for the resume placement composition
 * (`pi-extensions/lib/mux-resume-call.ts`).
 *
 * Same scope discipline as `check-mux-launch` and `check-mux-fresh-call`: only what is decidable
 * without tmux. There is no fake tmux in this repo and this gate does not introduce one — the
 * real-window axis belongs to the LIVE lifecycle smoke.
 *
 * Every cwd claim below is a MEASURED tmux 3.6a behaviour, not a precaution. They were taken on a
 * private server on 2026-08-06, and each one is a way a resume would look successful while being
 * wrong. Since #73 the classification itself lives in the shared `classify-tmux-cwd.ts` leaf
 * (fresh-call consumes the same rules), so the CWD claims here are asserted against that leaf:
 *
 *   MUXRESUME-CWD-MISSING-REFUSED   a nonexistent `-c` does NOT fail: tmux exits 0, opens the
 *                                   window, and the child lands in $HOME. Nothing downstream can
 *                                   catch it — the launch receipt is well-formed either way.
 *   MUXRESUME-CWD-FORMAT-REFUSED    `-c` is FORMAT-EXPANDED. `<dir>/#{pane_id}` became `<dir>/%0`,
 *                                   and a `#(…)` value was observed running its command.
 *   MUXRESUME-CWD-WHITESPACE-OK     whitespace is SAFE (argv is an array) — so the refusal set
 *                                   stays at two rules and no quoting/escaping layer is owed.
 *   MUXRESUME-ARGV-HAS-CWD          the `-c` actually reaches tmux, after the append shape
 *   MUXRESUME-ARGV-RUNTIME-AFTER-DASHDASH  the runtime and its flags are exec'd, never parsed as
 *                                   tmux options or run through a shell
 *   MUXRESUME-ARGV-CARRIER-FREE     nothing beyond append + `-c` + runtime + the caller's flags
 *   MUXRESUME-NO-IDENTITY           this module never learns which citizen it is reopening
 *   MUXRESUME-SURFACE-SEAM          both surfaces hand the launcher IN; neither lets the v2
 *                                   composition import mux
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTmuxCwd } from "../pi-extensions/lib/classify-tmux-cwd.ts";
import type { Placement } from "../pi-extensions/lib/mux-placement.ts";
import {
	buildResumeCallArgs,
	RESUME_CALL_REJECT_HINT,
	RESUME_CALL_RUNTIME,
	type ResumeCallRejectReason,
	resumeCall,
} from "../pi-extensions/lib/mux-resume-call.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const PLACEMENT: Placement = {
	serverPid: "4242",
	sessionId: "$0",
	windowId: "@1",
	windowIndex: "1",
	paneId: "%1",
	panePid: "4243",
};

function main(): void {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-mux-resume-call-"));
	const realDir = path.join(tmp, "project");
	const spaceDir = path.join(tmp, "with space");
	const filePath = path.join(tmp, "a-file");
	fs.mkdirSync(realDir);
	fs.mkdirSync(spaceDir);
	fs.writeFileSync(filePath, "");
	// `assertLaunchTarget` proves the runtime is real BEFORE argv is built, so the argv
	// assertions need an executable that exists rather than a plausible-looking path.
	const runtimeDir = path.join(tmp, "bin");
	fs.mkdirSync(runtimeDir);
	const RUNTIME = path.join(runtimeDir, "pi");
	fs.writeFileSync(RUNTIME, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

	try {
		// ── cwd classification ────────────────────────────────────────────────────────
		ok("an existing absolute directory is accepted", classifyTmuxCwd(realDir) === null);

		ok(
			"[QK:MUXRESUME-CWD-MISSING-REFUSED] a cwd that no longer exists is refused HERE, because tmux would not refuse it — measured: rc=0, the window opens, and the child silently falls back to $HOME, so the resume would land a visible citizen in the wrong project and look successful",
			classifyTmuxCwd(path.join(tmp, "deleted-project")) === "cwd-missing",
		);
		ok(
			"a path that exists but is a FILE is refused as its own cause, not as missing",
			classifyTmuxCwd(filePath) === "cwd-not-directory",
		);
		ok(
			"[QK:MUXRESUME-CWD-FORMAT-REFUSED] a cwd containing '#' is refused unrun — measured: tmux FORMAT-EXPANDS the -c value, so `<dir>/#{pane_id}` silently became `<dir>/%0` and a `#(…)` value was observed executing its command; a path is data and tmux reads it as a format",
			classifyTmuxCwd(path.join(tmp, "#{pane_id}")) === "cwd-format-token" &&
				classifyTmuxCwd(path.join(tmp, "#(touch x)")) === "cwd-format-token",
		);
		ok(
			"the '#' refusal precedes the filesystem question, whose answer would be about a path tmux is not going to use",
			classifyTmuxCwd(path.join(realDir, "#nope")) === "cwd-format-token",
		);
		ok(
			"a relative cwd is refused before anything touches the filesystem",
			classifyTmuxCwd("project") === "cwd-not-absolute",
		);
		ok(
			"[QK:MUXRESUME-CWD-WHITESPACE-OK] a cwd containing whitespace is ACCEPTED — measured: argv is an array, tmux does not re-split it, and the directory arrived intact; inventing a quoting grammar here would refuse real project paths for a danger that was measured not to exist",
			classifyTmuxCwd(spaceDir) === null,
		);

		// ── argv shape ────────────────────────────────────────────────────────────────
		const runtimeArgs = ["--entwurf-control", "--session", "/s.jsonl", "--model", "m"] as const;
		const args = buildResumeCallArgs(PLACEMENT, realDir, RUNTIME, runtimeArgs);

		ok(
			"[QK:MUXRESUME-ARGV-HAS-CWD] the recorded cwd reaches tmux as `-c <dir>` — without it the window inherits the CALLER's directory and the citizen comes back in someone else's project",
			args.includes("-c") && args[args.indexOf("-c") + 1] === realDir,
		);
		ok(
			"the append shape is the leaf's: detached, appended at {end} of the caller's own session, printing the shared handle format",
			args[0] === "new-window" &&
				args.includes("-d") &&
				args.includes("-a") &&
				args[args.indexOf("-t") + 1] === "$0:{end}",
		);
		ok(
			"[QK:MUXRESUME-ARGV-RUNTIME-AFTER-DASHDASH] the runtime is preceded by `--` and every caller flag follows it, so tmux execs pi directly instead of reading `--session` as a tmux option or running the line through a shell",
			args[args.indexOf("--") + 1] === RUNTIME &&
				args.slice(args.indexOf("--") + 2).join(" ") === runtimeArgs.join(" "),
		);
		// Scoped to the TMUX prefix, before `--`. Everything after that belongs to pi, and a real
		// resume argv legitimately carries `-e <bridge>` there — asserting `-e` is absent from the
		// whole line would be green only because this fixture has no extensions, and would go red
		// on the recorded-ACP shape that actually ships.
		const tmuxPrefix = args.slice(0, args.indexOf("--"));
		ok(
			"[QK:MUXRESUME-ARGV-CARRIER-FREE] the TMUX half of the argv is exactly the append shape plus -c — no -n window name, no -e env carrier, no -b; the runtime's own flags live after `--` and are not tmux's business",
			!tmuxPrefix.includes("-n") && !tmuxPrefix.includes("-e") && !tmuxPrefix.includes("-b"),
		);
		ok(
			"a cwd that classification refuses can never be built into argv either — the builder re-checks rather than trusting its caller",
			(() => {
				try {
					buildResumeCallArgs(PLACEMENT, path.join(tmp, "#x"), RUNTIME, runtimeArgs);
					return false;
				} catch {
					return true;
				}
			})(),
		);
		ok(
			"a non-native session selector is refused before tmux is invoked",
			(() => {
				try {
					buildResumeCallArgs({ ...PLACEMENT, sessionId: "entwurf; kill-server" }, realDir, RUNTIME, []);
					return false;
				} catch {
					return true;
				}
			})(),
		);

		// ── refusals happen BEFORE any mutation ───────────────────────────────────────
		// No tmux context at all: a bad cwd must still be the reason, because it is decided first
		// and nothing may reach tmux while it is wrong.
		const noTmux = resumeCall({ cwd: path.join(tmp, "gone"), runtimeArgs: [] }, {});
		ok(
			"an unusable cwd refuses even outside tmux — the cwd question is settled before placement, so no window can exist by the time it is answered",
			!noTmux.ok && noTmux.reason === "cwd-missing",
		);
		const outsideTmux = resumeCall({ cwd: realDir, runtimeArgs: [] }, { PATH: "/nonexistent" });
		ok(
			"with a good cwd and no runtime on PATH, the refusal is the runtime — preconditions are proven before placement is even read",
			!outsideTmux.ok && outsideTmux.reason === "runtime-unresolved",
		);

		// ── every reason is answerable ────────────────────────────────────────────────
		const reasons: ResumeCallRejectReason[] = [
			"no-tmux-context",
			"anchor-malformed",
			"anchor-unresolved",
			"anchor-mismatch",
			"cwd-not-absolute",
			"cwd-format-token",
			"cwd-missing",
			"cwd-not-directory",
			"runtime-unresolved",
			"runtime-not-absolute",
			"runtime-path-whitespace",
			"runtime-missing",
			"runtime-not-regular-file",
			"runtime-not-executable",
		];
		ok(
			"every reject reason has a hint a caller can act on — a reason without one is a reason they will guess about",
			reasons.every((r) => typeof RESUME_CALL_REJECT_HINT[r] === "string" && RESUME_CALL_REJECT_HINT[r].length > 0),
		);
		ok("the fixed runtime is pi — only a control-socket backend has a same-id resume", RESUME_CALL_RUNTIME === "pi");

		// ── boundaries, asserted on source ────────────────────────────────────────────
		const SRC = read("pi-extensions/lib/mux-resume-call.ts");
		ok(
			"[QK:MUXRESUME-NO-IDENTITY] the module never mentions a garden id, a record, a lock or a transcript — it opens a place at a directory and knows nothing about whose citizen it is",
			!/gardenId|readAddressableMetaIdentity|acquireLock|transcriptPath/.test(SRC),
		);
		ok(
			"it imports only the mux lane — no entwurf core, no delivery",
			!/from "\.\/entwurf-/.test(SRC) && !/meta-session/.test(SRC),
		);
		ok(
			"it uses the SHARED APPEND_FORMAT rather than adding a start-path field: `-P -F` prints its row BEFORE the child chdirs (measured — pane_current_path there still reports the CALLER's cwd), so a path field would be both free-form in a `|`-joined row and racy",
			SRC.includes("APPEND_FORMAT") && !SRC.includes("pane_start_path"),
		);

		const PI_SURFACE = read("pi-extensions/entwurf-control.ts");
		const MCP_SURFACE = read("mcp/entwurf-bridge/src/index.ts");
		const V2_RESUME = read("pi-extensions/lib/entwurf-v2-visible-resume.ts");
		// IMPORTS, not mentions: the module header names the mux side deliberately (that is the
		// architecture being documented), so an assertion on prose would forbid the explanation
		// rather than the dependency.
		const v2ImportSpecifiers = [...V2_RESUME.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
		ok(
			"[QK:MUXRESUME-SURFACE-SEAM] the v2 composition never IMPORTS mux — the launcher is passed IN, which is what keeps docs/mux-launch-rail.md §11 true in both directions",
			v2ImportSpecifiers.length > 0 && !v2ImportSpecifiers.some((s) => /mux-/.test(s)),
		);
		ok(
			"both surfaces are the composition root: each imports the mux launcher AND the v2 composition and joins them itself",
			/mux-resume-call/.test(PI_SURFACE) &&
				/entwurf-v2-visible-resume/.test(PI_SURFACE) &&
				/mux-resume-call/.test(MCP_SURFACE) &&
				/entwurf-v2-visible-resume/.test(MCP_SURFACE),
		);

		// ── the NATIVE PI registration, judged as a registration ─────────────────────
		// The MCP half is judged on the real runtime tools/list by check-entwurf-bridge-boot.
		// Native pi has no equivalent boot oracle here, so its registration is read from source —
		// but narrowly, on the block itself, because "the module is imported" would stay true with
		// the tool deleted.
		const PI_BLOCK = (PI_SURFACE.split('name: "entwurf_resume_call",')[1] ?? "").split("\n}")[0];
		ok(
			"[QK:MUXRESUME-PI-SURFACE-REGISTERED] the native pi surface REGISTERS entwurf_resume_call and calls that registration during setup — an imported-but-unregistered verb is invisible to the operator while every import assertion stays green",
			PI_SURFACE.includes('name: "entwurf_resume_call"') && /registerResumeCallTool\(pi\);/.test(PI_SURFACE),
		);
		ok(
			"[QK:MUXRESUME-PI-SURFACE-TARGET-ONLY] the native schema is target-only and the handler passes params.target straight through — a model, task or prompt knob would be a second way to decide what a resumed citizen is, when the record already decided",
			/Type\.Object\(\{\s*target: Type\.String\(/.test(PI_BLOCK) &&
				/visibleResume\(params\.target,/.test(PI_BLOCK) &&
				!/model|task|prompt/.test(PI_BLOCK.split("parameters:")[1]?.split("async execute")[0] ?? ""),
		);

		// ── the description contract, both surfaces ──────────────────────────────────
		// Not prose parity — three claims an operator acts on, plus the host's own cap.
		const PI_DESC = (PI_BLOCK.split("description: `")[1] ?? "").split("`,")[0];
		const MCP_DESC = (MCP_SURFACE.split('"entwurf_resume_call",')[1] ?? "").split("{")[0];
		const statesTheContract = (text: string): boolean =>
			/dormant/i.test(text) && /no turn/i.test(text) && /observation/i.test(text) && /launch/i.test(text);

		for (const [which, text] of [
			["native pi", PI_DESC],
			["MCP bridge", MCP_DESC],
		] as const) {
			ok(
				`${which}: the resume description fits the host's 2048-char tool-description cap`,
				text.length > 0 && text.length <= 2048,
			);
		}
		// The two claim tokens are written OUT, not interpolated: qualification requires each
		// `[QK:…]` to appear literally exactly once in its gate source, so a token assembled at
		// runtime names a claim no manifest can bind to.
		ok(
			"[QK:MUXRESUME-DESC-CONTRACT-PI] native pi: the description states the three things a caller acts on — DORMANT targets only, no turn is run, and TWO receipts of which the observation is the one that says the citizen is back",
			statesTheContract(PI_DESC),
		);
		ok(
			"[QK:MUXRESUME-DESC-CONTRACT-MCP] MCP bridge: the description states the same three things — DORMANT targets only, no turn is run, and TWO receipts whose observation is the fact that matters",
			statesTheContract(MCP_DESC),
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}

	console.log(`\ncheck-mux-resume-call: ${passed} checks passed`);
}

main();
