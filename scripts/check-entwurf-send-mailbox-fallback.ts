/**
 * check-entwurf-send-mailbox-fallback — deterministic gate for the pi-native
 * entwurf_send → meta-bridge mailbox fallback (transport 2). Guards the bug where
 * pi-native entwurf_send was control-socket-ONLY: a pi session could not reply to
 * a Claude/Codex/agy garden citizen (no socket of its own), breaking the
 * garden-id "universal address" promise (pi → Claude was ENOENT, no fallback).
 *
 * Proves:
 *   - routing decision: a connect error of ENOENT/ECONNREFUSED ("dead") triggers
 *     the mailbox fallback; ETIMEDOUT/EACCES/undefined ("indeterminate" =
 *     alive-but-stalled) does NOT — surface instead of risking a double delivery.
 *     (classifyConnectError is the SSOT, re-asserted here in the fallback context.)
 *   - the shared body render (formatMetaMailboxBody) advertises a pi-session
 *     sender as replyable at its sessionId; an external sender as non-replyable.
 *   - integration: enqueueing to a no-socket garden citizen writes a `.msg` with
 *     the formatted body and pokes the doorbell signal.
 *   - WIRING GUARD (the regression this gate exists for): pi-native entwurf_send
 *     actually calls the fallback (enqueueMetaMessage + formatMetaMailboxBody,
 *     gated on classifyConnectError !== "dead"), and the MCP bridge consumes the
 *     SHARED formatter (no local copy) — so neither sender can silently drop the
 *     mailbox transport or drift the body format.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { formatMetaMailboxBody, type MailboxSenderEnvelope } from "../pi-extensions/lib/meta-mailbox-body.ts";
import { enqueueMetaMessage, type MetaIdentity, serializeMetaIdentity } from "../pi-extensions/lib/meta-session.ts";
import { classifyConnectError } from "../pi-extensions/lib/socket-probe.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// ── routing decision: only "dead" (no live socket) falls back to the mailbox ──
const FALLBACK = (code: string | undefined) => classifyConnectError(code) === "dead";
ok("ENOENT → fallback to mailbox", FALLBACK("ENOENT"));
ok("ECONNREFUSED → fallback to mailbox", FALLBACK("ECONNREFUSED"));
ok("ETIMEDOUT → NO fallback (alive-but-stalled, surface)", !FALLBACK("ETIMEDOUT"));
ok("EACCES → NO fallback (surface)", !FALLBACK("EACCES"));
ok("undefined code → NO fallback (surface)", !FALLBACK(undefined));

// ── shared body render: replyability is advertised correctly ────────────────
const piSender: MailboxSenderEnvelope = {
	sessionId: "20260611T093858-14984d",
	agentId: "earendil/pi",
	cwd: "/home/junghan/repos/gh/pi-shell-acp",
	timestamp: "2026-06-11T02:40:00.000Z",
	origin: "pi-session",
	replyable: true,
};
{
	const body = formatMetaMailboxBody(piSender, "hello from pi", false);
	ok(
		"pi-session body advertises replyable reply-address",
		body.includes("replyable — reply with entwurf_send to this sessionId"),
	);
	ok("pi-session body carries the sender sessionId", body.includes(piSender.sessionId));
	ok("body carries the message", body.includes("hello from pi"));
	ok("body shows 'wants reply: no' when false", body.includes("wants reply: no"));
	ok("body has the received header", body.includes("[entwurf received ⟵]"));
}
ok(
	"wants_reply=true renders 'wants reply: yes'",
	formatMetaMailboxBody(piSender, "x", true).includes("wants reply: yes"),
);
{
	const ext: MailboxSenderEnvelope = { ...piSender, origin: "external-mcp", replyable: false };
	ok(
		"external sender body says non-replyable",
		formatMetaMailboxBody(ext, "x", false).includes("external, non-replyable"),
	);
}
{
	const meta: MailboxSenderEnvelope = { ...piSender, origin: "meta-session", replyable: true };
	ok(
		"meta-session sender body says 'meta-session, replyable'",
		formatMetaMailboxBody(meta, "x", false).includes("meta-session, replyable"),
	);
}

// ── integration: the raw enqueueMetaMessage PRIMITIVE writes a .msg ─────────
// This exercises the low-level primitive (the building block), which is unchanged.
// The pi-native FALLBACK now gates this primitive behind guardedMailboxEnqueue
// (SE-1/SE-2) — a record-backed-but-inactive receiver is refused before this runs;
// that guarded behaviour is proven in check-entwurf-mailbox-guard (tmpdir snapshot).
{
	const root = mkdtempSync(path.join(tmpdir(), "entwurf-mailbox-fallback-"));
	const sessionsDir = path.join(root, "meta-sessions");
	const mailboxDir = path.join(root, "meta-mailbox");
	const gardenId = "20260611T112732-0f42b6";
	// A claude-code citizen: a meta-record exists, but NO control socket (the
	// exact case pi-native send used to ENOENT on).
	const citizen: MetaIdentity = {
		schemaVersion: 2,
		gardenId,
		backend: "claude-code",
		nativeSessionId: "native-xyz",
		cwd: "/home/junghan/repos/gh/pi-shell-acp",
		model: null,
		transcriptPath: null,
		parentGardenId: null,
		isEntwurf: false,
		createdAt: "2026-06-11T02:27:32.000Z",
		recordUpdatedAt: "2026-06-11T02:27:32.000Z",
	};
	mkdirSync(sessionsDir, { recursive: true });
	writeFileSync(path.join(sessionsDir, `${gardenId}.meta.json`), serializeMetaIdentity(citizen));

	const body = formatMetaMailboxBody(piSender, "review verdict for you", false);
	const result = enqueueMetaMessage({ gardenId, body, sessionsDir, mailboxDir });
	ok("enqueue returns the normalized gardenId", result.gardenId === gardenId);

	const boxDir = path.join(mailboxDir, gardenId);
	const files = readdirSync(boxDir);
	const msgs = files.filter((f) => f.endsWith(".msg"));
	ok("exactly one .msg written to the citizen's mailbox", msgs.length === 1);
	ok("the .msg body is the formatted envelope", readFileSync(path.join(boxDir, msgs[0]), "utf8") === body);
	ok("doorbell signal poked (inbox.signal present)", files.includes("inbox.signal"));
}

// ── WIRING GUARD: the senders actually use the fallback / shared formatter ───
{
	const piNative = readFileSync("pi-extensions/entwurf-control.ts", "utf8");
	ok("pi-native send imports classifyConnectError", piNative.includes("classifyConnectError"));
	ok("pi-native send renders via the shared formatMetaMailboxBody", piNative.includes("formatMetaMailboxBody("));
	ok(
		"pi-native fallback is gated on classifyConnectError !== 'dead' (no fallback on stall)",
		piNative.includes('classifyConnectError(code) !== "dead"'),
	);
	// SE-1/SE-2 (slice 2d-2b): the fallback enqueue must go THROUGH guardedMailboxEnqueue,
	// reached via a NON-LITERAL dynamic import (root-tsc emit surface can't static-import
	// the .ts-extension fence lib). The raw enqueueMetaMessage primitive stays, but only
	// INSIDE the guard closure — never executed unguarded.
	ok(
		"pi-native fallback reaches the guard via non-literal dynamic import",
		piNative.includes('const ENTWURF_MAILBOX_GUARD_MODULE = "./lib/entwurf-mailbox-guard.ts"') &&
			piNative.includes("await import(ENTWURF_MAILBOX_GUARD_MODULE)"),
	);
	ok(
		"pi-native fallback does NOT static-import the guard lib",
		!/import\s*\{[^}]*guardedMailboxEnqueue[^}]*\}\s*from/.test(piNative),
	);
	{
		const gAt = piNative.indexOf("guardedMailboxEnqueue(targetSessionId");
		const eAt = piNative.indexOf("enqueueMetaMessage({", gAt);
		ok("pi-native fallback wraps enqueueMetaMessage inside the guard (no unguarded enqueue)", gAt >= 0 && eAt > gAt);
	}
	ok(
		"pi-native mailbox sender is marked pi-session + replyable",
		piNative.includes('origin: "pi-session"') && piNative.includes("replyable: true"),
	);

	const bridge = readFileSync("mcp/pi-tools-bridge/src/index.ts", "utf8");
	ok(
		"MCP bridge imports the SHARED formatMetaMailboxBody",
		/import\s*\{\s*formatMetaMailboxBody\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/pi-extensions\/lib\/meta-mailbox-body\.ts"/.test(
			bridge,
		),
	);
	ok(
		"MCP bridge has NO local formatMetaMailboxBody definition (single source)",
		!/function\s+formatMetaMailboxBody\s*\(/.test(bridge),
	);
}

console.log(`\n[check-entwurf-send-mailbox-fallback] ${passed} assertions ok`);
