#!/usr/bin/env node
/**
 * Raw Copilot CLI TUI+server delivery probe.
 *
 * This is probe evidence, not a shipped adapter. Start a visible native TUI:
 *   copilot --ui-server --port 43817 --model auto
 *
 * The official SDK is intentionally not a production dependency of entwurf.
 * Point COPILOT_SDK_MODULE at its ESM entry (README has the pinned setup).
 * Without LIVE=1 this proves only D0 and spends no model credit.
 *
 * ATTRIBUTION IS THE WHOLE CLAIM. A delivery probe that reads "the newest
 * assistant.message" is reading the TUI, not its own turn: a human typing in the
 * visible session, a queued earlier prompt, or a retried send all produce events
 * that would be scored as OUR delivery.
 *
 * The join runs off the PROBE-OWNED MARKER BODY, not off what `send()` returned.
 * On the bundled CLI 1.0.80 `session.send()` resolves to a `Promise<string>` whose
 * id is the SDK's own submission handle: the server-side `user.message` does NOT
 * carry it, and it is a different axis from that event's `id`/`interactionId`. A
 * join on the returned string is therefore not merely fragile, it cannot hold — so
 * the returned value is kept for the diagnostic log only. The chain that carries
 * the claim is:
 *
 *   unique marker body  →  exactly one `user.message`
 *                       →  its `interactionId`
 *                       →  exactly one `assistant.turn_start` on that interaction
 *                       →  that turn_start's required `turnId`
 *                       →  only `assistant.message` / `assistant.turn_end` on that turnId
 *
 * Every link is required and unambiguous. Absent, or matched more than once, the
 * probe FAILS CLOSED (throws). There is no positional fallback and no "the next
 * turn after ours" rule, because a wrong pass here would be published as capability
 * evidence.
 */
import { pathToFileURL } from "node:url";

const modulePath = process.env.COPILOT_SDK_MODULE;
if (!modulePath?.startsWith("/")) {
	throw new Error("COPILOT_SDK_MODULE must be an absolute path to @github/copilot-sdk/dist/index.js");
}

const { CopilotClient, RuntimeConnection } = await import(pathToFileURL(modulePath).href);
const server = process.env.COPILOT_UI_SERVER ?? "localhost:43817";
const live = process.env.LIVE === "1";
const twoSessionControl = process.env.COPILOT_D3_CONTROL === "1";
if (twoSessionControl && !live) throw new Error("COPILOT_D3_CONTROL=1 requires LIVE=1");
const marker = `NATIVE-ENTWURF-${Date.now()}`;
const TURN_BUDGET_MS = 30_000;
/** Cleanup gets its own small bound: a probe must not hang on the way out. */
const CLEANUP_BOUND_MS = 5_000;
const seen = new Set();
const controlSeen = new Set();
let controlSession;

const client = new CopilotClient({
	connection: RuntimeConnection.forUri(server),
	mode: "copilot-cli",
	logLevel: "error",
});

/**
 * Bound ONE awaited SDK call. Promise.race does not cancel the underlying request —
 * nothing in the SDK offers that — so this is a liveness bound on the probe, not a
 * cancellation. That is the honest guarantee: the probe always reaches a verdict or
 * an error within its budget, and never sits forever on a call that will not return.
 */
