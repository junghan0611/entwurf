/**
 * The native work oracle for a Claude sibling — ACP Claude or native Claude Code (#138): what Claude ITSELF
 * executed, read from its own
 * Claude Code transcript — not from the `[tool:*]` text notices entwurf's event mapper draws into the pi
 * transcript (pi-extensions/lib/acp/event-mapper.ts:20-25), which are display carriers.
 *
 * Where that transcript is (source-read, measured by the take, never searched for):
 *   - the pi sibling's ACP session record is `~/.pi/agent/cache/entwurf/sessions/<sha256(sessionKey)>.json`
 *     (session-store.ts:150,387) with sessionKey `pi:<options.sessionId | PI_SESSION_ID>` (backend.ts:997-1001);
 *     it carries `acpSessionId`. Read raw here — `readSessionRecord` deletes a record it finds invalid
 *     (session-store.ts:395), so it is never called for evidence.
 *   - claude-agent-acp 0.85.1 gives a new session a random UUID and hands it to the SDK as
 *     `options.sessionId` (dist/acp-agent.js:6625-6643, 6977-6979); the SDK persists it under the ACP
 *     overlay's private config dir (overlay.ts:57) as `projects/<cwd slug>/<acpSessionId>.jsonl`.
 * The cache ↔ filename link is a correlation for evidence, never an address. A record that is absent, malformed,
 * for another key/cwd/model or not a canonical UUID stops the lookup before any transcript is opened.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseSessionRecord } from "../../pi-extensions/lib/acp/session-store.ts";
import { bashCountsLines, type Verdict, type WorkExpectation } from "./pi-durable-work.ts";

export const ACP_SESSION_CACHE_DIR = path.join(os.homedir(), ".pi", "agent", "cache", "entwurf", "sessions");
export const ACP_CLAUDE_OVERLAY_DIR = path.join(os.homedir(), ".pi", "agent", "claude-config-overlay");

/** The cache file a sessionKey maps to (same digest as session-store.ts sessionRecordPath). */
export function acpSessionRecordPath(sessionKey: string, dir = ACP_SESSION_CACHE_DIR): string {
	return path.join(dir, `${createHash("sha256").update(sessionKey).digest("hex")}.json`);
}

