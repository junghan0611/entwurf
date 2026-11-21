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
	interim: {
		text: "entwurf: resuming a stored ACP session is not enabled in this build, so nothing was sent",
		exit: null,
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
		text: "entwurf: a previous ACP session id was never saved, so nothing was sent; start a new session explicitly",
		exit: NEW_SESSION,
	},
	idSave: {
		text: "entwurf: the ACP session id could not be saved, so no prompt was sent this turn",
		exit: "send the next input; after a restart this session needs /new",
	},
	unknown: {
		text: "entwurf: the ACP prompt stopped without an answer, so its outcome is unknown; the session record is kept",
		exit: NEXT_INPUT,
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
		text: "entwurf: this agent version is not measured for resume, so nothing was sent",
		exit: NEW_SESSION,
	},
	resume: {
		text: "entwurf: the ACP session could not be resumed, so no prompt was sent; its record is kept",
		exit: "send again later; if it repeats, start a new session with /new",
	},
	holder: {
		text: "entwurf: another process holds this ACP session, so nothing was sent",
		exit: "close the other process that holds this session",
	},
	holderStale: {
		text: "entwurf: this ACP session's previous holder did not release it, so nothing was sent",
		exit: "send again once the previous holder and its agent have exited",
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
	compacted: {
		text: "entwurf: inputs this ACP session never received were compacted away, so nothing was sent",
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
} as const satisfies Record<string, AcpStop>;

export type AcpStopId = keyof typeof ACP_STOPS;

/** The stops this build leaves with no way on. Each is a decision, not an omission. */
export const ACP_STOPS_WITHOUT_EXIT: readonly AcpStopId[] = ["interim", "load", "piDurable"];

/** The longest notice the stream shows whole (event-mapper `NOTICE_TITLE_MAX`). */
export const ACP_STOP_NOTICE_MAX = 80;

/** The way out of a stop as a notice of its own, or `null` when this build has none. */
export function acpStopExitNotice(id: AcpStopId): string | null {
	const exit: string | null = ACP_STOPS[id].exit;
	return exit === null ? null : `next: ${exit}`;
}
