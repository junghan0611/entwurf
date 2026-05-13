#!/usr/bin/env -S node --experimental-strip-types
/**
 * compaction-policy-smoke.ts — 0.5.0 compaction policy verification.
 *
 * 0.5.0 declares:
 *
 *   pi-shell-acp does not implement compaction. ACP backends compact
 *   natively; the pi session survives that. The bridge boundary stays
 *   explicit. pi-side JSONL compaction stays blocked (it would not
 *   reduce the backend transcript).
 *
 * Six steps prove the surface:
 *
 *   01  spawn intent has no backend compaction guard by default
 *       (Claude env DISABLE_AUTO_COMPACT/DISABLE_COMPACT absent,
 *        Codex argv `model_auto_compact_token_limit=…` absent).
 *
 *   02  pi-side guard message is honest about the boundary
 *       — it tells the operator that pi-side compact does not
 *         reduce the backend transcript, and points at the
 *         backend-native interface for actual compaction.
 *
 *   03  live: Claude ACP session survives a backend `/compact`
 *       — under LIVE=1 the script drives a real ACP session through
 *         `runEntwurfSync` + `runEntwurfResumeSync`:
 *           (a) plant a unique sentinel token + assert READY,
 *           (b) send literal `/compact` as a backend prompt (NOT pi-host
 *               /compact — entwurf delivers the string as a normal
 *               user message into the ACP child),
 *           (c) send a recall prompt and assert the sentinel survives.
 *         The same `taskId` is used across (a)→(b)→(c), so reuse of the
 *         persisted `pi:<sessionId>` → `acpSessionId` mapping is part of
 *         what is being verified.
 *
 *   04  live: same driver against the Codex adapter.
 *
 *   05  legacy `PI_SHELL_ACP_ALLOW_COMPACTION=1` is a hard throw
 *       with a next-action message (split into ALLOW_PI_COMPACTION
 *       and DISABLE_BACKEND_COMPACTION).
 *
 *   06  `PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION=1` escape hatch
 *       restores 0.4.x guards (Claude env keys reappear, Codex
 *       argv pin reappears) so an operator with a misbehaving
 *       backend has a documented way back.
 *
 * Steps 01, 02, 05, 06 are deterministic — they exercise pure spawn
 * intent + message strings against the bridge module. Steps 03 and 04
 * are live and require LIVE=1; they spawn a real ACP child via the
 * entwurf path (the same infrastructure used by cross-cwd-resume-smoke)
 * and send three prompts in sequence. Cost is a few cents per backend
 * and the script touches the operator's authenticated state, so the
 * step is gated behind LIVE=1 and does not run as part of the default
 * pre-commit smoke. Steps 03 and 04 do NOT introduce a user-facing
 * `/acp-compact` command — they are a release-evidence probe, not a
 * product surface.
 *
 * Gemini is intentionally not covered here. Whether Gemini's ACP
 * surface treats a literal `/compact` prompt as a native compaction
 * command is unverified, so 0.5.0 limits its survives-compact claim to
 * Claude + Codex. Gemini coverage lives in BASELINE follow-up.
 *
 * Output:
 *   - Every step emits a single human-readable block followed by a
 *     final line `RESULT NN: pass | fail — reason | observed — note`.
 *   - End: `SUMMARY: P pass, F fail, O observed`.
 *   - Exit code: non-zero iff any deterministic step fails. Observed
 *     steps never fail this gate by themselves — they are records,
 *     not pass/fail.
 *
 * Tone: this smoke is shaped like the entwurf_resume message
 * (entwurf already exists → use entwurf_resume). It does not paper
 * over a missing knob; it tells you what is happening and what to do.
 *
 * Usage:
 *   node --experimental-strip-types scripts/compaction-policy-smoke.ts
 *   node --experimental-strip-types scripts/compaction-policy-smoke.ts --step=01
 *   LIVE=1 node --experimental-strip-types scripts/compaction-policy-smoke.ts
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
	isBackendCompactionDisabledByOperator,
	resolveAcpBackendLaunch,
	resolveBridgeEnvDefaults,
} from "../acp-bridge.ts";
import { analyzeSessionFileLike, runEntwurfResumeSync, runEntwurfSync } from "../pi-extensions/lib/entwurf-core.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_DIR = resolvePath(__dirname, "..");

type StepOutcome = "pass" | "fail" | "observed";

interface StepResult {
	id: string;
	title: string;
	outcome: StepOutcome;
	detail: string;
}

const ALL_STEPS = ["01", "02", "03", "04", "05", "06", "07"] as const;
type StepId = (typeof ALL_STEPS)[number];

const args = process.argv.slice(2);
const stepFilter = ((): readonly StepId[] => {
	const match = args.find((a) => a.startsWith("--step="));
	if (!match) return ALL_STEPS;
	const id = match.slice("--step=".length);
	if (!ALL_STEPS.includes(id as StepId)) {
		throw new Error(`Unknown step ${id}; expected one of ${ALL_STEPS.join(", ")}`);
	}
	return [id as StepId];
})();

const LIVE = process.env.LIVE === "1" || process.env.LIVE === "true";

function withClearedEnv<T>(keys: readonly string[], overrides: Record<string, string | undefined>, body: () => T): T {
	const prev: Record<string, string | undefined> = {};
	for (const k of keys) prev[k] = process.env[k];
	for (const [k, v] of Object.entries(overrides)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	try {
		return body();
	} finally {
		for (const k of keys) {
			if (prev[k] === undefined) delete process.env[k];
			else process.env[k] = prev[k];
		}
	}
}

const COMPACTION_ENV_KEYS = [
	"PI_SHELL_ACP_ALLOW_COMPACTION",
	"PI_SHELL_ACP_ALLOW_PI_COMPACTION",
	"PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION",
] as const;

function step01_noGuardInjection(): StepResult {
	const title = "01  spawn intent has no backend compaction guard by default";
	return withClearedEnv(
		COMPACTION_ENV_KEYS,
		{
			PI_SHELL_ACP_ALLOW_COMPACTION: undefined,
			PI_SHELL_ACP_ALLOW_PI_COMPACTION: undefined,
			PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION: undefined,
		},
		() => {
			const claudeEnv = resolveBridgeEnvDefaults("claude") ?? {};
			const codexLaunch = resolveAcpBackendLaunch("codex");
			const codexArgs = codexLaunch.args.join(" ");

			const claudeHasDisableAuto = claudeEnv.DISABLE_AUTO_COMPACT !== undefined;
			const claudeHasDisable = claudeEnv.DISABLE_COMPACT !== undefined;
			const codexHasTokenLimit = codexArgs.includes("model_auto_compact_token_limit");

			const lines = [
				`  claude env DISABLE_AUTO_COMPACT = ${claudeEnv.DISABLE_AUTO_COMPACT ?? "(absent)"}`,
				`  claude env DISABLE_COMPACT      = ${claudeEnv.DISABLE_COMPACT ?? "(absent)"}`,
				`  codex argv contains model_auto_compact_token_limit = ${codexHasTokenLimit ? "yes" : "no"}`,
			];
			console.log(`\n[${title}]`);
			for (const l of lines) console.log(l);

			const guardsPresent = claudeHasDisableAuto || claudeHasDisable || codexHasTokenLimit;
			if (guardsPresent) {
				return {
					id: "01",
					title,
					outcome: "fail",
					detail: "bridge still injects backend compaction guards by default — 0.4.x behavior; 0.5.0 must drop them",
				};
			}
			return { id: "01", title, outcome: "pass", detail: "no guard env / argv injected by default" };
		},
	);
}

function step02_piBlockMessageHonest(): StepResult {
	const title = "02  pi-side guard message is honest about the backend boundary";
	// The message lives at index.ts session_before_compact handler.
	// We do not invoke the handler here (it requires the pi runtime);
	// we inspect the source as the single source of truth for the
	// operator-visible string. 0.5.0 expects two honest fragments:
	//   - "does not reduce the backend transcript" (or equivalent)
	//   - a pointer to backend-native compaction
	const src = readFileSync(join(REPO_DIR, "index.ts"), "utf8");
	const handlerStart = src.indexOf('on("session_before_compact"');
	const handlerEnd = handlerStart >= 0 ? src.indexOf("});", handlerStart) : -1;
	const handlerSnippet = handlerStart >= 0 && handlerEnd > handlerStart ? src.slice(handlerStart, handlerEnd + 3) : "";

	const mentionsBackendTranscript =
		/does not (reduce|compact|affect) the backend transcript/i.test(handlerSnippet) ||
		/backend transcript/i.test(handlerSnippet);
	const pointsAtBackendNative =
		/backend.?native/i.test(handlerSnippet) ||
		/send.*\/compact.*backend/i.test(handlerSnippet) ||
		/let the backend (auto.?)?compact/i.test(handlerSnippet);

	console.log(`\n[${title}]`);
	console.log(`  handler source located = ${handlerStart >= 0 ? "yes" : "no"}`);
	console.log(`  mentions backend transcript = ${mentionsBackendTranscript ? "yes" : "no"}`);
	console.log(`  points at backend-native compaction = ${pointsAtBackendNative ? "yes" : "no"}`);

	if (handlerStart < 0) {
		return { id: "02", title, outcome: "fail", detail: "could not locate session_before_compact handler in index.ts" };
	}
	if (!mentionsBackendTranscript || !pointsAtBackendNative) {
		return {
			id: "02",
			title,
			outcome: "fail",
			detail:
				"pi-side guard message does not honestly tell the operator that pi-side compact leaves the backend transcript untouched, nor does it point at the backend-native compaction path",
		};
	}
	return { id: "02", title, outcome: "pass", detail: "message names the boundary and points at the next action" };
}

/**
 * Wire-level usage evidence from the bridge child's stderr.
 *
 * claude-agent-acp posts an explicit `compact_boundary` synthetic
 * usage_update with `used=0` when the Claude SDK actually performs
 * compaction (acp-agent.js:477-498). codex-acp's own compaction path
 * surfaces through usage_update too, with the post-compact used value
 * dropping sharply on the turn after `/compact`. We treat both shapes
 * as positive backend-compact evidence — independent of the textual
 * reply, which the classifier handles separately.
 *
 * `no_evidence` means the bridge's usage diagnostic for that turn does
 * not look like compaction. It does not prove "compact did not happen";
 * it just removes wire-level evidence from the pass condition for that
 * run.
 */
