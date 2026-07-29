// Deterministic gate for the ACP provider registration surface (S0 loader/fence,
// updated S2c when the real backend replaced the fail-loud stub, and again in
// 0.13 when cortex joined claude on the adapter rail).
//
// Three layers:
//   (1 lib)     loads the REAL lib modules and asserts the curated Claude
//               surface + no-auth sentinel shape;
//   (2 entry)   COMPILES the project to a temp dir (root tsc emit, so the `.js`
//               imports resolve to real emitted `.js`), imports the compiled
//               acp-provider.js, and drives its default export against a fake pi
//               that captures registerProvider — real execution capture of the
//               actual entry, idempotency included, the EXACT curated model set
//               BOTH adapters contribute, and that streamSimple is the real
//               streamShellAcp backend (by name, NOT invoked — that spawns);
//   (3 source)  an auxiliary source-shape lock on acp-provider.ts.
//
// [QK:*] labels mark the claims kill-qualified by scripts/mutants/acp-cortex.json.
//
// Layer 2 is the GPT-reviewed resolution to a fence tension: acp-provider.ts
// imports its lib with `.js` suffixes (the root/jiti runtime convention), which
// plain `node --experimental-strip-types` cannot resolve to `.ts`. Rather than
// force the entry onto a `.ts` strip-types fence (S0 avoids that) or collapse the
// lib/acp split, the gate emits the real build artifact and imports THAT — so the
// `.js` imports and the real default export both execute. Temp output lives under
// .tmp-verify/ (forbidden from the npm tarball) and is removed after the run.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, rmdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	CURATED_ANCHOR_MODEL_ID,
	curatedClaudeModels,
	ENTWURF_ACP_NO_AUTH_SENTINEL,
	PROVIDER_ID,
	SUPPORTED_ANTHROPIC_MODEL_IDS,
	SUPPORTED_CORTEX_MODEL_IDS,
} from "../pi-extensions/lib/acp/models.ts";

// ---------------------------------------------------------------------------
// Layer 1 — lib-level surface (real modules, real behavior)
// ---------------------------------------------------------------------------

// Current pre-rename provider id. S1 must rename this load-bearing routing id to `entwurf` together with its gates.
assert.equal(PROVIDER_ID, "entwurf", "PROVIDER_ID must match the current pre-rename provider id");

// no-auth sentinel shape: lowercase + hyphen only, so pi does not read it as an
// ENV reference. An ALL-CAPS value would trip the legacy-env path.
assert.match(
	ENTWURF_ACP_NO_AUTH_SENTINEL,
	/^[a-z0-9-]+$/,
	`no-auth sentinel must be lowercase+hyphen (got "${ENTWURF_ACP_NO_AUTH_SENTINEL}")`,
);
assert.equal(ENTWURF_ACP_NO_AUTH_SENTINEL, "entwurf-no-auth", "no-auth sentinel literal drifted");

// curated Claude anchor present + full row shape.
const models = curatedClaudeModels();
assert.ok(models.length >= 1, "curated Claude surface must register at least one model");
const ids = models.map((m) => m.id);
assert.ok(
	ids.includes(CURATED_ANCHOR_MODEL_ID),
	`curated Claude anchor ${CURATED_ANCHOR_MODEL_ID} missing from surface: ${ids.join(", ")}`,
);
const REQUIRED_MODEL_FIELDS = ["id", "name", "reasoning", "input", "cost", "contextWindow", "maxTokens"] as const;
for (const m of models) {
	for (const field of REQUIRED_MODEL_FIELDS) {
		assert.ok(field in m, `model ${m.id} missing required ProviderModelConfig field: ${field}`);
	}
	assert.ok(m.contextWindow > 0, `model ${m.id} contextWindow must be positive`);
	assert.ok(m.maxTokens > 0, `model ${m.id} maxTokens must be positive`);
}

// S2c: the provider path is open — streamSimple is the REAL ACP backend, no
// longer the S0 fail-loud stub. The wiring is verified through the compiled
// entry (Layer 2) WITHOUT invoking it: streamShellAcp returns its stream
// synchronously and spawns the backend on a microtask, so calling it in a
// deterministic gate would launch a real child. Live behavior is proved by
// smoke-acp-provider-live (LIVE-gated).

// ---------------------------------------------------------------------------
// Layer 2 — real entry capture (compiled acp-provider.js driven by a fake pi)
// ---------------------------------------------------------------------------

interface CapturedCfg {
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	models?: Array<{ id: string }>;
	streamSimple?: (...args: unknown[]) => unknown;
}

