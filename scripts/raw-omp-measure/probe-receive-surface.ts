/**
 * raw-omp-measure probe #2 — the STEP 7 (receive) surface, for #87 bundle B.
 *
 * Loaded into a live omp process via `omp -e <this file>`. It answers the five
 * D5 cells the bundle B design is blocked on, and it does so WITHOUT the vendor
 * source checkout (which is not on this host):
 *
 *   (a) where `sendUserMessage` / `sendMessage` actually live — the factory `pi`
 *       object or the event `ctx`. (`setStatus` turned out to be on `ctx.ui`, not
 *       on `pi`, so this is a measured question, not an obvious one.)
 *   (b) whether calling it while IDLE really starts a turn. Gated behind
 *       OMP_PROBE_SEND=1 because that costs a real model turn.
 *   (c) whether `ctx.setInterval` exists and keeps firing while the session is
 *       idle — the mechanism S1 (bounded arm retry) would stand on.
 *   (d) whether a SECOND extension in the same process gets its own working API.
 *       The installed `entwurf-meta-omp` birth unit is the first extension; this
 *       probe is the second, so the run itself is the experiment.
 *   (e) the ORDER datum that decides S1 vs S2: at the moment THIS extension's
 *       `session_start` handler runs, has the birth unit already written its
 *       sender marker? Measured by looking for the marker file directly, then
 *       re-checked on a schedule so "not yet" and "never" stay distinguishable.
 *
 * MEASUREMENT ONLY. It mints nothing, writes no garden artifact, sends no
 * entwurf message, and never throws into the host.
 *
 * Log path: $OMP_PROBE_LOG (default /tmp/omp-receive-probe.jsonl), append-only JSONL.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOG = process.env.OMP_PROBE_LOG ?? "/tmp/omp-receive-probe.jsonl";
const SEND = process.env.OMP_PROBE_SEND === "1";
const NONCE = process.env.OMP_PROBE_NONCE ?? "no-nonce";

function log(obj: Record<string, unknown>): void {
	try {
		appendFileSync(LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);
	} catch {
		// measurement probe: never take the host down
	}
}

/** The omp four-root base, spelled literally rather than imported: a probe must not
 * depend on the product's own resolver, or it would be testing our copy of the answer. */
function senderMarkerPath(pid: number): string {
	const home = process.env.HOME && process.env.HOME.length > 0 ? process.env.HOME : os.homedir();
	const dir = process.env.ENTWURF_META_SENDERS_DIR;
	const base = dir && dir.length > 0 ? dir : path.join(home, ".pi", "agent", "meta-senders");
	return path.join(base, "omp", `${pid}.json`);
}

function markerFacts(): Record<string, unknown> {
	const file = senderMarkerPath(process.pid);
	try {
		if (!existsSync(file)) return { markerPresent: false, markerFile: file };
		const raw = JSON.parse(readFileSync(file, "utf8"));
		return {
			markerPresent: true,
			markerFile: file,
			markerGarden: raw?.gardenId,
			markerNative: raw?.nativeSessionId,
			markerOwnerPid: raw?.ownerPid,
		};
	} catch (err) {
		return { markerPresent: "unreadable", markerFile: file, markerError: String(err) };
	}
}

function fnKeys(obj: unknown): string[] {
	if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return [];
	const out = new Set<string>();
	let cur: object | null = obj as object;
	for (let depth = 0; cur && depth < 3; depth++) {
		for (const k of Object.getOwnPropertyNames(cur)) out.add(k);
		cur = Object.getPrototypeOf(cur);
	}
	return [...out].sort();
}

function typeOfPath(root: any, ...segs: string[]): string {
	let cur = root;
	for (const s of segs) {
		if (cur == null) return "absent";
		cur = cur[s];
	}
	return typeof cur;
}