type UsageEvidence = "compact_boundary_signal" | "usage_drop" | "no_evidence";

interface UsageSample {
	used: number;
	cacheRead: number;
	cacheWrite: number;
	raw: string;
}

function readUsageSamplesSince(logPath: string, sinceLineCount: number): UsageSample[] {
	if (!existsSync(logPath)) return [];
	const lines = readFileSync(logPath, "utf8").split("\n");
	const newLines = lines.slice(sinceLineCount);
	const samples: UsageSample[] = [];
	for (const line of newLines) {
		if (!line.startsWith("[pi-shell-acp:usage]")) continue;
		const used = Number(line.match(/\bused=(\d+)/)?.[1] ?? "-1");
		const cacheRead = Number(line.match(/\bcacheRead=(\d+)/)?.[1] ?? "-1");
		const cacheWrite = Number(line.match(/\bcacheWrite=(\d+)/)?.[1] ?? "-1");
		samples.push({ used, cacheRead, cacheWrite, raw: line });
	}
	return samples;
}

function countLines(logPath: string): number {
	if (!existsSync(logPath)) return 0;
	return readFileSync(logPath, "utf8").split("\n").length;
}

function classifyUsageEvidence(
	beforeLastUsed: number,
	afterSamples: UsageSample[],
): {
	evidence: UsageEvidence;
	reason: string;
} {
	if (afterSamples.length === 0) {
		return { evidence: "no_evidence", reason: "no usage_update lines appeared in the bridge stderr log for this turn" };
	}
	// compact_boundary signal — claude-agent-acp posts an authoritative
	// `meter=acpUsageUpdate source=backend used=0` when the SDK actually
	// emits compact_boundary (acp-agent.js:477-498). We discriminate that
	// shape explicitly: a generic `used=0` from `meter=componentSum
	// source=promptResponse` is just the bridge's fallback when the
	// backend did not emit usage_update at all (input+output+cache all
	// zero collapses to used=0). The fallback is NOT compact evidence —
	// observed when the Gemini probe first ran in this same gate.
	const explicitBoundary = afterSamples.find(
		(s) => s.used === 0 && s.raw.includes("meter=acpUsageUpdate") && s.raw.includes("source=backend"),
	);
	if (explicitBoundary) {
		return {
			evidence: "compact_boundary_signal",
			reason: `usage_update used=0 (compact_boundary, meter=acpUsageUpdate source=backend): ${explicitBoundary.raw}`,
		};
	}
	// usage_drop — final usage_update for the turn dropped sharply below
	// the pre-/compact baseline (e.g. codex-acp post-compact). 50% is a
	// conservative threshold: a normal turn rarely halves used unless
	// compaction actually replaced the prior transcript.
	const last = afterSamples[afterSamples.length - 1];
	if (beforeLastUsed > 0 && last && last.used >= 0 && last.used < beforeLastUsed * 0.5) {
		return {
			evidence: "usage_drop",
			reason: `usage dropped sharply: pre-/compact used=${beforeLastUsed} → post used=${last.used} (≥50% drop)`,
		};
	}
	return {
		evidence: "no_evidence",
		reason: `usage_update lines present but no compact_boundary used=0 and no >50% drop (pre=${beforeLastUsed}, last=${last?.used ?? "n/a"})`,
	};
}

