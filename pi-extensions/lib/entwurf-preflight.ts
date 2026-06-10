/**
 * entwurf-preflight — 0.11 Stage 0 (2): the SINGLE trust/launch decision owner.
 *
 * The controlled-launch surface, the global `project_trust` handler, and any
 * MCP fact tool ALL consume this module's outcome — nobody else re-derives a
 * prefix, re-reads `trust.json`, or re-probes trust inputs. pi's raw trust
 * semantics are followed by importing pi's PUBLIC root exports directly (frozen
 * decision 9, 재구현 금지): `ProjectTrustStore` (the canonical `trust.json`
 * reader, which itself canonicalizes the cwd and takes a `proper-lockfile` on
 * every read) and `hasProjectTrustInputs` (the trust-input probe). We never copy
 * pi's trust detail — if pi changes it, this import tracks it.
 *
 * The returned `PreflightOutcome` is deliberately RICH, not just {kind,reason}:
 * a fact tool must explain *why* a cwd is approved and *what* it may load
 * without re-running the probe, and an error/handler must name the matched root
 * or the trust-store value. Thin outcomes would push callers to recompute, which
 * is exactly the re-derivation this module exists to prevent.
 *
 * trust ≠ discovery: this decision touches the store for a SINGLE launch-time
 * cwd only. `peers`/`who-can` discovery does not call here (frozen decision 4).
 *
 * Precedence (frozen decision 8) — saved distrust is stronger than a prefix
 * allow; a prefix only promotes the UNDECIDED (null) case; no-trust-inputs is
 * trusted but needs no launch arg; everything else is fail-fast:
 *
 *   saved === false        → deny           (explicit distrust; store wins)
 *   saved === true         → approve        (saved trust → internal --approve)
 *   null + prefix match    → approve        (operator prefix promotes null→yes)
 *   null + no trust inputs → trusted-no-arg (no trust-gated input — pi 0.79.1
 *                                             excludes AGENTS.md/CLAUDE.md, so
 *                                             context files may still be loaded)
 *   else (null + inputs)   → fail-fast      (unknown/untrusted controlled launch)
 *
 * Injection (frozen decision 4): `agentDir` defaults to `getAgentDir()` but is
 * overridable so tests point `ProjectTrustStore` at a temp dir (or set
 * `PI_CODING_AGENT_DIR`, same isolation as 0.10.0) and never read or dirty the
 * operator's real `~/.pi/agent/trust.json`. `prefixRoots` is an OPERATOR-policy
 * input with NO package default (frozen decision 7): a public package must not
 * hardcode a broad auto-approve, so an empty roots list means "no prefix
 * promotion" — the caller injects the operator's roots (e.g. `~/repos/gh`).
 */

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
	getAgentDir,
	hasProjectTrustInputs,
	type ProjectTrustDecision,
	ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

export interface PreflightInput {
	/** The single launch-time cwd whose trust is being decided. */
	cwd: string;
	/**
	 * pi agent dir holding `trust.json`. Defaults to `getAgentDir()` (which
	 * honors `PI_CODING_AGENT_DIR`). Override to a temp dir for isolated tests.
	 */
	agentDir?: string;
	/**
	 * Operator-policy auto-approve roots. NO package default (frozen decision 7).
	 * Roots may be `~`-relative (`~/repos/gh`) or relative; they are normalized
	 * the same way as the cwd. A cwd at or under one of these (canonical path +
	 * separator boundary) promotes an UNDECIDED trust into approve. Empty ⇒ no
	 * prefix promotion.
	 */
	prefixRoots?: readonly string[];
}

