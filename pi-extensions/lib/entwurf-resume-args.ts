/**
 * entwurf-resume-args — the SINGLE source of truth for the `pi` argv that reopens a dormant
 * citizen, MEASURED against the runtime rather than inherited from the removed transport.
 *
 * ── What changed, and why the old shape was not reusable ──
 *
 * Until the visible-first cut this builder emitted `--mode json -p … <prompt>`: a headless JSON
 * child running one prompt-as-turn, which is what `spawn-bg`'s detached `defaultSpawnChild`
 * needed. The design notes carried that argv forward as "visibility-neutral, reuse verbatim".
 * It is not. Measured 2026-08-06 (private tmux + fixture, `pi --help`: `--print, -p` =
 * *non-interactive mode*): dropped into a tmux window, the headless prefix produces a JSON
 * stream and a turn, not a window an operator can type into. The visible dialect is the one
 * `mux-fresh-call` already measured for a fresh sibling — no `--mode`, no `-p`.
 *
 * So the shipped posture is now one shape, and it is the only one:
 *
 *   pi --entwurf-control [-e <bridge> …] --session <file> [--provider <p>] --model <m>
 *
 * There is deliberately NO prompt and no `launchArgs`. A resume opens the window; talking to the
 * citizen afterwards is `entwurf_v2`'s job on the socket this launch stands up. That split is
 * what makes the resumed turn free: measured, a promptless resume left the transcript
 * byte-identical (1666 → 1666) and started no model turn at all.
 *
 * The one-shot `legacy` variant (removed 2026-07-27) and the headless prefix (removed here) are
 * not kept behind a variant flag for compatibility. An exported branch no product path takes is
 * exactly what let this module's prose claim a live consumer for months.
 *
 * Provider/model identity is the caller's authority (`resolveResumeLaunchIdentity`) — this
 * builder only LAYS OUT argv, it never resolves identity. `explicitExtensionArgs` is preserved
 * verbatim: a recorded `provider=entwurf` resume needs the bridge re-injected or pi cannot
 * resolve the provider (#29). Measured on that axis: the resolver emits
 * `["-e", "<bridge>"]`, and the argv carries it exactly once, between `--entwurf-control` and
 * `--session`.
 *
 * The runtime path itself is NOT here. Resolving `pi` on PATH and proving it launchable belongs
 * to the mux lane (`mux-launch`), so this module emits the flags after the runtime and nothing
 * more — which is also why it stays import-free and can be read by both tsconfigs.
 */

export interface ResumePiArgsInput {
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
}

/**
 * Build the `pi` flags for a VISIBLE resume, in the measured order.
 *
 * Invariants the gate pins:
 *   - `--entwurf-control` is FIRST: the resumed session must stand its control socket up, or
 *     the transcript comes back with no address and the citizen is still unreachable.
 *   - no `--mode`, no `-p`, no positional prompt — the window is interactive and no turn runs.
 *   - `explicitExtensionArgs` appears exactly once, after the control flag and before
 *     `--session`.
 *   - provider is emitted only when recorded; `--model <m>` is the tail.
 */
export function buildResumePiArgs(input: ResumePiArgsInput): string[] {
	const args: string[] = ["--entwurf-control"];
	args.push(...input.explicitExtensionArgs);
	args.push("--session", input.sessionFile);
	if (input.provider) args.push("--provider", input.provider);
	args.push("--model", input.model);
	return args;
}
