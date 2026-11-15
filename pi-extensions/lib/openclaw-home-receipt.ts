/**
 * openclaw-home-receipt — the release MUST of the landlord-home admission (#160 S6 §7).
 *
 * A harness admitted as a landlord home (the Gateway owns the bot's lifecycle; Entwurf only
 * addresses an existing, pinned home on one fixed key) owes no visible fresh. Its first admission
 * instead owes ONE candidate-attributed receipt of the replacement-behaviour oracles, measured on a
 * lab Gateway, and this pure judge is what the release step reads. It measures nothing and runs no
 * Gateway; it refuses a receipt that cannot stand for THIS candidate, THIS home and THIS evidence.
 *
 * Shape (v1, strict at every level — an unknown key anywhere is refused, so a typo or a field this
 * version does not define cannot ride through silently):
 *
 *   { v: 1,
 *     candidate: { head: <40-hex> },
 *     measuredAt: <ISO-8601 UTC, after the candidate's commit time>,
 *     config: { scope, gatewayUrl: ws:|wss:, bin: <bool, a declared bin was used>, openclawVersion },
 *     target: "<scope>/<agentId>/<sessionKey>#<gardenId>",
 *     rows: { <every row name>: { result: "pass", evidence: { path: <absolute>, sha256: <64-hex> } }
 *                             | { result: "unmeasured", reason: <non-empty> }  (allowed rows only) } }
 *
 * The expected target is NOT taken from the receipt: the caller supplies it (the operator's input),
 * so a receipt naming another home consistently throughout is still refused. Evidence is checked
 * against the bytes at its path through the caller's digest function, so a free sentence or an old
 * file under a new head does not pass. `unmeasured` is accepted only on the closed allowlist and
 * always with a reason; every other row must pass.
 */

import { requireGardenId } from "./meta-session.ts";
import { composeOpenclawNativeSessionId } from "./openclaw-citizens.ts";

export const OPENCLAW_HOME_RECEIPT_VERSION = 1;

/** The replacement behaviours (open … compact-reset) and the required evidence (visibility … resources). */
export const OPENCLAW_HOME_RECEIPT_ROWS = [
	"open",
	"address",
	"consume",
	"reply",
	"close",
	"refusal",
	"compactReset",
	"visibility",
	"modelPolicy",
	"sendScope",
	"resources",
] as const;

/**
 * Rows a first admission may report as `unmeasured`, with a reason (#160 S6.5 proposal, ee14c7).
 * `compactReset`: whether the vendor keeps consuming on the same key after ITS compaction is an
 * OpenClaw-owned observation the contract left open (delta §3); Entwurf's side of it is proven
 * deterministically. `resources`: lab client residue across an ssh/exec boundary may not be
 * observable on every lab; the runner's own child bound is proven deterministically. Every other row
 * — the behaviours and the three required evidences (visibility, model/policy, send scope) — must pass.
 */
export const OPENCLAW_HOME_RECEIPT_UNMEASURED_ALLOWED: readonly string[] = ["compactReset", "resources"];

export interface OpenclawHomeReceiptContext {
	/** The full 40-hex commit being released. */
	candidateHead: string;
	/** That commit's time, epoch ms. */
	candidateCommittedAtMs: number;
	/** The home the operator says was measured: `<scope>/<agentId>/<sessionKey>#<gardenId>`. */
	expectedTarget: string;
	/** sha256 of the regular file at an absolute path, or null when it cannot be read. */
	digestOf: (absolutePath: string) => string | null;
}

