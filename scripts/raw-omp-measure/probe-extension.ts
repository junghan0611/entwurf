/**
 * raw-omp-measure probe — OMP v18.0.0 vendor measurement for issue #87.
 *
 * Loaded into a live omp process via `omp -e <this file>`. Logs one JSONL line
 * per extension lifecycle event so the host-vs-subagent discriminator
 * (`mode === "tui"` vs `"print"` + `hasUI:false`, adding-a-harness.md §3.5)
 * and the in-process envelope (pid/ppid) get LIVE receipts from the vendor's
 * own event bus. Measurement only — mints nothing, sends nothing.
 *
 * Log path: $OMP_PROBE_LOG (default /tmp/omp-probe.jsonl), append-only JSONL.
 */
import { appendFileSync } from "node:fs";

const LOG = process.env.OMP_PROBE_LOG ?? "/tmp/omp-probe.jsonl";

function log(obj: Record<string, unknown>): void {
	try {
		appendFileSync(LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);
	} catch {
		// measurement probe: never take the host down
	}
}

export default function probe(pi: any): void {
	const snap = (event: string, ctx: any, extra?: Record<string, unknown>) => {
		// v18 ReadonlySessionManager (session-manager.ts:359-376): getSessionId / getSessionFile / getSessionDir.
		// There is no getId().
		let sessionFile: unknown;
		let sessionId: unknown;
		let sessionDir: unknown;
		try {
			sessionFile = ctx?.sessionManager?.getSessionFile?.();
		} catch {}
		try {
			sessionId = ctx?.sessionManager?.getSessionId?.();
		} catch {}
		try {
			sessionDir = ctx?.sessionManager?.getSessionDir?.();
		} catch {}
		log({
			event,
			pid: process.pid,
			ppid: process.ppid,
			mode: ctx?.mode,
			hasUI: ctx?.hasUI,
			cwd: ctx?.cwd,
			sessionFile,
			sessionId,
			sessionDir,
			...extra,
		});
	};

	const dumpEntwurfTools = (label: string, ctx: any) => {
		try {
			const all = (pi.getAllTools?.() ?? []) as Array<{ name?: string }>;
			const entwurf = all.map((t) => t?.name).filter((n) => typeof n === "string" && n.includes("entwurf"));
			log({ event: label, pid: process.pid, mode: ctx?.mode, toolCount: all.length, entwurfTools: entwurf });
		} catch (err) {
			log({ event: `${label}_error`, error: String(err) });
		}
	};

	pi.on("session_start", (_e: any, ctx: any) => {
		snap("session_start", ctx);
		// MCP stdio children (imported config included) connect asynchronously;
		// dump twice so a slow bridge start still lands in the receipt.
		try {
			ctx.setTimeout?.(() => dumpEntwurfTools("tool_dump_t10", ctx), 10_000);
			ctx.setTimeout?.(() => dumpEntwurfTools("tool_dump_t25", ctx), 25_000);
		} catch {}
	});
	pi.on("agent_start", (_e: any, ctx: any) => snap("agent_start", ctx));
	pi.on("turn_start", (_e: any, ctx: any) => snap("turn_start", ctx));
	pi.on("session_shutdown", (_e: any, ctx: any) => snap("session_shutdown", ctx));
}
