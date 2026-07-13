#!/usr/bin/env node
/**
 * entwurf-agy-imprint — Antigravity PreInvocation birth hook.
 *
 * Reads agy's camelCase PreInvocation payload from stdin, idempotently upserts an
 * antigravity meta-session by conversationId, writes the sender marker that lets the
 * entwurf-bridge MCP child name this conversation as the caller, and ALWAYS prints exactly
 * the PreInvocation neutral response so the agy loop keeps running.
 *
 * Still deliberately thin: no transcript hydration, no cwd guessing from process.cwd(), and
 * NO receiver marker — that is a mailbox atom, and agy is a native-push citizen with no
 * mailbox (보정①). The record body is the authority; the sender marker is only a pid→garden
 * hint the bridge re-validates against it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	parentPid,
	processStartKey,
	upsertMetaSession,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";

const NEUTRAL_RESPONSE = '{"injectSteps":[]}';

type Payload = {
	conversationId?: unknown;
	workspacePaths?: unknown;
	transcriptPath?: unknown;
	modelName?: unknown;
};

function logPath(): string {
	const root = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
	return path.join(root, "entwurf", "agy-imprint.log");
}

function logLine(message: string): void {
	try {
		const file = logPath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, { encoding: "utf8", mode: 0o600 });
	} catch {
		// Logging is best-effort; never break agy's PreInvocation loop.
	}
}

/**
 * OPT-IN owner-topology trace (`ENTWURF_AGY_TRACE_OWNER=1`).
 *
 * The whole sender lane rests on one measured fact: this hook's parent IS the process that also
 * parents the MCP child (both are the agy host). When a send from a birthed agy still arrives
 * anonymous, this trace is the only thing that can say WHY — a plugin host in between, a per-turn
 * worker, a shell wrapper. Compare it with the live bridge's own ancestry (`/proc/<pid>/stat`).
 *
 * OFF by default, and it must stay off: PreInvocation runs before EVERY model turn, so leaving it
 * on would append a line and walk /proc six times per turn, forever — an unbounded trace in a log
 * whose job is to hold birth evidence. The normal log already records the marker write (pid → gid),
 * which is what a healthy host needs.
 */
function comm(pid: number): string {
	try {
		return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() || "?";
	} catch {
		return "?";
	}
}

function ancestry(startPid: number, depth = 6): string {
	const steps: string[] = [];
	let pid: number | null = startPid;
	for (let i = 0; i < depth && typeof pid === "number" && pid > 1; i++) {
		steps.push(`${pid}:${comm(pid)}:${processStartKey(pid) || "-"}`);
		pid = parentPid(pid);
	}
	return steps.join(" < ");
}

function traceOwnerTopology(conversationId: string): void {
	if (process.env.ENTWURF_AGY_TRACE_OWNER !== "1") return;
	logLine(
		`pids conversationId=${conversationId} hookPid=${process.pid} ppid=${process.ppid} chain=${ancestry(process.pid)}`,
	);
}

function readStdin(): string {
	try {
		return fs.readFileSync(0, "utf8");
	} catch (err) {
		logLine(`read-stdin-failed ${err instanceof Error ? err.message : String(err)}`);
		return "";
	}
}

function firstWorkspace(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	const first = value[0];
	return typeof first === "string" && first.trim() ? first : null;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function imprint(raw: string): void {
	let payload: Payload;
	try {
		const parsed = JSON.parse(raw || "{}");
		payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Payload) : {};
	} catch (err) {
		logLine(`skip invalid-json ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	const conversationId = optionalString(payload.conversationId);
	if (!conversationId) {
		logLine("skip missing-conversationId");
		return;
	}

	const cwd = firstWorkspace(payload.workspacePaths);
	if (!cwd) {
		logLine(`skip missing-workspacePaths conversationId=${conversationId}`);
		return;
	}

	traceOwnerTopology(conversationId);

	try {
		const result = upsertMetaSession({
			input: {
				backend: "antigravity",
				nativeSessionId: conversationId,
				cwd,
				model: optionalString(payload.modelName),
				transcriptPath: optionalString(payload.transcriptPath),
			},
		});
		logLine(`ok ${result.action} gardenId=${result.record.gardenId} conversationId=${conversationId} cwd=${cwd}`);

		// Sender marker — what lets the entwurf-bridge MCP child name WHO is calling it. The
		// bridge and this hook are both children of the same agy process (measured: hook.ppid ==
		// bridge.ppid == the `agy` pid, identical start-key), so that pid is the join key; the
		// bridge looks a marker up under its own parent, finds this one, and the send goes out as
		// a replyable garden citizen instead of anonymous external-mcp.
		//
		// The marker binds the pid to the conversation it is CURRENTLY invoking — not to one
		// conversation forever. PreInvocation runs synchronously before every model turn, so a
		// `/new` (same pid, new conversationId) rebinds the marker before that conversation can
		// make its first tool call. Overwriting is a binding refresh, not an identity mutation:
		// both conversations keep their meta-records.
		//
		// THE LIMIT, stated plainly: one pid has exactly ONE marker file per backend
		// (`<senders>/antigravity/<pid>.json`). Two conversations invoking CONCURRENTLY under one
		// agy process would therefore NOT leave two markers for the bridge to refuse — the second
		// hook write silently overwrites the first, and a tool call still in flight from the first
		// would be attributed to the second. Nothing downstream can detect that. So this binding
		// rests on a runtime invariant: an agy process serializes its model invocations (its hook
		// runs synchronously before each turn). Same-process concurrency is NOT supported, and
		// there is no fail-closed guard for it — if agy ever gains it, the pid stops identifying
		// the caller and the join key must change.
		//
		// Written only after the upsert above: the record store is the identity authority, and a
		// marker pointing at a garden-id with no record would be a window of un-backed identity.
		// A failed marker costs reply-addressability, never the session — log and move on.
		const ownerPid = process.ppid;
		if (typeof ownerPid === "number" && ownerPid > 0) {
			try {
				writeMetaSenderMarker({
					backend: "antigravity",
					gardenId: result.record.gardenId,
					nativeSessionId: conversationId,
					cwd,
					ownerPid,
				});
				logLine(`sender marker ${ownerPid} -> ${result.record.gardenId} conversationId=${conversationId}`);
			} catch (err) {
				logLine(
					`sender-marker-failed pid=${ownerPid} gardenId=${result.record.gardenId} ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	} catch (err) {
		logLine(
			`upsert-failed conversationId=${conversationId} ${err instanceof Error ? err.stack || err.message : String(err)}`,
		);
	}
}

imprint(readStdin());
process.stdout.write(`${NEUTRAL_RESPONSE}\n`);
