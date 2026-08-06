/**
 * check-mux-parent-artifact — deterministic gate for the scrubbed parent-transcript fixture
 * (`scripts/fixtures/mux-parent-transcript.scrubbed.jsonl`).
 *
 * ── What the fixture is, and what it is NOT ──
 *
 * It is a version-pinned SAMPLE OF THE PARENT-SIDE SHAPE: what an `entwurf_fresh_call` and the
 * sibling's nonce callback actually look like in the transcript of the citizen that made the
 * call. Its structure was extracted from a fixture-only real Pi parent retake and then scrubbed —
 * every id, uuid, toolCallId, timestamp, model, path, cwd and message body is a fixture value,
 * while the event order, roles, content types, toolName, the `toolCallId` join on the result, the
 * nonce flowing from the launch receipt into the callback body, and the `sender_info` envelope
 * field names are real.
 *
 * It is NOT placement evidence. Nothing here says a window opened; that axis is the launch
 * receipt and the LIVE lifecycle gate, and reading this file as proof of a window would be
 * exactly the receipt-merging docs/mux-launch-rail.md §12 forbids.
 *
 * ── Why a gate for a static file ──
 *
 * The downstream that needs this shape (`entwurf-peek`'s repair) parses parent transcripts. A
 * fixture whose only guarantee is "someone scrubbed it once" would rot silently into a shape
 * nothing produces, and the next reader would go back to searching private transcripts — the one
 * outcome the artifact exists to prevent. So the claims below pin the shape AND the scrub:
 *
 *   MUXARTIFACT-EVENT-ORDER        provenance → the fresh_call toolResult → the later callback
 *   MUXARTIFACT-RESULT-CARRIES-CALL-ID  MEASURED: pi records NO separate toolCall row, so the
 *                                  join a parser follows is the `toolCallId` on the RESULT. A
 *                                  fixture that invented a toolCall row would send the next
 *                                  reader looking for an event pi never writes
 *   MUXARTIFACT-NONCE-FLOW         the nonce in the launch receipt is the SAME string that comes
 *                                  back in the callback body — that flow is the whole correlation
 *                                  contract, and a fixture that broke it would teach the opposite
 *   MUXARTIFACT-SENDER-INFO-SHAPE  the callback body embeds the <sender_info> JSON envelope whose
 *                                  field names a reader keys on
 *   MUXARTIFACT-RECEIPT-GRAMMAR    the scrubbed launch receipt is still GRAMMAR-VALID: session
 *                                  `$N`, window `@N`, pane `%N`, a decimal pid, and a runtime
 *                                  that is an absolute path to an executable. A fixture that
 *                                  collapses those sigils documents a receipt no parser meets,
 *                                  which defeats the only reason the file is tracked
 *   MUXARTIFACT-SCRUBBED           no operator path, no real garden id, no real uuid survives
 *   MUXARTIFACT-PROVENANCE-HONEST  the file says where it came from and denies being placement
 *                                  evidence, in its own first record
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
function ok(label: string, cond: boolean, detail?: string): void {
	assert.ok(cond, `${label}${detail ? `\n${detail}` : ""}`);
	console.log(`  ok    ${label}`);
	passed++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(ROOT, "scripts/fixtures/mux-parent-transcript.scrubbed.jsonl");

/** The fixture values the scrub substitutes. Anything OUTSIDE this vocabulary that looks like an
 * id, a path or a uuid is a leak. */
const FIXTURE_GID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
const FIXTURE_GIDS = new Set(["20260101T000000-aaaaaa", "20260101T000001-bbbbbb"]);

interface Event {
	type?: string;
	note?: string;
	message?: {
		role?: string;
		toolName?: string;
		toolCallId?: string;
		content?: { type?: string; text?: string }[];
	};
}

