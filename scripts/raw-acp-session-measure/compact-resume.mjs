// #175 M1/M3 — does a vendor session that was RESUMED compact itself on a `/compact` prompt sent alone, and how
// much does its occupancy fall? NOT a gate.
//
//   LIVE=1 [PROBE_MODEL=<id>] [ENTWURF_RAW_FILLER_TOKENS=<n>] [ENTWURF_RAW_COMPACT_REPEAT=<1-3>] \
//     scripts/raw-acp-session-measure/run.sh compact-resume <out-dir> [claude|agy]
//
// Raw JSON-RPC over the production overlay, adapter and enforce functions (harness.mjs), as continuity.mjs:
//   child 1: session/new, a plant prompt (a codeword and a filler of about ENTWURF_RAW_FILLER_TOKENS words,
//            default 40000), one short prompt (U0 = its last usage_update.used), then the production close;
//   child 2: session/resume of that id, `/compact` as the only block of one prompt (#171 U14), a recall prompt
//            (U1) and one more short prompt (U2).
// ENTWURF_RAW_COMPACT_REPEAT=2 or 3 (#175 D-3) sends `/compact` alone that many times in a row on the resumed
// session (`compact`, `compact2`, `compact3`: the later ones meet a session already compacted) and skips the
// last short prompt; with a small filler it asks what a vendor answers when there is little or nothing left
// to compact.
// Recorded per prompt: stopReason, PromptResponse.usage, every compaction frame, every usage_update.used;
// for Claude also the vendor's own transcript (assistant occupancy and compact boundaries).
// The fixed reading (#175): GREEN when U1 <= 0.5 * U0 and U0 - U1 >= 30000, RED when U1 >= 0.9 * U0, else
// reported; U0 below 80000 is inconclusive. Exit 0 when the run reached its end (a "no" is a result), 1 when
// a child was not reaped or a process survived, 3 on a fatal error.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	agyBin,
	CLAUDE_CRED,
	claudeLauncherArg,
	D,
	mt,
	REAL_CLAUDE,
	REAL_GEMINI,
	REPO,
	RUN,
	TOKEN,
} from "./common.mjs";
import {
	closeHarness,
	errOf,
	init,
	open,
	prompt,
	reapAll,
	scratch,
	sessParams,
	startChild,
	survivors,
	unverifiedReaps,
} from "./harness.mjs";

const BACKEND = process.argv[3] === "agy" ? "agy" : "claude";
if (process.argv[3] !== undefined && process.argv[3] !== "claude" && process.argv[3] !== "agy")
	throw new Error(`backend filter must be claude or agy: ${process.argv[3]}`);
const MODEL = process.env.PROBE_MODEL ?? (BACKEND === "agy" ? "gemini-3.8-flash" : "claude-sonnet-5-5");
if (!/^[\w.-]+$/.test(MODEL)) throw new Error(`PROBE_MODEL must be a model id: ${MODEL}`);
const FILLER_TOKENS = Number(process.env.ENTWURF_RAW_FILLER_TOKENS ?? 40_000);
// agy took about 57k tokens of one prompt block whatever its length (#175, 2026-11-25, n=2): a larger context
// is planted as ENTWURF_RAW_PLANT_PARTS prompts, each with the filler.
const PARTS = Number(process.env.ENTWURF_RAW_PLANT_PARTS ?? 1);
if (!Number.isInteger(PARTS) || PARTS < 1 || PARTS > 4)
	throw new Error(`ENTWURF_RAW_PLANT_PARTS must be 1-4: ${PARTS}`);
const REPEAT = Number(process.env.ENTWURF_RAW_COMPACT_REPEAT ?? 1);
if (!Number.isInteger(REPEAT) || REPEAT < 1 || REPEAT > 3)
	throw new Error(`ENTWURF_RAW_COMPACT_REPEAT must be 1-3: ${REPEAT}`);
if (!Number.isInteger(FILLER_TOKENS) || FILLER_TOKENS < 1000)
	throw new Error(`ENTWURF_RAW_FILLER_TOKENS must be an integer >= 1000: ${FILLER_TOKENS}`);

