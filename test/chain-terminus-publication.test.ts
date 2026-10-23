import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { awaitTerminusPublication, type TerminusPublicationIo } from "../scripts/lib/chain-terminus-publication.ts";

/**
 * The terminus wait of smoke-entwurf-chain-live, driven through the publication states that
 * enqueueMetaMessage produces: the `.msg` body first, `inbox.signal` last. Time is virtual — `sleep`
 * advances a counter and `now` reads it — so no cell depends on a wall-clock delay.
 */

const BOX = "/box";
const POLL = 250;
const DEADLINE = 1000; // four looks at t = 0, 250, 500, 750

interface Look {
	files: string[];
	signal: boolean;
}

/** Fake io that serves `looks` in order (the last one repeats) and counts how often it was asked. */
function scripted(looks: Look[]): { io: TerminusPublicationIo; seen: () => number } {
	let clock = 0;
	let n = 0;
	const current = () => looks[Math.min(n, looks.length - 1)] as Look;
	return {
		io: {
			readdir: async (dir) => {
				expect(dir).toBe(BOX);
				return [...current().files];
			},
			exists: (file) => {
				expect(file).toBe(path.join(BOX, "inbox.signal"));
				const s = current().signal;
				n++;
				return s;
			},
			sleep: async (ms) => {
				clock += ms;
			},
			now: () => clock,
		},
		seen: () => n,
	};
}

describe("chain terminus publication wait", () => {
	it("[QK:CHAIN-TERMINUS-WAITS-FOR-SIGNAL] a body seen before its doorbell is still in flight: the wait continues to the next look and returns the body with the signal", async () => {
		const { io, seen } = scripted([
			{ files: ["a.msg"], signal: false },
			{ files: ["a.msg"], signal: true },
		]);
		const got = await awaitTerminusPublication(BOX, DEADLINE, POLL, io);
		expect({ ...got, looks: seen() }).toEqual({ msgs: ["a.msg"], signalled: true, looks: 2 });
	});

	describe("readiness is body-present AND signal-present (each observed pair, constant across looks)", () => {
		it("body present, signal present → ready at the first look", async () => {
			const { io, seen } = scripted([{ files: ["a.msg"], signal: true }]);
			const got = await awaitTerminusPublication(BOX, DEADLINE, POLL, io);
			expect({ ...got, looks: seen() }).toEqual({ msgs: ["a.msg"], signalled: true, looks: 1 });
		});

		it("body present, signal absent → not ready; returned unsignalled at the deadline", async () => {
			const { io, seen } = scripted([{ files: ["a.msg"], signal: false }]);
			const got = await awaitTerminusPublication(BOX, DEADLINE, POLL, io);
			expect({ ...got, looks: seen() }).toEqual({ msgs: ["a.msg"], signalled: false, looks: 4 });
		});

		it("body absent, signal present → not ready; returned empty but signalled at the deadline", async () => {
			// Observable when publication finishes between the readdir and the exists of one look.
			const { io, seen } = scripted([{ files: [], signal: true }]);
			const got = await awaitTerminusPublication(BOX, DEADLINE, POLL, io);
			expect({ ...got, looks: seen() }).toEqual({ msgs: [], signalled: true, looks: 4 });
		});

		it("body absent, signal absent → not ready; returned empty at the deadline, and other files are not bodies", async () => {
			const { io, seen } = scripted([{ files: ["mailbox.state.json"], signal: false }]);
			const got = await awaitTerminusPublication(BOX, DEADLINE, POLL, io);
			expect({ ...got, looks: seen() }).toEqual({ msgs: [], signalled: false, looks: 4 });
		});
	});

	it("duplicate bodies are all returned, so the smoke's exactly-one assert still sees them", async () => {
		const { io } = scripted([{ files: ["a.msg", "b.msg.delivered", "inbox.signal"], signal: true }]);
		const got = await awaitTerminusPublication(BOX, DEADLINE, POLL, io);
		expect(got).toEqual({ msgs: ["a.msg", "b.msg.delivered"], signalled: true });
	});

	describe("on a real directory (virtual time)", () => {
		let dir = "";
		beforeEach(() => {
			dir = mkdtempSync(path.join(os.tmpdir(), "entwurf-chain-terminus-"));
		});
		afterEach(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		/** Real readdir/exists over `dir`; `sleep` advances virtual time and runs `onSleep` once per call. */
		function realFsIo(onSleep: (call: number) => void): TerminusPublicationIo {
			let clock = 0;
			let calls = 0;
			return {
				readdir: (d) => fsp.readdir(d),
				exists: (f) => existsSync(f),
				sleep: async (ms) => {
					calls++;
					onSleep(calls);
					clock += ms;
				},
				now: () => clock,
			};
		}

		it("a .msg written before inbox.signal is not complete until the signal file exists", async () => {
			writeFileSync(path.join(dir, "x.msg"), "body");
			const io = realFsIo((call) => {
				if (call === 1) writeFileSync(path.join(dir, "inbox.signal"), "t\n");
			});
			const got = await awaitTerminusPublication(dir, DEADLINE, POLL, io);
			expect(got).toEqual({ msgs: ["x.msg"], signalled: true });
		});

		it("a .msg with no inbox.signal stays incomplete through the deadline", async () => {
			writeFileSync(path.join(dir, "x.msg"), "body");
			const got = await awaitTerminusPublication(
				dir,
				DEADLINE,
				POLL,
				realFsIo(() => {}),
			);
			expect(got).toEqual({ msgs: ["x.msg"], signalled: false });
		});
	});
});
