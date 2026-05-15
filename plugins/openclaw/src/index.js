// (b3a) End-to-end smoke stub — NOT the real pi-shell-acp transport.
// Purpose: prove plugin SDK surfaces model rows AND dispatches createStreamFn
// before pi-shell-acp 측 fills in the real stdio ACP transport.
//
// Once Step 2 (pi-shell-acp/openclaw-plugin/) lands, this stub is replaced.

const PROVIDER_ID = "pi-shell-acp";

const STUB_MODELS = [
	{
		id: "claude-sonnet-4-6",
		name: "claude-sonnet-4-6",
		api: PROVIDER_ID,
		provider: PROVIDER_ID,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
		reasoning: false,
	},
	{
		id: "gpt-5.4",
		name: "gpt-5.4",
		api: PROVIDER_ID,
		provider: PROVIDER_ID,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
		reasoning: false,
	},
	{
		id: "gemini-3.1-pro-preview",
		name: "gemini-3.1-pro-preview",
		api: PROVIDER_ID,
		provider: PROVIDER_ID,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
		reasoning: false,
	},
];

function stubModel(modelId) {
	const match = STUB_MODELS.find((m) => m.id === modelId);
	if (match) return match;
	return {
		id: modelId,
		name: modelId,
		api: PROVIDER_ID,
		provider: PROVIDER_ID,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
		reasoning: false,
	};
}

// Inlined AssistantMessageEventStream (mirrors @mariozechner/pi-ai's
// utils/event-stream.js). External plugin can't resolve pi-ai from its own
// node_modules, so we duck-type the class. Real plugin will depend on pi-ai
// properly and use `createAssistantMessageEventStream()`.
class _EventStream {
	constructor(isComplete, extractResult) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.queue = [];
		this.waiting = [];
		this.done = false;
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}
	push(event) {
		if (this.done) return;
		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}
		const waiter = this.waiting.shift();
		if (waiter) waiter({ value: event, done: false });
		else this.queue.push(event);
	}
	end(result) {
		this.done = true;
		if (result !== undefined) this.resolveFinalResult(result);
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift();
			waiter({ value: undefined, done: true });
		}
	}
	async *[Symbol.asyncIterator]() {
		while (true) {
			if (this.queue.length > 0) yield this.queue.shift();
			else if (this.done) return;
			else {
				const result = await new Promise((resolve) => this.waiting.push(resolve));
				if (result.done) return;
				yield result.value;
			}
		}
	}
	result() {
		return this.finalResultPromise;
	}
}

function createAssistantMessageEventStream() {
	return new _EventStream(
		(event) => event.type === "done" || event.type === "error",
		(event) => {
			if (event.type === "done") return event.message;
			if (event.type === "error") return event.error;
			throw new Error("Unexpected event type for final result");
		},
	);
}

// Real StreamFn — spawns the `pi` binary as a child process. pi is already
// routed through pi-shell-acp (claude/codex/gemini ACP children). We act as a
// pass-through proxy: pi emits AssistantMessageEvent-shaped events via
// --mode json on stdout, we re-emit them onto our pi-ai stream.
//
// This is a PoC stub — real plugin (in pi-shell-acp repo) will use ACP stdio
// framing directly instead of shelling out to the pi CLI.
import { spawn } from "node:child_process";

function extractTextFromMessage(msg) {
	if (!msg) return "";
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.filter((c) => c && c.type === "text" && typeof c.text === "string")
			.map((c) => c.text)
			.join("\n");
	}
	return "";
}

function _extractLastUserText(context) {
	if (!context || !Array.isArray(context.messages)) return "";
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (!msg || msg.role !== "user") continue;
		const text = extractTextFromMessage(msg);
		if (text) return text;
	}
	return "";
}

