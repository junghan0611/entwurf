/**
 * #160 S3 step 3: the OpenClaw birth writer's order and refusals, proven beside the module.
 * The store write is an injected recorder (the real `upsertMetaSession` with backend `openclaw` is
 * the flip cell); the probe is a stand-in for the receive adapter's describe probe.
 */
import { describe, expect, it } from "vitest";
import { birthOpenclawCitizen, type OpenclawBirthDeps } from "./openclaw-birth.ts";
import { parseOpenclawCitizensDeclaration } from "./openclaw-citizens.ts";

const DECL = parseOpenclawCitizensDeclaration(
	JSON.stringify({
		version: 1,
		gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
		allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:s1m1" }],
		freshKeyPrefix: { scope: "lab", agentId: "main", prefix: "agent:main:entwurf-" },
	}),
);

function deps(status: "alive" | "dead" | "indeterminate" = "alive") {
	const store = new Map<string, string>();
	const order: string[] = [];
	const d: OpenclawBirthDeps = {
		readDeclaration: () => {
			order.push("decl");
			return DECL;
		},
		probe: async (id) => {
			order.push(`probe ${id}`);
			return status === "alive" ? { status } : { status, reason: "r" };
		},
		upsert: (id, cwd) => {
			order.push(`upsert ${id} ${cwd}`);
			const existing = store.get(id);
			if (existing) return { action: "attach", gardenId: existing };
			const gid = `20261113T15000${store.size}-0a0a0a`;
			store.set(id, gid);
			return { action: "create", gardenId: gid };
		},
	};
	return { d, order, store };
}

describe("birthOpenclawCitizen", () => {
	it("declaration → probe → upsert, with the card's native id", async () => {
		const h = deps();
		const r = await birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, h.d);
		expect(r).toEqual({
			action: "create",
			gardenId: "20261113T150000-0a0a0a",
			nativeSessionId: "openclaw:lab:agent:main:s1m1",
			cwd: "/lab/ws",
		});
		expect(h.order).toEqual([
			"decl",
			"probe openclaw:lab:agent:main:s1m1",
			"upsert openclaw:lab:agent:main:s1m1 /lab/ws",
		]);
	});

	it("re-birth attaches to the same garden id", async () => {
		const h = deps();
		const a = await birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, h.d);
		const b = await birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, h.d);
		expect(b).toMatchObject({ action: "attach", gardenId: a.gardenId });
		expect(h.store.size).toBe(1);
	});

	it("a fresh-prefix key is admitted", async () => {
		const h = deps();
		await expect(
			birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:entwurf-n1", cwd: "/lab/ws" }, h.d),
		).resolves.toMatchObject({ nativeSessionId: "openclaw:lab:agent:main:entwurf-n1" });
	});

	it.each([
		["relative cwd", { scope: "lab", sessionKey: "agent:main:s1m1", cwd: "ws" }, /--cwd must be/],
		["unnormalized cwd", { scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/../ws" }, /--cwd must be/],
		["bad key", { scope: "lab", sessionKey: "main:s1m1", cwd: "/w" }, /must start with/],
		["bad scope", { scope: "Lab", sessionKey: "agent:main:s1m1", cwd: "/w" }, /scope/],
		["undeclared scope", { scope: "oracle", sessionKey: "agent:main:s1m1", cwd: "/w" }, /openclaw-scope-not-declared/],
		["undeclared key", { scope: "lab", sessionKey: "agent:main:main", cwd: "/w" }, /openclaw-scope-not-declared/],
	])("refuses %s and writes nothing", async (_n, input, pattern) => {
		const h = deps();
		await expect(birthOpenclawCitizen(input, h.d)).rejects.toThrow(pattern);
		expect(h.store.size).toBe(0);
		expect(h.order.some((o) => o.startsWith("probe") || o.startsWith("upsert"))).toBe(false);
	});

	it("refuses when no declaration exists", async () => {
		const h = deps();
		h.d.readDeclaration = () => null;
		await expect(birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/w" }, h.d)).rejects.toThrow(
			/openclaw-scope-not-declared/,
		);
	});

	it.each(["dead", "indeterminate"] as const)("a %s probe refuses before the write", async (status) => {
		const h = deps(status);
		await expect(birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/w" }, h.d)).rejects.toThrow(
			/does not confirm/,
		);
		expect(h.store.size).toBe(0);
	});
});
