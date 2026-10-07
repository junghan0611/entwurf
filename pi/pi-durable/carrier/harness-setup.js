                                                     
                                                                
import {
	createRegistry,
	               
	                     
	              
	              
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { applyHttpProxySettings, configureHttpDispatcher } from "entwurf-pi-dist:core/http-dispatcher.js";
import { findInitialModel, resolveCliModel } from "entwurf-pi-dist:core/model-resolver.js";
                                                                
                                                                      
import { createPiPrompt } from "./prompt.js";

/** pi's HTTP setup: proxy, idle timeouts, and one undici for fetch. Without it, some provider streams break off. */
export function configureHarnessHttp(settingsManager                 )       {
	applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());
}

/** Harness settings read at every use from pi's settings as loaded at startup. */
export function createHarnessSettings(settingsManager                 )                  {
	return {
		get stream() {
			const provider = settingsManager.getProviderRetrySettings();
			const idle = settingsManager.getHttpIdleTimeoutMs();
			return {
				timeoutMs: provider.timeoutMs ?? (idle === 0 ? 2147483647 : idle),
				maxRetryDelayMs: provider.maxRetryDelayMs,
				...(provider.maxRetries === undefined ? {} : { maxRetries: provider.maxRetries }),
			};
		},
		get compaction() {
			return settingsManager.getCompactionSettings();
		},
		get retry() {
			return settingsManager.getRetrySettings();
		},
		get steeringMode() {
			return settingsManager.getSteeringMode();
		},
		get followUpMode() {
			return settingsManager.getFollowUpMode();
		},
	};
}

/** A registry with pi's coding tools and system prompt. */
export function createCodingRegistry(settingsManager                 , cwd        )           {
	const registry = createRegistry();
	registry.install(CodingTools);
	registry.install(createPiPrompt(settingsManager, cwd));
	return registry;
}

/** One execution environment per directory, shared by every conversation in it. */
export class ExecutionEnvs {
	         #defaultCwd        ;
	         #envs = new Map                          ();

	constructor(defaultCwd        ) {
		this.#defaultCwd = defaultCwd;
	}

	         env = ({ cwd = this.#defaultCwd }           )                   => {
		let env = this.#envs.get(cwd);
		if (env === undefined) {
			env = new NodeExecutionEnv({ cwd });
			this.#envs.set(cwd, env);
		}
		return env;
	};

	async cleanup(context         )                {
		const envs = [...this.#envs.values()];
		this.#envs.clear();
		for (const env of envs) await env.cleanup(context);
	}
}

                               
	                          
	                                            
	                                  
 

/** The model a new root conversation starts with: an explicit `--provider`/`--model`, or pi's default resolution. */
export async function findInitialAgentModel(
	settingsManager                 ,
	modelRuntime              ,
	cli                                                         ,
)                        {
	if (cli !== undefined) {
		const resolved = resolveCliModel({ cliProvider: cli.provider, cliModel: cli.model, modelRuntime });
		if (resolved.error !== undefined || resolved.model === undefined) {
			throw new Error(`Could not resolve model: ${resolved.error ?? cli.model}`);
		}
		return {
			model: { provider: resolved.model.provider, modelId: resolved.model.id },
			...(resolved.thinkingLevel === undefined ? {} : { thinkingLevel: resolved.thinkingLevel }),
		};
	}
	const initial = await findInitialModel({
		scopedModels: [],
		isContinuing: false,
		defaultProvider: settingsManager.getDefaultProvider(),
		defaultModelId: settingsManager.getDefaultModel(),
		defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
		modelRuntime,
	});
	return {
		...(initial.model === undefined
			? {}
			: {
					model: { provider: initial.model.provider, modelId: initial.model.id },
					thinkingLevel: initial.thinkingLevel,
				}),
		...(initial.fallbackMessage === undefined ? {} : { fallbackMessage: initial.fallbackMessage }),
	};
}
