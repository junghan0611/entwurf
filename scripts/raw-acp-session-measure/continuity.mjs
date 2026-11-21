// #171 step 7 continuity rows (U9/U19, U12, U14/U15 and the vendor half of 16-1, U17, U18, U21, U23,
// U24, U25, U26). NOT a gate. Launch through run.sh beside this (LIVE=1, sandboxed HOME/XDG/
// PI_CODING_AGENT_DIR, run dir outside the repository). Raw JSON-RPC against the real vendor agents; no
// Entwurf resume code (L8) is involved. Design and expected meanings:
// .agent-reports/171-step7-measure-design.md §2 (amended by Sol's #C4 review).
//
// Each row writes categorical facts to summary.backends.<b>.facts.<U> (compare.mjs reports them; only
// the run's own validity is compared) and its raw observations to items.<U>. Every mandatory sample
// (SAMPLES) records `status`: "complete", or "inconclusive" with `inconclusiveBecause` when a
// precondition failed or an outcome could not be observed (a call that got no terminal frame, a re-send
// that did not end_turn). An inconclusive case spends no further turn. A complete sample may still say
// "no": that is a result, not a failure.
// Side effects are lines appended to scratch-cwd/effects.txt inside the run directory.
//
// Labels the facts carry: U12 is a vendor child's kill or cancel (a SIGKILL of Pi itself is unmeasured);
// U18 is a proxy (invalid input, not an in-flight vendor failure); U21's agentKill is an injected
// SIGKILL of the agent process, not a spontaneous crash; U23 measures rejections, not a transient failure
// on the correct overlay; agy U26 resumes under this run's cwd, not the stored session's.
//
// Exit: 0 only when no row failed, every child's reaping was verified, nothing is left (sweep.mjs), no
// signal interrupted the run AND every mandatory sample is complete. 1 when a row failed, a reaping was
// unverified, a process survived or a signal interrupted the run. 4 when the run was clean but a
// mandatory sample is inconclusive or missing (`run.incomplete`). summary.json is written either way.
//
//   optional env (run.sh passes it through):
//   ENTWURF_RAW_CLAUDE_ACP_PREFIX  measure claude-agent-acp from that prefix; U26 then builds on the pin
//   ENTWURF_RAW_U26_AGY_SOURCE     a stored `agy` scenario run dir; U26 resumes a COPY of its session
//   ENTWURF_RAW_U26_AGY_PAIR       the agy version pair U26 must cross, "<stored>:<launched>"
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	agyBin,
	CLAUDE_CRED,
	claudeLauncherArg,
	D,
	linkTargetMtimes,
	mt,
	REAL_CLAUDE,
	REAL_GEMINI,
	REPO,
	RUN,
	TOKEN,
} from "./common.mjs";
import {
	answered,
	cfgOf,
	closeHarness,
	enforce,
	errOf,
	frameOf,
	init,
	L,
	noFrameProven,
	open,
	prompt,
	promptStart,
	reapAll,
	scratch,
	segmentAfter,
	sessParams,
	sleep,
	startChild,
	stateDelta,
	stateFiles,
	stateSnapshot,
	survivors,
	until,
	unverifiedReaps,
} from "./harness.mjs";
import { agySessionEntries, copySessionState, readStoredAgySession } from "./u26-source.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ONLY = process.argv[3];
if (ONLY !== undefined && ONLY !== "claude" && ONLY !== "agy")
	throw new Error(`backend filter must be claude or agy: ${ONLY}`);
if (ONLY !== "claude") agyBin();

const ov = await import(join(D, "overlay.js"));
const BA = await import(join(D, "backend-adapter.js"));
const { resolveProviderConfig, mcpServerNames } = await import(join(D, "config.js"));

const PROVENANCE = join(RUN, "provenance.json");
const summary = {
	mtimeBefore: { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) },
	provenance: existsSync(PROVENANCE) ? JSON.parse(readFileSync(PROVENANCE, "utf8")) : null,
	backends: {},
};
const save = () => writeFileSync(join(RUN, "summary.json"), JSON.stringify(summary, null, 2));
const EFFECTS = join(scratch, "effects.txt");
const nonce = (tag) => `${tag}-${randomUUID().slice(0, 8).toUpperCase()}`;
const lines = (marker) =>
	existsSync(EFFECTS)
		? readFileSync(EFFECTS, "utf8")
				.split("\n")
				.filter((l) => l === marker).length
		: 0;
const said = (p, needle) =>
	Object.values(p?.d?.text ?? {})
		.join("")
		.includes(needle);
const agentText = (p) => String(p?.d?.text?.agent_message_chunk ?? "").trim();
const version = (answer) => answer?.agentInfo?.version ?? null;
/** A prompt's ending: its stopReason, `error:<code>` for an error frame, or "no answer" (no frame). */
const stop = (p) => (p.ok ? p.stopReason : p.frame === "error" ? `error:${p.error?.rpc?.code ?? "?"}` : "no answer");
/** A prompt that got a result with stopReason end_turn. */
const ended = (p) => p?.ok === true && p.stopReason === "end_turn";
/** What the agent asked the client during one phase, and what the harness answered (a fact, never implied by effects). */
const askedIn = (c, phase) =>
	c.agentRequests.filter((x) => x.phase === phase).map((x) => `${x.method.replace("session/", "")}:${x.answer}`);
/**
 * The tool call of one phase whose title or input carries `marker`, and whether THAT call (same
 * toolCallId) was reported completed. Any other completed call in the phase does not count.
 */
function markedCall(c, phase, marker) {
	const ns = c.notes.filter((x) => x.phase === phase && (x.kind === "tool_call" || x.kind === "tool_call_update"));
	const call = ns.find((x) => `${x.title ?? ""}${x.input ?? ""}`.includes(marker));
	if (!call) return null;
	return {
		id: call.toolCallId,
		completed: ns.some((x) => x.toolCallId === call.toolCallId && x.status === "completed"),
	};
}
const SRC_LAUNCHER = join(REPO, "pi-extensions/lib/acp/claude-acp-launch.js");
/** Select-option values, flattened through option groups. */
const optionValues = (options = []) =>
	options.flatMap((o) => (Array.isArray(o.options) ? optionValues(o.options) : [o.value]));

