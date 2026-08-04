/**
 * mux-placement — where a new sibling runtime is OPENED, and nothing else.
 *
 * The operating contract (2026-08-04, GLG): a caller that asks entwurf to open a new
 * runtime is ALWAYS inside tmux. Outside tmux there is no fallback session, no
 * `new-session`, no guess — the request is refused. The window is appended to exactly the
 * server/session the caller's own inherited `TMUX`/`TMUX_PANE` names, because that is the
 * session the operator is looking at. Inheriting the environment IS the addressing: this
 * module never takes a socket path or a session name from a caller.
 *
 * Three actions, deliberately not four:
 *
 *   inspectPlacement()   the caller's own $session/@window/%pane, or a named refusal
 *   appendWindow()       one default-shell window at the end of that same session
 *   closeWindow()        that window, by stable id, in the context it was opened in
 *
 * What this module is NOT: a delivery transport, an address, a liveness fact, a launcher.
 * It opens a place. `entwurf_v2` still owns delivery (`V2-DELIVERY-EXCLUDES-MUX`), and
 * nothing here mints a garden id.
 *
 * Beside those three actions, `runTmux` and `requireSameContext` are exported as a NARROW
 * INTERNAL SEAM for the T1-a launch composition to build on — not a fourth action and not a
 * public operator surface. Say the risk plainly: `runTmux` takes argv this module did not
 * author, so boundary 2 below does not protect it. The grammar is enforced by the `build*Args`
 * builders, and anything reaching for `runTmux` owes its own argv the same validation. Today
 * its one production consumer is the launch composition (`docs/mux-launch-rail.md` §11); the
 * shipped delivery path calls neither.
 *
 * ── Four boundaries, each of which was a real way to touch the wrong thing ──
 *
 * 1. CONTEXT. Both `TMUX` and `TMUX_PANE` must be present and non-empty before anything
 *    runs. `TMUX_PANE` alone is not enough: tmux invoked without `TMUX` in the environment
 *    resolves to the DEFAULT server, so a caller carrying a stale pane id from a dead
 *    server would have mutated the operator's live one. `TMUX` is checked for presence
 *    only — never parsed. The socket and session inside that string are tmux's to report,
 *    not ours to extract.
 *
 * 2. GRAMMAR. Every selector handed to `-t` is a native id and is validated against its
 *    grammar BEFORE tmux is invoked. T0-a measured that tmux's own parser reinterprets
 *    values (a trailing `;` can split a command; `#{…}`/`#(…)` expand), so "we used argv,
 *    not a shell" is not by itself a safety argument. `%12`, `$3`, `@7` and decimal
 *    pids/indices are the entire accepted vocabulary; anything else is refused unrun.
 *
 * 3. FAILURE. `display-message` returning rc=0 is not proof that a pane exists — it answers
 *    rc=0 for a nonexistent target (filling only the SERVER fields) and rc=0 for an EMPTY
 *    target while silently describing the current pane. That is why the echo-back exists.
 *    But the converse does not follow: a NONZERO exit (no server, EACCES, a usage error) is
 *    an operational failure and is raised, never laundered into "the anchor did not
 *    resolve". Only an rc=0 row is ever parsed.
 *
 * 4. BINDING. A `Placement` is a fact about one server and one session, and the environment
 *    passed to a later call could name a different — or restarted — server where the same
 *    `$3`/`@7` mean something else entirely. Every mutation re-reads the caller's placement
 *    and refuses unless the server pid and session id still match the ones the handle was
 *    born in.
 *
 * The machine-readable rows carry ONLY native ids and decimal numbers, joined by `|`. The
 * free-form fields tmux could also report (`socket_path`, `session_name`) are deliberately
 * absent: a session legitimately named `a|b` would otherwise split the row. A display name
 * is a later, separate concern, and nothing here needs one.
 *
 * ── Two more facts measured in T0-a (private tmux 3.6a) ──
 *
 * `renumber-windows on` (GLG's shipped setting) renumbers surviving windows when one in the
 * middle disappears, so the human index is a keybinding affordance and never a handle.
 * `remain-on-exit off` (the default) destroys a window when its pane process ends, so a
 * window can vanish through a path this module never called; see `CloseOutcome`.
 */

import { spawnSync } from "node:child_process";

// ── Native id grammar (boundary 2) ─────────────────────────────────────────

const PANE_ID = /^%[0-9]+$/;
const SESSION_ID = /^\$[0-9]+$/;
const WINDOW_ID = /^@[0-9]+$/;
const DECIMAL = /^[0-9]+$/;