// Serialize OpenClaw's full conversation history into a single prompt for
// pi -p. pi non-interactive only accepts a single user turn, so we encode the
// prior turns as a transcript prefix. This keeps OpenClaw as the source of
// truth for conversation state — pi doesn't need its own session.
//
// Real plugin (Step 2) will use long-lived ACP stdio framing instead.
function buildConversationPrompt(context) {
	const messages = context && Array.isArray(context.messages) ? context.messages : [];
	if (messages.length === 0) return "";
	const lastIdx = messages.length - 1;
	const lastMsg = messages[lastIdx];
	const lastUserText = lastMsg && lastMsg.role === "user" ? extractTextFromMessage(lastMsg) : "";

	// Build transcript from earlier turns (everything before the current user
	// message). Skip non-user/assistant roles (tool results, custom, etc.).
	const priorTurns = [];
	for (let i = 0; i < lastIdx; i++) {
		const m = messages[i];
		if (!m) continue;
		const text = extractTextFromMessage(m);
		if (!text) continue;
		if (m.role === "user") priorTurns.push(`User: ${text}`);
		else if (m.role === "assistant") priorTurns.push(`Assistant: ${text}`);
	}

	if (priorTurns.length === 0) return lastUserText;

	return [
		"[Earlier in this conversation]",
		priorTurns.join("\n\n"),
		"",
		"[Current user message — respond to this, using the conversation context above]",
		lastUserText,
	].join("\n");
}

function buildEmptyAssistantMessage(model) {
	return {
		role: "assistant",
		content: [],
		api: (model && model.api) || PROVIDER_ID,
		provider: (model && model.provider) || PROVIDER_ID,
		model: (model && model.id) || "claude-sonnet-4-6",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

function realStreamFn(model, context, options, factoryCtx) {
	const stream = createAssistantMessageEventStream();
	// Serialize full conversation history into a single prompt — pi non-interactive
	// is stateless per call, so OpenClaw's context.messages is the source of truth.
	const userText = buildConversationPrompt(context);
	const signal = options && options.signal;

	if (!userText) {
		const empty = buildEmptyAssistantMessage(model);
		empty.stopReason = "error";
		empty.errorMessage = "No user text in context.messages";
		queueMicrotask(() => stream.end(empty));
		return stream;
	}

	// DIAGNOSTIC: log to stdout so gateway log captures context shape.
	try {
		const msgs = context && Array.isArray(context.messages) ? context.messages : [];
		const roles = msgs.map((m) => (m && m.role) || "?").join(",");
		const lastN = msgs.slice(-3).map((m) => {
			const t = extractTextFromMessage(m);
			return `${(m && m.role) || "?"}:${t.slice(0, 60)}`;
		});
		const optsKeys = options ? Object.keys(options).join(",") : "(none)";
		console.log(
			`[pi-shell-acp DIAG] turn` +
				` msgs=${msgs.length}` +
				` roles=${roles}` +
				` optsKeys=${optsKeys}` +
				` sessionId=${(options && options.sessionId) || "-"}` +
				` workspaceDir=${(factoryCtx && factoryCtx.workspaceDir) || "-"}` +
				` lastN=${JSON.stringify(lastN)}` +
				` userTextLen=${userText.length}`,
		);
	} catch (err) {
		console.log("[pi-shell-acp DIAG] error: " + String(err && err.message ? err.message : err));
	}

	// Resolve workspace directory: factoryCtx (captured at createStreamFn time)
	// carries OpenClaw's workspaceDir + agentDir. pi-ai's runtime Context only
	// has {systemPrompt, messages, tools} — no workspace info — so we must
	// close over the factory ctx and pass it through.
	const workspaceDir =
		(factoryCtx && typeof factoryCtx.workspaceDir === "string" && factoryCtx.workspaceDir) ||
		(context && typeof context.workspaceDir === "string" && context.workspaceDir) ||
		(options && typeof options.workspaceDir === "string" && options.workspaceDir) ||
		null;

	// Args: non-interactive, no exec tools (OpenClaw owns tool dispatch), JSON
	// event stream, ephemeral pi session (OpenClaw owns conversation state).
	// We let pi load workspace context files + skills from the workspace cwd.
	// The userText prompt already contains the full conversation transcript
	// built by buildConversationPrompt().
	const args = ["-p", userText, "--no-session", "--no-tools", "--mode", "json", "--offline"];

	let child;
	try {
		child = spawn("pi", args, {
			stdio: ["ignore", "pipe", "pipe"],
			cwd: workspaceDir || undefined,
			env: { ...process.env, PI_OFFLINE: "1" },
		});
	} catch (err) {
		const empty = buildEmptyAssistantMessage(model);
		empty.stopReason = "error";
		empty.errorMessage = "Failed to spawn pi: " + String(err && err.message ? err.message : err);
		queueMicrotask(() => stream.end(empty));
		return stream;
	}

	if (signal && typeof signal.addEventListener === "function") {
		signal.addEventListener("abort", () => {
			try {
				child.kill("SIGTERM");
			} catch {}
		});
	}

	let buffer = "";
	let finalMessage = null;
	let started = false;

	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		let nl = buffer.indexOf("\n");
		while (nl >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line) continue;
			let event;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			if (!event || typeof event.type !== "string") continue;

			// pi --mode json emits message_update wrapping a pi-ai
			// AssistantMessageEvent. Re-emit the inner event onto our stream.
			if (event.type === "message_update" && event.assistantMessageEvent) {
				const inner = event.assistantMessageEvent;
				if (!started) {
					stream.push({
						type: "start",
						partial: inner.partial || buildEmptyAssistantMessage(model),
					});
					started = true;
				}
				try {
					stream.push(inner);
				} catch {
					// ignore unknown event variants
				}
				continue;
			}

			// message_end / turn_end carry the final AssistantMessage.
			if ((event.type === "message_end" || event.type === "turn_end") && event.message) {
				finalMessage = event.message;
			}

			nl = buffer.indexOf("\n");
		}
	});

	let stderrBuf = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderrBuf += chunk;
	});

	child.on("error", (err) => {
		const fallback = buildEmptyAssistantMessage(model);
		fallback.stopReason = "error";
		fallback.errorMessage = "pi child error: " + String(err && err.message ? err.message : err);
		if (!started) {
			stream.push({ type: "start", partial: fallback });
		}
		stream.end(fallback);
	});

	child.on("close", (code, sigSignal) => {
		if (finalMessage) {
			stream.push({ type: "done", message: finalMessage });
			stream.end(finalMessage);
			return;
		}
		const fallback = buildEmptyAssistantMessage(model);
		fallback.stopReason = "error";
		fallback.errorMessage =
			"pi exited without final message (code=" +
			String(code) +
			" signal=" +
			String(sigSignal) +
			"). stderr=" +
			stderrBuf.slice(-2000);
		if (!started) {
			stream.push({ type: "start", partial: fallback });
		}
		stream.end(fallback);
	});

	return stream;
}

