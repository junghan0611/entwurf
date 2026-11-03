import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	clampThinkingLevel,
	cleanupSessionResources,
	getSupportedThinkingLevels,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import {
	type AgentState,
	type Conversation,
	type ConversationId,
	ConversationTranscript,
	type ConversationView,
	type ConversationWatch,
	type Cursor,
	type EntryRecord,
	type Extension,
	Harness,
	type InputSubmissionDraft,
	LiveDoc,
	type ModelRef,
	type Report,
	ROOT_CONVERSATION_ID,
	type Submission,
	type TaskGraph,
	type TaskGraphWatch,
	type TranscriptItem,
	type TranscriptView,
	type WatchEnd,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { ModelRuntime } from "../../core/model-runtime.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import {
	configureHarnessHttp,
	createCodingRegistry,
	createHarnessSettings,
	ExecutionEnvs,
	findInitialAgentModel,
} from "./harness-setup.ts";
import { type FenceEnd, type SessionFence, selectSession } from "./sessions.ts";
import { Subagent } from "./subagent.ts";

const context = BACKGROUND_CONTEXT;

export interface ModelSummary extends ModelRef {
	readonly name: string;
	readonly contextWindow: number;
}

export interface Notice {
	readonly id: number;
	readonly level: "info" | "warning" | "error";
	readonly message: string;
}

/** A conversation the user can switch to: the main one, or a subagent's. */
export interface ConversationSummary {
	readonly id: ConversationId;
	readonly label: string;
	/** The first user message, for a subagent its task. */
	readonly title?: string;
}

/** Everything the TUI renders. Plain values; no Harness objects cross this boundary. */
export interface DurableView {
	readonly session: { readonly id: string; readonly directory: string; readonly cwd: string };
	/**
	 * The conversation shown and talked to, as the SDK's watch delivers it: its documents and a WINDOW of its newest
	 * history entries (SDK 1.5: newest 50, then appends until 100). Not pi 1.4's active transcript: entries a
	 * compaction or reset left behind stay in it, and older ones leave it as new ones arrive.
	 */
	readonly conversation: ConversationView;
	/**
	 * Everything this process has seen of the shown conversation, merged from every window value by the SDK's
	 * `ConversationTranscript`: it only grows, so entries the window drops stay; `earlier` marks unloaded history
	 * before it. The TUI renders this, the window is for readers that need only the newest entries.
	 */
	readonly transcript: TranscriptView;
	readonly conversations: readonly ConversationSummary[];
	readonly models: readonly ModelSummary[];
	readonly notices: readonly Notice[];
	/** The live task graph, observed for the session's lifetime whether or not its panel is shown. */
	readonly tasks?: TaskGraph;
	/** Whether the task panel is shown; /tasks toggles only this. */
	readonly tasksPanel: boolean;
	/**
	 * Set once the session failed and closed itself (never by `close()`): it takes no more input, and a tool still
	 * running was only asked to stop. `error` is what the Harness reported, absent until it has.
	 */
	readonly failure?: { readonly error?: string };
	/**
	 * A watch that ended by itself while the Session runs (a failed or throwing observation): that part of the screen
	 * no longer updates, and says so rather than look healthy. Cleared when a new watch replaces it.
	 */
	readonly stalled?: { readonly conversation?: string; readonly tasks?: string };
}

export interface DurableViewSource {
	current(): DurableView;
	subscribe(listener: () => void): () => void;
}

/** What the TUI may ask for. */
export interface DurableController {
	/** Prompt when idle; otherwise steer or queue a follow-up. */
	submit(text: string, whenBusy: "steer" | "followUp"): Promise<void>;
	compact(instructions: string | undefined): Promise<void>;
	abort(): Promise<void>;
	cycleThinking(): Promise<void>;
	setModel(model: ModelRef): Promise<void>;
	toggleTasks(): Promise<void>;
	/** Show and talk to another conversation. */
	switchConversation(id: ConversationId): Promise<void>;
}

export interface OpenDurableOptions {
	readonly cwd?: string;
	readonly continueSession?: boolean;
	/** An existing session of this directory, by its id, reopened as it was saved (#143). */
	readonly session?: string;
	/** Installed after the built-in extensions and before the Harness opens, so recovered work finds their tools. */
	readonly extensions?: readonly Extension[];
	/** A new session's explicit model, resolved as pi's `--provider`/`--model`; unresolved, the open fails. */
	readonly model?: { readonly provider: string; readonly model: string };
	/** The owner fence taken before the native lease (#157 B3); every owned open has one. */
	readonly fence: SessionFence;
}

