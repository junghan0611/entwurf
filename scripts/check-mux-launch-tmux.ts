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
 * The runtimes under test are FIXTURE scripts, not the operator's real `pi`/`codex`. T1-a's claim is
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
 *   - the #105 seat, through the real `freshCall`: an absent seat refuses and creates nothing,
 *     an existing one puts the window in THAT session with a receipt naming the resolved
 *     target, and the resulting handle closes through `closeWindow` from outside that session
 *   - an omitted seat stays caller-local for EVERY backend (#95 D1 retired the Codex home)
 *   - #95 lane B's caller-seat leaf against REAL pane titles: 0 / 1 / 2 matching panes, and the
 *     activity-adjacent title a ` | `-segment rule would miss
 *   - #95 lane B's COMPOSITION: a Codex caller's omitted-placement fresh call lands in the
 *     session its own titled pane is in, an explicit seat still overrides it, and an
 *     unresolvable anchor refuses with the server byte-identical
 *   - #95 lane C: WHERE a sibling starts — a caller's record directory places the pane, an
 *     explicit request still wins, an omitted one inherits THIS process's directory rather
 *     than the target session's `session_path`, and codex carries that same directory to its
 *     thread as `-C`, read off the runtime's own recorded argv
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildLaunchArgs, LaunchPreconditionError, launchPi } from "../pi-extensions/lib/mux-launch.ts";
import { inspectPlacement, runTmux } from "../pi-extensions/lib/mux-placement.ts";
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

