// Decisive-fact comparator for the raw ACP session probes beside this file (#171 step 7). NOT a gate;
// in no check tier. Pure: it reads a run directory's summary.json and wire logs, never spawns, never
// retries, and writes nothing except verdict.json when asked to (--write).
//
//   node compare.mjs facts <scenario> <run-dir>            print the decisive facts of one run
//   node compare.mjs check <scenario> <run-dir> [--write]  diff them against expected.json
//   node compare.mjs expected <scenario>=<run-dir> ...     print an expected.json built from stored runs
//                                                          (run `biome format --write` on the file you
//                                                          write it to: the repository lint checks it)
//
// A fact is categorical and compared by exact equality (a plain object's keys sorted first; arrays keep
// their order): ok or a JSON-RPC code, a stop reason, update
// kinds, capability sets, config readbacks, agent names, and booleans from a planted nonce or a narrow
// predicate. Durations, ids, usage numbers, paths and free text never are. A missing observation is
// "<absent>", which differs from every stored value; a summary an extractor cannot read is an input
// error (exit 2). Keys starting "diag." are diagnostics: printed and written to verdict.json, never
// compared or stored. Each key starts with the receipt it stands for (R1–R10, RH for the receipts'
// header, RUN for a continuity run's own validity), so a differing key points at one receipt line
// (.agent-reports/171-step7-measure-design.md §6). Exit: 0 all matched, 1 a key differs, 2 usage or
// input error. Raising `measured` is never done here; a difference goes to a human.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED = join(HERE, "expected.json");
const SCENARIOS = ["rail0", "agy", "resume-unknown", "experiments", "z5", "continuity"];

function fail(message) {
	console.error(`[compare] ${message}`);
	process.exit(2);
}

