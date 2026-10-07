                                                                                                     
             
	               
	            
	           
	          
	          
	              
	           
                                    
import {
	Box,
	               
	Container,
	               
	fuzzyFilter,
	getKeybindings,
	Input,
	Markdown,
	ProcessTerminal,
	ScrollView,
	                
	SelectList,
	                     
	Spacer,
	setCapabilityOverrides,
	setKeybindings,
	Text,
	TruncatedText,
	TuiAltScreen,
	VStack,
} from "@earendil-works/pi-tui";
import { getAgentDir } from "entwurf-pi-dist:config.js";
import { KeybindingsManager } from "entwurf-pi-dist:core/keybindings.js";
                                                                      
import { createAllToolRenderers } from "entwurf-pi-dist:core/tools/renderers/index.js";
import { AssistantMessageComponent } from "entwurf-pi-dist:modes/interactive/components/assistant-message.js";
import { CustomEditor } from "entwurf-pi-dist:modes/interactive/components/custom-editor.js";
import { DynamicBorder } from "entwurf-pi-dist:modes/interactive/components/dynamic-border.js";
import { formatTokens } from "entwurf-pi-dist:modes/interactive/components/footer.js";
import { keyText } from "entwurf-pi-dist:modes/interactive/components/keybinding-hints.js";
import {                       WorkingStatusIndicator } from "entwurf-pi-dist:modes/interactive/components/status-indicator.js";
import { ToolExecutionComponent,                    } from "entwurf-pi-dist:modes/interactive/components/tool-execution.js";
import { UserMessageComponent } from "entwurf-pi-dist:modes/interactive/components/user-message.js";
import { getEditorTheme, getMarkdownTheme, initTheme, theme } from "entwurf-pi-dist:modes/interactive/theme/theme.js";
import { InteractiveThemeController } from "entwurf-pi-dist:modes/interactive/theme/theme-controller.js";
import { agentOf,                                                                  } from "./runtime.js";

const SELECT_THEME                  = {
	selectedPrefix: (text) => theme.fg("accent", text),
	selectedText: (text) => theme.fg("accent", text),
	description: (text) => theme.fg("muted", text),
	scrollInfo: (text) => theme.fg("dim", text),
	noMatch: (text) => theme.fg("warning", text),
};

/** A filterable list in place of the editor. */
class ListSelector extends Container                      {
	         #input = new Input();
	         #listContainer = new Container();
	         #items              ;
	         #onSelect                         ;
	         #onCancel            ;
	#list            ;
	#focused = false;

	constructor(title        , items              , onSelect                         , onCancel            ) {
		super();
		this.#items = items;
		this.#onSelect = onSelect;
		this.#onCancel = onCancel;
		this.#list = this.#build(items);
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		this.addChild(this.#input);
		this.addChild(new Spacer(1));
		this.addChild(this.#listContainer);
		this.addChild(new DynamicBorder());
	}

	get focused()          {
		return this.#focused;
	}
	set focused(value         ) {
		this.#focused = value;
		this.#input.focused = value;
	}

	handleInput(data        )       {
		const keybindings = getKeybindings();
		const forwarded = ["tui.select.up", "tui.select.down", "tui.select.confirm", "tui.select.cancel"]         ;
		if (forwarded.some((action) => keybindings.matches(data, action))) {
			this.#list.handleInput(data);
			return;
		}
		this.#input.handleInput(data);
		const query = this.#input.getValue();
		const filtered =
			query.length === 0 ? this.#items : fuzzyFilter(this.#items, query, (item) => `${item.label} ${item.value}`);
		this.#list = this.#build(filtered);
	}

	#build(items              )             {
		const list = new SelectList(items, 10, SELECT_THEME);
		list.onSelect = (item) => this.#onSelect(item.value);
		list.onCancel = this.#onCancel;
		this.#listContainer.clear();
		this.#listContainer.addChild(list);
		return list;
	}
}

/** The summary that replaced earlier context: collapsed to one line until expanded. */
class CompactionComponent extends Box {
	         #summary        ;

