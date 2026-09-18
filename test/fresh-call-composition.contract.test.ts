/**
 * fresh-call composition leaf — the fence that lets a second rail exist (#116 S2-a).
 *
 * The leaf was extracted so a herdr rail can compose a sibling's argv, first turn and nonce
 * WITHOUT importing `mux-fresh-call.ts` — that file pulls tmux placement, three launch
 * preflights and the Codex socket resolver behind it, and one import would have dragged the
 * whole tmux rail into a rail that has no tmux.
 *
 * Two things are therefore proven here and nowhere else:
 *
 *   - the leaf's import list stays node-standard-library only, so the fence is a fact about
 *     the file rather than an intention in a comment;
 *   - the tmux rail's composed bytes did not move when the code did. A refactor that quietly
 *     reworded the first turn or reordered an argv would be invisible to every other gate in
 *     this lane, because they all read the composition through the same functions it changed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	composeBackendArgs,
	composeFreshCallFraming,
	composeFreshCallPrompt,
	FRESH_CALL_BACKENDS,
	FRESH_CALL_CALLBACK_TOOL,
	FRESH_CALL_PEERS_TOOL,
	type FreshCallComposition,
} from "../pi-extensions/lib/fresh-call-composition.ts";
import {
	buildBackendArgs,
	buildFreshCallPrompt,
	TMUX_FRESH_CALL_OPENING_LINE,
} from "../pi-extensions/lib/mux-fresh-call.ts";
import { REPO_DIR } from "./helpers/fresh-call-fixtures.ts";

const LEAF = "pi-extensions/lib/fresh-call-composition.ts";
const LEAF_SRC = fs.readFileSync(path.join(REPO_DIR, LEAF), "utf8");

const COMPOSITION: FreshCallComposition = { prompt: "PROMPT", bootstrapPayload: "PAYLOAD" };
const GID = "20260914T175029-d7b623";
const NONCE = "mux-fresh-call-deadbeefdeadbeefdeadbeef";
const TASK = "do the thing";

describe("the leaf's import fence", () => {
	/** Every `from "…"` in the file, in source order. */
	const specifiers = [...LEAF_SRC.matchAll(/^import\s[^;]*?from\s+"([^"]+)";$/gm)].map((m) => m[1]);

	it("[QK:FRESHCOMP-NODE-ONLY-IMPORTS] the leaf imports only the node standard library — a repo-local import here is how the tmux rail would creep back in", () => {
		expect(specifiers.length).toBeGreaterThan(0);
		for (const spec of specifiers) expect(spec.startsWith("node:")).toBe(true);
	});

	it("[QK:FRESHCOMP-NO-RAIL-IMPORT] the leaf names no mux, entwurf or native-push module at all, in import or in type position", () => {
		const code = LEAF_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).not.toMatch(/from\s+"\.\/(mux-|entwurf-|native-push\/)/);
		expect(code).not.toMatch(/resolveCodexDefaultSocketPath|inspectPlacement|runTmux|assertLaunchTarget/);
	});

	it("[QK:FRESHCOMP-NO-PLACEMENT-VOCABULARY] placement, seat and runtime proof stayed on the rail — the leaf knows no coordinate", () => {
		const code = LEAF_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).not.toMatch(/tmuxSession|sessionId|windowId|paneId|runtimePath|placement/i);
	});
});

