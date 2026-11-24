/**
 * resume-picker-production — the three real things the `entwurf resume` list is wired to (#173 C3):
 * the fact listing, the bookmark file and the terminal. Kept apart from `resume-cli.ts` so that
 * module still reads no store and touches no terminal, and from `resume-picker.ts` so the picker
 * still runs in a test with neither.
 *
 * THE LISTING IS peer-facts' LISTING. Same provider (`listEntwurfFacts`), same deps assembled the
 * same way `scripts/peer-facts.ts` assembles them: the active store entries with their kind, the
 * store's own record reader, and the control-socket directory `ENTWURF_DIR` selects. The join is
 * not re-implemented and the provider is not narrowed; this module returns its rows as given.
 * Observation is unbounded for the reason it is there: a rationed row would say `unobserved`, and a
 * person choosing whom to reopen cannot tell that from "nobody could look".
 *
 * A RECORD THAT COULD NOT BE READ IS NOT A SHORTER LIST. The provider reports such a record as a
 * `meta-record-read-error` diagnostic and leaves it out of the rows. peer-facts prints that
 * diagnostic beside its rows; a list has nowhere to put it, and a store nobody could read would
 * then be an empty list the operator cancels out of. So any such diagnostic is an error here, by
 * name. Every other diagnostic (a socket no record claims, a malformed socket name, …) concerns
 * something that was never a row and is not a failure of the listing.
 *
 * THE BOOKMARK FILE is exactly `<the directory the command was typed in>/team.json` — no walk up
 * to a parent, no home-directory default, no environment variable. It is read once, read-only, for
 * two fields of each member: `garden_id` and `name`. The `native_session_id` a bookmark may carry is
 * not read: it goes stale when a citizen moves to a new chapter, and the record is the only place a
 * native id is true. An absent file is no bookmarks. A file that is there and cannot be understood
 * is an ERROR naming the file, never a quiet "no bookmarks" (Hard Rule 15) — the direct form
 * `entwurf resume <garden-id>` reads no bookmark and is unaffected.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { defaultControlSocketDir } from "./control-socket-path.js";
import { type EntwurfFactsResult, listEntwurfFacts } from "./entwurf-fact-provider.ts";
import type { PeerFact } from "./entwurf-facts.ts";
import { defaultMetaSessionsDir, makeStoreRecordReader, readActiveStoreEntries } from "./meta-session.ts";
import type { PickerIo } from "./resume-picker.ts";
import type { ResumePin } from "./resume-picker-rows.ts";

export class ResumeListingError extends Error {
	constructor(storeDir: string, unreadable: readonly { filename: string; message: string }[]) {
		const first = unreadable[0];
		super(
			`${unreadable.length} record${unreadable.length === 1 ? "" : "s"} under ${storeDir} could not be read ` +
				`(meta-record-read-error), so the list would be missing citizens` +
				(first === undefined ? "" : ` — first: ${first.filename}: ${first.message}`),
		);
		this.name = "ResumeListingError";
	}
}

/** The provider's rows, or a throw when a record it met could not be read. Split from the read so
 * the rule is testable on a provider result with no store behind it. */
export function resumeFactsOf(storeDir: string, result: EntwurfFactsResult): PeerFact[] {
	const unreadable = result.diagnostics.filter((d) => d.kind === "meta-record-read-error");
	if (unreadable.length > 0) throw new ResumeListingError(storeDir, unreadable);
	return result.facts.peers;
}

/** Every citizen the fact provider lists on this host, in provider order. Throws when the store
 * cannot be read: an unreadable host must never look like an empty one. */
export async function listResumeFacts(env: NodeJS.ProcessEnv = process.env): Promise<PeerFact[]> {
	const storeDir = defaultMetaSessionsDir();
	const result = await listEntwurfFacts({
		metaEntries: readActiveStoreEntries(storeDir),
		readRecord: makeStoreRecordReader(storeDir),
		socket: { dir: env.ENTWURF_DIR ?? defaultControlSocketDir(os.homedir()) },
	});
	return resumeFactsOf(storeDir, result);
}

export const RESUME_BOOKMARK_FILE = "team.json";

export class ResumeBookmarkError extends Error {
	readonly file: string;
	constructor(file: string, detail: string) {
		super(`${file} is not a readable bookmark file: ${detail}`);
		this.name = "ResumeBookmarkError";
		this.file = file;
	}
}

/**
 * The bookmarks of `callerCwd`, in file order. `readFile` is the seam: it returns the bytes, or
 * `null` when there is no such file, and throws on anything else.
 */
export function readResumePins(
	callerCwd: string,
	readFile: (file: string) => string | null = readFileOrNull,
): ResumePin[] {
	const file = path.join(callerCwd, RESUME_BOOKMARK_FILE);
	let raw: string | null;
	try {
		raw = readFile(file);
	} catch (err) {
		throw new ResumeBookmarkError(file, err instanceof Error ? err.message : String(err));
	}
	if (raw === null) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new ResumeBookmarkError(file, `not JSON (${err instanceof Error ? err.message : String(err)})`);
	}
	const members = typeof parsed === "object" && parsed !== null ? (parsed as { members?: unknown }).members : undefined;
	if (!Array.isArray(members)) throw new ResumeBookmarkError(file, `"members" must be an array`);
	return members.map((member, index) => {
		const m = typeof member === "object" && member !== null ? (member as Record<string, unknown>) : {};
		const gardenId = m.garden_id;
		const name = m.name;
		if (typeof gardenId !== "string" || gardenId.length === 0) {
			throw new ResumeBookmarkError(file, `members[${index}].garden_id must be a non-empty string`);
		}
		if (typeof name !== "string" || name.length === 0) {
			throw new ResumeBookmarkError(file, `members[${index}].name must be a non-empty string`);
		}
		return { gardenId, name };
	});
}

