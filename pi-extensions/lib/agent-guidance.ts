/**
 * Product-owned natural-language logic, authored only in root ENTWURF.json (#154).
 * One module-relative file, read once. The compiled layout carries an exact copy at
 * dist/ENTWURF.json; no cwd/HOME search, override, old-text fallback or hot reload.
 * Existing operator engraving and user-configuration contracts are unrelated.
 */
import { readFileSync } from "node:fs";

const TOOL_SPEC = {
	entwurf_v2: { durable: true, parameters: ["target", "intent", "message", "mode", "wants_reply"] },
	entwurf_self: { durable: true, parameters: [] },
	entwurf_peers: { durable: true, parameters: [] },
	entwurf_inbox_read: { durable: true, parameters: ["gardenId"] },
	entwurf_register_native: { durable: false, parameters: ["backend", "nativeSessionId", "cwd"] },
	entwurf_fresh_call: {
		durable: true,
		parameters: ["backend", "model", "task", "cwd", "placement.tmuxSession", "placement"],
	},
	entwurf_resume_call: { durable: true, parameters: ["target"] },
	entwurf_retire_call: { durable: true, parameters: ["target"] },
	entwurf_callback: { durable: true, parameters: [] },
} as const;

/** Frozen entwurf_v2 reject wire ids whose static next-step hint text lives in the root file. */
const REJECT_HINT_REASONS = [
	"dormant-fire-forget-unsupported",
	"indeterminate-no-spawn",
	"native-push-target-dead",
	"native-push-probe-indeterminate",
	"native-push-paused",
] as const;

export type RejectHintReason = (typeof REJECT_HINT_REASONS)[number];

/** Frozen entwurf_resume_call record/liveness reject wire ids whose static hint text lives in the root file. */
const RESUME_REJECT_HINT_REASONS = [
	"target-invalid",
	"target-backend-unsupported",
	"target-locked",
	"target-live",
	"target-indeterminate",
	"target-receiver-absent",
	"target-receiver-corrupt",
	"target-receiver-mismatch",
	"target-receiver-unbound",
	"target-address-conflict",
	"launch-refused",
] as const;

export type ResumeRejectHintReason = (typeof RESUME_REJECT_HINT_REASONS)[number];

type ToolName = keyof typeof TOOL_SPEC;
type ToolGuidance<K extends ToolName> = {
	readonly descriptions: (typeof TOOL_SPEC)[K]["durable"] extends true
		? { readonly mcp: string; readonly durable: string }
		: { readonly mcp: string };
	readonly parameters: Readonly<Record<(typeof TOOL_SPEC)[K]["parameters"][number], string>>;
};

export interface EntwurfGuidance {
	readonly _about: Readonly<Record<"purpose" | "ownership" | "scope" | "editing", string>>;
	readonly schemaVersion: 3;
	readonly revision: number;
	readonly history: readonly {
		readonly revision: number;
		readonly source: string;
		readonly issue: string;
		readonly change: string;
	}[];
	readonly tools: { readonly [K in ToolName]: ToolGuidance<K> };
	readonly rejectHints: Readonly<Record<RejectHintReason, string>>;
	readonly resumeRejectHints: Readonly<Record<ResumeRejectHintReason, string>>;
}

function record(value: unknown, at: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`ENTWURF.json ${at}: expected an object`);
	}
}

function keys(value: Record<string, unknown>, expected: readonly string[], at: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
		throw new Error(`ENTWURF.json ${at}: keys must be exactly ${wanted.join(", ")}`);
	}
}

function text(value: unknown, at: string): void {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`ENTWURF.json ${at}: expected a non-empty string`);
	}
}

/**
 * JSON.parse owns strict grammar, but its last-key-wins value is never enough.
 * Walk the ORIGINAL, already grammar-checked tokens and reject duplicate DECODED
 * object keys before returning data. Object scopes are independent; strings that
 * are values (including punctuation and escaped quotes) are never key tokens.
 */
function rejectDuplicateKeys(source: string): void {
	let pos = 0;
	const space = (): void => {
		while (pos < source.length && /[\x20\t\r\n]/.test(source[pos])) pos++;
	};
	const string = (): string => {
		const start = pos++;
		while (pos < source.length) {
			if (source[pos] === "\\") pos += 2;
			else if (source[pos++] === '"') return JSON.parse(source.slice(start, pos)) as string;
		}
		throw new Error("ENTWURF.json: unterminated string");
	};
	const value = (): void => {
		space();
		if (source[pos] === "{") {
			pos++;
			space();
			const seen = new Set<string>();
			if (source[pos] !== "}") {
				for (;;) {
					space();
					const key = string();
					if (seen.has(key)) throw new Error(`ENTWURF.json: duplicate object key ${JSON.stringify(key)}`);
					seen.add(key);
					space();
					pos++; // colon; JSON.parse already certified the grammar
					value();
					space();
					if (source[pos] !== ",") break;
					pos++;
				}
			}
			pos++;
		} else if (source[pos] === "[") {
			pos++;
			space();
			if (source[pos] !== "]") {
				for (;;) {
					value();
					space();
					if (source[pos] !== ",") break;
					pos++;
				}
			}
			pos++;
		} else if (source[pos] === '"') {
			string();
		} else {
			while (pos < source.length && !/[\x20\t\r\n,}\]]/.test(source[pos])) pos++;
		}
	};
	value();
}

