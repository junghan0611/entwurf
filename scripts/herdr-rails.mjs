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
 * The closed pilot set for the herdr launch rail. Herdr's own `--kind` enum is much larger and
 * that is not evidence of support: every other backend is a named pre-mutation reject.
 *
 * The JSDoc cast is what keeps the TYPE half of this single source honest. Without it TypeScript
 * infers `readonly string[]` from a `.mjs` file and `HerdrFreshCallBackend` silently widens to
 * `string` — the tuple would still be one source at runtime while the compiler had stopped
 * checking anything. A gate pins both halves.
 *
 * @type {readonly ["pi", "claude-code"]}
 */
export const HERDR_FRESH_CALL_BACKENDS = Object.freeze(["pi", "claude-code"]);

/**
 * ONE model string per backend, and it is an example of SYNTAX, never of choice.
 *
 * `[관측: GLG, 날것 PC, 2026-09-17]` "일단 정확한 모델명을 모른다" — after a green install the first
 * thing missing is a call that works, and the two runtimes spell a model differently enough that
 * guessing fails: pi wants a provider-qualified path, Claude Code wants the vendor id alone.
 * That difference is the whole content of this map.
 *
 * @type {Readonly<Record<"pi" | "claude-code", string>>}
 */
export const MODEL_SYNTAX_EXAMPLE = Object.freeze({
	pi: "openai-codex/gpt-5.6-terra",
	"claude-code": "claude-sonnet-5",
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
 * @type {Readonly<Record<"pi" | "claude-code", string>>}
 */
export const RAIL_ENTRY_NOTE = Object.freeze({
	pi: "start it as `pi --entwurf-control` to be a garden citizen — a plain `pi` loads the extension but has no garden id, no control socket and no entwurf tools",
	"claude-code": "nothing to add — an ordinary `claude` picks up the entwurf tools through MCP",
});