/** Fields present on every outcome — the fact/handler/error evidence. */
interface PreflightEvidence {
	/**
	 * Args the launcher must add. `["--approve"]` when approving, `[]` otherwise.
	 * Frozen decision 6: never `--no-approve` (that is a silent degraded launch).
	 */
	readonly launchArgs: readonly string[];
	/**
	 * The trust decision that applies to this cwd: `ProjectTrustStore.getEntry(cwd)
	 * ?.decision ?? null`. Identical value to the old `.get(cwd)`, but sourced from
	 * `getEntry` so the deciding entry's path/inheritance survive (below).
	 */
	readonly trustStoreDecision: ProjectTrustDecision;
	/**
	 * The pi-canonical path of the trust-store entry that decided this cwd, or
	 * undefined when neither the cwd nor any ancestor carries a decision
	 * (trustStoreDecision === null). On 0.79.1 `getEntry` walks up to the nearest
	 * ancestor with an explicit decision and returns ITS path — so this is the
	 * source a deny message must name (N3b `inheritedFrom`). pi-canonical =
	 * `canonicalizePath(resolvePath())`, the same realpath axis as `canonicalCwd`.
	 */
	readonly trustStoreEntryPath?: string;
	/**
	 * True when the deciding entry is an ANCESTOR, not the cwd itself — the
	 * decision is INHERITED (0.79.1 nearest-ancestor walk-up). False for a direct
	 * decision on the cwd or for no decision at all. The inherited-false case is
	 * the one that silently blocks a human's active prompt (Trust 2층): the
	 * handler defers `undecided`, then the store's inherited false wins anyway, so
	 * only an active prompt → `{trusted:"yes", remember:true}` escapes it.
	 */
	readonly trustStoreInherited: boolean;
	/** `hasProjectTrustInputs(cwd)` — computed even when a prefix already won. */
	readonly hasTrustInputs: boolean;
	/** The canonical operator root that matched, if the decision is prefix-driven. */
	readonly matchedPrefixRoot?: string;
	/** The cwd after tilde-expand → resolve → realpath (raw-resolved fallback). */
	readonly canonicalCwd: string;
}

/**
 * Controlled-launch decision. The launcher maps:
 *   approve         → spawn child with `launchArgs` (`--approve`; load project files)
 *   trusted-no-arg  → spawn child, no `--approve` needed (no project files)
 *   deny            → refuse to spawn (throw); never a silent `--no-approve`
 */
export type PreflightOutcome =
	| (PreflightEvidence & { readonly kind: "approve"; readonly reason: "saved-true" | "prefix-match" })
	| (PreflightEvidence & { readonly kind: "trusted-no-arg"; readonly reason: "no-trust-inputs" })
	| (PreflightEvidence & { readonly kind: "deny"; readonly reason: "saved-false" | "fail-fast" });

/** A deny outcome — the only shape `formatPreflightDenial` accepts. */
export type PreflightDenial = Extract<PreflightOutcome, { kind: "deny" }>;

/**
 * Render the human-facing reason a controlled launch was refused (N3b). This is
 * a PURE formatter over a deny outcome — it does NOT touch a launcher, a socket,
 * or pi; wiring it into the controlled-launch surface is bucket B (step 5), not
 * here. The launcher/handler/error layers all call this so the refusal text is
 * identical everywhere and always sourced from F5a evidence.
 *
 * The inherited-false branch is the one that matters: an operator distrust on an
 * ANCESTOR (e.g. `~/repos/gh`) silently denies a child cwd, and an agent CANNOT
 * lift it — that is an intended security property (N3a: a controlled launch
 * short-circuits on `trustOverride` and never reaches the human-only active
 * prompt). So the message must (1) name the inherited source (`inheritedFrom`)
 * and (2) give the only real remedy: open an interactive pi AT the cwd and
 * approve, which writes a direct child trust that beats the inherited decision
 * (the "escape direction" proven in check-pi-preflight #13b).
 */
export function formatPreflightDenial(outcome: PreflightDenial): string {
	const cwd = outcome.canonicalCwd;
	const openHere = `open an interactive pi at ${cwd} and approve when prompted`;
	if (outcome.reason === "saved-false") {
		if (outcome.trustStoreInherited && outcome.trustStoreEntryPath !== undefined) {
			return (
				`Controlled launch refused: ${cwd} is distrusted by inheritance from ${outcome.trustStoreEntryPath} ` +
				`(an ancestor carries a saved "no"). An agent cannot self-promote trust — this is an intended ` +
				`security property. To trust THIS cwd only, ${openHere}; that writes a direct decision for ${cwd} ` +
				`which overrides the inherited one.`
			);
		}
		return `Controlled launch refused: ${cwd} is explicitly distrusted (a saved "no" on this directory). To change it, ${openHere}.`;
	}
	// fail-fast: undecided + trust inputs + no operator prefix root.
	return (
		`Controlled launch refused: ${cwd} is untrusted — it has trust inputs but no saved decision and no ` +
		`operator prefix root. Refusing a silent degraded launch. Either add ${cwd} under an operator prefix ` +
		`root, or ${openHere}.`
	);
}

