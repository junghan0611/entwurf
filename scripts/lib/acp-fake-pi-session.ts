// A stand-in for the Pi session a resident ACP turn reads (#171 step 8), for gates and tests that
// drive `streamAcpTurn` directly.
//
// Pi appends each turn's inputs before it calls the provider and stores the provider's final
// assistant message whole: turn id (`responseId`), stop reason, error text and diagnostics. This
// fake keeps the same log per session id from what a gate already has: the context it passes and
// the stream it gets back. The first call for a session id takes its context's messages as the
// entries Pi would hold. Every later call appends the user messages its context has beyond the ones
// already logged. A turn that failed or was aborted is logged as it was sealed. A turn that
// completed is logged when the next context arrives, as that context shows it (the assistant just
// before the first new input) with the provider and `responseId` of the sealed message: Pi hands the
// provider the very message it stored, and a gate's context stands in for it. With no such
// assistant in the context, the sealed message itself is logged.
//
// Pi's context is made of the messages it stored (pi-coding-agent messages.js `convertToLlm` drops
// no assistant), so an answer there carries the turn id it was sealed with. Where a gate's context
// has an assistant in the place of a logged Entwurf answer, the turn is given the logged one.

import { buildSessionProjection, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AcpSessionReader } from "../../pi-extensions/lib/acp-host-facts.ts";

type Turn = (model: unknown, context: unknown, options?: unknown, deps?: unknown) => unknown;

export interface FakePiHost {
	/** For `deps.sessionReader`. */
	sessionReader(): AcpSessionReader | undefined;
	/** The same module with `streamAcpTurn` wrapped to keep the fake session in step. */
	wrap<T extends { streamAcpTurn: (...args: never[]) => unknown }>(backend: T): T;
	/** Replace the branch the next call for this session id reads. */
	setBranch(sessionId: string, branch: unknown[]): void;
	/** The `responseId` of the last final message seen for this session id. */
	lastTurnId(sessionId: string): string | undefined;
}

export function entriesOf(
	messages: readonly unknown[],
	lastAnswer?: { responseId: string; stopReason?: unknown; errorMessage?: unknown; content?: unknown },
): unknown[] {
	let lastAssistant = -1;
	messages.forEach((m, i) => {
		if ((m as { role?: unknown })?.role === "assistant") lastAssistant = i;
	});
	const stamped = messages.map((message, i) =>
		i === lastAssistant && lastAnswer
			? { ...(message as object), provider: "entwurf", responseId: lastAnswer.responseId }
			: message,
	);
	if (lastAssistant === -1 && lastAnswer && stamped.length > 0) {
		stamped.splice(stamped.length - 1, 0, {
			role: "assistant",
			content: lastAnswer.content ?? [],
			provider: "entwurf",
			responseId: lastAnswer.responseId,
			// As Pi stored it: how the turn ended, and the text it ended with when it failed.
			stopReason: lastAnswer.stopReason ?? "stop",
			...(lastAnswer.errorMessage === undefined ? {} : { errorMessage: lastAnswer.errorMessage }),
		});
	}
	return stamped.map((message, i) => ({
		type: "message",
		id: `e${i}`,
		parentId: i === 0 ? null : `e${i - 1}`,
		message,
	}));
}

function roleOf(entry: unknown): unknown {
	return (entry as { message?: { role?: unknown } })?.message?.role;
}

