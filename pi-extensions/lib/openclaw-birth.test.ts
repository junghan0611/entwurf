/**
 * #160 S3 step 3: the OpenClaw birth writer's order and refusals, proven beside the module.
 * The store write is an injected recorder (the real `upsertMetaSession` with backend `openclaw` is
 * the flip cell); the probe is a stand-in for the receive adapter's describe probe.
 */
import { describe, expect, it } from "vitest";
import { birthOpenclawCitizen, type OpenclawBirthDeps } from "./openclaw-birth.ts";
import { type OpenclawHomeRecord, parseOpenclawCitizensDeclaration } from "./openclaw-citizens.ts";

const DECL = parseOpenclawCitizensDeclaration(
	JSON.stringify({
		version: 1,
		gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
		allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:s1m1" }],
	}),
);

/** The declaration after the operator moved the home's mailbox from s1m1 to s2: s1m1 left it. */
const MOVED = parseOpenclawCitizensDeclaration(
	JSON.stringify({
		version: 1,
		gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
		allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:s2" }],
	}),
);

function deps(
	status: "alive" | "dead" | "indeterminate" = "alive",
	opts: { decl?: typeof DECL; existing?: OpenclawHomeRecord[]; deskPin?: "pinned" | "unpinned" | "unknown" } = {},
) {
	const store = new Map<string, string>();
	const order: string[] = [];
	const d: OpenclawBirthDeps = {
		readDeclaration: () => {
			order.push("decl");
			return opts.decl ?? DECL;
		},
		listIdentities: () => {
			order.push("list");
			return [
				...(opts.existing ?? []),
				...[...store].map(([nativeSessionId, gardenId]) => ({ gardenId, backend: "openclaw", nativeSessionId })),
			];
		},
		probe: async (id) => {
			order.push(`probe ${id}`);
			if (status !== "alive") return { status, reason: "r" };
			// A pinned desk unless the cell says otherwise.
			return { status, deskPin: opts.deskPin ?? "pinned" };
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
			"list",
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

	it("[QK:OPENCLAW-BIRTH-HOME-GATE] a home already addressed on another key — even one that left the declaration — is refused before the probe and the write", async () => {
		const old: OpenclawHomeRecord = {
			gardenId: "20261113T164129-222657",
			backend: "openclaw",
			nativeSessionId: "openclaw:lab:agent:main:s1m1",
		};
		const h = deps("alive", { decl: MOVED, existing: [old] });
		await expect(
			birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s2", cwd: "/lab/ws" }, h.d),
		).rejects.toThrow(/openclaw-home-already-addressed: .*20261113T164129-222657.*no record written/);
		expect(h.order).toEqual(["decl", "list"]);
		expect(h.store.size).toBe(0);
		// An ambiguous home refuses even the key one of its records carries.
		const twice = deps("alive", {
			existing: [old, { ...old, gardenId: "20261113T170000-0b0b0b", nativeSessionId: "openclaw:lab:agent:main:s9" }],
		});
		await expect(
			birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, twice.d),
		).rejects.toThrow(/openclaw-home-ambiguous/);
		expect(twice.store.size).toBe(0);
	});

	it("[QK:OPENCLAW-BIRTH-REQUIRES-PIN] an alive desk judged unpinned is refused as openclaw-desk-not-pinned, an unreadable pin as openclaw-desk-pin-indeterminate, and nothing is written", async () => {
		const h = deps("alive", { deskPin: "unpinned" });
		await expect(
			birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, h.d),
		).rejects.toThrow(/openclaw-desk-not-pinned: agent:main:s1m1 .*no record written/);
		expect(h.order).toEqual(["decl", "list", "probe openclaw:lab:agent:main:s1m1"]);
		expect(h.store.size).toBe(0);
		const u = deps("alive", { deskPin: "unknown" });
		await expect(
			birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, u.d),
		).rejects.toThrow(/openclaw-desk-pin-indeterminate: .*no record written/);
		expect(u.store.size).toBe(0);
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