// ── backends (as experiments.mjs, plus what the U rows need) ──────────────────────────────────────
function claudeBackend() {
	const stateDir = ov.CLAUDE_CONFIG_OVERLAY_DIR;
	ov.ensureClaudeConfigOverlay(REAL_CLAUDE, stateDir);
	const config = resolveProviderConfig({
		cwd: scratch,
		adapter: BA.claudeAdapter,
		globalSettingsPath: join(RUN, "absent-g.json"),
		projectSettingsPath: join(RUN, "absent-p.json"),
	});
	const carrier = BA.claudeAdapter.loadCarrier({ mcpServerNames: mcpServerNames(config), config });
	const launch = BA.claudeAdapter.resolveLaunch({ nativeModelId: "claude-sonnet-5-5", config });
	const env = { ...process.env, ...BA.claudeAdapter.launchEnvDefaults() };
	// A second production overlay (rail0's overlay B): the same linked auth, none of this run's sessions.
	const otherOverlayDir = join(RUN, "home/.pi/agent/claude-config-overlay-B");
	ov.ensureClaudeConfigOverlay(REAL_CLAUDE, otherOverlayDir);
	return {
		name: "claude",
		adapter: BA.claudeAdapter,
		model: "claude-sonnet-5-5",
		thinking: "low",
		command: launch.command,
		args: launch.args.map((a) => claudeLauncherArg(a, SRC_LAUNCHER)),
		// U26: the repository's launcher resolves the pinned package.
		pinnedArgs: launch.args.map((a) => (a.endsWith("/claude-acp-launch.js") ? SRC_LAUNCHER : a)),
		env,
		otherOverlayDir,
		otherOverlay: () => ({ env: { ...env, CLAUDE_CONFIG_DIR: otherOverlayDir } }),
		meta: BA.claudeAdapter.buildSessionMeta(
			{ modelId: "claude-sonnet-5-5", nativeModelId: "claude-sonnet-5-5", config },
			carrier,
		),
		cheaperModel: (values) => values.find((v) => /haiku/i.test(v)),
		stateDir,
		reclaim: [],
		items: {},
		facts: {},
	};
}
function agyBackend() {
	const stateDir = join(RUN, "home/.pi/agent/agy-gemini-overlay");
	const hook = BA.agyAcpHookCommand(
		process.execPath,
		join(REPO, "pi-extensions/lib/acp/agy-acp-hook.mjs"),
		BA.AGY_HOOK_POLICY_HIDDEN_TURNS,
	);
	ov.ensureAgyGeminiOverlay(REAL_GEMINI, stateDir, [], hook);
	const config = resolveProviderConfig({
		cwd: scratch,
		adapter: BA.agyAdapter,
		globalSettingsPath: join(RUN, "absent-g.json"),
		projectSettingsPath: join(RUN, "absent-p.json"),
	});
	const carrier = BA.agyAdapter.loadCarrier({ mcpServerNames: mcpServerNames(config), config });
	const overlayAt = (dir) => {
		ov.ensureAgyGeminiOverlay(REAL_GEMINI, dir, [], hook);
		return { args: BA.agyLaunchArgs(dir) };
	};
	const otherOverlayDir = join(RUN, "home/.pi/agent/agy-gemini-overlay-B");
	overlayAt(otherOverlayDir);
	return {
		name: "agy",
		adapter: BA.agyAdapter,
		model: "gemini-3.8-flash",
		thinking: "low",
		command: agyBin(),
		args: BA.agyLaunchArgs(stateDir),
		env: { ...process.env },
		otherOverlayDir,
		otherOverlay: () => ({ args: BA.agyLaunchArgs(otherOverlayDir) }),
		overlayAt,
		meta: BA.agyAdapter.buildSessionMeta({}, carrier),
		cheaperModel: (values, current) => values.find((v) => /flash/i.test(v) && v !== current),
		stateDir,
		reclaim: [],
		items: {},
		facts: {},
	};
}

/** The same carrier with one added instruction, wherever this backend carries its system prompt. */
function changedCarrier(meta) {
	const m = structuredClone(meta ?? {});
	const rule = "\n\nBegin every reply with the exact prefix K-B followed by a space.";
	if (typeof m.systemPrompt === "string") m.systemPrompt += rule;
	else if (typeof m.antigravity?.systemPrompt?.append === "string") m.antigravity.systemPrompt.append += rule;
	else return { meta: m, changed: false };
	return { meta: m, changed: true };
}

async function newSession(B, c) {
	const answer = await init(c);
	const created = await c.rpc("session/new", sessParams(B, {}), 60000);
	const enforced = await enforce(B, c, created.sessionId);
	return { sid: created.sessionId, version: version(answer), enforced, configOptions: created.configOptions ?? [] };
}
async function resumeIn(B, tag, sid, phase, launch, opts) {
	const c = startChild(B, tag, launch);
	const answer = await init(c);
	const r = await open(B, c, "session/resume", sid, phase, opts);
	if (r.ok) r.enforce = await enforce(B, c, sid);
	return { c, r, version: version(answer) };
}
const recallQ = "What word did I ask you to remember? Reply with the word only.";
/** U12's recall prompt starts with this; the load replay's cut turn ends where it begins. */
const RECALL_MARKER_HEAD = "What marker word appeared";
/** A proven ending: the reap was verified and, for a kill, the leader died of SIGKILL. */
const proven = (rec, how) =>
	rec.verified === true &&
	(how === "production" ? rec.ending?.leaderExit != null : rec.ending?.leaderExit?.signal === "SIGKILL");

/**
 * The mandatory samples per row, as fact-key prefixes ("" is the row itself). A sample that is missing
 * from the facts, or not "complete", makes the run incomplete (exit 4).
 */
const SAMPLES = {
	U21: ["production", "groupKill", "agentKill"],
	U23: [""],
	U25: [""],
	U24: ["resume", "load"],
	U12: ["kill", "cancel"],
	U17: ["a", "b", "c", "d1", "d2"],
	U18: [""],
	"U9-U19": ["U9", "U19"],
	"U14-U15-16-1": ["16-1", "U14", "U15"],
	U26: [""],
};
const at = (key, k) => (key ? `${key}.${k}` : k);
/** One sample's verdict: complete, or inconclusive with the reasons. */
function judge(f, key, reasons) {
	f[at(key, "status")] = reasons.length === 0 ? "complete" : "inconclusive";
	f[at(key, "inconclusiveBecause")] = reasons;
}

async function item(B, row, fn) {
	B.items[row] = {};
	B.facts[row] = {};
	let ok = true;
	try {
		await fn(B.items[row], B.facts[row]);
	} catch (e) {
		ok = false;
		B.items[row].fatal = errOf(e);
		B.facts[row].fatal = true;
		L("item-fatal", { backend: B.name, row, ...errOf(e) });
		await reapAll(); // a broken row leaves no agent behind, and breaks the shared chain
	}
	save();
	return ok;
}