export interface OpenDurableResult {
	readonly view: DurableViewSource;
	readonly controller: DurableController;
	/** pi's settings, for the TUI's theme and terminal capabilities. */
	readonly settings: SettingsManager;
	/** Admits input to the root conversation, whichever one is on screen; resolves at admission, not at the answer. */
	submitToRoot(draft: InputSubmissionDraft): Promise<Submission>;
	/**
	 * Calls `listener` once, synchronously, when the session fails and closes itself, never for `close()`; subscribed
	 * after the failure, it is called at once. Like the Session's own close listeners it must not block or call the
	 * session; a throw becomes an error notice.
	 */
	onFailed(listener: () => void): () => void;
	close(): Promise<void>;
}

/** The agent document of a view; absent while the conversation has none. */
export function agentOf(view: ConversationView): AgentState {
	return (view.docs["pi.agent"] ?? {}) as AgentState;
}

/** A subagent's task: the oldest user message of its conversation. The main conversation needs no title. */
async function firstInput(harness: Harness, id: ConversationId): Promise<{ title?: string }> {
	if (id === ROOT_CONVERSATION_ID) return {};
	const conversation = (await harness.conversation(id, context))!;
	let first: EntryRecord | undefined;
	let cursor: Cursor | undefined;
	do {
		const page = await conversation.entries({}, 256, cursor, context);
		first = page.items.findLast((entry) => entry.kind === "pi.user") ?? first;
		cursor = page.next;
	} while (cursor !== undefined);
	return titleOf(first);
}

/** The text of a user entry, as a one-line title. */
function titleOf(entry: EntryRecord | undefined): { title?: string } {
	const message = entry?.model?.[0];
	if (message?.role !== "user") return {};
	const text =
		typeof message.content === "string"
			? message.content
			: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ");
	return { title: text.replace(/\s+/g, " ").trim() };
}

