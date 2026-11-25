// #175 M1/M2 — what a Pi compaction does to the vendor session's context. NOT a gate.
//
//   LIVE=1 scripts/raw-acp-session-measure/run.sh pi-compact <out-dir> [claude|agy]
//
// A real Pi resident (pi-host.mjs) is born with a codeword and a filler of about
// ENTWURF_RAW_FILLER_TOKENS (default 80000) tokens, so the vendor session holds a large context. Then:
//   manual (ENTWURF_RAW_COMPACT_MODE unset or `manual`): one short turn (U0), Pi's rpc `compact`, a recall
//     turn (U1), one more short turn (U2);
//   threshold: Pi's own threshold compaction, made to fire at a small context by
//     ENTWURF_RAW_PI_RESERVE_TOKENS (a SIMULATION of the threshold path, never the 1M one): the birth turn
//     (U0) and whatever Pi compacts after it, then the recall turn (U1) and one more short turn (U2), each
//     followed by whatever compaction Pi starts.
// U is the vendor's occupancy as Pi stored it (`usage.totalTokens` of the answer, this rail's
// `usage_update.used`), and, independently, the vendor's own transcript in the Claude overlay: the
// occupancy of each of its assistant messages and every compact boundary it wrote.
//
// The fixed reading (#175, set before any run): GREEN when U1 <= 0.5 * U0 and U0 - U1 >= 30000; RED when
// U1 >= 0.9 * U0; anything else is reported, not judged. U0 below 80000 makes the run inconclusive.
// Exit 0 when the run reached its end, 3 when Pi could not be driven.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN } from "./common.mjs";
import { AGENT, backend, launch, MODEL, records, reserveTokens, steps, storedAnswers, TURN_MS } from "./pi-host.mjs";

const MODE = process.env.ENTWURF_RAW_COMPACT_MODE ?? "manual";
if (MODE !== "manual" && MODE !== "threshold")
	throw new Error(`ENTWURF_RAW_COMPACT_MODE must be manual or threshold: ${MODE}`);
if (MODE === "threshold" && reserveTokens === null)
	throw new Error("threshold mode needs ENTWURF_RAW_PI_RESERVE_TOKENS (the simulation's lowered threshold)");
const FILLER_TOKENS = Number(process.env.ENTWURF_RAW_FILLER_TOKENS ?? 80_000);
if (!Number.isInteger(FILLER_TOKENS) || FILLER_TOKENS < 1000)
	throw new Error(`ENTWURF_RAW_FILLER_TOKENS must be an integer >= 1000: ${FILLER_TOKENS}`);

// A deterministic filler: numbered lines of words from a fixed list, about 16 tokens a line.
const WORDS =
	"amber basalt cedar delta ember fjord granite harbor indigo juniper kelp lantern meadow nickel orchard pewter quartz raven saffron tundra umber velvet walnut xenon yarrow zephyr anchor bramble copper drizzle estuary falcon glacier heron iris jasper kestrel lichen marble nectar onyx prairie quill reef sorrel thistle".split(
		" ",
	);
let seed = 175;
const next = () => {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed;
};
const fillerLines = [];
for (let i = 0; i < Math.ceil(FILLER_TOKENS / 16); i++) {
	const words = Array.from({ length: 11 }, () => WORDS[next() % WORDS.length]);
	fillerLines.push(`L${String(i).padStart(5, "0")} ${words.join(" ")}.`);
}
const filler = fillerLines.join("\n");

