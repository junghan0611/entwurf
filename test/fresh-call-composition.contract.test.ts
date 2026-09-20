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
	FRESH_CALL_DELIVERY_TOOL,
	FRESH_CALL_PEERS_TOOL,
	FRESH_CALL_TOOL_LOAD_HINT,
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
		expect(FRESH_CALL_CALLBACK_TOOL.omp).toBe("mcp__entwurf_bridge_entwurf_callback");
		expect(FRESH_CALL_PEERS_TOOL.omp).toBe("mcp__entwurf_bridge_entwurf_peers");
	});

	it("[QK:FRESHCOMP-RESULT-GOES-TO-CALLER] the first turn names WHERE the result goes, in the same dialect as the callback and identically on both rails — a sibling with a visible window has no way to know its window is not the delivery", () => {
		for (const backend of FRESH_CALL_BACKENDS) {
			const tool = FRESH_CALL_DELIVERY_TOOL[backend];
			// The sentence is TOPOLOGY, in two halves: where to send it, and why sending is needed
			// at all. The second half is what makes the first one necessary.
			const expected = [
				`When the task reaches its requested final result, send that result to the same target with ${tool}.`,
				"Output in this sibling window is not delivered to the caller.",
			];
			for (const openingLine of [
				TMUX_FRESH_CALL_OPENING_LINE,
				"You are a fresh visible citizen that entwurf opened in a new herdr tab.",
			]) {
				const framing = composeFreshCallFraming({ backend, callerGardenId: GID, nonce: NONCE, openingLine });
				// Same two lines, same order, LAST — the rail supplies only the first sentence, so a
				// rail that grew its own version of this one would be composing a second contract.
				expect(framing.slice(-2)).toEqual(expected);
			}
			// And it is the DELIVERY tool, never the birth callback or the peers one.
			expect(expected[0]).toContain(FRESH_CALL_DELIVERY_TOOL[backend]);
			expect(expected[0]).not.toContain(FRESH_CALL_PEERS_TOOL[backend]);
		}
		// Nothing in the leaf watches for completion or sends on the sibling's behalf: the sentence
		// is the whole mechanism, and a supervisor is what this rail refuses to be.
		const code = LEAF_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).not.toMatch(/setInterval|setTimeout|watch|poll/i);
	});

	it("[QK:FRESHCOMP-TOOL-LOAD-HINT-CLAUDE-ONLY] the one backend measured to need it is told how to load its callback tool, and no other backend's framing gains a byte", () => {
		// `[측정 2026-09-18, n=5]` claude-code 2.1.267 surfaced the bridge's tools as DEFERRED (name
		// listed, schema absent) or still-connecting on EVERY probe — directly callable zero times —
		// so a child told "FIRST ACTION … call entwurf_v2" answered in text and went idle. That is
		// the production silence, 5 of 14 recorded launches. `[측정, n=3]` the sentence below made it
		// 3/3, including a child 782 ms in, which is slower than every silent run.
		const claude = composeFreshCallFraming({
			backend: "claude-code",
			callerGardenId: GID,
			nonce: NONCE,
			openingLine: TMUX_FRESH_CALL_OPENING_LINE,
		}).join("\n");
		// ONE select carries both tools: the corroboration the framing offers has to stay reachable
		// for the child that takes the offer, and a second ToolSearch is a second thing to get right.
		expect(claude).toContain(
			`ToolSearch("select:${FRESH_CALL_CALLBACK_TOOL["claude-code"]},${FRESH_CALL_PEERS_TOOL["claude-code"]}")`,
		);
		expect((claude.match(/ToolSearch/g) ?? []).length).toBe(1);
		// It states a fact and asks for a call. The REGISTER is checked on the hint's own lines, not
		// on the whole framing — the surrounding prose says "you do not happen to see" and "no other
		// way to know", and a file-wide match would be asserting something about sentences this
		// claim does not own. What this claim owns is that the added line neither forbids nor claims
		// authority: that is the register the prohibitions came out for (2026-09-17, a Sonnet sibling
		// refused a first turn over one).
		const hintText = FRESH_CALL_TOOL_LOAD_HINT["claude-code"].join(" ");
		expect(hintText).not.toMatch(/\bdo not\b|\bnever\b|\byou must\b|\byou are required\b/i);
		for (const backend of FRESH_CALL_BACKENDS) {
			const framing = composeFreshCallFraming({
				backend,
				callerGardenId: GID,
				nonce: NONCE,
				openingLine: TMUX_FRESH_CALL_OPENING_LINE,
			}).join("\n");
			expect((framing.match(/ToolSearch/g) ?? []).length).toBe(backend === "claude-code" ? 1 : 0);
			// The hint is a per-backend template, so a dialect that moves moves here too rather than
			// leaving a stale tool name in the one sentence a stuck child depends on.
			if (FRESH_CALL_TOOL_LOAD_HINT[backend].length > 0) {
				expect(framing).toContain(FRESH_CALL_CALLBACK_TOOL[backend]);
				expect(framing).not.toContain("${callbackTool}");
			}
		}
		// Only the measured backend carries a hint at all — a sentence invented for a runtime nobody
		// probed would be this rail guessing about a vendor again.
		expect(FRESH_CALL_BACKENDS.filter((backend) => FRESH_CALL_TOOL_LOAD_HINT[backend].length > 0)).toEqual([
			"claude-code",
		]);
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
