/**
 * build-progress — the few named lines an operator sees while `herdr plugin install` is
 * silently working (#116 M3-b3 F).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `console.log`. Herdr runs `[[build]]` with BOTH streams
 * piped into a tail-capped buffer and, on success, drops that buffer on the floor
 * (`src/cli/plugin.rs:1328-1373` @ c77af189: `stdout(Stdio::piped())`, `stderr(Stdio::piped())`,
 * then `if status.success() { return Ok(()) }`). So every line this build already wrote was
 * invisible unless it failed. `[관측: 오퍼레이터, 날것 PC, herdr 0.9.1, 2026-09-17]` after the
 * install prompt the terminal sits with no output at all for minutes — long enough to read as a
 * hang — because the long step is a full `npm pack` of a git spec.
 *
 * WHAT IT WRITES ON, AND WHY THAT IS NOT A BACK DOOR. Herdr replaces our stdio, not our
 * controlling terminal, so `/dev/tty` still reaches the human who typed the command.
 * `[측정 2026-09-17]` with a child spawned exactly as herdr spawns it — stdin null, stdout and
 * stderr piped — a write to `/dev/tty` appears on the terminal immediately and appears in
 * NEITHER captured buffer. That is the whole trick, and it is bounded by what it may carry:
 * short, named, human sentences about which step we are on. No subprocess output, no data any
 * caller parses, nothing another program is expected to read. When `/dev/tty` cannot be opened
 * — CI, a pipe, a daemon — the reporter is silently inert, because a build that fails for want
 * of a terminal would be this feature breaking the thing it was added to explain.
 *
 * EVERY LINE IS ALSO MIRRORED TO STDERR. That costs nothing on success (herdr drops it) and on
 * FAILURE it is the trail: herdr prints the captured stderr, so the operator's error report now
 * arrives with the steps that completed in front of it.
 */

import fs from "node:fs";

/** The steps of a full activation build. An early exit simply stops counting. */
export const PROGRESS_TOTAL = 5;

/** One line, one step. The shape is fixed so it reads as a sequence and not as log spray. */
export function formatProgressLine(step, total, text) {
	return `[entwurf ${step}/${total}] ${text}\n`;
}

/** The closing line. It carries no step number because it is the end of the sequence. */
export function formatDoneLine(text) {
	return `[entwurf done] ${text}\n`;
}

/**
 * A reporter bound to the operator's terminal, or an inert one when there is no terminal.
 *
 * @returns frozen `{step, done, close, live}` — `live` is a FACT about this host (did we get a
 *          terminal), never a promise that the operator read anything.
 */
export function createProgressReporter({
	total = PROGRESS_TOTAL,
	openTty = () => fs.openSync("/dev/tty", "a"),
	writeTty = fs.writeSync,
	closeTty = fs.closeSync,
	mirror = (line) => process.stderr.write(line),
} = {}) {
	let fd = null;
	try {
		fd = openTty();
	} catch {
		// Bounded environment probe (AGENTS.md Hard Rule 15): no controlling terminal is an
		// ordinary state of this build, not a defect, and it changes nothing about the install.
		fd = null;
	}
	let emitted = 0;

	const emit = (line) => {
		if (fd !== null) {
			try {
				writeTty(fd, line);
			} catch {
				// The terminal went away mid-build (operator closed the pane). The install is not
				// the terminal's, so we stop trying to narrate and carry on.
				fd = null;
			}
		}
		mirror(line);
	};

	return Object.freeze({
		live: fd !== null,
		step(text) {
			emitted += 1;
			emit(formatProgressLine(emitted, total, text));
		},
		done(text) {
			emit(formatDoneLine(text));
		},
		close() {
			if (fd === null) return;
			try {
				closeTty(fd);
			} catch {
				// Same bounded probe: a descriptor we could not close is not a failed install.
			}
			fd = null;
		},
	});
}

/** The inert reporter, written out rather than implied — used where there is nothing to narrate. */
export function silentProgressReporter() {
	return Object.freeze({ live: false, step() {}, done() {}, close() {} });
}
