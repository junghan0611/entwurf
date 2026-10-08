                                                                     
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { clampThinkingLevel, getSupportedThinkingLevels,                         } from "@earendil-works/pi-ai";
import {
	                
	                  
	                    
	                      
	            
	                 
	               
	Harness,
	                          
	              
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
import { selectSession } from "./sessions.js";
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

export async function openDurable(options                     = {})                             {
	if (options.model !== undefined && options.continueSession) {
		throw new Error("An explicit model applies only to a new session, not to a continued one");
	}
	const location = await selectSession(options.cwd ?? process.cwd(), options.continueSession ?? false);
	const envs = new ExecutionEnvs(location.cwd);
	let harness                     ;
	try {
		const modelRuntime = await ModelRuntime.create();
		const settingsManager = SettingsManager.create(location.cwd);
		configureHarnessHttp(settingsManager);
		const settings = createHarnessSettings(settingsManager);
		const registry = createCodingRegistry(settingsManager, location.cwd);
		registry.install(Subagent);
		for (const extension of options.extensions ?? []) registry.install(extension);

		const pendingReports            = [];
		let report                           = (error) => pendingReports.push(error);
		harness = await Harness.open(
			await openNodeSqliteStorage(location.database),
			{
				models: modelRuntime,
				registry,
				settings,
				env: envs.env,
				onReport: (error) => report(error),
			},
			context,
		);
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
		let conversation                                            = await root.viewState(context);
		const models = ()                 =>
			modelRuntime.getAvailableSnapshot().map((model) => ({
				provider: model.provider,
				modelId: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
			}));

		let state              = {
			session: { id: location.id, directory: location.directory, cwd: location.cwd },
			conversation: conversation.value,
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
		report = (error) => notice("warning", error instanceof Error ? error.message : String(error));
		for (const error of pendingReports) report(error);
		let unsubscribe = conversation.subscribe((value) => update({ conversation: value }));
		// Subagents appear as their conversations are created. A commit listener only records; it calls no Session API.
		const unsubscribeCommits = harness.subscribeCommits((publication) => {
			let conversations = state.conversations;
			for (const change of publication.changes) {
				if (change.type === "conversation") {
					conversations = [...conversations, { id: change.value.id, label: label(change.value.id) }];
				} else if (change.type === "entry" && change.value.kind === "pi.user") {
					const id = change.value.conversationId;
					conversations = conversations.map((summary) =>
						summary.id === id && summary.title === undefined ? { ...summary, ...titleOf(change.value) } : summary,
					);
				}
			}
			if (conversations !== state.conversations) update({ conversations });
		});

		let tasks                                                ;
		let unsubscribeTasks = ()       => {};
		const closeTasks = ()       => {
			unsubscribeTasks();
			tasks?.dispose();
			tasks = undefined;
		};

		let queue = Promise.resolve();
		// One at a time, so toggles, switches, and key presses apply in order.
		const command = (operation                     )                => {
			queue = queue.then(operation).catch(fail);
			return queue;
		};
		const watchAnswer = (submission            )       => {
			void submission.wait(context).then((settled) => {
				if (settled.status === "unanswered" && settled.reason !== "aborted") {
					notice(
						"error",
						`No answer: ${settled.reason}${settled.detail === undefined ? "" : ` ${JSON.stringify(settled.detail)}`}`,
					);
				}
			}, fail);
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
				command(async () => watchAnswer(await current.submit({ type: "input", content: text, whenBusy }, context))),
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
					const nextState = await next.viewState(context);
					unsubscribe();
					conversation.dispose();
					current = next;
					conversation = nextState;
					unsubscribe = nextState.subscribe((value) => update({ conversation: value }));
				}),
		};

		const saved = agentOf(state.conversation).model;
		if (saved === undefined) notice("warning", "No model configured; select one with /model.");
		else if (modelRuntime.getModel(saved.provider, saved.modelId) === undefined) {
			notice("warning", `Saved model is unavailable: ${saved.provider}/${saved.modelId}`);
		}
		if (initial?.fallbackMessage !== undefined) notice("info", initial.fallbackMessage);
		// The task graph is observed until close; its panel starts open and /tasks hides it.
		const graph = await opened.taskGraph(context);
		tasks = graph;
		update({ tasks: graph.value });
		unsubscribeTasks = graph.subscribe((value) => update({ tasks: value }));
		// Recovered work from an interrupted turn continues now.
		harness.resume();

		let closing                           ;
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
			close() {
				closing ??= (async () => {
					unsubscribe();
					unsubscribeCommits();
					conversation.dispose();
					closeTasks();
					try {
						// Close writes no outcome: a running turn resumes with --continue.
						await opened.close(context);
						await envs.cleanup(context);
					} finally {
						await location.release();
					}
				})();
				return closing;
			},
		};
	} catch (error) {
		await harness?.close(context).catch(() => {});
		await location.release().catch(() => {});
		throw error;
	}
}
