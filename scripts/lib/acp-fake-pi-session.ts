// A stand-in for the Pi session a resident ACP turn reads (#171 step 8), for gates and tests that
// drive `streamAcpTurn` directly.
//
// Pi appends each turn's inputs before it calls the provider and stores the provider's final
// assistant message whole, turn id (`responseId`) included. This fake does the same from what a
// gate already has: the context it passes and the stream it gets back. The branch of a call is its
// context's messages as entries; the last assistant among them is given the provider and
// `responseId` of the previous turn's final message for that session id, which is what Pi's file
// would hold there. A context with no assistant at all, after a turn for that session id, is read
// as Pi would hold it: the previous answer sits before its last message. A gate that needs another
// shape sets the branch itself (`setBranch`).

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

export function entriesOf(messages: readonly unknown[], lastAnswer?: { responseId: string }): unknown[] {
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
			content: [],
			provider: "entwurf",
			responseId: lastAnswer.responseId,
		});
	}
	return stamped.map((message, i) => ({
		type: "message",
		id: `e${i}`,
		parentId: i === 0 ? null : `e${i - 1}`,
		message,
	}));
}

export function fakePiHost(): FakePiHost {
	const lastTurn = new Map<string, string>();
	const fixed = new Map<string, unknown[]>();
	let current: AcpSessionReader | undefined;

	function record(sessionId: string, message: unknown): void {
		const id = (message as { responseId?: unknown } | undefined)?.responseId;
		if (typeof id === "string") lastTurn.set(sessionId, id);
	}

	return {
		sessionReader: () => current,
		setBranch: (sessionId, branch) => void fixed.set(sessionId, branch),
		lastTurnId: (sessionId) => lastTurn.get(sessionId),
		wrap<T extends { streamAcpTurn: (...args: never[]) => unknown }>(backend: T): T {
			const inner = backend.streamAcpTurn as unknown as Turn;
			const streamAcpTurn: Turn = (model, context, options, deps) => {
				const sessionId = (options as { sessionId?: string } | undefined)?.sessionId;
				if (sessionId === undefined) {
					current = undefined;
				} else {
					const messages = (context as { messages?: unknown[] }).messages ?? [];
					const answered = lastTurn.get(sessionId);
					const branch = fixed.get(sessionId) ?? entriesOf(messages, answered ? { responseId: answered } : undefined);
					fixed.delete(sessionId);
					current = { getSessionId: () => sessionId, getBranch: () => branch, getEntries: () => branch };
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