async function main(): Promise<void> {
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
	// Each stand-in also DUMPS its own argv beside itself before it sleeps. That file is the
	// only oracle in this repo for "what actually reached the runtime", independent of the
	// builder that composed it — #95 lane C needs it because codex's thread directory rides a
	// VENDOR flag whose absence is silent (the thread simply opens in the app-server's repo).
	const runtime = path.join(runtimeDir, "pi");
	const DUMP_ARGV = '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$0.argv"\nexec sleep 900\n';
	fs.writeFileSync(runtime, DUMP_ARGV, { mode: 0o755 });
	fs.writeFileSync(path.join(runtimeDir, "codex"), DUMP_ARGV, { mode: 0o755 });

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

		// ── the fresh-call composition, against a real server (#105) ──────────────────
		// The seat's deterministic gate can prove the argv, the leaf and the refusals, but the
		// two things that only exist once tmux has answered — WHICH session the window landed
		// in, and what the receipt says about it — had no oracle independent of the production
		// source. This cell is that oracle: the same hermetic runtime above, a SECOND session
		// on this same private server, and the real `freshCall`, read through its return value
		// and the server's own inventory.
		{
			const { freshCall } = await import("../pi-extensions/lib/mux-fresh-call.ts");
			const { closeWindow } = await import("../pi-extensions/lib/mux-placement.ts");
			const call = (placementInput?: { tmuxSession: string }) =>
				freshCall(
					{
						backend: "pi",
						model: "fixture/model",
						task: "fixture task",
						placement: placementInput,
						callerGardenId: "20260101T000000-fixture",
					},
					inherited,
				);
			const inventory = (): string => fxLines("list-windows", "-a", "-F", "#{session_id}|#{window_id}").join(" ");

			// (i) an ABSENT seat: named refusal, and the server is byte-identical afterwards.
			const beforeAbsent = inventory();
			const absent = call({ tmuxSession: "nosuchseat" });
			ok(
				"seat: an absent seat refuses as tmux-session-missing and creates NOTHING — no window, no session",
				!absent.ok && absent.reason === "tmux-session-missing" && inventory() === beforeAbsent,
			);

			// (ii) an EXISTING seat on the same server: the window lands THERE, the caller's own
			// session is untouched, and the receipt names the resolved target rather than the caller.
			assert.equal(fx("new-session", "-d", "-s", `${SESSION}-seat`).status, 0, "fixture seat session");
			const seatId = fxLines("list-windows", "-t", `=${SESSION}-seat`, "-F", "#{session_id}")[0];
			const callerWindowsBefore = fxLines("list-windows", "-t", placement.sessionId, "-F", "#{window_id}").join(" ");
			const seated = call({ tmuxSession: `${SESSION}-seat` });
			assert.ok(seated.ok, `the seated fresh call must succeed: ${seated.ok ? "" : seated.reason}`);
			const receipt = seated.receipt;
			ok(
				"seat: the receipt reports the RESOLVED target session and echoes the REQUESTED name — not the caller's session",
				receipt.sessionId === seatId &&
					receipt.sessionId !== placement.sessionId &&
					receipt.tmuxSession === `${SESSION}-seat`,
			);
			ok(
				"seat: tmux agrees — the window is in the seat, and the caller's own session is byte-identical",
				fxLines("list-windows", "-t", seatId, "-F", "#{window_id}").includes(receipt.windowId) &&
					fxLines("list-windows", "-t", placement.sessionId, "-F", "#{window_id}").join(" ") === callerWindowsBefore,
			);
			ok(
				"seat: an omitted Pi seat still lands in the caller's own session and the receipt names none",
				(() => {
					const own = call();
					if (!own.ok) return false;
					const here = own.receipt.sessionId === placement.sessionId && own.receipt.tmuxSession === undefined;
					process.kill(Number(own.receipt.panePid), "SIGKILL");
					return here;
				})(),
			);

			// (iii) the close side: that handle closes through the production verb, in a session
			// that is NOT the caller's — the reason close binds to the server half.
			ok(
				"seat: the placed window closes through its own handle and tmux stops listing it",
				closeWindow(receipt, inherited) === "closed" &&
					!fxLines("list-windows", "-a", "-F", "#{window_id}").includes(receipt.windowId),
			);

			// (iv) #95 D1 (GLG, 2026-09-16): an omitted seat is caller-local for EVERY backend,
			// Codex included. Until then an omitted-placement Codex selected a fixed existing
			// session named `codex` — a room the operator had to keep because nothing could find
			// the pane a Codex caller was sitting in. The caller-pane anchor below IS that
			// mapping, so this cell now asserts the ABSENCE of the old default: with a session
			// literally named `codex` present on this server, an omitted-placement Codex call
			// must still land in the caller's own session and name no seat at all.
			assert.equal(fx("new-session", "-d", "-s", "codex").status, 0, "fixture session named codex");
			const decoyHomeId = fxLines("list-windows", "-t", "=codex", "-F", "#{session_id}")[0];
			const omittedCodex = freshCall(
				{
					backend: "codex",
					model: "fixture-model",
					task: "fixture task",
					callerGardenId: "20260101T000000-fixture",
				},
				inherited,
			);
			assert.ok(
				omittedCodex.ok,
				`the omitted-placement Codex call must succeed: ${omittedCodex.ok ? "" : omittedCodex.reason}`,
			);
			ok(
				"no fixed home: an omitted Codex seat is caller-local and names NO seat, even with a session called `codex` right there",
				omittedCodex.receipt.sessionId === placement.sessionId &&
					omittedCodex.receipt.sessionId !== decoyHomeId &&
					omittedCodex.receipt.tmuxSession === undefined &&
					omittedCodex.receipt.tmuxSessionSource === undefined &&
					fxLines("list-windows", "-t", decoyHomeId, "-F", "#{window_id}").length === 1,
			);
			process.kill(Number(omittedCodex.receipt.panePid), "SIGKILL");
			fx("kill-session", "-t", seatId);
			fx("kill-session", "-t", decoyHomeId);
			ok("seat: the fixture is back to one session", sessionCount() === 1);

			// (v) #95 lane B: the caller-seat leaf, against REAL pane titles on this server.
			// The deterministic gate can pin the anchor and the counting, but "what tmux
			// actually reports as `#{pane_title}`, and which `$session` that pane is in" had
			// no oracle independent of the leaf's own parse. This cell is that oracle. The
			// titles are set with `select-pane -T` rather than by a Codex process: the claim
			// under test is the LOOKUP, and a real TUI would add a model turn, a record and a
			// vendor version to a gate that must stay hermetic.
			{
				const { resolveCodexCallerSeat } = await import("../pi-extensions/lib/codex-caller-seat.ts");
				const thread = "01a0a7f9-ed9c-7aa2-a4dd-b1a39c0d4e11";
				const anchor = `${thread.slice(0, 29)}...`;
				const seatRun = (args: string[]) => runTmux(args, inherited);
				const titleOf = (pane: string): string =>
					fxLines("list-panes", "-a", "-F", "#{pane_id}|#{pane_title}").find((row) => row.startsWith(`${pane}|`)) ?? "";

				// 0 matches: every pane on this server carries the default title, which is the
				// same shape a server with `allow-set-title off` reports for a live Codex.
				ok(
					"caller seat: no pane naming the thread refuses as unresolved — no fallback session",
					(() => {
						const r = resolveCodexCallerSeat(thread, seatRun);
						return !r.ok && r.reason === "codex-caller-seat-unresolved";
					})(),
				);

				// 1 match, in a session that is NOT the caller's: the leaf must report THAT
				// session, which is the whole point of the anchor.
				assert.equal(fx("new-session", "-d", "-s", `${SESSION}-tui`).status, 0, "fixture TUI session");
				const tuiSessionId = fxLines("list-windows", "-t", `=${SESSION}-tui`, "-F", "#{session_id}")[0];
				const tuiPane = fxLines("list-panes", "-t", `=${SESSION}-tui`, "-F", "#{pane_id}")[0];
				assert.equal(fx("select-pane", "-t", tuiPane, "-T", `entwurf | ${anchor}`).status, 0, "fixture TUI title");
				ok(
					"caller seat: tmux really reports the OSC-shaped title we are matching against",
					titleOf(tuiPane) === `${tuiPane}|entwurf | ${anchor}`,
				);
				ok(
					"caller seat: the one matching pane resolves to ITS session, not the caller's",
					(() => {
						const r = resolveCodexCallerSeat(thread, seatRun);
						return (
							r.ok &&
							r.seat.paneId === tuiPane &&
							r.seat.sessionId === tuiSessionId &&
							r.seat.sessionId !== placement.sessionId &&
							r.seat.source === "codex-title-anchor"
						);
					})(),
				);

				// The ACTIVITY-adjacent shape. `title_setup.rs:183-193` joins the activity item
				// to its neighbour with a plain space, so an operator list ending in `activity`
				// renders the thread id INSIDE one ` | ` segment. A segment-equality rule reads
				// this pane as no match at all; the token rule resolves it.
				assert.equal(fx("select-pane", "-t", tuiPane, "-T", `entwurf | Working ${anchor}`).status, 0, "activity title");
				ok(
					"caller seat: an activity-adjacent title still resolves — the id is a TOKEN, not a whole segment",
					(() => {
						const r = resolveCodexCallerSeat(thread, seatRun);
						return r.ok && r.seat.paneId === tuiPane && r.seat.sessionId === tuiSessionId;
					})(),
				);

				// 2 matches: a stale duplicate in another session. Picking either would seat a
				// sibling by guess, so nothing is chosen.
				assert.equal(fx("split-window", "-d", "-t", tuiPane).status, 0, "fixture duplicate pane");
				const duplicate = fxLines("list-panes", "-t", `=${SESSION}-tui`, "-F", "#{pane_id}").find(
					(id) => id !== tuiPane,
				);
				assert.ok(duplicate, "the fixture duplicate pane must exist");
				assert.equal(fx("select-pane", "-t", duplicate, "-T", `tmp | ${anchor}`).status, 0, "duplicate title");
				ok(
					"caller seat: two panes naming one thread refuse as ambiguous — never the first match",
					(() => {
						const r = resolveCodexCallerSeat(thread, seatRun);
						return !r.ok && r.reason === "codex-caller-seat-ambiguous";
					})(),
				);

				// ── the COMPOSITION, through the real `freshCall` (#95 lane B C3) ─────────
				// The leaf's decision is proven above; what has no oracle outside production is
				// whether the omitted-placement path for a CODEX CALLER actually reaches that
				// decision and turns it into the `-t` target. These cells run the real
				// composition with the same hermetic runtime the rest of this gate uses, and
				// read the answer from the server's own inventory rather than the receipt alone.
				// Back to EXACTLY one matching pane: the duplicate above must stop naming the
				// thread, or the composition below would (correctly) refuse as ambiguous.
				assert.equal(fx("select-pane", "-t", duplicate, "-T", "plain-shell").status, 0, "clear duplicate title");
				assert.equal(fx("select-pane", "-t", tuiPane, "-T", `entwurf | ${anchor}`).status, 0, "restore TUI title");
				const anchoredCall = (over?: { tmuxSession: string }) =>
					freshCall(
						{
							backend: "pi",
							model: "fixture/model",
							task: "fixture task",
							placement: over,
							callerGardenId: "20260101T000000-fixture",
							callerNativeSessionId: thread,
						},
						inherited,
					);

				const anchored = anchoredCall();
				assert.ok(anchored.ok, `the anchored fresh call must succeed: ${anchored.ok ? "" : anchored.reason}`);
				ok(
					"caller seat composition: the window lands in the session the CALLER's pane is in, not the caller session",
					anchored.receipt.sessionId === tuiSessionId &&
						anchored.receipt.sessionId !== placement.sessionId &&
						fxLines("list-windows", "-t", tuiSessionId, "-F", "#{window_id}").includes(anchored.receipt.windowId),
				);
				ok(
					"caller seat composition: the receipt names the SOURCE and no session name — the pane was observed, not requested",
					anchored.receipt.tmuxSessionSource === "codex-title-anchor" && anchored.receipt.tmuxSession === undefined,
				);
				ok(
					"caller seat composition: that window closes by its own handle",
					closeWindow(anchored.receipt, inherited) === "closed" &&
						!fxLines("list-windows", "-a", "-F", "#{window_id}").includes(anchored.receipt.windowId),
				);

				// Rule 1 over rule 2, against a real server: an explicit seat is never rewritten
				// by the anchor, even when the anchor would have resolved.
				assert.equal(fx("new-session", "-d", "-s", `${SESSION}-over`).status, 0, "fixture override session");
				const overrideId = fxLines("list-windows", "-t", `=${SESSION}-over`, "-F", "#{session_id}")[0];
				const overridden = anchoredCall({ tmuxSession: `${SESSION}-over` });
				assert.ok(overridden.ok, `the overridden fresh call must succeed: ${overridden.ok ? "" : overridden.reason}`);
				ok(
					"caller seat composition: an explicit seat still wins over a resolvable anchor",
					overridden.receipt.sessionId === overrideId &&
						overridden.receipt.sessionId !== tuiSessionId &&
						overridden.receipt.tmuxSession === `${SESSION}-over` &&
						overridden.receipt.tmuxSessionSource === "requested",
				);
				closeWindow(overridden.receipt, inherited);
				fx("kill-session", "-t", overrideId);

				// An unresolvable anchor is a refusal with NOTHING created anywhere — the D2
				// contract, read from the server rather than from the return value alone.
				const beforeUnresolved = inventory();
				const unresolved = freshCall(
					{
						backend: "pi",
						model: "fixture/model",
						task: "fixture task",
						callerGardenId: "20260101T000000-fixture",
						callerNativeSessionId: "01a0ffff-ffff-7fff-bfff-ffffffffffff",
					},
					inherited,
				);
				ok(
					"caller seat composition: an unresolvable anchor refuses and creates NOTHING — no window, no session, no fallback",
					!unresolved.ok && unresolved.reason === "codex-caller-seat-unresolved" && inventory() === beforeUnresolved,
				);

				fx("kill-session", "-t", tuiSessionId);
				ok("caller seat: the fixture is back to one session", sessionCount() === 1);
			}

			// (vi) #95 lane C: WHERE the sibling starts, read off the pane and off the runtime's
			// own argv. The deterministic gate can pin which value the composition selects; what
			// only tmux and the runtime can answer is whether that value actually placed the
			// pane, and whether the vendor token carrying it survived to the process. A codex
			// thread's directory is the sharper half: with no `-C` the TUI attaches to the
			// operator's app-server and the THREAD opens in the app-server's repo while the pane
			// sits somewhere else entirely — a divergence no receipt in this repo would show.
			{
				const callerRepo = path.join(runtimeDir, "caller-repo");
				const requestedRepo = path.join(runtimeDir, "requested-repo");
				const sessionRepo = path.join(runtimeDir, "session-repo");
				for (const dir of [callerRepo, requestedRepo, sessionRepo]) fs.mkdirSync(dir);
				const paneCwd = (paneId: string): string =>
					fxLines("display-message", "-p", "-t", paneId, "#{pane_current_path}")[0];
				const argvAt = (backend: "pi" | "codex"): string => `${path.join(runtimeDir, backend)}.argv`;
				/** `[측정]` a pane's `#{pane_current_path}` is read from the child's `/proc` at
				 * QUERY time, and tmux chdirs in that child AFTER forking it — so a read taken
				 * straight after the launch receipt can still answer the SERVER's directory and
				 * make a correct `-c` look ignored. The runtime's own argv dump is the settle
				 * signal: once it exists the fixture is running and has been chdir'ed. Bounded,
				 * never unbounded — a runtime that never starts is a failed assertion, not a hang.
				 * Each launch clears the previous file first, so a stale dump can never be read
				 * as this launch's. */
				const clearArgv = (backend: "pi" | "codex"): void => fs.rmSync(argvAt(backend), { force: true });
				const awaitRuntime = (backend: "pi" | "codex"): void => {
					const end = Date.now() + 5000;
					while (!fs.existsSync(argvAt(backend)) && Date.now() < end) spawnSync("sleep", ["0.05"]);
					assert.ok(fs.existsSync(argvAt(backend)), `the ${backend} fixture started and recorded its argv`);
				};
				const runtimeArgv = (backend: "pi" | "codex"): string[] => {
					awaitRuntime(backend);
					const argv = fs.readFileSync(argvAt(backend), "utf8").split("\n").slice(0, -1);
					clearArgv(backend);
					return argv;
				};
				const freshWith = (over: { backend?: "pi" | "codex"; cwd?: string; callerCwd?: string }) =>
					freshCall(
						{
							backend: over.backend ?? "pi",
							model: "fixture/model",
							task: "fixture task",
							cwd: over.cwd,
							callerCwd: over.callerCwd,
							callerGardenId: "20260101T000000-fixture",
						},
						inherited,
					);

				clearArgv("pi");
				const fromRecord = freshWith({ callerCwd: callerRepo });
				assert.ok(fromRecord.ok, `the caller-cwd fresh call must succeed: ${fromRecord.ok ? "" : fromRecord.reason}`);
				awaitRuntime("pi");
				ok(
					"caller cwd: a caller that HAS a record directory opens the pane THERE, not in this process's directory",
					paneCwd(fromRecord.receipt.paneId) === callerRepo &&
						callerRepo !== process.cwd() &&
						fromRecord.receipt.cwd === callerRepo &&
						fromRecord.receipt.cwdSource === "codex-caller-record",
				);
				ok(
					"caller cwd: the runtime argv carries no tmux carrier — the directory reached the PANE through `-c`",
					!runtimeArgv("pi").includes("-c"),
				);
				closeWindow(fromRecord.receipt, inherited);

				clearArgv("pi");
				const requested = freshWith({ cwd: requestedRepo, callerCwd: callerRepo });
				assert.ok(requested.ok, `the requested-cwd fresh call must succeed: ${requested.ok ? "" : requested.reason}`);
				awaitRuntime("pi");
				ok(
					"caller cwd: an explicit request still wins over the caller's record directory, and the receipt says which rule chose it",
					paneCwd(requested.receipt.paneId) === requestedRepo &&
						requested.receipt.cwd === requestedRepo &&
						requested.receipt.cwdSource === "requested",
				);
				closeWindow(requested.receipt, inherited);
				runtimeArgv("pi");

				// The inherited case, and the measurement `-C`'s default rests on: with no `-c`
				// the pane takes the directory of the process that ran `new-window` — NOT the
				// target session's `session_path`, which is why a seat in another directory is
				// what makes this readable at all.
				assert.equal(
					fx("new-session", "-d", "-s", `${SESSION}-cwd`, "-c", sessionRepo).status,
					0,
					"fixture session rooted elsewhere",
				);
				const seatCwdId = fxLines("list-windows", "-t", `=${SESSION}-cwd`, "-F", "#{session_id}")[0];
				clearArgv("pi");
				const inherit = freshCall(
					{
						backend: "pi",
						model: "fixture/model",
						task: "fixture task",
						placement: { tmuxSession: `${SESSION}-cwd` },
						callerGardenId: "20260101T000000-fixture",
					},
					inherited,
				);
				assert.ok(inherit.ok, `the inherited-cwd fresh call must succeed: ${inherit.ok ? "" : inherit.reason}`);
				awaitRuntime("pi");
				ok(
					"caller cwd: with NO directory named, the pane inherits this process's — not the target session's session_path — and the receipt invents nothing",
					paneCwd(inherit.receipt.paneId) === process.cwd() &&
						process.cwd() !== sessionRepo &&
						inherit.receipt.sessionId === seatCwdId &&
						inherit.receipt.cwd === undefined &&
						inherit.receipt.cwdSource === undefined,
				);
				closeWindow(inherit.receipt, inherited);
				runtimeArgv("pi");
				fx("kill-session", "-t", seatCwdId);

				// The codex half: the SAME value the pane got, carried to the vendor as `-C`,
				// read off the process's own argv rather than off the builder that wrote it.
				clearArgv("codex");
				const codexThread = freshWith({ backend: "codex", callerCwd: callerRepo });
				assert.ok(codexThread.ok, `the codex fresh call must succeed: ${codexThread.ok ? "" : codexThread.reason}`);
				const codexArgv = runtimeArgv("codex");
				const dashC = codexArgv.indexOf("-C");
				ok(
					"codex thread cwd: the vendor argv carries `-C <dir>` with the SAME directory the pane landed in — one value, two carriers",
					dashC >= 0 &&
						codexArgv[dashC + 1] === callerRepo &&
						codexArgv.filter((a) => a === "-C").length === 1 &&
						paneCwd(codexThread.receipt.paneId) === callerRepo,
				);
				ok(
					"codex thread cwd: the flag rides the SAME argv as the remote attachment — an attached thread with no override takes the app-server's directory",
					codexArgv.includes("--remote") && dashC > codexArgv.indexOf("--remote"),
				);
				closeWindow(codexThread.receipt, inherited);
				ok("caller cwd: the fixture is back to one session", sessionCount() === 1);
			}
		}
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

await main();
