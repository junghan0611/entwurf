import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	clampThinkingLevel,
	cleanupSessionResources,
	getSupportedThinkingLevels,
	                        
} from "@earendil-works/pi-ai";
import {
	                
	                  
	                    
	                      
	                       
	            
	             
	                 
	               
	Harness,
	                          
	LiveDoc,
	              
	            
	ROOT_CONVERSATION_ID,
	                
	               
	                    
	                    
	              
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { ModelRuntime } from "entwurf-pi-dist:core/model-runtime.js";
import { SettingsManager } from "entwurf-pi-dist:core/settings-manager.js";
import {
	configureHarnessHttp,
	createCodingRegistry,
	createHarnessSettings,
	ExecutionEnvs,
	findInitialAgentModel,
} from "./harness-setup.js";
import {                                   selectSession } from "./sessions.js";
import { Subagent } from "./subagent.js";

const context = BACKGROUND_CONTEXT;

                                                
	                      
	                               
 

                         
	                    
	                                             
	                         
 

/** A conversation the user can switch to: the main one, or a subagent's. */
                                      
	                            
	                       
	                                                       
	                        
 

/** Everything the TUI renders. Plain values; no Harness objects cross this boundary. */
                              
	                                                                                            
	   
	                                                                                                                  
	                                                                                                                     
	                                                                 
	   
	                                        
	   
	                                                                                                          
	                                                                                                               
	                                                                                                                 
	        
	   
	                                    
	                                                       
	                                         
	                                    
	                                                                                                  
	                           
	                                                                 
	                             
	   
	                                                                                                               
	                                                                                             
	   
	                                               
	   
	                                                                                                                  
	                                                                                                 
	   
	                                                                               
 

                                    
	                       
	                                            
 

/** What the TUI may ask for. */
                                    
	                                                              
	                                                                    
	                                                         
	                       
	                               
	                                         
	                             
	                                             
	                                                      
 

                                     
	                      
	                                   
	                                                                                         
	                          
	                                                                                                                 
	                                           
	                                                                                                           
	                                                                       
	                                                                                         
	                             
 

                                    
	                                 
	                                       
	                                                                    
	                                   
	                                                                                                                   
	                                                               
	   
	                                                                                                                  
	                                                                                                                
	                                            
	   
	                                           
	                       
 

/** The agent document of a view; absent while the conversation has none. */
export function agentOf(view                  )             {
	return (view.docs["pi.agent"] ?? {})              ;
}

/** A subagent's task: the oldest user message of its conversation. The main conversation needs no title. */
async function firstInput(harness         , id                )                              {
	if (id === ROOT_CONVERSATION_ID) return {};
	const conversation = (await harness.conversation(id, context)) ;
	let first                         ;
	let cursor                    ;
	do {
		const page = await conversation.entries({}, 256, cursor, context);
		first = page.items.findLast((entry) => entry.kind === "pi.user") ?? first;
		cursor = page.next;
	} while (cursor !== undefined);
	return titleOf(first);
}

/** The text of a user entry, as a one-line title. */
function titleOf(entry                         )                     {
	const message = entry?.model?.[0];
	if (message?.role !== "user") return {};
	const text =
		typeof message.content === "string"
			? message.content
			: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ");
	return { title: text.replace(/\s+/g, " ").trim() };
}

/** What failed, for an owner end's `cause`. */
function causeOf(error         )         {
	return error instanceof Error ? error.message : String(error);
}

/** The shown conversation's active transcript and the newest entry ID in it. */
                 
	                                         
	                        
 

/** A read's active transcript and the watch attached right after the read. */
                  
	                                  
	                      
 

/** The newest entry ID of `entries`; a head marker comes first, so the last entry need not be the newest. */
function newestOf(entries                        )         {
	return entries.reduce((newest, entry) => Math.max(newest, entry.id), Number.NEGATIVE_INFINITY);
}

/** What the TUI renders: the watched documents with the active transcript as items. */
function transcriptOf(view                  , entries                        )                 {
	return {
		conversation: view.conversation,
		docs: view.docs,
		items: entries.map((entry) => ({ kind: "entry"         , entry })),
	};
}

export async function openDurable(options                    )                             {
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
	let harness                     ;
	// The storage handle Harness.open is handed: if Harness.open itself rejects, this is what was opened.
	let backendHandle                                                               ;
	try {
		const modelRuntime = await ModelRuntime.create();
		const settingsManager = SettingsManager.create(location.cwd);
		configureHarnessHttp(settingsManager);
		const settings = createHarnessSettings(settingsManager);
		const registry = createCodingRegistry(settingsManager, location.cwd);
		registry.install(Subagent);
		for (const extension of options.extensions ?? []) registry.install(extension);

		// SDK 1.5 hands one tagged `Report` (what happened by `kind`, plus its `error`), not pi 1.4's (error, info).
		const pendingReports           = [];
		let report                             = (reported) => pendingReports.push(reported);
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
		const label = (id                )         => (id === root.id ? "main" : `subagent ${id}`);
		const opened = harness;
		const summaries                        = [];
		let cursor                    ;
		do {
			const page = await opened.commit((tx) => tx.scanConversations({}, 256, cursor), context);
			for (const { id } of page.items) summaries.push({ id, label: label(id), ...(await firstInput(opened, id)) });
			cursor = page.next;
		} while (cursor !== undefined);
		let current               = root;
		// The shown conversation's transcript is pi 1.4's active one (#155 D1). One official read gives the active range
		// (`Conversation.context().entries`); the watch attached right after it starts at the next entry ID, so what is
		// committed between the two is its first value. Nothing here derives an active range: when one changes, it is
		// read again.
		const seed = async (conversation              )                  => {
			const read = await conversation.context(context);
			const newest = newestOf(read.entries);
			const attached = await conversation.watch(
				context,
				Number.isFinite(newest) ? { from: (newest + 1)            } : undefined,
			);
			return { watch: attached, shown: { entries: read.entries, newest } };
		};
		const first = await seed(root);
		// The shown watch: the first one until `install` makes it so, then each one a switch or a new read installs.
		let watch                               ;
		let shown        = first.shown;
		const models = ()                 =>
			modelRuntime.getAvailableSnapshot().map((model) => ({
				provider: model.provider,
				modelId: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
			}));

		let state              = {
			session: { id: location.id, directory: location.directory, cwd: location.cwd },
			conversation: first.watch.value,
			transcript: transcriptOf(first.watch.value, shown.entries),
			conversations: summaries,
			models: models(),
			notices: [],
			tasksPanel: true,
		};
		const listeners = new Set            ();
		let notifying = false;
		// Commit listeners and Chord frames call this on the Session line; rendering runs afterwards, once per burst.
		const update = (patch                      )       => {
			state = { ...state, ...patch };
			if (notifying) return;
			notifying = true;
			setImmediate(() => {
				notifying = false;
				for (const listener of listeners) listener();
			});
		};
		let nextNotice = 1;
		const notice = (level                 , message        )       => {
			update({ notices: [...state.notices, { id: nextNotice++, level, message }].slice(-20) });
		};
		const fail = (error         )       => notice("error", error instanceof Error ? error.message : String(error));
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
		const failedListeners = new Set            ();
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
		let closing                           ;
		// A watch that ends by itself while the Session runs leaves its part of the screen frozen: say so rather than look
		// healthy (#155). Ending at close, at a failure the Session already shows, or by being replaced, is no news.
		const ended = (part                          , end          )       => {
			if (closing !== undefined || state.failure !== undefined) return;
			if (end.kind !== "failed" && end.kind !== "listener_error") return;
			update({ stalled: { ...state.stalled, [part]: causeOf(end.error) } });
		};
		// The watch whose entries wait: its conversation is being read again, or that read failed. A failed read holds
		// the transcript where it was, said on screen, until a switch installs a new watch; there is no retry.
		let held                               ;
		// The shown conversation read again, one read at a time. It is installed only while `trigger` is still the shown
		// watch: a switch made meanwhile wins, and the late read is dropped (#155 D1).
		const reseed = (trigger                               )       => {
			held = trigger;
			const conversation = current;
			void seed(conversation).then(
				(next) => {
					if (watch !== trigger) {
						void next.watch.stop();
						return;
					}
					install(conversation, next);
				},
				(error) => {
					// A read refused by the close or the Session's own failure is no news, as `ended` has it.
					if (watch !== trigger || closing !== undefined || state.failure !== undefined) return;
					update({ stalled: { ...state.stalled, conversation: causeOf(error) } });
				},
			);
		};
		// One value of the shown watch. Entries past the newest one shown join the transcript in ID order. A head marker
		// among them (a compaction or a reset) or a window starting past the newest one shown (it dropped entries the
		// transcript lacks) is a new active range: read again, nothing appended until it lands.
		const advance = (view                  )       => {
			if (held !== undefined && held === watch) {
				update({ conversation: view });
				return;
			}
			const fresh = view.entries.filter((entry) => entry.id > shown.newest);
			const restarts = fresh.some((entry) => entry.head !== undefined);
			const skipped = view.before !== undefined && view.before > shown.newest;
			if (restarts || skipped) {
				update({ conversation: view });
				reseed(watch);
				return;
			}
			// A value without new entries (a document change, such as a streaming answer's progress) leaves the
			// transcript as it is.
			if (fresh.length === 0) {
				update({ conversation: view });
				return;
			}
			shown = { entries: [...shown.entries, ...fresh], newest: newestOf(fresh) };
			update({ conversation: view, transcript: transcriptOf(view, shown.entries) });
		};
		// Every later value of the shown watch; a replaced watch's late frames are dropped.
		const follow = (handle                   )       => {
			handle.start(async (call) => {
				if (handle !== watch) return;
				if (call.kind === "failed") {
					notice("warning", `The conversation view could not update: ${causeOf(call.error)}`);
					return;
				}
				advance(call.value);
			});
			void handle.closed.then((end) => {
				if (handle === watch) ended("conversation", end);
			});
		};
		// Show `conversation` from a read: its active entries, then the watch's first value, which holds what was
		// committed between the read and the attach and is taken exactly once here, then the watch's later values.
		const install = (conversation              , next        )       => {
			// The close and the Session's own failure end what is shown, as a switch does: a read landing after either
			// is let go, its watch stopped (the Session may already have ended it), and nothing is patched or started.
			if (closing !== undefined || state.failure !== undefined) {
				void next.watch.stop();
				return;
			}
			const previous = watch;
			current = conversation;
			watch = next.watch;
			shown = next.shown;
			void previous?.stop();
			// A new watch replaces a stalled one; the task graph's state is its own.
			const stalled = state.stalled?.tasks === undefined ? undefined : { tasks: state.stalled.tasks };
			update({ conversation: next.watch.value, transcript: transcriptOf(next.watch.value, shown.entries), stalled });
			advance(next.watch.value);
			follow(next.watch);
		};
		install(root, first);
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

		let tasks                            ;
		const closeTasks = ()       => {
			const graph = tasks;
			tasks = undefined;
			void graph?.stop();
		};

		let queue = Promise.resolve();
		// One at a time, so toggles, switches, and key presses apply in order.
		const command = (operation                     )                => {
			queue = queue.then(operation).catch(fail);
			return queue;
		};
		// A run that ended without an answer stays on screen as its conversation's `pi.live.runFailure` (SDK 1.5), so an
		// input that run settled adds no notice of its own; one settled without such a run (stale, say) still does.
		const watchAnswer = (submission            , conversation              )       => {
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
		const controller                    = {
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
					const thinking                     = agentOf(state.conversation).thinkingLevel ?? "off";
					await current.configure({ model: ref, thinkingLevel: clampThinkingLevel(model, thinking) }, context);
				}),
			// Only the panel: the graph stays observed, so live background work is never out of view.
			toggleTasks: () => command(async () => update({ tasksPanel: !state.tasksPanel })),
			switchConversation: (id) =>
				command(async () => {
					const next = await opened.conversation(id, context);
					if (next === undefined) throw new Error(`Conversation ${id} does not exist`);
					// The same read as the open: the whole active transcript, whatever this process showed of it before.
					install(next, await seed(next));
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
					void watch?.stop();
					commits.detach();
					closeTasks();
					// The resource end the fence records (#157 B3). Storage is `closed` only when the first actual close
					// resolved, no failure was seen before it, and the Session's own terminal result is not `failed`.
					const failures            = [];
					let storage                      = "failed";
					let envCleanup                        ;
					let lease                    = "released";
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
					const record           = {
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
		let storage                      = ticket.storageOpenAttempted ? "unknown" : "never-opened";
		// The init error first, then every cleanup failure: none is dropped.
		const failures            = [error];
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
		let lease                    = "released";
		try {
			await location.release();
		} catch (releaseError) {
			lease = "failed";
			failures.push(releaseError);
		}
		const ending           = { storage, lease, cause: failures.map(causeOf).join("; ") };
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
