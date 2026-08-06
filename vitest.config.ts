import { defineConfig } from "vitest/config";

/**
 * Vitest pilot (issue #62). Scope: test/**. The hand-built `scripts/check-*` gates
 * stay outside — they migrate lane by lane, each behind its `run.sh` transition shim.
 *
 * `fileParallelism: false` is deliberate, not a default left in place: the contract
 * tests boot the real MCP bridge as a subprocess and share the repo checkout, and the
 * issue's own measurement predicts flakes from naive parallelism across ~62
 * subprocess-spawning gates. Start serial; relax only on measurement.
 */
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		fileParallelism: false,
		// A hung bridge boot must fail the gate, not hang qualification's outer
		// timeout: the boot helper's own 10s timer stays the primary bound.
		testTimeout: 30_000,
	},
});