function main(): void {
	ok("the artifact exists at its pinned path", fs.existsSync(ARTIFACT), `--- expected ---\n${ARTIFACT}`);
	const raw = fs.readFileSync(ARTIFACT, "utf8");
	const lines = raw.split("\n").filter((l) => l.trim());
	const events: Event[] = lines.map((l, i) => {
		try {
			return JSON.parse(l) as Event;
		} catch (err) {
			throw new Error(`line ${i + 1} is not JSON — ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	ok("the artifact is exactly three JSONL records", events.length === 3, `--- got ${events.length} ---`);

	const [provenance, result, callback] = events as [Event, Event, Event];

	// ── provenance ───────────────────────────────────────────────────────────────
	ok(
		"[QK:MUXARTIFACT-PROVENANCE-HONEST] the first record states where the shape came from AND denies being placement evidence — a reader who takes this for proof that a window opened has merged the two receipts this rail keeps apart",
		provenance.type === "fixture-provenance" &&
			/scrub/i.test(provenance.note ?? "") &&
			/real Pi parent/i.test(provenance.note ?? "") &&
			/NOT placement evidence/i.test(provenance.note ?? ""),
		`--- record 1 ---\n${JSON.stringify(provenance)}`,
	);

	// ── order and linkage ────────────────────────────────────────────────────────
	ok(
		"[QK:MUXARTIFACT-EVENT-ORDER] the two transcript events are in the order a parent actually records them: the fresh_call RESULT first, then the callback that arrives later as its own event — an artifact with the callback before the launch would teach a reader to correlate backwards",
		result.message?.role === "toolResult" && callback.type === "custom_message",
		`--- shapes ---\n${events.map((e) => `${e.type}/${e.message?.role ?? "-"}`).join(" → ")}`,
	);
	ok(
		"[QK:MUXARTIFACT-RESULT-CARRIES-CALL-ID] the RESULT carries both toolName and toolCallId — measured: pi writes no separate toolCall row, so that id on the result is the whole join, and a fixture that invented a toolCall event would send the next reader hunting for something pi never records",
		result.message?.toolName === "entwurf_fresh_call" && Boolean(result.message?.toolCallId),
	);

	// ── the nonce flow ───────────────────────────────────────────────────────────
	const resultText = (result.message?.content ?? []).map((c) => c.text ?? "").join("\n");
	// The callback is a custom_message: its body is a plain string, not a content array.
	const callbackText = String((callback as unknown as { content?: string }).content ?? "");
	const nonce = /nonce:\s+(mux-fresh-call-\S+)/.exec(resultText)?.[1] ?? "";
	ok(
		"the launch receipt in the toolResult carries a nonce and reads as a launch receipt",
		nonce.length > 0 && /LAUNCH receipt/i.test(resultText),
		`--- toolResult text ---\n${resultText}`,
	);
	ok(
		"[QK:MUXARTIFACT-NONCE-FLOW] the SAME nonce string that the launch receipt printed comes back inside the callback body — that flow is the entire correlation contract, and a fixture with two different nonces would document a rail that does not exist",
		nonce.length > 0 && callbackText.includes(nonce),
		`--- nonce ---\n${nonce}\n--- callback text ---\n${callbackText}`,
	);

	// ── the sender envelope ──────────────────────────────────────────────────────
	const envRaw = /<sender_info>(\{[\s\S]*?\})<\/sender_info>/.exec(callbackText)?.[1] ?? "";
	let envelope: Record<string, unknown> = {};
	try {
		envelope = JSON.parse(envRaw) as Record<string, unknown>;
	} catch {
		envelope = {};
	}
	ok(
		"[QK:MUXARTIFACT-SENDER-INFO-SHAPE] the callback body embeds a <sender_info> JSON envelope carrying the exact field names a reader keys on — sessionId (the sibling's garden id), agentId, cwd, timestamp, origin and replyable. Those NAMES are the contract; a fixture that renamed one would document a parser that cannot exist",
		["sessionId", "agentId", "cwd", "timestamp", "origin", "replyable"].every((k) => k in envelope),
		`--- envelope keys ---\n${Object.keys(envelope).join(", ") || "(none)"}`,
	);
	ok(
		"the callback event is the delivery custom_message pi actually writes (customType entwurf-message)",
		(callback as unknown as { customType?: string }).customType === "entwurf-message",
	);
	const senderGid = String(envelope.sessionId ?? "");
	ok(
		"the envelope's sessionId holds a garden id in the canonical grammar — that is the field the correlation reads, so its SHAPE must survive scrubbing",
		FIXTURE_GID.test(senderGid),
		`--- session field ---\n${senderGid}`,
	);

	// ── the receipt is still grammar-valid after scrubbing ───────────────────────
	const grammar: string[] = [];
	const win = /^\s*window:\s+(@\d+) \(index (\d+)\) in session (\$\d+)/m.exec(resultText);
	const pane = /^\s*pane:\s+(%\d+) pid (\d+)/m.exec(resultText);
	const runtime = /^\s*backend:\s+\S+ \((\S+)\)/m.exec(resultText);
	if (!win) grammar.push("no `window: @N (index N) in session $N` line survives");
	if (!pane) grammar.push("no `pane: %N pid N` line survives");
	if (!runtime) grammar.push("no `backend: <name> (<runtime>)` line survives");
	if (runtime && !runtime[1]?.startsWith("/")) grammar.push(`the runtime is not an absolute path (${runtime[1]})`);
	// The fixture vocabulary is fixed, so this is exact rather than heuristic: the scrub's runtime
	// value is one known string. "Looks like an executable" is not something a regex can decide,
	// and claiming it would promise more than the check performs.
	if (runtime && runtime[1] !== "/fixture/bin/pi")
		grammar.push(`the runtime is not the fixture runtime value /fixture/bin/pi (${runtime[1]})`);
	ok(
		"[QK:MUXARTIFACT-RECEIPT-GRAMMAR] the scrubbed launch receipt still parses as one: session `$N`, window `@N`, pane `%N`, a decimal pid, and the fixture runtime path `/fixture/bin/pi` — an executable-shaped value, not a project directory. Substituting a value is only safe while it stays inside its own grammar — a fixture whose session id reads `@0` teaches a parser to accept something tmux never emits",
		grammar.length === 0,
		`--- grammar problems ---\n${grammar.join("\n")}\n--- receipt ---\n${resultText}`,
	);

	// ── the scrub ────────────────────────────────────────────────────────────────
	const leaks: string[] = [];
	if (/\/home\/(?!junghan-fixture)[a-z]/i.test(raw.replace(/\/fixture\/[^"\s]*/g, "")))
		leaks.push("an operator home path");
	if (/\.pi\/agent\/sessions/.test(raw)) leaks.push("a real pi sessions path");
	if (/\.claude\/projects/.test(raw)) leaks.push("a real Claude projects path");
	for (const gid of raw.match(/\d{8}T\d{6}-[0-9a-f]{6}/g) ?? []) {
		if (!FIXTURE_GIDS.has(gid)) leaks.push(`a garden id outside the fixture vocabulary (${gid})`);
	}
	for (const uuid of raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) {
		if (uuid !== "0199f000-0000-7000-8000-000000000000") leaks.push(`a uuid outside the fixture vocabulary (${uuid})`);
	}
	ok(
		"[QK:MUXARTIFACT-SCRUBBED] nothing outside the fixture vocabulary survives — no operator path, no real garden id, no real session uuid. The artifact exists so downstream never has to open a private transcript; a leak here would defeat the reason it is tracked at all",
		leaks.length === 0,
		`--- leaks ---\n${leaks.join("\n")}`,
	);

	console.log(`\ncheck-mux-parent-artifact: ${passed} checks passed`);
}

main();
