/**
 * herdr-rails — the ONE place the herdr rail's backend set and its per-backend model SYNTAX
 * example are written down (#116 A7).
 *
 * WHY THIS FILE EXISTS. Three surfaces were about to say the same two things in three
 * dialects: `herdr-fresh-call.ts` owned the closed backend tuple, `build.mjs` narrated one
 * model id per harness at install time, and the status pane was about to print a RAILS block.
 * Three copies of one fact is how a rail quietly grows a fourth backend in prose that no
 * dispatch honours. So the fact lives here and the three read it.
 *
 * WHY `.mjs` AND NOT `.ts`. It is read by two runtimes that cannot agree on anything else:
 * the Herdr plugin runs `node lib/status.mjs` with no loader flags at all, and the pi
 * extension is typechecked by `tsc`. A `.ts` leaf would be unloadable by the first; a second
 * copy would defeat the point. `protocol.js` set this precedent for exactly the same reason
 * (root tsconfig.json `allowJs`), and this file keeps its shape: dependency-free, no imports,
 * no environment, no IO, so importing it can never be a side effect.
 *
 * WHAT THIS FILE IS NOT, and each absence is load-bearing:
 *   - NOT a model catalogue. One example per backend, chosen to show the SHAPE of the string
 *     (`provider/model` vs a bare vendor id). Adding a second example starts a list, a list
 *     invites completeness, and completeness is a catalogue Entwurf would then be expected to
 *     keep current for every vendor. `entwurf_fresh_call` takes a model string with no default
 *     and validates nothing; that is the contract, and an example must not imply otherwise.
 *   - NOT a supported-model set, a recommendation, or a validator. Nothing reads MODEL_SYNTAX_EXAMPLE
 *     to decide anything — it is display text on three surfaces.
 *   - NOT a provider, billing or quota statement. No rail here names a provider, a subscription
 *     or a cost. `#76` is about which rail a sibling may be launched on, and a syntax example
 *     that mentioned a provider would read as an answer to it. It does not answer it.
 *   - NOT a launcher, and not a claim that any binary exists. `HERDR_AGENT_KIND` (the herdr
 *     `--kind` token) stays with the rail that spends it; this leaf carries no argv.
 */

/**
 * The backends the herdr rail opens through `tab create` + `agent start --kind`. Herdr's own
 * `--kind` enum is much larger and that is not evidence of support. This set alone keys the
 * agent-start maps (`HERDR_AGENT_KIND`, `HERDR_CANONICAL_EXECUTABLE`): a backend outside it has no
 * herdr kind, and giving it one would start a different program under its name.
 *
 * The JSDoc cast is what keeps the TYPE half of this single source honest. Without it TypeScript
 * infers `readonly string[]` from a `.mjs` file and `HerdrAgentStartBackend` silently widens to
 * `string` — the tuple would still be one source at runtime while the compiler had stopped
 * checking anything. A gate pins both halves.
 *
 * @type {readonly ["pi", "claude-code"]}
 */
export const HERDR_AGENT_START_BACKENDS = Object.freeze(["pi", "claude-code"]);

/**
 * The backends the herdr rail opens through ONE fixed `layout.apply` request on the caller's own
 * herdr socket (#157 A-L1). pi-durable has no herdr agent kind, so it is launched as the package's
 * own verified `run.sh pi-durable …` argv vector in a new tab — never disguised as `--kind pi`.
 *
 * @type {readonly ["pi-durable"]}
 */
export const HERDR_LAYOUT_LAUNCH_BACKENDS = Object.freeze(["pi-durable"]);

/**
 * Everything `entwurf_fresh_call` actually opens inside herdr: the union of the two launch domains.
 * Admission and refusal read THIS set, so every backend outside it is a named pre-mutation reject
 * and no backend is admitted by one domain while another surface says it is refused.
 *
 * The status pane's RAILS block renders the two domains as separate groups — agent start, then
 * layout — over this aggregate (#157 A-L2). The install narration covers only the integrations it
 * activated, and pi-durable is never one: it has no herdr agent integration to activate.
 *
 * @type {readonly ["pi", "claude-code", "pi-durable"]}
 */
export const HERDR_FRESH_CALL_BACKENDS = Object.freeze([
	...HERDR_AGENT_START_BACKENDS,
	...HERDR_LAYOUT_LAUNCH_BACKENDS,
]);

/**
 * ONE model string per backend, and it is an example of SYNTAX, never of choice.
 *
 * `[관측: GLG, 날것 PC, 2026-09-17]` "일단 정확한 모델명을 모른다" — after a green install the first
 * thing missing is a call that works, and the two runtimes spell a model differently enough that
 * guessing fails: pi wants a provider-qualified path, Claude Code wants the vendor id alone.
 * That difference is the whole content of this map. pi-durable takes pi's shape — its preflight
 * refuses a model that is not provider-qualified (`pi-durable-model-not-provider-qualified`) — so its
 * example is the same shape string, not a choice of model.
 *
 * @type {Readonly<Record<"pi" | "claude-code" | "pi-durable", string>>}
 */
export const MODEL_SYNTAX_EXAMPLE = Object.freeze({
	pi: "openai-codex/gpt-5.6-terra",
	"claude-code": "claude-sonnet-5",
	"pi-durable": "openai-codex/gpt-5.6-terra",
});

/**
 * How a citizen on each backend is REACHED once it exists, in the operator's words. This is the
 * rail fact the status pane's RAILS block renders and the install narration states — the same
 * sentence, so a host cannot be told two different things about one backend.
 *
 * `[관측: GLG, 날것 PC, 2026-09-17]` from the operator's chair a plain `pi` looks identical to a
 * citizen pi: the install says green, `pi` starts, and nothing is there. Citizenship is argv-gated
 * on purpose, and that gate is invisible unless something says it out loud.
 *
 * pi-durable's note says what it is NOT here as much as how it is reached: it is not an integration
 * this plugin activates, and herdr has no agent kind for it, so nothing detects it or associates a
 * session with it.
 *
 * @type {Readonly<Record<"pi" | "claude-code" | "pi-durable", string>>}
 */
export const RAIL_ENTRY_NOTE = Object.freeze({
	pi: "start it as `pi --entwurf-control` to be a garden citizen — a plain `pi` loads the extension but has no garden id, no control socket and no entwurf tools",
	"claude-code": "nothing to add — an ordinary `claude` picks up the entwurf tools through MCP",
	"pi-durable":
		"not a Herdr integration this plugin activates — inside Herdr, `entwurf_fresh_call` opens it in a new tab through ONE layout request; Herdr has no agent kind for it, so it is neither detected nor associated with a session, and its peers placement reads unobserved",
});
