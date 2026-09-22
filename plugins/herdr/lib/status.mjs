#!/usr/bin/env node
/**
 * Entwurf status — the whole Herdr plugin (#116 M2-b).
 *
 * It reads two listings ONCE, lays them side by side, waits for a keypress, and exits.
 * Everything it deliberately does not do is listed below, because in this repo the
 * absences are the design.
 *
 * THE JOIN IT REFUSES TO MAKE. A pane can be matched to a garden citizen on
 * `nativeSessionId`, and on the pi axis that key is recovered from a session FILENAME by
 * a strict conversion measured against one vendor floor. Entwurf owns that conversion
 * (`pi-extensions/lib/herdr-placement.ts`), it is covered by gates and by
 * `docs/mux-launch-rail.md` §7, and a copy of it living out here would fork a vendor
 * floor into a file neither covers. So this plugin never sees a native session id: it
 * asks `entwurf peer-facts` for the answer and joins on the OPAQUE pane id string it
 * gets back. One string equality is a thing a plugin may correctly do.
 *
 * THREE READS, ONE OPEN. `herdr integration status` once, `entwurf peer-facts` once,
 * `herdr agent list` once, per pane open. The COUNT rose by one when this surface grew the
 * integration block; the CADENCE did not move at all. No refresh, no retry, no watcher, no
 * cache. Two reasons, and either alone would be enough: Herdr publishes no "this pane's
 * session reference has landed" event, so a loop around that gap is the discovery watcher
 * `docs/mux-launch-rail.md` §7 refuses by name; and `peer-facts` observes every citizen
 * unbounded, which was measured at 4.1s on a 1,150-record store — fine once when asked,
 * wrong on a timer.
 *
 * FOUR BLOCKS, FOUR OWNERS, FOUR TIMES, NO AGGREGATE. What the operator could not see before
 * is that "is Entwurf working here" is not one question. Herdr's integration listing is true
 * NOW and belongs to Herdr; the activation ledger is an INSTALL-TIME receipt that belongs to
 * Entwurf and has not been re-checked; the rails table is STATIC and is a property of this
 * package rather than of this host; the citizen table is true NOW. Each block therefore renders
 * its own owner, its own observation time and its own outcome, and there is deliberately no
 * reducer, no `overall`, and no readiness word anywhere in this file — a host whose integration
 * is current, whose ledger is a week old and whose runtime has since been deleted is exactly the
 * case a summary token erases. The render leaf (`capability-report.mjs`) has no aggregate to
 * offer even if this file asked for one.
 *
 * FINDING ENTWURF: PRECEDENCE FIRST, LEDGER ONLY AS A LAST RESORT (#116 D3=C). `ENTWURF_BIN`
 * (absolute) then `PATH` are honoured exactly as before and neither is ever overridden — a user
 * override is the operator speaking, and a ledger must not out-vote it. Only when BOTH are
 * absent do we ask the certified activation ledger for the runtime it installed, and only when
 * that ledger is certified, root-aligned and backed by an executable bin. That is the state the
 * plugin actually leaves a clean host in: `README.md:38` — the plugin puts nothing on `PATH`,
 * so before this fallback the very first open on a correct install closed itself with
 * `entwurf-not-found`.
 *
 * A MISSING ENTWURF SKIPS THE CITIZEN AXIS ONLY. It no longer closes the pane. Blocks 1-3 are
 * answerable without any entwurf binary at all, and withholding them because the fourth could
 * not be read was itself a way of saying less than we knew.
 *
 * ACTIVITY IS HERDR'S WORD, IN HERDR'S COLUMN. `agent_status` (idle/working/blocked/
 * done/unknown) is Herdr's judgement about a screen. It is not delivery evidence
 * (`docs/herdr-launch-rail.md` §9), so it is rendered in its own column under its own
 * heading and never merged with `placement` or with anything Entwurf calls liveness. It
 * is never used to decide whether a citizen can be reached; only `entwurf_v2` decides
 * that, at call time.
 *
 * IT WRITES NOTHING. Not to `HERDR_PLUGIN_STATE_DIR`, not to `HERDR_PLUGIN_CONFIG_DIR`,
 * not anywhere. It installs nothing, configures nothing, and touches no credential. A
 * missing Entwurf is a SKIP, not a failure — installing one is not a plugin's business
 * (AGENTS.md Hard Rule 17).
 *
 * A FAILED READ IS NEVER AN EMPTY TABLE. Every way this can go wrong has its own name
 * on screen. A listing that could not be read must not look like a listing with nothing
 * in it — that is the one lie this surface could tell.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as activationModule from "../../../scripts/herdr-activation.mjs";
import { HERDR_FRESH_CALL_BACKENDS, MODEL_SYNTAX_EXAMPLE, RAIL_ENTRY_NOTE } from "../../../scripts/herdr-rails.mjs";
import * as runtimeModule from "../../../scripts/herdr-runtime.mjs";
import { gatherActivationEvidence } from "./activation-evidence.mjs";
import { activationBlock, citizensBlock, integrationBlock, railsBlock, renderReport } from "./capability-report.mjs";
import { buildActivationProfile } from "./integration-profile.mjs";

const OK = 0;
const RED = 1;

/** Print, then hold the pane open, then leave with this code. */
function finish(lines, code) {
	process.stdout.write(`${lines.join("\n")}\n`);
	holdOpen().then(() => process.exit(code));
}

