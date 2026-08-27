/**
 * meta-bridge-omp — the OMP (oh-my-pi) native-session BIRTH entry (#87).
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 *
 * It mints the visible host session, then names the minted citizen as this host's SENDER:
 *
 *   session_start | session_switch   (omp in-process extension events)
 *     -> mode === "tui" ?            the §3.5 discriminator — the ONE new predicate in this lane
 *        -> upsertMetaSession(omp)   idempotent create/attach the record
 *           -> gardenId              the session's garden address
 *        -> writeMetaSenderMarker(process.pid)   who-sent join for this host's MCP children
 *        -> ctx.ui.setStatus(...)    visible identity (step 4)
 *     -> any other mode              REFUSE + log. A task subagent is not a citizen.
 *
 * No receiver marker, no mailbox arm — omp's receive rail is a separate admission (#87
 * bundle B). A receiver marker is a claim that a LIVE process holds a watch; nothing
 * installed by this unit holds one, and minting it here would make a citizen read
 * deliverable while wired to nothing.
 *
 * WHY THIS FILE IS AN EXTENSION FACTORY AND NOT AN EXEC'd PAYLOAD. `[source]` omp
 * "hooks" are an in-process EXTENSION event bus — `--hook` is an alias of `--extension`,
 * a module default-exporting `(pi: ExtensionAPI) => void`, and handlers receive
 * `(event, ctx)` (oh-my-pi v18.0.0 `docs/hooks.md` "Current status in runtime";
 * `packages/coding-agent/src/extensibility/extensions/types.ts:1186`, `:1592`). There is
 * no stdin envelope and no per-event child process, so the Claude/Copilot launcher pair
 * (`hook-launch.sh` + `exec`) has nothing to do here: this code already runs INSIDE the
 * omp process. That is also what makes the step-6 join a ONE-process join — see
 * resolveOmpOwnerPid below.
 *
 * THE SCOPE FENCE IS `mode === "tui"`, AND IT IS LOAD-BEARING. `[source]` Every task
 * subagent re-emits its own `session_start` (`task/executor.ts:3305`) against a fresh
 * per-session extension API (`sdk.ts:2000-2028`), and bundled agents do NOT set
 * `restrictToolNames`, so this very factory is re-executed inside subagents by default.
 * Same OS pid therefore does not prevent minting — only the mode does. Only the
 * interactive TUI controller passes `"tui"` (`modes/controllers/extension-ui-controller.ts:302`;
 * `:531` is test-only), the runner default is `"print"` (`runner.ts:438`, `:651`), and
 * rpc / rpc-ui / `omp acp` all pass `"rpc"`. `ctx.hasUI` is NOT a fence and must never be
 * used as one: rpc, rpc-ui and ACP all hand the runner a real uiContext, so `hasUI` is
 * true there (`runner.ts:879-881`) while the `types.ts:465` comment says otherwise —
 * a live instance of the docs-vs-code trap. `[LIVE 2026-08-27]` host
 * `{mode:"tui",hasUI:true}` vs a real task subagent `{mode:"print",hasUI:false}` on the
 * SAME pid 479624, record store 519 before == 519 after
 * (`scripts/raw-omp-measure/README.md` §3.5).
 *
 * `session_shutdown` IS NOT WIRED, AND THAT IS NOT AN OVERSIGHT. `[LIVE 2026-08-27]` on
 * `/exit` a `session_shutdown` arrived with a `"print"` context BEFORE the tui one, in the
 * same run — shutdown events are not host-scoped. It is not a birth edge, so nothing here
 * listens to it; a future unit must not read it as one either.
 *
 * BOTH BIRTH EDGES, BECAUSE THE NAME DOES NOT TELL YOU WHEN IT FIRES. `[source, audited
 * C1/C2]` The TUI host fires `session_start` once per process, after first paint and
 * before the first prompt (`interactive-mode.ts:1221`, `:1238`,
 * `extension-ui-controller.ts:309-311`) — no model turn required. `/new`, fork and in-TUI
 * resume then re-fire as `session_switch` (reasons `"new"`/`"fork"`/`"resume"`,
 * `agent-session.ts:6910-8074`), NOT as `session_start`. A birth unit wired only to
 * `session_start` would leave every post-`/new` session unminted, still showing the
 * previous citizen's id in the status line. The upsert is idempotent and keyed by the
 * native session id, so the switch edge attaches when the id is unchanged and mints the
 * replacement's own record when it changed — the same rule pi's in-process replacement
 * already follows.
 *
 * FAILURE POLICY, inherited from the Claude and Copilot units: BEST-EFFORT + LOG. Never
 * throw into the operator's TUI, never block a turn. On any error append a level-tagged
 * line to `<pi-agent-dir>/meta-bridge-hook.log` — the same file the other native units
 * append to, tagged `[omp]` so one grep still covers the host and each doctor stays
 * rail-scoped (`scripts/meta-bridge-hook-log.sh`). The fail-loud surface is
 * `./run.sh doctor-omp-bridge`, which reads that log.
 *
 * LAUNCH: the installer places this file as `index.ts` inside
 * `<omp agent dir>/extensions/entwurf-meta-omp/`, which is one of omp's three native
 * discovery rules — a subdirectory whose entry is `index.{ts,js}` (`discovery/builtin.ts:483`
 * → `discovery/helpers.ts:625-712`, preference at `:700-710`). Nothing is baked into this
 * file and nothing declares a path to it: the rule needs only the name.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
	defaultMetaSessionsDir,
	isPlausibleOwnerPid,
	upsertMetaSession,
	writeMetaSenderMarker,
} from "./lib/meta-session.ts";

/**
 * The §3.5 host discriminator. THE one new predicate this whole lane is allowed to
 * introduce, and it is the vendor's own top-level mode — not a heuristic over cwd,
 * process age, pid or session id. If a vendor upgrade flips it, STOP and remeasure
 * (issue #87 stop rule); do not add a second predicate beside it.
 */
