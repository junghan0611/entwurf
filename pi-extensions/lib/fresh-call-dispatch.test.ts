/**
 * fresh-call-dispatch (#76) — the provider a Pi-dialect model names, decided at the one root both
 * rails share, beside that root.
 *
 * The rails are driven for real through `dispatchFreshCall`: herdr with an explicit env and a spawn
 * that records and refuses, tmux with an env that has no tmux context, so neither can open anything.
 * Other backends are judged on the predicate alone: their tmux path runs capability preflights that
 * read the operator's own installation (Codex would probe its app-server), which this claim is not about.
 * A refusal is read as the reason AND as nothing spawned; a pass is read as the rail actually being
 * asked (herdr spawned its first read). The model ids are shapes, not a catalog: a version nobody
 * has shipped passes for the same reason a current one does.
 */
import { describe, expect, it } from "vitest";
import {
	dispatchFreshCall,
	dispatchResumeLaunch,
	freshCallProviderRefusal,
	renderDispatchedFreshCall,
	selectResumeRail,
} from "./fresh-call-dispatch.ts";
import type { SpawnedHerdrProcess, SpawnFn } from "./herdr-fresh-call.ts";

const HERDR_ENV = { HERDR_ENV: "1", HERDR_BIN_PATH: "/x/herdr", HERDR_PANE_ID: "w7:p1" };
const NO_TMUX = {};
const CALLER = "20260914T174741-2e9ba9";

/** Records and refuses, answering asynchronously through `close` the way a real child does. */
function recordingSpawn(): { spawn: SpawnFn; calls: string[][] } {
	const calls: string[][] = [];
	const spawn: SpawnFn = (bin, args) => {
		calls.push([bin, ...args]);
		const child: SpawnedHerdrProcess = {
			stdout: { on: () => undefined },
			stderr: {
				on: (_event: "data", listener: (chunk: Buffer | string) => void) => setTimeout(() => listener("refused"), 0),
			},
			on: (event: string, listener: (...rest: never[]) => void) => {
				if (event === "close") setTimeout(() => listener(...([1, null] as never[])), 0);
				return undefined;
			},
			kill: () => true,
		};
		return child;
	};
	return { spawn, calls };
}

async function onBothRails(backend: string, model: string) {
	const herdr = recordingSpawn();
	const onHerdr = await dispatchFreshCall(
		{ backend, model, task: "do it", callerGardenId: CALLER },
		HERDR_ENV,
		herdr.spawn,
	);
	const onTmux = await dispatchFreshCall(
		{ backend, model, task: "do it", callerGardenId: CALLER },
		NO_TMUX,
		recordingSpawn().spawn,
	);
	const reasonOf = (d: typeof onHerdr) => (d.result.ok ? null : d.result.reason);
	return {
		herdr: reasonOf(onHerdr),
		tmux: reasonOf(onTmux),
		herdrSpawned: herdr.calls.length,
		texts: [renderDispatchedFreshCall(onHerdr).text, renderDispatchedFreshCall(onTmux).text],
		rails: [onHerdr.rail, onTmux.rail],
	};
}

const PROVIDER_REASONS = ["model-openrouter-forbidden", "pi-model-not-provider-qualified"];