/**
 * An overlay pane vanishes the moment this process exits, so a report that is not waited
 * on is a report nobody read. One keypress (or EOF, which is how a test and a `< /dev/null`
 * launch end) releases it. Nothing polls.
 */
function holdOpen() {
	return new Promise((resolve) => {
		if (process.stdin.isTTY) process.stdout.write("\n[press Enter to close]\n");
		let done = false;
		const once = () => {
			if (done) return;
			done = true;
			process.stdin.pause();
			resolve();
		};
		process.stdin.on("data", once);
		process.stdin.on("end", once);
		process.stdin.on("error", once);
		process.stdin.resume();
	});
}

function isExecutableFile(p) {
	try {
		if (!fs.statSync(p).isFile()) return false;
		fs.accessSync(p, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * THE ONE WAY THIS FILE STARTS A PROCESS. Both reads go through here, and what differs between
 * them is the PARSER, not the ability to spawn: herdr's `integration status` has no machine format
 * at all (`--json`/`--format=json`/`-o json` each exit 2), so its bytes go to a prose parser while
 * `peer-facts` and `agent list` go to `JSON.parse`. Two parsers is a fact about herdr; two spawn
 * call sites would have been a second door, and the gate counts doors.
 *
 * `run.error` and a non-zero exit are the SAME named failure — the caller could not get an answer —
 * and a body it cannot use is a different one, which is why parsing stays with the caller.
 */
function spawnOnce(bin, args, failedCode) {
	const run = spawnSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (run.error !== undefined) return { error: failedCode, detail: run.error.message };
	if (run.status !== 0) return { error: failedCode, detail: `exit ${run.status}: ${(run.stderr ?? "").trim()}` };
	return { stdout: run.stdout ?? "" };
}

/** One child, one answer. `status !== 0` and unparsable output are DIFFERENT failures. */
function readJson(bin, args, names) {
	const out = spawnOnce(bin, args, names.failed);
	if (out.error !== undefined) return out;
	try {
		return { value: JSON.parse(out.stdout) };
	} catch (err) {
		return { error: names.unparsable, detail: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Herdr's own listing, reduced to the two fields this surface reads. A pane carrying two
 * agent rows is reported as `ambiguous` rather than resolved — picking one would be a
 * guess, and the value of this column is that it never guesses.
 */
function indexActivityByPane(agents) {
	const byPane = new Map();
	for (const agent of agents) {
		const paneId = agent?.pane_id;
		if (typeof paneId !== "string" || paneId === "") continue;
		const status = typeof agent?.agent_status === "string" ? agent.agent_status : "unknown";
		byPane.set(paneId, byPane.has(paneId) ? "ambiguous" : status);
	}
	return byPane;
}

function pad(value, width) {
	return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/** The human form of the tagged union. `herdr <pane>` says WHO saw it, never "it is ours". */
function renderPlacement(placement) {
	if (placement === null || typeof placement !== "object") return "unobserved";
	return placement.kind === "herdr-pane" ? `herdr ${placement.paneId}` : String(placement.kind ?? "unobserved");
}

const placementKind = (placement) =>
	placement !== null && typeof placement === "object" ? String(placement.kind ?? "unobserved") : "unobserved";

/**
 * THE TABLE IS THE ANSWER TO "WHO IS VISIBLE HERE", NOT A DUMP OF THE STORE.
 *
 * The read stays whole — every citizen is measured, and nothing below re-budgets that
 * (see the header: a rationed MEASUREMENT would fabricate `unobserved`). What is rationed
 * is the RENDER, and only along the axis this pane exists for. Measured 2026-09-15 on the
 * operator's own store: 1,162 records, all `unobserved`, `peer-facts` output 17,437 lines.
 * Drawing all of them makes finding the two citizens actually in this Herdr session a
 * scrolling exercise — a status surface that must be searched has already failed.
 *
 * So the table holds the rows a placement owner REPORTED (`herdr-pane`, and `ambiguous`
 * where more than one pane claimed one citizen), and the rest are counted rather than
 * dropped. `none` and `unobserved` mean different things and are counted separately:
 * `none` is a completed read that did not contain this citizen, `unobserved` is nobody
 * having been able to look at all. Neither is hidden; a count is still a report.
 */
function renderTable(peers, byPane) {
	const shown = [];
	const counts = { none: 0, unobserved: 0, other: 0 };
	for (const peer of peers) {
		const placement = peer?.placement;
		const kind = placementKind(placement);
		if (kind !== "herdr-pane" && kind !== "ambiguous") {
			if (kind === "none") counts.none++;
			else if (kind === "unobserved") counts.unobserved++;
			else counts.other++;
			continue;
		}
		// The ONLY join: an opaque pane id, string-equal. No native session id, no
		// filename conversion, no re-verification of which integration reported it —
		// peer-facts already answered all three, and answering them twice is how the
		// two answers start to differ.
		const paneId = kind === "herdr-pane" ? placement.paneId : null;
		const activity = paneId === null ? "—" : (byPane.get(paneId) ?? "—");
		shown.push([
			String(peer?.gardenId ?? "?"),
			String(peer?.backend ?? "?"),
			String(peer?.cwd ?? "?"),
			renderPlacement(placement),
			activity,
		]);
	}

	// `herdr-reported activity` is spelled out, and it is last, away from `placement`.
	// A reader must not be able to mistake it for something Entwurf measured.
	const head = ["garden id", "backend", "cwd", "placement", "herdr-reported activity"];
	const widths = head.map((h, i) => Math.max(h.length, ...shown.map((r) => r[i].length), 0));
	const line = (cells) =>
		cells
			.map((c, i) => pad(c, widths[i]))
			.join("  ")
			.trimEnd();

	const table =
		shown.length === 0 ? ["(none)"] : [line(head), line(widths.map((w) => "-".repeat(w))), ...shown.map(line)];

	const tail = [];
	if (counts.unobserved > 0)
		tail.push(`${counts.unobserved} citizen(s) not shown: nobody could observe placement for them (unobserved).`);
	if (counts.none > 0)
		tail.push(
			`${counts.none} citizen(s) not shown: the placement owner was read in full and does not have them (none).`,
		);
	if (counts.other > 0) tail.push(`${counts.other} citizen(s) not shown: placement kind this pane does not know.`);
	return tail.length === 0 ? table : [...table, "", ...tail];
}

/**
 * A diagnostic's SUBJECT is the half an operator acts on. `record-less-socket` without its
 * garden id, or `meta-record-read-error` without its filename, tells you a hazard exists
 * and not where — which is a report you cannot do anything with. So every field the
 * provider attached is rendered, in sorted key order so two runs read the same, with
 * `kind` first and the prose last. Nothing is filtered by name: the payload carries no
 * socket path or other transport coordinate to begin with (#50 C4), and a denylist here
 * would silently drop the next subject field somebody adds.
 */
function renderDiagnostics(diagnostics) {
	if (diagnostics.length === 0) return ["Diagnostics: (none)"];
	// Hiding these would turn a store carrying hazards into a clean-looking listing.
	return [
		"Diagnostics:",
		...diagnostics.map((d) => {
			const fields = Object.keys(d ?? {})
				.filter((k) => k !== "kind" && k !== "message")
				.sort()
				.map((k) => `${k}=${String(d[k])}`);
			const subject = fields.length === 0 ? "" : ` [${fields.join(" ")}]`;
			return `  ${String(d?.kind ?? "?")}${subject}: ${String(d?.message ?? "")}`;
		}),
	];
}

// ── the one pass ────────────────────────────────────────────────────────────

/**
 * WHERE ENTWURF IS, in the operator's order of authority.
 *
 * `ENTWURF_BIN` (absolute only — a bare name there would be a second, quieter PATH lookup with
 * different rules) wins outright. Then `PATH`, resolved by reading PATH ourselves: no shell, no
 * `which`, no guessing at install roots. Only when the operator has said NOTHING do we ask the
 * ledger, and a ledger answer never rewrites or shadows either of the two above — it is the
 * last resort for a host where the plugin installed a runtime and put nothing on PATH.
 */
function resolveEntwurfBin(evidence) {
	const declared = process.env.ENTWURF_BIN;
	if (declared !== undefined && declared !== "") {
		if (!path.isAbsolute(declared)) return { error: "entwurf-bin-not-absolute" };
		return isExecutableFile(declared)
			? { bin: declared, source: "ENTWURF_BIN" }
			: { error: "entwurf-bin-not-executable" };
	}
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (dir === "") continue;
		const candidate = path.join(dir, "entwurf");
		if (isExecutableFile(candidate)) return { bin: candidate, source: "PATH" };
	}
	if (evidence.kind === "ledger" && evidence.runtimeBin !== null) {
		return { bin: evidence.runtimeBin, source: "activation-ledger" };
	}
	return { skip: true };
}

/**
 * WHY THE LAST RESORT HAD NOTHING TO OFFER, in the skip's own words.
 *
 * "no certified runtime to fall back to" is true of a host that never activated and misleading
 * about every other one: a ledger that exists but is mid-teardown, a runtime with no receipt, a
 * body the reader refused. Those hosts HAVE activation evidence — it simply grants no binary — and
 * an operator reading the citizen block needs to be sent to the activation block rather than told
 * there is nothing there.
 */
function fallbackIneligibility(evidence) {
	const base = "no ENTWURF_BIN, nothing named `entwurf` on PATH";
	if (evidence.kind === "absent") return `${base}, and no certified runtime to fall back to`;
	return `${base}, and this host's activation evidence grants no fallback: ${evidence.code}`;
}

/** READ 1 — Herdr's integration listing. Read-only, needs no herdr server. Prose, not JSON. */
function readIntegration(herdrBin) {
	const out = spawnOnce(herdrBin, ["integration", "status"], "herdr-integration-status-failed");
	if (out.error !== undefined) return { error: { code: out.error, detail: out.detail } };
	try {
		return { profile: buildActivationProfile(out.stdout) };
	} catch (err) {
		return { error: { code: err?.code ?? "herdr-integration-status-unreadable", detail: err?.detail ?? String(err) } };
	}
}

/**
 * The citizen axis, and ONLY the citizen axis, when there is a binary to ask. Every way this can
 * go wrong keeps its own name: a listing that could not be read must not look like a listing with
 * nothing in it.
 */
function readCitizens(entwurfBin, herdrBin) {
	const facts = readJson(entwurfBin, ["peer-facts"], {
		failed: "peer-facts-failed",
		unparsable: "peer-facts-unparsable",
	});
	if (facts.error !== undefined) return { error: { code: facts.error, detail: facts.detail } };
	const agents = readJson(herdrBin, ["agent", "list"], {
		failed: "herdr-agent-list-failed",
		unparsable: "herdr-agent-list-unparsable",
	});
	if (agents.error !== undefined) return { error: { code: agents.error, detail: agents.detail } };

	const peers = Array.isArray(facts.value?.peers) ? facts.value.peers : null;
	const diagnostics = Array.isArray(facts.value?.diagnostics) ? facts.value.diagnostics : [];
	const agentRows = agents.value?.result?.agents;
	if (peers === null) return { error: { code: "peer-facts-unparsable", detail: "payload has no `peers` array" } };
	if (!Array.isArray(agentRows)) {
		return { error: { code: "herdr-agent-list-unparsable", detail: "payload has no `result.agents` array" } };
	}
	return {
		lines: [...renderTable(peers, indexActivityByPane(agentRows)), "", ...renderDiagnostics(diagnostics)],
	};
}

const herdrBin = process.env.HERDR_BIN_PATH;
if (herdrBin === undefined || herdrBin === "") {
	finish(["herdr-bin-path-missing"], RED);
} else {
	const evidence = await gatherActivationEvidence(process.env, {
		runtimeModule,
		activationModule,
		checkoutRoot: runtimeModule.defaultCheckoutRoot(),
	});
	const entwurf = resolveEntwurfBin(evidence);

	const blocks = [
		integrationBlock(readIntegration(herdrBin)),
		activationBlock(evidence),
		railsBlock({
			backends: HERDR_FRESH_CALL_BACKENDS,
			modelSyntaxExample: MODEL_SYNTAX_EXAMPLE,
			railEntryNote: RAIL_ENTRY_NOTE,
		}),
	];

	if (entwurf.skip === true) {
		// The CITIZEN axis alone skips, by name and at exit 0. Absence of Entwurf is not a broken
		// host, and installing one is not a plugin's business (AGENTS.md Hard Rule 17).
		blocks.push(
			citizensBlock({
				skipped: {
					code: "entwurf-not-found",
					detail: fallbackIneligibility(evidence),
				},
			}),
		);
	} else if (entwurf.error !== undefined) {
		blocks.push(citizensBlock({ error: { code: entwurf.error, detail: "ENTWURF_BIN was set but cannot be used" } }));
	} else {
		blocks.push(citizensBlock(readCitizens(entwurf.bin, herdrBin)));
	}

	// The exit code is the OR of the blocks' own outcomes, not a verdict of its own: a red block
	// has already said what is wrong, in its own voice, and this only decides whether the process
	// leaves non-zero. It is deliberately not rendered — there is no line on this screen that
	// summarises the four.
	const anyError = blocks.some((b) => b.outcome.kind === "error");
	finish(
		[
			...(entwurf.skip === true || entwurf.error !== undefined
				? []
				: [`Entwurf binary: ${entwurf.bin} (via ${entwurf.source})`, ""]),
			...renderReport(blocks),
			"`herdr-reported activity` is Herdr's judgement about a screen, not Entwurf liveness,",
			"and not an address. To reach a citizen, dispatch to its garden id with entwurf_v2.",
		],
		anyError ? RED : OK,
	);
}