/** What failed, for an owner end's `cause`. */
function causeOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function openDurable(options: OpenDurableOptions): Promise<OpenDurableResult> {
	// The type requires it; a JS caller is refused here, before the session root is created.
	if (options.fence === undefined) {
		throw new Error("fence-required: an owned durable open takes the owner fence before its native lease");
	}
	if (options.model !== undefined && (options.continueSession || options.session !== undefined)) {
		throw new Error("An explicit model applies only to a new session, not to a continued one");
	}
	if (options.continueSession && options.session !== undefined) {
		throw new Error("A chosen session and the newest one are two different sessions; name one");
	}
	const location = await selectSession(
		options.fence,
		options.cwd ?? process.cwd(),
		options.continueSession ?? false,
		options.session,
	);
	const ticket = location.ticket;
	const envs = new ExecutionEnvs(location.cwd);
	let harness: Harness | undefined;
	// The storage handle Harness.open is handed: if Harness.open itself rejects, this is what was opened.
	let backendHandle: Awaited<ReturnType<typeof openNodeSqliteStorage>> | undefined;
	try {
		const modelRuntime = await ModelRuntime.create();
		const settingsManager = SettingsManager.create(location.cwd);
		configureHarnessHttp(settingsManager);
		const settings = createHarnessSettings(settingsManager);
		const registry = createCodingRegistry(settingsManager, location.cwd);
		registry.install(Subagent);
		for (const extension of options.extensions ?? []) registry.install(extension);

		// SDK 1.5 hands one tagged `Report` (what happened by `kind`, plus its `error`), not pi 1.4's (error, info).
		const pendingReports: Report[] = [];
		let report: (reported: Report) => void = (reported) => pendingReports.push(reported);
		// Recorded BEFORE the call: once the open is attempted, no later outcome proves that nothing was opened.
		ticket.storageOpenAttempted = true;
		const backend = await openNodeSqliteStorage(location.database);
		backendHandle = backend;
		harness = await Harness.open(
			backend,
			{
				models: modelRuntime,
				registry,
				settings,
				env: envs.env,
				onReport: (reported) => report(reported),
			},
			context,
		);
		await ticket.storageOpened();
		const initial = location.created
			? await findInitialAgentModel(settingsManager, modelRuntime, options.model)
			: undefined;
		if (options.model !== undefined) {
			// pi resolves case-insensitive, partial and unknown ids too (a custom-id fallback with only a warning);
			// an explicit model must be exactly one registered catalog model, named by its canonical id.
			const asked = options.model;
			const ref = initial?.model;
			const thinking = initial?.thinkingLevel;
			const registered = ref !== undefined && modelRuntime.getModel(ref.provider, ref.modelId) !== undefined;
			const named =
				ref !== undefined &&
				(asked.model === ref.modelId || (thinking !== undefined && asked.model === `${ref.modelId}:${thinking}`));
			if (ref === undefined || ref.provider !== asked.provider || !registered || !named) {
				const resolved =
					ref === undefined
						? "none"
						: `${ref.provider}/${ref.modelId}${thinking === undefined ? "" : `:${thinking}`}`;
				throw new Error(
					`explicit-model-not-exact: asked ${asked.provider}/${asked.model}, resolved ${resolved} (registered=${registered})`,
				);
			}
		}
		const root = await harness.root(context, {
			agent: {
				cwd: location.cwd,
				...(initial?.model === undefined ? {} : { model: initial.model }),
				...(initial?.thinkingLevel === undefined ? {} : { thinkingLevel: initial.thinkingLevel }),
			},
		});
		const label = (id: ConversationId): string => (id === root.id ? "main" : `subagent ${id}`);
		const opened = harness;
		const summaries: ConversationSummary[] = [];
		let cursor: Cursor | undefined;
		do {
			const page = await opened.commit((tx) => tx.scanConversations({}, 256, cursor), context);
			for (const { id } of page.items) summaries.push({ id, label: label(id), ...(await firstInput(opened, id)) });
			cursor = page.next;
		} while (cursor !== undefined);
		let current: Conversation = root;
		// The shown conversation's watch (SDK 1.5 replaced `viewState()`) and the transcript merged from its windows.
		const transcriptOf = (conversation: Conversation): ConversationTranscript =>
			new ConversationTranscript((query, limit, loading) => conversation.entries(query, limit, undefined, loading));
		let watch: ConversationWatch = await root.watch(context);
		let history = transcriptOf(root);
		const models = (): ModelSummary[] =>
			modelRuntime.getAvailableSnapshot().map((model) => ({
				provider: model.provider,
				modelId: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
			}));

		let state: DurableView = {
			session: { id: location.id, directory: location.directory, cwd: location.cwd },
			conversation: watch.value,
			transcript: history.merge(watch.value),
			conversations: summaries,
			models: models(),
			notices: [],
			tasksPanel: true,
		};
		const listeners = new Set<() => void>();
		let notifying = false;
		// Commit listeners and Chord frames call this on the Session line; rendering runs afterwards, once per burst.
		const update = (patch: Partial<DurableView>): void => {
			state = { ...state, ...patch };
			if (notifying) return;
			notifying = true;
			setImmediate(() => {
				notifying = false;
				for (const listener of listeners) listener();
			});
		};
		let nextNotice = 1;
		const notice = (level: Notice["level"], message: string): void => {
			update({ notices: [...state.notices, { id: nextNotice++, level, message }].slice(-20) });
		};
		const fail = (error: unknown): void => notice("error", error instanceof Error ? error.message : String(error));
		report = (reported) => {
			// The error the SDK reported, never the Report itself: that would read `[object Object]`.
			const message = causeOf(reported.error);
			// A failing Session runs its close listeners first and reports the cause right after, as `storage_failed`:
			// that report names the failure the close listener recorded.
			if (reported.kind === "storage_failed" && state.failure !== undefined && state.failure.error === undefined) {
				update({ failure: { error: message } });
			} else notice(reported.kind === "storage_failed" ? "error" : "warning", `${reported.kind}: ${message}`);
		};
		for (const reported of pendingReports) report(reported);
		const failedListeners = new Set<() => void>();
		// The Session closes itself when its Storage fails. Its `closed` settles only after every running task returned,
		// which a task ignoring its abort can delay without end, so the failure is shown from the close listener itself.
		// `close()` unsubscribes before it closes the Session, so only a Session closing itself gets here.
		const unsubscribeClose = harness.subscribeClose(() => {
			update({ failure: {} });
			for (const listener of failedListeners) {
				try {
					listener();
				} catch (error) {
					fail(error);
				}
			}
		});
		let closing: Promise<void> | undefined;
		// A watch that ends by itself while the Session runs leaves its part of the screen frozen: say so rather than look
		// healthy (#155). Ending at close, at a failure the Session already shows, or by being replaced, is no news.
		const ended = (part: "conversation" | "tasks", end: WatchEnd): void => {
			if (closing !== undefined || state.failure !== undefined) return;
			if (end.kind !== "failed" && end.kind !== "listener_error") return;
			update({ stalled: { ...state.stalled, [part]: causeOf(end.error) } });
		};
		const gapFills = new WeakSet<ConversationTranscript>();
		// A window that skipped entries (frames folded while the listener was busy) leaves a gap in the transcript. The
		// SDK's own `fillGap()` pages it in, one page per call, until none is left; nothing else loads history.
		const fillGaps = (shown: ConversationTranscript, view: TranscriptView): void => {
			const gap = view.items.find((item): item is Extract<TranscriptItem, { kind: "gap" }> => item.kind === "gap");
			if (gap === undefined || gapFills.has(shown)) return;
			gapFills.add(shown);
			void shown.fillGap(gap, context).then(
				() => {
					gapFills.delete(shown);
					if (shown !== history) return;
					// The newest window merged again is a no-op that returns everything held now, the page included.
					const filled = shown.merge(state.conversation);
					update({ transcript: filled });
					// A page that added nothing ends the fill; a later window starts it again.
					if (filled.items !== view.items) fillGaps(shown, filled);
				},
				(error) => {
					gapFills.delete(shown);
					fail(error);
				},
			);
		};
		// Every value of the shown conversation's window joins its transcript; a replaced watch's late frames are dropped.
		const follow = (handle: ConversationWatch, shown: ConversationTranscript): void => {
			handle.start(async (call) => {
				if (handle !== watch) return;
				if (call.kind === "failed") {
					notice("warning", `The conversation view could not update: ${causeOf(call.error)}`);
					return;
				}
				const transcript = shown.merge(call.value);
				update({ conversation: call.value, transcript });
				fillGaps(shown, transcript);
			});
			void handle.closed.then((end) => {
				if (handle === watch) ended("conversation", end);
			});
		};
		follow(watch, history);
		// Subagents appear as their conversations are created. A commit observer only records; it calls no Session API.
		// Its end decides nothing: SDK 1.5 ends it `failed` ("session closed") at a normal close as well (#155).
		const commits = harness.observeCommits({
			advance: (publication) => {
				let conversations = state.conversations;
				for (const change of publication.changes) {
					if (change.type === "conversation") {
						conversations = [...conversations, { id: change.value.id, label: label(change.value.id) }];
					} else if (change.type === "entry" && change.value.kind === "pi.user") {
						const id = change.value.conversationId;
						conversations = conversations.map((summary) =>
							summary.id === id && summary.title === undefined
								? { ...summary, ...titleOf(change.value) }
								: summary,
						);
					}
				}
				if (conversations !== state.conversations) update({ conversations });
			},
			end: () => {},
		});

		let tasks: TaskGraphWatch | undefined;
		const closeTasks = (): void => {
			const graph = tasks;
			tasks = undefined;
			void graph?.stop();
		};

		let queue = Promise.resolve();
		// One at a time, so toggles, switches, and key presses apply in order.
		const command = (operation: () => Promise<void>): Promise<void> => {
			queue = queue.then(operation).catch(fail);
			return queue;
		};
		// A run that ended without an answer stays on screen as its conversation's `pi.live.runFailure` (SDK 1.5), so an
		// input that run settled adds no notice of its own; one settled without such a run (stale, say) still does.
		const watchAnswer = (submission: Submission, conversation: Conversation): void => {
			void submission
				.wait(context)
				.then(async (settled) => {
					if (settled.status !== "unanswered" || settled.reason === "aborted") return;
					const live = await opened.snapshot(LiveDoc, conversation.id, context);
					if (live?.runFailure?.inputs.includes(submission.id)) return;
					notice(
						"error",
						`No answer: ${settled.reason}${settled.detail === undefined ? "" : ` ${JSON.stringify(settled.detail)}`}`,
					);
				})
				.catch(fail);
		};
		const agentModel = () => {
			const ref = agentOf(state.conversation).model;
			const model = ref === undefined ? undefined : modelRuntime.getModel(ref.provider, ref.modelId);
			if (model === undefined)
				throw new Error(ref === undefined ? "No model selected" : "Current model is unavailable");
			return model;
		};
		const controller: DurableController = {
			submit: (text, whenBusy) =>
				command(async () => {
					if (state.failure !== undefined) {
						throw new Error("The session failed and takes no input. Close it, then reopen it with --continue.");
					}
					const target = current;
					watchAnswer(await target.submit({ type: "input", content: text, whenBusy }, context), target);
				}),
			compact: (instructions) =>
				command(async () => {
					const id = await current.compact(instructions, context);
					// Report the outcome once it is known; the status line shows the compaction meanwhile.
					void opened.waitForTask(id, context).then(async (receipt) => {
						const outcome = receipt.state.outcome;
						if (outcome.status === "completed") {
							const { entryId, submissionId } = outcome.result;
							// A summary written while busy is a submission: placed now, queued, or dropped as stale.
							const status =
								submissionId === undefined
									? undefined
									: (await (await opened.submission(submissionId, context))?.status(context))?.status;
							notice(
								"info",
								entryId !== undefined || status === "done"
									? "Compacted."
									: status === "queued"
										? "Compaction summary queued; it is placed at the next turn boundary."
										: status === "unanswered"
											? "Compaction summary dropped: the context changed under it."
											: "Nothing to compact: the context fits in the recent window that is kept verbatim.",
							);
						} else if (outcome.status === "aborted") notice("info", "Compaction aborted.");
						else
							notice("error", `Compaction ${outcome.status}: ${outcome.error?.message ?? outcome.reason ?? ""}`);
					}, fail);
				}),
			// Not queued: it waits until the conversation is idle.
			abort: () => current.abort(context).catch(fail),
			cycleThinking: () =>
				command(async () => {
					const model = agentModel();
					if (!model.reasoning) throw new Error("Current model does not support thinking");
					const levels = getSupportedThinkingLevels(model);
					const level = agentOf(state.conversation).thinkingLevel ?? "off";
					const next = levels[(levels.indexOf(level) + 1) % levels.length] ?? "off";
					await current.configure({ thinkingLevel: next }, context);
				}),
			setModel: (ref) =>
				command(async () => {
					const model = modelRuntime.getModel(ref.provider, ref.modelId);
					if (model === undefined) throw new Error(`Unknown model: ${ref.provider}/${ref.modelId}`);
					const thinking: ModelThinkingLevel = agentOf(state.conversation).thinkingLevel ?? "off";
					await current.configure({ model: ref, thinkingLevel: clampThinkingLevel(model, thinking) }, context);
				}),
			// Only the panel: the graph stays observed, so live background work is never out of view.
			toggleTasks: () => command(async () => update({ tasksPanel: !state.tasksPanel })),
			switchConversation: (id) =>
				command(async () => {
					const next = await opened.conversation(id, context);
					if (next === undefined) throw new Error(`Conversation ${id} does not exist`);
					const nextWatch = await next.watch(context);
					const previous = watch;
					current = next;
					watch = nextWatch;
					history = transcriptOf(next);
					void previous.stop();
					// A new watch replaces a stalled one; the task graph's state is its own.
					const stalled = state.stalled?.tasks === undefined ? undefined : { tasks: state.stalled.tasks };
					update({ conversation: nextWatch.value, transcript: history.merge(nextWatch.value), stalled });
					follow(nextWatch, history);
				}),
		};

		const saved = agentOf(state.conversation).model;
		if (saved === undefined) notice("warning", "No model configured; select one with /model.");
		else if (modelRuntime.getModel(saved.provider, saved.modelId) === undefined) {
			notice("warning", `Saved model is unavailable: ${saved.provider}/${saved.modelId}`);
		}
		if (initial?.fallbackMessage !== undefined) notice("info", initial.fallbackMessage);
		// The task graph is observed until close; its panel starts open and /tasks hides it.
		const graph = await opened.watchTaskGraph(context);
		tasks = graph;
		update({ tasks: graph.value });
		graph.start(async (call) => {
			if (call.kind === "value") update({ tasks: call.value });
			else notice("warning", `The task graph could not update: ${causeOf(call.error)}`);
		});
		void graph.closed.then((end) => ended("tasks", end));
		// Recovered work from an interrupted turn continues now.
		harness.resume();

		return {
			view: {
				current: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			},
			controller,
			settings: settingsManager,
			submitToRoot: (draft) => root.submit(draft, context),
			onFailed(listener) {
				// The failure is kept in the view, so a listener that comes after it is told at once, and still only once.
				if (state.failure !== undefined) {
					try {
						listener();
					} catch (error) {
						fail(error);
					}
					return () => {};
				}
				failedListeners.add(listener);
				return () => failedListeners.delete(listener);
			},
			close() {
				closing ??= (async () => {
					// First: the Session runs its close listeners inside its own close call.
					unsubscribeClose();
					void watch.stop();
					commits.detach();
					closeTasks();
					// The resource end the fence records (#157 B3). Storage is `closed` only when the first actual close
					// resolved, no failure was seen before it, and the Session's own terminal result is not `failed`.
					const failures: unknown[] = [];
					let storage: FenceEnd["storage"] = "failed";
					let envCleanup: FenceEnd["envCleanup"];
					let lease: FenceEnd["lease"] = "released";
					try {
						// Close writes no outcome: a running turn resumes with --continue.
						await opened.close(context);
						// SDK 1.5 tells the end by `kind`; pi 1.4's `reason` is absent there, and a type-stripped carrier would
						// read it as undefined and call every end closed (#155).
						const end = await opened.closed;
						if (state.failure === undefined && end.kind !== "failed") storage = "closed";
						try {
							await envs.cleanup(context);
						} catch (error) {
							envCleanup = "failed";
							failures.push(error);
						}
					} catch (error) {
						failures.push(error);
					} finally {
						// The provider connections the turns left open for reuse: pi-ai keeps a Codex WebSocket per provider
						// session on a five-minute idle timer, and pi's AgentSession releases them on dispose. Without the same
						// release here a closed host stays alive until that timer (#157 S3 LIVE-R1). No id: the provider session
						// ids are docs of the storage this process alone opened, and a host process holds this one Session.
						try {
							cleanupSessionResources();
						} catch (error) {
							failures.push(error);
						}
						try {
							await location.release();
						} catch (error) {
							lease = "failed";
							failures.push(error);
						}
					}
					const failure = failures[0] ?? (storage === "closed" ? undefined : "the session failed before close");
					const record: FenceEnd = {
						storage,
						lease,
						...(envCleanup === undefined ? {} : { envCleanup }),
						...(failure === undefined ? {} : { cause: causeOf(failure) }),
					};
					// An env cleanup failure is the caller's error, not the resource's: the end stays `closed`.
					try {
						if (storage === "closed" && lease === "released") await ticket.closed(record);
						else await ticket.closeFailed(record);
					} catch (error) {
						failures.push(error);
					}
					if (failures.length === 1) throw failures[0];
					if (failures.length > 1) throw new AggregateError(failures, "The durable session did not close cleanly");
				})();
				return closing;
			},
		};
	} catch (error) {
		// An init failure (#157 B3). Only a storage open that was never attempted, with the lease verifiably released,
		// ends `closed`; once attempted, neither a settled Harness close nor a released lease proves the resource ended.
		let storage: FenceEnd["storage"] = ticket.storageOpenAttempted ? "unknown" : "never-opened";
		// The init error first, then every cleanup failure: none is dropped.
		const failures: unknown[] = [error];
		// The first close of what was opened: the Harness once it opened, else the storage handle Harness.open was
		// handed and rejected. A close that settles is no verified close here; one that rejects is a failed storage.
		const closable = harness ?? backendHandle;
		if (closable !== undefined) {
			try {
				await closable.close(context);
			} catch (closeError) {
				storage = "failed";
				failures.push(closeError);
			}
		}
		let lease: FenceEnd["lease"] = "released";
		try {
			await location.release();
		} catch (releaseError) {
			lease = "failed";
			failures.push(releaseError);
		}
		const ending: FenceEnd = { storage, lease, cause: failures.map(causeOf).join("; ") };
		try {
			if (storage === "never-opened" && lease === "released") await ticket.closed(ending);
			else await ticket.closeFailed(ending);
		} catch (fenceError) {
			failures.push(fenceError);
		}
		if (failures.length === 1) throw error;
		throw new AggregateError(failures, `${causeOf(error)}; its cleanup or owner end failed too`);
	}
}