describe("fresh-call provider contract (#76)", () => {
	it("[QK:FCD-OPENROUTER-NAMED-REFUSED] pi and pi-durable naming the openrouter provider refuse on BOTH rails with nothing spawned, in any letter case and trimmed like the rails read it, while a malformed one keeps the grammar's own answer", async () => {
		for (const [backend, model] of [
			["pi", "openrouter/openai/gpt-5.6-sol"],
			["pi", " OpenRouter/openai/gpt-6.1-terra "],
			["pi", "OPENROUTER/z-ai/glm-5.3"],
			["pi-durable", "openrouter/openai/gpt-6.1-sol"],
		] as const) {
			const seen = await onBothRails(backend, model);
			expect(seen.herdr, `${backend} ${model} herdr`).toBe("model-openrouter-forbidden");
			expect(seen.tmux, `${backend} ${model} tmux`).toBe("model-openrouter-forbidden");
			expect(seen.rails).toEqual(["herdr", "tmux"]);
			expect(seen.herdrSpawned, `${backend} ${model}`).toBe(0);
			for (const text of seen.texts) expect(text).toContain("OpenRouter is not a sibling rail");
		}
		expect((await onBothRails("pi", "openrouter/x y")).tmux).toBe("model-invalid");
	});

	it("[QK:FCD-PI-PROVIDER-QUALIFIED] a pi model must name a provider: a bare alias refuses on BOTH rails with nothing spawned, while any <provider>/<id> reaches the rail whatever version it names, and entwurf/<id> still meets #128 after it", async () => {
		for (const model of ["terra", " gpt-6.1-sol ", "openai-codex/"]) {
			const seen = await onBothRails("pi", model);
			expect(seen.herdr, model).toBe("pi-model-not-provider-qualified");
			expect(seen.tmux, model).toBe("pi-model-not-provider-qualified");
			expect(seen.herdrSpawned, model).toBe(0);
			for (const text of seen.texts) expect(text).toContain("`<provider>/<model id>`");
		}
		for (const model of [
			"openai-codex/gpt-5.6-sol",
			"openai-codex/gpt-6.5-sol:low",
			"zai/glm-9",
			"entwurf/claude-opus-5-5",
		]) {
			const seen = await onBothRails("pi", model);
			expect(PROVIDER_REASONS, model).not.toContain(seen.herdr);
			expect(PROVIDER_REASONS, model).not.toContain(seen.tmux);
			expect(seen.herdrSpawned, model).toBeGreaterThan(0);
		}
		expect((await onBothRails("pi", "entwurf/claude-sonnet-5")).tmux).toBe("acp-model-not-curated");
	});

	it("[QK:FCD-PROVIDER-OTHER-BACKENDS-UNJUDGED] every other backend's model string is that vendor's own name and is not judged by either rule — a claude-code alias stays an alias and reaches the rail, and a bare pi-durable model is left to its own preflight", async () => {
		for (const [backend, model] of [
			["claude-code", "opus"],
			["claude-code", "openrouter/anything"],
			["codex", "openrouter/gpt-6.1-sol"],
			["copilot", "terra"],
			["omp", "openrouter/x"],
			["pi-durable", "gpt-6.1-sol"],
		] as const) {
			expect(freshCallProviderRefusal(backend, model), `${backend} ${model}`).toBeNull();
		}
		const herdr = recordingSpawn();
		const alias = await dispatchFreshCall(
			{ backend: "claude-code", model: "opus", task: "do it", callerGardenId: CALLER },
			HERDR_ENV,
			herdr.spawn,
		);
		expect(alias.result.ok ? null : alias.result.reason).not.toBe("pi-model-not-provider-qualified");
		expect(herdr.calls.length).toBeGreaterThan(0);
	});
});