export function fakePiHost(): FakePiHost {
	const logs = new Map<string, Array<{ type: "message"; id: string; parentId: string | null; message: unknown }>>();
	const lastTurn = new Map<string, string>();
	const sealed = new WeakSet<object>();
	/** A completed turn's final message, not yet in the log. */
	const completed = new Map<string, { responseId?: unknown }>();
	const pinned = new Set<string>();
	let current: AcpSessionReader | undefined;

	function append(sessionId: string, message: unknown): void {
		const log = logs.get(sessionId) ?? [];
		logs.set(sessionId, log);
		log.push({
			type: "message",
			id: `e${log.length}`,
			parentId: log.length === 0 ? null : log[log.length - 1].id,
			message,
		});
	}

	function record(sessionId: string, message: unknown): void {
		if (typeof message !== "object" || message === null || sealed.has(message)) return;
		sealed.add(message);
		const stopReason = (message as { stopReason?: unknown }).stopReason;
		if (stopReason === "error" || stopReason === "aborted") append(sessionId, message);
		else completed.set(sessionId, message);
		const responseId = (message as { responseId?: unknown }).responseId;
		if (typeof responseId === "string") lastTurn.set(sessionId, responseId);
	}

	return {
		sessionReader: () => current,
		setBranch: (sessionId, branch) => {
			logs.set(sessionId, [...(branch as never[])]);
			completed.delete(sessionId);
			// The next call reads exactly this branch: nothing of its context is appended to it.
			pinned.add(sessionId);
		},
		lastTurnId: (sessionId) => lastTurn.get(sessionId),
		wrap<T extends { streamAcpTurn: (...args: never[]) => unknown }>(backend: T): T {
			const inner = backend.streamAcpTurn as unknown as Turn;
			const streamAcpTurn: Turn = (model, context, options, deps) => {
				const sessionId = (options as { sessionId?: string } | undefined)?.sessionId;
				if (sessionId === undefined) {
					current = undefined;
				} else {
					const messages = (context as { messages?: unknown[] }).messages ?? [];
					const log = logs.get(sessionId);
					if (pinned.delete(sessionId)) {
						// As set.
					} else if (!log) {
						logs.set(sessionId, entriesOf(messages) as never[]);
					} else {
						const role = (m: unknown) => (m as { role?: unknown })?.role;
						const logged = log.filter((entry) => roleOf(entry) === "user").length;
						let seen = 0;
						const firstNew = messages.findIndex((m) => role(m) === "user" && ++seen > logged);
						const answer = completed.get(sessionId);
						if (answer) {
							completed.delete(sessionId);
							const before = messages[(firstNew === -1 ? messages.length : firstNew) - 1];
							append(
								sessionId,
								role(before) === "assistant"
									? { ...(before as object), provider: "entwurf", responseId: answer.responseId }
									: answer,
							);
						}
						if (firstNew !== -1) {
							for (const message of messages.slice(firstNew)) if (role(message) === "user") append(sessionId, message);
						}
					}
					// Pi hands out its own array: a turn reads the branch as it stood when it asked.
					const branch = [...(logs.get(sessionId) ?? [])];
					// Pi hands the provider the messages it stored. Where this context has an assistant in the
					// place of a logged Entwurf answer, the turn is given the logged one: the context's own
					// content with the stored turn id, or the failed answer as it was sealed.
					const answerAfter = new Map<number, unknown>();
					let users = 0;
					for (const entry of branch) {
						if (roleOf(entry) === "user") users++;
						const logged = entry.message as { provider?: unknown } | undefined;
						if (roleOf(entry) === "assistant" && logged?.provider === "entwurf") answerAfter.set(users, logged);
					}
					// A projected omission is already built from real Pi entries; raw user ordinals
					// are no longer the ordinals of projected answers after a compaction.
					if (answerAfter.size > 0 && !branch.some((entry) => (entry.type as string) === "context_edit")) {
						let seenUsers = 0;
						let swapped = false;
						const faithful = messages.map((m) => {
							const role = (m as { role?: unknown })?.role;
							if (role === "user") seenUsers++;
							if (role !== "assistant" || !answerAfter.has(seenUsers)) return m;
							swapped = true;
							return answerAfter.get(seenUsers);
						});
						if (swapped) context = { ...(context as object), messages: faithful };
					}
					current = {
						getSessionId: () => sessionId,
						getBranch: () => branch,
						getEntries: () => branch,
						buildSessionProjection: () => buildSessionProjection(branch as SessionEntry[]),
					};
				}
				// The backend reads the reader synchronously at the top of the call.
				const stream = inner(model, context, options, deps) as {
					push(event: { type: string; message?: unknown; error?: unknown }): void;
					result(): Promise<unknown>;
				};
				if (sessionId !== undefined) {
					const push = stream.push.bind(stream);
					stream.push = (event) => {
						if (event.type === "done") record(sessionId, event.message);
						if (event.type === "error") record(sessionId, event.error);
						push(event);
					};
					// A turn that ended before this wrapper could see its push.
					void stream.result().then(
						(message) => record(sessionId, message),
						() => undefined,
					);
				}
				return stream;
			};
			return { ...backend, streamAcpTurn } as T;
		},
	};
}
