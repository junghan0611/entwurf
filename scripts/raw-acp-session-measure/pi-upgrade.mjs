// #176 — a Pi resident's ACP session an earlier Entwurf build opened, reopened by this checkout. NOT a gate.
//
//   LIVE=1 ENTWURF_RAW_PI_EARLIER=<dir> scripts/raw-acp-session-measure/run.sh pi-upgrade <out-dir> [claude|agy]
//
// ENTWURF_RAW_PI_EARLIER names an installed earlier Entwurf package outside the repository, with its own
// bundled ACP agent. That build births the session and answers one turn that plants a word; this checkout
// then reopens the Pi session twice. Each reopen should resume the same vendor session (the record's id
// unchanged, no further vendor transcript) and recall the word; the record is read after every step.
//
// A check that is false is a result, not a probe failure: the probe exits 0 whenever it ran to the end,
// 3 when Pi itself could not be driven. The sandbox and the Pi driver: pi-host.mjs.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN } from "./common.mjs";
import { AGENT, backend, launch, MODEL, records, steps, storedAnswers } from "./pi-host.mjs";

const EARLIER = process.env.ENTWURF_RAW_PI_EARLIER;
if (!EARLIER) throw new Error("ENTWURF_RAW_PI_EARLIER must name an installed earlier Entwurf package");
const word = `OSPREY-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const recall = "What is the codeword I gave you? Reply with the codeword alone.";
const summary = {
	backend,
	model: MODEL,
	word,
	earlier: EARLIER,
	steps,
	records: [],
	vendorTranscripts: [],
	checks: {},
	run: {},
};

/** The record rows after a step: the vendor id, the writer, how far it got. */
const view = (label) => {
	const rows = records().map((r) => ({
		acpSessionId: r.acpSessionId,
		writer: r.writer,
		firstPrompt: r.firstPrompt,
		sealedTurnId: r.sealedTurnId ?? null,
		bridgeConfigSignature: r.bridgeConfigSignature,
	}));
	summary.records.push({ label, rows });
	return rows;
};
/** Claude's own transcripts under the sandbox overlay: one per vendor session it opened. */
const vendorTranscripts = (label) => {
	const root = join(AGENT, "claude-config-overlay", "projects");
	const files = existsSync(root)
		? readdirSync(root, { recursive: true })
				.map(String)
				.filter((f) => f.endsWith(".jsonl"))
				.sort()
		: [];
	summary.vendorTranscripts.push({ label, files });
	return files;
};

let status = 0;
try {
	const a = launch(undefined, {}, EARLIER);
	const state = await a.command({ type: "get_state" });
	const sessionFile = state.data?.sessionFile ?? null;
	summary.run.sessionFile = sessionFile;
	const plant = await a.turn("earlier-plant", `Remember this codeword for later: ${word}. Reply with exactly: OK`);
	summary.run.earlierQuit = await a.quit();
	const r0 = view("after-earlier");
	const v0 = vendorTranscripts("after-earlier");

	const b = launch(sessionFile);
	const first = await b.turn("reopen-1", recall);
	summary.run.reopen1Quit = await b.quit();
	const r1 = view("after-reopen-1");
	const v1 = vendorTranscripts("after-reopen-1");

	const c = launch(sessionFile);
	const second = await c.turn("reopen-2", recall);
	summary.run.reopen2Quit = await c.quit();
	const r2 = view("after-reopen-2");
	const v2 = vendorTranscripts("after-reopen-2");

	const said = (step) => step.text.includes(word);
	const one = (rows) => (rows.length === 1 ? rows[0] : undefined);
	const id0 = one(r0)?.acpSessionId;
	summary.checks = {
		earlierAnswered: plant.stopReason === "stop" && plant.errorMessage === null,
		earlierRecordOne: r0.length === 1 && r0[0].firstPrompt === "sealed",
		earlierWriter: one(r0)?.writer ?? null,
		reopen1Answered: first.stopReason === "stop" && first.errorMessage === null,
		reopen1Recall: said(first),
		reopen1SameVendorSession: id0 !== undefined && one(r1)?.acpSessionId === id0,
		reopen2Answered: second.stopReason === "stop" && second.errorMessage === null,
		reopen2Recall: said(second),
		reopen2SameVendorSession: id0 !== undefined && one(r2)?.acpSessionId === id0,
		writerKept: JSON.stringify(one(r2)?.writer) === JSON.stringify(one(r0)?.writer),
		configRewritten: one(r1)?.bridgeConfigSignature !== one(r0)?.bridgeConfigSignature,
		noFurtherVendorTranscript:
			backend === "claude"
				? JSON.stringify(v1) === JSON.stringify(v0) && JSON.stringify(v2) === JSON.stringify(v0)
				: null,
		vendorTranscriptOfRecord:
			backend === "claude" && id0 !== undefined ? v0.some((f) => f.endsWith(`${id0}.jsonl`)) : null,
	};
	summary.run.storedAnswers = sessionFile ? storedAnswers(sessionFile) : [];
} catch (error) {
	summary.run.error = String(error?.stack ?? error);
	status = 3;
}
writeFileSync(join(RUN, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ checks: summary.checks, error: summary.run.error ?? null })}\n`);
process.exit(status);
