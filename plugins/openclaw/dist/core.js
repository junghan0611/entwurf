/**
 * entwurf OpenClaw plugin — the send tool's core (entwurf #160 S2 card §3, §6).
 *
 * Hand-written canonical source: `dist/` is the path the manifest names, not a build output. There
 * is no compile step; edit these files directly (review O8).
 *
 * No OpenClaw SDK import and no entwurf import: this file only turns one tool call into one claim,
 * runs the operator-configured `entwurf openclaw-send --decl <abs>` entry once with the claim on
 * stdin, and classifies what came back. `index.js` registers it with OpenClaw.
 *
 * Identity: the claim's (agentId, sessionKey) come from the tool ctx OpenClaw fills for THIS
 * session ([측정] S1 M1), and `scope` from the operator's plugin config. The model chooses only
 * target, message and wants_reply. The entry, not this plugin, decides whether that key is a
 * citizen: it checks the declaration and joins the V3 record. The plugin writes no record.
 *
 * Commit point: `ctx.assertInvocationCurrent()` is called ONCE, after the arguments are validated
 * and the claim is serialized, immediately before the process is started. A run that has ended or
 * a session that was reset refuses there ([측정] S1 `R/m1-stale-ctx.retry1.txt`) and nothing is
 * started. Once started it cannot be taken back, so there is no second call.
 *
 * Receipt: decided only when the exit code and the one stdout JSON line agree (remote-pair rule).
 * 0 dispatched, 4 dispatched with a reported error, 3 scope/record refusal, 2 invalid. Anything
 * else — 1, 124 (timeout), null, more or fewer lines, a kind that disagrees with the code — is
 * `indeterminate`: the entry may or may not have dispatched. No retry.
 */

import * as path from "node:path";

export const TOOL_NAME = "entwurf_v2";
export const CLAIM_VERSION = 1;
export const MESSAGE_CAP = 16000;
/** Exceeds the entry's worst path (`OPENCLAW_SEND_ENTRY_WORST_MS`, 75s); the beside test binds them. */
export const SEND_TIMEOUT_MS = 90_000;
const GARDEN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;

export const TOOL_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["target", "message"],
	properties: {
		target: { type: "string", description: "Garden id of an existing sibling (YYYYMMDDTHHMMSS-xxxxxx)." },
		message: { type: "string", description: `Message to the sibling, at most ${MESSAGE_CAP} characters.` },
		wants_reply: { type: "boolean", description: "Ask for a later reply. The receipt is not that reply." },
	},
};

export const TOOL_DESCRIPTION =
	"Send a message to an existing garden sibling by garden id, as this session's own garden citizen. " +
	"Returns a delivery receipt, not the sibling's answer. Fails if this session is not a declared, born citizen.";

/** Validate the operator's plugin config once at registration. Throws on anything else. */
export function parsePluginConfig(raw) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("entwurf plugin: config must be an object {entwurfBin, declPath, scope}");
	}
	const keys = Object.keys(raw).sort();
	if (keys.join(",") !== "declPath,entwurfBin,scope") {
		throw new Error(`entwurf plugin: config keys must be exactly entwurfBin, declPath, scope (got ${keys.join(", ")})`);
	}
	for (const k of ["entwurfBin", "declPath"]) {
		const v = raw[k];
		if (typeof v !== "string" || !path.isAbsolute(v) || path.normalize(v) !== v) {
			throw new Error(`entwurf plugin: ${k} must be an absolute, normalized path (got ${JSON.stringify(v)})`);
		}
	}
	if (typeof raw.scope !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(raw.scope)) {
		throw new Error(`entwurf plugin: scope must match /^[a-z0-9][a-z0-9-]{0,62}$/ (got ${JSON.stringify(raw.scope)})`);
	}
	return { entwurfBin: raw.entwurfBin, declPath: raw.declPath, scope: raw.scope };
}