const HOST_MODE = "tui";

/** Our own status key, owned exactly. Hook status text is stored per key and sorted by
 * key name (`docs/hooks.md` "Status line behavior"), so this string is the whole extent
 * of our claim on the operator's status line. */
const STATUS_KEY = "entwurf";

/** The backend id this unit mints under. Registered in `META_BACKENDS` (#87 A1). */
const BACKEND = "omp" as const;

// ---------------------------------------------------------------------------
// Vendor surface, typed NARROWLY and locally.
//
// omp is not a dependency of this repo and its types are not published here, so the
// shapes below are hand-written from the measured v18.0.0 source rather than imported.
// They are deliberately the SMALLEST subset this unit touches: a wider mirror would rot
// silently at the next vendor release, and every field named here has a receipt.
// ---------------------------------------------------------------------------

/** `ReadonlySessionManager` — `session-manager.ts:359-376` (`getSessionId` `:1946-1948`,
 * `getSessionFile` `:1950-1952` returns `string | undefined` because persistence is lazy,
 * `getCwd`). */
interface OmpReadonlySessionManager {
	getSessionId(): unknown;
	getSessionFile(): unknown;
	getCwd(): unknown;
}

/** `ExtensionUIContext.setStatus` — `types.ts:285`, called as `ctx.ui.setStatus(key, text)`
 * (`docs/hooks.md` "Status line behavior"). It is the ONLY rendering surface at v18:
 * `setFooter`/`setHeader` are literal TUI no-ops (`extension-ui-controller.ts:139`) and the
 * built-in statusLine segment set is a closed enum with no custom/command segment
 * (`status-line/segments.ts:731-757`). */
interface OmpExtensionUiContext {
	setStatus(key: string, text: string | undefined): void;
}

/** `ExtensionContext` — `types.ts:455-480`. `mode` is `"tui" | "rpc" | "json" | "print"`. */
interface OmpExtensionContext {
	mode: unknown;
	cwd: unknown;
	ui?: Partial<OmpExtensionUiContext>;
	sessionManager?: OmpReadonlySessionManager;
}

