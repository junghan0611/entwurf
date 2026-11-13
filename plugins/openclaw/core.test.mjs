/**
 * entwurf #160 S3 step 6: the OpenClaw plugin's send core, hermetic.
 *
 * Two halves. (1) A recording `run` proves the claim, the commit point and the classification
 * table. (2) A real child process — a fake entry script written into a temp dir — proves the
 * stdin/stdout/exit wiring through node's own spawn, standing in for OpenClaw's
 * `runCommandWithTimeout`. No OpenClaw, no entwurf store, no Gateway.
 *
 * The claim is read back with the ENTRY's own parser (`parseOpenclawClaim`), so the wire shape is
 * checked by the other side's code.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { OPENCLAW_SEND_ENTRY_WORST_MS } from "../../pi-extensions/lib/native-push/openclaw-gateway.ts";
import { parseOpenclawClaim } from "../../pi-extensions/lib/openclaw-send.ts";
import { buildClaim, classifyEntryResult, executeSend, parsePluginConfig, SEND_TIMEOUT_MS } from "./dist/core.js";

const CONFIG = {
	entwurfBin: "/opt/entwurf/bin/entwurf",
	declPath: "/home/op/.pi/agent/openclaw-citizens.json",
	scope: "lab",
};
const TARGET = "20261015T085719-9fc008";

function ctx(over = {}) {
	const calls = [];
	return {
		calls,
		agentId: "main",
		sessionKey: "agent:main:s1m1",
		sessionId: "2de2",
		assertInvocationCurrent() {
			calls.push("assert");
		},
		...over,
	};
}

describe("timeout (review D2)", () => {
	it("the plugin waits longer than the entry's worst path, so a slow-but-live entry is not indeterminate", () => {
		expect(OPENCLAW_SEND_ENTRY_WORST_MS).toBe(75_000);
		expect(SEND_TIMEOUT_MS).toBeGreaterThan(OPENCLAW_SEND_ENTRY_WORST_MS);
	});
});

describe("parsePluginConfig", () => {
	it("accepts exactly the three absolute/label values", () => {
		expect(parsePluginConfig(CONFIG)).toEqual(CONFIG);
	});
	it.each([
		["missing", { entwurfBin: CONFIG.entwurfBin, scope: "lab" }],
		["extra", { ...CONFIG, token: "x" }],
		["relative bin", { ...CONFIG, entwurfBin: "entwurf" }],
		["relative decl", { ...CONFIG, declPath: "openclaw-citizens.json" }],
		["bad scope", { ...CONFIG, scope: "a:b" }],
		["null", null],
	])("refuses %s", (_n, raw) => {
		expect(() => parsePluginConfig(raw)).toThrow(/entwurf plugin/);
	});
});

describe("buildClaim", () => {
	it("takes identity from ctx and scope from config; the entry's parser reads it back", () => {
		const text = buildClaim(CONFIG, ctx(), { target: TARGET, message: "hi" });
		expect(JSON.parse(text)).toEqual({
			v: 1,
			scope: "lab",
			agentId: "main",
			sessionKey: "agent:main:s1m1",
			target: TARGET,
			message: "hi",
			wantsReply: false,
		});
		expect(parseOpenclawClaim(text)).toMatchObject({ sessionKey: "agent:main:s1m1", wantsReply: false });
		expect(JSON.parse(buildClaim(CONFIG, ctx(), { target: TARGET, message: "hi", wants_reply: true })).wantsReply).toBe(
			true,
		);
	});
	it.each([
		["identity smuggled as an argument", { target: TARGET, message: "m", sessionKey: "agent:main:main" }],
		["bad target", { target: "x", message: "m" }],
		["empty message", { target: TARGET, message: "" }],
		["oversize message", { target: TARGET, message: "x".repeat(16001) }],
		["non-boolean wants_reply", { target: TARGET, message: "m", wants_reply: "yes" }],
	])("refuses %s", (_n, params) => {
		expect(() => buildClaim(CONFIG, ctx(), params)).toThrow(/entwurf_v2/);
	});
	it("refuses a ctx without identity", () => {
		expect(() => buildClaim(CONFIG, ctx({ sessionKey: undefined }), { target: TARGET, message: "m" })).toThrow(
			/unattributed/,
		);
	});
});

describe("executeSend — commit point", () => {
	it("asserts once, after validation, then runs the fixed argv with the claim on stdin", async () => {
		const c = ctx();
		const runs = [];
		const run = async (argv, opts) => {
			c.calls.push("run");
			runs.push({ argv, opts });
			return {
				code: 0,
				stdout: `${JSON.stringify({ kind: "dispatched", isError: false, text: "OK-RECEIPT" })}\n`,
				stderr: "",
			};
		};
		const res = await executeSend(CONFIG, c, { target: TARGET, message: "hi" }, run);
		expect(c.calls).toEqual(["assert", "run"]);
		expect(runs[0].argv).toEqual([CONFIG.entwurfBin, "openclaw-send", "--decl", CONFIG.declPath]);
		expect(parseOpenclawClaim(runs[0].opts.input).target).toBe(TARGET);
		expect(res.content[0].text).toBe("OK-RECEIPT");
	});

	it("a stale ctx refuses at the commit point and starts nothing", async () => {
		const c = ctx({
			assertInvocationCurrent() {
				throw new Error("refused: agent tool caller authority is no longer active");
			},
		});
		let ran = false;
		await expect(
			executeSend(CONFIG, c, { target: TARGET, message: "hi" }, async () => {
				ran = true;
			}),
		).rejects.toThrow(/no longer active/);
		expect(ran).toBe(false);
	});

	it("bad arguments refuse before the commit point", async () => {
		const c = ctx();
		await expect(executeSend(CONFIG, c, { target: "x", message: "hi" }, async () => {})).rejects.toThrow();
		expect(c.calls).toEqual([]);
	});

	it("a ctx with no assertInvocationCurrent refuses", async () => {
		const c = ctx({ assertInvocationCurrent: undefined });
		await expect(executeSend(CONFIG, c, { target: TARGET, message: "hi" }, async () => {})).rejects.toThrow(
			/assertInvocationCurrent/,
		);
	});
});

const line = (o) => `${JSON.stringify(o)}\n`;

describe("classifyEntryResult", () => {
	it.each([
		[0, line({ kind: "dispatched", isError: false, text: "t" }), { outcome: "dispatched", text: "t" }],
		[4, line({ kind: "dispatched", isError: true, text: "t" }), { outcome: "dispatch-reported-error", text: "t" }],
		[
			3,
			line({ kind: "rejected", reason: "openclaw-sender-not-citizen", detail: "d" }),
			{ outcome: "rejected", reason: "openclaw-sender-not-citizen", detail: "d" },
		],
		[2, line({ kind: "invalid", detail: "d" }), { outcome: "invalid", detail: "d" }],
	])("exit %i agreeing with its receipt", (code, stdout, want) => {
		expect(classifyEntryResult({ code, stdout, stderr: "" })).toEqual(want);
	});

	it.each([
		["1 crash", { code: 1, stdout: "", stderr: "boom" }],
		["124 timeout", { code: 124, stdout: "", stderr: "" }],
		["signal", { code: null, stdout: "", stderr: "" }],
		["5 unknown", { code: 5, stdout: line({ kind: "dispatched", isError: false, text: "t" }), stderr: "" }],
		["0 but rejected", { code: 0, stdout: line({ kind: "rejected", reason: "r" }), stderr: "" }],
		["0 but isError", { code: 0, stdout: line({ kind: "dispatched", isError: true, text: "t" }), stderr: "" }],
		["4 but clean", { code: 4, stdout: line({ kind: "dispatched", isError: false, text: "t" }), stderr: "" }],
		["two lines", { code: 0, stdout: line({ kind: "dispatched", isError: false, text: "t" }).repeat(2), stderr: "" }],
		["no line", { code: 3, stdout: "", stderr: "" }],
		["not JSON", { code: 2, stdout: "usage\n", stderr: "" }],
	])("%s is indeterminate", (_n, r) => {
		expect(classifyEntryResult(r).outcome).toBe("indeterminate");
	});
});

describe("a real child process as the entry", () => {
	it("stdin claim → stdout receipt → exit code, through node spawn", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-plugin-"));
		try {
			const entry = path.join(dir, "fake-entry.mjs");
			// Echo the claim's target back, exit 3 for an undeclared scope, else 0.
			fs.writeFileSync(
				entry,
				`import { readFileSync } from "node:fs";
const c = JSON.parse(readFileSync(0, "utf8"));
if (process.argv[2] !== "openclaw-send" || process.argv[3] !== "--decl") process.exit(2);
if (c.scope !== "lab") { process.stdout.write(JSON.stringify({kind:"rejected",reason:"openclaw-scope-not-declared",detail:c.scope})+"\\n"); process.exit(3); }
process.stdout.write(JSON.stringify({kind:"dispatched",isError:false,text:"to "+c.target})+"\\n");`,
			);
			const run = (argv, opts) => {
				const r = spawnSync(process.execPath, [entry, ...argv.slice(1)], { input: opts.input, encoding: "utf8" });
				return { code: r.status, stdout: r.stdout, stderr: r.stderr };
			};
			const claimOk = buildClaim(CONFIG, ctx(), { target: TARGET, message: "hi" });
			expect(
				classifyEntryResult(run([CONFIG.entwurfBin, "openclaw-send", "--decl", CONFIG.declPath], { input: claimOk })),
			).toEqual({
				outcome: "dispatched",
				text: `to ${TARGET}`,
			});
			const claimOff = buildClaim({ ...CONFIG, scope: "oracle" }, ctx(), { target: TARGET, message: "hi" });
			expect(
				classifyEntryResult(run([CONFIG.entwurfBin, "openclaw-send", "--decl", CONFIG.declPath], { input: claimOff })),
			).toMatchObject({ outcome: "rejected", reason: "openclaw-scope-not-declared" });
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