/** True only for tmux's own native pane id. */
export function isPaneId(value: string): boolean {
	return PANE_ID.test(value);
}

/** True only for tmux's own native session id. */
export function isSessionId(value: string): boolean {
	return SESSION_ID.test(value);
}

/** True only for tmux's own native window id. */
export function isWindowId(value: string): boolean {
	return WINDOW_ID.test(value);
}

/** True only for a bare decimal (pids, window indices). */
export function isDecimal(value: string): boolean {
	return DECIMAL.test(value);
}

/**
 * Refuse a selector before it reaches tmux. The throw is deliberate and unconditional: a
 * selector that is not a native id is either a bug or an injection attempt, and neither is
 * something to route into tmux's parser to find out.
 */
export function assertSelector(kind: "pane" | "session" | "window", value: string): void {
	const okShape = kind === "pane" ? isPaneId(value) : kind === "session" ? isSessionId(value) : isWindowId(value);
	if (!okShape) {
		throw new Error(`mux-placement: refusing a non-native ${kind} selector ${JSON.stringify(value)}`);
	}
}

// ── Facts ──────────────────────────────────────────────────────────────────

/**
 * The caller's own coordinates. Native ids and decimals only — see the delimiter note in the
 * module header for why `socket_path`/`session_name` are not here.
 */
export interface Placement {
	serverPid: string;
	sessionId: string;
	windowId: string;
	windowIndex: string;
	paneId: string;
	panePid: string;
}

/**
 * A window this module opened, carrying the context it was born in. `serverPid`/`sessionId`
 * are what let a later close prove it is acting on the same server and session rather than a
 * restarted one that happens to reuse the id. Index is reported for the human, never used as
 * a handle.
 */
export interface WindowHandle {
	serverPid: string;
	sessionId: string;
	windowId: string;
	windowIndex: string;
	paneId: string;
	panePid: string;
}

/**
 * Why a placement could not be established. Each one is a refusal, never a fallback:
 *   - `no-tmux-context`   `TMUX` and/or `TMUX_PANE` missing or empty — not inside tmux
 *   - `anchor-malformed`  `TMUX_PANE` is present but is not a native `%N` pane id
 *   - `anchor-unresolved` tmux resolved no pane for that anchor
 *   - `anchor-mismatch`   tmux answered about a DIFFERENT pane than the one asked about
 */
export type PlacementRejectReason = "no-tmux-context" | "anchor-malformed" | "anchor-unresolved" | "anchor-mismatch";

export type InspectResult = { ok: true; placement: Placement } | { ok: false; reason: PlacementRejectReason };

/**
 * What a close actually did.
 *
 * `already-gone` is NOT a blanket "any error is fine". It is issued only when the window is
 * verifiably absent from a fresh `list-windows` — positive proof of absence, the same
 * discipline socket-probe.ts applies to liveness. Any other failure throws, because the
 * failure we must never swallow is "the window is still there and we did not close it".
 *
 * Why report it at all instead of returning void: `remain-on-exit off` makes disappearance a
 * normal race, not an error, so failing loud on it would be wrong; but a caller that asked to
 * close a window and got silence cannot tell whether its runtime exited on its own. Both
 * readings matter later (T1 will want to know whether a launched runtime died before we tore
 * it down), so the outcome is evidence, not a swallowed exception.
 */
export type CloseOutcome = "closed" | "already-gone";

// ── Pure argv / parsing (the half a deterministic gate can pin) ─────────────

/** Field order of `INSPECT_FORMAT`. Parsing and formatting share this list. */
export const PLACEMENT_FIELDS = ["pid", "session_id", "window_id", "window_index", "pane_id", "pane_pid"] as const;

const SEP = "|";

/** tmux format string for a placement query — tmux's own facts, never string surgery on `$TMUX`. */
export const INSPECT_FORMAT = PLACEMENT_FIELDS.map((f) => `#{${f}}`).join(SEP);

/** Field order of `APPEND_FORMAT` — what `new-window -P -F` prints for the window it created. */
export const WINDOW_FIELDS = ["window_id", "window_index", "pane_id", "pane_pid"] as const;

export const APPEND_FORMAT = WINDOW_FIELDS.map((f) => `#{${f}}`).join(SEP);

/**
 * Read the caller's anchor. BOTH `TMUX` and `TMUX_PANE` must be present and non-empty:
 * `TMUX_PANE` names which pane, `TMUX` is what makes a bare `tmux` resolve to the caller's
 * server instead of the default one. `TMUX` is checked for presence only — parsing the
 * socket/session out of it is the guess this rail forbids.
 */
