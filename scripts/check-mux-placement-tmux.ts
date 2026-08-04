/**
 * check-mux-placement-tmux — REAL tmux acceptance for the T0-b placement primitives.
 *
 * This is the half that judges topology. `check-mux-placement` pins argv and parsing; here
 * the production functions in `pi-extensions/lib/mux-placement.ts` run against an actual
 * tmux server and the assertions read the server's own `list-sessions`/`list-windows`/
 * `list-panes` output. No fake tmux exists in this repo — a fake would have authored the
 * contract before it was measured, which is how the 2026-08-02 attempt shipped the wrong
 * unit (a separate session instead of a window).
 *
 * Isolation, non-negotiable: the fixture builds its OWN server on a unique `-S` socket under
 * $XDG_RUNTIME_DIR and never touches the operator's server. (`-L` would place the socket in
 * the same directory as the default server; `-S` with an explicit path keeps them apart. The
 * path lives in the runtime dir rather than a deep scratch dir because a unix socket path is
 * capped near 104 bytes.) The operator's server is snapshotted read-only before and after and
 * the two snapshots must be identical.
 *
 * Honesty of the anchor: the production code must receive `TMUX`/`TMUX_PANE` the way a real
 * caller does — INHERITED by a process living inside a pane. The fixture therefore reads
 * those values out of the fixture pane's own process environment (`/proc/<pane_pid>/environ`)
 * instead of assembling them. That is Linux-only, and the check skips elsewhere rather than
 * inventing the values it is supposed to be proving.
 *
 * Proven here:
 *   - one session throughout; 1,2 → 1,2,3 → 1,2,3,4 → 1,2
 *   - original windows, their pane pids, and the caller's focus all survive
 *   - handles are stable @window/%pane
 *   - the rc=0 trap is real, and inspectPlacement refuses it instead of guessing
 *   - close reports `closed` for a live window and `already-gone` after a natural exit
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appendWindow, closeWindow, inspectPlacement } from "../pi-extensions/lib/mux-placement.ts";
import { skipLive } from "./lib/live-skip.ts";

const LABEL = "check-mux-placement-tmux";
let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// ── fixture server (never the operator's) ──────────────────────────────────

const SOCKET = path.join(process.env.XDG_RUNTIME_DIR ?? "/run/user/1000", `entwurf-mux-t0b-${process.pid}.sock`);
const SESSION = `muxt0b${process.pid}`;

/** Fixture tmux: always explicit `-S`, always with the ambient TMUX stripped so an ambient
 * server can never be resolved by accident. */
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

/**
 * Read-only snapshot of the CALLER'S OWN server — the one this gate must prove it never
 * touched. The ambient `TMUX` is kept deliberately: scrubbing it would snapshot the DEFAULT
 * server instead, which is not necessarily the operator's, and the isolation claim would be
 * about the wrong machine. (Only the FIXTURE calls scrub the environment.)
 */
function operatorSnapshot(): string | null {
	const r = spawnSync("tmux", ["list-panes", "-a", "-F", "#{session_id}|#{window_id}|#{pane_id}|#{pane_pid}"], {
		env: process.env,
		encoding: "utf8",
	});
	return r.status === 0 ? (r.stdout ?? "") : null;
}