/** Claude Code's project directory name for a cwd: every non-alphanumeric character becomes `-`. */
export function claudeProjectSlug(cwd: string): string {
	return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** claude-agent-acp mints a new session id with randomUUID() (dist/acp-agent.js:6642): canonical v4 form only. */
const ACP_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type AcpTranscriptResolution =
	| { ok: true; sessionKey: string; acpSessionId: string; record: string; jsonl: string; diagnostics: string[] }
	| { ok: false; reason: string; diagnostics: string[] };

/**
 * Locate THIS sibling's ACP Claude transcript from its own session-cache record — read-only, never repaired or
 * deleted (unlike session-store's readSessionRecord). Each candidate key's record must pass session-store's pure
 * `parseSessionRecord` (version, provider, the same sessionKey, every field), carry a canonical v4 UUID, and
 * name the expected cwd and modelId; exactly one candidate may resolve. Only then is a path built, and it must
 * stay inside the overlay's `projects/<slug(cwd)>/`. Nothing else is listed or searched.
 */
export function resolveAcpTranscript(
	candidateKeys: readonly string[],
	expect: { cwd: string; modelId: string },
	dirs: { cache?: string; overlay?: string } = {},
): AcpTranscriptResolution {
	const diagnostics: string[] = [];
	const resolved: Array<{ sessionKey: string; acpSessionId: string; record: string }> = [];
	for (const key of candidateKeys) {
		const record = acpSessionRecordPath(key, dirs.cache);
		if (!fs.existsSync(record)) {
			diagnostics.push(`${key}: no cache record`);
			continue;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(fs.readFileSync(record, "utf8"));
		} catch (err) {
			diagnostics.push(`${key}: malformed JSON (${err instanceof Error ? err.message : String(err)})`);
			continue;
		}
		const parsed = parseSessionRecord(raw, key);
		if (!parsed) {
			diagnostics.push(`${key}: not a valid session record for this key`);
			continue;
		}
		if (!ACP_SESSION_UUID.test(parsed.acpSessionId)) {
			diagnostics.push(`${key}: acpSessionId ${JSON.stringify(parsed.acpSessionId)} is not a canonical UUID`);
			continue;
		}
		if (parsed.cwd !== expect.cwd || parsed.modelId !== expect.modelId) {
			diagnostics.push(`${key}: record names cwd ${parsed.cwd} / model ${parsed.modelId}, not this scene's`);
			continue;
		}
		resolved.push({ sessionKey: key, acpSessionId: parsed.acpSessionId, record });
	}
	if (resolved.length !== 1)
		return { ok: false, reason: `${resolved.length} candidate records resolved (exactly one required)`, diagnostics };
	const only = resolved[0] as { sessionKey: string; acpSessionId: string; record: string };
	const projectDir = path.join(dirs.overlay ?? ACP_CLAUDE_OVERLAY_DIR, "projects", claudeProjectSlug(expect.cwd));
	const jsonl = path.join(projectDir, `${only.acpSessionId}.jsonl`);
	if (path.dirname(jsonl) !== projectDir)
		return { ok: false, reason: "transcript path escapes its project dir", diagnostics };
	return { ok: true, ...only, jsonl, diagnostics };
}

interface Block {
	type?: unknown;
	id?: unknown;
	name?: unknown;
	input?: { command?: unknown };
	tool_use_id?: unknown;
	content?: unknown;
	is_error?: unknown;
}
function blocks(row: unknown): Block[] {
	const content = (row as { message?: { content?: unknown } }).message?.content;
	return Array.isArray(content) ? (content as Block[]) : [];
}
function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.map((c) => ((c as { type?: unknown }).type === "text" ? String((c as { text?: unknown }).text ?? "") : ""))
			.join("");
	return "";
}

export interface ClaudeNativeView {
	sessionIds: string[];
	cwds: string[];
	models: string[];
	bash: Array<{ id: string; command: string; result: { text: string; isError: boolean } | null }>;
}

/** Join Claude Code transcript rows: Bash tool_use (assistant) ↔ tool_result (user) by tool_use_id. */
export function claudeNativeView(rows: readonly unknown[]): ClaudeNativeView {
	const sessionIds = new Set<string>();
	const cwds = new Set<string>();
	const models = new Set<string>();
	const uses = new Map<string, string>();
	const results = new Map<string, { text: string; isError: boolean }>();
	for (const row of rows) {
		const r = row as { type?: unknown; sessionId?: unknown; cwd?: unknown; message?: { model?: unknown } };
		if (typeof r.sessionId === "string") sessionIds.add(r.sessionId);
		if (typeof r.cwd === "string") cwds.add(r.cwd);
		if (r.type === "assistant") {
			if (typeof r.message?.model === "string") models.add(r.message.model);
			for (const b of blocks(row))
				if (b.type === "tool_use" && b.name === "Bash" && typeof b.id === "string")
					uses.set(b.id, String(b.input?.command ?? ""));
		}
		if (r.type === "user")
			for (const b of blocks(row))
				if (b.type === "tool_result" && typeof b.tool_use_id === "string")
					results.set(b.tool_use_id, { text: resultText(b.content), isError: b.is_error === true });
	}
	return {
		sessionIds: [...sessionIds],
		cwds: [...cwds],
		models: [...models],
		bash: [...uses].map(([id, command]) => ({ id, command, result: results.get(id) ?? null })),
	};
}

