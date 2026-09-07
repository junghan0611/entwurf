/**
 * resolve-tmux-session — the ONE resolution of a caller-supplied tmux SESSION NAME into the
 * native `$id` a placement may target. Narrow leaf of the fresh-call composition (#105); it
 * owns the name grammar and the name→id lookup and NOTHING else — it never runs tmux (the
 * runner is injected), never phrases a hint (each consumer owns its own wording), never
 * creates a session, and has no fallback session.
 *
 * Same shape and same discipline as `classify-tmux-cwd.ts`: this file imports nothing at all,
 * not even a node builtin, so it stays deletable on its own and cannot acquire an opinion
 * about mux, entwurf, identity or delivery. The injected runner is matched STRUCTURALLY to
 * `mux-placement.TmuxRun` rather than by a type import, for the same reason.
 *
 * Every rule below is a MEASURED tmux 3.6a behaviour (2026-09-07, private `-S` servers; the
 * research lane's two independent reproductions are in issue #105's thread), and each one is a
 * way a lookup would look successful while addressing the wrong thing:
 *
 *   1. `-t '=NAME'` performs NO format expansion — `=a}b`, `=a|b`, `=a b`, `=a,b` all resolve
 *      exactly. The `-f '#{==:#{session_name},NAME}'` FILTER engine does the opposite: a `}`
 *      inside the name closes the comparison early, the filter becomes a truthy string, and
 *      EVERY session matches (6/6 measured). So the engine here is `-t '='`, never a filter.
 *   2. absence is reported by EXIT CODE, not by output. `list-windows -t '=nosuch'` exits 1
 *      with `can't find session: nosuch`, while `display-message -p -t '=NAME'` exits 0 with
 *      EMPTY output for a name that exists AND for one that does not — it is unusable as a
 *      probe. Only an rc=0 answer is ever parsed here.
 *   3. some names cannot be addressed at all, for two different measured reasons. `#` is
 *      FORMAT-EXPANDED when `new-session -s` stores it (`a#{x}` stored as `a`), so the
 *      requested name never exists; and `.`/`:` are tmux's own PANE/WINDOW separators inside a
 *      `-t` target, so `-t '=a.b'` answers `can't find pane: b` and `-t '=a:b'` answers
 *      `can't find window: b` (or `can't find session: a`, depending on whether a session `a`
 *      happens to exist). Both are ALSO normalised to `_` when stored — `a.b` and `a:b` are
 *      the same stored name `a_b`, so whichever is created second is a `duplicate session`
 *      error rather than a second seat — but the lookup half is the load-bearing one: whatever
 *      tmux stored, the REQUESTED name can never address it.
 *      NOTE the difference from `classify-tmux-cwd.ts`: there `#(…)`
 *      was observed EXECUTING inside a `-c` value; here it expands but does NOT execute (a
 *      `q#(touch …)q` name stored as `qq` and wrote no file). Do not copy that leaf's
 *      rationale into this one, or relaxing one will silently relax the other.
 *   4. `=` protects a name against `%9`/`@1` id syntax but NOT against `$`: with a session
 *      NAMED `$0` beside one whose ID is `$0`, `-t '=$0'` resolves the ID (measured — the
 *      name-holder was `$1` and the lookup returned `$0`). And a session literally named
 *      `=foo` needs `==foo`. An escaping layer here would be a second parser to keep true.
 *
 * The grammar is `^[A-Za-z0-9][A-Za-z0-9_-]*$`, and it is WIDER than what rules 3-4 force. Say
 * that plainly rather than letting the reasons above cover the whole refusal set: `a}b`, `a|b`,
 * `a b`, `a;b`, `a,b` and `_a` are all created verbatim AND resolved exactly by `-t '=NAME'`
 * (measured 2026-09-07, one server, six sessions, six exact ids). They are refused anyway, and
 * the reason is a DECISION, not a tmux limit — this is the grammar entwurf would need to CREATE
 * a session safely, kept symmetric for lookup, with the remaining foreign-name width closed
 * until an operator need for it is actually observed. That is why the refusal is
 * `tmux-session-name-invalid` ("this rail does not address that shape") and not
 * `tmux-session-missing` ("no such session here"): the caller's repair differs, and telling an
 * operator their perfectly findable session "could never be found" would be a false cause.
 *
 * ONE BOUNDED IMPRECISION, STATED RATHER THAN LAUNDERED: rc≠0 also covers "no server running
 * on <socket>" (measured). This leaf reads every rc≠0 as `tmux-session-missing`, so a server
 * that died between the caller's context proof and this lookup is reported under the narrower
 * word. That is safe — both readings are refusals that mutate nothing, and the consumer's hint
 * names both — and it is preferred over matching tmux's own stderr text, which would pin this
 * leaf to one vendor version's wording.
 */