async function runBackend(B) {
	summary.backends[B.name] = {
		model: B.model,
		thinking: B.thinking,
		items: B.items,
		facts: B.facts,
		reclaim: B.reclaim,
	};

	// ── U21: one independent session per ending; the last proven one feeds the shared chain ────────────
	let S;
	let N1;
	let live;
	await item(B, "U21", async (rec, f) => {
		f["agentKill.kind"] = "injected SIGKILL of the agent process, not a spontaneous crash";
		for (const ending of ["production", "groupKill", "agentKill"]) {
			const r = {};
			rec[ending] = r;
			const reasons = [];
			const n = nonce("KEEP");
			const c1 = startChild(B, `u21-${ending}`);
			const made = await newSession(B, c1);
			r.build = await prompt(c1, made.sid, "build", `Remember this word: ${n}. Reply with only OK.`);
			f[`${ending}.build.stopReason`] = stop(r.build);
			if (!ended(r.build)) {
				await c1.end("normal");
				judge(f, ending, ["the build did not end_turn"]);
				continue;
			}
			r.end = await c1.end(ending);
			f[`${ending}.endingProven`] = proven(r.end, ending);
			if (ending === "agentKill")
				f["agentKill.groupAfterAgentDeath"] = r.end.ending?.groupAfterAgentDeath?.length ?? null;
			if (!f[`${ending}.endingProven`]) {
				judge(f, ending, ["the ending was not proven"]);
				continue;
			}
			const { c, r: opened } = await resumeIn(B, `u21-after-${ending}`, made.sid, "resume");
			r.resume = opened;
			f[`${ending}.resume.ok`] = opened.ok;
			f[`${ending}.resume.code`] = opened.code ?? null;
			f[`${ending}.resume.echoedId`] = opened.echoedId ?? null;
			if (!answered(opened)) reasons.push("the resume got no answer");
			if (opened.ok) {
				r.recall = await prompt(c, made.sid, "recall", recallQ);
				f[`${ending}.recall.stopReason`] = stop(r.recall);
				f[`${ending}.recall`] = said(r.recall, n);
				if (!ended(r.recall)) reasons.push("the recall did not end_turn");
			}
			judge(f, ending, reasons);
			if (ended(r.recall) && f[`${ending}.recall`]) {
				if (live) await live.end("normal");
				[S, N1, live] = [made.sid, n, c];
			} else await c.end("normal");
		}
		f.chainFrom = live ? "a proven ending's resumed session" : null;
	});
	if (B.facts.U21.fatal) live = undefined;

	await item(B, "U23", async (rec, f) => {
		if (!S || !live) {
			judge(f, "", ["no live session from U21"]);
			return;
		}
		const reasons = [];
		f.scope =
			"rejections of an unknown id and of a real id on another overlay; a transient failure on the correct overlay is not measured";
		// Up to two attempts in one child; a second, and then one in a new child, only after OBSERVED
		// rejections (error frames). A success ends the sequence; so does a call that got no frame (a
		// timeout or EOF), which is indeterminate, never a rejection.
		const attempts = async (first, again, sid, tag) => {
			const out = [];
			const allRejected = () => out.length > 0 && out.every((r) => r.frame === "error");
			for (let i = 0; i < 2 && (i === 0 || allRejected()); i++)
				out.push(await open(B, first, "session/resume", sid, `${tag}-${i}`));
			if (allRejected()) {
				const next = startChild(B, `u23-${tag}-new`, again);
				await init(next);
				out.push(await open(B, next, "session/resume", sid, `${tag}-new`));
				await next.end("normal");
			}
			return out;
		};
		const codes = (rs) => rs.map((r) => (r.ok ? "ok" : r.frame === "error" ? r.code : "indeterminate"));
		const homeBefore = stateSnapshot(B.stateDir);
		const otherBefore = stateSnapshot(B.otherOverlayDir);
		const bogus = randomUUID();
		rec.unknownId = await attempts(live, undefined, bogus, "unknown");
		f["unknownId.codes"] = codes(rec.unknownId);
		const other = startChild(B, "u23-other-overlay", B.otherOverlay());
		await init(other);
		rec.otherOverlay = await attempts(other, B.otherOverlay(), S, "other");
		f["otherOverlay.realId.codes"] = codes(rec.otherOverlay);
		await other.end("normal");
		if ([...rec.unknownId, ...rec.otherOverlay].some((r) => !answered(r)))
			reasons.push("a resume attempt got no answer (indeterminate)");
		// Every entry of both overlays, not only names carrying the bogus id: [added, removed, changed].
		rec.homeDelta = stateDelta(homeBefore, stateSnapshot(B.stateDir));
		rec.otherDelta = stateDelta(otherBefore, stateSnapshot(B.otherOverlayDir));
		f["state.homeOverlay.delta"] = rec.homeDelta.counts;
		f["state.otherOverlay.delta"] = rec.otherDelta.counts;
		f["unknownId.fileCreated"] = stateFiles(B.stateDir).some((p) => p.includes(bogus));
		await live.end("normal");
		live = undefined;
		const { c, r } = await resumeIn(B, "u23-real-after", S, "resume");
		rec.realAfter = r;
		f["realId.resumeAfterRejections.ok"] = r.ok;
		f["realId.resumeAfterRejections.echoedId"] = r.echoedId ?? null;
		rec.liveConfigOptions = r.configOptions;
		if (!answered(r)) reasons.push("the resume after the rejections got no answer");
		if (!r.ok) {
			judge(f, "", reasons);
			return void (await c.end("normal"));
		}
		rec.recall = await prompt(c, S, "recall", recallQ);
		f["realId.recall"] = said(rec.recall, N1);
		if (!ended(rec.recall)) reasons.push("the recall did not end_turn");
		judge(f, "", reasons);
		live = c;
	});
	if (B.facts.U23.fatal) live = undefined;

	await item(B, "U25", async (rec, f) => {
		if (!S || !live) {
			judge(f, "", ["no live session from U23"]);
			return;
		}
		const reasons = [];
		const option = B.items.U23.liveConfigOptions?.find((o) => o.id === "model");
		rec.options = option;
		const values = optionValues(option?.options);
		// Measured from the enforced model (B.model), not the resume answer's pre-enforce value.
		const to = B.cheaperModel(values, B.model) ?? values.find((v) => v !== B.model && v !== "default");
		f["switch.offered"] = values.length;
		if (!to) {
			judge(f, "", ["no other model offered"]);
			await live.end("normal");
			live = undefined;
			return;
		}
		try {
			const answer = await live.conn.setSessionConfigOption({ sessionId: S, configId: "model", value: to });
			f["switch.ok"] = true;
			f["switch.readbackIsTarget"] = cfgOf(answer).model === to;
		} catch (e) {
			rec.switchError = errOf(e);
			f["switch.ok"] = false;
			f["switch.code"] = e.rpc?.code ?? null;
			if (frameOf(e) === "none") reasons.push("the switch got no answer");
		}
		rec.to = to;
		rec.recall = await prompt(live, S, "recall", recallQ);
		f.recall = said(rec.recall, N1);
		f["recall.stopReason"] = stop(rec.recall);
		if (!ended(rec.recall)) reasons.push("the recall did not end_turn");
		judge(f, "", reasons);
		await live.end("normal");
		live = undefined;
	});
	if (live) {
		await live.end("normal");
		live = undefined;
	}

	await item(B, "U24", async (rec, f) => {
		if (!S) {
			for (const key of ["resume", "load"]) judge(f, key, ["no session from U21"]);
			return;
		}
		const mcpServers = [
			{ name: "entwurf-171-echo", command: process.execPath, args: [join(HERE, "echo-mcp.mjs")], env: [] },
		];
		const carrier = changedCarrier(B.meta);
		f["carrier.changeable"] = carrier.changed;
		for (const method of ["session/resume", "session/load"]) {
			const key = method.split("/")[1];
			const c = startChild(B, `u24-${key}`);
			await init(c);
			const r = await open(B, c, method, S, key, { mcpServers, meta: carrier.meta });
			f[`${key}.ok`] = r.ok;
			f[`${key}.code`] = r.code ?? null;
			f[`${key}.echoedId`] = r.echoedId ?? null;
			const reasons = answered(r) ? [] : [`the ${key} got no answer`];
			if (r.ok) {
				await enforce(B, c, S);
				const N = nonce("ECHO");
				const p = await prompt(
					c,
					S,
					`${key}-ask`,
					`Call the tool echo_probe with the text ${N} and reply with only what it returned.`,
				);
				rec[key] = p;
				f[`${key}.toolSeen`] = p.d.tools.some((t) => /echo_probe/.test(String(t.title)));
				f[`${key}.answerHasNonce`] = said(p, N);
				f[`${key}.carrierPrefix`] = agentText(p).startsWith("K-B");
				if (!ended(p)) reasons.push("the echo prompt did not end_turn");
			}
			judge(f, key, reasons);
			await c.end("normal");
		}
	});

	// ── fresh-session rows ────────────────────────────────────────────────────────────────────────
	await item(B, "U12", async (rec, f) => {
		f.scope = "a vendor child's kill or cancel mid-tool; a SIGKILL of Pi itself is unmeasured";
		for (const how of ["kill", "cancel"]) {
			const r = {};
			rec[how] = r;
			const reasons = [];
			const n = nonce("CUT");
			const c1 = startChild(B, `u12-${how}`);
			const { sid } = await newSession(B, c1);
			let settled = false;
			const work = promptStart(
				c1,
				sid,
				"work",
				`Use your shell tool to run exactly this command and wait for it to finish: printf 'START-${n}\\n' >> effects.txt; sleep 30; printf 'END-${n}\\n' >> effects.txt — then reply with only DONE.`,
			).then((x) => {
				settled = true;
				return x;
			});
			await until(() => lines(`START-${n}`) > 0 || settled, 180000, 20);
			const startedAt = Date.now();
			// Read and act in one synchronous step: no answer can be taken in between.
			const started = lines(`START-${n}`) > 0;
			const pendingAtCut = !settled;
			f[`${how}.toolStarted`] = started;
			f[`${how}.pendingAtCut`] = pendingAtCut;
			if (!started) reasons.push("START never reached the file");
			if (!pendingAtCut) reasons.push("the prompt was answered before the cut");
			if (reasons.length === 0 && how === "kill") {
				r.end = await c1.end("groupKill");
				// Settled only after the child's stdout drained, so a frame written before death is seen.
				r.work = await work;
				f[`${how}.cutResponse`] = r.work.frame === "none" ? "none" : stop(r.work);
				f[`${how}.cutDrain`] = r.work.drain ?? null;
				if (r.work.frame !== "none") reasons.push("a terminal frame arrived before the kill took effect");
				else if (!noFrameProven(r.work))
					reasons.push(`no terminal frame is not proven (stdout ${r.work.drain}): a frame may be unread`);
				f[`${how}.endingProven`] = proven(r.end, "groupKill");
			} else if (reasons.length === 0) {
				// `session/cancel` is a notification; only the prompt's own terminal response with stopReason
				// `cancelled` confirms it. Three outcomes: that confirmation; an ordinary end or an error; no
				// reply by the 5 s grace deadline, after which the child is killed. The last is "outcome
				// unknown": it supports the forced-kill variant and never counts as an answered cancel.
				c1.notify("session/cancel", { sessionId: sid });
				const replied = await until(() => settled, 5000, 20);
				r.end = await c1.end(replied ? "normal" : "groupKill");
				r.work = await work;
				let outcome;
				f[`${how}.cutDrain`] = r.work.drain ?? null;
				if (!replied)
					outcome = noFrameProven(r.work)
						? "cancel outcome unknown (no reply by 5 s); forced kill"
						: r.work.frame === "none"
							? `undetermined: no frame read, but stdout ${r.work.drain}`
							: `a frame arrived during the kill: ${stop(r.work)}`;
				else if (r.work.ok && r.work.stopReason === "cancelled") outcome = "cancelled";
				else if (r.work.frame !== "none") outcome = `ended without a cancel: ${stop(r.work)}`;
				else outcome = "the child exited without a frame";
				f[`${how}.outcome`] = outcome;
				f[`${how}.variant`] =
					outcome === "cancelled"
						? "answered cancel"
						: outcome.startsWith("cancel outcome unknown")
							? "unanswered cancel, then forced kill"
							: null;
				if (f[`${how}.variant`] === null) reasons.push(`the outcome supports neither variant (${outcome})`);
				f[`${how}.endingProven`] = replied ? r.end.verified === true : proven(r.end, "groupKill");
			} else {
				r.end = await c1.end("normal");
				r.work = await work;
			}
			f[`${how}.agentRequests`] = askedIn(c1, "work");
			if (f[`${how}.endingProven`] === false) reasons.push("the ending was not proven");
			if (reasons.length > 0) {
				judge(f, how, reasons);
				continue;
			}
			// The judged state first: resume in a new child and ask. Only then read the replay.
			const { c, r: opened } = await resumeIn(B, `u12-${how}-resume`, sid, "resume");
			f[`${how}.resume.ok`] = opened.ok;
			f[`${how}.resume.code`] = opened.code ?? null;
			f[`${how}.resume.echoedId`] = opened.echoedId ?? null;
			if (!answered(opened)) reasons.push("the resume got no answer");
			if (opened.ok) {
				r.recall = await prompt(
					c,
					sid,
					"recall",
					`${RECALL_MARKER_HEAD} in the shell command I last asked you to run? Reply with that word only.`,
				);
				f[`${how}.recall`] = said(r.recall, n);
				if (!ended(r.recall)) reasons.push("the recall did not end_turn");
			}
			await c.end("normal");
			// The replay, after the judgement: the cut turn's partial assistant text and tool calls.
			const cl = startChild(B, `u12-${how}-load`);
			await init(cl);
			const l = await open(B, cl, "session/load", sid, "load");
			r.load = l;
			const cut = segmentAfter(cl.notes, "load", n, RECALL_MARKER_HEAD);
			r.loadOrder = l.window?.order ?? null;
			f[`${how}.load.ok`] = l.ok;
			f[`${how}.load.cutTurn.found`] = cut !== null;
			f[`${how}.load.cutTurn.partialText`] = cut ? cut.agentChars > 0 : null;
			f[`${how}.load.cutTurn.toolStatuses`] = cut ? cut.toolStatuses : null;
			f[`${how}.load.cutTurn.endedBy`] = cut?.endedBy ?? null;
			if (!answered(l)) reasons.push("the load got no answer");
			await cl.end("normal");
			// Did the cut command outlive its agent? Its sleep ends 30 s after START.
			await sleep(Math.max(0, 35000 - (Date.now() - startedAt)));
			f[`${how}.endWrittenBy35s`] = lines(`END-${n}`) > 0;
			judge(f, how, reasons);
		}
	});

	await item(B, "U17", async (rec, f) => {
		const ask = (n) =>
			`Use your shell tool to run exactly this command: printf 'EFFECT-${n}\\n' >> effects.txt — then reply with only DONE.`;
		const followUp = "What does effects.txt contain now? Reply with its number of lines only.";
		const statuses = (p) => p.d.tools.map((t) => t.status);

		// (a) the same request twice, each answered
		{
			const n = nonce("A");
			const c = startChild(B, "u17-a");
			const { sid } = await newSession(B, c);
			rec.a = [await prompt(c, sid, "a1", ask(n)), await prompt(c, sid, "a2", ask(n))];
			f["a.stopReasons"] = rec.a.map(stop);
			f["a.toolStatuses"] = rec.a.map(statuses);
			f["a.agentRequests"] = [askedIn(c, "a1"), askedIn(c, "a2")];
			f["a.effects"] = lines(`EFFECT-${n}`);
			judge(f, "a", rec.a.every(ended) ? [] : ["a prompt did not end_turn"]);
			await c.end("normal");
		}
		// (b) Sol's case: the effect committed, the response lost to a SIGKILL, re-sent on the same id with
		// the 16-9 payload. Re-sent only when every precondition holds; otherwise no turn is spent.
		{
			const reasons = [];
			const n = nonce("B");
			const c1 = startChild(B, "u17-b");
			const { sid } = await newSession(B, c1);
			let settled = false;
			const b1 = promptStart(c1, sid, "b1", ask(n)).then((x) => {
				settled = true;
				return x;
			});
			await until(() => markedCall(c1, "b1", `EFFECT-${n}`)?.completed || settled, 180000, 10);
			// Read and signal in one synchronous step: no answer can be taken in between.
			const call = markedCall(c1, "b1", `EFFECT-${n}`);
			const pendingAtSignal = !settled;
			const ready = call?.completed === true && pendingAtSignal;
			const ending = c1.end(ready ? "groupKill" : "normal");
			rec.bEnd = await ending;
			rec.b1 = await b1;
			f["b.call"] = call ? (call.completed ? "completed" : "not completed") : "none";
			f["b.pendingAtSignal"] = pendingAtSignal;
			f["b.b1Response"] = rec.b1.frame === "none" ? "none" : stop(rec.b1);
			f["b.b1Drain"] = rec.b1.drain ?? null;
			f["b.sigkillProven"] = ready ? proven(rec.bEnd, "groupKill") : null;
			f["b.agentRequests"] = askedIn(c1, "b1");
			f["b.effectsBeforeResend"] = lines(`EFFECT-${n}`);
			if (!call?.completed) reasons.push("the marked tool call was not reported completed");
			if (!pendingAtSignal) reasons.push("the prompt was answered before the signal");
			if (rec.b1.frame !== "none") reasons.push("a terminal frame arrived before the kill took effect");
			else if (!noFrameProven(rec.b1))
				reasons.push(`no terminal frame is not proven (stdout ${rec.b1.drain}): a frame may be unread`);
			if (ready && !f["b.sigkillProven"]) reasons.push("the SIGKILL was not proven");
			if (f["b.effectsBeforeResend"] !== 1) reasons.push("not exactly one line before the re-send");
			if (reasons.length === 0) {
				const { c, r } = await resumeIn(B, "u17-b-resume", sid, "resume");
				f["b.resume.ok"] = r.ok;
				f["b.resume.echoedId"] = r.echoedId ?? null;
				if (!r.ok) reasons.push(answered(r) ? "the same id did not resume" : "the resume got no answer");
				if (r.echoedId === "different") reasons.push("the resume answered another session id");
				if (reasons.length === 0) {
					rec.b = await prompt(c, sid, "b2", [
						{ type: "text", text: ask(n) },
						{ type: "text", text: followUp },
					]);
					f["b.resend.stopReason"] = stop(rec.b);
					f["b.resend.toolStatuses"] = statuses(rec.b);
					f["b.resend.agentRequests"] = askedIn(c, "b2");
					f["b.effects"] = lines(`EFFECT-${n}`);
					f["b.effectsAddedByResend"] = f["b.effects"] - 1;
					if (!ended(rec.b)) reasons.push("the re-send did not end_turn");
				}
				await c.end("normal");
			}
			judge(f, "b", reasons);
		}
		// (c) the effect committed, the turn still pending, then a `cancelled` answer; re-sent in the same child
		{
			const reasons = [];
			const n = nonce("C");
			const c = startChild(B, "u17-c");
			const { sid } = await newSession(B, c);
			let settled = false;
			const c1 = promptStart(c, sid, "c1", ask(n)).then((x) => {
				settled = true;
				return x;
			});
			await until(() => markedCall(c, "c1", `EFFECT-${n}`)?.completed || settled, 180000, 10);
			const call = markedCall(c, "c1", `EFFECT-${n}`);
			const pendingAtCancel = !settled;
			if (call?.completed && pendingAtCancel) c.notify("session/cancel", { sessionId: sid });
			const reply = await Promise.race([c1, sleep(30000).then(() => null)]);
			rec.c1 = reply;
			f["c.call"] = call ? (call.completed ? "completed" : "not completed") : "none";
			f["c.pendingAtCancel"] = pendingAtCancel;
			f["c.cancelResponse"] = reply ? stop(reply) : "outcome unknown (no terminal response within 30 s)";
			f["c.agentRequests"] = askedIn(c, "c1");
			f["c.effectsBeforeResend"] = lines(`EFFECT-${n}`);
			if (!call?.completed) reasons.push("the marked tool call was not reported completed");
			if (!pendingAtCancel) reasons.push("the prompt was answered before the cancel");
			if (reply?.stopReason !== "cancelled") reasons.push("no confirmed cancel (a terminal response with cancelled)");
			if (f["c.effectsBeforeResend"] !== 1) reasons.push("not exactly one line before the re-send");
			if (reasons.length === 0) {
				rec.c = await prompt(c, sid, "c2", [
					{ type: "text", text: ask(n) },
					{ type: "text", text: followUp },
				]);
				f["c.resend.stopReason"] = stop(rec.c);
				f["c.resend.toolStatuses"] = statuses(rec.c);
				f["c.resend.agentRequests"] = askedIn(c, "c2");
				f["c.effects"] = lines(`EFFECT-${n}`);
				f["c.effectsAddedByResend"] = f["c.effects"] - 1;
				if (!ended(rec.c)) reasons.push("the re-send did not end_turn");
			}
			judge(f, "c", reasons);
			await c.end("normal");
		}
		// (d) Adviser B's case (#O33): an ANSWERED cancel of X, then a DIFFERENT request Y, in the same
		// child. d1 sends Y alone (today's kept-cancel behaviour, context.ts:84-85); d2 sends X then Y
		// (decision 16-9 as written). The vendor's own session already holds X after the cancel; the U12
		// cancel case's load replay reads that. Preconditions as in (c): X's marked tool call completed,
		// the turn still pending at the cancel, an actual `cancelled` answer, exactly one X line.
		const askLine = (line) =>
			`Use your shell tool to run exactly this command: printf '${line}\\n' >> effects.txt — then reply with only DONE.`;
		f["d1.label"] = "B's cancel-then-correct: X, a confirmed cancel, then only the correction Y; X not re-run";
		f["d2.label"] = "16-9 as written: X, a confirmed cancel, then X re-sent before Y";
		for (const variant of ["d1", "d2"]) {
			const reasons = [];
			const n = nonce(variant.toUpperCase());
			const [X, Y] = [`X-${n}`, `Y-${n}`];
			const c = startChild(B, `u17-${variant}`);
			const { sid } = await newSession(B, c);
			let settled = false;
			const first = promptStart(c, sid, `${variant}-x`, askLine(X)).then((x) => {
				settled = true;
				return x;
			});
			await until(() => markedCall(c, `${variant}-x`, X)?.completed || settled, 180000, 10);
			const call = markedCall(c, `${variant}-x`, X);
			const pendingAtCancel = !settled;
			if (call?.completed && pendingAtCancel) c.notify("session/cancel", { sessionId: sid });
			const reply = await Promise.race([first, sleep(30000).then(() => null)]);
			rec[`${variant}x`] = reply;
			f[`${variant}.xCall`] = call ? (call.completed ? "completed" : "not completed") : "none";
			f[`${variant}.pendingAtCancel`] = pendingAtCancel;
			f[`${variant}.cancelResponse`] = reply ? stop(reply) : "outcome unknown (no terminal response within 30 s)";
			f[`${variant}.xAgentRequests`] = askedIn(c, `${variant}-x`);
			f[`${variant}.xLinesBeforeNext`] = lines(X);
			if (!call?.completed) reasons.push("X's marked tool call was not reported completed");
			if (!pendingAtCancel) reasons.push("X was answered before the cancel");
			if (reply?.stopReason !== "cancelled") reasons.push("no confirmed cancel (a terminal response with cancelled)");
			if (f[`${variant}.xLinesBeforeNext`] !== 1) reasons.push("not exactly one X line before the next request");
			if (reasons.length === 0) {
				const next =
					variant === "d1"
						? [{ type: "text", text: askLine(Y) }]
						: [
								{ type: "text", text: askLine(X) },
								{ type: "text", text: askLine(Y) },
							];
				rec[variant] = await prompt(c, sid, `${variant}-next`, next);
				f[`${variant}.next.payload`] = variant === "d1" ? "Y only" : "X then Y";
				f[`${variant}.next.stopReason`] = stop(rec[variant]);
				f[`${variant}.next.toolStatuses`] = statuses(rec[variant]);
				f[`${variant}.next.agentRequests`] = askedIn(c, `${variant}-next`);
				f[`${variant}.xLines`] = lines(X);
				f[`${variant}.yLines`] = lines(Y);
				// The next request's own X effect (d2 re-sends X; d1 must add none).
				f[`${variant}.xAddedByNext`] = f[`${variant}.xLines`] - f[`${variant}.xLinesBeforeNext`];
				if (!ended(rec[variant])) reasons.push("the next request did not end_turn");
				if (f[`${variant}.yLines`] !== 1) reasons.push("Y did not appear exactly once");
			}
			judge(f, variant, reasons);
			await c.end("normal");
		}
	});

	await item(B, "U18", async (rec, f) => {
		f.proxy = "invalid input (a block type neither agent advertises), not an in-flight vendor failure";
		const n = nonce("ERR");
		const c = startChild(B, "u18");
		const { sid } = await newSession(B, c);
		rec.plant = await prompt(c, sid, "plant", `Remember this word: ${n}. Reply with only OK.`);
		rec.bad = await prompt(c, sid, "bad", [{ type: "audio", data: "UklGRiQAAABXQVZF", mimeType: "audio/wav" }]);
		f["bad.ok"] = rec.bad.ok;
		f["bad.code"] = rec.bad.error?.rpc?.code ?? null;
		f["bad.stopReason"] = rec.bad.stopReason ?? null;
		f.childAlive = c.isAlive();
		const reasons = [];
		if (!ended(rec.plant)) reasons.push("the plant did not end_turn");
		if (!answered(rec.bad)) reasons.push("the invalid block got no answer");
		// A child the invalid block killed is a result; then there is nothing to recall from.
		if (f.childAlive) {
			rec.recall = await prompt(c, sid, "recall", recallQ);
			f["recall.ok"] = rec.recall.ok;
			f.recall = said(rec.recall, n);
			if (!ended(rec.recall)) reasons.push("the recall did not end_turn");
		}
		judge(f, "", reasons);
		await c.end("normal");
	});

	await item(B, "U9-U19", async (_rec, f) => {
		const n = nonce("TWO");
		const c1 = startChild(B, "u9-build");
		const { sid } = await newSession(B, c1);
		const plant = await prompt(c1, sid, "plant", `Remember this word: ${n}. Reply with only OK.`);
		await c1.end("normal");
		if (!ended(plant)) {
			for (const key of ["U9", "U19"]) judge(f, key, ["the plant did not end_turn"]);
			return;
		}
		const u9 = [];
		const a = await resumeIn(B, "u9-holder-a", sid, "resume");
		const b = await resumeIn(B, "u9-holder-b", sid, "resume");
		f["U9.bothResumed"] = a.r.ok && b.r.ok;
		f["U9.echoedIds"] = [a.r.echoedId ?? null, b.r.echoedId ?? null];
		if (!answered(a.r) || !answered(b.r)) u9.push("a holder's resume got no answer");
		if (a.r.ok && b.r.ok) {
			const [pa, pb] = await Promise.all([
				prompt(a.c, sid, "both-a", "Reply with only the word ALPHA."),
				prompt(b.c, sid, "both-b", "Reply with only the word BETA."),
			]);
			f["U9.stopReasons"] = [stop(pa), stop(pb)];
			if (!answered(pa) || !answered(pb)) u9.push("a holder's prompt got no answer");
		}
		await a.c.end("normal");
		await b.c.end("normal");
		const third = await resumeIn(B, "u9-third", sid, "resume");
		if (!answered(third.r)) u9.push("the third resume got no answer");
		if (third.r.ok) {
			const p = await prompt(third.c, sid, "recall", recallQ);
			f["U9.recallAfter"] = said(p, n);
			if (!ended(p)) u9.push("the recall did not end_turn");
		}
		await third.c.end("normal");
		judge(f, "U9", u9);
		// U19: the client of a holder dies without signalling it; another child resumes meanwhile.
		const u19 = [];
		const orphan = await resumeIn(B, "u19-orphan", sid, "resume");
		if (!orphan.r.ok) u19.push("the holder to orphan did not resume");
		else {
			f["U19.orphanAliveAfter3s"] = (await orphan.c.orphan()).aliveAfter3s;
			const next = await resumeIn(B, "u19-next", sid, "resume");
			f["U19.resumeWhileOrphan.ok"] = next.r.ok;
			if (!answered(next.r)) u19.push("the resume beside the orphan got no answer");
			if (next.r.ok) {
				const p = await prompt(next.c, sid, "recall", recallQ);
				f["U19.recall"] = said(p, n);
				if (!ended(p)) u19.push("the recall did not end_turn");
			}
			await next.c.end("normal");
		}
		await orphan.c.end("normal");
		judge(f, "U19", u19);
	});

	await item(B, "U14-U15-16-1", async (rec, f) => {
		const n = nonce("CMP");
		const c = startChild(B, "u14");
		const { sid } = await newSession(B, c);
		rec.plant = await prompt(c, sid, "plant", `Remember this word: ${n}. Reply with only OK.`);
		rec.compact = await prompt(c, sid, "compact", "/compact");
		f["16-1.compact.compactions"] = rec.compact.d.compactions;
		f["16-1.compact.stopReason"] = stop(rec.compact);
		rec.recall = await prompt(c, sid, "recall", recallQ);
		f["16-1.recallAfterCompact"] = said(rec.recall, n);
		rec.multi = await prompt(c, sid, "multi", [
			{ type: "text", text: "/compact" },
			{ type: "text", text: recallQ },
		]);
		f["U14.multiBlock.compactions"] = rec.multi.d.compactions;
		f["U14.multiBlock.secondBlockAnswered"] = said(rec.multi, n);
		await c.end("normal");
		const r161 = [];
		if (!ended(rec.plant)) r161.push("the plant did not end_turn");
		if (!answered(rec.compact)) r161.push("the /compact got no answer");
		if (!ended(rec.recall)) r161.push("the recall did not end_turn");
		judge(f, "16-1", r161);
		judge(f, "U14", answered(rec.multi) ? [] : ["the two-block prompt got no answer"]);
		const c2 = startChild(B, "u15");
		const fresh = await newSession(B, c2);
		rec.fresh = await prompt(c2, fresh.sid, "fresh", "/compact");
		f["U15.freshSession.compactions"] = rec.fresh.d.compactions;
		f["U15.freshSession.stopReason"] = stop(rec.fresh);
		judge(f, "U15", answered(rec.fresh) ? [] : ["the /compact on a fresh session got no answer"]);
		await c2.end("normal");
	});

	// U26: complete when the crossing happened as named (the chosen version pair, the planted nonce, a
	// resume that got a frame, and a recall that ended its turn). `success` is then the result: whether
	// the session crossed versions with its memory.
	await item(B, "U26", async (rec, f) => {
		const inconclusive = (why) => judge(f, "", [why]);
		if (B.name === "claude") {
			if (!process.env.ENTWURF_RAW_CLAUDE_ACP_PREFIX) return inconclusive("no prefix given: nothing to cross");
			const pinned = summary.provenance?.pinnedClaudeAcp?.version ?? null;
			const measured = summary.provenance?.claudeAcp?.version ?? null;
			f.namedPair = [pinned, measured];
			if (pinned === null || measured === null || pinned === measured)
				return inconclusive("provenance does not name two different versions");
			const n = nonce("XV");
			const c1 = startChild(B, "u26-pinned", { args: B.pinnedArgs });
			const made = await newSession(B, c1);
			rec.plant = await prompt(c1, made.sid, "plant", `Remember this word: ${n}. Reply with only OK.`);
			await c1.end("normal");
			if (!ended(rec.plant)) return inconclusive(`the build did not end_turn (${stop(rec.plant)})`);
			const { c, r, version: to } = await resumeIn(B, "u26-measured", made.sid, "resume");
			f.versionPair = [made.version, to];
			f.pairAsNamed = made.version === pinned && to === measured;
			f["resume.ok"] = r.ok;
			f["resume.code"] = r.code ?? null;
			f["resume.echoedId"] = r.echoedId ?? null;
			const reasons = [];
			if (!f.pairAsNamed) reasons.push("the versions that answered are not the named pair");
			if (!answered(r)) reasons.push("the resume got no answer");
			if (r.ok && f.pairAsNamed) {
				rec.recall = await prompt(c, made.sid, "recall", recallQ);
				f["recall.stopReason"] = stop(rec.recall);
				f.recall = said(rec.recall, n);
				if (!ended(rec.recall)) reasons.push("the recall did not end_turn");
			}
			judge(f, "", reasons);
			f.success = reasons.length === 0 ? r.ok && r.echoedId !== "different" && f.recall === true : null;
			await c.end("normal");
			return;
		}
		const source = process.env.ENTWURF_RAW_U26_AGY_SOURCE;
		if (!source) return inconclusive("no stored agy run given");
		// The pair is chosen by the operator, "<stored>:<launched>"; any other pair is not this sample.
		const [from, toNamed] = (process.env.ENTWURF_RAW_U26_AGY_PAIR ?? "").split(":");
		f.namedPair = [from || null, toNamed || null];
		if (!from || !toNamed || from === toNamed)
			return inconclusive("no agy version pair named (ENTWURF_RAW_U26_AGY_PAIR=<stored>:<launched>)");
		const stored = readStoredAgySession(source);
		rec.stored = stored;
		if (!stored?.sessionId || !stored.planted || !stored.version)
			return inconclusive("the stored run does not name a session, a planted word and a version");
		if (stored.version !== from) return inconclusive(`the stored run is ${stored.version}, not the named ${from}`);
		f["stored.agentName"] = stored.agentName;
		// The resumed session was created under the stored run's cwd; this run resumes under its own.
		f.cwdChanged = stored.cwd !== scratch;
		const copy = join(RUN, "home/.pi/agent/agy-gemini-overlay-u26");
		const launch = B.overlayAt(copy);
		// Anchored at the resolved stored-run directory: home/.pi/agent/agy-gemini-overlay is lstat()ed
		// component by component, never followed through a symlink.
		rec.copied = copySessionState(
			source,
			"home/.pi/agent/agy-gemini-overlay",
			copy,
			agySessionEntries(stored.sessionId),
		);
		f.copiedFiles = rec.copied.length;
		f["identity.conversationCopied"] = rec.copied.includes(`antigravity-cli/conversations/${stored.sessionId}.db`);
		if (!f["identity.conversationCopied"]) return inconclusive("the stored conversation was not copied");
		const { c, r, version: to } = await resumeIn(B, "u26-measured", stored.sessionId, "resume", launch);
		f.versionPair = [stored.version, to];
		f.pairAsNamed = stored.version === from && to === toNamed;
		f["resume.ok"] = r.ok;
		f["resume.code"] = r.code ?? null;
		f["resume.echoedId"] = r.echoedId ?? null;
		const reasons = [];
		if (!f.pairAsNamed) reasons.push("the versions that answered are not the named pair");
		if (!answered(r)) reasons.push("the resume got no answer");
		if (r.ok && f.pairAsNamed) {
			rec.recall = await prompt(c, stored.sessionId, "recall", recallQ);
			f["recall.stopReason"] = stop(rec.recall);
			f.recall = said(rec.recall, stored.planted);
			if (!ended(rec.recall)) reasons.push("the recall did not end_turn");
		}
		judge(f, "", reasons);
		f.success = reasons.length === 0 ? r.ok && r.echoedId !== "different" && f.recall === true : null;
		await c.end("normal");
	});
	await reapAll(); // nothing of this backend outlives its rows
}