// ── helpers: each turns a summary shape into a categorical value ─────────────────────────────────
// A missing observation is ABSENT, never a default: absence differs from every stored value.
const ABSENT = "<absent>";
const isDigest = (d) => d !== null && typeof d === "object" && d.kinds !== null && typeof d.kinds === "object";
const kindsOf = (digest) => (isDigest(digest) ? Object.keys(digest.kinds).sort() : ABSENT);
const updates = (digest) => (isDigest(digest) ? Object.values(digest.kinds).reduce((a, b) => a + b, 0) : ABSENT);
/** Run-length kinds with the counts dropped: the order of update kinds, not how a vendor chunks text. */
const order = (digest) => (Array.isArray(digest?.sequence) ? digest.sequence.map(([kind]) => kind) : ABSENT);
const code = (err) => err?.rpc?.code ?? null;
const count = (list) => (Array.isArray(list) ? list.length : ABSENT);
const nonEmpty = (list) => (Array.isArray(list) ? list.length > 0 : ABSENT);
const withoutTrailing = (list, kind) => (Array.isArray(list) && list.at(-1) === kind ? list.slice(0, -1) : list);
// The probes store each compaction update truncated to 400 characters, so fields are read by pattern.
const field = (raw, name) => new RegExp(`"${name}":"([^"]*)"`).exec(raw)?.[1] ?? null;
const statusesOf = (compaction) => (Array.isArray(compaction) ? compaction.map((raw) => field(raw, "status")) : ABSENT);
/** A replayed compaction update: its status, and whether it carries a non-empty text summary. */
const replayOf = (raw) => ({
	status: field(raw, "status"),
	summary: /"summary":\[\{"type":"text","text":"[^"]/.test(raw),
});
/** Two ids that must both be present to be compared; equality of two absent ids proves nothing. */
const sameIds = (a, b) => (typeof a === "string" && typeof b === "string" ? a === b : ABSENT);
const answered = (p, needle) =>
	Object.values(p?.d?.textHead ?? p?.digest?.textHead ?? {})
		.join("")
		.includes(needle);

function ndjson(path) {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}
const wireFiles = (run, test) => readdirSync(run).filter((f) => f.endsWith(".wire-in.ndjson") && test(f));

/** agentInfo versions per backend, read from the wire logs (initialize answers). */
function versions(run) {
	const out = {};
	for (const name of wireFiles(run, () => true)) {
		for (const m of ndjson(join(run, name))) {
			const info = m?.result?.agentInfo;
			if (!info?.name) continue;
			const backend = info.name.includes("claude-agent-acp")
				? "claude"
				: info.name.includes("Antigravity")
					? "agy"
					: info.name;
			if (!out[backend]) out[backend] = new Set();
			out[backend].add(info.version);
		}
	}
	return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}
/** R1: the agentInfo names the given children's initialize answers carried, from the wire. */
function agentNames(run, test) {
	const names = new Set();
	for (const name of wireFiles(run, test))
		for (const m of ndjson(join(run, name))) if (m?.result?.agentInfo?.name) names.add(m.result.agentInfo.name);
	return names.size > 0 ? [...names].sort() : ABSENT;
}
/** R10: what answered one request of one child — "result", "error" or "none" — and the error code. */
function wireAnswer(run, child, method) {
	const files = readdirSync(run).filter((f) => new RegExp(`^${child}\\.wire-out\\.ndjson$`).test(f));
	if (files.length !== 1) return { kind: ABSENT, code: ABSENT };
	const sent = ndjson(join(run, files[0])).find((m) => m.method === method);
	const inPath = join(run, files[0].replace(".wire-out.", ".wire-in."));
	if (!sent) return { kind: ABSENT, code: ABSENT };
	const got = existsSync(inPath) ? ndjson(inPath).find((m) => m.id === sent.id && m.method === undefined) : undefined;
	if (!got) return { kind: "none", code: null };
	return got.error ? { kind: "error", code: got.error.code ?? null } : { kind: "result", code: null };
}

/** The ids of the configOptions one child's `method` answer carried, in the vendor's order; ABSENT if unread. */
function configOptionIds(run, childPattern, method) {
	const files = readdirSync(run).filter((f) => new RegExp(`^${childPattern}\\.wire-out\\.ndjson$`).test(f));
	if (files.length !== 1) return ABSENT;
	const sent = ndjson(join(run, files[0])).find((m) => m.method === method);
	const inPath = join(run, files[0].replace(".wire-out.", ".wire-in."));
	const got =
		sent && existsSync(inPath) ? ndjson(inPath).find((m) => m.id === sent.id && m.method === undefined) : undefined;
	const options = got?.result?.configOptions;
	return Array.isArray(options) ? options.map((o) => o?.id ?? null) : ABSENT;
}

/**
 * The form two facts are compared in: a plain object's keys sorted, recursively. Arrays keep their
 * order (update orders and status sequences are facts). A vendor's key order inside an object is not
 * a contract (production reads options by id, backend-adapter.ts:615-617, :683-685).
 */
function canonical(v) {
	if (Array.isArray(v)) return v.map(canonical);
	if (v !== null && typeof v === "object")
		return Object.fromEntries(
			Object.keys(v)
				.sort()
				.map((k) => [k, canonical(v[k])]),
		);
	return v;
}
const sameFact = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// ── extractors, one per scenario ──────────────────────────────────────────────────────────────────
// Each returns flat facts. Keys starting "diag." are diagnostics: reported, never compared or stored.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RAIL_KEY = { claude: "claudeCred", agy: "agyToken" };
/**
 * RH: the credential mtimes of every rail the run invoked are real observations (ISO times, not
 * `stat-failed:…`) and equal before and after. Anything else is ABSENT, never a pass.
 */
function unchanged(before, after, rails) {
	for (const rail of rails) {
		const [b, a] = [before?.[RAIL_KEY[rail]], after?.[RAIL_KEY[rail]]];
		if (!ISO.test(String(b)) || !ISO.test(String(a))) return ABSENT;
		if (b !== a) return false;
	}
	return true;
}

function rail0(s, { run }) {
	const { A, B, C, agy } = s.runs;
	return {
		"R1.claude.initialize.protocolVersion": A.init.protocolVersion,
		"R1.claude.initialize.loadSession": A.init.loadSession,
		"R1.claude.initialize.sessionCapabilities": [...A.init.sessionCapabilities].sort(),
		"R1.claude.agentInfo.name": agentNames(run, (f) => !f.startsWith("agy")),
		"R1.agy.initialize.protocolVersion": agy.init.protocolVersion,
		"R1.agy.initialize.loadSession": agy.init.loadSession,
		"R1.agy.initialize.sessionCapabilities": Object.keys(agy.init.sessionCapabilities).sort(),
		"R1.agy.agentInfo.name": agentNames(run, (f) => f.startsWith("agy")),
		"R2.claude.load.recall": A.recallP3Hit,
		"R2.claude.load.reenforce": A.enforceAfterLoad,
		"R2.claude.resume.windowUpdates": updates(C.resumeDigest),
		"R2.claude.resume.recall": C.recallP4Hit,
		"R2.claude.resume.reenforce": C.enforceAfterResume,
		"R2.claude.unknownLoad.code": code(B.unknownId),
		"R2.claude.unknownLoad.windowUpdates": updates(B.unknownDigest),
		"R2.claude.otherOverlayLoad.code": code(B.otherOverlay),
	};
}

function agyRun(s, { run }) {
	const { A, B, C } = s.runs;
	return {
		"RH.agy.tokenMtimeUnchanged": unchanged({ agyToken: s.tokenMtimeBefore }, { agyToken: s.tokenMtimeAfter }, ["agy"]),
		"R1.agy.initialize.loadSession": A.init.loadSession,
		"R1.agy.initialize.sessionCapabilities": [...A.init.sessionCapabilities].sort(),
		"R1.agy.agentInfo.name": agentNames(run, () => true),
		"R2.agy.load.recall": A.recallP3Hit,
		"R2.agy.resume.windowUpdates": updates(C.resumeDigest),
		"R2.agy.resume.afterKinds": kindsOf(C.resumeAfterDigest),
		"R2.agy.resume.recall": C.recallP4Hit,
		"R8.agy.otherOverlayLoad.ok": B.otherOverlay.ok === true,
		"R8.agy.otherOverlayLoad.windowUpdates": updates(B.otherOverlayDigest),
		"R8.agy.unknownLoad.ok": B.unknownId.ok === true,
		"R8.agy.unknownLoad.windowUpdates": updates(B.unknownDigest),
	};
}

function resumeUnknown(s, { ran }) {
	const out = { "RH.mtimeUnchanged": unchanged(s.mtimeBefore, s.mtimeAfter, ran) };
	for (const [b, r] of Object.entries(s.runs)) {
		out[`R2.${b}.unknownResume.code`] = code(r.result);
		// agy's -32603 is generic; only its message says the session could not be read. A narrow
		// predicate, not the prose: a vendor rewording that keeps the meaning still matches.
		if (b === "agy")
			out["R2.agy.unknownResume.unableToRead"] =
				code(r.result) === -32603 && /failed to read session/i.test(String(r.result?.rpc?.message));
		out[`R2.${b}.unknownResume.hasData`] = r.result?.rpc?.data != null;
		out[`R2.${b}.unknownResume.updates`] =
			Array.isArray(r.updatesInWindow) && Array.isArray(r.updatesAfter)
				? r.updatesInWindow.length + r.updatesAfter.length
				: ABSENT;
		out[`R2.${b}.unknownResume.fileForId`] = Array.isArray(r.newStateFiles)
			? r.newStateFiles.some((f) => String(f).includes(r.bogus))
			: ABSENT;
	}
	return out;
}

function experiments(s, { run, ran }) {
	const out = {
		"RH.mtimeUnchanged": unchanged(s.mtimeBefore, s.mtimeAfter, ran),
		"R6.processesUnderRunAtEnd": count(s.underRunAtEnd),
	};
	for (const [b, B] of Object.entries(s.backends)) {
		const I = B.items;
		const z2 = I.Z2.result;
		out[`R7.${b}.protocolV2.ok`] = z2.ok;
		out[`R7.${b}.protocolV2.code`] = code(z2);
		out[`R7.${b}.protocolV2.protocolVersion`] = z2.protocolVersion ?? null;

		const l11 = I.L11;
		for (const how of ["resume-both", "load-both", "resume-modelonly"]) {
			const x = l11[how];
			out[`R5.${b}.${how}.ok`] = x.open.ok;
			out[`R5.${b}.${how}.answeredConfig`] = x.open.config;
			const readback = x.enforce.readback;
			out[`R5.${b}.${how}.readbackAfterEnforce`] = readback[Object.keys(readback).at(-1)];
			// The arithmetic answer is a model's, not the rail's: reported, not compared.
			out[`diag.R5.${b}.${how}.answerCorrect`] = x.Q.stopReason === "end_turn" && answered(x.Q, "391");
			// The vendor's option order (claude-agent-acp 0.109.0 reorders it): visible, never compared.
			out[`diag.R5.${b}.${how}.configOptionIds`] = configOptionIds(
				run,
				`${b}-\\d+-l11-${how}`,
				how.startsWith("load") ? "session/load" : "session/resume",
			);
		}
		for (const how of ["resume-both", "resume-modelonly"])
			out[`R2b.${b}.l11.${how}.windowUpdates`] = updates(l11[how].open.window);

		const l7 = I.L7;
		out[`R3.${b}.closeAdvertised`] = l7.closeAdvertised;
		out[`R3.${b}.close.result`] = l7.close.result;
		out[`R3.${b}.close.updates`] = updates(l7.closeWindow);
		out[`R3.${b}.vendorFilesRemain`] = nonEmpty(l7.filesAfterClose);
		out[`R3.${b}.resumeSameChild.ok`] = l7.resumeSameChild.ok;
		out[`R3.${b}.loadSameChild.ok`] = l7.loadSameChild.ok;
		out[`R3.${b}.loadSameChild.replayKinds`] = isDigest(l7.loadSameChild.window)
			? l7.loadSameChild.window.kinds
			: ABSENT;
		out[`R3.${b}.resumeNewChild.ok`] = l7.resumeNewChild.ok;
		out[`R2b.${b}.l7Resume.windowUpdates`] = updates(l7.resume.window);

		const l14 = I.L14;
		out[`R4.${b}.compact.stopReason`] = l14.P4compact.stopReason;
		out[`R4.${b}.compact.statuses`] = statusesOf(l14.P4compact.d.compaction);
		const loadOrder = order(l14.load.window);
		out[`R4.${b}.load.order`] = b === "agy" ? withoutTrailing(loadOrder, "usage_update") : loadOrder;
		const replayed = l14.load.window.compaction;
		out[`R4.${b}.load.compactionReplay`] = Array.isArray(replayed) ? replayed.map(replayOf) : ABSENT;
		out[`R4.${b}.resume.windowUpdates`] = updates(l14.resume.window);
		out[`R2b.${b}.compactedResume.recall`] = answered(l14.recall, "QUARTZ-88");
		if (Array.isArray(l14.P4compact.d.compaction) && l14.P4compact.d.compaction.length > 0) {
			const live = field(l14.P4compact.d.compaction[0], "compactionId");
			const ids = Array.isArray(replayed) ? replayed.map((raw) => field(raw, "compactionId")) : [];
			out[`R4.${b}.load.compactionIdIsNew`] =
				ids.length === 1 && typeof live === "string" && typeof ids[0] === "string" ? ids[0] !== live : ABSENT;
		}

		const z6 = I.Z6;
		out[`R9.${b}.bothResumed`] = z6.a.ok && z6.b.ok;
		out[`R9.${b}.sameId`] = sameIds(z6.a.sessionId, z6.b.sessionId);
		const replay = [updates(z6.a.window), updates(z6.b.window)];
		out[`R9.${b}.replayUpdates`] = replay.includes(ABSENT) ? ABSENT : replay[0] + replay[1];

		// R6's boundary is +3 s (design §1). A child without that scan is ABSENT, not "nothing left".
		const groups = (at) =>
			B.reclaim.some((r) => !Array.isArray(r.scans?.[at]?.group))
				? ABSENT
				: B.reclaim.filter((r) => r.scans[at].group.length > 0).length;
		out[`R6.${b}.groupsLeftAt3s`] = groups("3000ms");
		out[`diag.R6.${b}.groupsLeftAt10s`] = groups("10000ms");

		if (I.V1) {
			const v = I.V1;
			out[`R8.${b}.phantomLoad.ok`] = v.load.ok;
			out[`R8.${b}.phantomLoad.replayUpdates`] = updates(v.load.window);
			out[`R8.${b}.phantomLoad.enforce`] = [v.enforce.model, v.enforce.thinking];
			out[`R8.${b}.phantomPrompt.code`] = code(v.P.error);
			out[`R8.${b}.phantomPrompt.notFound`] = String(v.P.error?.message).includes("not_found: trajectory not found");
			out[`R8.${b}.phantomPrompt.textOrTools`] = Object.keys(v.P.d.textChars).length + v.P.d.tools.length;
			// Sampled after the failed prompt, not at load: a file at load time is unmeasured.
			out[`R8.${b}.phantomPrompt.sessionFileAfter`] = nonEmpty(v.filesAfterPrompt);
			out[`R8.${b}.resumeAfter.code`] = code(v.resumeAfter.error);
		}
	}
	return out;
}

function z5(s, { run, ran }) {
	const out = { "RH.mtimeUnchanged": unchanged(s.mtimeBefore, s.mtimeAfter, ran) };
	for (const [b, B] of Object.entries(s.backends)) {
		for (const name of ["S-late", "S-late-close"]) {
			const x = B.items[name];
			out[`R10.${b}.${name}.listed`] = Array.isArray(x.after?.list?.ids) ? x.after.list.ids.includes(x.sid) : ABSENT;
			out[`R10.${b}.${name}.resume.ok`] = x.after.resume.ok;
			out[`R10.${b}.${name}.resume.code`] = code(x.after.resume.error);
			out[`R10.${b}.${name}.vendorFile`] = nonEmpty(x.after.files);
		}
		const k = B.items["S-kill"];
		// z5 never sets k.sid on S-kill; the id is whatever session/new answered, before or after the kill.
		out[`R10.${b}.S-kill.idReceived`] = Boolean(k.answeredBeforeKill?.sid ?? k.answeredAfterKill?.sid);
		const answer = wireAnswer(run, `${b}-\\d+-kill`, "session/new");
		out[`R10.${b}.S-kill.newAnswer.kind`] = answer.kind;
		out[`R10.${b}.S-kill.newAnswer.code`] = answer.code;
		out[`R10.${b}.S-kill.orphanState`] = Array.isArray(k.newStateFiles)
			? k.newStateFiles.some((f) => String(f).includes("/conversations/"))
			: ABSENT;
	}
	return out;
}

/**
 * U rows have no stored oracle: their facts are reported. What IS compared is the run's own validity
 * (RUN.*): no failed row, every reaping verified, nothing left under the run, no interruption, and
 * measurement completeness — every mandatory U sample "complete" (RUN.incomplete lists the rest, so a
 * run with no usable sample cannot pass). A complete sample's vendor answer, yes or no, stays a fact.
 */
function continuity(s, { ran }) {
	const run = s.run ?? {};
	const out = {
		"RUN.fatalRows": run.fatalRows ?? ABSENT,
		"RUN.unverifiedReaps": run.unverifiedReaps ?? ABSENT,
		"RUN.processesUnderRunAtEnd": count(run.processesUnderRunAtEnd),
		"RUN.ownedLeftAfterKill": run.ownedLeftAfterKill ?? ABSENT,
		"RUN.interrupted": run.interrupted === undefined ? ABSENT : run.interrupted,
		"RUN.incomplete": run.incomplete ?? ABSENT,
		"diag.RH.mtimeUnchanged": unchanged(s.mtimeBefore, s.mtimeAfter, ran),
	};
	const [before, after] = [s.linkTargetsBefore ?? {}, s.linkTargetsAfter ?? {}];
	out["diag.RH.linkTargetsChanged"] = Object.keys(after)
		.filter((k) => before[k] !== after[k])
		.sort();
	for (const [b, B] of Object.entries(s.backends ?? {})) {
		for (const [row, facts] of Object.entries(B.facts ?? {})) {
			for (const [k, v] of Object.entries(facts)) out[`diag.${row}.${b}.${k}`] = v;
		}
	}
	return out;
}

const EXTRACT = { rail0, agy: agyRun, "resume-unknown": resumeUnknown, experiments, z5, continuity };

function factsOf(scenario, run) {
	if (!SCENARIOS.includes(scenario)) fail(`unknown scenario: ${scenario}`);
	const path = join(run, "summary.json");
	if (!existsSync(path)) fail(`no summary.json in ${run}`);
	let all;
	try {
		const summary = JSON.parse(readFileSync(path, "utf8"));
		all = EXTRACT[scenario](summary, { run, ran: requestedBackends(run) });
	} catch (e) {
		// A summary without the shape its extractor reads is an input error, never a difference.
		fail(`${scenario}: cannot read the facts of ${run}: ${e.message}`);
	}
	const facts = {};
	const diagnostics = {};
	for (const [k, v] of Object.entries(all)) {
		if (k.startsWith("diag.")) diagnostics[k.slice(5)] = v;
		else facts[k] = v;
	}
	return { versions: versions(run), facts, diagnostics };
}

/**
 * The backends a run was asked to drive. run.sh writes backend-filter.txt only for a filtered run; without
 * it both ran (the stored runs predate the file). Taken from the request, never from which agent answered,
 * so a backend that crashed before `initialize` reads as differing, not as not run.
 */
function requestedBackends(run) {
	const path = join(run, "backend-filter.txt");
	if (!existsSync(path)) return ["claude", "agy"];
	const only = readFileSync(path, "utf8").trim();
	if (only !== "claude" && only !== "agy") fail(`backend-filter.txt must say claude or agy: ${only}`);
	return [only];
}

/** Keys of a backend that was not asked to run (a filtered run) are reported as not run, not as differing. */
function diff(expected, actual, ranBackends) {
	const verdict = { matched: [], differ: [], notRun: [], unexpected: [] };
	for (const [key, want] of Object.entries(expected)) {
		const backend = key.split(".")[1];
		if (!(key in actual)) {
			if (["claude", "agy"].includes(backend) && !ranBackends.includes(backend)) verdict.notRun.push(key);
			else verdict.differ.push({ key, expected: want, actual: "<missing>" });
			continue;
		}
		if (sameFact(actual[key], want)) verdict.matched.push(key);
		else verdict.differ.push({ key, expected: want, actual: actual[key] });
	}
	for (const key of Object.keys(actual)) if (!(key in expected)) verdict.unexpected.push({ key, actual: actual[key] });
	return verdict;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "facts" && args.length === 2) {
	console.log(JSON.stringify(factsOf(args[0], args[1]), null, 2));
} else if (cmd === "check" && (args.length === 2 || (args.length === 3 && args[2] === "--write"))) {
	const [scenario, run] = args;
	const { versions: seen, facts, diagnostics } = factsOf(scenario, run);
	const expected = JSON.parse(readFileSync(EXPECTED, "utf8"))[scenario] ?? {};
	const ran = requestedBackends(run);
	const verdict = { scenario, versions: seen, ...diff(expected, facts, ran), diagnostics };
	if (args[2] === "--write") writeFileSync(join(run, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`);
	const n = (k) => verdict[k].length;
	console.log(
		`[compare] ${scenario}: ${n("matched")} matched, ${n("differ")} differ, ${n("notRun")} not run, ` +
			`${n("unexpected")} without an expected value; versions ${JSON.stringify(seen)}`,
	);
	for (const d of verdict.differ)
		console.log(`  DIFFER ${d.key}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
	for (const u of verdict.unexpected) console.log(`  NEW    ${u.key}: ${JSON.stringify(u.actual)}`);
	for (const [k, v] of Object.entries(diagnostics)) console.log(`  DIAG   ${k}: ${JSON.stringify(v)}`);
	process.exit(n("differ") > 0 ? 1 : 0);
} else if (cmd === "expected" && args.length > 0) {
	const out = {};
	for (const pair of args) {
		const [scenario, run] = pair.split("=");
		if (!scenario || !run) fail(`expected <scenario>=<run-dir>, got ${pair}`);
		out[scenario] = factsOf(scenario, run).facts;
	}
	console.log(JSON.stringify(out, null, "\t"));
} else {
	fail("usage: compare.mjs facts|check <scenario> <run-dir> [--write] | expected <scenario>=<run-dir> ...");
}
