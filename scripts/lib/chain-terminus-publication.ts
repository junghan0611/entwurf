/**
 * The terminus wait of `smoke-entwurf-chain-live`, as one function with its fs seams injectable, so
 * the oracle that judges a live chain can be driven offline through the exact publication states.
 *
 * `enqueueMetaMessage` (pi-extensions/lib/meta-session.ts) publishes in two writes: the `.msg` body
 * FIRST, then — after the state stamp — `inbox.signal` LAST. A reader can therefore see the body
 * without the signal for a few milliseconds. The P5 failure on 2026-10-24 is consistent with that by
 * source and by its preserved mailbox: the old wait stopped at the first body and checked the signal
 * at once, and the signal file was written about 5 ms after the body. Its interleaving was not traced.
 * A body without the signal is a publication still in flight, so the wait ends only when both are
 * there, inside the same deadline. What the smoke asserts afterwards (exactly one body, the signal,
 * every identity and read-receipt check) is unchanged and still fails on a missing body, a missing
 * signal or a duplicate.
 */
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export interface TerminusPublicationIo {
	readdir(dir: string): Promise<string[]>;
	exists(file: string): boolean;
	sleep(ms: number): Promise<void>;
	now(): number;
}

const realIo: TerminusPublicationIo = {
	readdir: (dir) => fsp.readdir(dir),
	exists: (file) => existsSync(file),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now(),
};

export interface TerminusPublication {
	/** Every `.msg` / `.msg.delivered` seen at the last look, so a duplicate stays visible. */
	msgs: string[];
	/** Whether `inbox.signal` existed at the last look. */
	signalled: boolean;
}

/** Wait until the terminus mailbox holds a body AND its doorbell, or the deadline passes. */
export async function awaitTerminusPublication(
	boxDir: string,
	untilMs: number,
	pollMs: number,
	io: TerminusPublicationIo = realIo,
): Promise<TerminusPublication> {
	let msgs: string[] = [];
	let signalled = false;
	while (io.now() < untilMs) {
		msgs = (await io.readdir(boxDir).catch(() => [] as string[])).filter(
			(f) => f.endsWith(".msg") || f.endsWith(".msg.delivered"),
		);
		signalled = io.exists(path.join(boxDir, "inbox.signal"));
		if (msgs.length > 0 && signalled) break;
		await io.sleep(pollMs);
	}
	return { msgs, signalled };
}