function main(): void {
	if (spawnSync("tmux", ["-V"], { encoding: "utf8" }).status !== 0) {
		skipLive(LABEL, "tmux is not installed — install tmux to run the placement acceptance");
	}
	if (!fs.existsSync("/proc")) {
		skipLive(LABEL, "/proc is unavailable — the inherited-anchor read is Linux-only");
	}
	// The isolation proof is about the caller's OWN server, so this gate must be run from
	// inside tmux. Without that it would be snapshotting something else and calling it proof.
	if (!process.env.TMUX || !process.env.TMUX_PANE) {
		skipLive(LABEL, "run this acceptance from INSIDE tmux — the isolation proof snapshots the caller's own server");
	}
	if (fs.existsSync(SOCKET)) {
		throw new Error(`${LABEL}: fixture socket ${SOCKET} already exists — refusing to reuse a foreign server`);
	}

	const before = operatorSnapshot();

	try {
		// ── fixture: a session whose windows are 1 and 2, like the operator's ───────────
		// `-f /dev/null` keeps the operator's tmux.conf out of the FIXTURE (this is a
		// controlled substrate, not a display), and base-index is then set explicitly rather
		// than inherited or assumed. base-index does not apply retroactively, so window 0 is
		// moved. No `-n`: this module authors no window names anywhere.
		assert.equal(fx("-f", "/dev/null", "new-session", "-d", "-s", SESSION).status, 0, "fixture new-session");
		fx("set-option", "-g", "base-index", "1");
		fx("set-option", "-gw", "pane-base-index", "1");
		// renumber-windows on mirrors the operator's shipped setting — the acceptance must run
		// under the same index churn the production code has to survive.
		fx("set-option", "-g", "renumber-windows", "on");
		assert.equal(fx("move-window", "-s", `${SESSION}:0`, "-t", `${SESSION}:1`).status, 0, "fixture move-window");
		assert.equal(fx("new-window", "-d", "-a", "-t", `${SESSION}:{end}`).status, 0, "fixture second window");

		const w0 = windows();
		ok("fixture: exactly one session", sessionCount() === 1);
		ok(`fixture: windows are 1,2 (${w0.join(" ")})`, w0.length === 2 && w0[0].includes("|1|") && w0[1].includes("|2|"));

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
		ok("anchor: the fixture pane really inherited TMUX/TMUX_PANE", Boolean(inherited.TMUX && inherited.TMUX_PANE));
		ok("anchor: TMUX names the fixture socket, not the operator's", String(inherited.TMUX).startsWith(SOCKET));

		// ── the rc=0 trap is real, and production refuses it ───────────────────────────
		const bogus = spawnSync("tmux", ["display-message", "-p", "-t", "%999999", "#{pane_id}"], {
			env: inherited,
			encoding: "utf8",
		});
		ok(
			"trap: display-message on a nonexistent pane exits 0 with empty output (rc is not evidence)",
			bogus.status === 0 && (bogus.stdout ?? "").trim() === "",
		);
		const empty = spawnSync("tmux", ["display-message", "-p", "-t", "", "#{pane_id}"], {
			env: inherited,
			encoding: "utf8",
		});
		ok(
			"trap: an EMPTY target exits 0 and answers about some other pane",
			empty.status === 0 && (empty.stdout ?? "").trim().startsWith("%"),
		);

		{
			const outside = { ...inherited };
			delete outside.TMUX;
			delete outside.TMUX_PANE;
			const r = inspectPlacement(outside);
			ok(
				"reject: outside tmux → no-tmux-context (no fallback session)",
				r.ok === false && r.reason === "no-tmux-context",
			);
		}
		{
			const r = inspectPlacement({ ...inherited, TMUX_PANE: "" });
			ok(
				"reject: empty TMUX_PANE → no-tmux-context (never the rc=0 fallback pane)",
				r.ok === false && r.reason === "no-tmux-context",
			);
		}
		{
			// The dangerous one: a pane id with NO TMUX would make a bare tmux resolve to the
			// DEFAULT server — i.e. mutate the operator's live server with a foreign id.
			const noServer = { ...inherited };
			delete noServer.TMUX;
			const r = inspectPlacement(noServer);
			ok(
				"reject: TMUX_PANE without TMUX → no-tmux-context (never falls through to the default server)",
				r.ok === false && r.reason === "no-tmux-context",
			);
		}
		{
			const r = inspectPlacement({ ...inherited, TMUX_PANE: "%1; kill-server" });
			ok(
				"reject: a non-native TMUX_PANE → anchor-malformed, refused before tmux is invoked",
				r.ok === false && r.reason === "anchor-malformed",
			);
		}
		{
			const r = inspectPlacement({ ...inherited, TMUX_PANE: "%999999" });
			ok(
				"reject: a stale pane id → anchor-unresolved despite rc=0",
				r.ok === false && r.reason === "anchor-unresolved",
			);
		}

		// ── inspectPlacement: the caller's own coordinates ─────────────────────────────
		const fixtureServerPid = fxLines("display-message", "-p", "#{pid}")[0];
		const fixtureSessionId = fxLines("display-message", "-p", "-t", `${SESSION}:1`, "#{session_id}")[0];
		const got = inspectPlacement(inherited);
		assert.ok(got.ok, "inspectPlacement must resolve inside the fixture");
		const placement = got.placement;
		ok("inspect: server pid is the FIXTURE server, not the operator's", placement.serverPid === fixtureServerPid);
		ok("inspect: session id matches the fixture session", placement.sessionId === fixtureSessionId);
		ok("inspect: pane id echoes the inherited anchor", placement.paneId === inherited.TMUX_PANE);
		ok("inspect: pane pid matches tmux's own view", placement.panePid === callerPanePid);
		ok(
			"inspect: window index is the human 1, id is @-stable",
			placement.windowIndex === "1" && placement.windowId.startsWith("@"),
		);

		const originalPanes = panes();
		const activeBefore = windows().find((w) => w.endsWith("|1"));

		// ── appendWindow ×2 ───────────────────────────────────────────────────────────
		const w3 = appendWindow(placement, inherited);
		ok(`append#1: 1,2,3 (${windows().join(" ")})`, windows().length === 3);
		ok("append#1: stable handles", w3.windowId.startsWith("@") && w3.paneId.startsWith("%"));
		ok("append#1: landed at the END (index 3)", w3.windowIndex === "3");
		ok("append#1: still exactly one session", sessionCount() === 1);
		ok("append#1: focus unchanged", windows().find((w) => w.endsWith("|1")) === activeBefore);

		const w4 = appendWindow(placement, inherited);
		ok(`append#2: 1,2,3,4 (${windows().join(" ")})`, windows().length === 4);
		ok("append#2: landed at the END (index 4)", w4.windowIndex === "4");
		ok("append#2: a distinct window", w4.windowId !== w3.windowId && w4.paneId !== w3.paneId);
		ok("append#2: still exactly one session", sessionCount() === 1);
		ok("append#2: focus unchanged", windows().find((w) => w.endsWith("|1")) === activeBefore);
		ok(
			"append: original windows and their pane pids untouched",
			originalPanes.every((p) => panes().includes(p)),
		);

		// ── the handle is bound to the context it was born in ─────────────────────────
		// A `$N`/`@N` on a DIFFERENT (or restarted) server names something else entirely, so
		// both mutations re-read the caller's placement and refuse on a mismatch — before
		// touching anything.
		assert.throws(
			() => appendWindow({ ...placement, serverPid: "999999" }, inherited),
			/context changed/,
			"appendWindow must refuse a placement from another server",
		);
		assert.throws(
			() => appendWindow({ ...placement, sessionId: "$999" }, inherited),
			/context changed/,
			"appendWindow must refuse a placement from another session",
		);
		assert.throws(
			() => closeWindow({ ...w4, serverPid: "999999" }, inherited),
			/context changed/,
			"closeWindow must refuse a handle from another server",
		);
		ok("binding: append/close refuse a foreign server or session before mutating", windows().length === 4);
		ok(
			"binding: the handle carries the server pid and session id it was born in",
			w4.serverPid === fixtureServerPid && w4.sessionId === fixtureSessionId,
		);

		// ── closeWindow on a LIVE window → closed ─────────────────────────────────────
		ok("close: a live window reports closed", closeWindow(w4, inherited) === "closed");
		ok(`close: back to 1,2,3 (${windows().join(" ")})`, windows().length === 3);
		ok(
			"close: the closed window id is gone",
			!windows().some((w) => w.startsWith(`${w3.windowId === w4.windowId ? "" : w4.windowId}|`)),
		);

		// ── natural exit → the window vanishes on its own → already-gone ──────────────
		// remain-on-exit is off, so ending the pane process removes the window through a path
		// this module never called. An interactive shell ignores SIGTERM; SIGHUP is what ends
		// it (measured in T0-a), so the fixture uses HUP rather than pretending TERM worked.
		process.kill(Number(w3.panePid), "SIGHUP");
		const deadline = Date.now() + 5000;
		while (windows().some((w) => w.startsWith(`${w3.windowId}|`)) && Date.now() < deadline) {
			spawnSync("sleep", ["0.1"]);
		}
		ok(
			"natural exit: the window disappeared without closeWindow",
			!windows().some((w) => w.startsWith(`${w3.windowId}|`)),
		);
		ok(
			"close: an already-vanished window reports already-gone, not a silent success",
			closeWindow(w3, inherited) === "already-gone",
		);

		// ── restored ─────────────────────────────────────────────────────────────────
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
	}

	ok("cleanup: the fixture socket is gone", !fs.existsSync(SOCKET));
	ok("cleanup: the fixture server is unreachable", fx("list-sessions").status !== 0);

	const after = operatorSnapshot();
	ok("isolation: the operator's server is byte-identical before and after", before === after);

	console.log(`\n${LABEL}: ${passed} checks passed`);
}

main();
