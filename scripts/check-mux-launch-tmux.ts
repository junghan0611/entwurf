/**
 * check-mux-launch-tmux — REAL tmux acceptance for the T1-a visible launch.
 *
 * `check-mux-launch` pins preconditions, argv and the import boundary; here the production
 * `launchPi` runs against an actual tmux server and the assertions read the server's own
 * `list-windows`/`list-panes`. Same isolation contract as the T0-b acceptance: a private `-S`
 * socket under $XDG_RUNTIME_DIR, the operator's server snapshotted read-only before and after
 * and required to be byte-identical, and `TMUX`/`TMUX_PANE` INHERITED from a fixture pane's
 * own `/proc/<pid>/environ` rather than assembled.
 *
 * The runtime under test is a FIXTURE script, not the operator's real `pi`. T1-a's claim is
 * "the window opens in the right place and the named runtime is what starts in it" — a claim a
 * long-lived stand-in proves exactly, without an interactive agent, a model call, or a session
 * record. `resolvePiRuntime` (which finds the official `pi` on PATH) is proven by the
 * deterministic gate; here PATH is pointed at the fixture so this gate judges topology.
 *
 * Proven here:
 *   - the window lands at {end} of the caller's OWN session; one session throughout
 *   - the launched process is the runtime itself — no shell wrapper survives in the pane
 *   - pane_pid is that process, and it is alive
 *   - focus never moves, and the original windows and their pane pids survive
 *   - the handle is bound to the context it was born in
 *   - THE TRAP: a failed exec still exits 0, still prints a well-formed handle, and its window
 *     is still listed on an immediate re-read — which is why no post-launch presence check is
 *     performed and why the precondition runs before the window exists
 *   - a precondition refusal opens NO window at all
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildLaunchArgs, LaunchPreconditionError, launchPi } from "../pi-extensions/lib/mux-launch.ts";
import { inspectPlacement } from "../pi-extensions/lib/mux-placement.ts";
import { skipLive } from "./lib/live-skip.ts";

const LABEL = "check-mux-launch-tmux";
let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const SOCKET = path.join(process.env.XDG_RUNTIME_DIR ?? "/run/user/1000", `entwurf-mux-t1a-${process.pid}.sock`);
const SESSION = `muxt1a${process.pid}`;

function fx(...args: string[]): { status: number | null; stdout: string; stderr: string } {
	const env = { ...process.env };
	delete env.TMUX;
	delete env.TMUX_PANE;
	const r = spawnSync("tmux", ["-S", SOCKET, ...args], { env, encoding: "utf8" });
	if (r.error) throw r.error;
	return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function fxLines(...args: string[]): string[] {
	const r = fx(...args);
	assert.equal(r.status, 0, `fixture tmux ${args.join(" ")} failed: ${r.stderr}`);
	return r.stdout
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

function windows(): string[] {
	return fxLines("list-windows", "-a", "-F", "#{window_id}|#{window_index}|#{window_active}");
}

function panes(): string[] {
	return fxLines("list-panes", "-a", "-F", "#{window_id}|#{pane_id}|#{pane_pid}");
}

function sessionCount(): number {
	return fxLines("list-sessions", "-F", "#{session_id}").length;
}

function windowPresent(windowId: string): boolean {
	return fxLines("list-windows", "-a", "-F", "#{window_id}").includes(windowId);
}

/** Read-only snapshot of the CALLER'S OWN server — the ambient TMUX is kept deliberately. */
function operatorSnapshot(): string | null {
	const r = spawnSync("tmux", ["list-panes", "-a", "-F", "#{session_id}|#{window_id}|#{pane_id}|#{pane_pid}"], {
		env: process.env,
		encoding: "utf8",
	});
	return r.status === 0 ? (r.stdout ?? "") : null;
}

function alive(pid: string): boolean {
	try {
		process.kill(Number(pid), 0);
		return true;
	} catch {
		return false;
	}
}