export function readAnchor(
	env: NodeJS.ProcessEnv,
): { ok: true; anchor: string } | { ok: false; reason: "no-tmux-context" | "anchor-malformed" } {
	const server = env.TMUX;
	const anchor = env.TMUX_PANE;
	if (typeof server !== "string" || server.length === 0) return { ok: false, reason: "no-tmux-context" };
	if (typeof anchor !== "string" || anchor.length === 0) return { ok: false, reason: "no-tmux-context" };
	if (!isPaneId(anchor)) return { ok: false, reason: "anchor-malformed" };
	return { ok: true, anchor };
}

export function buildInspectArgs(anchor: string): string[] {
	assertSelector("pane", anchor);
	return ["display-message", "-p", "-t", anchor, INSPECT_FORMAT];
}

/**
 * Append at the END of the caller's own session. `{end}` is the append semantics we want
 * literally; the lowest-free-index behaviour of a bare `new-window` is a different verb and
 * is not this contract. Targeting by `session_id` (`$0`) rather than name keeps a renamed or
 * duplicate-named session from redirecting the append.
 *
 * `-d` keeps the caller's focus. No `-n`, no `-c`, no shell-command: default shell only.
 */
export function buildAppendArgs(sessionId: string): string[] {
	assertSelector("session", sessionId);
	return ["new-window", "-d", "-a", "-t", `${sessionId}:{end}`, "-P", "-F", APPEND_FORMAT];
}

export function buildCloseArgs(windowId: string): string[] {
	assertSelector("window", windowId);
	return ["kill-window", "-t", windowId];
}

/** Every window on the server, for the positive absence proof an `already-gone` needs. */
export function buildListWindowIdsArgs(): string[] {
	return ["list-windows", "-a", "-F", "#{window_id}"];
}

/**
 * Turn an rc=0 placement row into facts — with the echo-back check that tmux's exit status
 * cannot provide, and a grammar check on every field. A nonexistent target still fills the
 * server fields and leaves the rest empty, so "the row was non-empty" proves nothing; an
 * empty pane id means no pane resolved at all, which is unresolved rather than an answer
 * about some other pane.
 */
export function parsePlacement(anchor: string, stdout: string): InspectResult {
	const line = stdout.split("\n", 1)[0]?.trim() ?? "";
	if (line.length === 0) return { ok: false, reason: "anchor-unresolved" };
	const parts = line.split(SEP);
	if (parts.length !== PLACEMENT_FIELDS.length) return { ok: false, reason: "anchor-unresolved" };
	const [serverPid, sessionId, windowId, windowIndex, paneId, panePid] = parts as string[];
	if (paneId.length === 0) return { ok: false, reason: "anchor-unresolved" };
	if (paneId !== anchor) return { ok: false, reason: "anchor-mismatch" };
	const wellFormed =
		isDecimal(serverPid) &&
		isSessionId(sessionId) &&
		isWindowId(windowId) &&
		isDecimal(windowIndex) &&
		isPaneId(paneId) &&
		isDecimal(panePid);
	if (!wellFormed) return { ok: false, reason: "anchor-unresolved" };
	return { ok: true, placement: { serverPid, sessionId, windowId, windowIndex, paneId, panePid } };
}

export function parseWindowFields(stdout: string): {
	windowId: string;
	windowIndex: string;
	paneId: string;
	panePid: string;
} {
	const line = stdout.split("\n", 1)[0]?.trim() ?? "";
	const parts = line.split(SEP);
	if (line.length === 0 || parts.length !== WINDOW_FIELDS.length) {
		throw new Error(`mux-placement: new-window did not report a window handle (got ${JSON.stringify(line)})`);
	}
	const [windowId, windowIndex, paneId, panePid] = parts as string[];
	if (!isWindowId(windowId) || !isDecimal(windowIndex) || !isPaneId(paneId) || !isDecimal(panePid)) {
		throw new Error(`mux-placement: new-window reported a non-native handle (got ${JSON.stringify(line)})`);
	}
	return { windowId, windowIndex, paneId, panePid };
}

/**
 * Classify a FAILED `kill-window` against a fresh window inventory. Absent → `already-gone`
 * (positive proof). Present → `null`, and the caller must fail loud: the window is still
 * there and we did not close it.
 */
export function classifyCloseFailure(windowId: string, listStdout: string): CloseOutcome | null {
	const ids = listStdout
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	return ids.includes(windowId) ? null : "already-gone";
}

// ── The three actions ──────────────────────────────────────────────────────

