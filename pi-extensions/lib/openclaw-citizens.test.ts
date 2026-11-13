/**
 * #160 S3 step 2: the OpenClaw scope declaration, proven beside the module.
 *
 * Oracle: literal declarations and literal native ids written in this file, never the module's own
 * composer used as its own expectation. File cells run in a fresh temp dir; nothing touches the
 * operator store (Hard Rule 12).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	composeOpenclawNativeSessionId,
	OpenclawDeclarationError,
	openclawCitizensPath,
	parseOpenclawCitizensDeclaration,
	parseOpenclawNativeSessionId,
	readOpenclawCitizens,
	selectOpenclawScope,
} from "./openclaw-citizens.ts";

const GW = { scope: "lab-a", url: "ws://127.0.0.1:18811" };
const KEY = { scope: "lab-a", agentId: "main", sessionKey: "agent:main:s1m1" };
const PREFIX = { scope: "lab-a", agentId: "main", prefix: "agent:main:entwurf-" };

function decl(over: Record<string, unknown> = {}): string {
	return JSON.stringify({ version: 1, gateways: [GW], allow: [KEY], ...over });
}

describe("parseOpenclawCitizensDeclaration", () => {
	it("accepts the card's shape, with and without the optional parts", () => {
		expect(parseOpenclawCitizensDeclaration(decl())).toEqual({ gateways: [GW], allow: [KEY] });
		const full = parseOpenclawCitizensDeclaration(
			decl({ gateways: [{ ...GW, configPath: "/srv/oc/openclaw.json" }], freshKeyPrefix: PREFIX }),
		);
		expect(full.gateways[0].configPath).toBe("/srv/oc/openclaw.json");
		expect(full.freshKeyPrefix).toEqual(PREFIX);
		// Prefix only, no fixed key.
		expect(parseOpenclawCitizensDeclaration(decl({ allow: [], freshKeyPrefix: PREFIX })).allow).toEqual([]);
	});

	it("carries no garden id: a gardenId key anywhere is refused", () => {
		expect(() => parseOpenclawCitizensDeclaration(decl({ gardenId: "20261113T145250-0c9e3a" }))).toThrow(
			OpenclawDeclarationError,
		);
		expect(() =>
			parseOpenclawCitizensDeclaration(decl({ allow: [{ ...KEY, gardenId: "20261113T145250-0c9e3a" }] })),
		).toThrow(/keys must be/);
	});

	it.each([
		["not JSON", "{", /not JSON/],
		["wrong version", decl({ version: 2 }), /"version" must be 1/],
		["no gateways", decl({ gateways: [] }), /"gateways" must be a non-empty array/],
		["nothing declared", decl({ allow: [] }), /declares no key/],
		["scope with colon", decl({ gateways: [{ ...GW, scope: "a:b" }] }), /scope: must match/],
		["uppercase scope", decl({ gateways: [{ ...GW, scope: "Lab" }] }), /scope: must match/],
		["http url", decl({ gateways: [{ ...GW, url: "http://127.0.0.1:18811" }] }), /must be ws: or wss:/],
		["userinfo url", decl({ gateways: [{ ...GW, url: "ws://u:p@127.0.0.1:1" }] }), /userinfo/],
		["token in query", decl({ gateways: [{ ...GW, url: "ws://127.0.0.1:1/?token=x" }] }), /query or fragment/],
		["relative configPath", decl({ gateways: [{ ...GW, configPath: "oc.json" }] }), /absolute, normalized/],
		["unnormalized configPath", decl({ gateways: [{ ...GW, configPath: "/a/../b" }] }), /absolute, normalized/],
		["key of another agent", decl({ allow: [{ ...KEY, sessionKey: "agent:ops:s1" }] }), /must start with/],
		["bare agent head", decl({ allow: [{ ...KEY, sessionKey: "agent:main:" }] }), /must start with/],
		["whitespace in key", decl({ allow: [{ ...KEY, sessionKey: "agent:main:a b" }] }), /whitespace/],
		["control in key", decl({ allow: [{ ...KEY, sessionKey: "agent:main:a\nb" }] }), /control/],
		["undeclared allow scope", decl({ allow: [{ ...KEY, scope: "oracle" }] }), /names no declared gateway/],
		["duplicate key", decl({ allow: [KEY, KEY] }), /duplicate key/],
		["duplicate scope", decl({ gateways: [GW, { ...GW, url: "ws://127.0.0.1:2" }] }), /duplicate scope/],
		["one url two scopes", decl({ gateways: [GW, { ...GW, scope: "other" }] }), /declared under another scope/],
		["agent-wide prefix", decl({ freshKeyPrefix: { ...PREFIX, prefix: "agent:main:" } }), /must start with/],
		[
			"allow inside prefix",
			decl({ allow: [{ ...KEY, sessionKey: "agent:main:entwurf-x" }], freshKeyPrefix: PREFIX }),
			/must be disjoint/,
		],
		["undeclared prefix scope", decl({ freshKeyPrefix: { ...PREFIX, scope: "oracle" } }), /names no declared/],
		["stray top key", decl({ extra: 1 }), /keys must be/],
	])("refuses %s by name", (_name, text, pattern) => {
		expect(() => parseOpenclawCitizensDeclaration(text)).toThrow(pattern);
	});
});

describe("readOpenclawCitizens", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-citizens-"));
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("absent is off; a regular valid file is read", () => {
		const f = path.join(dir, "openclaw-citizens.json");
		expect(readOpenclawCitizens(f)).toBeNull();
		fs.writeFileSync(f, decl());
		expect(readOpenclawCitizens(f)?.allow).toEqual([KEY]);
	});

	it("is re-read on every call (no cache)", () => {
		const f = path.join(dir, "openclaw-citizens.json");
		fs.writeFileSync(f, decl());
		expect(readOpenclawCitizens(f)?.freshKeyPrefix).toBeUndefined();
		fs.writeFileSync(f, decl({ freshKeyPrefix: PREFIX }));
		expect(readOpenclawCitizens(f)?.freshKeyPrefix).toEqual(PREFIX);
	});

	it("refuses a symlink, a directory and an invalid file, naming the path", () => {
		const real = path.join(dir, "real.json");
		fs.writeFileSync(real, decl());
		const link = path.join(dir, "link.json");
		fs.symlinkSync(real, link);
		expect(() => readOpenclawCitizens(link)).toThrow(/must be a regular non-symlink file/);
		const sub = path.join(dir, "sub");
		fs.mkdirSync(sub);
		expect(() => readOpenclawCitizens(sub)).toThrow(/must be a regular non-symlink file/);
		const bad = path.join(dir, "bad.json");
		fs.writeFileSync(bad, decl({ version: 9 }));
		expect(() => readOpenclawCitizens(bad)).toThrow(new RegExp(`${bad}: .*"version" must be 1`));
	});

	it("lives beside the record store", () => {
		const prev = process.env.ENTWURF_META_SESSIONS_DIR;
		process.env.ENTWURF_META_SESSIONS_DIR = path.join(dir, "meta-sessions");
		try {
			expect(openclawCitizensPath()).toBe(path.join(dir, "openclaw-citizens.json"));
		} finally {
			if (prev === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
			else process.env.ENTWURF_META_SESSIONS_DIR = prev;
		}
	});
});

describe("selectOpenclawScope", () => {
	const d = parseOpenclawCitizensDeclaration(decl({ freshKeyPrefix: PREFIX }));

	it("admits a fixed key and a fresh-prefix key, each with its reason", () => {
		expect(selectOpenclawScope(d, "lab-a", "main", "agent:main:s1m1")).toEqual({ gateway: GW, via: "allow" });
		expect(selectOpenclawScope(d, "lab-a", "main", "agent:main:entwurf-n1")).toEqual({
			gateway: GW,
			via: "fresh-prefix",
		});
	});

	it.each([
		["undeclared scope", "oracle", "main", "agent:main:s1m1"],
		["undeclared key", "lab-a", "main", "agent:main:main"],
		["agent mismatch on fixed key", "lab-a", "ops", "agent:main:s1m1"],
		["agent mismatch on prefix", "lab-a", "ops", "agent:main:entwurf-n1"],
	])("refuses %s as openclaw-scope-not-declared", (_n, scope, agentId, key) => {
		expect(selectOpenclawScope(d, scope, agentId, key)).toMatchObject({ reason: "openclaw-scope-not-declared" });
	});
});

describe("native id", () => {
	it("composes the card's literal and parses it back", () => {
		expect(composeOpenclawNativeSessionId("lab-a", "main", "agent:main:s1m1")).toBe("openclaw:lab-a:agent:main:s1m1");
		expect(parseOpenclawNativeSessionId("openclaw:lab-a:agent:main:s1m1")).toEqual(KEY);
	});

	it.each([
		"agent:main:s1m1",
		"openclaw:",
		"openclaw:lab",
		"openclaw:Lab:agent:main:s1",
		"openclaw:lab:agent:main:",
		"openclaw:lab:main:s1",
		"openclaw:lab:agent:main:a b",
	])("refuses %j", (id) => {
		expect(() => parseOpenclawNativeSessionId(id)).toThrow(OpenclawDeclarationError);
	});

	it("refuses to compose what it would not parse", () => {
		expect(() => composeOpenclawNativeSessionId("a:b", "main", "agent:main:s1")).toThrow();
		expect(() => composeOpenclawNativeSessionId("lab", "main", "agent:ops:s1")).toThrow();
	});
});