const word = `KESTREL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const summary = {
	backend,
	model: MODEL,
	mode: MODE,
	simulation: MODE === "threshold",
	reserveTokens,
	fillerTokensRequested: FILLER_TOKENS,
	fillerChars: filler.length,
	word,
	steps,
	compactions: [],
	checks: {},
	run: {},
};

/** The vendor's own transcripts in the Claude overlay: per session, its assistant occupancies and compact boundaries. */
function vendorTranscripts() {
	const root = join(AGENT, "claude-config-overlay", "projects");
	const out = {};
	let dirs = [];
	try {
		dirs = readdirSync(root);
	} catch {
		return out;
	}
	for (const d of dirs) {
		for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith(".jsonl"))) {
			const rows = [];
			for (const line of readFileSync(join(root, d, f), "utf8").split("\n")) {
				if (!line) continue;
				let e;
				try {
					e = JSON.parse(line);
				} catch {
					continue;
				}
				if (e.type === "system" && e.subtype === "compact_boundary") {
					rows.push({ kind: "compact_boundary", at: e.timestamp, meta: e.compactMetadata ?? null });
				} else if (e.type === "assistant" && e.message?.usage) {
					const u = e.message.usage;
					const occupancy =
						(u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
					const last = rows.at(-1);
					// One API response is written once per content block; keep one row per message id.
					if (last?.kind === "assistant" && last.id === e.message.id) continue;
					rows.push({
						kind: "assistant",
						at: e.timestamp,
						id: e.message.id,
						occupancy,
						output: u.output_tokens ?? 0,
						cacheRead: u.cache_read_input_tokens ?? 0,
						cacheWrite: u.cache_creation_input_tokens ?? 0,
						input: u.input_tokens ?? 0,
					});
				}
			}
			out[f.replace(/\.jsonl$/, "")] = rows;
		}
	}
	return out;
}

let status = 0;
try {
	const a = launch();
	const state = await a.command({ type: "get_state" });
	const sessionFile = state.data?.sessionFile ?? null;
	summary.run.sessionFile = sessionFile;
	/** Wait until every compaction Pi started has ended, then record them. */
	const settleCompactions = async (after) => {
		const pending = () => {
			const seen = a.events.slice(after);
			return (
				seen.filter((e) => e.type === "compaction_start").length -
				seen.filter((e) => e.type === "compaction_end").length
			);
		};
		const end = Date.now() + TURN_MS;
		while (pending() > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
		// A threshold compaction starts right after the turn settles; give it a moment to show.
		await new Promise((r) => setTimeout(r, 1_500));
		while (pending() > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 500));
		for (const e of a.events.slice(after)) {
			if (e.type === "compaction_start") summary.compactions.push({ phase: "start", reason: e.reason });
			if (e.type === "compaction_end")
				summary.compactions.push({
					phase: "end",
					reason: e.reason,
					aborted: e.aborted ?? null,
					willRetry: e.willRetry ?? null,
					errorMessage: e.errorMessage ?? null,
					tokensBefore: e.result?.tokensBefore ?? null,
					summaryChars: typeof e.result?.summary === "string" ? e.result.summary.length : null,
				});
		}
	};
	const recordIds = () => records().map((r) => r.acpSessionId);

	let mark = a.events.length;
	const t1 = await a.turn(
		"birth",
		`Remember this codeword for later: ${word}. Below is reference material for later questions; do not summarize or repeat it. Reply with exactly: OK\n\n${filler}`,
	);
	if (MODE === "threshold") await settleCompactions(mark);
	const idsBefore = recordIds();
	let t2;
	let U0;
	if (MODE === "manual") {
		t2 = await a.turn("before-compaction", "Reply with exactly: READY");
		U0 = t2.usage?.totalTokens ?? null;
		mark = a.events.length;
		const compacted = await a
			.command({ type: "compact" }, TURN_MS)
			.catch((error) => ({ success: false, error: String(error) }));
		summary.run.compact = {
			success: compacted.success === true,
			error: compacted.error ?? null,
			tokensBefore: compacted.data?.tokensBefore ?? null,
			summaryChars: typeof compacted.data?.summary === "string" ? compacted.data.summary.length : null,
		};
		await settleCompactions(mark);
	} else {
		U0 = t1.usage?.totalTokens ?? null;
	}
	const vendorBeforeRecall = vendorTranscripts();
	mark = a.events.length;
	const t3 = await a.turn("recall", "What is the codeword I gave you? Reply with the codeword alone.");
	if (MODE === "threshold") await settleCompactions(mark);
	mark = a.events.length;
	const t4 = await a.turn("after", "Reply with exactly: DONE");
	if (MODE === "threshold") await settleCompactions(mark);
	const idsAfter = recordIds();
	summary.run.quit = await a.quit();

	const U1 = t3.usage?.totalTokens ?? null;
	const U2 = t4.usage?.totalTokens ?? null;
	summary.run.U = { U0, U1, U2, birth: t1.usage?.totalTokens ?? null };
	summary.run.acpSessionIds = { before: idsBefore, after: idsAfter };
	summary.run.storedAnswers = sessionFile ? storedAnswers(sessionFile) : [];
	summary.run.piCompactionEntries = sessionFile
		? readFileSync(sessionFile, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l))
				.filter((e) => e.type === "compaction" || (e.type === "custom" && /compaction/.test(e.customType ?? "")))
				.map((e) =>
					e.type === "compaction"
						? { type: e.type, tokensBefore: e.tokensBefore ?? null, summaryChars: e.summary?.length ?? null }
						: {
								type: e.customType,
								status: e.data?.status ?? null,
								tokensBefore: e.data?.tokensBefore?.value ?? e.data?.tokensBefore ?? null,
								tokensAfter: e.data?.tokensAfter?.value ?? e.data?.tokensAfter ?? null,
							},
				)
		: [];
	summary.run.vendorBeforeRecall = Object.fromEntries(
		Object.entries(vendorBeforeRecall).map(([k, rows]) => [k, rows.length]),
	);
	summary.run.vendor = vendorTranscripts();
	const judged = U0 !== null && U1 !== null && U0 >= 80_000;
	summary.checks = {
		birthDone: t1.stopReason === "stop",
		compactionHappened: summary.compactions.some((c) => c.phase === "end" && !c.errorMessage && !c.aborted),
		recallDone: t3.stopReason === "stop",
		recallKeptCodeword: t3.stopReason === "stop" && t3.text.includes(word),
		sameVendorSession:
			idsBefore.length === 1 && idsAfter.length === 1 && idsBefore[0] === idsAfter[0] && idsBefore[0] !== undefined,
		U0AtLeast80k: U0 !== null && U0 >= 80_000,
		green: judged && U1 <= 0.5 * U0 && U0 - U1 >= 30_000,
		red: judged && U1 >= 0.9 * U0,
	};
} catch (error) {
	summary.run.fatal = String(error?.stack ?? error);
	status = 3;
}
writeFileSync(join(RUN, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
	JSON.stringify(
		{ status, U: summary.run.U ?? null, checks: summary.checks, fatal: summary.run.fatal ?? null },
		null,
		2,
	),
);
process.exit(status);