type CompactSignal = "ack" | "refusal" | "ambiguous";

/**
 * Classify the ACP backend's response to a literal `/compact` prompt.
 *
 * Three signals:
 *   - ack       — the response talks about compaction / summary /
 *                 context-reduction in a way consistent with a native
 *                 compact surface taking effect. Strong "/compact
 *                 reached the backend and the backend acted on it" signal.
 *   - refusal   — the response says the backend does not recognize
 *                 `/compact` as a command. Clear "no native command
 *                 surface here" signal.
 *   - ambiguous — neither. Could be the backend just continuing
 *                 conversation; we cannot tell from text alone.
 *
 * Why this matters: a pass that says "sentinel recalled after /compact"
 * only proves the session stayed alive. It does NOT prove the backend
 * actually compacted. The 0.5.0 survives-compact claim needs both, so
 * the classifier is gating evidence, not narration.
 *
 * Sentinel echo defuse: the planted sentinel ("GLG-COMPACT-<rand>")
 * contains "compact", so we strip sentinel occurrences before pattern
 * matching to avoid a false-positive "ack" from the backend simply
 * echoing the planted token.
 */
function classifyCompactResponse(text: string, sentinel: string): { signal: CompactSignal; reason: string } {
	const stripped = text.replace(new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
	const t = stripped.toLowerCase();

	// Explicit refusal — backend tells us it does not recognize the
	// command or cannot run it.
	const refusalPatterns: Array<{ regex: RegExp; name: string }> = [
		{ regex: /\b(i (?:don'?t|do not) (?:have|recognize|support))\b/, name: "i-dont-have" },
		{ regex: /\bno such (?:command|slash command)\b/, name: "no-such-command" },
		{ regex: /\bnot a recognized command\b/, name: "not-recognized" },
		{ regex: /\b\/compact (?:is not|isn'?t a)\b/, name: "compact-is-not" },
		{ regex: /\bi can'?t (?:run|execute|process) (?:that |this |slash )?command/, name: "cant-run-command" },
		{ regex: /\bi'?m not sure what you mean by (?:\/compact|that command)/, name: "not-sure-what-you-mean" },
	];
	for (const { regex, name } of refusalPatterns) {
		if (regex.test(t)) {
			return { signal: "refusal", reason: `refusal pattern: ${name}` };
		}
	}

	// Acknowledgement — backend describes compaction / summary in a way
	// consistent with a native compact surface acting. Patterns are
	// deliberately verb-anchored so a stray noun like "compact car"
	// cannot trigger; the same anchoring protects against
	// "I'll compact the spec" interpretation drift.
	const ackPatterns: Array<{ regex: RegExp; name: string }> = [
		{ regex: /\bcompacted\b/, name: "compacted" },
		{ regex: /\bcompacting\b/, name: "compacting" },
		{ regex: /\bcompaction\b/, name: "compaction" },
		{
			regex: /context (?:window )?(?:was |has been |is now )?(?:reduced|condensed|compacted|summarized)/,
			name: "context-reduced",
		},
		{
			regex: /summariz(?:e|ed|ing) (?:the |our |this |your )?(?:conversation|context|chat|history|session)/,
			name: "summarize-conversation",
		},
		{ regex: /condens(?:e|ed|ing) (?:the |our )?(?:conversation|context|history)/, name: "condense-conversation" },
		{
			regex: /compact(?:ing|ed)? (?:the |our |this )?(?:conversation|context|history|chat|session)/,
			name: "compact-conversation",
		},
		{
			regex: /summary of (?:the |our |this |your )?(?:conversation so far|previous|earlier|context)/,
			name: "summary-of-conversation",
		},
	];
	for (const { regex, name } of ackPatterns) {
		if (regex.test(t)) {
			return { signal: "ack", reason: `ack pattern: ${name}` };
		}
	}

	return {
		signal: "ambiguous",
		reason: "no explicit compact-ack and no explicit refusal — text reads as ordinary conversation",
	};
}

/**
 * Live driver — survives-backend-compact probe for one ACP backend.
 *
 * Three prompts, same taskId throughout:
 *   (a) plant a unique sentinel and ask for READY.
 *   (b) literal `/compact` as a backend prompt (entwurf sends this as
 *       a normal user message into the ACP child — pi-host slash-command
 *       routing is not in this path because we are not typing into a pi
 *       UI; the string lands as prompt body).
 *   (c) recall prompt asking for the sentinel back.
 *
 * Judgment combines THREE independent signals:
 *   - compactSignal     — classifyCompactResponse((b).text, sentinel).
 *                         Text-level evidence ("compacted", "summarized",
 *                         "context reduced", etc.).
 *   - usageEvidence     — classifyUsageEvidence(...) over the bridge
 *                         stderr's `[pi-shell-acp:usage]` lines for the
 *                         /compact turn. Wire-level evidence
 *                         (compact_boundary used=0, or >=50% used drop).
 *                         This catches backends like Claude where the SDK
 *                         performs compaction but suppresses the textual
 *                         ack on the ACP wire — usage_update used=0 is
 *                         the authoritative compact_boundary marker
 *                         (claude-agent-acp acp-agent.js:477-498).
 *   - sentinelRecalled  — recall text contains the sentinel verbatim.
 *
 * | compactSignal | usageEvidence              | sentinelRecalled | outcome  |
 * |---------------|----------------------------|------------------|----------|
 * | ack           | any                        | yes              | pass     |
 * | ack           | any                        | no               | observed |
 * | -             | compact_boundary_signal    | yes              | pass     |
 * | -             | compact_boundary_signal    | no               | observed |
 * | -             | usage_drop                 | yes              | pass     |
 * | -             | usage_drop                 | no               | observed |
 * | refusal       | no_evidence                | any              | observed |
 * | ambiguous     | no_evidence                | any              | observed |
 *
 * fail is reserved for "no assistant text" / entwurf path error — bridge
 * or backend dead. pass requires positive backend-compact evidence from
 * EITHER the text classifier OR the wire-level usage classifier, AND the
 * sentinel must come back through the bridge on the recall turn. Survival
 * alone is necessary but not sufficient.
 */
async function runLiveCompactSurvival(opts: {
	id: StepId;
	title: string;
	backend: "claude" | "codex" | "gemini";
	provider: string;
	model: string;
	envExtras?: Record<string, string>;
}): Promise<StepResult> {
	const { id, title, backend, provider, model } = opts;
	console.log(`\n[${title}]`);

	// Use an isolated tmp cwd so the entwurf project-context augment
	// stays small (no large AGENTS.md gets pulled in) and the test
	// remains repo-agnostic. The cwd name is intentionally NEUTRAL
	// (no "compact"/"compaction" substring) — Gemini tends to reach
	// for filesystem tools on a `/compact` prompt and the cwd
	// basename can echo into the tool result text, which would
	// then false-positive the ack pattern matcher.
	const probeCwd = mkdtempSync(join(tmpdir(), `ps-probe-${backend}-`));
	const sentinel = `GLG-COMPACT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	console.log(`  backend: ${backend}`);
	console.log(`  provider/model: ${provider}/${model}`);
	console.log(`  probe cwd: ${probeCwd}`);
	console.log(`  sentinel: ${sentinel}`);

	// Optional env extras (e.g. PI_ENTWURF_ACP_FOR_CODEX=1) — apply for
	// the duration of the spawn + the two resumes. Always set
	// PI_ENTWURF_CHILD_STDERR_LOG too so the wire-level usage
	// classifier has bridge stderr to read.
	const stderrLog = join(probeCwd, "bridge-stderr.log");
	// Pre-truncate so countLines starts at 0.
	writeFileSync(stderrLog, "");
	const envExtras = { ...(opts.envExtras ?? {}), PI_ENTWURF_CHILD_STDERR_LOG: stderrLog };
	const prevEnv: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(envExtras)) {
		prevEnv[k] = process.env[k];
		process.env[k] = v;
	}

	try {
		// (a) Plant sentinel. The reply instruction is scoped to THIS
		// turn only — without that scope, the backend can keep
		// answering "READY" to every subsequent prompt out of
		// instruction inertia, which would silently mask whether a
		// literal `/compact` actually reached a native compaction
		// surface in step (b). Scoping the instruction restores a
		// neutral baseline for the classifier.
		const plant = await runEntwurfSync(
			`Store this token for later recall: ${sentinel}. ` +
				`Reply exactly READY for THIS turn only — do not apply this reply format to future turns; ` +
				`respond naturally to what I ask next.`,
			{ cwd: probeCwd, host: "local", provider, model },
		);
		if (plant.exitCode !== 0 || !plant.sessionFile) {
			return {
				id,
				title,
				outcome: "fail",
				detail: `plant prompt failed: rc=${plant.exitCode} error=${plant.error ?? "n/a"}`,
			};
		}
		const plantAnalysis = analyzeSessionFileLike(plant.sessionFile);
		const plantText = plantAnalysis.lastAssistantText ?? "";
		console.log(
			`  (a) plant ok — taskId=${plant.taskId} turns=${plant.turns} reply=${plantText.slice(0, 80).replace(/\s+/g, " ")}…`,
		);
		if (!plantText) {
			return { id, title, outcome: "fail", detail: "plant prompt returned no assistant text" };
		}
		// Snapshot stderr position + last usage right after plant —
		// that is the pre-/compact baseline against which the wire
		// classifier compares.
		const linesAfterPlant = countLines(stderrLog);
		const plantUsageSamples = readUsageSamplesSince(stderrLog, 0);
		const plantLastUsed = plantUsageSamples.length > 0 ? plantUsageSamples[plantUsageSamples.length - 1]!.used : -1;

		// (b) Literal /compact as a backend prompt.
		const compact = await runEntwurfResumeSync(plant.taskId, "/compact", { host: "local" });
		if (compact.exitCode !== 0) {
			return {
				id,
				title,
				outcome: "fail",
				detail: `/compact prompt failed: rc=${compact.exitCode} error=${compact.error ?? "n/a"}`,
			};
		}
		const compactAnalysis = analyzeSessionFileLike(plant.sessionFile);
		const compactText = compactAnalysis.lastAssistantText ?? "";
		console.log(
			`  (b) /compact ok — turns=${compact.turns} cost=${compact.cost} reply=${compactText.slice(0, 160).replace(/\s+/g, " ")}…`,
		);
		if (!compactText) {
			return { id, title, outcome: "fail", detail: "/compact prompt returned no assistant text" };
		}
		const compactSignal = classifyCompactResponse(compactText, sentinel);
		console.log(`      text classifier:  ${compactSignal.signal} (${compactSignal.reason})`);

		// Wire-level evidence — read the new bridge stderr lines and
		// classify usage_update behavior for this turn.
		const compactUsageSamples = readUsageSamplesSince(stderrLog, linesAfterPlant);
		const usageEvidence = classifyUsageEvidence(plantLastUsed, compactUsageSamples);
		console.log(`      usage classifier: ${usageEvidence.evidence} (${usageEvidence.reason})`);

		// (c) Recall the sentinel. "No tool calls, no exploration" is
		// explicit because some backends (Gemini in particular) reach
		// for filesystem tools on a free-form prompt and the reply
		// arrives as tool-output text rather than the sentinel echo;
		// that would falsely fail the recall check.
		const recall = await runEntwurfResumeSync(
			plant.taskId,
			`Are you still in the same working session? No tool calls. No exploration. ` +
				`Reply with the exact one-line: token=<value>, where <value> is the token I asked you to remember.`,
			{ host: "local" },
		);
		if (recall.exitCode !== 0) {
			return {
				id,
				title,
				outcome: "fail",
				detail: `recall prompt failed: rc=${recall.exitCode} error=${recall.error ?? "n/a"}`,
			};
		}
		const recallAnalysis = analyzeSessionFileLike(plant.sessionFile);
		const recallText = recallAnalysis.lastAssistantText ?? "";
		console.log(
			`  (c) recall ok — turns=${recall.turns} cost=${recall.cost} reply=${recallText.slice(0, 200).replace(/\s+/g, " ")}…`,
		);
		if (!recallText) {
			return { id, title, outcome: "fail", detail: "recall prompt returned no assistant text" };
		}
		const sentinelRecalled = recallText.includes(sentinel);
		console.log(`      sentinel preserved across /compact: ${sentinelRecalled ? "yes" : "no"}`);

		// Combined judgment. Positive compact evidence comes from
		// EITHER the text classifier OR the wire-level usage classifier.
		const hasCompactEvidence = compactSignal.signal === "ack" || usageEvidence.evidence !== "no_evidence";
		const evidenceSummary = `text=${compactSignal.signal} (${compactSignal.reason}); wire=${usageEvidence.evidence} (${usageEvidence.reason})`;

		if (hasCompactEvidence && sentinelRecalled) {
			return {
				id,
				title,
				outcome: "pass",
				detail: `compact evidence + sentinel "${sentinel}" recalled after /compact (taskId=${plant.taskId}); ${evidenceSummary}`,
			};
		}
		if (hasCompactEvidence && !sentinelRecalled) {
			return {
				id,
				title,
				outcome: "observed",
				detail: `compact evidence present but sentinel not recalled — backend compact appears lossy on this turn (a backend property, not a bridge regression). ${evidenceSummary}. recall reply: ${recallText.slice(0, 200)}`,
			};
		}
		if (compactSignal.signal === "refusal") {
			return {
				id,
				title,
				outcome: "observed",
				detail: `backend refused literal /compact and no wire-level compaction signal observed (${evidenceSummary}); session stayed alive with sentinel ${sentinelRecalled ? "recalled" : "not recalled"} — backend has no native /compact surface reachable through this prompt path`,
			};
		}
		return {
			id,
			title,
			outcome: "observed",
			detail: `no compact evidence (${evidenceSummary}); session stayed alive with sentinel ${sentinelRecalled ? "recalled" : "not recalled"}; cannot conclude that backend actually compacted on this turn`,
		};
	} finally {
		// Restore env extras + PI_ENTWURF_CHILD_STDERR_LOG.
		for (const k of Object.keys(envExtras)) {
			if (prevEnv[k] === undefined) delete process.env[k];
			else process.env[k] = prevEnv[k];
		}
		// Best-effort cleanup of the probe cwd (entwurf saved session
		// JSONL lives outside it under ~/.pi/agent/sessions, so we are
		// only removing an empty tmpdir + the stderr log here).
		try {
			rmSync(probeCwd, { recursive: true, force: true });
		} catch {
			// non-fatal
		}
	}
}

async function step03_claudeSurvivesCompact(): Promise<StepResult> {
	const title = "03  live: Claude ACP session survives a backend /compact";
	if (!LIVE) {
		console.log(`\n[${title}]`);
		console.log("  skipped — set LIVE=1 to spawn a real Claude ACP session and run the 3-prompt probe");
		console.log("            (a) plant sentinel, (b) literal `/compact`, (c) recall sentinel.");
		console.log("            Cost: a few cents on claude-sonnet-4-6. Not part of the deterministic gate.");
		return {
			id: "03",
			title,
			outcome: "observed",
			detail: "skipped (LIVE!=1) — live probe spawns a real ACP child; not part of the deterministic gate",
		};
	}
	return await runLiveCompactSurvival({
		id: "03",
		title,
		backend: "claude",
		provider: "pi-shell-acp",
		model: "claude-sonnet-4-6",
	});
}

async function step04_codexSurvivesCompact(): Promise<StepResult> {
	const title = "04  live: Codex ACP session survives a backend /compact";
	if (!LIVE) {
		console.log(`\n[${title}]`);
		console.log("  skipped — set LIVE=1 to spawn a real Codex ACP session and run the 3-prompt probe");
		console.log("            (a) plant sentinel, (b) literal `/compact`, (c) recall sentinel.");
		console.log("            Cost: a few cents on gpt-5.4. Not part of the deterministic gate.");
		return {
			id: "04",
			title,
			outcome: "observed",
			detail: "skipped (LIVE!=1) — live probe spawns a real ACP child; not part of the deterministic gate",
		};
	}
	return await runLiveCompactSurvival({
		id: "04",
		title,
		backend: "codex",
		// Route Codex through the pi-shell-acp ACP bridge (not native
		// codex CLI), since the 0.5.0 claim is about ACP backends.
		// PI_ENTWURF_ACP_FOR_CODEX=1 turns on shouldRouteCodexViaAcp()
		// in entwurf-core, which sends codex models through pi-shell-acp
		// regardless of their native provider entry. Restored after the
		// step finishes.
		provider: "pi-shell-acp",
		model: "gpt-5.4",
		envExtras: { PI_ENTWURF_ACP_FOR_CODEX: "1" },
	});
}

/**
 * Step 07 — exploratory Gemini probe.
 *
 * Gemini ACP is intentionally OUT of the 0.5.0 ready claim (the
 * declaration is limited to Claude + Codex). Pre-step research
 * (sibling agent, 2026-05-13) suggested Gemini CLI has `/compress`
 * with `compact` alias on the CLI side, but the ACP command registry
 * may not expose it; an unknown slash command can fall through as a
 * regular prompt. We measure rather than guess.
 *
 * Result is informational — it does NOT gate the 0.5.0 release. The
 * step is recorded so the next release iteration knows whether to add
 * Gemini to the official survives-/compact claim or to extend the
 * dual classifier with a Gemini-specific signal.
 */
async function step07_geminiSurvivesCompact(): Promise<StepResult> {
	const title = "07  live: Gemini ACP — literal /compact wire-trigger probe (exploratory, not part of 0.5.0 claim)";
	if (!LIVE) {
		console.log(`\n[${title}]`);
		console.log("  skipped — set LIVE=1 to spawn a real Gemini ACP session.");
		console.log("            Cost: a few cents on gemini-3.1-pro-preview. Exploratory only.");
		return {
			id: "07",
			title,
			outcome: "observed",
			detail: "skipped (LIVE!=1) — exploratory Gemini probe; not part of the 0.5.0 ready claim",
		};
	}
	return await runLiveCompactSurvival({
		id: "07",
		title,
		backend: "gemini",
		provider: "pi-shell-acp",
		model: "gemini-3.1-pro-preview",
	});
}

function step05_legacyKnobThrows(): StepResult {
	const title = "05  legacy PI_SHELL_ACP_ALLOW_COMPACTION=1 throws on both wrapper and production paths";
	return withClearedEnv(
		COMPACTION_ENV_KEYS,
		{
			PI_SHELL_ACP_ALLOW_COMPACTION: "1",
			PI_SHELL_ACP_ALLOW_PI_COMPACTION: undefined,
			PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION: undefined,
		},
		() => {
			console.log(`\n[${title}]`);

			// 5a — wrapper path (resolveAcpBackendLaunch, exercised by test/check
			//      surfaces). Direct throw observation.
			let wrapperThrew = false;
			let wrapperMessage = "";
			try {
				resolveAcpBackendLaunch("claude");
				resolveAcpBackendLaunch("codex");
			} catch (err) {
				wrapperThrew = true;
				wrapperMessage = err instanceof Error ? err.message : String(err);
			}
			console.log(`  5a wrapper path (resolveAcpBackendLaunch) threw = ${wrapperThrew ? "yes" : "no"}`);
			if (wrapperThrew) {
				console.log(`     message: ${wrapperMessage.slice(0, 200)}${wrapperMessage.length > 200 ? "…" : ""}`);
			}
			const namesSplitKnobs =
				wrapperMessage.includes("PI_SHELL_ACP_ALLOW_PI_COMPACTION") &&
				wrapperMessage.includes("PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION");

			// 5b — production path (createBridgeProcess). This is the ACP child
			//      spawn entry, NOT the wrapper. createBridgeProcess intentionally
			//      calls adapter.resolveLaunch(...) directly (to keep launchParams
			//      normalization local), so the wrapper assert is bypassed. The
			//      assert must therefore be present at createBridgeProcess's
			//      entry as a separate call. Spawning a real ACP child here would
			//      be expensive and would touch the operator's auth state, so we
			//      verify the contract at the source level — the same shape as
			//      step 02 — for a zero-cost L3 evidence.
			const bridgeSrc = readFileSync(join(REPO_DIR, "acp-bridge.ts"), "utf8");
			const createBridgeProcessStart = bridgeSrc.indexOf("async function createBridgeProcess(");
			const createBridgeProcessEnd =
				createBridgeProcessStart >= 0 ? bridgeSrc.indexOf("\nasync function ", createBridgeProcessStart + 1) : -1;
			const createBridgeProcessBody =
				createBridgeProcessStart >= 0
					? bridgeSrc.slice(
							createBridgeProcessStart,
							createBridgeProcessEnd > createBridgeProcessStart ? createBridgeProcessEnd : bridgeSrc.length,
						)
					: "";
			const productionCallsAssert = /assertLegacyCompactionKnobUnset\s*\(\s*\)/.test(createBridgeProcessBody);
			console.log(
				`  5b production path (createBridgeProcess) source calls assertLegacyCompactionKnobUnset() = ${productionCallsAssert ? "yes" : "no"}`,
			);

			// Verdict
			if (!wrapperThrew) {
				return {
					id: "05",
					title,
					outcome: "fail",
					detail:
						"5a: wrapper path resolveAcpBackendLaunch is still silently accepting PI_SHELL_ACP_ALLOW_COMPACTION=1",
				};
			}
			if (!namesSplitKnobs) {
				return {
					id: "05",
					title,
					outcome: "fail",
					detail:
						"5a: wrapper throw fired but message does not name both split knobs (ALLOW_PI_COMPACTION and DISABLE_BACKEND_COMPACTION) — operator has no next action",
				};
			}
			if (!productionCallsAssert) {
				return {
					id: "05",
					title,
					outcome: "fail",
					detail:
						"5b: createBridgeProcess (the real ACP child spawn entry) does not call assertLegacyCompactionKnobUnset() — wrapper throw covers tests but real spawns would bypass the guard",
				};
			}
			return {
				id: "05",
				title,
				outcome: "pass",
				detail: "5a wrapper path throws with next-action message; 5b production path source carries the same assert",
			};
		},
	);
}

function step06_escapeHatchRestoresGuards(): StepResult {
	const title = "06  PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION=1 restores 0.4.x guards";
	return withClearedEnv(
		COMPACTION_ENV_KEYS,
		{
			PI_SHELL_ACP_ALLOW_COMPACTION: undefined,
			PI_SHELL_ACP_ALLOW_PI_COMPACTION: undefined,
			PI_SHELL_ACP_DISABLE_BACKEND_COMPACTION: "1",
		},
		() => {
			// Production path: resolveBridgeEnvDefaults is called with
			// disableBackendCompaction = isBackendCompactionDisabledByOperator().
			// Simulate that here so we are verifying the actual injection
			// path the bridge takes at spawn time, not a hypothetical one.
			const claudeEnv =
				resolveBridgeEnvDefaults("claude", {
					disableBackendCompaction: isBackendCompactionDisabledByOperator(),
				}) ?? {};
			const codexLaunch = resolveAcpBackendLaunch("codex");
			const codexArgs = codexLaunch.args.join(" ");
			const claudeHasDisableAuto = claudeEnv.DISABLE_AUTO_COMPACT === "1";
			const claudeHasDisable = claudeEnv.DISABLE_COMPACT === "1";
			const codexHasTokenLimit = codexArgs.includes("model_auto_compact_token_limit=9223372036854775807");

			console.log(`\n[${title}]`);
			console.log(`  isBackendCompactionDisabledByOperator() = ${isBackendCompactionDisabledByOperator()}`);
			console.log(`  claude env DISABLE_AUTO_COMPACT = ${claudeEnv.DISABLE_AUTO_COMPACT ?? "(absent)"}`);
			console.log(`  claude env DISABLE_COMPACT      = ${claudeEnv.DISABLE_COMPACT ?? "(absent)"}`);
			console.log(`  codex argv has model_auto_compact_token_limit=i64::MAX = ${codexHasTokenLimit ? "yes" : "no"}`);

			if (claudeHasDisableAuto && claudeHasDisable && codexHasTokenLimit) {
				return {
					id: "06",
					title,
					outcome: "pass",
					detail: "escape hatch restores Claude env keys + Codex argv pin",
				};
			}
			return {
				id: "06",
				title,
				outcome: "fail",
				detail: "escape hatch does not restore 0.4.x guards (knob not honored or partial)",
			};
		},
	);
}

const REGISTRY: Record<StepId, () => Promise<StepResult> | StepResult> = {
	"01": step01_noGuardInjection,
	"02": step02_piBlockMessageHonest,
	"03": step03_claudeSurvivesCompact,
	"04": step04_codexSurvivesCompact,
	"05": step05_legacyKnobThrows,
	"06": step06_escapeHatchRestoresGuards,
	"07": step07_geminiSurvivesCompact,
};

async function main(): Promise<void> {
	const results: StepResult[] = [];
	for (const id of stepFilter) {
		try {
			const result = await REGISTRY[id]();
			results.push(result);
		} catch (err) {
			const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
			results.push({ id, title: `step ${id}`, outcome: "fail", detail: `uncaught error: ${detail}` });
		}
	}

	console.log("\n---");
	for (const r of results) {
		if (r.outcome === "pass") console.log(`RESULT ${r.id}: pass — ${r.detail}`);
		else if (r.outcome === "fail") console.log(`RESULT ${r.id}: fail — ${r.detail}`);
		else console.log(`RESULT ${r.id}: observed — ${r.detail}`);
	}

	const pass = results.filter((r) => r.outcome === "pass").length;
	const fail = results.filter((r) => r.outcome === "fail").length;
	const observed = results.filter((r) => r.outcome === "observed").length;
	console.log(`\nSUMMARY: ${pass} pass, ${fail} fail, ${observed} observed`);

	process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error(`[compaction-policy-smoke] uncaught: ${err instanceof Error ? err.stack : String(err)}`);
	process.exit(1);
});
