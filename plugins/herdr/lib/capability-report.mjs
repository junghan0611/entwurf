/**
 * capability-report — the PURE leaf that turns already-gathered evidence into the four blocks
 * the status pane draws (#116 A1).
 *
 * IT IS A FUNCTION FROM DATA TO DATA. No `fs`, no `spawnSync`, no `process.env`, no dynamic
 * import, no clock. Every fact it renders was measured by somebody else and handed in. That is
 * what makes the render testable without a host, and it is why the gathering — which must open
 * files and import an installed module — lives in `activation-evidence.mjs` and in the status
 * orchestration, not here. The checkout/runtime two-artifact seam is a property of the GATHERER;
 * blurring it into the renderer would hide which artifact answered.
 *
 * THE FOUR BLOCKS ARE FOUR DIFFERENT KINDS OF SENTENCE, AND THE HEADER SAYS WHICH.
 * Each block carries three things that never merge:
 *   - `owner`        WHO is speaking. Herdr's listing is Herdr's word about Herdr; the ledger is
 *                    Entwurf's word about its own install; the rails table is this package's own
 *                    declaration; the citizen table is the record plus whoever observed placement.
 *   - `observedAt`   WHEN the fact was true. `now` was read during this open. `install-time` was
 *                    written once, when activation ran, and has not been re-checked since —
 *                    saying it any other way would turn a receipt into a live probe. `static`
 *                    was compiled in and is true of this package, not of this host.
 *   - `outcome`      the block's OWN verdict, and nothing else's.
 *
 * THERE IS NO AGGREGATE. No reducer, no `overall`, no "all green", no readiness word — not as a
 * field, not as a line, not as a computed property this module could later be asked for. That
 * absence is structural on purpose: three of these four blocks answer at different times, and a
 * single token over them would have to pick one time and lie about the other two. A host whose
 * Herdr integration is current, whose ledger was written last week, and whose runtime has since
 * been deleted is exactly the case a summary word erases.
 *
 * A BLOCK THAT COULD NOT BE READ SAYS SO IN ITS OWN VOICE. `outcome.kind === "error"` carries the
 * gatherer's named code; it never degrades to an empty section. An empty section and a failed read
 * look identical on a screen, and only one of them is safe to act on.
 */

/** The four block ids, in render order. The set is closed: a fifth block is a contract change. */
export const BLOCK_IDS = Object.freeze(["integration", "activation", "rails", "citizens"]);

/** WHO owns each block's fact. Written out rather than derived, so a rename cannot drift it. */
export const BLOCK_OWNER = Object.freeze({
	integration: "herdr",
	activation: "entwurf",
	rails: "entwurf-package",
	citizens: "entwurf",
});

/**
 * WHEN each block's fact was true. `install-time` is the one that must never be spelled `now`:
 * the activation ledger is an add-only record of what a past activation wrote, not a re-check of
 * what is standing there today.
 */
export const BLOCK_OBSERVED_AT = Object.freeze({
	integration: "now",
	activation: "install-time",
	rails: "static",
	citizens: "now",
});

/** The human heading for each block. */
const BLOCK_TITLE = Object.freeze({
	integration: "HERDR INTEGRATION",
	activation: "ENTWURF ACTIVATION",
	rails: "RAILS",
	citizens: "CITIZENS",
});

/** How the provenance line reads. One sentence per axis, never combined into a verdict. */
const OBSERVED_AT_PROSE = Object.freeze({
	now: "read now, this open",
	"install-time": "recorded at install time — not re-checked now",
	static: "declared by this package — not a fact about this host",
});

const OWNER_PROSE = Object.freeze({
	herdr: "herdr",
	entwurf: "entwurf",
	"entwurf-package": "entwurf (this package)",
});

/** A block, canonical by construction. `outcome` is the block's own and only verdict. */
function block(id, outcome, lines) {
	return Object.freeze({
		id,
		title: BLOCK_TITLE[id],
		owner: BLOCK_OWNER[id],
		observedAt: BLOCK_OBSERVED_AT[id],
		outcome: Object.freeze(outcome),
		lines: Object.freeze(lines),
	});
}

/** An error outcome always names its code; a reader must be able to grep for it. */
const failed = (code, detail) => ({ kind: "error", code, detail: detail ?? null });
const reported = (summary) => ({ kind: "reported", code: null, detail: summary });
const absent = (code, detail) => ({ kind: "absent", code, detail: detail ?? null });

/**
 * [1] HERDR INTEGRATION — Herdr's own listing, reduced to the two atoms this plugin selects.
 * `profile` is the frozen result of `buildActivationProfile`, or `null` with an `error`. A profile
 * that carries FAILING atoms is this block's own named error: the classification was already made
 * upstream, and a block that reported it as neutral would contradict the rows beneath it.
 */