async function bounded(label, promise, ms) {
	if (ms <= 0) throw new Error(`${label}: no time left in the ${TURN_BUDGET_MS}ms turn budget`);
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} exceeded its ${ms}ms bound`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

// Identifier readers for the two links that DO exist server-side. The SDK nests payloads
// under `data`, but a top-level carrier is accepted too so a protocol revision that flattens
// one field does not silently turn a cell into a positional guess — an ABSENT id still fails
// closed below. There is deliberately no reader for send()'s returned handle: it is not a key
// any event carries, so joining on it would be inventing a relation.
const interactionOf = (event) => event?.data?.interactionId ?? event?.interactionId;
const turnOf = (event) => event?.data?.turnId ?? event?.turnId;

function observe(event) {
	seen.add(event.type);
}

function report(cells) {
	console.log("DELIVERY_LEVELS:");
	console.log("harness=copilot-cli");
	console.log(`transport=official-sdk-over-hidden-ui-server server=${server}`);
	for (const [level, value] of Object.entries(cells)) console.log(`${level} ${value}`);
	console.log(
		"notes=probe-only; --ui-server is hidden from CLI help; loopback RPC authentication is not established; " +
			"no managed citizen lane; completion is read through the official session event-history API " +
			"(getEvents/getMessages) — no TUI, file, or database transcript scraping; " +
			"evidence=L4 direct-native on ONE Linux workstation; this stdout is host-local and was not archived as a durable artifact",
	);
}

/** Everything the probe must do on the way out, each bounded. Returns failure lines. */
async function cleanup(foregroundSessionId) {
	const problems = [];
	const attempt = async (label, thunk) => {
		try {
			return await bounded(label, thunk(), CLEANUP_BOUND_MS);
		} catch (err) {
			problems.push(`${label}: ${String(err)}`);
			return undefined;
		}
	};

	// RE-CONFIRM A as the foreground session BEFORE anything is torn down: creating the control
	// session moved the TUI's foreground, and leaving the operator's visible window pointing at a
	// probe-owned session would be the probe editing the operator's state. Read first and write
	// only on drift — a probe that unconditionally re-sets the foreground is making a write it
	// cannot tell apart from a no-op, and it would report a drift it caused as clean.
	if (foregroundSessionId) {
		const current = await attempt("getForegroundSessionId()", () => client.getForegroundSessionId());
		if (current !== foregroundSessionId) {
			console.error(`CLEANUP_NOTE foreground was ${current ?? "none"}, not target A — restoring A`);
			await attempt("setForegroundSessionId(A)", () => client.setForegroundSessionId(foregroundSessionId));
		}
	}

	// Only the session the PROBE created is deleted. A is the operator's live session and is
	// never deleted here.
	if (controlSession?.sessionId) {
		await attempt("deleteSession(B)", () => client.deleteSession(controlSession.sessionId));
	}

	// Say what stop() actually does, not the flattering version. The probe issues no
	// A.disconnect() of its own, but client.stop() tears down EVERY tracked session — including
	// the resumed A — and that teardown goes out on the wire as session.destroy. What keeps this
	// honest rather than destructive is the order above: A's foreground ownership is re-confirmed
	// first, so the TUI keeps A as its foreground session and the net effect on A is
	// detach-equivalent, not removal. A is not deleted. Do NOT "fix" this by reaching past the
	// SDK for a raw detach — a bespoke wrapper would be a second lifecycle authority, and this
	// probe's whole claim is that it used the official surface.
	//
	// stop() also reports its teardown failures by RETURNING them, so an unread array is a
	// cleanup failure laundered into success.
	const stopErrors = await attempt("client.stop()", () => client.stop());
	if (Array.isArray(stopErrors) && stopErrors.length > 0) {
		problems.push(
			`client.stop() reported ${stopErrors.length} teardown error(s): ${stopErrors.map(String).join("; ")}`,
		);
	}
	return problems;
}

let foregroundSessionId;
try {
	await client.start();
	const ping = await client.ping("entwurf-native-probe");
	const sessionId = await client.getForegroundSessionId();
	if (!sessionId) throw new Error("ui-server has no foreground session");
	foregroundSessionId = sessionId;
	const metadata = await client.getSessionMetadata(sessionId);
	if (!metadata?.context?.workingDirectory) throw new Error("foreground session metadata has no workingDirectory");

	console.error(
		`protocol=${ping.protocolVersion ?? "unknown"} sessionId=${sessionId} cwd=${metadata.context.workingDirectory}`,
	);
	if (!live) {
		report({
			"D0 live_identity:": 'pass reason="ping + foreground session id + metadata cwd"',
			"D1 native_continuation:": 'unproven reason="set LIVE=1 for one model turn"',
			"D2 receiver_armed:": 'pass reason="SDK connected to the TUI ui-server"',
			"D3 addressed_enqueue:": "unproven",
			"D4 idle_wake:": "unproven",
			"D5 context_injection:": "unproven",
			"D6 continuity:": "unproven",
			"D7 completion_reply:": "unproven",
			"D8 robustness:": "unproven",
		});
		process.exitCode = 0;
	} else {
		if (twoSessionControl) {
			controlSession = await client.createSession({
				model: "auto",
				workingDirectory: metadata.context.workingDirectory,
				skipCustomInstructions: true,
				onEvent: (event) => controlSeen.add(event.type),
			});
			await client.setForegroundSessionId(sessionId);
			console.error(`controlSessionId=${controlSession.sessionId}`);
		}

		const session = await client.resumeSession(sessionId, {
			suppressResumeEvent: true,
			onEvent: observe,
		});
		// send() resolves to the SDK's own submission handle. On the bundled CLI 1.0.80 that string
		// appears on NO server event — not as user.message.id, not as its interactionId — so it is
		// logged as a diagnostic and never joined on. The marker body below is the real key.
		const sentHandle = await session.send({
			prompt: `This is a native delivery probe. Reply with exactly ${marker} and nothing else.`,
			mode: "enqueue",
		});
		console.error(`sendHandle=${String(sentHandle)} (diagnostic only — not an event key)`);

		/** Resolve the marker turn from the event history, or return why it is not resolvable yet. */
		const resolveMarkerTurn = (events) => {
			const matches = events.filter((event) => event.type === "user.message" && event.data?.content?.includes(marker));
			if (matches.length === 0) return { pending: `no user.message carries the unique marker ${marker}` };
			// AMBIGUITY IS A FAILURE, NOT A TIE-BREAK. Two user.messages with this body means the send
			// was duplicated (retry, replay, a human pasting it); picking one would be a guess.
			if (matches.length > 1) {
				return {
					fatal: `${matches.length} user.message events carry the unique marker ${marker} — the delivery is ambiguous`,
				};
			}
			const markerEvent = matches[0];
			const interactionId = interactionOf(markerEvent);
			if (interactionId === undefined) {
				return {
					fatal: "the marker user.message exposes no interactionId — assistant events cannot be attributed to it",
				};
			}
			const starts = events.filter(
				(event) => event.type === "assistant.turn_start" && interactionOf(event) === interactionId,
			);
			if (starts.length === 0) return { pending: `no assistant.turn_start yet on interactionId=${interactionId}` };
			if (starts.length > 1) {
				return {
					fatal: `${starts.length} assistant.turn_start events share interactionId=${interactionId} — the turn is ambiguous`,
				};
			}
			const turnId = turnOf(starts[0]);
			if (turnId === undefined) {
				return {
					fatal: `the assistant.turn_start on interactionId=${interactionId} exposes no turnId — its assistant events cannot be attributed`,
				};
			}
			return { markerEvent, interactionId, turnId };
		};

		const deadline = Date.now() + TURN_BUDGET_MS;
		const remaining = () => deadline - Date.now();
		let events = [];
		let resolved = { pending: "no getEvents() read completed" };
		while (remaining() > 0) {
			events = await bounded("session.getEvents()", session.getEvents(), remaining());
			for (const event of events) observe(event);
			resolved = resolveMarkerTurn(events);
			// A fatal shape will not become valid by waiting — stop polling and fail closed below.
			if (resolved.fatal) break;
			if (resolved.turnId !== undefined) {
				const inTurn = events.filter((event) => turnOf(event) === resolved.turnId);
				const replied = inTurn.some((event) => event.type === "assistant.message");
				const ended = inTurn.some((event) => event.type === "assistant.turn_end");
				if (replied && ended) break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// FAIL CLOSED — an ambiguous or unnameable turn is a broken measurement, and a turn that
		// never resolved inside the budget is an unfinished one. Neither is a partial pass, and
		// neither falls back to "the assistant events that came after ours".
		if (resolved.fatal) throw new Error(resolved.fatal);
		if (resolved.turnId === undefined) {
			throw new Error(
				`the marker turn did not resolve within ${TURN_BUDGET_MS}ms (${resolved.pending}) — the delivery is unattributable`,
			);
		}
		const { markerEvent, turnId } = resolved;

		// From here on ONLY this turn's events are evidence.
		const turnEvents = events.filter((event) => turnOf(event) === turnId);
		const turnReplies = turnEvents.filter((event) => event.type === "assistant.message");
		const replied = turnReplies.length > 0;
		const completed = replied && turnEvents.some((event) => event.type === "assistant.turn_end");
		const responseContent = turnReplies.at(-1)?.data?.content;
		const responseModel = turnReplies.at(-1)?.data?.model;
		const exact = responseContent === marker;
		// D4 is read off the marker event itself — an older idle wake in the transcript is
		// somebody else's evidence.
		const idleDelivery = markerEvent.data?.delivery === "idle";
		if (!completed) throw new Error("timeout waiting for the marker turn to complete");

		if (controlSession) {
			// Bounded like every other read. The turn finished inside the budget, so what is left of
			// it is the natural bound; if it landed on the very edge, D3 still gets the cleanup bound
			// rather than an unbounded call.
			const controlBound = Math.max(remaining(), CLEANUP_BOUND_MS);
			const controlEvents = await bounded("controlSession.getEvents()", controlSession.getEvents(), controlBound);
			for (const event of controlEvents) controlSeen.add(event.type);
		}
		// D3's predicate is the SAME sentence the verdict prints: across onEvent AND getEvents,
		// the non-target session received no user.message and no assistant.* event of any kind.
		// The old check enumerated two assistant types, so an isolation break that arrived as
		// assistant.turn_end (or any future assistant.*) would have been reported as a pass.
		const controlTouched = [...controlSeen].some((type) => type === "user.message" || type.startsWith("assistant."));

		report({
			"D0 live_identity:": 'pass reason="ping + foreground session id + metadata cwd"',
			"D1 native_continuation:": replied
				? 'pass reason="the turn opened on the marker user.message\'s interactionId replied in the same session"'
				: 'fail reason="marker turn did not continue"',
			"D2 receiver_armed:": 'pass reason="SDK connected to the TUI ui-server"',
			"D3 addressed_enqueue:": twoSessionControl
				? controlTouched
					? `fail reason="non-target control session received a user.message or assistant.* event (${[...controlSeen].sort().join(",")})"`
					: 'pass reason="exact target woke; second session received no user.message and no assistant.* event"'
				: 'partial reason="exact session id selected; rerun with COPILOT_D3_CONTROL=1"',
			"D4 idle_wake:": idleDelivery
				? 'pass reason="the marker user.message itself carries delivery=idle"'
				: 'fail reason="the marker user.message does not carry delivery=idle"',
			"D5 context_injection:": exact
				? 'pass reason="unique marker entered the attributed user.message and was returned exactly"'
				: 'pass reason="unique marker entered the attributed user.message; reply was non-exact"',
			"D6 continuity:": responseModel
				? `pass reason="the same session answered this turn on ${responseModel}"`
				: 'fail reason="the attributed turn exposed no reply model"',
			"D7 completion_reply:": seen.has("session.idle")
				? 'pass reason="attributed assistant.message + assistant.turn_end; session.idle also seen"'
				: 'pass reason="attributed assistant.message + assistant.turn_end; session.idle not observed"',
			"D8 robustness:": 'unproven reason="permission ownership, crash, ordering, auth, and stale endpoint remain"',
		});
	}
} finally {
	const problems = await cleanup(foregroundSessionId);
	if (problems.length > 0) {
		// A probe that cannot close what it opened has not finished cleanly, and a delivery
		// verdict printed above must not carry a zero exit past that.
		for (const problem of problems) console.error(`CLEANUP_FAILED ${problem}`);
		process.exitCode = 1;
	}
}
