/**
 * Pure helpers for the herdr demo take (#138): the take-scoped fence, the herdr JSON answers the take reads for
 * VIEW coordinates (never an address), and the English-only check. No IO; the take passes everything in.
 */
import * as path from "node:path";

/**
 * The private instance: herdr's socket, config and state follow XDG_* (docs/herdr-launch-rail.md §12.5 and the
 * smoke recipe it cites); entwurf's record, mailbox, sender, receiver and lock roots follow their own overrides
 * (meta-session.ts defaultMeta*Dir). HOME stays the operator's: auth and the vendors' own stores live there.
 * Not fenceable, so not listed: the pi control-socket dir and the v2 lock dir are homedir constants
 * (entwurf-control.ts:108, entwurf-v2-lock.ts:80) — an env name here would claim a fence that does not exist.
 */
export function herdrFence(root: string): Record<string, string> {
	return {
		XDG_CONFIG_HOME: path.join(root, "xdg-config"),
		XDG_DATA_HOME: path.join(root, "xdg-data"),
		XDG_STATE_HOME: path.join(root, "xdg-state"),
		XDG_CACHE_HOME: path.join(root, "xdg-cache"),
		XDG_RUNTIME_DIR: path.join(root, "xdg-runtime"),
		ENTWURF_META_SESSIONS_DIR: path.join(root, "meta-sessions"),
		ENTWURF_META_RECEIVERS_DIR: path.join(root, "meta-receivers"),
		ENTWURF_META_SENDERS_DIR: path.join(root, "meta-senders"),
		ENTWURF_META_MAILBOX_DIR: path.join(root, "meta-mailbox"),
	};
}

/** Take-only herdr config: no first-run modal over the recorded UI. Written inside the fence, never globally. */
export const HERDR_TAKE_CONFIG = "onboarding = false\n";

/** Mutates `env`: every ambient herdr carrier (HERDR_*) is removed, then the fence is applied. */
export function applyHerdrFence(env: NodeJS.ProcessEnv, fence: Record<string, string>): void {
	for (const name of Object.keys(env)) if (name.startsWith("HERDR_")) delete env[name];
	Object.assign(env, fence);
}

function isInside(parent: string, p: string): boolean {
	const rel = path.relative(parent, p);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Named reasons `env` is not fenced: a fence value missing, changed or outside `root`, or a herdr carrier left. */
export function fenceProblems(env: NodeJS.ProcessEnv, fence: Record<string, string>, root: string): string[] {
	const problems: string[] = [];
	for (const [name, value] of Object.entries(fence)) {
		if (env[name] !== value) problems.push(`${name}=${String(env[name])} is not the fence ${value}`);
		if (!isInside(root, value)) problems.push(`${name} fence ${value} is outside ${root}`);
	}
	for (const name of Object.keys(env)) if (name.startsWith("HERDR_")) problems.push(`${name} is still set`);
	return problems;
}

/** herdr's `workspace create` answer: the three coordinates, only when both halves agree on them. */
export function parseWorkspaceCreated(stdout: string): { workspaceId: string; tabId: string; paneId: string } | null {
	let j: {
		result?: {
			type?: unknown;
			workspace?: { workspace_id?: unknown };
			tab?: { tab_id?: unknown; workspace_id?: unknown };
			root_pane?: { pane_id?: unknown; tab_id?: unknown; workspace_id?: unknown };
		};
	};
	try {
		j = JSON.parse(stdout);
	} catch {
		return null;
	}
	const r = j?.result;
	const workspaceId = r?.workspace?.workspace_id;
	const tabId = r?.tab?.tab_id;
	const paneId = r?.root_pane?.pane_id;
	if (r?.type !== "workspace_created") return null;
	if (typeof workspaceId !== "string" || typeof tabId !== "string" || typeof paneId !== "string") return null;
	if (!workspaceId || !tabId || !paneId) return null;
	if (r.tab?.workspace_id !== workspaceId || r.root_pane?.workspace_id !== workspaceId) return null;
	if (r.root_pane?.tab_id !== tabId) return null;
	return { workspaceId, tabId, paneId };
}

/** herdr's `tab focus` answer names exactly that tab, focused. */
export function isTabFocused(stdout: string, tabId: string): boolean {
	try {
		const r = (JSON.parse(stdout) as { result?: { type?: unknown; tab?: { tab_id?: unknown; focused?: unknown } } })
			.result;
		return r?.type === "tab_info" && r.tab?.tab_id === tabId && r.tab.focused === true;
	} catch {
		return false;
	}
}

/** The herdr rail's launch receipt (herdr-fresh-call.ts renderer): the new tab and its workspace — a view. */
export function herdrLaunchTab(text: string): { tabId: string; workspaceId: string } | null {
	if (!text.startsWith("[entwurf fresh call → herdr]\n")) return null;
	const m = /^ {2}tab: {6}(\S+) in workspace (\S+) /m.exec(text);
	return m ? { tabId: m[1] as string, workspaceId: m[2] as string } : null;
}

/** Text of the LAST completed (stop) assistant row after `after` in a pi transcript, or null. */
export function lastCompletedText(entries: readonly unknown[], after: number): string | null {
	let last: string | null = null;
	for (const raw of entries.slice(after + 1)) {
		const e = raw as { type?: unknown; message?: { role?: unknown; content?: unknown; stopReason?: unknown } };
		if (e.type !== "message" || e.message?.role !== "assistant" || e.message.stopReason !== "stop") continue;
		if (!Array.isArray(e.message.content)) continue;
		const text = e.message.content
			.map((b) => {
				const block = b as { type?: unknown; text?: unknown };
				return block.type === "text" && typeof block.text === "string" ? block.text : "";
			})
			.join("");
		if (text.trim() !== "") last = text;
	}
	return last;
}

/** Hangul jamo, compatibility jamo or syllables anywhere — the take's English-only line is "none of these". */
export function hasHangul(text: string): boolean {
	return /[ᄀ-ᇿ㄰-㆏가-힯]/.test(text);
}