/**
 * Normalize a path the way pi resolves one before the trust store sees it:
 * expand a leading `~`, make it absolute (`path.resolve`), then `realpathSync`;
 * on a resolve failure fall back to the RESOLVED absolute path (not the raw
 * input), so a not-yet-existing root still compares on an absolute basis.
 */
function normalizePath(p: string): string {
	let expanded = p;
	if (p === "~") {
		expanded = homedir();
	} else if (p.startsWith("~/")) {
		expanded = join(homedir(), p.slice(2));
	}
	const abs = isAbsolute(expanded) ? expanded : resolve(expanded);
	try {
		return realpathSync(abs);
	} catch {
		return abs;
	}
}

/**
 * Return the canonical operator root that contains `canonicalCwd`, by canonical
 * path + separator boundary (frozen decision 7). `/org` matches `/org/a` but NOT
 * `/org2` — never a bare `startsWith`. Roots are normalized the same as the cwd.
 */
function matchedPrefixRoot(canonicalCwd: string, roots: readonly string[]): string | undefined {
	for (const root of roots) {
		const r = normalizePath(root);
		if (canonicalCwd === r || canonicalCwd.startsWith(r + sep)) {
			return r;
		}
	}
	return undefined;
}

/** Decide trust for a single controlled-launch cwd. See module header. */
export function preflight(input: PreflightInput): PreflightOutcome {
	const agentDir = input.agentDir ?? getAgentDir();
	const prefixRoots = input.prefixRoots ?? [];

	const canonicalCwd = normalizePath(input.cwd);
	const store = new ProjectTrustStore(agentDir);
	// getEntry, not get: get() throws away which path decided. getEntry returns
	// `{ path, decision } | null` — the nearest ancestor (or the cwd itself)
	// carrying an explicit decision. We recover the same decision value AND the
	// deciding path, so the fact/handler/error layers can name an inherited
	// source without re-walking the store. entry.path is pi-canonical, the same
	// realpath axis as `canonicalCwd`, so an entry on the cwd ITSELF compares
	// equal (= direct) and an ancestor compares unequal (= inherited).
	const entry = store.getEntry(input.cwd);
	const trustStoreDecision: ProjectTrustDecision = entry?.decision ?? null;
	const trustStoreInherited = entry !== null && entry.path !== canonicalCwd;
	// Computed unconditionally: a fact tool must report what a prefix-approved
	// cwd could load, so the probe runs even when a prefix already decides.
	const hasTrustInputs = hasProjectTrustInputs(input.cwd);
	const matched = matchedPrefixRoot(canonicalCwd, prefixRoots);

	const evidence: PreflightEvidence = {
		launchArgs: [],
		trustStoreDecision,
		trustStoreInherited,
		hasTrustInputs,
		canonicalCwd,
		...(entry !== null ? { trustStoreEntryPath: entry.path } : {}),
		...(matched !== undefined ? { matchedPrefixRoot: matched } : {}),
	};

	// Explicit distrust wins over everything, including a prefix match.
	if (trustStoreDecision === false) {
		return { ...evidence, kind: "deny", reason: "saved-false" };
	}
	if (trustStoreDecision === true) {
		return { ...evidence, kind: "approve", reason: "saved-true", launchArgs: ["--approve"] };
	}

	// trustStoreDecision === null (undecided): a prefix promotes it; otherwise the
	// absence of trust inputs makes it trusted-but-no-arg; otherwise fail-fast.
	if (matched !== undefined) {
		return { ...evidence, kind: "approve", reason: "prefix-match", launchArgs: ["--approve"] };
	}
	if (!hasTrustInputs) {
		return { ...evidence, kind: "trusted-no-arg", reason: "no-trust-inputs" };
	}
	return { ...evidence, kind: "deny", reason: "fail-fast" };
}