function readFileOrNull(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/** Can a list be drawn and keys be read here? Both ends must be a terminal: keys come from stdin,
 * and the list is drawn on stderr so stdout stays the receipt's alone. */
export function resumePickerHasTerminal(
	stdin: { isTTY?: boolean } = process.stdin,
	stderr: { isTTY?: boolean } = process.stderr,
): boolean {
	return stdin.isTTY === true && stderr.isTTY === true;
}

/** Signals that end the list. SIGINT is here for one sent from outside (`kill -INT`): in raw mode
 * Ctrl-C is a byte the picker reads, not a signal. */
const TERMINATING_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];

/** The parts of the process a picker terminal is made of. Production is `process`; a test passes
 * emitters it can drive. */
export interface PickerProcess {
	stdin: NodeJS.ReadStream;
	stderr: NodeJS.WriteStream;
	on(signal: NodeJS.Signals, handler: () => void): unknown;
	off(signal: NodeJS.Signals, handler: () => void): unknown;
	kill(pid: number, signal: NodeJS.Signals): unknown;
	pid: number;
}

/**
 * The real terminal: keys from stdin, the list on stderr, size from stderr.
 *
 * Input is decoded as a UTF-8 STREAM: a Korean character is three bytes and a read may end between
 * them, so decoding each read on its own would turn a typed search word into replacement characters.
 *
 * Everything that means "this terminal is no longer usable" reaches the picker as an error, which
 * restores it and ends the command: stdin closing or failing, stderr failing, and a write whose
 * failure is only reported afterwards.
 *
 * A STREAM REPORTS ONE FAILURE TWICE. A Node Writable hands a failed write to that write's callback
 * and then ALSO emits `error`. The picker acts on the first report — it restores and detaches — so
 * the second would arrive at a stream with no `error` listener, which Node turns into an uncaught
 * exception: the command would die of the echo of a failure it had already handled, with the wrong
 * exit. So detaching does not leave the two streams bare: a listener that does nothing stays on
 * each for the rest of this process. That is safe to leave because this process is about to end
 * with the picker's own answer, and it is all that is promised about a dead terminal — the restore
 * is attempted and the exit code is right, while the text of the error may have nowhere to go.
 */
export function processPickerIo(proc: PickerProcess = process): PickerIo {
	const { stdin, stderr } = proc;
	let reportError: ((err: Error) => void) | null = null;
	/** The late echo of a failure the picker already acted on. See A STREAM REPORTS ONE FAILURE TWICE. */
	const alreadyHandled = (): void => {};
	let quieted = false;
	return {
		setRawMode: (on) => {
			stdin.setRawMode(on);
		},
		onInput: (listener) => {
			const decoder = new StringDecoder("utf8");
			const onData = (chunk: Buffer | string): void => {
				const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
				if (text.length > 0) listener(text);
			};
			stdin.on("data", onData);
			stdin.resume();
			return () => {
				stdin.off("data", onData);
				// Without this the open stdin keeps the process alive after the list is gone.
				stdin.pause();
			};
		},
		onResize: (listener) => {
			stderr.on("resize", listener);
			return () => {
				stderr.off("resize", listener);
			};
		},
		onSignal: (listener) => {
			const handlers = TERMINATING_SIGNALS.map((signal) => {
				const handler = (): void => listener(signal);
				proc.on(signal, handler);
				return [signal, handler] as const;
			});
			return () => {
				for (const [signal, handler] of handlers) proc.off(signal, handler);
			};
		},
		onError: (listener) => {
			const onEnd = (): void => listener(new Error("the terminal's input closed (end of input on stdin)"));
			const onStdinError = (err: Error): void => listener(new Error(`reading the terminal failed: ${err.message}`));
			const onStderrError = (err: Error): void => listener(new Error(`writing the terminal failed: ${err.message}`));
			reportError = listener;
			stdin.on("end", onEnd);
			stdin.on("error", onStdinError);
			stderr.on("error", onStderrError);
			return () => {
				reportError = null;
				// Before the reporting listeners go, so neither stream is ever without one.
				if (!quieted) {
					quieted = true;
					stdin.on("error", alreadyHandled);
					stderr.on("error", alreadyHandled);
				}
				stdin.off("end", onEnd);
				stdin.off("error", onStdinError);
				stderr.off("error", onStderrError);
			};
		},
		setTimer: (fn, ms) => {
			const timer = setTimeout(fn, ms);
			return () => clearTimeout(timer);
		},
		afterFlush: (fn) => {
			// An empty write's callback runs after everything queued before it was handed to the terminal.
			stderr.write("", () => fn());
		},
		reraise: (signal) => {
			proc.kill(proc.pid, signal as NodeJS.Signals);
		},
		write: (text) => {
			stderr.write(text, (err) => {
				if (err != null) reportError?.(new Error(`writing the terminal failed: ${err.message}`));
			});
		},
		size: () => ({ columns: stderr.columns ?? 80, rows: stderr.rows ?? 24 }),
	};
}
