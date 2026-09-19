import { defineConfig } from "vitest/config";

/**
 * Vitest pilot (issue #62). Two scopes now, and they are reached differently.
 *
 * `test/**` is the migration lane: gates move here one at a time, each behind its
 * `run.sh` transition shim, and each shim NAMES the files it runs.
 *
 * The two behavior-adjacent globs are issue #119 V2 — a test written beside the code
 * it certifies. Nothing names those files. `check-tests-beside-behavior` filters this
 * same include down to them positionally, so a new `.test.ts` next to a pi extension
 * is run by public `pnpm check` the moment it exists. One include, because the two
 * filename-listing shims are mutant gate argv (mux-fresh-call carries 56) and a second
 * config would have to be kept in step with this one by hand.
 *
 * `fileParallelism: false` is deliberate, not a default left in place: the contract
 * tests boot the real MCP bridge as a subprocess and share the repo checkout, and the
 * issue's own measurement predicts flakes from naive parallelism across ~62
 * subprocess-spawning gates. Start serial; relax only on measurement.
 */
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts", "pi-extensions/**/*.test.ts", "plugins/herdr/**/*.test.mjs"],
		fileParallelism: false,
		// A hung bridge boot must fail the gate, not hang qualification's outer
		// timeout: the boot helper's own 10s timer stays the primary bound.
		testTimeout: 30_000,
	},
});