	constructor(summary        , expanded         ) {
		super(1, 1, (text) => theme.bg("customMessageBg", text));
		this.#summary = summary;
		this.setExpanded(expanded);
	}

	setExpanded(expanded         )       {
		this.clear();
		this.addChild(new Text(theme.fg("customMessageLabel", theme.bold("[compaction]")), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(
			expanded
				? new Markdown(this.#summary, 0, 0, getMarkdownTheme(), {
						color: (text        ) => theme.fg("customMessageText", text),
					})
				: new Text(
						theme.fg("customMessageText", "Earlier context summarized (") +
							theme.fg("dim", keyText("app.tools.expand")) +
							theme.fg("customMessageText", " to expand)"),
						0,
						0,
					),
		);
	}
}

                    
	                           
	                             
	              
	             
	                    
	                      
 

class DurableTui {
	static          #renderers                                = createAllToolRenderers();
	         #ui              ;
	         #chat = new Container();
	         #tasks = new Container();
	         #queue = new Container();
	         #notices = new Container();
	         #footer = new Container();
	         #footerStats = new Text("", 1, 0);
	         #footerHints = new Text("", 1, 0);
	         #editorContainer = new Container();
	         #editor              ;
	         #cwd        ;
	/** The newest card per call ID; provider call IDs may repeat across turns. */
	         #tools = new Map                                ();
	/** Every card shown, also older ones whose call ID a later turn reused. */
	         #cards                           = [];
	/** Call IDs whose cards the streaming answer created; its entry takes them over. */
	         #streamingCalls = new Set        ();
	         #summaries                        = [];
	/** Tool output and summaries shown in full; toggled like pi. */
	#expanded = false;
	#renderedEntryIds           = [];
	#streaming                                       ;
	#indicator                             ;
	#statusText = "";
	/** Set when the transcript was rebuilt: the next render repaints the screen and shows the end. */
	#rebuilt = false;
	#transcript            ;