export type OpenclawHomeReceiptVerdict = { ok: true; target: string } | { ok: false; problems: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

function exactKeys(obj: Record<string, unknown>, keys: readonly string[], what: string, problems: string[]): void {
	const want = new Set(keys);
	const stray = Object.keys(obj).filter((k) => !want.has(k));
	const missing = keys.filter((k) => !Object.hasOwn(obj, k));
	if (stray.length || missing.length) {
		problems.push(
			`${what}: keys must be ${keys.join(", ")} (missing ${missing.join(", ") || "none"}; stray ${stray.join(", ") || "none"})`,
		);
	}
}

const TARGET_RE = /^([^/]+)\/([^/]+)\/(agent:[^#]+)#(.+)$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Judge `raw` for the release described by `ctx`. Pure apart from `ctx.digestOf`. */
export function judgeOpenclawHomeReceipt(raw: unknown, ctx: OpenclawHomeReceiptContext): OpenclawHomeReceiptVerdict {
	const problems: string[] = [];
	if (!isObject(raw)) return { ok: false, problems: ["receipt: must be a JSON object"] };
	exactKeys(raw, ["v", "candidate", "measuredAt", "config", "target", "rows"], "receipt", problems);
	if (raw.v !== OPENCLAW_HOME_RECEIPT_VERSION) problems.push(`receipt.v: must be ${OPENCLAW_HOME_RECEIPT_VERSION}`);

	// candidate
	if (!isObject(raw.candidate)) {
		problems.push("receipt.candidate: must be an object");
	} else {
		exactKeys(raw.candidate, ["head"], "receipt.candidate", problems);
		const head = raw.candidate.head;
		if (typeof head !== "string" || !/^[0-9a-f]{40}$/.test(head)) {
			problems.push("receipt.candidate.head: must be a full 40-hex commit");
		} else if (head !== ctx.candidateHead) {
			problems.push(`receipt.candidate.head: ${head} is another candidate (releasing ${ctx.candidateHead})`);
		}
	}

	// measuredAt
	const measuredAt = raw.measuredAt;
	if (typeof measuredAt !== "string" || !ISO_UTC_RE.test(measuredAt) || Number.isNaN(Date.parse(measuredAt))) {
		problems.push("receipt.measuredAt: must be an ISO-8601 UTC time (…Z)");
	} else if (!(Date.parse(measuredAt) > ctx.candidateCommittedAtMs)) {
		problems.push(
			`receipt.measuredAt: ${measuredAt} is not after the candidate's commit (${new Date(ctx.candidateCommittedAtMs).toISOString()}); a measurement cannot predate what it measured`,
		);
	}

	// target
	const target = typeof raw.target === "string" ? raw.target : "";
	const m = TARGET_RE.exec(target);
	if (!m) {
		problems.push("receipt.target: must be <scope>/<agentId>/<sessionKey>#<gardenId>");
	} else {
		try {
			composeOpenclawNativeSessionId(m[1], m[2], m[3]);
			requireGardenId(m[4]);
		} catch (err) {
			problems.push(`receipt.target: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	if (target !== ctx.expectedTarget) {
		problems.push(`receipt.target: ${target || "(none)"} is not the expected home ${ctx.expectedTarget}`);
	}

	// config
	if (!isObject(raw.config)) {
		problems.push("receipt.config: must be an object");
	} else {
		const c = raw.config;
		exactKeys(c, ["scope", "gatewayUrl", "bin", "openclawVersion"], "receipt.config", problems);
		if (m && c.scope !== m[1])
			problems.push(`receipt.config.scope: ${String(c.scope)} is not the target's scope ${m[1]}`);
		let url: URL | null = null;
		try {
			url = typeof c.gatewayUrl === "string" ? new URL(c.gatewayUrl) : null;
		} catch {
			url = null;
		}
		if (!url || (url.protocol !== "ws:" && url.protocol !== "wss:")) {
			problems.push("receipt.config.gatewayUrl: must be a ws: or wss: URL");
		}
		if (typeof c.bin !== "boolean") problems.push("receipt.config.bin: must be a boolean (a declared bin was used)");
		if (typeof c.openclawVersion !== "string" || !/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(c.openclawVersion)) {
			problems.push("receipt.config.openclawVersion: must be an OpenClaw release version (YYYY.M.D)");
		}
	}

	// rows
	if (!isObject(raw.rows)) {
		problems.push("receipt.rows: must be an object");
	} else {
		exactKeys(raw.rows, OPENCLAW_HOME_RECEIPT_ROWS, "receipt.rows", problems);
		for (const name of OPENCLAW_HOME_RECEIPT_ROWS) {
			const row = raw.rows[name];
			const at = `receipt.rows.${name}`;
			if (!isObject(row)) {
				if (Object.hasOwn(raw.rows, name)) problems.push(`${at}: must be an object`);
				continue;
			}
			if (row.result === "pass") {
				exactKeys(row, ["result", "evidence"], at, problems);
				const ev = row.evidence;
				if (!isObject(ev)) {
					problems.push(`${at}.evidence: must be {path, sha256}`);
					continue;
				}
				exactKeys(ev, ["path", "sha256"], `${at}.evidence`, problems);
				if (typeof ev.path !== "string" || !ev.path.startsWith("/")) {
					problems.push(`${at}.evidence.path: must be an absolute path`);
					continue;
				}
				if (typeof ev.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(ev.sha256)) {
					problems.push(`${at}.evidence.sha256: must be 64-hex`);
					continue;
				}
				const actual = ctx.digestOf(ev.path);
				if (actual === null) problems.push(`${at}.evidence: ${ev.path} cannot be read`);
				else if (actual !== ev.sha256) problems.push(`${at}.evidence: ${ev.path} does not have sha256 ${ev.sha256}`);
			} else if (row.result === "unmeasured") {
				exactKeys(row, ["result", "reason"], at, problems);
				if (!OPENCLAW_HOME_RECEIPT_UNMEASURED_ALLOWED.includes(name)) {
					problems.push(
						`${at}: may not be unmeasured (only ${OPENCLAW_HOME_RECEIPT_UNMEASURED_ALLOWED.join(", ")} may)`,
					);
				}
				if (typeof row.reason !== "string" || row.reason.trim() === "")
					problems.push(`${at}: unmeasured needs a reason`);
			} else {
				problems.push(`${at}: result is ${String(row.result)}, not pass or unmeasured`);
			}
		}
	}
	return problems.length === 0 ? { ok: true, target } : { ok: false, problems };
}
