// #171 step 8 — the fixed texts of every ACP error stop, and the way out of each.
//
// Decision 17 (GLG 2026-11-21): a path that would reach `session/new` inside a
// conversation stops instead, with its record kept. Pi reads `errorMessage` alone
// to decide a whole-prompt retry (pi-ai `isRetryableAssistantError`) and an
// overflow recovery (`isContextOverflow`), and either one would be an automatic
// send after a stop. So each text here is a constant: no id, path, code or digit,
// and none of the words those two classifiers match. A wording is checked by the
// classifiers themselves (stop-texts.test.ts), never by eye: "ended without an
// answer" reads as transient, "stopped without an answer" does not.
//
// `text` is the whole `errorMessage`. The cause, a vendor code and the named
// inputs ride the lifecycle notice and stderr. `exit` is what the operator can do
// next, shown as a notice of its own (a notice is clipped at 80 characters, so
// it never shares a line with the cause); `null` means this build offers no way on, and
// each `null` is listed in ACP_STOPS_WITHOUT_EXIT so that adding one is a visible
// choice.

export interface AcpStop {
	/** The complete `errorMessage`. */
	readonly text: string;
	/** The operator's next move, for the notice. `null`: none in this build. */
	readonly exit: string | null;
}

const NEW_SESSION = "start a new session with /new; the record stays for diagnosis";
const NEXT_INPUT = "send the next input";

export const ACP_STOPS = {
	mode: {
		text: "entwurf: ACP models run under entwurf pi; this Pi has no entwurf control, so nothing was sent",
		exit: "start this session with entwurf pi",
	},
	host: {
		text: "entwurf: the ACP provider cannot read this Pi session, so nothing was sent",
		exit: "restart Pi",
	},
	invalid: {
		text: "entwurf: the ACP session record is not valid, so nothing was sent; it is kept as found",
		exit: NEW_SESSION,
	},
	unreadable: {
		text: "entwurf: the ACP session record cannot be read, so nothing was sent this turn; make it readable",
		exit: "make the record file readable, then send again",
	},
	intent: {
		text: "entwurf: an ACP session birth was attempted for this conversation and no id is recorded here, so nothing was sent",
		exit: NEW_SESSION,
	},
	reserve: {
		text: "entwurf: the birth of an ACP session could not be reserved, so nothing was sent",
		exit: "make the ACP birth directory writable, then send again",
	},
	idSave: {
		text: "entwurf: the ACP session id could not be saved, so no prompt was sent this turn",
		exit: NEW_SESSION,
	},
	unknown: {
		text: "entwurf: the ACP prompt stopped without an answer, so its outcome is unknown; the session record is kept",
		exit: NEXT_INPUT,
	},
	oneShotUnknown: {
		text: "entwurf: this one-shot ACP prompt stopped without an answer, so its outcome is unknown; nothing was sent again",
		exit: "run it again only if a second run is acceptable",
	},
	seal: {
		text: "entwurf: the last answer of this ACP session could not be confirmed in its record, so nothing was sent",
		// Until a turn can continue past a refused one, sending again stops on that refusal.
		exit: NEW_SESSION,
	},
	internal: {
		text: "entwurf: this ACP turn failed inside entwurf; whether anything was sent is not known here",
		exit: "restart Pi",
	},
	claudeSkip: {
		text: "entwurf: an earlier ACP prompt has no confirmed answer; its input is named in the notice and will not be sent again, so nothing was sent",
		exit: NEXT_INPUT,
	},
	firstUnknown: {
		text: "entwurf: the first prompt of this ACP session has no confirmed answer, so nothing was sent; start a new session explicitly",
		exit: NEW_SESSION,
	},
	changed: {
		text: "entwurf: the conversation changed since this ACP session last answered, so nothing was sent",
		exit: NEW_SESSION,
	},
	laterAnswer: {
		text: "entwurf: this conversation has a later answer the ACP session record does not cover, so nothing was sent",
		exit: NEW_SESSION,
	},
	noRecord: {
		text: "entwurf: this conversation has ACP history but no session record, so nothing was sent",
		exit: NEW_SESSION,
	},
	cwd: {
		text: "entwurf: this ACP session belongs to another directory, so nothing was sent",
		exit: "reopen this session in its own directory",
	},
	model: {
		text: "entwurf: this ACP session cannot switch to that model, so nothing was sent",
		exit: "switch back to the model this session started with",
	},
	config: {
		text: "entwurf: this ACP session cannot take the changed tools or permissions, so nothing was sent",
		exit: "restore the earlier tools and permissions, or use /new",
	},
	version: {
		text: "entwurf: this agent version is outside the range accepted for resume, so nothing was sent",
		exit: NEW_SESSION,
	},
	resume: {
		text: "entwurf: the ACP session could not be resumed, so no prompt was sent; its record is kept",
		exit: "send again later; if it repeats, start a new session with /new",
	},
	holder: {
		text: "entwurf: another process holds this ACP session, so nothing was sent",
		exit: "close the process the notice above names, then send again",
	},
	holderStale: {
		text: "entwurf: this ACP session's previous holder did not release it, so nothing was sent",
		exit: NEW_SESSION,
	},
	reload: {
		text: "entwurf: this ACP session is held by the module before /reload, so nothing was sent",
		exit: "restart Pi",
	},
	hook: {
		text: "entwurf: a provider hook changed this ACP prompt, so nothing was sent",
		exit: "disable the hook that rewrites provider payloads",
	},
	agyNotFound: {
		text: "entwurf: the agent has no record of this ACP session, so nothing more was sent; its record is kept",
		exit: NEW_SESSION,
	},
	load: {
		text: "entwurf: this agent offers no resume for its stored ACP session, so nothing was sent",
		exit: null,
	},
	piDurable: {
		text: "entwurf: resuming an ACP session inside pi-durable is not supported yet, so nothing was sent",
		exit: null,
	},
	shellInput: {
		text: "entwurf: this turn's input includes a shell or extension message this ACP session cannot place, so nothing was sent",
		exit: NEW_SESSION,
	},
	// #175: the agent was asked to compact its own session (a lone `/compact`) and did not answer that it
	// did. This turn's input was not sent; the next provider call asks for the compaction again, and the
	// input not sent here goes with it. Repeating stops the same way: the way out is a new session, or a
	// Pi branch without that compaction.
	vendorCompactFailed: {
		text: "entwurf: the ACP agent answered its own compaction request without completing it, so this turn's input was not sent",
		exit: "send again; if it repeats, start a new session with /new",
	},
	vendorCompactUnknown: {
		text: "entwurf: the ACP agent's own compaction has no confirmed outcome, so this turn's input was not sent",
		exit: "send again; if it repeats, start a new session with /new",
	},
} as const satisfies Record<string, AcpStop>;

export type AcpStopId = keyof typeof ACP_STOPS;

/** The stops this build leaves with no way on. Each is a decision, not an omission. */
export const ACP_STOPS_WITHOUT_EXIT: readonly AcpStopId[] = ["load", "piDurable"];

/** The longest notice the stream shows whole (event-mapper `NOTICE_TITLE_MAX`). */
export const ACP_STOP_NOTICE_MAX = 80;

/** The way out of a stop as a notice of its own, or `null` when this build has none. */
export function acpStopExitNotice(id: AcpStopId): string | null {
	const exit: string | null = ACP_STOPS[id].exit;
	return exit === null ? null : `next: ${exit}`;
}
