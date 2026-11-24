/**
 * resume-picker-production — the bookmark reader and the terminal test of `entwurf resume` (#173 C3),
 * proven beside the module. The fact listing is `peer-facts`' assembly and is held by reading the
 * source, not by standing up a store here.
 *
 * Each claim is its own test title, because `run_vitest` attributes a mutant kill from the failed
 * TEST TITLE:
 *
 *   RESUMEPINS-ONE-FILE-TWO-FIELDS   exactly `<typed-in directory>/team.json`, read for garden_id
 *                                    and name only; an absent file is no bookmarks
 *   RESUMEPINS-BROKEN-IS-LOUD        a bookmark file that is there and cannot be understood is a
 *                                    named error, never a quiet empty list
 *   RESUMEPICK-TERMINAL-BOTH-ENDS    a list needs a terminal on stdin AND stderr
 *   RESUMELIST-PROVIDER-AS-PEER-FACTS the listing is the fact provider's, assembled as peer-facts
 *                                    assembles it, with no observation budget and no second join
 *   RESUMELIST-UNREADABLE-IS-ERROR   a record the provider could not read is a named error, never
 *                                    a shorter list; every other diagnostic is not a failure
 *   RESUMEPICK-STDIN-UTF8-STREAM     input is decoded as a UTF-8 stream, so a Korean character
 *                                    split between two reads arrives whole
 *   RESUMEPICK-TERMINAL-FAILURES     a closed or failed stdin, a failed stderr and a write that
 *                                    fails afterwards all reach the picker as errors; SIGINT is among
 *                                    the signals; stopping detaches every reporting listener
 *   RESUMEPICK-DEAD-SINK-NO-UNHANDLED a write failure that a real stream reports twice — to the
 *                                    write's callback, then as an `error` event — restores once and
 *                                    ends the command with exit 7, and a hand-off listener is on
 *                                    the stream when the reporting one is gone. What this checks is
 *                                    the real callback/event timing and that listener's presence;
 *                                    the test's own recording listener also handles the event, so
 *                                    its zero-uncaught count is not what would catch a regression
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EntwurfFactsResult } from "./entwurf-fact-provider.ts";
import type { PeerFact } from "./entwurf-facts.ts";
import { RESUME_CLI_EXIT, runResumeCli } from "./resume-cli.ts";
import { runResumePicker } from "./resume-picker.ts";
import {
	type PickerProcess,
	processPickerIo,
	RESUME_BOOKMARK_FILE,
	ResumeBookmarkError,
	ResumeListingError,
	readResumePins,
	resumeFactsOf,
	resumePickerHasTerminal,
} from "./resume-picker-production.ts";

// The label is the contract, so it travels as expect's message.
function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const CWD = "/work/project";
const FILE = "/work/project/team.json";

/** A file reader that records what it was asked for. */
function reader(content: string | null | Error): { read: (file: string) => string | null; asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		read: (file) => {
			asked.push(file);
			if (content instanceof Error) throw content;
			return content;
		},
	};
}

const thrown = (run: () => unknown): Error | null => {
	try {
		run();
		return null;
	} catch (err) {
		return err as Error;
	}
};

