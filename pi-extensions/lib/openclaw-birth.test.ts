/**
 * #160 S3 step 3: the OpenClaw birth writer's order and refusals, proven beside the module.
 * The store write is an injected recorder (the real `upsertMetaSession` with backend `openclaw` is
 * the flip cell); the probe is a stand-in for the receive adapter's describe probe.
 */
import { describe, expect, it } from "vitest";
import { createOpenclawGatewayAdapter } from "./native-push/openclaw-gateway.ts";
import { birthOpenclawCitizen, type OpenclawBirthDeps } from "./openclaw-birth.ts";
import { type OpenclawHomeRecord, parseOpenclawCitizensDeclaration } from "./openclaw-citizens.ts";
import { parseOpenclawClaim, receiveOpenclawClaim } from "./openclaw-send.ts";

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

	it("a malformed openclaw record in the store refuses birth before the probe and the write", async () => {
		const h = deps("alive", {
			existing: [
				{ gardenId: "20261115T000000-aabbcc", backend: "openclaw", nativeSessionId: "openclaw:lab:agent:main:" },
			],
		});
		await expect(
			birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, h.d),
		).rejects.toThrow(/openclaw-home-record-malformed: .*20261115T000000-aabbcc.*no record written/);
		expect(h.order).toEqual(["decl", "list"]);
		expect(h.store.size).toBe(0);
	});

	it("[QK:OPENCLAW-BIRTH-REQUIRES-PIN] an alive desk judged unpinned is refused as openclaw-desk-not-pinned and nothing is written", async () => {
		const h = deps("alive", { deskPin: "unpinned" });
		await expect(
			birthOpenclawCitizen({ scope: "lab", sessionKey: "agent:main:s1m1", cwd: "/lab/ws" }, h.d),
		).rejects.toThrow(/openclaw-desk-not-pinned: agent:main:s1m1 .*no record written/);
		expect(h.order).toEqual(["decl", "list", "probe openclaw:lab:agent:main:s1m1"]);
		expect(h.store.size).toBe(0);
	});

	it("[QK:OPENCLAW-BIRTH-REFUSES-UNKNOWN-PIN] an alive desk whose pin cannot be read is refused as openclaw-desk-pin-indeterminate, never guessed, and nothing is written", async () => {
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

/**
 * #160 S6.5 (GLG: "compact, reset 뒤 유지는 코드 레벨에서는 괜찮다는 것 정도는 검수가 되어야"):
 * Entwurf's side of compact/reset, closed deterministically. The vendor's session generation
 * (sessionId, lifecycleRevision) changes under one fixed key; the address must not. Fixture shape is
 * the lab's sessions.describe (s6-lab-m1-m5.md: key agent:main:s6pin-ca8f49, pinned with a numeric
 * pinnedAt). The relayed ids were truncated (68d6622e-…, d14a339d-…), so only their leading groups
 * are the lab's and the rest is synthetic.
 */
describe("a vendor generation change under one key keeps the garden", () => {
	const KEY_LAB = "agent:main:s6pin-ca8f49";
	const LAB = parseOpenclawCitizensDeclaration(
		JSON.stringify({
			version: 1,
			gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
			allow: [{ scope: "lab", agentId: "main", sessionKey: KEY_LAB }],
		}),
	);
	const describeAt = (sessionId: string, lifecycleRevision: string) =>
		JSON.stringify({ session: { key: KEY_LAB, sessionId, lifecycleRevision, pinned: true, pinnedAt: 1794707048719 } });
	const BEFORE = describeAt("68d6622e-0000-4000-8000-000000000001", "d14a339d-0000-4000-8000-000000000001");
	const AFTER = describeAt("68d6622e-0000-4000-8000-0000000000aa", "d14a339d-0000-4000-8000-0000000000bb");

	it("[QK:OPENCLAW-RESET-KEEPS-GARDEN] after the vendor's sessionId and lifecycleRevision change, probe gives the same route, birth re-attaches the same garden and the send entry joins that garden", async () => {
		let answer = BEFORE;
		const store = new Map<string, string>();
		const records = (): OpenclawHomeRecord[] =>
			[...store].map(([nativeSessionId, gardenId]) => ({ gardenId, backend: "openclaw", nativeSessionId }));
		const adapter = createOpenclawGatewayAdapter({
			runner: { exec: async () => ({ code: 0, stdout: answer, stderr: "" }) },
			readDeclaration: () => LAB,
			listIdentities: records,
		});
		const birthDeps: OpenclawBirthDeps = {
			readDeclaration: () => LAB,
			listIdentities: records,
			probe: async (id) => {
				const p = await adapter.probe(id);
				return p.status === "alive"
					? { status: "alive", deskPin: p.route.backend === "openclaw" ? (p.route.deskPin ?? "unknown") : "unknown" }
					: p;
			},
			upsert: (id) => {
				const existing = store.get(id);
				if (existing) return { action: "attach", gardenId: existing };
				store.set(id, "20261115T040000-c0ffee");
				return { action: "create", gardenId: "20261115T040000-c0ffee" };
			},
		};
		const native = `openclaw:lab:${KEY_LAB}`;

		const born = await birthOpenclawCitizen({ scope: "lab", sessionKey: KEY_LAB, cwd: "/lab/ws" }, birthDeps);
		const routeBefore = await adapter.probe(native);

		answer = AFTER; // the vendor reset or compacted: a new generation under the same key
		const routeAfter = await adapter.probe(native);
		expect(routeAfter).toEqual(routeBefore);
		expect(routeAfter).toMatchObject({ status: "alive" });

		const again = await birthOpenclawCitizen({ scope: "lab", sessionKey: KEY_LAB, cwd: "/lab/ws" }, birthDeps);
		expect(again).toEqual({ ...born, action: "attach" });
		expect(store.size).toBe(1);

		const sent: string[] = [];
		const receipt = await receiveOpenclawClaim(
			parseOpenclawClaim(
				JSON.stringify({
					v: 1,
					scope: "lab",
					agentId: "main",
					sessionKey: KEY_LAB,
					target: "20261015T085719-9fc008",
					message: "after reset",
					wantsReply: true,
				}),
			),
			LAB,
			{
				listIdentities: () => records().map((r) => ({ ...r, cwd: "/lab/ws" })),
				replyable: async (r) => (await adapter.probe(r.nativeSessionId)).status === "alive",
				dispatch: async (_params, sender) => {
					sent.push(sender.sessionId);
					return { isError: false, text: "ok" };
				},
			},
		);
		expect(receipt).toMatchObject({ kind: "dispatched" });
		expect(sent).toEqual([born.gardenId]);
		// Contrast — another key on the same home is refused, not re-attached: that is
		// the OPENCLAW-BIRTH-HOME-GATE cell above (openclaw-home-already-addressed).
	});
});
