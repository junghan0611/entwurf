/**
 * resume-picker-rows — what the `entwurf resume` list shows (#173 C3), proven beside the module.
 *
 * Pure functions over fact rows: no store, no socket, no terminal. Each claim is its own test
 * title, because `run_vitest` attributes a mutant kill from the failed TEST TITLE:
 *
 *   RESUMEROWS-PIN-BY-GARDEN-ID     a pin joins a row on the garden id alone, and a pin with no
 *                                   record makes no row
 *   RESUMEROWS-LIVE-STILL-LISTED    liveness never removes or reorders a row: the list is not
 *                                   eligibility, the leaf is
 *   RESUMEROWS-FACTS-VERBATIM       the liveness-side facts are the provider's words; placement
 *                                   is neither read nor printed
 *   RESUMEROWS-DEFAULT-IS-THIS-DIR  the default view is this directory plus every pin; a pin from
 *                                   elsewhere stays, in its own section, with its path
 *   RESUMEROWS-UNLISTED-COUNTED     a backend with no same-id resume is counted, not listed, and
 *                                   the listed set is the one the leaf does not refuse
 *   RESUMEROWS-ORDER                pins in bookmark order first, then newest record first
 *   RESUMEROWS-NARROW-ONLY-HIDES    typing hides rows and never reorders or adds one
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PeerFact } from "./entwurf-facts.ts";
import {
	buildResumeListing,
	describeFacts,
	RESUME_LISTED_BACKENDS,
	resumeRowText,
	unlistedResumeCounts,
	visibleResumeRows,
} from "./resume-picker-rows.ts";

// The label is the contract, so it travels as expect's message.
function ok(label: string, cond: boolean): void {
	expect(cond, label).toBe(true);
}

const HERE = "/work/project";
const THERE = "/work/other";

function fact(over: Partial<PeerFact> & Pick<PeerFact, "gardenId">): PeerFact {
	return {
		backend: "pi",
		nativeSessionId: `native-${over.gardenId}`,
		cwd: HERE,
		model: "provider/model-a",
		createdAt: "2026-11-01T00:00:00.000Z",
		recordUpdatedAt: "2026-11-01T00:00:00.000Z",
		liveness: "dead",
		receiver: "n/a",
		transcript: "exists",
		placement: { kind: "unobserved" },
		...over,
	} as PeerFact;
}

const A = "20261101T000000-aaaaaa";
const B = "20261102T000000-bbbbbb";
const C = "20261103T000000-cccccc";
const D = "20261104T000000-dddddd";
const E = "20261105T000000-eeeeee";
const GHOST = "20261106T000000-ffffff";

const FACTS: PeerFact[] = [
	fact({ gardenId: A, recordUpdatedAt: "2026-11-10T00:00:00.000Z" }),
	fact({ gardenId: B, recordUpdatedAt: "2026-11-20T00:00:00.000Z", liveness: "alive" }),
	fact({
		gardenId: C,
		backend: "claude-code",
		model: null,
		liveness: "unsupported",
		receiver: "inactive",
		recordUpdatedAt: "2026-11-15T00:00:00.000Z",
	}),
	fact({ gardenId: D, cwd: THERE, recordUpdatedAt: "2026-11-22T00:00:00.000Z" }),
	fact({ gardenId: E, cwd: THERE, backend: "pi-durable", liveness: "unsupported", receiver: "unobserved" }),
	fact({ gardenId: "20261107T000000-111111", backend: "codex", liveness: "unsupported" }),
	fact({ gardenId: "20261108T000000-222222", backend: "codex", liveness: "unsupported", cwd: THERE }),
	fact({ gardenId: "20261109T000000-333333", backend: "copilot", liveness: "unsupported", receiver: "none" }),
];

const ids = (rows: { gardenId: string }[]): string => rows.map((r) => r.gardenId).join(",");
const DEFAULT = { allDirectories: false, query: "" };
const ALL = { allDirectories: true, query: "" };

describe("the entwurf resume list", () => {
	it("[QK:RESUMEROWS-PIN-BY-GARDEN-ID] a pin joins a fact row on the garden id alone and a pin with no record makes no row — a bookmark is not an address, so a stale or mistyped one can name no candidate", () => {
		const listing = buildResumeListing(FACTS, HERE, [
			{ gardenId: GHOST, name: "Gone" },
			{ gardenId: C, name: "Reviewer" },
			{ gardenId: C, name: "Reviewer again" },
		]);
		ok(
			"one pinned row, the ghost counted and absent, the duplicate ignored",
			listing.rows.filter((r) => r.pin !== null).length === 1 &&
				listing.rows.find((r) => r.gardenId === C)?.pin === "Reviewer" &&
				!listing.rows.some((r) => r.gardenId === GHOST) &&
				JSON.stringify(listing.pinsWithoutRecord) === JSON.stringify([{ gardenId: GHOST, name: "Gone" }]) &&
				listing.rows.length === 5,
		);
	});

	it("[QK:RESUMEROWS-LIVE-STILL-LISTED] a citizen whose socket answers is listed like any other and keeps its place — the list is a way to find an id, and whether that id can be reopened is the leaf's answer when it is chosen", () => {
		const listing = buildResumeListing(FACTS, HERE, []);
		const here = visibleResumeRows(listing, DEFAULT);
		ok(
			"the live row is present, first by recency, and says alive in the provider's word",
			ids(here) === [B, C, A].join(",") && here[0]?.facts === "socket alive",
		);
	});

	it("[QK:RESUMEROWS-FACTS-VERBATIM] the liveness-side facts are printed in the provider's own words — unsupported, unobserved and unknown are never turned into dead, inactive or eligible — and placement is neither read nor printed", () => {
		const src = fs.readFileSync(
			path.join(path.dirname(fileURLToPath(import.meta.url)), "resume-picker-rows.ts"),
			"utf8",
		);
		const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		const withPane = fact({ gardenId: A, placement: { kind: "herdr-pane", paneId: "pane-77" } as never });
		const rendered = JSON.stringify(resumeRowText(buildResumeListing([withPane], HERE, []).rows[0] as never));
		ok(
			"each axis only where it applies, the provider's word where neither does, and no placement",
			describeFacts({ liveness: "dead", receiver: "n/a" }) === "socket dead" &&
				describeFacts({ liveness: "unknown" as never, receiver: "n/a" }) === "socket unknown" &&
				describeFacts({ liveness: "unsupported", receiver: "unobserved" }) === "receiver unobserved" &&
				describeFacts({ liveness: "unsupported", receiver: "inactive" }) === "receiver inactive" &&
				describeFacts({ liveness: "alive", receiver: "active" }) === "socket alive, receiver active" &&
				describeFacts({ liveness: "unsupported", receiver: "n/a" }) === "liveness unsupported" &&
				!/placement/.test(code) &&
				!rendered.includes("pane-77"),
		);
	});

	it("[QK:RESUMEROWS-DEFAULT-IS-THIS-DIR] the default view is this directory's citizens plus every pin: a pinned citizen of another directory stays, in its own section and with its path, and the unpinned ones of other directories appear only when the filter is lifted", () => {
		const listing = buildResumeListing(FACTS, HERE, [{ gardenId: E, name: "Elsewhere pin" }]);
		const def = visibleResumeRows(listing, DEFAULT);
		const all = visibleResumeRows(listing, ALL);
		const pinned = def.find((r) => r.gardenId === E);
		ok(
			"default hides only unpinned other-directory rows; the far pin carries its path",
			ids(def) === [E, B, C, A].join(",") &&
				pinned?.section === "pin-elsewhere" &&
				JSON.stringify(resumeRowText(pinned as never)) ===
					JSON.stringify({
						gardenId: E,
						backend: "pi-durable",
						facts: ["receiver unobserved"],
						activity: "2026-11-01T00:00Z",
						model: "provider/model-a",
						pin: "Elsewhere pin",
						cwd: THERE,
					}) &&
				resumeRowText(def[1] as never).cwd === null &&
				ids(all) === [E, B, C, A, D].join(",") &&
				resumeRowText(all[4] as never).cwd === THERE,
		);
	});

	it("[QK:RESUMEROWS-UNLISTED-COUNTED] citizens of a backend with no same-id resume are counted by backend for the current scope and are not rows, and the listed set is exactly the backends the leaf does not refuse", () => {
		const listing = buildResumeListing(FACTS, HERE, []);
		const leaf = fs.readFileSync(
			path.join(path.dirname(fileURLToPath(import.meta.url)), "resume-launch-identity.ts"),
			"utf8",
		);
		const resolver = (leaf.split("export function resolveResumeLaunchIdentity")[1] ?? "").split("\n}\n")[0] ?? "";
		ok(
			"counts follow the directory filter, no such row exists, and the set mirrors the leaf",
			JSON.stringify(unlistedResumeCounts(listing, false)) ===
				JSON.stringify([
					["codex", 1],
					["copilot", 1],
				]) &&
				JSON.stringify(unlistedResumeCounts(listing, true)) ===
					JSON.stringify([
						["codex", 2],
						["copilot", 1],
					]) &&
				!listing.rows.some((r) => r.backend === "codex" || r.backend === "copilot") &&
				JSON.stringify(RESUME_LISTED_BACKENDS) === JSON.stringify(["pi", "pi-durable", "claude-code"]) &&
				/record\.backend === "claude-code"/.test(resolver) &&
				/record\.backend === "pi-durable"/.test(resolver) &&
				/if \(record\.backend !== "pi"\) \{\s*throw new ResumeBackendUnsupportedError/.test(resolver),
		);
	});

	it("a pi-durable citizen of this directory whose receiver is active is a row of THIS directory, pinned in place — measured on a real store: the coordinating sibling is exactly this shape, and a count that missed it would have pushed its bookmark into the other-directory section", () => {
		const P = "20261014T000000-abcdef";
		const durable = fact({
			gardenId: P,
			backend: "pi-durable",
			model: null,
			liveness: "unsupported",
			receiver: "active",
		});
		const listing = buildResumeListing([...FACTS, durable], HERE, [{ gardenId: P, name: "운영코디" }]);
		const row = visibleResumeRows(listing, DEFAULT)[0];
		ok(
			"first row, pinned here, the receiver fact printed, no path appended",
			row?.gardenId === P &&
				row.section === "pin-here" &&
				row.facts === "receiver active" &&
				JSON.stringify(resumeRowText(row)) ===
					JSON.stringify({
						gardenId: P,
						backend: "pi-durable",
						facts: ["receiver active"],
						activity: "2026-11-01T00:00Z",
						model: null,
						pin: "운영코디",
						cwd: null,
					}),
		);
	});

	it("[QK:RESUMEROWS-ORDER] pins come first in the bookmark's own order, this directory's before another's, and every other row is newest record first", () => {
		const listing = buildResumeListing(FACTS, HERE, [
			{ gardenId: A, name: "Second in time, first in the bookmark" },
			{ gardenId: D, name: "Far" },
			{ gardenId: B, name: "Newest" },
		]);
		const unpinned = buildResumeListing(FACTS, HERE, []);
		ok(
			"bookmark order within a pin section, recency after",
			ids(visibleResumeRows(listing, ALL)) === [A, B, D, C, E].join(",") &&
				listing.rows.map((r) => r.section).join(",") === "pin-here,pin-here,pin-elsewhere,here,elsewhere" &&
				ids(visibleResumeRows(unpinned, ALL)) === [B, C, A, D, E].join(","),
		);
	});

	it("[QK:RESUMEROWS-NARROW-ONLY-HIDES] typing hides rows that lack a word and never reorders or adds one: every word must appear, case does not matter, and a pin name, a model and a directory are all things to type", () => {
		const listing = buildResumeListing(FACTS, HERE, [{ gardenId: C, name: "Reviewer" }]);
		const q = (query: string, allDirectories = false) => ids(visibleResumeRows(listing, { allDirectories, query }));
		ok(
			"AND over what is printed",
			q("REVIEW") === C &&
				q("pi model-a") === [B, A].join(",") &&
				q("pi  model-a  alive") === B &&
				q("other") === "" &&
				q("other", true) === [D, E].join(",") &&
				q("no-such-word") === "" &&
				q("   ") === [C, B, A].join(","),
		);
	});
});
