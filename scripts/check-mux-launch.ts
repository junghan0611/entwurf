/**
 * check-mux-launch — deterministic gate for the T1-a visible launch
 * (`pi-extensions/lib/mux-launch.ts`).
 *
 * Same scope discipline as `check-mux-placement`: this gate pins only what is decidable
 * without tmux — the preconditions, the resolution rule, the argv shape, and the import
 * boundary. The topology and the "a failed exec still prints a handle" trap are judged
 * against a real private tmux server by `./run.sh check-mux-launch-tmux`, which drives THIS
 * production code. There is still no fake tmux in this repo.
 *
 * The precondition assertions use a real temporary directory rather than a stubbed `fs`: the
 * claim is about the filesystem answers (missing / directory / non-executable), and a stub
 * would be asserting against a second implementation of `statSync` instead of the one the
 * production path calls.
 *
 *   MUX-LAUNCH-PRECONDITION-FIRST  the runtime is proven launchable BEFORE any window opens
 *   MUX-LAUNCH-PATH-NO-SPLIT       a whitespace-bearing runtime path is refused (tmux re-splits it)
 *   MUX-LAUNCH-PATH-HIT-NOT-SKIPPED  that refusal is NOT a PATH skip — a later entry never takes over
 *   MUX-LAUNCH-NO-SHELL-ARGV       the fixed runtime is passed after `--`, never as a string
 *   MUX-LAUNCH-NO-CARRIER          argv is the append shape plus the runtime, nothing else
 *   MUX-LAUNCH-CORE-IMPORT-FREE    the launch module and entwurf delivery never import each other
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	assertLaunchTarget,
	buildLaunchArgs,
	LaunchPreconditionError,
	type LaunchRejectReason,
	PI_RUNTIME_COMMAND,
	resolvePiRuntime,
} from "../pi-extensions/lib/mux-launch.ts";
import { APPEND_FORMAT } from "../pi-extensions/lib/mux-placement.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** Run `f` and report the LaunchRejectReason it refused with, or null if it did not refuse. */
function refusalOf(f: () => unknown): LaunchRejectReason | null {
	try {
		f();
		return null;
	} catch (err) {
		return err instanceof LaunchPreconditionError ? err.reason : null;
	}
}

const SESSION = "$11";