function main(): void {
	if (spawnSync("tmux", ["-V"], { encoding: "utf8" }).status !== 0) {
		skipLive(LABEL, "tmux is not installed — install tmux to run the launch acceptance");
	}
	if (!fs.existsSync("/proc")) {
		skipLive(LABEL, "/proc is unavailable — the inherited-anchor read is Linux-only");
	}
	if (!process.env.TMUX || !process.env.TMUX_PANE) {
		skipLive(LABEL, "run this acceptance from INSIDE tmux — the isolation proof snapshots the caller's own server");
	}
	if (fs.existsSync(SOCKET)) {
		throw new Error(`${LABEL}: fixture socket ${SOCKET} already exists — refusing to reuse a foreign server`);
	}

	const before = operatorSnapshot();
	const runtimeDir = fs.mkdtempSync(path.join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "entwurf-mux-rt-"));
	// A long-lived stand-in for the official runtime. `exec` so no shell survives: the pane's
	// process must be the runtime itself for the pane_pid claim to mean anything.
	const runtime = path.join(runtimeDir, "pi");
	fs.writeFileSync(runtime, "#!/bin/sh\nexec sleep 900\n", { mode: 0o755 });

	try {
		assert.equal(fx("-f", "/dev/null", "new-session", "-d", "-s", SESSION).status, 0, "fixture new-session");
		fx("set-option", "-g", "base-index", "1");
		fx("set-option", "-gw", "pane-base-index", "1");
		fx("set-option", "-g", "renumber-windows", "on");
		assert.equal(fx("move-window", "-s", `${SESSION}:0`, "-t", `${SESSION}:1`).status, 0, "fixture move-window");
		assert.equal(fx("new-window", "-d", "-a", "-t", `${SESSION}:{end}`).status, 0, "fixture second window");

		const w0 = windows();
		ok("fixture: exactly one session", sessionCount() === 1);
		ok(`fixture: windows are 1,2 (${w0.join(" ")})`, w0.length === 2);

		// ── the anchor is INHERITED, not assembled ─────────────────────────────────────
		const callerPanePid = fxLines("display-message", "-p", "-t", `${SESSION}:1`, "#{pane_pid}")[0];
		const environ = fs.readFileSync(`/proc/${callerPanePid}/environ`, "utf8").split("\0");
		const inherited: NodeJS.ProcessEnv = { ...process.env };
		delete inherited.TMUX;
		delete inherited.TMUX_PANE;
		for (const entry of environ) {
			const eq = entry.indexOf("=");
			if (eq < 0) continue;
			const key = entry.slice(0, eq);
			if (key === "TMUX" || key === "TMUX_PANE") inherited[key] = entry.slice(eq + 1);
		}
		// The fixture runtime dir is PREPENDED, never substituted: the same env spawns tmux
		// itself, so replacing PATH outright would take tmux away from the production code and
		// this gate would be measuring a broken harness instead of a launch. Prepending also
		// makes the stand-in win over any real `pi` further down the operator's PATH.
		inherited.PATH = `${runtimeDir}${path.delimiter}${process.env.PATH ?? ""}`;
		ok("anchor: the fixture pane really inherited TMUX/TMUX_PANE", Boolean(inherited.TMUX && inherited.TMUX_PANE));
		ok("anchor: TMUX names the fixture socket, not the operator's", String(inherited.TMUX).startsWith(SOCKET));

		const got = inspectPlacement(inherited);
		assert.ok(got.ok, "inspectPlacement must resolve inside the fixture");
		const placement = got.placement;
		const fixtureServerPid = fxLines("display-message", "-p", "#{pid}")[0];
		const originalPanes = panes();
		const activeBefore = windows().find((w) => w.endsWith("|1"));

		// ── a precondition refusal opens NO window ─────────────────────────────────────
		// The whole reason preconditions run first: a caller who cannot start the runtime must
		// not be left with a window to clean up.
		{
			// A PATH that still finds tmux but has no `pi` anywhere: drop every entry holding an
			// executable `pi` rather than emptying PATH, so the refusal under test is the
			// runtime's absence and not a broken harness.
			const noPiEntries = (process.env.PATH ?? "")
				.split(path.delimiter)
				.filter((d) => d.length > 0 && path.isAbsolute(d))
				.filter((d) => {
					try {
						fs.accessSync(path.join(d, "pi"), fs.constants.X_OK);
						return false;
					} catch {
						return true;
					}
				});
			const noRuntime = { ...inherited, PATH: noPiEntries.join(path.delimiter) };
			assert.equal(
				spawnSync("tmux", ["-V"], { env: noRuntime, encoding: "utf8" }).status,
				0,
				"the no-pi PATH must still find tmux, or this would test the harness",
			);
			let reason: string | null = null;
			try {
				launchPi(placement, noRuntime);
			} catch (err) {
				reason = err instanceof LaunchPreconditionError ? err.reason : null;
			}
			ok("refusal: an unresolvable runtime refuses as runtime-unresolved", reason === "runtime-unresolved");
			ok("refusal: and NO window was opened by the refused launch", windows().length === 2);
		}

		// ── the launch ────────────────────────────────────────────────────────────────
		const launch = launchPi(placement, inherited);
		ok(`launch: 1,2,3 (${windows().join(" ")})`, windows().length === 3);
		ok("launch: landed at the END (index 3)", launch.windowIndex === "3");
		ok("launch: still exactly one session — a window, never a new session", sessionCount() === 1);
		ok("launch: stable handles", launch.windowId.startsWith("@") && launch.paneId.startsWith("%"));
		ok(
			"launch: focus unchanged — visible means a real window, not stolen focus",
			windows().find((w) => w.endsWith("|1")) === activeBefore,
		);
		ok(
			"launch: original windows and their pane pids untouched",
			originalPanes.every((p) => panes().includes(p)),
		);
		ok("launch: the receipt names the runtime it handed tmux", launch.runtimePath === runtime);
		ok(
			"launch: the handle carries the context it was born in",
			launch.serverPid === fixtureServerPid && launch.sessionId === placement.sessionId,
		);

		// ── the launched process IS the runtime — no shell wrapper ─────────────────────
		// Measured with `--`: tmux execs the target directly. If a shell survived in the pane,
		// pane_pid would be the wrapper and every later fact about "the runtime" would be about
		// the wrong process.
		const deadline = Date.now() + 5000;
		let cmdline = "";
		while (Date.now() < deadline) {
			try {
				cmdline = fs.readFileSync(`/proc/${launch.panePid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
			} catch {
				cmdline = "";
			}
			if (cmdline.includes("sleep")) break;
			spawnSync("sleep", ["0.05"]);
		}
		ok(`launch: pane_pid is the runtime's own process, no shell wrapper (${cmdline})`, cmdline.includes("sleep 900"));
		ok("launch: that process is alive", alive(launch.panePid));
		ok(
			"launch: tmux agrees the pane belongs to the launched window",
			panes().some((p) => p.startsWith(`${launch.windowId}|${launch.paneId}|${launch.panePid}`)),
		);

		// ── THE TRAP: a failed exec is indistinguishable at launch time ────────────────
		// This is the measured reason `launchPi` performs no post-launch presence check. The
		// gate asserts the trap directly so the honesty of the receipt is a pinned fact rather
		// than a claim in a comment.
		{
			const bogus = path.join(runtimeDir, "nope-not-here");
			const args = [
				"new-window",
				"-d",
				"-a",
				"-t",
				`${placement.sessionId}:{end}`,
				"-P",
				"-F",
				"#{window_id}",
				"--",
				bogus,
			];
			const r = spawnSync("tmux", args, { env: inherited, encoding: "utf8" });
			const printed = (r.stdout ?? "").trim();
			ok(
				"trap: a failed exec still exits 0 and still prints a well-formed handle",
				r.status === 0 && /^@[0-9]+$/.test(printed),
			);
			ok(
				"trap: and that window is STILL LISTED on an immediate re-read — no synchronous check can tell it from a good launch",
				windowPresent(printed),
			);
			const gone = Date.now() + 5000;
			while (windowPresent(printed) && Date.now() < gone) spawnSync("sleep", ["0.05"]);
			ok("trap: it disappears milliseconds later, through the same remain-on-exit path", !windowPresent(printed));
		}

		// ── binding: a foreign context is refused before mutating ─────────────────────
		assert.throws(
			() => launchPi({ ...placement, serverPid: "999999" }, inherited),
			/context changed/,
			"launchPi must refuse a placement from another server",
		);
		assert.throws(
			() => launchPi({ ...placement, sessionId: "$999" }, inherited),
			/context changed/,
			"launchPi must refuse a placement from another session",
		);
		ok("binding: launch refuses a foreign server or session before opening anything", windows().length === 3);

		// ── the argv the production builder emits is what actually ran ────────────────
		ok(
			"argv: the builder's shape is the one this acceptance exercised",
			buildLaunchArgs(placement.sessionId, runtime).slice(-2).join(" ") === `-- ${runtime}`,
		);

		// ── cleanup by the operator's own hand ────────────────────────────────────────
		process.kill(Number(launch.panePid), "SIGKILL");
		const end = Date.now() + 5000;
		while (windowPresent(launch.windowId) && Date.now() < end) spawnSync("sleep", ["0.05"]);
		ok("teardown: killing the runtime removes its window (remain-on-exit off)", !windowPresent(launch.windowId));
		const w5 = windows();
		ok(`restored: windows are 1,2 (${w5.join(" ")})`, w5.length === 2);
		ok("restored: exactly one session", sessionCount() === 1);
		ok(
			"restored: the original pane pids are the SAME processes",
			originalPanes.every((p) => panes().includes(p)),
		);
		ok("restored: focus never moved", windows().find((w) => w.endsWith("|1")) === activeBefore);
	} finally {
		fx("kill-server");
		if (fs.existsSync(SOCKET)) fs.rmSync(SOCKET, { force: true });
		fs.rmSync(runtimeDir, { recursive: true, force: true });
	}

	ok("cleanup: the fixture socket is gone", !fs.existsSync(SOCKET));
	ok("cleanup: the fixture server is unreachable", fx("list-sessions").status !== 0);

	const after = operatorSnapshot();
	ok("isolation: the operator's server is byte-identical before and after", before === after);

	console.log(`\n${LABEL}: ${passed} checks passed`);
}

main();