/** Model arguments → claim fields. Throws a tool error on bad input; nothing is started. */
export function buildClaim(config, ctx, params) {
	const p = params ?? {};
	const extra = Object.keys(p).filter((k) => !["target", "message", "wants_reply"].includes(k));
	if (extra.length > 0) throw new Error(`${TOOL_NAME}: unexpected argument(s) ${extra.join(", ")}`);
	if (typeof p.target !== "string" || !GARDEN_ID.test(p.target)) {
		throw new Error(`${TOOL_NAME}: target must be a garden id (got ${JSON.stringify(p.target)})`);
	}
	if (typeof p.message !== "string" || p.message.length === 0 || p.message.length > MESSAGE_CAP) {
		throw new Error(`${TOOL_NAME}: message must be 1..${MESSAGE_CAP} characters`);
	}
	if (p.wants_reply !== undefined && typeof p.wants_reply !== "boolean") {
		throw new Error(`${TOOL_NAME}: wants_reply must be a boolean`);
	}
	if (typeof ctx?.agentId !== "string" || typeof ctx?.sessionKey !== "string") {
		throw new Error(`${TOOL_NAME}: this tool context carries no agentId/sessionKey; refusing to send unattributed`);
	}
	return JSON.stringify({
		v: CLAIM_VERSION,
		scope: config.scope,
		agentId: ctx.agentId,
		sessionKey: ctx.sessionKey,
		target: p.target,
		message: p.message,
		wantsReply: p.wants_reply === true,
	});
}

const KIND_FOR_CODE = { 0: "dispatched", 4: "dispatched", 3: "rejected", 2: "invalid" };

/** Exit code + stdout → one outcome. Pure. */
export function classifyEntryResult(result) {
	const code = result?.code;
	const stdout = typeof result?.stdout === "string" ? result.stdout : "";
	const stderrTail = (typeof result?.stderr === "string" ? result.stderr : "").trim().slice(-400);
	const indeterminate = (why) => ({ outcome: "indeterminate", why, code: code ?? null, stderrTail });
	if (!Object.hasOwn(KIND_FOR_CODE, String(code))) {
		return indeterminate(code === 124 ? "entry timed out" : `entry exited ${code ?? "by signal"}`);
	}
	const lines = stdout.split("\n").filter((l) => l.length > 0);
	if (lines.length !== 1) return indeterminate(`entry printed ${lines.length} stdout line(s), expected 1`);
	let receipt;
	try {
		receipt = JSON.parse(lines[0]);
	} catch {
		return indeterminate("entry receipt is not JSON");
	}
	if (receipt === null || typeof receipt !== "object" || receipt.kind !== KIND_FOR_CODE[code]) {
		return indeterminate(`receipt kind ${JSON.stringify(receipt?.kind)} disagrees with exit ${code}`);
	}
	if (receipt.kind === "dispatched") {
		if (typeof receipt.text !== "string" || receipt.isError !== (code === 4)) {
			return indeterminate(`dispatched receipt disagrees with exit ${code}`);
		}
		return { outcome: code === 0 ? "dispatched" : "dispatch-reported-error", text: receipt.text };
	}
	if (receipt.kind === "rejected") {
		if (typeof receipt.reason !== "string") return indeterminate("rejected receipt has no reason");
		return { outcome: "rejected", reason: receipt.reason, detail: String(receipt.detail ?? "") };
	}
	return { outcome: "invalid", detail: String(receipt.detail ?? "") };
}

export function renderOutcome(o) {
	switch (o.outcome) {
		case "dispatched":
			return o.text;
		case "dispatch-reported-error":
			return `entwurf_v2 dispatch reported an error:\n${o.text}`;
		case "rejected":
			return `entwurf_v2 refused before dispatch (${o.reason}): ${o.detail}`;
		case "invalid":
			return `entwurf_v2 refused as invalid before dispatch: ${o.detail}`;
		default:
			return (
				`entwurf_v2 result is indeterminate (${o.why}); the message may or may not have been dispatched. ` +
				"Do not resend blindly." +
				(o.stderrTail ? `\nstderr: ${o.stderrTail}` : "")
			);
	}
}

/**
 * The tool's execute body. `run` is `api.runtime.system.runCommandWithTimeout` (argv, opts) — the
 * vendor surface [tag d.ts 2026.11.3: `runCommandWithTimeout(argv: string[], optionsOrTimeout)`].
 */
export async function executeSend(config, ctx, params, run) {
	const claim = buildClaim(config, ctx, params);
	if (typeof ctx.assertInvocationCurrent !== "function") {
		throw new Error(`${TOOL_NAME}: this OpenClaw tool context has no assertInvocationCurrent; refusing to send`);
	}
	ctx.assertInvocationCurrent(); // the commit point: throws → nothing is started
	const result = await run([config.entwurfBin, "openclaw-send", "--decl", config.declPath], {
		timeoutMs: SEND_TIMEOUT_MS,
		input: claim,
	});
	const outcome = classifyEntryResult(result);
	return { content: [{ type: "text", text: renderOutcome(outcome) }], details: outcome };
}