function main(): void {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-mux-launch-"));
	try {
		const good = path.join(tmp, "pi");
		fs.writeFileSync(good, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		const notExec = path.join(tmp, "pi-noexec");
		fs.writeFileSync(notExec, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
		const dir = path.join(tmp, "pi-dir");
		fs.mkdirSync(dir);
		const spaced = path.join(tmp, "a b");
		fs.mkdirSync(spaced);
		const spacedPi = path.join(spaced, "pi");
		fs.writeFileSync(spacedPi, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

		// ── the runtime is proven BEFORE a window can exist ──────────────────────────────
		// Measured on tmux 3.6a: `new-window -- /nonexistent/bin/nope` exits 0, prints a
		// well-formed handle, and the window is still listed on an immediate re-read (10/10).
		// So there is no post-launch check that can tell a failed exec from a good one — the
		// only honest place to catch it is before the window exists.
		ok(
			"[QK:MUX-LAUNCH-PRECONDITION-FIRST] every unlaunchable runtime is refused with a NAMED reason before tmux is invoked — relative, missing, directory, and non-executable each refuse as themselves",
			refusalOf(() => assertLaunchTarget("pi")) === "runtime-not-absolute" &&
				refusalOf(() => assertLaunchTarget("./bin/pi")) === "runtime-not-absolute" &&
				refusalOf(() => assertLaunchTarget(path.join(tmp, "nope"))) === "runtime-missing" &&
				refusalOf(() => assertLaunchTarget(dir)) === "runtime-not-regular-file" &&
				refusalOf(() => assertLaunchTarget(notExec)) === "runtime-not-executable",
		);
		ok("precondition: a real absolute executable passes", refusalOf(() => assertLaunchTarget(good)) === null);

		// tmux re-splits a single argv element on whitespace (measured, 3.6a): a runtime at
		// `/tmp/a b/pi` is launched as `/tmp/a` with `b/pi` as an argument. `--` prevents the
		// shell, not the re-split, so this is its own invariant and not a tidier spelling of
		// the checks above.
		ok(
			"[QK:MUX-LAUNCH-PATH-NO-SPLIT] a runtime path containing ANY whitespace is refused — tmux would re-split it into a truncated binary plus an argument — and the refusal precedes the filesystem questions, whose answers would be about the wrong file",
			refusalOf(() => assertLaunchTarget(spacedPi)) === "runtime-path-whitespace" &&
				refusalOf(() => assertLaunchTarget(path.join(tmp, "no such dir", "pi"))) === "runtime-path-whitespace" &&
				refusalOf(() => assertLaunchTarget(`${tmp}/p\ti`)) === "runtime-path-whitespace" &&
				refusalOf(() => assertLaunchTarget(`${tmp}/p\ni`)) === "runtime-path-whitespace",
		);
		ok(
			"precondition: the refusal is a typed LaunchPreconditionError carrying the reason, not a bare Error",
			(() => {
				try {
					assertLaunchTarget("pi");
					return false;
				} catch (err) {
					return err instanceof LaunchPreconditionError && err.name === "LaunchPreconditionError";
				}
			})(),
		);

		// ── resolution: PATH, absolute, and never the cwd ────────────────────────────────
		ok(
			"resolve: the official runtime is found on PATH and returned as an absolute path",
			resolvePiRuntime({ PATH: tmp }) === good,
		);
		ok(
			"resolve: an empty PATH entry is skipped, never searched as cwd",
			resolvePiRuntime({ PATH: `${path.delimiter}${tmp}` }) === good,
		);
		ok(
			"resolve: a relative PATH entry is skipped — where the caller stood must not decide which binary launches",
			resolvePiRuntime({ PATH: `.${path.delimiter}${tmp}` }) === good,
		);
		ok(
			"resolve: a non-executable candidate does not shadow a later executable one",
			(() => {
				const shadow = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-mux-shadow-"));
				try {
					fs.writeFileSync(path.join(shadow, PI_RUNTIME_COMMAND), "x", { mode: 0o644 });
					return resolvePiRuntime({ PATH: `${shadow}${path.delimiter}${tmp}` }) === good;
				} finally {
					fs.rmSync(shadow, { recursive: true, force: true });
				}
			})(),
		);
		// The refuse/skip split is a contract, not an accident of where the assertion sits. A
		// candidate the shell ITSELF would skip (present but not executable) is skipped; a
		// candidate the shell WOULD have picked (executable, but its path holds whitespace) is
		// REFUSED. Falling through to a later PATH entry there would silently start a DIFFERENT
		// install than the one the operator gets by typing `pi` — the drift this rail refuses —
		// so which of the two a failure gets is pinned on its own claim. Moving
		// `assertLaunchTarget` inside the loop's catch is exactly the refactor that flips it.
		ok(
			"[QK:MUX-LAUNCH-PATH-HIT-NOT-SKIPPED] a whitespace-bearing FIRST executable hit is REFUSED, never skipped to a later entry — the shell would have picked that one, so falling through would launch a different install than `pi` does",
			refusalOf(() => resolvePiRuntime({ PATH: `${spaced}${path.delimiter}${tmp}` })) === "runtime-path-whitespace",
		);
		ok(
			"resolve: no runtime anywhere on PATH refuses as runtime-unresolved, and a missing PATH is the same refusal",
			refusalOf(() => resolvePiRuntime({ PATH: path.join(tmp, "empty") })) === "runtime-unresolved" &&
				refusalOf(() => resolvePiRuntime({})) === "runtime-unresolved",
		);
		ok("resolve: the runtime name is the fixed official one", PI_RUNTIME_COMMAND === "pi");

		// ── argv shape: the append shape plus the runtime, after `--` ────────────────────
		// `--` is what keeps tmux from handing the target to a shell (measured: an argument of
		// `x; touch <file>` created no file). It does NOT stop tmux re-splitting a spaced
		// element, which is why the whitespace precondition above is separate and not cosmetic.
		const args = buildLaunchArgs(SESSION, good);
		ok(
			"[QK:MUX-LAUNCH-NO-SHELL-ARGV] the fixed runtime is the LAST argv element and is preceded by `--`, so tmux execs it directly instead of running it through a shell",
			args[args.length - 2] === "--" && args[args.length - 1] === good,
		);
		ok(
			"[QK:MUX-LAUNCH-NO-CARRIER] launch argv is exactly the detached append shape plus the runtime — no -n/-c/-e/-b, no caller command, cwd, env or window name",
			args.join(" ") === `new-window -d -a -t ${SESSION}:{end} -P -F ${APPEND_FORMAT} -- ${good}` &&
				!["-n", "-c", "-e", "-b"].some((f) => args.includes(f)) &&
				args.length === 10,
		);
		ok(
			"argv: `-d` is kept — visible means a real window in the operator's session, not stolen focus",
			args.includes("-d"),
		);
		ok(
			"argv: the window is appended at {end} of the caller's own session, addressed by session id",
			args.includes("-a") && args.includes(`${SESSION}:{end}`),
		);
		ok(
			"argv: the printed handle format is the same stable @window/%pane row the leaf uses",
			args.includes("-P") && args.includes(APPEND_FORMAT),
		);
		ok(
			"argv: a non-native session selector is refused before tmux runs, exactly as the leaf refuses it",
			["$1; kill-server", "#{session_id}", "11", "@1", ""].every((s) => {
				try {
					buildLaunchArgs(s, good);
					return false;
				} catch {
					return true;
				}
			}),
		);
		ok(
			"argv: an unlaunchable runtime is refused by the builder too — the argv path cannot skip the precondition",
			refusalOf(() => buildLaunchArgs(SESSION, dir)) === "runtime-not-regular-file" &&
				refusalOf(() => buildLaunchArgs(SESSION, spacedPi)) === "runtime-path-whitespace",
		);

		// ── the import boundary (docs/mux-launch-rail.md §11) ───────────────────────────
		// A new module is exactly when a forbidden line drifts, so it is asserted on source
		// rather than trusted. Launch composition must not be reachable from the delivery
		// core, and the launch module must not reach back into it.
		//
		// The docs' claim is NOT "these four files do not import it" — it is that NO production
		// source imports it at all. An enumerated list proves the narrower thing and goes stale
		// the moment a fifth delivery module is written, so the shipped source is WALKED. The
		// corpus is asserted below to be the real one, because a scan is only as strong as what
		// it covers: narrowing it later is how a generalized oracle turns into a false green.
		const LAUNCH_MODULE = "pi-extensions/lib/mux-launch.ts";
		const LAUNCH_SRC = fs.readFileSync(LAUNCH_MODULE, "utf8");

		/** Module specifiers only — static `from "x"` and dynamic `import("x")`. A comment or a
		 * doc reference that merely NAMES a module is not an import, and the leaf's header now
		 * names the launch composition on purpose (see its export-seam note). */
		function importsOf(src: string): string[] {
			return [...src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1]);
		}
		const importsLaunch = (file: string): boolean =>
			importsOf(fs.readFileSync(file, "utf8")).some((spec) => spec.includes("mux-launch"));

		/** Every `.ts` under a shipped source root. `dist/` is a compiled copy of `src/` (a build
		 * artifact, not authored source — scanning it would double-count and drift), and
		 * `node_modules` is not ours. */
		function walkTs(root: string): string[] {
			const out: string[] = [];
			for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
				const child = `${root}/${entry.name}`;
				if (entry.isDirectory()) {
					if (entry.name === "node_modules" || entry.name === "dist") continue;
					out.push(...walkTs(child));
				} else if (entry.isFile() && child.endsWith(".ts")) {
					out.push(child);
				}
			}
			return out;
		}
		const DELIVERY_MODULES = [
			"pi-extensions/lib/entwurf-v2-contract.ts",
			"pi-extensions/lib/entwurf-v2-decider.ts",
			"pi-extensions/lib/entwurf-v2-runner.ts",
			"pi-extensions/lib/entwurf-v2-production.ts",
		];
		const PRODUCTION_SOURCES = [...walkTs("pi-extensions"), ...walkTs("mcp")].filter((f) => f !== LAUNCH_MODULE);
		ok(
			"corpus: the scanned corpus IS the shipped source — both roots, every delivery module and the bridge entrypoint present by name, no build artifacts, and the launch module itself the only exclusion",
			PRODUCTION_SOURCES.length >= 40 &&
				DELIVERY_MODULES.every((m) => PRODUCTION_SOURCES.includes(m)) &&
				PRODUCTION_SOURCES.includes("pi-extensions/lib/mux-placement.ts") &&
				PRODUCTION_SOURCES.includes("pi-extensions/entwurf-control.ts") &&
				PRODUCTION_SOURCES.includes("mcp/entwurf-bridge/src/index.ts") &&
				!PRODUCTION_SOURCES.includes(LAUNCH_MODULE) &&
				PRODUCTION_SOURCES.every((f) => !f.includes("node_modules") && !f.includes("/dist/")),
		);
		ok(
			"[QK:MUX-LAUNCH-CORE-IMPORT-FREE] NO production source imports mux-launch — not the four delivery modules, not any other shipped file — and mux-launch imports no entwurf core: launch composition is not a delivery dependency",
			PRODUCTION_SOURCES.every((m) => !importsLaunch(m)) && !/from\s+"\.\/(entwurf|meta)-[^"]*"/.test(LAUNCH_SRC),
		);
		ok(
			"boundary: mux-launch imports only node builtins and the placement leaf",
			importsOf(LAUNCH_SRC).every((spec) => spec.startsWith("node:") || spec === "./mux-placement.ts"),
		);
		ok(
			"boundary: the placement leaf does not import the launch module — the leaf stays deletable on its own",
			!importsLaunch("pi-extensions/lib/mux-placement.ts"),
		);
		// Prose is not behaviour: the module header names the T1-b vocabulary precisely to say
		// it does none of it, so this assertion reads CODE with the comments stripped. A check
		// that failed on its own documentation would push the boundary out of the docs.
		const LAUNCH_CODE = LAUNCH_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
		ok(
			"boundary: T1-b is untouched — no code here reads a record store, a garden id, or a session-id carrier",
			!/gardenId|nativeSessionId|session-id|meta-session|entwurf_v2/.test(LAUNCH_CODE),
		);

		console.log(`\ncheck-mux-launch: ${passed} checks passed`);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

main();