// ── #178: the Herdr Core rail at the shared root ─────────────────────────────────────────────
describe("the resume rail table and the hc refusal of a fresh call (#178)", () => {
	const HC = { HC_TERMINAL_ID: "t7", HC_TERMINAL_SOCKET: "/nonexistent/hc-dispatch-test.sock" };
	const INPUT = { backend: "pi", cwd: "/nonexistent/hc-dispatch-test", runtimeArgs: ["--session", "/x.jsonl"] };

	it("[QK:FCD-RESUME-RAIL-TABLE] the rail a resume reopens on is read from four rows: an hc marker alone is hc, HERDR_ENV=1 alone is herdr, neither is tmux, and both is ambiguous — TMUX is never a marker, so a tmux anchor a core inherited does not win over hc", () => {
		const TMUX = { TMUX: "/tmp/tmux-1000/default,1,0", TMUX_PANE: "%1" };
		expect(selectResumeRail(HC)).toBe("hc");
		expect(selectResumeRail({ ...HC, ...TMUX })).toBe("hc");
		expect(selectResumeRail({ HC_TERMINAL_ID: "t7" })).toBe("hc");
		expect(selectResumeRail({ HC_TERMINAL_SOCKET: "/s.sock" })).toBe("hc");
		expect(selectResumeRail({ HERDR_ENV: "1" })).toBe("herdr");
		expect(selectResumeRail({ HERDR_ENV: "1", ...TMUX })).toBe("herdr");
		expect(selectResumeRail({})).toBe("tmux");
		expect(selectResumeRail(TMUX)).toBe("tmux");
		expect(selectResumeRail({ HC_TERMINAL_ID: "", HC_TERMINAL_SOCKET: "", HERDR_ENV: "true" })).toBe("tmux");
		expect(selectResumeRail({ ...HC, HERDR_ENV: "1" })).toBe("ambiguous");
		expect(selectResumeRail({ HC_TERMINAL_ID: "t7", HERDR_ENV: "1" })).toBe("ambiguous");
	});

	it("[QK:FCD-RESUME-AMBIGUOUS-NO-RAIL] contradictory markers are refused at the root by name with nothing created: neither the tmux mapping nor herdr is asked, and no rail is chosen by preference", async () => {
		const herdr = recordingSpawn();
		let tmuxCalls = 0;
		const outcome = await dispatchResumeLaunch(
			INPUT,
			() => {
				tmuxCalls++;
				return { ok: true as const };
			},
			{ ...HC, HERDR_ENV: "1", HERDR_BIN_PATH: "/x/herdr", HERDR_PANE_ID: "w7:p1" },
			herdr.spawn,
		);
		expect(outcome).toMatchObject({ ok: false, reason: "rail-markers-ambiguous" });
		expect("failure" in outcome).toBe(false);
		expect(tmuxCalls).toBe(0);
		expect(herdr.calls.length).toBe(0);
	});

	it("[QK:FCD-RESUME-HC-NO-FALLBACK] inside an hc terminal the hc launch answers and no other rail is asked: an hc refusal stays an hc refusal even when a tmux anchor and a tmux mapping are right there", async () => {
		const herdr = recordingSpawn();
		let tmuxCalls = 0;
		const tmuxLaunch = () => {
			tmuxCalls++;
			return { ok: true as const };
		};
		// A complete context whose cwd does not exist: refused by the hc leaf before any socket use.
		const refused = await dispatchResumeLaunch(
			INPUT,
			tmuxLaunch,
			{ ...HC, TMUX: "/tmp/tmux-1000/default,1,0", TMUX_PANE: "%1" },
			herdr.spawn,
		);
		expect(refused).toMatchObject({ ok: false, reason: "cwd-missing" });
		// A half-present marker selects hc and is refused there by name.
		const half = await dispatchResumeLaunch(INPUT, tmuxLaunch, { HC_TERMINAL_ID: "t7" }, herdr.spawn);
		expect(half).toMatchObject({ ok: false, reason: "hc-context-missing" });
		expect(tmuxCalls).toBe(0);
		expect(herdr.calls.length).toBe(0);
		// Outside hc the two existing rows are what they were.
		const onTmux = await dispatchResumeLaunch(INPUT, tmuxLaunch, {}, herdr.spawn);
		expect(onTmux).toEqual({ ok: true });
		expect(tmuxCalls).toBe(1);
	});

	it("[QK:FCD-FRESH-HC-UNSUPPORTED] a fresh call from inside an hc terminal is refused by name before any other question — no provider or model answer, nothing spawned, nothing sent to tmux or herdr", async () => {
		for (const env of [HC, { ...HC, HERDR_ENV: "1", HERDR_BIN_PATH: "/x/herdr", HERDR_PANE_ID: "w7:p1" }]) {
			for (const [backend, model] of [
				["pi", "openai-codex/gpt-6.1-terra"],
				["pi", "terra"],
				["claude-code", "claude-sonnet-5-5"],
				["pi-durable", "openai-codex/gpt-6.1-terra"],
				["codex", "gpt-6.1-sol"],
			] as const) {
				const herdr = recordingSpawn();
				const dispatched = await dispatchFreshCall(
					{ backend, model, task: "do it", callerGardenId: CALLER },
					env,
					herdr.spawn,
				);
				expect(dispatched.rail, `${backend} ${model}`).toBe("hc");
				expect(dispatched.result).toEqual({ ok: false, reason: "hc-fresh-unsupported" });
				expect(herdr.calls.length).toBe(0);
				const rendered = renderDispatchedFreshCall(dispatched);
				expect(rendered.isError).toBe(true);
				expect(rendered.text.startsWith("entwurf_fresh_call rejected: hc-fresh-unsupported — ")).toBe(true);
				expect(rendered.text.endsWith("Nothing was opened.")).toBe(true);
			}
		}
	});
});