	constructor(cwd        , handlers          ) {
		this.#cwd = cwd;
		this.#ui = new TuiAltScreen(new ProcessTerminal(), false, getAgentDir());
		const keybindings = KeybindingsManager.create();
		setKeybindings(keybindings);
		this.#editor = new CustomEditor(this.#ui, getEditorTheme(), keybindings, {
			paddingX: 1,
			embedWorkingStatus: true,
		});
		this.#editor.onSubmit = handlers.submit;
		this.#editor.onEscape = handlers.abort;
		this.#editor.onCtrlD = handlers.exit;
		this.#editor.onAction("app.clear", handlers.exit);
		this.#editor.onAction("app.model.select", handlers.selectModel);
		this.#editor.onAction("app.thinking.cycle", handlers.cycleThinking);
		this.#editor.onAction("app.tools.expand", () => {
			this.#expanded = !this.#expanded;
			for (const component of [...this.#cards, ...this.#summaries]) component.setExpanded(this.#expanded);
			this.#ui.requestRender();
		});
		this.#editor.onAction("app.message.followUp", () => {
			const text = this.#editor.getText().trim();
			if (!text) return;
			this.#editor.setText("");
			handlers.followUp(text);
		});

		this.#editorContainer.addChild(this.#editor);
		this.#footer.addChild(this.#footerStats);
		this.#footer.addChild(this.#footerHints);
		// One empty line between the transcript and everything below it.
		const content = new Container();
		content.addChild(this.#chat);
		content.addChild(new Spacer(1));
		const transcript = new ScrollView(content, { follow: "end", primary: true, overscroll: "chain" });
		this.#transcript = transcript;
		const dock = new VStack([
			{ component: this.#tasks, shrink: 1, minSize: 0 },
			{ component: this.#queue, shrink: 1, minSize: 0 },
			{ component: this.#notices, shrink: 1, minSize: 0 },
			{ component: this.#editorContainer, shrink: 1, minSize: 3 },
			{ component: this.#footer, shrink: 1, minSize: 0 },
		]);
		for (const component of [
			this.#chat,
			this.#tasks,
			this.#queue,
			this.#notices,
			this.#editorContainer,
			this.#footer,
		]) {
			this.#ui.addChild(component);
		}
		this.#ui.setLayoutRoot(
			new VStack([
				{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
				{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
			]),
		);
		this.#ui.setFocus(this.#editor);
	}

	get ui()               {
		return this.#ui;
	}

	start()       {
		this.#ui.start();
	}

	stop()       {
		this.#discardTools();
		this.#indicator?.dispose();
		this.#ui.stop();
	}

	/** Finish every card: a running bash card keeps a timer until it gets a final result. */
	#discardTools()       {
		for (const component of this.#cards) component.updateResult({ content: [], isError: false }, false);
		this.#cards.length = 0;
		this.#tools.clear();
		this.#streamingCalls.clear();
	}

	mount(component           )       {
		this.#editorContainer.clear();
		this.#editorContainer.addChild(component);
		this.#ui.setFocus(component);
		this.#ui.requestRender();
	}

	restoreEditor()       {
		this.mount(this.#editor);
	}

	apply(view             )       {
		const live = (view.conversation.docs["pi.live"] ?? {})             ;
		this.#syncTranscript(view.conversation.entries);
		const message = live.generation?.message                                ;
		// A partial without its entry was dropped, for example by a retry: render the transcript again.
		if (message === undefined && this.#streaming !== undefined) this.#rebuild(view.conversation.entries);
		if (message !== undefined) this.#syncStreaming(message);
		for (const slot of live.tools ?? []) {
			if (slot.status === "pending") continue;
			const component = this.#tool(slot.name, slot.callId);
			component.setArgsComplete();
			if (slot.status !== "running") continue;
			component.markExecutionStarted();
			const child = (slot.details                                           )?.conversationId;
			if (slot.output === undefined && child !== undefined) {
				const text = `Subagent ${child} is working. /agents switches to it.`;
				component.updateResult({ content: [{ type: "text", text }], details: slot.details, isError: false }, true);
			} else if (slot.output !== undefined) {
				component.updateResult(
					{ content: [{ type: "text", text: slot.output }], details: slot.details, isError: false },
					true,
				);
			}
		}
		this.#syncTasks(view.tasks);
		this.#syncQueue((view.conversation.docs["pi.inbox"] ?? { items: [] })              );
		this.#syncNotices(view);
		this.#editor.borderColor = theme.getThinkingBorderColor(agentOf(view.conversation).thinkingLevel ?? "off");
		this.#syncStatus(live);
		this.#syncFooter(view);
		if (this.#rebuilt) this.#transcript.scrollToEnd();
		this.#ui.requestRender(this.#rebuilt);
		this.#rebuilt = false;
	}

	#syncTasks(graph                       )       {
		this.#tasks.clear();
		if (graph === undefined) return;
		const nodes = Object.values(graph.tasks);
		const lines           = [theme.fg("accent", `Tasks (${nodes.length} live, /tasks to hide)`)];
		// A conversation-owned task sits under the task that owns its conversation, when that task is live.
		const owned = new Set(nodes.flatMap((node) => node.conversations));
		const children = (node               ) =>
			nodes.filter(
				(candidate) =>
					candidate.owner === node.id ||
					(candidate.owner === undefined && node.conversations.includes(candidate.conversationId)),
			);
		const visit = (node               , depth        )       => {
			lines.push(`${"  ".repeat(depth + 1)}${describeTask(node)}`);
			for (const child of children(node)) visit(child, depth + 1);
		};
		for (const node of nodes) {
			if (node.owner === undefined && !owned.has(node.conversationId)) visit(node, 0);
		}
		for (const line of lines) this.#tasks.addChild(new TruncatedText(theme.fg("muted", line), 1, 0));
	}

	#syncQueue(inbox            )       {
		this.#queue.clear();
		for (const item of inbox.items) {
			const text =
				item.mode === "write" ? `<${String(item.entry.kind)}>` : userText(item.content                          );
			this.#queue.addChild(new TruncatedText(theme.fg("muted", `[${item.mode}] ${text}`), 1, 0));
		}
	}

	#syncNotices(view             )       {
		this.#notices.clear();
		for (const item of view.notices.slice(-4)) {
			const color = item.level === "error" ? "error" : item.level === "warning" ? "warning" : "muted";
			this.#notices.addChild(new TruncatedText(theme.fg(color, item.message), 1, 0));
		}
	}

	#syncStatus(live           )       {
		const generation = live.generation;
		const compaction = live.compactions?.[0];
		const runningTool = live.tools?.find((slot) => slot.status === "running");
		let text = "";
		if (generation?.retry !== undefined) {
			text = `Retrying (attempt ${generation.attempt + 1}): ${generation.retry.error}`;
		} else if (generation?.deferred !== undefined) text = "Waiting for deferred response...";
		else if (compaction !== undefined) {
			text = compaction.retry
				? `Retrying ${compaction.reason} compaction (attempt ${compaction.attempt + 1})...`
				: `Compacting (${compaction.reason})...`;
		} else if (runningTool !== undefined) text = `Running ${runningTool.name}... (esc to abort)`;
		else if (live.run !== undefined) text = "Working... (esc to abort)";
		if (text === this.#statusText) return;
		this.#statusText = text;
		this.#indicator?.dispose();
		this.#indicator = text
			? new WorkingStatusIndicator(this.#ui, text, undefined, (part) => this.#editor.borderColor(part))
			: undefined;
		this.#editor.setWorkingStatusIndicator(this.#indicator);
	}

	#syncFooter(view             )       {
		const agent = agentOf(view.conversation);
		const usage = totalUsage((view.conversation.docs["pi.usage"] ?? { models: {}, tools: {} })              );
		const stats           = [];
		if (usage.input) stats.push(`↑${formatTokens(usage.input)}`);
		if (usage.output) stats.push(`↓${formatTokens(usage.output)}`);
		if (usage.cacheRead) stats.push(`R${formatTokens(usage.cacheRead)}`);
		if (usage.cacheWrite) stats.push(`W${formatTokens(usage.cacheWrite)}`);
		stats.push(`$${usage.cost.total.toFixed(3)}`);
		const contextWindow =
			view.models.find((model) => model.provider === agent.model?.provider && model.modelId === agent.model.modelId)
				?.contextWindow ?? 0;
		if (contextWindow > 0) {
			const tokens = contextTokens(view.conversation.entries);
			const percent = tokens === undefined ? undefined : (tokens / contextWindow) * 100;
			const text = `${percent === undefined ? "?" : percent.toFixed(1)}%/${formatTokens(contextWindow)}`;
			stats.push(percent !== undefined && percent > 90 ? theme.fg("error", text) : text);
		}
		this.#footerStats.setText(theme.fg("dim", `${stats.join(" ")}  ${view.session.cwd}`));
		const model = agent.model === undefined ? "no model" : `${agent.model.provider}/${agent.model.modelId}`;
		const shown = view.conversations.find((candidate) => candidate.id === view.conversation.conversation.id);
		const label = shown?.label ?? `conversation ${view.conversation.conversation.id}`;
		this.#footerHints.setText(
			`${theme.fg(label === "main" ? "dim" : "accent", label)}${theme.fg(
				"dim",
				` · ${model} · thinking:${agent.thinkingLevel ?? "off"} (${keyText("app.thinking.cycle")}) · ${keyText("app.model.select")} or /model · /agents · /compact · /tasks · ${keyText("app.message.followUp")} follow-up · ${keyText("app.clear")} exit`,
			)}`,
		);
	}

	#syncTranscript(entries                        )       {
		// Compaction and resets replace the head of the active transcript.
		if (this.#renderedEntryIds.some((id, index) => entries[index]?.id !== id)) this.#rebuild(entries);
		for (const entry of entries.slice(this.#renderedEntryIds.length)) {
			this.#addEntry(entry);
			this.#renderedEntryIds.push(entry.id);
		}
	}

	#rebuild(entries                        )       {
		this.#chat.clear();
		this.#discardTools();
		this.#summaries.length = 0;
		this.#rebuilt = true;
		this.#renderedEntryIds = [];
		this.#streaming = undefined;
		for (const entry of entries) {
			this.#addEntry(entry);
			this.#renderedEntryIds.push(entry.id);
		}
	}

	#addEntry(entry             )       {
		const message = entry.model?.[0];
		if (entry.kind === "pi.user" && message?.role === "user") {
			this.#chat.addChild(new Spacer(1));
			this.#chat.addChild(new UserMessageComponent(userText(message.content)));
		} else if (entry.kind === "pi.assistant" && message?.role === "assistant") {
			const component = this.#streaming ?? new AssistantMessageComponent();
			if (this.#streaming === undefined) this.#chat.addChild(component);
			this.#streaming = undefined;
			component.updateContent(message, false);
			// Only a tool-calling answer runs its calls; an aborted, failed, or truncated one never does.
			const ran = message.stopReason === "toolUse";
			for (const content of message.content) {
				if (content.type !== "toolCall") continue;
				const streamed = this.#streamingCalls.has(content.id);
				// Only cards the stream already showed are kept for calls that never run.
				if (!ran && !streamed) continue;
				const card = this.#tool(content.name, content.id, content.arguments, !streamed);
				card.setArgsComplete();
				if (!ran) {
					const text = "Not run: the answer was interrupted.";
					card.updateResult({ content: [{ type: "text", text }], isError: true }, false);
				}
			}
			this.#streamingCalls.clear();
		} else if (entry.kind === "pi.tool-result" && message?.role === "toolResult") {
			const result = message                     ;
			this.#tool(result.toolName, result.toolCallId).updateResult(result);
		} else if (entry.kind === "pi.compaction") {
			const summary = new CompactionComponent(
				message?.role === "user" ? userText(message.content) : "",
				this.#expanded,
			);
			this.#summaries.push(summary);
			this.#chat.addChild(new Spacer(1));
			this.#chat.addChild(summary);
		} else if (entry.kind === "pi.reset") this.#addText("[new context]");
	}

	#syncStreaming(message                  )       {
		if (this.#streaming === undefined) {
			this.#streaming = new AssistantMessageComponent();
			this.#chat.addChild(this.#streaming);
		}
		this.#streaming.updateContent(message, true);
		for (const content of message.content) {
			if (content.type !== "toolCall") continue;
			this.#tool(content.name, content.id, content.arguments, !this.#streamingCalls.has(content.id));
			this.#streamingCalls.add(content.id);
		}
	}

	#addText(text        )       {
		this.#chat.addChild(new Spacer(1));
		this.#chat.addChild(new Text(theme.fg("muted", text), 1, 0));
	}

	/** The card of a call; `fresh` starts a new one for a call ID an earlier turn used. */
	#tool(name        , callId        , args          , fresh = false)                         {
		const existing = fresh ? undefined : this.#tools.get(callId);
		if (existing !== undefined) {
			if (args !== undefined) existing.updateArgs(args);
			return existing;
		}
		const component = new ToolExecutionComponent(
			name,
			callId,
			args ?? {},
			{},
			DurableTui.#renderers[name],
			this.#ui,
			this.#cwd,
		);
		component.setExpanded(this.#expanded);
		this.#chat.addChild(component);
		this.#cards.push(component);
		this.#tools.set(callId, component);
		return component;
	}
}

function describeTask(node               )         {
	const state = node.state;
	const status =
		state.status === "waiting"
			? `waiting on ${state.on.join(", ")}`
			: state.status === "completing"
				? `completing (${state.outcome})`
				: `${state.status} ${state.phase}`;
	const flags = [node.background ? "background" : "", node.abortRequested ? "aborting" : ""].filter(Boolean);
	const owned = node.conversations.length > 0 ? ` owns conversation ${node.conversations.join(", ")}` : "";
	return `${node.kind} #${node.id}: ${status}${flags.length > 0 ? ` [${flags.join(", ")}]` : ""}${owned}`;
}

function userText(content                        )         {
	if (typeof content === "string") return content;
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function totalUsage(state            )        {
	const total        = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	for (const usage of [...Object.values(state.models), ...Object.values(state.tools)]) {
		total.input += usage.input;
		total.output += usage.output;
		total.cacheRead += usage.cacheRead;
		total.cacheWrite += usage.cacheWrite;
		total.cost.total += usage.cost.total;
	}
	return total;
}

/** Context size from the newest successful answer after the newest compaction; unknown before one. */
function contextTokens(entries                        )                     {
	// Kept entries follow the summary in the view but are older than it; only later answers measure the new context.
	const compacted = Math.max(0, ...entries.filter((entry) => entry.kind === "pi.compaction").map((entry) => entry.id));
	for (const entry of [...entries].reverse()) {
		const message = entry.model?.[0];
		if (entry.id < compacted || entry.kind !== "pi.assistant" || message?.role !== "assistant") continue;
		if (message.stopReason === "aborted" || message.stopReason === "error") continue;
		const usage = message.usage;
		return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	}
	return undefined;
}

export async function runDurableTui(
	source                   ,
	controller                   ,
	settings                 ,
)                {
	setCapabilityOverrides(settings.getTerminalCapabilityOverrides());
	// The system theme until the controller resolves the user's theme against the terminal's colors.
	initTheme();
	let exit = ()       => {};
	const exited = new Promise      ((resolve) => {
		exit = resolve;
	});
	let view             ;

	const selectModel = ()       => {
		const snapshot = source.current();
		const current = agentOf(snapshot.conversation).model;
		const isCurrent = (model                                       ) =>
			model.provider === current?.provider && model.modelId === current.modelId;
		const items               = [...snapshot.models]
			.sort((left, right) => Number(isCurrent(right)) - Number(isCurrent(left)))
			.map((model) => ({
				value: `${model.provider}/${model.modelId}`,
				label: model.modelId,
				description: model.provider,
			}));
		const selector = new ListSelector(
			"Select model:",
			items,
			(value) => {
				view.restoreEditor();
				const separator = value.indexOf("/");
				void controller.setModel({ provider: value.slice(0, separator), modelId: value.slice(separator + 1) });
			},
			() => view.restoreEditor(),
		);
		view.mount(selector);
	};

	const selectConversation = ()       => {
		const snapshot = source.current();
		const items               = [...snapshot.conversations].reverse().map((candidate) => ({
			value: String(candidate.id),
			label: candidate.label,
			description: `${candidate.id === snapshot.conversation.conversation.id ? "(shown) " : ""}${candidate.title ?? ""}`,
		}));
		const selector = new ListSelector(
			"Switch to:",
			items,
			(value) => {
				view.restoreEditor();
				void controller.switchConversation(Number(value)                  );
			},
			() => view.restoreEditor(),
		);
		view.mount(selector);
	};

	view = new DurableTui(source.current().session.cwd, {
		submit: (text) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			if (trimmed === "/model") return selectModel();
			if (trimmed === "/tasks") return void controller.toggleTasks();
			if (trimmed === "/agents") return selectConversation();
			if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
				const instructions = trimmed.slice("/compact".length).trim();
				return void controller.compact(instructions || undefined);
			}
			void controller.submit(trimmed, "steer");
		},
		followUp: (text) => void controller.submit(text, "followUp"),
		abort: () => void controller.abort(),
		exit,
		selectModel,
		cycleThinking: () => void controller.cycleThinking(),
	});

	// pi's theme handling: the theme setting (also light/dark pairs) resolved against the terminal's reported colors.
	const themes = new InteractiveThemeController(view.ui, {
		getSettingsManager: () => settings,
		showError: (message) => console.error(message),
		onChanged: () => view.ui.requestRender(),
	});
	const unsubscribe = source.subscribe(() => view.apply(source.current()));
	view.start();
	themes.applyFromSettings();
	view.apply(source.current());
	await exited;
	unsubscribe();
	themes.dispose();
	view.stop();
}