describe("the entwurf resume bookmark file and terminal", () => {
	it("[QK:RESUMEPINS-ONE-FILE-TWO-FIELDS] the bookmark file is exactly team.json in the directory the command was typed in — one path, no parent and no default — and only garden_id and name are taken from a member: the native id a bookmark carries goes stale and is never read", () => {
		const full = reader(
			JSON.stringify({
				version: 1,
				cwd: "/somewhere/else/entirely",
				members: [
					{
						name: "운영코디",
						role: "coordinating sibling",
						backend: "pi-durable",
						garden_id: "20261014T212756-68bd94",
						native_session_id: "stale-native-id",
					},
					{ name: "Sibling", garden_id: "20261113T043350-ff08d4" },
				],
			}),
		);
		const pins = readResumePins(CWD, full.read);
		const absent = reader(null);
		ok(
			"one path asked for, two fields kept in file order, and an absent file is an empty list",
			RESUME_BOOKMARK_FILE === "team.json" &&
				JSON.stringify(full.asked) === JSON.stringify([FILE]) &&
				JSON.stringify(pins) ===
					JSON.stringify([
						{ gardenId: "20261014T212756-68bd94", name: "운영코디" },
						{ gardenId: "20261113T043350-ff08d4", name: "Sibling" },
					]) &&
				JSON.stringify(readResumePins(CWD, absent.read)) === "[]" &&
				JSON.stringify(absent.asked) === JSON.stringify([FILE]),
		);
	});

	it("[QK:RESUMEPINS-BROKEN-IS-LOUD] a bookmark file that exists and cannot be understood — unreadable, not JSON, no members array, a member without a garden id or a name — is an error naming the file and the cause, never an empty list that would hide every bookmark", () => {
		const cases: [string | Error, string][] = [
			[new Error("EACCES: permission denied"), "EACCES: permission denied"],
			["{ not json", "not JSON"],
			["[]", '"members" must be an array'],
			[JSON.stringify({ members: "all of them" }), '"members" must be an array'],
			[JSON.stringify({ members: [{ name: "No id" }] }), "members[0].garden_id must be a non-empty string"],
			[
				JSON.stringify({ members: [{ name: "Ok", garden_id: "20261014T212756-68bd94" }, { garden_id: "x" }] }),
				"members[1].name must be a non-empty string",
			],
			[JSON.stringify({ members: [null] }), "members[0].garden_id must be a non-empty string"],
		];
		const errors = cases.map(([content]) => thrown(() => readResumePins(CWD, reader(content).read)));
		ok(
			"every broken shape throws the named error with its file and cause",
			errors.every(
				(err, i) =>
					err instanceof ResumeBookmarkError &&
					err.file === FILE &&
					err.message.startsWith(`${FILE} is not a readable bookmark file: `) &&
					err.message.includes(cases[i]?.[1] ?? "\u0000"),
			),
		);
	});

	it("[QK:RESUMEPICK-TERMINAL-BOTH-ENDS] a list needs a terminal on stdin AND on stderr: keys are read from one and the list is drawn on the other, so a piped stdin or a redirected stderr is not a place to show it", () => {
		ok(
			"both, and only both",
			resumePickerHasTerminal({ isTTY: true }, { isTTY: true }) &&
				!resumePickerHasTerminal({ isTTY: false }, { isTTY: true }) &&
				!resumePickerHasTerminal({ isTTY: true }, { isTTY: false }) &&
				!resumePickerHasTerminal({}, { isTTY: true }) &&
				!resumePickerHasTerminal({ isTTY: true }, {}),
		);
	});

	it("[QK:RESUMELIST-PROVIDER-AS-PEER-FACTS] the listing is the fact provider's own, assembled the way peer-facts assembles it — the store's entries with their kind, the store's record reader, the control-socket directory — with no observation budget, no placement reader of its own and no filtering before it is returned", () => {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const src = fs.readFileSync(path.join(here, "resume-picker-production.ts"), "utf8");
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		const body = (code.split("export async function listResumeFacts")[1] ?? "").split("\n}\n")[0] ?? "";
		const peerFacts = fs.readFileSync(path.join(here, "..", "..", "scripts", "peer-facts.ts"), "utf8");
		ok(
			"one provider call with peer-facts' three deps and the presentation selector, nothing more",
			/const result = await listEntwurfFacts\(\{/.test(body) &&
				/metaEntries: readActiveStoreEntries\(storeDir\),/.test(body) &&
				/readRecord: makeStoreRecordReader\(storeDir\),/.test(body) &&
				/socket: \{ dir: env\.ENTWURF_DIR \?\? defaultControlSocketDir\(os\.homedir\(\)\) \},/.test(body) &&
				// #173 P2: the one addition is the presentation selector, bookmarks and the seven-day
				// window handed to it; the rows come back as the provider gave them.
				/presentation: makePeerPresentationSelector\(\{/.test(body) &&
				/pinnedIds: new Set\(pins\.map\(\(pin\) => pin\.gardenId\)\),/.test(body) &&
				/observeWithinMs: RECENT_WINDOW_MS,/.test(body) &&
				/return \{ facts: resumeFactsOf\(storeDir, result\), presentation: result\.presentation \?\? null \};/.test(
					body,
				) &&
				!/observationLimit|readPlacementIndex|observe:|\.filter\(|\.sort\(/.test(body) &&
				/readRecord: makeStoreRecordReader\(storeDir\),/.test(peerFacts) &&
				/process\.env\.ENTWURF_DIR \?\? defaultControlSocketDir\(os\.homedir\(\)\)/.test(peerFacts),
		);
	});

	it("[QK:RESUMELIST-UNREADABLE-IS-ERROR] a record the provider met and could not read is a named error naming the store, the count and the first file — never a list that is merely shorter, which for a store nobody can read is an empty list the operator cancels out of; a diagnostic about something that was never a row is not a failure", () => {
		const peer = { gardenId: "20261101T000000-aaaaaa" } as PeerFact;
		const withDiagnostics = (diagnostics: EntwurfFactsResult["diagnostics"]): EntwurfFactsResult => ({
			facts: { peers: [peer], recordLessSockets: [] },
			diagnostics,
		});
		const benign = withDiagnostics([
			{ kind: "record-less-socket", gardenId: "20261101T000001-bbbbbb", liveness: "dead", message: "stale" },
			{ kind: "malformed-socket-name", name: "x.sock", message: "bad" },
			{ kind: "socket-dir-read-error", message: "EACCES" },
		]);
		const unreadable = withDiagnostics([
			{ kind: "record-less-socket", gardenId: "20261101T000001-bbbbbb", liveness: "dead", message: "stale" },
			{ kind: "meta-record-read-error", filename: "a.meta.json", message: "EACCES: permission denied" },
			{ kind: "meta-record-read-error", filename: "b.meta.json", message: "not V3" },
		]);
		const err = thrown(() => resumeFactsOf("/store", unreadable));
		ok(
			"rows as given without a read error; with one, a throw that says what and where",
			resumeFactsOf("/store", withDiagnostics([]))[0] === peer &&
				resumeFactsOf("/store", benign)[0] === peer &&
				err instanceof ResumeListingError &&
				err.message ===
					"2 records under /store could not be read (meta-record-read-error), so the list would be missing citizens — first: a.meta.json: EACCES: permission denied",
		);
	});
});

/** A stand-in for the process: emitters the test drives, and a record of what was done to them. */
function fakeProcess() {
	const log: string[] = [];
	const stdin = Object.assign(new EventEmitter(), {
		setRawMode: (on: boolean) => log.push(`raw:${on}`),
		resume: () => log.push("resume"),
		pause: () => log.push("pause"),
	});
	let writeError: Error | null = null;
	const stderr = Object.assign(new EventEmitter(), {
		columns: 90,
		rows: 30,
		write: (text: string, cb?: (err?: Error | null) => void) => {
			log.push(`write:${text.length}`);
			cb?.(writeError);
			return true;
		},
	});
	const signals = new EventEmitter();
	const proc = {
		stdin,
		stderr,
		pid: 4242,
		on: (signal: string, handler: () => void) => signals.on(signal, handler),
		off: (signal: string, handler: () => void) => signals.off(signal, handler),
		kill: (pid: number, signal: string) => log.push(`kill:${pid}:${signal}`),
	} as unknown as PickerProcess;
	return {
		proc,
		log,
		stdin,
		stderr,
		signals,
		failWrites: (err: Error) => {
			writeError = err;
		},
		listeners: (): number =>
			["data", "end", "error"].reduce((n, e) => n + stdin.listenerCount(e), 0) +
			["resize", "error"].reduce((n, e) => n + stderr.listenerCount(e), 0) +
			["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"].reduce((n, e) => n + signals.listenerCount(e), 0),
	};
}

describe("the entwurf resume picker's real terminal wiring", () => {
	it("[QK:RESUMEPICK-STDIN-UTF8-STREAM] input is decoded as a UTF-8 stream: a Korean character is three bytes, and when a read ends between them the character arrives whole with the next read instead of as replacement characters", () => {
		const f = fakeProcess();
		const io = processPickerIo(f.proc);
		const got: string[] = [];
		const stop = io.onInput((chunk) => got.push(chunk));
		const bytes = Buffer.from("운영", "utf8");
		f.stdin.emit("data", bytes.subarray(0, 2));
		f.stdin.emit("data", bytes.subarray(2, 4));
		f.stdin.emit("data", bytes.subarray(4));
		f.stdin.emit("data", Buffer.from("a"));
		stop();
		ok(
			"whole characters only, nothing emitted for a read that completes none, and stdin paused on stop",
			JSON.stringify(got) === JSON.stringify(["운", "영", "a"]) &&
				!got.join("").includes("\ufffd") &&
				f.log.includes("resume") &&
				f.log[f.log.length - 1] === "pause" &&
				f.stdin.listenerCount("data") === 0,
		);
	});

	it("[QK:RESUMEPICK-TERMINAL-FAILURES] everything that means the terminal is no longer usable reaches the picker as an error — stdin ending, stdin failing, stderr failing, and a write whose failure is reported afterwards — SIGINT sent from outside is among the signals it hears, a signal is passed on to this process, and stopping detaches every listener", () => {
		const f = fakeProcess();
		const io = processPickerIo(f.proc);
		const errors: string[] = [];
		const heard: string[] = [];
		const order: string[] = [];
		const stops = [
			io.onError((err) => errors.push(err.message)),
			io.onSignal((signal) => heard.push(signal)),
			io.onResize(() => order.push("resize")),
			io.onInput(() => {}),
		];
		const attached = f.listeners();
		f.stdin.emit("end");
		f.stdin.emit("error", new Error("EIO"));
		f.stderr.emit("error", new Error("EPIPE"));
		io.write("ok");
		f.failWrites(new Error("EAGAIN"));
		io.write("lost");
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) f.signals.emit(signal);
		f.stderr.emit("resize");
		io.afterFlush(() => order.push("flushed"));
		io.reraise("SIGINT");
		const size = io.size();
		for (const stop of stops) stop();
		ok(
			"four kinds of failure reported, four signals heard, the re-raise aimed at this pid, and nothing left attached",
			JSON.stringify(errors) ===
				JSON.stringify([
					"the terminal's input closed (end of input on stdin)",
					"reading the terminal failed: EIO",
					"writing the terminal failed: EPIPE",
					"writing the terminal failed: EAGAIN",
				]) &&
				JSON.stringify(heard) === JSON.stringify(["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) &&
				JSON.stringify(order) === JSON.stringify(["resize", "flushed"]) &&
				f.log.includes("kill:4242:SIGINT") &&
				size.columns === 90 &&
				size.rows === 30 &&
				attached === 9 &&
				// Every REPORTING listener is gone; what stays on the two streams is the one that swallows
				// a failure's late echo (held by RESUMEPICK-DEAD-SINK-NO-UNHANDLED).
				f.listeners() === 2 &&
				f.stdin.listenerCount("data") + f.stdin.listenerCount("end") + f.stderr.listenerCount("resize") === 0,
		);
	});

	it("[QK:RESUMEPICK-DEAD-SINK-NO-UNHANDLED] when the terminal's output dies mid-list, a real Node stream reports that one failure twice — to the write's callback and then as an `error` event after the picker has already restored and detached — and the command still ends once, with exit 7 and raw mode switched off once, with a hand-off error listener left on each stream where the reporting one was; the error's text is not promised, because the place it would be printed is what died", async () => {
		const f = fakeProcess();
		// A REAL Writable, so the callback-then-event order is Node's own. Writes 0–2 (screen on, paste
		// on, first paint) succeed; every write from the repaint after a key onwards fails.
		let writes = 0;
		const emitted: string[] = [];
		const sink = Object.assign(
			new Writable({
				write(_chunk, _encoding, callback) {
					callback(writes++ >= 3 ? new Error("synthetic") : null);
				},
			}),
			{ columns: 100, rows: 20 },
		);
		// This recording listener handles the event too, so `uncaught` below stays empty with or without
		// the hand-off listener. The assertion that tells them apart is the listener COUNT at the end.
		sink.prependListener("error", (err) => emitted.push(err.message));
		const proc = { ...f.proc, stderr: sink } as unknown as PickerProcess;
		const uncaught: string[] = [];
		const onUncaught = (err: Error): void => {
			uncaught.push(err.message);
		};
		process.on("uncaughtException", onUncaught);
		const fact = {
			gardenId: "20261101T000000-aaaaaa",
			backend: "pi",
			nativeSessionId: "n",
			cwd: "/work/project",
			model: null,
			createdAt: "",
			recordUpdatedAt: "2026-11-01T00:00:00.000Z",
			liveness: "dead",
			receiver: "n/a",
			transcript: "exists",
			placement: { kind: "unobserved" },
		} as unknown as PeerFact;
		let leafCalls = 0;
		const outcomePromise = runResumeCli([], {
			env: { TMUX: "/tmp/tmux-1000/default,1,0", TMUX_PANE: "%1" },
			resume: async () => {
				leafCalls += 1;
				throw new Error("the leaf must not be reached");
			},
			list: {
				hasTerminal: true,
				callerCwd: "/work/project",
				listFacts: async () => ({ facts: [fact], presentation: null }),
				readPins: () => [],
				pick: (listing, rail) => runResumePicker(listing, rail, processPickerIo(proc)),
			},
		});
		// Let the list start and paint, then press a key: its repaint is the write that fails.
		await new Promise((resolve) => setImmediate(resolve));
		f.stdin.emit("data", Buffer.from("x"));
		const outcome = await outcomePromise;
		// Give the stream's own late `error` event, and anything it could have provoked, time to land.
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
		process.off("uncaughtException", onUncaught);
		ok(
			"exit 7 once, the leaf never reached, raw mode off once, the stream really emitted, and the hand-off listener is in place",
			outcome.exitCode === RESUME_CLI_EXIT.listFailed &&
				outcome.stdout === "" &&
				outcome.stderr.includes("the list could not be shown: writing the terminal failed: synthetic") &&
				leafCalls === 0 &&
				f.log.filter((l) => l === "raw:true").length === 1 &&
				f.log.filter((l) => l === "raw:false").length === 1 &&
				emitted.length >= 1 &&
				emitted.every((message) => message === "synthetic" || message.includes("destroyed")) &&
				uncaught.length === 0 &&
				sink.listenerCount("error") === 2 &&
				f.stdin.listenerCount("error") === 1,
		);
	});
});
