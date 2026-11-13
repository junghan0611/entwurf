/**
 * #160 S3 step 5: the OpenClaw native-push adapter, proven beside the module with a recording
 * runner. No OpenClaw process, no Gateway, no network. The vendor answers fed to the runner are
 * the literal shapes measured in the 11.3 lab (receipts named per cell); a LIVE probe/send is S4.
 */
import { describe, expect, it } from "vitest";
import { parseOpenclawCitizensDeclaration } from "../openclaw-citizens.ts";
import type { NativePushExecResult, NativePushRunner } from "./adapter.ts";
import {
	createOpenclawGatewayAdapter,
	OPENCLAW_PROBE_TIMEOUT_MS,
	OPENCLAW_SEND_TIMEOUT_MS,
	type OpenclawRoute,
} from "./openclaw-gateway.ts";

const ID = "openclaw:lab:agent:main:s1m1";
const DECL = parseOpenclawCitizensDeclaration(
	JSON.stringify({
		version: 1,
		gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811", configPath: "/lab/state/openclaw.json" }],
		allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:s1m1" }],
	}),
);
const ROUTE: OpenclawRoute = {
	backend: "openclaw",
	url: "ws://127.0.0.1:18811",
	configPath: "/lab/state/openclaw.json",
	sessionKey: "agent:main:s1m1",
};

type Call = { argv: readonly string[]; opts?: { env?: Record<string, string>; timeoutMs?: number } };

function runner(answer: NativePushExecResult): NativePushRunner & { calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		async exec(argv, opts) {
			calls.push({ argv, opts });
			return answer;
		},
	};
}

function adapter(
	r: NativePushRunner,
	decl: () => ReturnType<typeof parseOpenclawCitizensDeclaration> | null = () => DECL,
) {
	return createOpenclawGatewayAdapter({ runner: r, readDeclaration: decl, newIdempotencyKey: () => "entwurf-k1" });
}

const ALIVE = JSON.stringify({ session: { key: "agent:main:s1m1", sessionId: "2de2", hasActiveRun: false } });

describe("probe", () => {
	it("runs sessions.describe with --expect-url, the declared config for that call only, no token", async () => {
		const r = runner({ code: 0, stdout: ALIVE, stderr: "" });
		expect(await adapter(r).probe(ID)).toEqual({ status: "alive", route: ROUTE });
		expect(r.calls).toEqual([
			{
				argv: [
					"openclaw",
					"gateway",
					"call",
					"sessions.describe",
					"--json",
					"--expect-url",
					"ws://127.0.0.1:18811",
					"--params",
					'{"key":"agent:main:s1m1"}',
				],
				opts: { env: { OPENCLAW_CONFIG_PATH: "/lab/state/openclaw.json" }, timeoutMs: OPENCLAW_PROBE_TIMEOUT_MS },
			},
		]);
		expect(r.calls[0].argv.join(" ")).not.toMatch(/--token|token=/);
	});

	it("hasActiveRun does not change the verdict", async () => {
		const busy = JSON.stringify({ session: { key: "agent:main:s1m1", hasActiveRun: true } });
		expect((await adapter(runner({ code: 0, stdout: busy, stderr: "" })).probe(ID)).status).toBe("alive");
	});

	it('{"session":null} is dead (R/s3-probe-shape.txt)', async () => {
		const r = runner({ code: 0, stdout: '{\n  "session": null\n}\n', stderr: "" });
		expect(await adapter(r).probe(ID)).toMatchObject({ status: "dead" });
	});

	it.each([
		[
			"expect-url mismatch exit 1",
			{ code: 1, stdout: '{"ok":false,"error":{"message":"Gateway destination changed."}}', stderr: "" },
		],
		["timeout 124", { code: 124, stdout: "", stderr: "" }],
		["missing binary 127", { code: 127, stdout: "", stderr: "ENOENT" }],
		["not JSON", { code: 0, stdout: "hello", stderr: "" }],
		["no session member", { code: 0, stdout: "{}", stderr: "" }],
		["another key", { code: 0, stdout: JSON.stringify({ session: { key: "agent:main:main" } }), stderr: "" }],
	])("%s is indeterminate, never dead", async (_n, answer) => {
		expect((await adapter(runner(answer)).probe(ID)).status).toBe("indeterminate");
	});

	it.each([
		["absent declaration", () => null],
		[
			"key left the declaration",
			() =>
				parseOpenclawCitizensDeclaration(
					JSON.stringify({
						version: 1,
						gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
						allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:other" }],
					}),
				),
		],
	])("%s: indeterminate naming the scope, and no vendor call", async (_n, decl) => {
		const r = runner({ code: 0, stdout: ALIVE, stderr: "" });
		const res = await adapter(r, decl).probe(ID);
		expect(res.status).toBe("indeterminate");
		expect(r.calls).toEqual([]);
	});

	it("a broken declaration throws by name (Rule 15), with no vendor call", async () => {
		const r = runner({ code: 0, stdout: ALIVE, stderr: "" });
		await expect(
			adapter(r, () => {
				throw new Error("openclaw-citizens.json: bad");
			}).probe(ID),
		).rejects.toThrow(/openclaw-citizens.json: bad/);
		expect(r.calls).toEqual([]);
	});

	it("a malformed record native id is indeterminate with no vendor call", async () => {
		const r = runner({ code: 0, stdout: ALIVE, stderr: "" });
		expect((await adapter(r).probe("2de2-not-openclaw")).status).toBe("indeterminate");
		expect(r.calls).toEqual([]);
	});

	it("no configPath declared → no env overlay", async () => {
		const plain = parseOpenclawCitizensDeclaration(
			JSON.stringify({
				version: 1,
				gateways: [{ scope: "lab", url: "ws://127.0.0.1:18811" }],
				allow: [{ scope: "lab", agentId: "main", sessionKey: "agent:main:s1m1" }],
			}),
		);
		const r = runner({ code: 0, stdout: ALIVE, stderr: "" });
		await adapter(r, () => plain).probe(ID);
		expect(r.calls[0].opts?.env).toBeUndefined();
	});
});