const ov = await import(join(D, "overlay.js"));
const BA = await import(join(D, "backend-adapter.js"));
const { resolveProviderConfig, mcpServerNames } = await import(join(D, "config.js"));
const SRC_LAUNCHER = join(REPO, "pi-extensions/lib/acp/claude-acp-launch.js");

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
	const launch = BA.claudeAdapter.resolveLaunch({ nativeModelId: MODEL, config });
	return {
		name: "claude",
		adapter: BA.claudeAdapter,
		model: MODEL,
		thinking: "low",
		command: launch.command,
		args: launch.args.map((a) => claudeLauncherArg(a, SRC_LAUNCHER)),
		env: { ...process.env, ...BA.claudeAdapter.launchEnvDefaults() },
		meta: BA.claudeAdapter.buildSessionMeta({ modelId: MODEL, nativeModelId: MODEL, config }, carrier),
		stateDir,
		reclaim: [],
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
	return {
		name: "agy",
		adapter: BA.agyAdapter,
		model: MODEL,
		thinking: "low",
		command: agyBin(),
		args: BA.agyLaunchArgs(stateDir),
		env: { ...process.env },
		meta: BA.agyAdapter.buildSessionMeta({}, carrier),
		stateDir,
		reclaim: [],
	};
}

/** Production enforceModel (with `resumedAttach` as production passes it) and enforceThinking. */
async function enforce(B, c, sid, resumedAttach) {
	const out = {};
	try {
		await B.adapter.enforceModel({
			connection: c.conn,
			acpSessionId: sid,
			nativeModelId: B.model,
			modelId: B.model,
			resumedAttach,
		});
		out.model = "accepted";
	} catch (e) {
		out.model = errOf(e);
	}
	try {
		await B.adapter.enforceThinking({ connection: c.conn, acpSessionId: sid, modelId: B.model, value: B.thinking });
		out.thinking = "accepted";
	} catch (e) {
		out.thinking = errOf(e);
	}
	return out;
}

// The same deterministic filler as pi-compact.mjs.
const WORDS =
	"amber basalt cedar delta ember fjord granite harbor indigo juniper kelp lantern meadow nickel orchard pewter quartz raven saffron tundra umber velvet walnut xenon yarrow zephyr anchor bramble copper drizzle estuary falcon glacier heron iris jasper kestrel lichen marble nectar onyx prairie quill reef sorrel thistle".split(
		" ",
	);
