/**
 * entwurf-resume-args — the SINGLE source of truth for the `pi` argv a resume spawn is
 * launched with (0.11 Stage 0 step 5c-3b). One place owns the
 * `--no-extensions` / `--entwurf-control` decision so the launch shape cannot drift.
 *
 * The shipped posture (A1): a RESIDENT, addressable garden citizen. The resume turn runs via
 * `-p <prompt>` (the prompt-as-turn authority), and the child is launched WITH
 * `--entwurf-control` and WITHOUT `--no-extensions` — the keep-alive is the GOAL here: the
 * resumed session stands its control socket up and stays addressable. The 5c-3a watcher's
 * `socket-alive` is exactly that "resumed citizen is up" observation (→ release the per-gid
 * lock, child lives on); `child-exited` is the early-exit/failure observation.
 * `plan.launchArgs` (`--approve` or empty, from the decider's preflight) rides along as pi
 * flags before the prompt.
 *
 * A second `legacy` one-shot posture (`--no-extensions`, no control socket, so `pi -p` could
 * exit) lived here until 2026-07-27 and was removed with its launcher and the v1 verbs.
 *
 * Provider/model identity is the caller's existing authority (readSessionIdentity /
 * getEntwurfExplicitExtensions) — this builder only LAYS OUT argv, it never resolves
 * identity. `explicitExtensionArgs` is preserved verbatim: a recorded `provider=entwurf`
 * resume needs the bridge re-injected to resolve the provider, and dropping it would
 * re-introduce the "Unknown provider" footgun (#29). (A future slice may dedup against
 * settings-loaded extensions; not here.)
 *
 * This module is import-free on purpose: the v2 adapter and the gate import the same source,
 * and a self-contained string builder keeps both tsconfigs happy.
 */

/** The one shipped launch posture: a resident citizen (`--entwurf-control`, extensions
 * loaded). The `legacy` one-shot variant was removed with its launcher (2026-07-27) — an
 * exported branch no product path took was what let this module's prose claim a second
 * live consumer for months. Reviving a one-shot posture means adding it back deliberately,
 * with a consumer, not un-deleting a dead enum member. */
export type ResumeArgsVariant = "v2-control";

export interface ResumePiArgsInput {
	/** v2-control = resident citizen (`--entwurf-control`, extensions loaded). */
	variant: ResumeArgsVariant;
	/** ABSOLUTE path of the session JSONL to resume — pi's `--session <path>` (#50 C2).
	 * It replaced `--session-id <gardenId>`, which did two jobs that are no longer the
	 * same string: it named the session to reopen AND fixed the control-socket key. The
	 * record owns the address now (the resumed child derives its socket from its OWN
	 * record at session_start), so the launch argument is reduced to what it always
	 * really was — WHICH session file. `--session-id` additionally CREATES the id when
	 * missing, so passing a garden id post-cut would silently mint an empty session
	 * instead of resuming one. A path cannot do that. */
	sessionFile: string;
	/** The explicit `--extension …` re-injection (ACP bridge / provider resolution).
	 * Preserved verbatim — load-bearing for a entwurf resume. */
	explicitExtensionArgs: readonly string[];
	/** Recorded provider (may be null/undefined — then no `--provider` flag is emitted). */
	provider: string | null | undefined;
	/** The resolved launch model (caller applies `modelOverride ?? resumeModel`). */
	model: string;
	/** The resume prompt — the final positional, run as the model turn under `-p`. */
	prompt: string;
	/** The decider's `plan.launchArgs` (`["--approve"]` or `[]`). */
	launchArgs?: readonly string[];
}

/**
 * Build the `pi` argv for a resume spawn. The prefix is `--mode json -p` (headless JSON
 * child, prompt-as-turn); then the resident posture; then
 * `[…ext args] --session <file> [--provider <p>] --model <m> <prompt>`.
 *
 * Invariants the gate pins:
 *   - v2-control carries `--entwurf-control` and NO `--no-extensions`, plus `-p` + prompt.
 *   - `explicitExtensionArgs` appears exactly once.
 *   - `launchArgs` is included before the suffix.
 *   - provider/model/prompt identity layout is fixed.
 */
export function buildResumePiArgs(input: ResumePiArgsInput): string[] {
	const args: string[] = ["--mode", "json", "-p"];

	// Resident citizen: stand the control socket up (A1) and keep extensions loaded. The
	// keep-alive the removed one-shot launcher had to avoid is precisely the goal here —
	// the resumed session must stay addressable. `--approve`/launchArgs ride along.
	args.push("--entwurf-control");
	args.push(...(input.launchArgs ?? []));

	// Suffix — the fixed identity layout.
	args.push(...input.explicitExtensionArgs);
	args.push("--session", input.sessionFile);
	if (input.provider) args.push("--provider", input.provider);
	args.push("--model", input.model, input.prompt);

	return args;
}