describe("send", () => {
	it("chat.send steer with an entwurf idempotency key; is not retriable", async () => {
		const r = runner({ code: 0, stdout: '{"runId":"entwurf-k1","status":"started","messageSeq":1}', stderr: "" });
		const a = adapter(r);
		expect(a.retriable).toBe(false);
		await a.send(ROUTE, ID, "[entwurf received ⟵]\nbody");
		expect(r.calls).toEqual([
			{
				argv: [
					"openclaw",
					"gateway",
					"call",
					"chat.send",
					"--json",
					"--expect-url",
					"ws://127.0.0.1:18811",
					"--params",
					JSON.stringify({
						sessionKey: "agent:main:s1m1",
						message: "[entwurf received ⟵]\nbody",
						idempotencyKey: "entwurf-k1",
						queueMode: "steer",
					}),
				],
				opts: { env: { OPENCLAW_CONFIG_PATH: "/lab/state/openclaw.json" }, timeoutMs: OPENCLAW_SEND_TIMEOUT_MS },
			},
		]);
	});

	it.each([
		["busy steer ack (no messageSeq)", '{"runId":"x","status":"started"}'],
		["dedupe ack", '{"status":"ok"}'],
	])("accepts %s", async (_n, stdout) => {
		await expect(adapter(runner({ code: 0, stdout, stderr: "" })).send(ROUTE, ID, "m")).resolves.toBeUndefined();
	});

	it.each([
		[
			"conflict exit 1",
			{ code: 1, stdout: '{"ok":false,"error":{"details":{"reason":"chat-request-conflict"}}}', stderr: "" },
		],
		["timeout", { code: 124, stdout: "", stderr: "" }],
		["exit 0 unknown status", { code: 0, stdout: '{"status":"queued"}', stderr: "" }],
		["exit 0 not JSON", { code: 0, stdout: "ok", stderr: "" }],
	])("throws on %s", async (_n, answer) => {
		await expect(adapter(runner(answer)).send(ROUTE, ID, "m")).rejects.toThrow(/native-push send failed/);
	});

	it("refuses a route that is not this record's key, before any vendor call", async () => {
		const r = runner({ code: 0, stdout: '{"status":"ok"}', stderr: "" });
		await expect(adapter(r).send({ ...ROUTE, sessionKey: "agent:main:main" }, ID, "m")).rejects.toThrow(/route key/);
		expect(r.calls).toEqual([]);
	});
});