/** The two birth edges. `SessionSwitchEvent` carries `reason` (`shared-events.ts:42-49`);
 * `SessionStartEvent` carries nothing but its type (`:28-31`). */
interface OmpSessionEvent {
	type?: unknown;
	reason?: unknown;
}

/** `ExtensionAPI.on` for the two events this unit binds (`types.ts:1223`, `:1228`). */
interface OmpExtensionApi {
	on(event: string, handler: (event: OmpSessionEvent, ctx: OmpExtensionContext) => void): void;
}

type LogLevel = "INFO" | "WARN" | "ERROR";

/** Append a best-effort diagnostic line; swallow even its own failure. Same log file and
 * same LEVEL vocabulary as the Claude and Copilot units, tagged `[omp]`. */
function logLine(level: LogLevel, message: string): void {
	try {
		const file = path.join(path.dirname(defaultMetaSessionsDir()), "meta-bridge-hook.log");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${level} [omp] ${message}\n`);
	} catch {
		/* logging is best-effort; a broken log must not break the session */
	}
}

/** The two fields birth needs plus the one nullable axis the vendor can supply. */
export interface OmpBirthEnvelope {
	nativeSessionId: string;
	cwd: string;
	/** `getSessionFile()` when the vendor already has a path for it, else null. */
	transcriptPath: string | null;
}

function asNonEmptyString(value: unknown): string {
	return typeof value === "string" && value.length > 0 ? value : "";
}

/**
 * Reduce the vendor context to the fields birth needs, or refuse.
 *
 * REFUSE A DEGRADED ENVELOPE; NEVER GUESS A FIELD (`adding-a-harness.md` step 3(c)). A
 * record minted from a guessed id is a citizen no live session can be joined back to.
 *
 * `cwd` HAS TWO VENDOR SOURCES AND THEY MUST AGREE. `ctx.cwd` (`types.ts:470`) and
 * `ctx.sessionManager.getCwd()` are both vendor-authoritative, so `a ?? b` would silently
 * pick a winner exactly when the disagreement is the interesting fact. Both present and
 * equal is fine, one present is fine, both present and different is a REFUSAL — the same
 * rule the Copilot unit applies to its two envelope shapes. There is deliberately no
 * `process.cwd()` fallback: this process is the omp host, whose cwd may be anything the
 * operator launched it from.
 *
 * `transcriptPath` is nullable at mint by design and is NOT refused when absent:
 * `getSessionFile()` is lazy and may legitimately name nothing yet (`session-manager.ts:1950-1952`).
 * `model` is omitted rather than guessed, exactly as the Copilot unit omits it.
 */
export function readBirthEnvelope(ctx: OmpExtensionContext): OmpBirthEnvelope | { refusal: string } {
	const manager = ctx.sessionManager;
	if (!manager || typeof manager.getSessionId !== "function") {
		return { refusal: "ctx.sessionManager is missing or has no getSessionId()" };
	}
	let rawId: unknown;
	let rawManagerCwd: unknown;
	let rawFile: unknown;
	try {
		rawId = manager.getSessionId();
		rawManagerCwd = typeof manager.getCwd === "function" ? manager.getCwd() : undefined;
		rawFile = typeof manager.getSessionFile === "function" ? manager.getSessionFile() : undefined;
	} catch (err) {
		return { refusal: `ctx.sessionManager threw: ${err instanceof Error ? err.message : String(err)}` };
	}
	const nativeSessionId = asNonEmptyString(rawId);
	if (!nativeSessionId) return { refusal: "sessionManager.getSessionId() is not a non-empty string" };

	const ctxCwd = asNonEmptyString(ctx.cwd);
	const managerCwd = asNonEmptyString(rawManagerCwd);
	if (ctxCwd && managerCwd && ctxCwd !== managerCwd) {
		return { refusal: `ctx.cwd and sessionManager.getCwd() disagree (${ctxCwd} vs ${managerCwd})` };
	}
	const cwd = ctxCwd || managerCwd;
	if (!cwd) return { refusal: "neither ctx.cwd nor sessionManager.getCwd() is a non-empty string" };

	return { nativeSessionId, cwd, transcriptPath: asNonEmptyString(rawFile) || null };
}

/**
 * Which pid does a sender marker written here belong to — or NONE.
 *
 * THE JOIN IS ONE PROCESS, NOT TWO. `[source]` omp spawns its stdio MCP servers from the
 * host process itself; on Linux `detached: true` means setsid only, so the child keeps omp
 * as its parent (`mcp/transports/stdio.ts:41-57`, `:334`). The extension runs in that same
 * host process (there is no launcher to `exec` through), so the pid the bridge child will
 * look its marker up under is OUR OWN `process.pid` — not `process.ppid`, which here is the
 * shell that started omp. `[LIVE 2026-08-27]` `479023 -bash` → `479624 omp` (probe pid ==
 * omp pid) → `479695 node …/entwurf-bridge/src/index.ts` with ppid 479624
 * (`scripts/raw-omp-measure/README.md` M5).
 *
 * THE THREE GUARDS ARE ALL STILL ASKED; ONE OF THEM IS ANSWERED BY A DIFFERENT VENDOR FACT.
 *   0. PLAUSIBLE OWNER — `isPlausibleOwnerPid`, the predicate shared with every marker
 *      writer, reader and the generation cut (#53 A). Asked here, and asked again inside
 *      `writeMetaSenderMarker`.
 *   1. PID + START-KEY LIVENESS — stamped by `writeMetaSenderMarker` itself
 *      (`ownerStartKey`), so a dead session's reused pid cannot inherit its garden id.
 *   2. THE BACKING RECORD — the marker is written INSIDE the successful-upsert branch
 *      below, never before it.
 * The Claude and Copilot units add a fourth, LAUNCH PROVENANCE check
 * (`ENTWURF_META_HOOK_LAUNCH`), because their payload is a separate process that has to
 * prove its parent really is the harness. That question cannot arise here — this code is
 * not a child of the host, it IS the host — and the matching question that CAN arise ("is
 * this omp process the operator-visible session, or a task subagent borrowing my factory?")
 * is answered by the vendor's own `mode === "tui"` before this function is ever reached.
 * That is a substitution of a measured vendor fact for another rail's measured vendor fact,
 * not a dropped guard: if the mode fence is ever removed, this marker writer becomes wrong
 * in the same breath as the mint.
 */
function resolveOmpOwnerPid(): number | null {
	const ownerPid = process.pid;
	if (!isPlausibleOwnerPid(ownerPid)) return null;
	return ownerPid;
}

/**
 * Arm who-sent for this host's MCP children, or say in the log why it could not be.
 *
 * BEST-EFFORT + LOG, like the mint above it. The three outcomes get three distinct tokens
 * because they need three different fixes, and `doctor-omp-bridge` greps them on an axis
 * of their own — a marker failure is NOT a birth failure, and a doctor that judged them on
 * one axis would print "the hook ran and did not mint" about a session whose record is
 * right there (`adding-a-harness.md` step 6, measured on Copilot):
 *
 *   `sender marker <pid> -> <gid>`   armed.
 *   `sender-marker-refused`          we declined to claim an owner. Fail-closed, WARN.
 *   `sender-marker-failed`           the write itself broke. ERROR.
 *
 * Either non-success costs only who-sent: the citizen still exists, still appears in
 * `entwurf_peers`, and can still be addressed BY others. Only its own outbound sends fall
 * back to the bridge's default refusal.
 */
function writeOmpSenderMarker(gardenId: string, envelope: OmpBirthEnvelope): void {
	const ownerPid = resolveOmpOwnerPid();
	if (ownerPid === null) {
		logLine(
			"WARN",
			`sender-marker-refused garden=${gardenId}: this process's own pid ${process.pid} is not a plausible owner; ` +
				"this citizen exists but cannot send",
		);
		return;
	}
	try {
		writeMetaSenderMarker({
			backend: BACKEND,
			gardenId,
			nativeSessionId: envelope.nativeSessionId,
			cwd: envelope.cwd,
			ownerPid,
		});
		logLine("INFO", `sender marker ${ownerPid} -> ${gardenId}`);
	} catch (err) {
		logLine(
			"ERROR",
			`sender-marker-failed pid=${ownerPid} garden=${gardenId}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * Show the garden id on the harness's own persistent visible surface (step 4).
 *
 * `ctx.ui.setStatus` is the ONLY surface that renders extension-owned text on a v18 TUI,
 * and it is gated by `statusLine.showHookStatus`, default true
 * (`settings-schema.ts:952-956`). Failure to render is NOT a birth failure, so this never
 * throws and never blocks the marker or the record; it logs at WARN and the doctor reads
 * that. The rendered string mirrors the agy statusline's shape (`🪛 <garden-id> <rail>`)
 * so an operator with two harnesses open reads one vocabulary.
 */
function showGardenId(ctx: OmpExtensionContext, gardenId: string): void {
	const setStatus = ctx.ui?.setStatus;
	if (typeof setStatus !== "function") {
		logLine("WARN", `status-refused garden=${gardenId}: ctx.ui.setStatus is not available on this context`);
		return;
	}
	try {
		setStatus.call(ctx.ui, STATUS_KEY, `🪛 ${gardenId} omp`);
	} catch (err) {
		logLine("WARN", `status-failed garden=${gardenId}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * One birth edge. `edge` is diagnostic only — mint does not branch on it, because both
 * wired events mean the same thing here (this visible host now owns this session).
 */
export function onBirthEdge(edge: string, ctx: OmpExtensionContext): void {
	if (ctx.mode !== HOST_MODE) {
		// THE DESIGNED ANSWER, NOT A FAULT — INFO, and it must stay cheap. Every task
		// subagent reaches this line (they inherit the extension by default), so this is
		// also the only place the fence leaves a receipt: one line per refused session,
		// naming the mode that was refused.
		logLine("INFO", `scope-refused edge=${edge} mode=${String(ctx.mode)}: not the visible tui host, no record minted`);
		return;
	}

	const envelope = readBirthEnvelope(ctx);
	if ("refusal" in envelope) {
		// ERROR: this session did NOT become a garden citizen. The doctor reads this line.
		logLine("ERROR", `degraded envelope edge=${edge}: ${envelope.refusal}`);
		return;
	}

	try {
		const result = upsertMetaSession({
			input: {
				backend: BACKEND,
				nativeSessionId: envelope.nativeSessionId,
				cwd: envelope.cwd,
				transcriptPath: envelope.transcriptPath,
			},
		});
		logLine(
			"INFO",
			`${result.action} record ${path.basename(result.path)} (edge=${edge}, native=${envelope.nativeSessionId})`,
		);
		// RECORD AUTHORITY FIRST: the marker is only a pid->garden hint the record must
		// vouch for, so both the marker and the visible id are written INSIDE the success
		// branch. A marker minted after a failed upsert would name a garden id with no
		// record behind it, and a status line would advertise the same ghost.
		writeOmpSenderMarker(result.record.gardenId, envelope);
		showGardenId(ctx, result.record.gardenId);
	} catch (err) {
		logLine(
			"ERROR",
			`upsert failed (edge=${edge}, native=${envelope.nativeSessionId}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/**
 * The extension factory omp calls with a per-session API (`types.ts:1592`; re-executed per
 * subagent against a fresh API, `sdk.ts:2000-2028`). Binding is all it does — every
 * decision waits for an event's `ctx`, because the factory itself cannot see the mode.
 */
export default function entwurfMetaOmp(pi: OmpExtensionApi): void {
	pi.on("session_start", (_event, ctx) => onBirthEdge("session_start", ctx));
	pi.on("session_switch", (event, ctx) =>
		onBirthEdge(`session_switch(${asNonEmptyString(event?.reason) || "unlabeled"})`, ctx),
	);
}