/** The sibling's own Claude ran Bash in the take's cwd, and that call settled with the fixture's count + first line. */
export function judgeClaudeNativeWork(
	view: ClaudeNativeView,
	acpSessionId: string,
	cwd: string,
	exp: WorkExpectation,
): Verdict[] {
	const ok = view.bash.find(
		(b) =>
			b.result !== null &&
			!b.result.isError &&
			bashCountsLines(b.result.text, exp) &&
			b.result.text.includes(exp.firstLine),
	);
	return [
		{
			name: "the Claude transcript is this sibling's session in this take's cwd (exactly one of each, measured)",
			ok:
				view.sessionIds.length === 1 &&
				view.sessionIds[0] === acpSessionId &&
				view.cwds.length === 1 &&
				view.cwds[0] === cwd,
			detail: JSON.stringify({ sessionIds: view.sessionIds, cwds: view.cwds }),
		},
		{
			name: "Claude's native model was observed on its own assistant rows",
			ok: view.models.length > 0,
			detail: JSON.stringify(view.models),
		},
		{
			name: "Claude's own Bash (tool_use ↔ tool_result) settled without error with the fixture's count and first line",
			ok: ok !== undefined,
			detail: JSON.stringify(view.bash),
		},
	];
}

/** Every tool_use in a Claude Code transcript joined to its tool_result — for the entwurf verbs a native
 * Claude Code sibling calls through its own MCP (inbox read, reply). Read-only over the given rows. */
export function claudeToolCalls(rows: readonly unknown[]): Array<{
	id: string;
	name: string;
	input: Record<string, unknown>;
	result: { text: string; isError: boolean } | null;
}> {
	const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
	const results = new Map<string, { text: string; isError: boolean }>();
	for (const row of rows) {
		const type = (row as { type?: unknown }).type;
		for (const b of blocks(row)) {
			if (type === "assistant" && b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
				calls.push({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
			if (type === "user" && b.type === "tool_result" && typeof b.tool_use_id === "string")
				results.set(b.tool_use_id, { text: resultText(b.content), isError: b.is_error === true });
		}
	}
	return calls.map((c) => ({ ...c, result: results.get(c.id) ?? null }));
}

/** A native Claude Code sibling's receive and reply, from its own transcript: it drained ITS OWN inbox, and its
 * entwurf_v2 back to the caller settled on the caller's control socket. */
export function judgeClaudeCodeReceive(
	rows: readonly unknown[],
	ownGid: string,
	callerGid: string,
	controlBoundary: RegExp,
): Verdict[] {
	const calls = claudeToolCalls(rows);
	const read = calls.filter((c) => /(^|__)entwurf_inbox_read$/.test(c.name));
	const back = calls.filter((c) => /(^|__)entwurf_v2$/.test(c.name) && c.input.target === callerGid);
	return [
		{
			name: "the Claude Code sibling drained its own inbox (entwurf_inbox_read of its own garden id, settled)",
			ok: read.some((c) => c.input.gardenId === ownGid && c.result !== null && !c.result.isError),
			detail: JSON.stringify(read.map((c) => ({ input: c.input, result: c.result?.isError }))),
		},
		{
			name: "its entwurf_v2 back to the caller settled on the caller's control socket",
			ok: back.some((c) => c.result !== null && !c.result.isError && controlBoundary.test(c.result.text)),
			detail: JSON.stringify(back.map((c) => c.result)),
		},
	];
}

/** The approved native Claude Code selectors for demo takes, each with the model FAMILY its sessions may report.
 * The alias is what was requested; the observed id is recorded as-is and only judged for family. */
export const APPROVED_CC_ALIASES = {
	sonnet: /^claude-sonnet-\d+(?:-\d+)*$/,
} as const;
export type ApprovedCcAlias = keyof typeof APPROVED_CC_ALIASES;

export function isApprovedCcAlias(alias: string): alias is ApprovedCcAlias {
	return Object.hasOwn(APPROVED_CC_ALIASES, alias);
}

/** An observed native model id belongs to the requested alias's family (sonnet → claude-sonnet-N…), never another. */
export function isNativeModelOfAlias(alias: ApprovedCcAlias, observed: string): boolean {
	return APPROVED_CC_ALIASES[alias].test(observed);
}