function freeze(value: unknown): void {
	if (value === null || typeof value !== "object") return;
	for (const child of Object.values(value)) freeze(child);
	Object.freeze(value);
}

/** Pure data-validation seam; production always reads the one fixed module URL below. */
export function parseEntwurfGuidance(source: string): EntwurfGuidance {
	const data: unknown = JSON.parse(source);
	rejectDuplicateKeys(source);
	record(data, "root");
	if (data.schemaVersion !== 3) throw new Error("ENTWURF.json: unsupported schemaVersion");
	keys(data, ["_about", "schemaVersion", "revision", "history", "tools", "rejectHints", "resumeRejectHints"], "root");
	if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 1) {
		throw new Error("ENTWURF.json: revision must be a positive safe integer");
	}
	record(data._about, "_about");
	keys(data._about, ["purpose", "ownership", "scope", "editing"], "_about");
	for (const [key, value] of Object.entries(data._about)) text(value, `_about.${key}`);
	if (!Array.isArray(data.history) || data.history.length === 0) {
		throw new Error("ENTWURF.json: history must be a non-empty array");
	}
	for (const entry of data.history) {
		record(entry, "history entry");
		keys(entry, ["revision", "source", "issue", "change"], "history entry");
		if (
			!Number.isSafeInteger(entry.revision) ||
			(entry.revision as number) < 1 ||
			(entry.revision as number) > (data.revision as number)
		) {
			throw new Error("ENTWURF.json: history revision must name an existing payload revision");
		}
		for (const key of ["source", "issue", "change"] as const) text(entry[key], `history.${key}`);
	}
	record(data.tools, "tools");
	keys(data.tools, Object.keys(TOOL_SPEC), "tools");
	for (const name of Object.keys(TOOL_SPEC) as ToolName[]) {
		const tool = data.tools[name];
		record(tool, name);
		keys(tool, ["descriptions", "parameters"], name);
		record(tool.descriptions, `${name}.descriptions`);
		keys(tool.descriptions, TOOL_SPEC[name].durable ? ["mcp", "durable"] : ["mcp"], `${name}.descriptions`);
		for (const [rail, value] of Object.entries(tool.descriptions)) text(value, `${name}.descriptions.${rail}`);
		record(tool.parameters, `${name}.parameters`);
		keys(tool.parameters, TOOL_SPEC[name].parameters, `${name}.parameters`);
		for (const [field, value] of Object.entries(tool.parameters)) text(value, `${name}.parameters.${field}`);
	}
	record(data.rejectHints, "rejectHints");
	keys(data.rejectHints, REJECT_HINT_REASONS, "rejectHints");
	for (const [reason, value] of Object.entries(data.rejectHints)) text(value, `rejectHints.${reason}`);
	record(data.resumeRejectHints, "resumeRejectHints");
	keys(data.resumeRejectHints, RESUME_REJECT_HINT_REASONS, "resumeRejectHints");
	for (const [reason, value] of Object.entries(data.resumeRejectHints)) text(value, `resumeRejectHints.${reason}`);
	freeze(data);
	return data as unknown as EntwurfGuidance;
}

const guidance = parseEntwurfGuidance(readFileSync(new URL("../../ENTWURF.json", import.meta.url), "utf8"));

/** Only these exact payload strings enter tool schemas; _about/history never do. */
export const ENTWURF_TOOL_GUIDANCE = guidance.tools;
/** Static next-step text appended to these entwurf_v2 rejections; the decider and wire ids stay code-owned. */
export const ENTWURF_REJECT_HINTS = guidance.rejectHints;
/** Static next-step text in these entwurf_resume_call rejections; the verb, the launch-stage mux hints and the shared ACP model hint stay code-owned. */
export const ENTWURF_RESUME_REJECT_HINTS = guidance.resumeRejectHints;
export const ENTWURF_GUIDANCE_VERSION = Object.freeze({
	schemaVersion: guidance.schemaVersion,
	revision: guidance.revision,
});
