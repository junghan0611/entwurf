type Role = "user" | "assistant" | "toolResult";
interface TextContent {
    type: "text";
    text: string;
}
interface ThinkingContent {
    type: "thinking";
    thinking?: string;
}
interface ToolCallBlock {
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
type ContentBlock = TextContent | ThinkingContent | ToolCallBlock | {
    type: string;
    [key: string]: unknown;
};
interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}
interface AssistantMessage {
    role: "assistant";
    content: ContentBlock[];
    api: string;
    provider: string;
    model: string;
    usage: Usage;
    stopReason?: string;
    errorMessage?: string;
    timestamp?: number;
}
interface InboundMessage {
    role: Role;
    content: ContentBlock[] | string;
}
type AssistantMessageEvent = {
    type: "start";
    partial: AssistantMessage;
} | {
    type: "done";
    message: AssistantMessage;
    reason?: string;
} | {
    type: "error";
    error: AssistantMessage;
} | {
    type: string;
    partial?: AssistantMessage;
    message?: AssistantMessage;
    [key: string]: unknown;
};
interface StubModelRow {
    id: string;
    name: string;
    api: string;
    provider: string;
    input: string[];
    cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    };
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
}
interface Context {
    messages?: InboundMessage[];
    workspaceDir?: string;
}
interface StreamOptions {
    signal?: AbortSignal;
    sessionId?: string;
    workspaceDir?: string;
}
interface FactoryCtx {
    workspaceDir?: string;
    agentDir?: string;
    pluginConfig?: PluginConfig;
    config?: PluginConfig;
    settings?: PluginConfig;
}
interface PluginConfig {
    mcpInjection?: "self" | "openclaw-bridge" | "both";
    lockConflictPolicy?: "strict" | "new-session";
    piBinaryPath?: string;
    entwurfTargetsPath?: string;
    spawnTimeoutSeconds?: number;
}
interface ResolveDynamicModelCtx {
    modelId: string;
}
interface StaticCatalogPayload {
    provider: string;
    models: Array<Omit<StubModelRow, "provider">>;
}
interface SyntheticAuth {
    apiKey: string;
    source: string;
    mode: "api-key";
}
interface ProviderPlugin {
    id: string;
    label: string;
    staticCatalog: {
        run: () => StaticCatalogPayload;
    };
    resolveDynamicModel: (ctx: ResolveDynamicModelCtx) => StubModelRow;
    createStreamFn: (ctx: FactoryCtx) => (model: StubModelRow, context: Context, options?: StreamOptions) => EventStream;
    resolveSyntheticAuth: (ctx: unknown) => SyntheticAuth;
}
interface PluginLogger {
    info?: (message: string) => void;
    error?: (message: string) => void;
}
interface PluginRegisterApi {
    registerProvider: (plugin: ProviderPlugin) => void;
    logger?: PluginLogger;
}
interface ConfigSchemaSuccess {
    success: true;
    data: PluginConfig | undefined;
}
interface ConfigSchemaFailure {
    success: false;
    error: {
        issues: Array<{
            path: Array<string | number>;
            message: string;
        }>;
    };
}
interface ConfigSchema {
    safeParse: (value: unknown) => ConfigSchemaSuccess | ConfigSchemaFailure;
    jsonSchema: {
        type: "object";
        additionalProperties: true;
    };
}
interface PluginEntry {
    id: string;
    name: string;
    description: string;
    configSchema: ConfigSchema;
    register: (api: PluginRegisterApi) => void;
}
declare class EventStream {
    private readonly isComplete;
    private readonly extractResult;
    private readonly queue;
    private readonly waiting;
    private done;
    private resolveFinalResult;
    private readonly finalResultPromise;
    constructor(isComplete: (event: AssistantMessageEvent) => boolean, extractResult: (event: AssistantMessageEvent) => AssistantMessage);
    push(event: AssistantMessageEvent): void;
    end(result?: AssistantMessage): void;
    [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent>;
    result(): Promise<AssistantMessage>;
}
declare const entry: PluginEntry;
export default entry;
//# sourceMappingURL=index.d.ts.map