describe("the tmux rail's bytes did not move when the code did", () => {
	it("[QK:FRESHCOMP-TMUX-OPENING-LINE] the tmux opening sentence is preserved to the byte", () => {
		expect(TMUX_FRESH_CALL_OPENING_LINE).toBe(
			"You are a fresh visible citizen that entwurf opened in the operator's tmux session.",
		);
	});

	it("[QK:FRESHCOMP-TMUX-PROMPT-UNCHANGED] the rail wrapper still emits its opening sentence first, then the neutral framing", () => {
		const prompt = buildFreshCallPrompt({ backend: "pi", task: TASK, callerGardenId: GID, nonce: NONCE });
		expect(prompt.split("\n")[0]).toBe(TMUX_FRESH_CALL_OPENING_LINE);
		expect(prompt).toBe(
			composeFreshCallPrompt({
				backend: "pi",
				task: TASK,
				callerGardenId: GID,
				nonce: NONCE,
				openingLine: TMUX_FRESH_CALL_OPENING_LINE,
			}),
		);
	});

	it("[QK:FRESHCOMP-PEERS-TOOL-DIALECT] the tool the framing OFFERS is spelled in the same backend dialect as the one it requires — a corroboration named in a spelling the sibling's own session does not expose is an offer it cannot take", () => {
		// Every backend, because the defect was exactly that four of them shared one bare spelling.
		for (const backend of FRESH_CALL_BACKENDS) {
			const framing = composeFreshCallFraming({
				backend,
				callerGardenId: GID,
				nonce: NONCE,
				openingLine: TMUX_FRESH_CALL_OPENING_LINE,
			}).join("\n");
			expect(framing).toContain(FRESH_CALL_PEERS_TOOL[backend]);
			expect(framing).toContain(FRESH_CALL_CALLBACK_TOOL[backend]);
		}
		// The two maps are the SAME dialect applied to two tools, so a backend whose callback name
		// is composed must have a composed peers name too. pi is the one that is bare in both.
		for (const backend of FRESH_CALL_BACKENDS) {
			expect(FRESH_CALL_PEERS_TOOL[backend].startsWith("entwurf_")).toBe(
				FRESH_CALL_CALLBACK_TOOL[backend].startsWith("entwurf_"),
			);
		}
		// omp is read, never pattern-matched: its `[a-z_]` sanitizer ate the digit in `entwurf_v2`,
		// and `entwurf_peers` has no digit, so the same rule keeps the whole word here.
		expect(FRESH_CALL_CALLBACK_TOOL.omp).toBe("mcp__entwurf_bridge_entwurf_v");
		expect(FRESH_CALL_PEERS_TOOL.omp).toBe("mcp__entwurf_bridge_entwurf_peers");
	});

	it("[QK:FRESHCOMP-RAIL-OWNS-PLACEMENT-SENTENCE] a rail supplies that sentence — the leaf refuses an empty one instead of inventing a default that would be false somewhere", () => {
		expect(() =>
			composeFreshCallPrompt({ backend: "pi", task: TASK, callerGardenId: GID, nonce: NONCE, openingLine: "" }),
		).toThrow(/openingLine is empty/);
	});

	it("[QK:FRESHCOMP-ARGV-UNCHANGED] every backend's argv is what the rail wrapper produced before the extraction", () => {
		const socket = () => "/home/operator/.codex/app-server-control/app-server-control.sock";
		// The launch directory is the second codex-only fact the RAIL owns (#95 lane C): the
		// wrapper's default is this process's own, so the leaf is handed exactly that to keep the
		// two argvs comparable byte for byte.
		const launchCwd = () => process.cwd();
		for (const backend of ["pi", "claude-code", "copilot", "omp", "codex"] as const) {
			expect(composeBackendArgs(backend, COMPOSITION, "m/1", socket, launchCwd)).toEqual(
				buildBackendArgs(backend, COMPOSITION, "m/1", { HOME: "/home/operator" }),
			);
		}
	});
});

describe("the injected Codex socket path", () => {
	it("[QK:FRESHCOMP-CODEX-SOCKET-INJECTED] the leaf is handed the path and never derives it — the resolver lives with delivery, which this file may not import", () => {
		const args = composeBackendArgs(
			"codex",
			COMPOSITION,
			"m/1",
			() => "/tmp/sock",
			() => "/tmp/work",
		);
		expect(args).toContain("unix:///tmp/sock");
	});

	it("[QK:FRESHCOMP-CODEX-SOCKET-LAZY] the thunk runs only for codex, so a host that cannot resolve a Codex home still opens pi and claude — exactly as the inline call did", () => {
		const exploding = () => {
			throw new Error("codex app-server: neither CODEX_HOME nor HOME is available");
		};
		const cwd = () => "/tmp/work";
		expect(() => composeBackendArgs("pi", COMPOSITION, "m/1", exploding, cwd)).not.toThrow();
		expect(() => composeBackendArgs("claude-code", COMPOSITION, "m/1", exploding, cwd)).not.toThrow();
		expect(() => composeBackendArgs("codex", COMPOSITION, "m/1", exploding, cwd)).toThrow(/CODEX_HOME/);
		// The launch-directory thunk is lazy for the SAME reason, and the herdr rail relies on it:
		// codex is not a pilot backend there, so its resolver throws rather than guessing a path.
		const noCwd = () => {
			throw new Error("herdr-fresh-call: codex is not a pilot backend on this rail");
		};
		expect(() => composeBackendArgs("pi", COMPOSITION, "m/1", () => "/tmp/sock", noCwd)).not.toThrow();
		expect(() => composeBackendArgs("codex", COMPOSITION, "m/1", () => "/tmp/sock", noCwd)).toThrow(
			/not a pilot backend/,
		);
	});
});