let seed = 175;
const next = () => {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed;
};
const lines = [];
for (let i = 0; i < Math.ceil(FILLER_TOKENS / 16); i++) {
	lines.push(
		`L${String(i).padStart(5, "0")} ${Array.from({ length: 11 }, () => WORDS[next() % WORDS.length]).join(" ")}.`,
	);
}
const filler = lines.join("\n");
const word = `KESTREL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

/** One prompt's facts: its ending, usage, compaction frames and every `used` reported in its phase. */
function facts(c, phase, p) {
	const ns = c.notes.filter((n) => n.phase === phase);
	const used = ns.filter((n) => n.kind === "usage_update").map((n) => n.used);
	return {
		ok: p.ok,
		stopReason: p.stopReason ?? null,
		error: p.ok ? null : (p.error ?? null),
		ms: p.ms,
		usage: p.usage ?? null,
		used,
		lastUsed: used.at(-1) ?? null,
		compactionFrames: ns.filter((n) => n.compaction).map((n) => n.compaction),
		kinds: p.d?.order ?? [],
		text: String(p.d?.text?.agent_message_chunk ?? "").slice(0, 300),
	};
}

function vendorTranscripts(stateDir) {
	const root = join(stateDir, "projects");
	const out = {};
	if (!existsSync(root)) return out;
	for (const d of readdirSync(root)) {
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
					const last = rows.at(-1);
					if (last?.kind === "assistant" && last.id === e.message.id) continue;
					rows.push({
						kind: "assistant",
						at: e.timestamp,
						id: e.message.id,
						occupancy: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
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

const summary = {
	backend: BACKEND,
	model: MODEL,
	fillerTokensRequested: FILLER_TOKENS,
	fillerChars: filler.length,
	plantParts: PARTS,
	compactRepeat: REPEAT,
	word,
	mtimeBefore: { claude: mt(CLAUDE_CRED), agy: mt(TOKEN) },
	phases: {},
	checks: {},
	run: {},
};
let status = 0;
try {
	const B = BACKEND === "agy" ? agyBackend() : claudeBackend();
	const c1 = startChild(B, "birth");
	summary.run.initialize1 = (await init(c1))?.agentInfo ?? null;
	const created = await c1.rpc("session/new", sessParams(B, {}), 60_000);
	const sid = created.sessionId;
	summary.run.sessionId = sid;
	summary.run.enforce1 = await enforce(B, c1, sid, false);
	const plant = await prompt(
		c1,
		sid,
		"plant",
		`Remember this codeword for later: ${word}. Below is reference material for later questions; do not summarize or repeat it. Reply with exactly: OK\n\n${filler}`,
	);
	summary.phases.plant = facts(c1, "plant", plant);
	for (let part = 2; part <= PARTS; part++) {
		const more = await prompt(
			c1,
			sid,
			`plant${part}`,
			`Part ${part} of the reference material; do not summarize or repeat it. Reply with exactly: OK\n\n${filler}`,
		);
		summary.phases[`plant${part}`] = facts(c1, `plant${part}`, more);
	}
	const ready = await prompt(c1, sid, "ready", "Reply with exactly: READY");
	summary.phases.ready = facts(c1, "ready", ready);
	summary.run.end1 = await c1.end("normal");

	const c2 = startChild(B, "resume");
	summary.run.initialize2 = (await init(c2))?.agentInfo ?? null;
	const resumed = await open(B, c2, "session/resume", sid, "resume");
	summary.run.resume = {
		ok: resumed.ok,
		error: resumed.ok ? null : (resumed.error ?? null),
		echoedId: resumed.echoedId ?? null,
	};
	if (resumed.ok) {
		summary.run.enforce2 = await enforce(B, c2, sid, true);
		for (let n = 1; n <= REPEAT; n++) {
			const name = n === 1 ? "compact" : `compact${n}`;
			const compact = await prompt(c2, sid, name, "/compact");
			summary.phases[name] = facts(c2, name, compact);
		}
		const recall = await prompt(c2, sid, "recall", "What is the codeword I gave you? Reply with the codeword alone.");
		summary.phases.recall = facts(c2, "recall", recall);
		if (REPEAT === 1) {
			const after = await prompt(c2, sid, "after", "Reply with exactly: DONE");
			summary.phases.after = facts(c2, "after", after);
		}
	}
	summary.run.end2 = await c2.end("normal");

	const U0 = summary.phases.ready?.lastUsed ?? null;
	const U1 = summary.phases.recall?.lastUsed ?? null;
	const U2 = summary.phases.after?.lastUsed ?? null;
	summary.run.U = { U0, U1, U2, compactTurnUsed: summary.phases.compact?.used ?? null };
	if (BACKEND === "claude") summary.run.vendor = vendorTranscripts(B.stateDir);
	const judged = U0 !== null && U1 !== null && U0 >= 80_000;
	summary.checks = {
		resumeOk: resumed.ok === true,
		compactEnded: summary.phases.compact?.stopReason === "end_turn",
		compactionFrameSeen: (summary.phases.compact?.compactionFrames.length ?? 0) > 0,
		recallKeptCodeword: (summary.phases.recall?.text ?? "").includes(word),
		U0AtLeast80k: U0 !== null && U0 >= 80_000,
		green: judged && U1 <= 0.5 * U0 && U0 - U1 >= 30_000,
		red: judged && U1 >= 0.9 * U0,
	};
} catch (error) {
	summary.run.fatal = String(error?.stack ?? error);
	status = 3;
	await reapAll();
}
closeHarness();
summary.run.unverifiedReaps = unverifiedReaps();
summary.run.survivors = survivors();
if (status === 0 && (summary.run.unverifiedReaps.length > 0 || summary.run.survivors.owned?.length > 0)) status = 1;
summary.mtimeAfter = { claude: mt(CLAUDE_CRED), agy: mt(TOKEN) };
writeFileSync(join(RUN, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
	JSON.stringify(
		{ status, U: summary.run.U ?? null, checks: summary.checks, fatal: summary.run.fatal ?? null },
		null,
		2,
	),
);
process.exit(status);
