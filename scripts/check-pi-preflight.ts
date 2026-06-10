/**
 * check-pi-preflight — deterministic gate for 0.11 Stage 0 (2): the controlled-
 * launch trust decision. Pure decision + a real temp agentDir; no backend, no
 * network, no hook. Safe in the `pnpm check` static floor.
 *
 * Synthetic fixture = pi's OWN `ProjectTrustStore` pointed at a temp agentDir:
 * we seed trust with `store.set(cwd, …)` and `preflight()` reads it back through
 * the same store, so the saved-trust path is checked against pi's real function
 * (same process — trivial, frozen ledger). `PI_CODING_AGENT_DIR` / the injected
 * `agentDir` keep this off the operator's real `~/.pi/agent/trust.json`.
 *
 * Proves frozen decision 8 precedence end to end:
 *   saved false > saved true > prefix match > no-trust-inputs > fail-fast
 * plus decision 7's separator boundary (`/repos` ≠ `/repos-sibling`), `~`
 * expansion of operator roots, and the rich evidence the fact surface consumes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { preflight } from "../pi-extensions/lib/entwurf-preflight.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "psa-preflight-")));
const agentDir = path.join(tmpRoot, "agent");
const prefixRoot = path.join(tmpRoot, "repos");
fs.mkdirSync(agentDir, { recursive: true });
fs.mkdirSync(prefixRoot, { recursive: true });

// Seed a trust-gated project input. We use a `.pi/` config dir, NOT an
// AGENTS.md: pi 0.79.1 dropped AGENTS.md/CLAUDE.md from hasProjectTrustInputs
// (they are now always-loaded context files, not trust-gated inputs), leaving
// `.pi` (cwd-only) and `.agents/skills` (walked to root). `.pi` is cwd-scoped,
// so each fixture is an independent trust input with no walk-to-root bleed, and
// it reads as a trust input on BOTH 0.79.0 and 0.79.1 — this fixture swap is
// version-agnostic and lands green before the pi bump.
function seedTrustInput(dir: string): void {
	fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
}

// A real cwd must exist for ProjectTrustStore's realpathSync canonicalization
// and for hasProjectTrustInputs' filesystem walk.
function mkCwd(name: string, withTrustInput = false): string {
	const dir = path.join(prefixRoot, name);
	fs.mkdirSync(dir, { recursive: true });
	if (withTrustInput) seedTrustInput(dir);
	return dir;
}

const store = new ProjectTrustStore(agentDir);

try {
	// 1. saved false beats a prefix match (explicit distrust wins — the load-
	//    bearing half of decision 8). Evidence carries the raw store value.
	const cwd1 = mkCwd("saved-false", true);
	store.set(cwd1, false);
	const d1 = preflight({ cwd: cwd1, agentDir, prefixRoots: [prefixRoot] });
	ok(
		"saved false → deny/saved-false (even under a prefix root)",
		d1.kind === "deny" && d1.reason === "saved-false" && d1.trustStoreDecision === false && d1.launchArgs.length === 0,
	);

	// 2. saved true → approve, launchArgs carries the internal --approve.
	const cwd2 = mkCwd("saved-true", true);
	store.set(cwd2, true);
	const d2 = preflight({ cwd: cwd2, agentDir });
	ok(
		"saved true → approve/saved-true + launchArgs=['--approve']",
		d2.kind === "approve" &&
			d2.reason === "saved-true" &&
			d2.trustStoreDecision === true &&
			d2.launchArgs.length === 1 &&
			d2.launchArgs[0] === "--approve",
	);

	// 3. undecided + prefix match → approve; evidence names the matched root AND
	//    still reports hasTrustInputs (the fact surface explains what it may load).
	const cwd3 = mkCwd("prefix-hit", true); // has a trust input, yet prefix wins over fail-fast
	const d3 = preflight({ cwd: cwd3, agentDir, prefixRoots: [prefixRoot] });
	ok(
		"null + prefix match → approve/prefix-match + matchedPrefixRoot + hasTrustInputs",
		d3.kind === "approve" &&
			d3.reason === "prefix-match" &&
			d3.matchedPrefixRoot === prefixRoot &&
			d3.hasTrustInputs === true &&
			d3.launchArgs[0] === "--approve",
	);

	// 4. undecided + no trust inputs + no prefix → trusted-no-arg, no launch arg.
	const cwd4 = path.join(tmpRoot, "no-inputs"); // OUTSIDE prefixRoot, no trust input
	fs.mkdirSync(cwd4, { recursive: true });
	const d4 = preflight({ cwd: cwd4, agentDir, prefixRoots: [prefixRoot] });
	ok(
		"null + no trust inputs → trusted-no-arg + launchArgs=[] + hasTrustInputs=false",
		d4.kind === "trusted-no-arg" &&
			d4.reason === "no-trust-inputs" &&
			d4.hasTrustInputs === false &&
			d4.launchArgs.length === 0,
	);

	// 5. undecided + trust inputs + no prefix → fail-fast.
	const cwd5 = path.join(tmpRoot, "lonely-inputs"); // OUTSIDE prefixRoot
	fs.mkdirSync(cwd5, { recursive: true });
	seedTrustInput(cwd5);
	const d5 = preflight({ cwd: cwd5, agentDir, prefixRoots: [prefixRoot] });
	ok(
		"null + trust inputs + no prefix → deny/fail-fast",
		d5.kind === "deny" && d5.reason === "fail-fast" && d5.hasTrustInputs === true && d5.launchArgs.length === 0,
	);

	// 6. empty roots ⇒ no prefix promotion (frozen decision 7: no package default).
	const cwd6 = mkCwd("would-match-but-no-roots", true);
	const d6 = preflight({ cwd: cwd6, agentDir, prefixRoots: [] });
	ok(
		"undecided + inputs + EMPTY roots → fail-fast (no package-default prefix)",
		d6.kind === "deny" && d6.reason === "fail-fast" && d6.matchedPrefixRoot === undefined,
	);

	// 7. separator boundary: a sibling sharing a string prefix must NOT match.
	//    root=<tmp>/repos, cwd=<tmp>/repos-sibling — bare startsWith would wrongly
	//    match; canonical + sep boundary must not.
	const sibling = path.join(tmpRoot, "repos-sibling");
	fs.mkdirSync(sibling, { recursive: true });
	seedTrustInput(sibling);
	const d7 = preflight({ cwd: sibling, agentDir, prefixRoots: [prefixRoot] });
	ok(
		"prefix `/repos` does NOT match sibling `/repos-sibling` (sep boundary)",
		d7.kind === "deny" && d7.reason === "fail-fast" && d7.matchedPrefixRoot === undefined,
	);

	// 8. the root itself (cwd === root) matches, and canonicalCwd is the realpath.
	const dRoot = preflight({ cwd: prefixRoot, agentDir, prefixRoots: [prefixRoot] });
	ok(
		"cwd === prefix root matches (boundary inclusive) + canonicalCwd is realpath",
		dRoot.kind === "approve" && dRoot.canonicalCwd === prefixRoot,
	);

	// 9. `~`-relative operator root expands and matches (frozen decision 7 GLG
	//    default is `~/repos/gh` shaped). HOME → temp so we never touch the real
	//    home; os.homedir() reads $HOME on Linux.
	const origHome = process.env.HOME;
	process.env.HOME = tmpRoot;
	try {
		const tildeProj = path.join(tmpRoot, "repos", "gh", "proj");
		fs.mkdirSync(tildeProj, { recursive: true });
		seedTrustInput(tildeProj);
		const dTilde = preflight({ cwd: tildeProj, agentDir, prefixRoots: ["~/repos"] });
		ok(
			"`~/repos` operator root expands and matches cwd under it",
			dTilde.kind === "approve" && dTilde.reason === "prefix-match" && dTilde.matchedPrefixRoot === prefixRoot,
		);
	} finally {
		if (origHome === undefined) delete process.env.HOME;
		else process.env.HOME = origHome;
	}

	// 10-12. nearest-ancestor trust inheritance (pi 0.79.1). 0.79.0's store.get
	//     matched the cwd EXACTLY; 0.79.1's getEntry/findNearestTrustEntry walks
	//     up to the closest ancestor carrying an explicit decision. preflight reads
	//     pi's store directly (frozen decision 9), so this propagation flows
	//     through verbatim — a saved decision on a PARENT now decides a child that
	//     has no decision of its own. This is the production half of frozen
	//     decision 8: an operator distrust on `~/repos/gh` reaches every repo under
	//     it. These assertions FAIL on 0.79.0 (parent set, child get → null) and
	//     are intentionally gated behind the 0.79.1 floor (committed with the bump).

	// 10. inherited distrust beats a prefix match: parent=false, child under both
	//     the parent AND a prefix root → the inherited saved-false still denies
	//     (saved distrust is the strongest rung; a prefix only promotes null).
	const inheritParent = mkCwd("inherit-deny", true);
	const inheritChild = path.join(inheritParent, "nested", "child");
	fs.mkdirSync(inheritChild, { recursive: true });
	store.set(inheritParent, false);
	const dInheritDeny = preflight({ cwd: inheritChild, agentDir, prefixRoots: [prefixRoot] });
	ok(
		"child inherits parent's saved-false (nearest ancestor) → deny, even under a prefix root",
		dInheritDeny.kind === "deny" && dInheritDeny.reason === "saved-false" && dInheritDeny.trustStoreDecision === false,
	);

	// 11. inherited trust: parent=true, child with no own decision → approve via
	//     saved-true (reason is saved-true, NOT prefix-match — the store wins first).
	const trustParent = mkCwd("inherit-approve", true);
	const trustChild = path.join(trustParent, "nested", "child");
	fs.mkdirSync(trustChild, { recursive: true });
	store.set(trustParent, true);
	const dInheritApprove = preflight({ cwd: trustChild, agentDir });
	ok(
		"child inherits parent's saved-true (nearest ancestor) → approve/saved-true + --approve",
		dInheritApprove.kind === "approve" &&
			dInheritApprove.reason === "saved-true" &&
			dInheritApprove.trustStoreDecision === true &&
			dInheritApprove.launchArgs[0] === "--approve",
	);

	// 12. nearest wins: the child's OWN false overrides an ancestor true (the walk
	//     stops at the closest decision, it does not keep climbing past it).
	const nearestChild = path.join(trustParent, "distrusted-leaf");
	fs.mkdirSync(nearestChild, { recursive: true });
	store.set(nearestChild, false);
	const dNearest = preflight({ cwd: nearestChild, agentDir });
	ok(
		"child's own saved-false overrides an ancestor saved-true (nearest entry wins)",
		dNearest.kind === "deny" && dNearest.reason === "saved-false" && dNearest.trustStoreDecision === false,
	);

	// 13. isolation: every set above landed in the temp store; the real operator
	//     trust.json was never opened.
	ok("temp agentDir holds the trust file (real ~/.pi untouched)", fs.existsSync(path.join(agentDir, "trust.json")));
} finally {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log(`[check-pi-preflight] ${passed} assertions ok`);