/** Why a caller-named session could not become a target. Two stable literals — the consuming
 * composition widens its own reject union with this type, so the strings are contract. */
export type TmuxSessionRejectReason = "tmux-session-name-invalid" | "tmux-session-missing";

/** What the injected runner returns. Structurally identical to `mux-placement.TmuxRun`; kept
 * as its own declaration so this leaf imports nothing. */
export interface TmuxSessionLookupRun {
	status: number | null;
	stdout: string;
	stderr: string;
}

export type TmuxSessionLookupResult = { ok: true; sessionId: string } | { ok: false; reason: TmuxSessionRejectReason };

const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SESSION_ID = /^\$[0-9]+$/;

/**
 * Classify a candidate session NAME. Separate from the lookup because the operator's next move
 * differs: an out-of-grammar name is a shape this rail does not address — some of those tmux
 * genuinely cannot resolve (rules 3-4), others it resolves fine and this rail declines anyway —
 * while a missing session is something the operator creates and retries.
 */
export function classifyTmuxSessionName(name: string): "tmux-session-name-invalid" | null {
	return SESSION_NAME.test(name) ? null : "tmux-session-name-invalid";
}

/** The lookup argv. `-t '=NAME'` is the exact-name selector; `list-windows` is the engine that
 * answers with an exit code for absence. The builder re-validates rather than trusting its
 * caller, the same way the fresh-call argv builder re-checks a cwd. */
export function buildTmuxSessionLookupArgs(name: string): string[] {
	if (classifyTmuxSessionName(name)) {
		throw new Error(`resolve-tmux-session: refusing to build a lookup for an unresolvable session name: ${name}`);
	}
	return ["list-windows", "-t", `=${name}`, "-F", "#{session_id}"];
}

/**
 * Resolve a session name to its native `$id` on whatever server the runner's environment names.
 * The id is the ONLY thing a caller-supplied name is allowed to become: everything downstream
 * targets `$id`, never the name again.
 *
 * A session always holds at least one window, so an rc=0 answer prints one `$id` line per
 * window and they are all the same id. An rc=0 that cannot be read that way is an operational
 * anomaly, not an answer about the session, and is raised rather than turned into a refusal.
 */
export function resolveTmuxSessionId(
	name: string,
	run: (args: string[]) => TmuxSessionLookupRun,
): TmuxSessionLookupResult {
	const badName = classifyTmuxSessionName(name);
	if (badName) return { ok: false, reason: badName };
	const result = run(buildTmuxSessionLookupArgs(name));
	// A signalled call is not tmux answering — it carries no information about the session at
	// all, so it must never be read as absence.
	if (result.status === null) {
		throw new Error(
			`resolve-tmux-session: the lookup for session "${name}" was killed by a signal: ${result.stderr.trim()}`,
		);
	}
	if (result.status !== 0) return { ok: false, reason: "tmux-session-missing" };
	const lines = result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const first = lines[0];
	if (first === undefined || !SESSION_ID.test(first) || lines.some((line) => line !== first)) {
		throw new Error(
			`resolve-tmux-session: tmux answered rc=0 for session "${name}" with something that is not one native session id: ${JSON.stringify(result.stdout)}`,
		);
	}
	return { ok: true, sessionId: first };
}