const TMP_EMIT = ".tmp-verify/acp-entry-capture";
rmSync(TMP_EMIT, { recursive: true, force: true });
try {
	// Root tsc emit (no input files → uses the root tsconfig's program), so the
	// entry's `.js` imports resolve to real emitted siblings.
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});

	const entryUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/acp-provider.js")).href;
	const mod = await import(entryUrl);

	const calls: Array<{ id: string; cfg: CapturedCfg }> = [];
	const fakePi = {
		registerProvider(id: string, cfg: CapturedCfg) {
			calls.push({ id, cfg });
		},
	};

	// Drive the REAL default export twice — the second call must be a no-op.
	mod.default(fakePi);
	mod.default(fakePi);

	assert.equal(
		calls.length,
		1,
		`entry must register exactly once across two calls (idempotency) — got ${calls.length}`,
	);
	const cap = calls[0];
	assert.equal(cap.id, PROVIDER_ID, `entry registered the wrong provider id: ${cap.id}`);
	assert.equal(cap.cfg.apiKey, ENTWURF_ACP_NO_AUTH_SENTINEL, "entry apiKey is not the no-auth sentinel");
	assert.equal(cap.cfg.api, "entwurf", "entry api field drifted");
	const capIds = (cap.cfg.models ?? []).map((m) => m.id);
	for (const want of ["claude-sonnet-5", CURATED_ANCHOR_MODEL_ID]) {
		assert.ok(capIds.includes(want), `entry model surface missing ${want} (got: ${capIds.join(", ") || "none"})`);
	}

	// The REAL entry must register the curated rows of EVERY adapter on the rail —
	// claude's 2 unprefixed ids AND cortex's 4 `cortex-` ids. This is the JOIN
	// claim, distinct from the per-backend data claims: check-acp-cortex pins the
	// 4-row cortex curation in models.ts, but nothing there proves those rows
	// actually reach `pi.registerProvider`. An entry that filtered `cortex-` out
	// of `allCuratedModels()` would leave models.ts and check-acp-cortex fully
	// green while the operator's model list silently lost the whole backend.
	//
	// Set comparison (sorted, exact) — not `includes`: a substring/anchor probe
	// cannot see a row that VANISHED, and the cortex ids contain the claude ids as
	// substrings. Expected is derived from the two source id constants so there is
	// one SSOT; the literal 6 below is the independent floor that catches a
	// curation list mutated to empty (which would move expected and captured
	// together).
	const expectedIds = [...SUPPORTED_ANTHROPIC_MODEL_IDS, ...SUPPORTED_CORTEX_MODEL_IDS].slice().sort();
	assert.equal(
		expectedIds.length,
		6,
		`curated id constants must total 6 rows (claude 2 + cortex 4) — got ${expectedIds.length}: ${expectedIds.join(", ")}`,
	);
	assert.deepEqual(
		capIds.slice().sort(),
		expectedIds,
		`[QK:CORTEX-PROVIDER-SIX-ROW-SURFACE] compiled entry must register the EXACT curated set of both adapters (claude 2 + cortex 4) — got: ${capIds.join(", ") || "none"}`,
	);
	assert.equal(typeof cap.cfg.streamSimple, "function", "entry streamSimple must be a function");
	// Regression guard: the entry must wire the REAL backend (streamShellAcp),
	// not the removed S0 stub. We check by name rather than invoking — invoking
	// would spawn a real ACP child. The compiled fn keeps its source name.
	assert.equal(
		cap.cfg.streamSimple?.name,
		"streamShellAcp",
		`entry must wire the real streamShellAcp backend (got "${cap.cfg.streamSimple?.name}")`,
	);
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
	try {
		// The emit created `.tmp-verify/` as TMP_EMIT's parent. This gate now carries
		// a mutant lane, so it runs inside check-gate-qualification's PURITY-checked
		// snapshot, whose tree manifest walks ignored paths too — a leftover empty
		// parent dir reads as IMPURE drift. Remove it when empty; a concurrent
		// sibling gate's emit keeps it alive and the rmdir just fails.
		// (Same repair as check-acp-cortex / check-acp-session-reuse.)
		rmdirSync(".tmp-verify");
	} catch {
		// non-empty or already gone — fine either way
	}
}

// ---------------------------------------------------------------------------
// Layer 3 — auxiliary source-shape lock (pi-extensions/acp-provider.ts)
// ---------------------------------------------------------------------------

const entrySrc = readFileSync("pi-extensions/acp-provider.ts", "utf8");
assert.ok(
	!/apiKey:\s*["'`]/.test(entrySrc),
	"entry must not assign apiKey a string literal — use the no-auth sentinel constant",
);
const registerCalls = entrySrc.match(/\.registerProvider\(/g) ?? [];
assert.equal(
	registerCalls.length,
	1,
	`entry must call registerProvider exactly once in source (found ${registerCalls.length})`,
);
// The entry must wire the real backend and must not reference the removed stub.
assert.match(entrySrc, /streamSimple:\s*streamShellAcp\b/, "entry must wire streamSimple: streamShellAcp");
assert.ok(!/backend-stub/.test(entrySrc), "entry must not import the removed S0 backend-stub");

console.log(
	`[check-acp-provider-surface] ok — compiled entry registers ${PROVIDER_ID} once (idempotent) with the no-auth ` +
		`sentinel + the EXACT curated set of both adapters (claude ${SUPPORTED_ANTHROPIC_MODEL_IDS.length} incl. ` +
		`${CURATED_ANCHOR_MODEL_ID} + cortex ${SUPPORTED_CORTEX_MODEL_IDS.length}) + real streamShellAcp backend (S2c); ` +
		`claude lib surface verified live (${models.length} model(s))`,
);
