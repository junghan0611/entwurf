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
import { dispatchFreshCall, freshCallProviderRefusal, renderDispatchedFreshCall } from "./fresh-call-dispatch.ts";
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
