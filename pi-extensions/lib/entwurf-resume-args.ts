/**
 * entwurf-resume-args — the SINGLE source of truth for the `pi` argv a resume spawn is
 * launched with (0.11 Stage 0 step 5c-3b). Two variants share this builder so the legacy
 * async-entwurf worker and the v2 spawn-bg resident citizen can NEVER drift in their launch
 * shape — the one place the `--no-extensions` / `--entwurf-control` decision lives.
 *
 * The load-bearing difference (A1):
 *   - legacy — a one-shot async worker. `pi -p <prompt>` runs the resume turn and EXITS;
 *     `proc.on('close')` then delivers the followUp. It is launched `--no-extensions` AND
 *     WITHOUT `--entwurf-control` precisely BECAUSE a control-socket server would keep
 *     `pi -p` from exiting (entwurf.ts:22 — that keep-alive was a bug for a one-shot worker).
 *   - v2-control — a RESIDENT, addressable garden citizen. The resume turn STILL runs via
 *     `-p <prompt>` (the prompt-as-turn authority is unchanged), but the child is launched
 *     WITH `--entwurf-control` and WITHOUT `--no-extensions`, so the very keep-alive legacy
 *     avoided is now the GOAL: the resumed session stands its control socket up and stays
 *     live. The 5c-3a watcher's `socket-alive` is exactly that "resumed citizen is up and
 *     addressable" observation (→ release the per-gid lock, child lives on); `child-exited`
 *     is the early-exit/failure observation. `plan.launchArgs` (`--approve` or empty, from
 *     the decider's preflight) rides along as pi flags before the prompt.
 *
 * Provider/model identity is the caller's existing authority (readSessionIdentity /
 * getEntwurfExplicitExtensions) — this builder only LAYS OUT argv, it never resolves
 * identity. `explicitExtensionArgs` is preserved verbatim in BOTH variants: a recorded
 * `provider=entwurf` resume needs the bridge re-injected to resolve the provider, and
 * dropping it when `--no-extensions` is removed would re-introduce the "Unknown provider"
 * footgun (#29). (A future slice may dedup against settings-loaded extensions; not here.)
 *
 * This module is import-free on purpose: the legacy launcher (entwurf-async.ts) is
 * root-typechecked and imports it as `./entwurf-resume-args.js`, while the v2 adapter and
 * the gate import the same source — a self-contained string builder keeps both configs happy.
 */

export type ResumeArgsVariant = "legacy" | "v2-control";

export interface ResumePiArgsInput {
	/** legacy = one-shot worker (`--no-extensions`, no control socket); v2-control =
	 * resident citizen (`--entwurf-control`, extensions loaded). */
	variant: ResumeArgsVariant;
	/** The garden id; `pi --session-id <gid>` resumes the existing JSONL AND, under
	 * `--entwurf-control`, derives the control socket at ~/.pi/entwurf-control/<gid>.sock. */
	sessionId: string;
	/** The explicit `--extension …` re-injection (ACP bridge / provider resolution).
	 * Preserved verbatim in BOTH variants — load-bearing for a entwurf resume. */
	explicitExtensionArgs: readonly string[];
	/** Recorded provider (may be null/undefined — then no `--provider` flag is emitted). */
	provider: string | null | undefined;
	/** The resolved launch model (caller applies `modelOverride ?? resumeModel`). */
	model: string;
	/** The resume prompt — the final positional, run as the model turn under `-p`. */
	prompt: string;
	/** v2-control ONLY: the decider's `plan.launchArgs` (`["--approve"]` or `[]`). Ignored
	 * for legacy (the legacy path computes its own preflight elsewhere). */
	launchArgs?: readonly string[];
}

/**
 * Build the `pi` argv for a resume spawn. The SHARED prefix is `--mode json -p` (headless
 * JSON child, prompt-as-turn); the variant then chooses the extension/socket posture; the
 * SHARED suffix is `[…ext args] --session-id <gid> [--provider <p>] --model <m> <prompt>`.
 *
 * Invariants the gate pins:
 *   - legacy  carries `--no-extensions` and NO `--entwurf-control`.
 *   - v2-control carries `--entwurf-control` and NO `--no-extensions`, plus `-p` + prompt.
 *   - `explicitExtensionArgs` appears exactly once in both.
 *   - `launchArgs` is included for v2-control (before the suffix) and ignored for legacy.
 *   - provider/model/prompt identity is laid out identically in both.
 */
export function buildResumePiArgs(input: ResumePiArgsInput): string[] {
	const args: string[] = ["--mode", "json", "-p"];

	if (input.variant === "legacy") {
		// One-shot worker: no extensions, no control socket (so `pi -p` can exit).
		args.push("--no-extensions");
	} else {
		// Resident citizen: stand the control socket up (A1) and keep extensions loaded.
		// The keep-alive legacy avoided is the goal here. `--approve`/launchArgs ride along.
		args.push("--entwurf-control");
		args.push(...(input.launchArgs ?? []));
	}

	// Shared suffix — identical identity layout in both variants.
	args.push(...input.explicitExtensionArgs);
	args.push("--session-id", input.sessionId);
	if (input.provider) args.push("--provider", input.provider);
	args.push("--model", input.model, input.prompt);

	return args;
}