export function integrationBlock({ profile, error }) {
	if (error !== undefined && error !== null) {
		return block("integration", failed(error.code, error.detail), [`  ${error.code}: ${error.detail ?? ""}`.trimEnd()]);
	}
	const rows = (profile?.selected ?? []).map((fact) => {
		const verdict = profile.activate.includes(fact.backend)
			? "selected for activation"
			: (profile.fail.find((f) => f.backend === fact.backend)?.reason ??
				profile.skip.find((s) => s.backend === fact.backend)?.reason ??
				"—");
		return `  ${fact.backend} (herdr atom \`${fact.atom}\`): ${fact.state} — ${verdict}`;
	});
	// AN AXIS THAT FAILED LEAVES ITS OWN RECEIPT, and "no aggregate green" never meant "no red".
	// `buildActivationProfile` has already CLASSIFIED: `outdated` and `needs-repair` are filed into
	// `profile.fail` and the build runner refuses them. Reporting that as a plain `reported` block
	// would be this surface disagreeing with its own classifier while every row on screen said
	// otherwise. `not-installed` is `profile.skip` and stays reported — a harness nobody integrated
	// is a state, not a fault. Rows are rendered either way; only the block's own verdict moves.
	const failing = profile?.fail ?? [];
	const lines = rows.length === 0 ? ["  (no rows)"] : rows;
	if (failing.length > 0) {
		// The name goes on SCREEN, beneath the rows it is about — every other named red on this
		// surface prints its code, and a verdict that lived only in the exit status would make the
		// operator infer from a number what the block could have said.
		const detail = failing.map((f) => `${f.backend}: ${f.reason}`).join("; ");
		return block("integration", failed("herdr-integration-not-current", detail), [
			...lines,
			`  herdr-integration-not-current: ${detail}`,
		]);
	}
	return block("integration", reported(`${rows.length} selected atom(s)`), lines);
}

/**
 * [2] ENTWURF ACTIVATION — the activation ledger, said as the install-time receipt it is.
 *
 * `evidence` is whatever `activation-evidence.mjs` returned. Its `kind` is the whole contract:
 * `absent` is a host that never activated (NOT an error), every other non-`ledger` kind is a
 * named red, and `ledger` carries the certified body plus the root cross-check. A `ledger` may
 * additionally carry a `code`: a receipt that is certified and true but grants no fallback, which
 * is rendered as its own line and does NOT make the block red — refusing to spend a receipt and
 * failing to read one are different things.
 */
export function activationBlock(evidence) {
	const kind = evidence?.kind;
	if (kind === "absent") {
		return block("activation", absent("activation-absent", evidence.detail ?? null), [
			"  no activation ledger and no installed runtime — this host has not activated Entwurf.",
			"  (that is a state, not a fault: installing Entwurf is not this plugin's business.)",
		]);
	}
	if (kind !== "ledger") {
		return block(
			"activation",
			failed(String(evidence?.code ?? "activation-evidence-unknown"), evidence?.detail ?? null),
			[`  ${String(evidence?.code ?? "activation-evidence-unknown")}: ${evidence?.detail ?? ""}`.trimEnd()],
		);
	}
	const ledger = evidence.ledger;
	const components = Array.isArray(ledger?.components) ? ledger.components : [];
	const lines = [
		`  phase: ${String(ledger?.phase ?? "?")}`,
		`  runtime root (recorded): ${String(ledger?.runtimeRoot ?? "?")}`,
		`  runtime root (derived here): ${evidence.derivedRuntimeRoot}`,
		...components.map((c) => `  ${String(c?.backend ?? "?")}: ${String(c?.state ?? "?")}`),
	];
	if (components.length === 0) lines.push("  (the ledger records no components)");
	// A CERTIFIED RECEIPT CAN STILL REFUSE SOMETHING, and the refusal is not a failure to read.
	// A ledger whose phase is `activating` or `deactivating` is true, reportable and spent on
	// nothing: the gatherer hands its name down here so the screen says which, instead of leaving
	// the operator to infer it from a citizen block that went quiet.
	if (evidence.code !== null && evidence.code !== undefined) {
		lines.push(`  ${String(evidence.code)}: ${evidence.detail ?? ""}`.trimEnd());
	}
	return block("activation", reported(`${components.length} component(s) recorded`), lines);
}

/**
 * [3] RAILS — what each backend's rail IS, straight from the shared declaration leaf.
 *
 * Nothing here is measured and nothing here is a promise about this host: a backend appears
 * because this package supports the rail, not because the host can reach it. The model string is
 * a SYNTAX example, and the block says so in the same breath so it cannot be read as a catalogue.
 */
export function railsBlock({ backends, modelSyntaxExample, railEntryNote }) {
	const lines = backends.map(
		(backend) =>
			`  ${backend}: ${railEntryNote[backend]}\n    model string syntax, one example only: \`${modelSyntaxExample[backend]}\``,
	);
	return block("rails", reported(`${backends.length} rail(s) declared`), [
		...lines,
		"  (examples show the SHAPE of a model string. Entwurf keeps no model list and validates none.)",
	]);
}

/** [4] CITIZENS — the existing table, or this axis's own named skip/failure. */
export function citizensBlock({ lines, error, skipped }) {
	if (skipped !== undefined && skipped !== null) {
		return block("citizens", absent(skipped.code, skipped.detail ?? null), [
			`  ${skipped.code}: ${skipped.detail ?? ""}`.trimEnd(),
		]);
	}
	if (error !== undefined && error !== null) {
		return block("citizens", failed(error.code, error.detail), [`  ${error.code}: ${error.detail ?? ""}`.trimEnd()]);
	}
	return block("citizens", reported("read"), lines);
}

/**
 * Render the four blocks to text. The ONLY place block order is decided, and the only place a
 * provenance header is written — so a block cannot be drawn without saying who owns it and when
 * it was true. There is deliberately no return value summarising the whole.
 */
export function renderReport(blocks) {
	const out = [];
	for (const id of BLOCK_IDS) {
		const b = blocks.find((x) => x.id === id);
		if (b === undefined) continue;
		out.push(
			`[${BLOCK_IDS.indexOf(id) + 1}] ${b.title} — owner: ${OWNER_PROSE[b.owner]}; ${OBSERVED_AT_PROSE[b.observedAt]}`,
		);
		out.push(...b.lines);
		out.push("");
	}
	return out;
}
