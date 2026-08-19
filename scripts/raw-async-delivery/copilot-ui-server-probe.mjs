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
const seen = new Set();
const controlSeen = new Set();
let idleDelivery = false;
let responseContent;
let responseModel;
let controlSession;
let currentTurnEvents = [];

const client = new CopilotClient({
	connection: RuntimeConnection.forUri(server),
	mode: "copilot-cli",
	logLevel: "error",
});

function observe(event) {
	seen.add(event.type);
	if (event.type === "user.message" && event.data?.delivery === "idle") idleDelivery = true;
	if (event.type === "assistant.message") {
		responseContent = event.data?.content;
		responseModel = event.data?.model;
	}
}

function report(cells) {
	console.log("DELIVERY_LEVELS:");
	console.log("harness=copilot-cli");
	console.log(`transport=official-sdk-over-hidden-ui-server server=${server}`);
	for (const [level, value] of Object.entries(cells)) console.log(`${level} ${value}`);
	console.log(
		"notes=probe-only; --ui-server is hidden from CLI help; loopback RPC authentication is not established; no managed citizen lane",
	);
}

try {
	await client.start();
	const ping = await client.ping("entwurf-native-probe");
	const sessionId = await client.getForegroundSessionId();
	if (!sessionId) throw new Error("ui-server has no foreground session");
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
		await session.send({
			prompt: `This is a native delivery probe. Reply with exactly ${marker} and nothing else.`,
			mode: "enqueue",
		});

		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			const events = await session.getEvents();
			const markerIndex = events.findLastIndex(
				(event) => event.type === "user.message" && event.data?.content?.includes(marker),
			);
			if (markerIndex >= 0) {
				currentTurnEvents = events.slice(markerIndex);
				const hasReply = currentTurnEvents.some((event) => event.type === "assistant.message");
				const hasTurnEnd = currentTurnEvents.some((event) => event.type === "assistant.turn_end");
				if (hasReply && hasTurnEnd) break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		for (const event of currentTurnEvents) observe(event);
		if (controlSession) {
			for (const event of await controlSession.getEvents()) {
				controlSeen.add(event.type);
				if (event.type === "user.message" && event.data?.content?.includes(marker)) controlSeen.add("marker");
			}
		}

		const injected = currentTurnEvents.some(
			(event) => event.type === "user.message" && event.data?.content?.includes(marker),
		);
		const replied = currentTurnEvents.some((event) => event.type === "assistant.message");
		const exact = responseContent === marker;
		const completed = replied && currentTurnEvents.some((event) => event.type === "assistant.turn_end");
		if (!injected || !completed) throw new Error("timeout waiting for the marker turn to complete");
		const controlTouched =
			controlSeen.has("marker") || ["assistant.turn_start", "assistant.message"].some((type) => controlSeen.has(type));
		report({
			"D0 live_identity:": 'pass reason="ping + foreground session id + metadata cwd"',
			"D1 native_continuation:": injected && replied ? "pass" : 'fail reason="marker turn did not continue"',
			"D2 receiver_armed:": 'pass reason="SDK connected to the TUI ui-server"',
			"D3 addressed_enqueue:": twoSessionControl
				? controlTouched
					? 'fail reason="non-target control session received a turn event"'
					: 'pass reason="exact target woke; second session received no user/turn/assistant event"'
				: 'partial reason="exact session id selected; rerun with COPILOT_D3_CONTROL=1"',
			"D4 idle_wake:": idleDelivery
				? 'pass reason="user.message delivery=idle"'
				: 'fail reason="idle delivery event missing"',
			"D5 context_injection:": injected
				? exact
					? 'pass reason="unique marker entered user.message and was returned exactly"'
					: 'pass reason="unique marker entered the target user.message; reply was non-exact"'
				: 'fail reason="unique marker missing from target user.message"',
			"D6 continuity:": injected && responseModel ? `pass reason="same session replied on ${responseModel}"` : "fail",
			"D7 completion_reply:": completed
				? seen.has("session.idle")
					? 'pass reason="assistant.message + turn_end + session.idle"'
					: 'pass reason="assistant.message + turn_end; session.idle not observed"'
				: 'fail reason="completion event set incomplete"',
			"D8 robustness:": 'unproven reason="permission ownership, crash, ordering, auth, and stale endpoint remain"',
		});
		await session.disconnect();
		await controlSession?.disconnect();
	}
} finally {
	await client.stop();
}