export interface TmuxRun {
	status: number | null;
	stdout: string;
	stderr: string;
}

/**
 * An rc=0 run is the ONLY kind whose stdout may be parsed. A nonzero status (no server,
 * EACCES, a usage error) or a null status (killed by a signal) is an operational failure of
 * the tmux call itself — laundering it into "the anchor did not resolve" would report a
 * missing pane when the truth is that tmux never answered.
 */
export function assertTmuxOk(label: string, run: TmuxRun): void {
	if (run.status === 0) return;
	const how = run.status === null ? "terminated by signal" : `exit ${run.status}`;
	throw new Error(`mux-placement: tmux ${label} failed (${how})${run.stderr.trim() ? `: ${run.stderr.trim()}` : ""}`);
}

/**
 * Run tmux with the caller's environment INHERITED. No `-S`, no `-L`: the server is whichever
 * one `TMUX` already names, which is the only server this module is allowed to touch — and
 * `readAnchor` has already refused an environment where `TMUX` is absent, which is what would
 * otherwise silently resolve to the default server.
 */
export function runTmux(args: readonly string[], env: NodeJS.ProcessEnv): TmuxRun {
	const res = spawnSync("tmux", args as string[], { env, encoding: "utf8" });
	if (res.error) throw res.error;
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** The caller's own placement, or a named refusal. Never guesses, never creates a session. */
export function inspectPlacement(env: NodeJS.ProcessEnv = process.env): InspectResult {
	const anchor = readAnchor(env);
	if (!anchor.ok) return anchor;
	const run = runTmux(buildInspectArgs(anchor.anchor), env);
	assertTmuxOk("display-message", run);
	return parsePlacement(anchor.anchor, run.stdout);
}

/** The context a handle or placement belongs to. BOTH halves identify it. */
export interface PlacementContext {
	serverPid: string;
	sessionId: string;
}

/**
 * Same server AND same session. Either half alone is insufficient: a restarted tmux server
 * hands out `$0` again, and one server holds many sessions — so matching only the session id
 * would accept a different server, and matching only the server pid would accept a different
 * session on the right one.
 */
export function isSameContext(origin: PlacementContext, now: PlacementContext): boolean {
	return origin.serverPid === now.serverPid && origin.sessionId === now.sessionId;
}

/**
 * Re-read the caller's placement and refuse unless it is still the server and session the
 * handle/placement was born in. Called before every mutation: `$3` on a restarted server is
 * a different session, and an env naming another server would otherwise redirect the whole
 * operation somewhere the caller never looked.
 */
export function requireSameContext(label: string, origin: PlacementContext, env: NodeJS.ProcessEnv): void {
	const now = inspectPlacement(env);
	if (!now.ok) {
		throw new Error(`mux-placement: ${label} refused — the caller's placement is not resolvable (${now.reason})`);
	}
	if (!isSameContext(origin, now.placement)) {
		throw new Error(
			`mux-placement: ${label} refused — context changed (expected server ${origin.serverPid} session ${origin.sessionId}, ` +
				`now server ${now.placement.serverPid} session ${now.placement.sessionId})`,
		);
	}
}

/** One detached default-shell window at the end of the caller's own session. */
export function appendWindow(placement: Placement, env: NodeJS.ProcessEnv = process.env): WindowHandle {
	requireSameContext("appendWindow", placement, env);
	const run = runTmux(buildAppendArgs(placement.sessionId), env);
	assertTmuxOk("new-window", run);
	return { serverPid: placement.serverPid, sessionId: placement.sessionId, ...parseWindowFields(run.stdout) };
}

/**
 * Close one window by stable id, in the context it was opened in. Reports whether it was
 * closed or had already gone.
 */
export function closeWindow(handle: WindowHandle, env: NodeJS.ProcessEnv = process.env): CloseOutcome {
	requireSameContext("closeWindow", handle, env);
	const run = runTmux(buildCloseArgs(handle.windowId), env);
	if (run.status === 0) return "closed";
	// A signal kill is not a "tmux said no" — it is the call failing, and it carries no
	// information about the window at all.
	if (run.status === null) assertTmuxOk("kill-window", run);
	const list = runTmux(buildListWindowIdsArgs(), env);
	assertTmuxOk("list-windows", list);
	const verdict = classifyCloseFailure(handle.windowId, list.stdout);
	if (verdict) return verdict;
	throw new Error(
		`mux-placement: kill-window ${handle.windowId} failed (exit ${run.status}) and the window is still listed: ${run.stderr.trim()}`,
	);
}
