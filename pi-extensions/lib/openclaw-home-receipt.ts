/**
 * openclaw-home-receipt — the release MUST of the landlord-home admission (#160 S6 §7).
 *
 * A harness admitted as a landlord home (the Gateway owns the bot's lifecycle; Entwurf only
 * addresses an existing, pinned home on one fixed key) owes no visible fresh. Its first admission
 * instead owes ONE candidate-attributed receipt of the replacement-behaviour oracles, measured on a
 * lab Gateway by a person or sibling, and this pure judge is what the release step reads. It does not
 * measure anything and does not run a Gateway; it refuses a receipt that cannot stand for THIS
 * candidate and THIS home.
 *
 * Refused by name: anything that is not a v1 receipt object; a candidate head that is not the head
 * being released; a target that does not compose to one OpenClaw native id with a garden id; any of
 * the required rows missing, carrying another target, a result other than `pass`, or no evidence.
 * Unknown keys are refused too, so a typo cannot hide a row. An empty object fails every rule.
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

/**
 * Judge `raw` for the release of `candidateHead` (the full 40-hex commit being cut). Pure.
 * The receipt's `target` is `<scope>/<agentId>/<sessionKey>#<gardenId>`; every row repeats it.
 */
export function judgeOpenclawHomeReceipt(raw: unknown, candidateHead: string): OpenclawHomeReceiptVerdict {
	const problems: string[] = [];
	if (!isObject(raw)) return { ok: false, problems: ["receipt: must be a JSON object"] };
	exactKeys(raw, ["v", "candidate", "target", "rows"], "receipt", problems);
	if (raw.v !== OPENCLAW_HOME_RECEIPT_VERSION) problems.push(`receipt.v: must be ${OPENCLAW_HOME_RECEIPT_VERSION}`);

	const head = isObject(raw.candidate) ? raw.candidate.head : undefined;
	if (typeof head !== "string" || !/^[0-9a-f]{40}$/.test(head)) {
		problems.push("receipt.candidate.head: must be a full 40-hex commit");
	} else if (head !== candidateHead) {
		problems.push(`receipt.candidate.head: ${head} is another candidate (releasing ${candidateHead})`);
	}

	const target = typeof raw.target === "string" ? raw.target : "";
	const m = /^([^/]+)\/([^/]+)\/(agent:[^#]+)#(.+)$/.exec(target);
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

	if (!isObject(raw.rows)) {
		problems.push("receipt.rows: must be an object");
	} else {
		exactKeys(raw.rows, OPENCLAW_HOME_RECEIPT_ROWS, "receipt.rows", problems);
		for (const name of OPENCLAW_HOME_RECEIPT_ROWS) {
			const row = raw.rows[name];
			if (!isObject(row)) {
				if (Object.hasOwn(raw.rows, name)) problems.push(`receipt.rows.${name}: must be an object`);
				continue;
			}
			if (row.target !== target) problems.push(`receipt.rows.${name}: names another target (${String(row.target)})`);
			if (row.result !== "pass") problems.push(`receipt.rows.${name}: result is ${String(row.result)}, not pass`);
			if (typeof row.evidence !== "string" || row.evidence.trim() === "") {
				problems.push(`receipt.rows.${name}: carries no evidence`);
			}
		}
	}
	return problems.length === 0 ? { ok: true, target } : { ok: false, problems };
}
