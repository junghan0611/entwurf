// (b3a) End-to-end smoke stub — NOT the real pi-shell-acp transport.
// Purpose: prove plugin SDK surfaces model rows AND dispatches createStreamFn
// before pi-shell-acp 측 fills in the real stdio ACP transport.
//
// Once Step 2 (pi-shell-acp/openclaw-plugin/) lands, this stub is replaced.
//
// Types are intentionally local minimal interfaces, not imports from
// @earendil-works/pi-ai or @openclaw/plugin-sdk. The stub stays
// dependency-free in Phase 1 — the strict guards exist for the surface this
// file actually touches, and Phase 1.4 swaps these for SDK types proper.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
const PROVIDER_ID = "pi-shell-acp";
// ───────────────────────── stub models ─────────────────────────
// Curated to match pi-shell-acp's SUPPORTED_*_MODEL_IDS in root index.ts.
// Claude: claude-sonnet-4-6, claude-opus-4-7 (Opus surfaces at 1M context
// per root index.ts §"opus-4-6 / opus-4-7 surface at 1M by default").
// Codex: gpt-5.4, gpt-5.5 (no -mini in the bridge's curated surface).
// Gemini: gemini-3.1-pro-preview only.
// contextWindow / maxTokens / cost are placeholder values for OpenClaw's
// dropdown display only — the real routing values come from pi-shell-acp's
// runtime resolver. Tightening these to match the bridge exactly is a
// Phase 1.4 ts refactor item.
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
        id: "claude-opus-4-7",
        name: "claude-opus-4-7",
        api: PROVIDER_ID,
        provider: PROVIDER_ID,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
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
        id: "gpt-5.5",
        name: "gpt-5.5",
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
    if (match)
        return match;
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
class EventStream {
    isComplete;
    extractResult;
    queue = [];
    waiting = [];
    done = false;
    resolveFinalResult;
    finalResultPromise;
    constructor(isComplete, extractResult) {
        this.isComplete = isComplete;
        this.extractResult = extractResult;
        this.finalResultPromise = new Promise((resolve) => {
            this.resolveFinalResult = resolve;
        });
    }
    push(event) {
        if (this.done)
            return;
        if (this.isComplete(event)) {
            this.done = true;
            this.resolveFinalResult(this.extractResult(event));
        }
        const waiter = this.waiting.shift();
        if (waiter)
            waiter({ value: event, done: false });
        else
            this.queue.push(event);
    }
    end(result) {
        this.done = true;
        if (result !== undefined)
            this.resolveFinalResult(result);
        while (this.waiting.length > 0) {
            const waiter = this.waiting.shift();
            if (waiter)
                waiter({ value: undefined, done: true });
        }
    }
    async *[Symbol.asyncIterator]() {
        while (true) {
            const next = this.queue.shift();
            if (next !== undefined)
                yield next;
            else if (this.done)
                return;
            else {
                const result = await new Promise((resolve) => {
                    this.waiting.push(resolve);
                });
                if (result.done || result.value === undefined)
                    return;
                yield result.value;
            }
        }
    }
    result() {
        return this.finalResultPromise;
    }
}
function createAssistantMessageEventStream() {
    return new EventStream((event) => event.type === "done" || event.type === "error", (event) => {
        if (event.type === "done") {
            const msg = event.message;
            if (msg)
                return msg;
        }
        if (event.type === "error") {
            const err = event.error;
            if (err)
                return err;
        }
        throw new Error("Unexpected event type for final result");
    });
}
// ───────────────────────── content / message helpers ─────────────────────────
function extractTextFromMessage(msg) {
    if (!msg)
        return "";
    // Route through normalizeContentBlocks so element-level string entries and
    // type-less `{text}` recovery shapes are captured here too, not only at the
    // outbound boundary. Keeps text extraction symmetric with the rest of the
    // normalization story.
    return normalizeContentBlocks(msg.content)
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
}
// Coerce arbitrary `content` shapes into the AssistantMessage array shape that
// OpenClaw downstream paths assume. pi-ai's spec is array-only, but pi child
// processes can emit string/null/undefined/object at every edge — top-level
// content as a bare string, array entries that are bare strings, partial
// objects without a `type` discriminator (recovery snapshots that only carry
// `text`), single-object content (not yet wrapped in an array). A single
// `.filter()` on any non-array crashes a turn in OpenClaw's display projection
// or chat gateway. This normalizer is the only outbound boundary we control,
// so we (1) salvage whatever we can into valid blocks (string → text block,
// `{text}` → text block) and (2) drop the rest. The goal is "no thrown turn,
// no silent visible-text loss" — issue #17 success criteria.
function normalizeContentBlock(block) {
    if (typeof block === "string") {
        return block ? { type: "text", text: block } : null;
    }
    if (!block || typeof block !== "object")
        return null;
    const b = block;
    if (typeof b.type === "string")
        return block;
    if (typeof b.text === "string" && b.text)
        return { type: "text", text: b.text };
    return null;
}
function normalizeContentBlocks(content) {
    if (Array.isArray(content)) {
        return content.map(normalizeContentBlock).filter((b) => b !== null);
    }
    const one = normalizeContentBlock(content);
    return one ? [one] : [];
}
// Outbound assistant content policy — child-emitted tool_use / tool_result /
// thinking blocks (and any non-text block) get stripped before the message
// crosses into OpenClaw's visible chat surface. OpenClaw's downstream
// renderer treats unknown typed blocks as code-block / trace artifacts, so
// passing them through leaks tool internals into the bot reply body. The
// only visible body we surface is type:"text". Synthetic message-tool
// deliveries are built in buildMessageToolCallAssistantMessage() and pushed
// without going through this normalizer, so the message-tool delivery path
// is unaffected.
function normalizeVisibleTextBlocks(content) {
    return normalizeContentBlocks(content).flatMap((block) => {
        if (block.type === "text" && typeof block.text === "string") {
            return [{ type: "text", text: block.text }];
        }
        return [];
    });
}
function normalizeAssistantMessage(raw, model) {
    const defaults = buildEmptyAssistantMessage(model);
    if (!raw || typeof raw !== "object")
        return defaults;
    const r = raw;
    const out = {
        role: "assistant",
        content: normalizeVisibleTextBlocks(r.content),
        api: typeof r.api === "string" && r.api ? r.api : defaults.api,
        provider: typeof r.provider === "string" && r.provider ? r.provider : defaults.provider,
        model: typeof r.model === "string" && r.model ? r.model : defaults.model,
        usage: r.usage && typeof r.usage === "object" ? r.usage : defaults.usage,
    };
    if (typeof r.stopReason === "string" && r.stopReason)
        out.stopReason = r.stopReason;
    if (typeof r.errorMessage === "string")
        out.errorMessage = r.errorMessage;
    if (typeof r.timestamp === "number")
        out.timestamp = r.timestamp;
    return out;
}
// Serialize OpenClaw's full conversation history into a single prompt for
// pi -p. pi non-interactive only accepts a single user turn, so we encode the
// prior turns as a transcript prefix. This keeps OpenClaw as the source of
// truth for conversation state — pi doesn't need its own session.
//
// Real plugin (Step 2) will use long-lived ACP stdio framing instead.
function buildConversationPrompt(context) {
    const messages = context && Array.isArray(context.messages) ? context.messages : [];
    if (messages.length === 0)
        return "";
    const lastIdx = messages.length - 1;
    const lastMsg = messages[lastIdx];
    const lastUserText = lastMsg && lastMsg.role === "user" ? extractTextFromMessage(lastMsg) : "";
    const priorTurns = [];
    for (let i = 0; i < lastIdx; i++) {
        const m = messages[i];
        if (!m)
            continue;
        const text = extractTextFromMessage(m);
        if (!text)
            continue;
        if (m.role === "user")
            priorTurns.push(`User: ${text}`);
        else if (m.role === "assistant")
            priorTurns.push(`Assistant: ${text}`);
    }
    if (priorTurns.length === 0)
        return lastUserText;
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
function isMessageToolDeliveryPrompt(text) {
    return typeof text === "string" && text.includes("Delivery: to send a message, use the `message` tool.");
}
function parseJsonBlocks(text) {
    const blocks = [];
    if (typeof text !== "string" || !text)
        return blocks;
    const re = /```json\s*([\s\S]*?)```/g;
    let match = re.exec(text);
    while (match) {
        try {
            blocks.push(JSON.parse(match[1]));
        }
        catch {
            // Ignore untrusted/non-JSON blocks.
        }
        match = re.exec(text);
    }
    return blocks;
}
function extractMessageDeliveryArgs(text, replyText) {
    const blocks = parseJsonBlocks(text);
    let conversationInfo = null;
    for (const block of blocks) {
        if (block && typeof block === "object") {
            const b = block;
            if (b.chat_id || b.message_id || b.topic_id) {
                conversationInfo = b;
                break;
            }
        }
    }
    const rawTo = conversationInfo && typeof conversationInfo.chat_id === "string" && conversationInfo.chat_id.trim()
        ? conversationInfo.chat_id.trim()
        : null;
    const to = rawTo || "telegram";
    const provider = to.includes(":") ? to.split(":", 1)[0] : "telegram";
    const args = {
        action: "send",
        channel: provider,
        to,
        message: replyText || "",
    };
    if (conversationInfo && typeof conversationInfo.topic_id === "string" && conversationInfo.topic_id.trim()) {
        args.threadId = conversationInfo.topic_id.trim();
    }
    return args;
}
function extractAssistantText(message) {
    return extractTextFromMessage(message).trim();
}
function buildMessageToolCallAssistantMessage(model, promptText, replyText) {
    const message = buildEmptyAssistantMessage(model);
    message.content = [
        {
            type: "toolCall",
            id: "pi-shell-acp-message-" + Date.now().toString(36),
            name: "message",
            arguments: extractMessageDeliveryArgs(promptText, replyText),
        },
    ];
    message.stopReason = "toolUse";
    message.timestamp = Date.now();
    return message;
}
function isAfterSyntheticMessageToolResult(context) {
    const messages = context && Array.isArray(context.messages) ? context.messages : [];
    const last = messages[messages.length - 1];
    if (!last || last.role !== "toolResult")
        return false;
    for (let i = messages.length - 2; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content))
            continue;
        return msg.content.some((block) => Boolean(block) &&
            typeof block === "object" &&
            block.type === "toolCall" &&
            block.name === "message" &&
            typeof block.id === "string" &&
            block.id.startsWith("pi-shell-acp-message-"));
    }
    return false;
}
// ───────────────────────── stream function ─────────────────────────
function realStreamFn(model, context, options, factoryCtx) {
    const stream = createAssistantMessageEventStream();
    if (isAfterSyntheticMessageToolResult(context)) {
        const done = buildEmptyAssistantMessage(model);
        done.stopReason = "end_turn";
        done.timestamp = Date.now();
        queueMicrotask(() => {
            stream.push({ type: "start", partial: done });
            stream.push({ type: "done", reason: done.stopReason, message: done });
            stream.end(done);
        });
        return stream;
    }
    // Serialize full conversation history into a single prompt — pi non-interactive
    // is stateless per call, so OpenClaw's context.messages is the source of truth.
    const userText = buildConversationPrompt(context);
    const deliveryViaMessageTool = isMessageToolDeliveryPrompt(userText);
    const signal = options && options.signal;
    // Plugin config (from openclaw.plugin.json configSchema). The factoryCtx
    // shape is OpenClaw's, so we feel for the conventional location and fall
    // back to defaults if it is shaped differently than expected.
    const pluginConfig = (factoryCtx && (factoryCtx.pluginConfig || factoryCtx.config || factoryCtx.settings)) || {};
    const piBinary = typeof pluginConfig.piBinaryPath === "string" && pluginConfig.piBinaryPath.length > 0
        ? pluginConfig.piBinaryPath
        : "pi";
    const spawnTimeoutMs = (typeof pluginConfig.spawnTimeoutSeconds === "number" && pluginConfig.spawnTimeoutSeconds > 0
        ? pluginConfig.spawnTimeoutSeconds
        : 60) * 1000;
    if (!userText) {
        const empty = buildEmptyAssistantMessage(model);
        empty.stopReason = "error";
        empty.errorMessage = "No user text in context.messages";
        queueMicrotask(() => {
            stream.push({ type: "error", error: empty });
            stream.end(empty);
        });
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
        console.log(`[pi-shell-acp DIAG] turn` +
            ` msgs=${msgs.length}` +
            ` roles=${roles}` +
            ` optsKeys=${optsKeys}` +
            ` sessionId=${(options && options.sessionId) || "-"}` +
            ` workspaceDir=${(factoryCtx && factoryCtx.workspaceDir) || "-"}` +
            ` lastN=${JSON.stringify(lastN)}` +
            ` userTextLen=${userText.length}`);
    }
    catch (err) {
        console.log("[pi-shell-acp DIAG] error: " + String(err instanceof Error ? err.message : err));
    }
    // Resolve workspace directory: factoryCtx (captured at createStreamFn time)
    // carries OpenClaw's workspaceDir + agentDir. pi-ai's runtime Context only
    // has {systemPrompt, messages, tools} — no workspace info — so we must
    // close over the factory ctx and pass it through.
    const workspaceDir = (factoryCtx && typeof factoryCtx.workspaceDir === "string" && factoryCtx.workspaceDir) ||
        (context && typeof context.workspaceDir === "string" && context.workspaceDir) ||
        (options && typeof options.workspaceDir === "string" && options.workspaceDir) ||
        null;
    // Args: non-interactive, no exec tools (OpenClaw owns tool dispatch), JSON
    // event stream, ephemeral pi session (OpenClaw owns conversation state).
    // We let pi load workspace context files + skills from the workspace cwd.
    // The userText prompt already contains the full conversation transcript
    // built by buildConversationPrompt(). When OpenClaw's inbound delivery
    // prompt requires the `message` tool, the child pi still runs with
    // --no-tools; this stub converts the final assistant text into an OpenClaw
    // message toolCall at the provider boundary.
    const modelId = (model && typeof model.id === "string" && model.id) || "claude-sonnet-4-6";
    const args = [
        "-p",
        userText,
        "--no-session",
        "--no-tools",
        "--mode",
        "json",
        "--offline",
        "--provider",
        PROVIDER_ID,
        "--model",
        modelId,
    ];
    let child;
    console.log(`[pi-shell-acp DIAG] pre-spawn` +
        ` signalPresent=${signal ? "1" : "0"}` +
        ` signalAborted=${signal && signal.aborted ? "1" : "0"}` +
        ` model=${modelId}` +
        ` deliveryViaMessageTool=${deliveryViaMessageTool ? "1" : "0"}`);
    try {
        child = spawn(piBinary, args, {
            stdio: ["ignore", "pipe", "pipe"],
            cwd: workspaceDir || undefined,
            env: { ...process.env, PI_OFFLINE: "1" },
        });
    }
    catch (err) {
        const empty = buildEmptyAssistantMessage(model);
        empty.stopReason = "error";
        empty.errorMessage = "Failed to spawn '" + piBinary + "': " + String(err instanceof Error ? err.message : err);
        queueMicrotask(() => {
            stream.push({ type: "error", error: empty });
            stream.end(empty);
        });
        return stream;
    }
    console.log(`[pi-shell-acp DIAG] child spawned pid=${child.pid || "-"}` +
        ` model=${modelId}` +
        ` deliveryViaMessageTool=${deliveryViaMessageTool ? "1" : "0"}` +
        ` timeoutMs=${spawnTimeoutMs}`);
    let finalized = false;
    let exitFallbackTimer = null;
    let zombiePollTimer = null;
    let buffer = "";
    let finalMessage = null;
    let lastPartial = null;
    let lastFinalRole = null;
    let started = false;
    let stderrBuf = "";
    let timeoutFired = false;
    function finalizeChild(kind, code, sigSignal) {
        if (finalized)
            return;
        finalized = true;
        clearTimeout(spawnTimer);
        if (exitFallbackTimer)
            clearTimeout(exitFallbackTimer);
        if (zombiePollTimer)
            clearInterval(zombiePollTimer);
        // abnormal indicator — any signal that the child did not exit cleanly,
        // including the SIGTERM-driven `kind="close"` case where the spawnTimer
        // fires but the close listener wins the race (Node reports code=143 or
        // code=null + signal="SIGTERM"). When abnormal we treat finalMessage
        // with suspicion: if a longer partial buffer exists, that visible text
        // is almost certainly closer to what the user actually saw streamed.
        const abnormal = timeoutFired ||
            kind === "timeout" ||
            kind === "abort" ||
            kind === "error" ||
            kind.startsWith("poll:") ||
            (typeof code === "number" && code !== 0) ||
            sigSignal != null;
        const partialText = lastPartial ? extractTextFromMessage(lastPartial) : "";
        const finalText = finalMessage ? extractTextFromMessage(finalMessage) : "";
        const partialOverridesFinal = abnormal && partialText.length > finalText.length;
        if (partialOverridesFinal && lastPartial) {
            finalMessage = normalizeAssistantMessage({
                ...lastPartial,
                stopReason: lastPartial.stopReason || "end_turn",
                timestamp: lastPartial.timestamp || Date.now(),
            }, model);
        }
        // Trace artifact recovery: if child died without a message_end but a
        // partial snapshot has useful text, promote it to the final message so
        // OpenClaw still surfaces visible assistant text. Issue #17 success
        // criterion — "avoid losing visible recovery when trace artifacts
        // contain useful assistant text".
        const recoveredFromPartial = !finalMessage && lastPartial && extractTextFromMessage(lastPartial).trim().length > 0;
        if (recoveredFromPartial && lastPartial) {
            finalMessage = normalizeAssistantMessage({
                ...lastPartial,
                stopReason: lastPartial.stopReason || "end_turn",
                timestamp: lastPartial.timestamp || Date.now(),
            }, model);
        }
        const visibleFinalText = finalMessage ? extractTextFromMessage(finalMessage) : "";
        console.log(`[pi-shell-acp DIAG] child finalize kind=${kind}` +
            ` code=${String(code)}` +
            ` signal=${String(sigSignal)}` +
            ` hasFinal=${finalMessage ? "1" : "0"}` +
            ` finalRole=${lastFinalRole ?? "(none)"}` +
            ` finalTextLen=${visibleFinalText.length}` +
            ` finalTextHead=${JSON.stringify(visibleFinalText.slice(0, 80))}` +
            ` partialTextLen=${partialText.length}` +
            ` partialOverridesFinal=${partialOverridesFinal ? "1" : "0"}` +
            ` recoveredFromPartial=${recoveredFromPartial ? "1" : "0"}` +
            ` abnormal=${abnormal ? "1" : "0"}` +
            ` timeoutFired=${timeoutFired ? "1" : "0"}` +
            ` stderrTail=${JSON.stringify(stderrBuf.slice(-500))}`);
        if (finalMessage) {
            if (deliveryViaMessageTool) {
                const replyText = extractAssistantText(finalMessage);
                const toolMessage = buildMessageToolCallAssistantMessage(model, userText, replyText);
                stream.push({ type: "start", partial: toolMessage });
                stream.push({ type: "done", reason: toolMessage.stopReason, message: toolMessage });
                stream.end(toolMessage);
                return;
            }
            stream.push({ type: "done", message: finalMessage });
            stream.end(finalMessage);
            return;
        }
        const fallback = buildEmptyAssistantMessage(model);
        fallback.stopReason = "error";
        fallback.errorMessage =
            "pi exited without final message (kind=" +
                String(kind) +
                " code=" +
                String(code) +
                " signal=" +
                String(sigSignal) +
                "). stderr=" +
                stderrBuf.slice(-2000);
        if (!started) {
            stream.push({ type: "start", partial: fallback });
        }
        stream.push({ type: "error", error: fallback });
        stream.end(fallback);
    }
    // spawnTimeoutSeconds — bound the child lifetime. PoC stub treats this as
    // a turn-level cap; the real plugin will use it strictly for ACP bootstrap.
    const spawnTimer = setTimeout(() => {
        timeoutFired = true;
        console.log(`[pi-shell-acp DIAG] child timeout pid=${child.pid || "-"} timeoutMs=${spawnTimeoutMs}`);
        try {
            child.kill("SIGTERM");
        }
        catch { }
        setTimeout(() => finalizeChild("timeout", null, "SIGTERM"), 1000).unref?.();
    }, spawnTimeoutMs);
    function readLinuxProcessState(pid) {
        if (!pid || process.platform !== "linux")
            return null;
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
            const end = stat.lastIndexOf(")");
            const rest = end >= 0
                ? stat
                    .slice(end + 2)
                    .trim()
                    .split(/\s+/)
                : [];
            return rest[0] || null;
        }
        catch {
            return "missing";
        }
    }
    zombiePollTimer = setInterval(() => {
        if (finalized)
            return;
        const state = readLinuxProcessState(child.pid);
        if (state === "Z" || state === "X" || state === "missing") {
            console.log(`[pi-shell-acp DIAG] child poll finalize pid=${child.pid || "-"}` + ` procState=${String(state)}`);
            finalizeChild(`poll:${String(state)}`, null, null);
        }
    }, 1000);
    zombiePollTimer.unref?.();
    if (signal && typeof signal.addEventListener === "function") {
        if (signal.aborted) {
            console.log(`[pi-shell-acp DIAG] options.signal already-aborted pid=${child.pid || "-"}`);
        }
        signal.addEventListener("abort", () => {
            console.log(`[pi-shell-acp DIAG] options.signal abort pid=${child.pid || "-"}`);
            try {
                child.kill("SIGTERM");
            }
            catch { }
            setTimeout(() => finalizeChild("abort", null, "SIGTERM"), 1000).unref?.();
        }, { once: true });
    }
    if (child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            buffer += chunk;
            while (true) {
                const nl = buffer.indexOf("\n");
                if (nl < 0)
                    break;
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line)
                    continue;
                let event;
                try {
                    event = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (!event || typeof event.type !== "string")
                    continue;
                // pi --mode json emits message_update wrapping a pi-ai
                // AssistantMessageEvent. Re-emit the inner event onto our stream.
                if (event.type === "message_update" && event.assistantMessageEvent) {
                    const inner = event.assistantMessageEvent;
                    if (inner && typeof inner === "object" && inner.partial) {
                        inner.partial = normalizeAssistantMessage(inner.partial, model);
                        lastPartial = inner.partial;
                    }
                    // For Telegram/message-tool-only delivery, do not leak the child pi's
                    // plain text deltas as visible assistant text. Buffer until finalMessage,
                    // then synthesize a message toolCall.
                    if (deliveryViaMessageTool) {
                        continue;
                    }
                    if (!started) {
                        stream.push({
                            type: "start",
                            partial: (inner && inner.partial) || buildEmptyAssistantMessage(model),
                        });
                        started = true;
                    }
                    try {
                        stream.push(inner);
                    }
                    catch {
                        // ignore unknown event variants
                    }
                    continue;
                }
                // message_end / turn_end carry the final AssistantMessage. The pi
                // child has been observed (Oracle bbot, 2026-05-16) to emit a
                // message_end whose event.message echoes a user-role metadata
                // message from the input prompt when the child gets SIGTERM'd
                // before finishing a real response. normalizeAssistantMessage
                // would silently re-stamp role="assistant" and ship that echo
                // as the visible reply. Gate the assignment on the original
                // role so non-assistant finals leave finalMessage null — the
                // lastPartial recovery path in finalizeChild then surfaces the
                // streamed body the user actually saw.
                if ((event.type === "message_end" || event.type === "turn_end") && event.message) {
                    const rawRole = event.message && typeof event.message === "object" ? event.message.role : undefined;
                    lastFinalRole = typeof rawRole === "string" ? rawRole : "(missing)";
                    if (rawRole === "assistant") {
                        finalMessage = normalizeAssistantMessage(event.message, model);
                    }
                }
            }
        });
    }
    if (child.stderr) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderrBuf += chunk;
        });
    }
    child.on("error", (err) => {
        stderrBuf += "\n[child error] " + String(err && err.message ? err.message : err);
        finalizeChild("error", null, null);
    });
    // Some backend children may exit while inherited stdio keeps `close` from
    // firing promptly. Finish on `exit` after a short grace period so OpenClaw's
    // turn does not stay `processing` forever with a defunct pi child.
    child.on("exit", (code, sigSignal) => {
        console.log(`[pi-shell-acp DIAG] child exit pid=${child.pid || "-"}` +
            ` code=${String(code)}` +
            ` signal=${String(sigSignal)}`);
        exitFallbackTimer = setTimeout(() => finalizeChild("exit", code, sigSignal), 500);
        exitFallbackTimer.unref?.();
    });
    child.on("close", (code, sigSignal) => {
        finalizeChild("close", code, sigSignal);
    });
    return stream;
}
// ───────────────────────── plugin registration ─────────────────────────
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (api && api.logger && typeof api.logger.error === "function") {
                api.logger.error("[pi-shell-acp stub] registerProvider failed: " + msg);
            }
            else {
                console.error("[pi-shell-acp stub] registerProvider failed:", msg);
            }
            throw err;
        }
    },
};
export default entry;
//# sourceMappingURL=index.js.map