const providerPlugin = {
	id: PROVIDER_ID,
	label: "pi-shell-acp (stub)",
	staticCatalog: {
		run() {
			return {
				provider: PROVIDER_ID,
				models: STUB_MODELS.map((m) => ({
					id: m.id,
					name: m.name,
					api: m.api,
					input: m.input,
					cost: m.cost,
					contextWindow: m.contextWindow,
					maxTokens: m.maxTokens,
					reasoning: m.reasoning,
				})),
			};
		},
	},
	resolveDynamicModel(ctx) {
		return stubModel(ctx.modelId);
	},
	createStreamFn(ctx) {
		// Close over the factory ctx so realStreamFn knows workspaceDir/agentDir.
		return (model, context, options) => realStreamFn(model, context, options, ctx);
	},
	// Synthetic auth bypass — pi-shell-acp delegates auth to the child pi
	// binary's own credentials, so no OpenClaw-side auth profile is required.
	resolveSyntheticAuth(_ctx) {
		return {
			apiKey: "pi-shell-acp-delegated",
			source: "pi-shell-acp plugin (delegated to child pi binary)",
			mode: "api-key",
		};
	},
};

const configSchema = {
	safeParse(value) {
		if (value === undefined || value === null) {
			return { success: true, data: undefined };
		}
		if (typeof value !== "object" || Array.isArray(value)) {
			return { success: false, error: { issues: [{ path: [], message: "expected object" }] } };
		}
		return { success: true, data: value };
	},
	jsonSchema: { type: "object", additionalProperties: true },
};

const entry = {
	id: PROVIDER_ID,
	name: PROVIDER_ID,
	description: "pi-shell-acp stub plugin for (b3a) end-to-end smoke",
	configSchema,
	register(api) {
		try {
			api.registerProvider(providerPlugin);
			if (api && api.logger && typeof api.logger.info === "function") {
				api.logger.info("[pi-shell-acp stub] provider registered");
			}
		} catch (err) {
			const msg = err && err.message ? err.message : String(err);
			if (api && api.logger && typeof api.logger.error === "function") {
				api.logger.error("[pi-shell-acp stub] registerProvider failed: " + msg);
			} else {
				console.error("[pi-shell-acp stub] registerProvider failed:", msg);
			}
			throw err;
		}
	},
};

export default entry;