// ── run: interrupts, survivors and the exit code are facts of the run itself ───────────────────────
const overlays = {};
let finishing = false;
async function finish(reason) {
	if (finishing) return;
	finishing = true;
	closeHarness(); // a row still running cannot start another child
	await reapAll();
	// Only processes carrying this run's token are killed; anything else under the run is reported.
	const left = await survivors();
	const fatalRows = Object.entries(summary.backends).flatMap(([b, x]) =>
		Object.entries(x.facts)
			.filter(([, f]) => f.fatal)
			.map(([row]) => `${b}:${row}`),
	);
	// Measurement completeness, apart from cleanup: every mandatory sample of every requested backend.
	const incomplete = (ONLY ? [ONLY] : ["claude", "agy"]).flatMap((b) =>
		Object.entries(SAMPLES).flatMap(([row, keys]) =>
			keys.flatMap((key) => {
				const facts = summary.backends[b]?.facts?.[row];
				const status = facts?.[at(key, "status")];
				if (status === "complete") return [];
				const why = status === undefined ? "missing" : (facts[at(key, "inconclusiveBecause")] ?? []).join("; ");
				return [`${b}:${row}${key ? `.${key}` : ""}: ${why}`];
			}),
		),
	);
	summary.mtimeAfter = { agyToken: mt(TOKEN), claudeCred: mt(CLAUDE_CRED) };
	summary.linkTargetsAfter = linkTargetMtimes(overlays);
	summary.run = {
		fatalRows,
		unverifiedReaps: unverifiedReaps(),
		processesUnderRunAtEnd: [...left.owned, ...left.foreign],
		foreignUnderRun: left.foreign,
		ownedLeftAfterKill: left.ownedLeftAfterKill,
		interrupted: reason ?? null,
		incomplete,
	};
	save();
	const clean =
		fatalRows.length === 0 &&
		summary.run.unverifiedReaps.length === 0 &&
		summary.run.processesUnderRunAtEnd.length === 0 &&
		summary.run.ownedLeftAfterKill === 0 &&
		!reason;
	const complete = incomplete.length === 0;
	console.log(JSON.stringify({ ok: clean && complete, clean, complete, run: RUN, ...summary.run }));
	process.exit(!clean ? 1 : complete ? 0 : 4);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
	process.on(sig, () => {
		L("interrupted", { sig });
		void finish(sig);
	});

try {
	const built = [];
	for (const [name, make] of [
		["claude", claudeBackend],
		["agy", agyBackend],
	]) {
		if (ONLY && ONLY !== name) continue;
		const B = make();
		overlays[`${B.name}`] = B.stateDir;
		overlays[`${B.name}-B`] = B.otherOverlayDir;
		built.push(B);
	}
	summary.linkTargetsBefore = linkTargetMtimes(overlays);
	for (const B of built) {
		L("backend-start", { backend: B.name });
		await runBackend(B);
	}
} catch (e) {
	summary.mainError = errOf(e);
	L("main-error", errOf(e));
	summary.backends.main = { facts: { main: { fatal: true } } };
} finally {
	await finish();
}