export default function probeReceiveSurface(pi: any): void {
	// (a)+(d) the factory surface, before any event.
	log({
		event: "factory",
		pid: process.pid,
		ppid: process.ppid,
		piKeys: fnKeys(pi),
		"typeof pi.sendUserMessage": typeOfPath(pi, "sendUserMessage"),
		"typeof pi.sendMessage": typeOfPath(pi, "sendMessage"),
		"typeof pi.setInterval": typeOfPath(pi, "setInterval"),
		"typeof pi.setTimeout": typeOfPath(pi, "setTimeout"),
		"typeof pi.on": typeOfPath(pi, "on"),
	});

	const snapshot = (event: string, ctx: any, extra?: Record<string, unknown>) => {
		let sessionId: unknown;
		try {
			sessionId = ctx?.sessionManager?.getSessionId?.();
		} catch {}
		log({
			event,
			pid: process.pid,
			mode: ctx?.mode,
			hasUI: ctx?.hasUI,
			cwd: ctx?.cwd,
			sessionId,
			ctxKeys: fnKeys(ctx),
			"typeof ctx.sendUserMessage": typeOfPath(ctx, "sendUserMessage"),
			"typeof ctx.sendMessage": typeOfPath(ctx, "sendMessage"),
			"typeof ctx.setInterval": typeOfPath(ctx, "setInterval"),
			"typeof ctx.setTimeout": typeOfPath(ctx, "setTimeout"),
			"typeof ctx.ui.setStatus": typeOfPath(ctx, "ui", "setStatus"),
			...markerFacts(),
			...extra,
		});
	};

	const onEdge = (edge: string) => (event: any, ctx: any) => {
		const t0 = Date.now();
		snapshot(edge, ctx, { reason: event?.reason, phase: "t0" });

		// (e) THE ORDER DATUM. If the marker is absent at t0 this extension ran BEFORE
		// the birth unit, which is exactly the case a receive unit must survive. The
		// re-checks say whether a bounded defer would have caught it, and how late.
		for (const delayMs of [25, 100, 250, 1000, 3000, 8000]) {
			try {
				ctx.setTimeout?.(() => {
					log({
						event: `${edge}_marker_recheck`,
						pid: process.pid,
						mode: ctx?.mode,
						delayMs,
						elapsedMs: Date.now() - t0,
						...markerFacts(),
					});
				}, delayMs);
			} catch (err) {
				log({ event: `${edge}_recheck_schedule_failed`, delayMs, error: String(err) });
			}
		}

		// (c) does a REPEATING contained timer exist, and does it keep firing while idle?
		// Bounded on purpose: 6 ticks then self-clear, so the probe cannot outlive its point.
		if (typeof ctx?.setInterval === "function") {
			let ticks = 0;
			try {
				// CANCELLATION IS THE WHOLE POINT OF THIS CELL. `[LIVE run1]` there is no
				// `ctx.clearInterval`: calling it through `?.` was a SILENT no-op and the
				// timer ran 58 ticks past its stop condition inside the operator's TUI.
				// The vendor's canceller is `ctx.clearTimer` (ctxKeys, run1). Probe it by
				// NAME and record which name actually stops the timer — a retry loop that
				// cannot be cancelled is not a mechanism a receive unit may stand on.
				const handle = ctx.setInterval(() => {
					ticks++;
					log({
						event: `${edge}_interval_tick`,
						pid: process.pid,
						mode: ctx?.mode,
						tick: ticks,
						elapsedMs: Date.now() - t0,
					});
					if (ticks === 3) {
						const canceller =
							typeof ctx?.clearTimer === "function"
								? "clearTimer"
								: typeof ctx?.clearInterval === "function"
									? "clearInterval"
									: null;
						log({ event: `${edge}_interval_canceller`, pid: process.pid, canceller });
						if (canceller) {
							try {
								ctx[canceller](handle);
								log({ event: `${edge}_interval_clear_called`, pid: process.pid, canceller, ticks });
							} catch (err) {
								log({ event: `${edge}_interval_clear_failed`, canceller, error: String(err) });
							}
						}
					}
					if (ticks === 10) {
						log({ event: `${edge}_interval_STILL_RUNNING_after_clear`, pid: process.pid, ticks });
					}
				}, 500);
				log({ event: `${edge}_interval_armed`, pid: process.pid, handleType: typeof handle });
			} catch (err) {
				log({ event: `${edge}_interval_failed`, error: String(err) });
			}
		} else {
			log({ event: `${edge}_no_setInterval`, pid: process.pid, mode: ctx?.mode });
		}

		// (b) THE COSTED CELL. Only on the visible host, only when explicitly enabled.
		if (SEND && ctx?.mode === "tui") {
			try {
				ctx.setTimeout?.(() => {
					const target =
						typeof pi?.sendUserMessage === "function"
							? { obj: pi, where: "pi" }
							: typeof ctx?.sendUserMessage === "function"
								? { obj: ctx, where: "ctx" }
								: null;
					if (!target) {
						log({ event: "send_probe_absent", pid: process.pid });
						return;
					}
					const body = `PROBE ${NONCE}: reply with exactly the token PROBE-ACK-${NONCE} and nothing else.`;
					try {
						const r = target.obj.sendUserMessage(body, { deliverAs: "user" });
						log({
							event: "send_probe_called",
							pid: process.pid,
							where: target.where,
							elapsedMs: Date.now() - t0,
							returnType: typeof r,
							thenable: typeof r?.then === "function",
						});
						if (r && typeof r.then === "function") {
							r.then(
								(v: unknown) => log({ event: "send_probe_resolved", value: String(v) }),
								(e: unknown) => log({ event: "send_probe_rejected", error: String(e) }),
							);
						}
					} catch (err) {
						log({ event: "send_probe_threw", where: target.where, error: String(err) });
					}
				}, 12_000);
			} catch (err) {
				log({ event: "send_probe_schedule_failed", error: String(err) });
			}
		}
	};

	pi.on("session_start", onEdge("session_start"));
	pi.on("session_switch", onEdge("session_switch"));
	// Turn edges: they say whether (b) actually produced a model turn, and they are the
	// edges a Copilot-style retry would have used — measured so the "retry is not enough"
	// claim keeps a receipt of its own.
	pi.on("agent_start", (_e: any, ctx: any) => snapshot("agent_start", ctx));
	pi.on("turn_start", (_e: any, ctx: any) => snapshot("turn_start", ctx));
	pi.on("turn_end", (_e: any, ctx: any) => snapshot("turn_end", ctx));
	pi.on("session_shutdown", (_e: any, ctx: any) => snapshot("session_shutdown", ctx));
}
