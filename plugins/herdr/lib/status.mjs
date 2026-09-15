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
 * TWO READS, ONE OPEN. `entwurf peer-facts` once, `herdr agent list` once, per
 * pane open. No refresh, no retry, no watcher, no cache. Two reasons, and either alone
 * would be enough: Herdr publishes no "this pane's session reference has landed" event,
 * so a loop around that gap is the discovery watcher `docs/mux-launch-rail.md` §7
 * refuses by name; and `peer-facts` observes every citizen unbounded, which was measured
 * at 4.1s on a 1,150-record store — fine once when asked, wrong on a timer.
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

/**
 * `ENTWURF_BIN` first and it must be an absolute path — a bare name there would be a
 * second, quieter PATH lookup with different rules than the one below. Then `entwurf` on
 * PATH, resolved by reading PATH ourselves: no shell, no `which`, no guessing at install
 * roots. Absent is a SKIP with one exact word, because a host without Entwurf is not a
 * broken host.
 */
function resolveEntwurf() {
	const declared = process.env.ENTWURF_BIN;
	if (declared !== undefined && declared !== "") {
		if (!path.isAbsolute(declared)) return { error: "entwurf-bin-not-absolute" };
		return isExecutableFile(declared) ? { bin: declared } : { error: "entwurf-bin-not-executable" };
	}
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (dir === "") continue;
		const candidate = path.join(dir, "entwurf");
		if (isExecutableFile(candidate)) return { bin: candidate };
	}
	return { skip: true };
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

/** One child, one answer. `status !== 0` and unparsable output are DIFFERENT failures. */
function readJson(bin, args, names) {
	const run = spawnSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (run.error !== undefined) return { error: names.failed, detail: run.error.message };
	if (run.status !== 0) return { error: names.failed, detail: `exit ${run.status}: ${(run.stderr ?? "").trim()}` };
	try {
		return { value: JSON.parse(run.stdout) };
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

const entwurf = resolveEntwurf();
if (entwurf.skip === true) {
	// Exactly this token, exit 0. Absence is a skip; only a BROKEN thing is red.
	finish(["entwurf-not-found"], OK);
} else if (entwurf.error !== undefined) {
	finish([entwurf.error], RED);
} else {
	const herdrBin = process.env.HERDR_BIN_PATH;
	if (herdrBin === undefined || herdrBin === "") {
		finish(["herdr-bin-path-missing"], RED);
	} else {
		// Each listing is read AT MOST once, and the second is not read at all when the
		// first already failed: there is nothing to lay beside a report we do not have.
		const facts = readJson(entwurf.bin, ["peer-facts"], {
			failed: "peer-facts-failed",
			unparsable: "peer-facts-unparsable",
		});
		if (facts.error !== undefined) {
			finish([facts.error, `  ${facts.detail}`], RED);
		} else {
			const agents = readJson(herdrBin, ["agent", "list"], {
				failed: "herdr-agent-list-failed",
				unparsable: "herdr-agent-list-unparsable",
			});
			if (agents.error !== undefined) {
				finish([agents.error, `  ${agents.detail}`], RED);
			} else {
				const peers = Array.isArray(facts.value?.peers) ? facts.value.peers : null;
				const diagnostics = Array.isArray(facts.value?.diagnostics) ? facts.value.diagnostics : [];
				const agentRows = agents.value?.result?.agents;
				if (peers === null) {
					finish(["peer-facts-unparsable", "  payload has no `peers` array"], RED);
				} else if (!Array.isArray(agentRows)) {
					finish(["herdr-agent-list-unparsable", "  payload has no `result.agents` array"], RED);
				} else {
					finish(
						[
							"Entwurf garden citizens — read once, just now. Nothing here is refreshed.",
							"",
							...renderTable(peers, indexActivityByPane(agentRows)),
							"",
							...renderDiagnostics(diagnostics),
							"",
							"`herdr-reported activity` is Herdr's judgement about a screen, not Entwurf liveness,",
							"and not an address. To reach a citizen, dispatch to its garden id with entwurf_v2.",
						],
						OK,
					);
				}
			}
		}
	}
}
