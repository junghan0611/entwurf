// The R1 cell's go/no-go predicates for check-pi-durable-send (#129 L-send), as pure functions so
// the exact conditions the gate stops on can be checked on their own. Each returns the reasons it
// refuses; an empty list is the only pass.

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

export interface Verdict {
	ok: boolean;
	reasons: string[];
}
const verdict = (reasons: string[]): Verdict => ({ ok: reasons.length === 0, reasons });

/** The reported frame: a root `pi.tool` task running in `execute`, and the same-task slot for the call. */
export function intentFrameVerdict(frame: unknown, callId: string): Verdict {
	const f = frame as {
		node?: { id?: unknown; kind?: unknown; conversationId?: unknown; state?: { status?: unknown; phase?: unknown } };
		slot?: { taskId?: unknown; name?: unknown; callId?: unknown; status?: unknown };
	} | null;
	const reasons: string[] = [];
	if (f?.node?.kind !== "pi.tool") reasons.push("node is not pi.tool");
	if (f?.node?.conversationId !== 1) reasons.push("node is not on the root conversation");
	if (f?.node?.state?.status !== "running") reasons.push("node is not running");
	if (f?.node?.state?.phase !== "execute") reasons.push("node phase is not execute");
	if (f?.slot?.taskId === undefined || f.slot.taskId !== f.node?.id) reasons.push("slot taskId is not the node's");
	if (f?.slot?.name !== "entwurf_v2") reasons.push("slot is not entwurf_v2");
	if (f?.slot?.callId !== callId) reasons.push(`slot is not ${callId}`);
	if (f?.slot?.status !== "running") reasons.push("slot is not running");
	return verdict(reasons);
}

export interface PreCopyFacts {
	/** host1's actual exit signal. */
	hostExitSignal: string | null | undefined;
	/** bridge1's /proc state when its counters were last read. */
	bridgeStateAtRead: string | null;
	bridgeGone: boolean;
	readDelta: { rchar: number; syscr: number };
	/** Wall-clock ms when `go` was written and when host1 was signalled. */
	goAt: number;
	killAt: number;
	deadlineMs: number;
}

/** Everything that must hold before the database set is copied and the session reopened. */
export function preCopyVerdict(f: PreCopyFacts): Verdict {
	const reasons: string[] = [];
	if (f.hostExitSignal !== "SIGKILL") reasons.push(`host1 exit signal is ${String(f.hostExitSignal)}, not SIGKILL`);
	if (f.bridgeStateAtRead !== "T") reasons.push(`bridge1 state at read is ${String(f.bridgeStateAtRead)}, not T`);
	if (!f.bridgeGone) reasons.push("bridge1 is not gone");
	if (f.readDelta.rchar !== 0 || f.readDelta.syscr !== 0) {
		reasons.push(`bridge1 counted reads (rchar +${f.readDelta.rchar}, syscr +${f.readDelta.syscr})`);
	}
	const elapsed = f.killAt - f.goAt;
	if (!(elapsed >= 0 && elapsed <= f.deadlineMs)) {
		reasons.push(`go→kill took ${elapsed}ms, outside the ${f.deadlineMs}ms validity cutoff`);
	}
	return verdict(reasons);
}

export interface CheckpointFacts {
	row: { id?: unknown; conversation_id?: unknown; status?: unknown } | null;
	record: {
		id?: unknown;
		kind?: unknown;
		conversationId?: unknown;
		input?: { callId?: unknown };
		state?: { status?: unknown; checkpoint?: { phase?: unknown; replay?: unknown; arguments?: unknown } };
	} | null;
	resultEntriesForCall: number;
}

/** The copied database holds THIS call's committed, unsafe intent and no result for it. */
export function checkpointVerdict(
	f: CheckpointFacts,
	expect: { nodeId: number; callId: string; args: unknown },
): Verdict {
	const reasons: string[] = [];
	if (f.row === null || f.record === null) return verdict(["no task row for the observed task id"]);
	if (f.row.id !== expect.nodeId) reasons.push("queried row id is not the observed task id");
	if (f.record.id !== expect.nodeId) reasons.push("record id is not the observed task id");
	if (f.record.kind !== "pi.tool") reasons.push("record is not pi.tool");
	if (f.record.conversationId !== 1) reasons.push("record is not on the root conversation");
	if (f.record.input?.callId !== expect.callId) reasons.push(`record input callId is not ${expect.callId}`);
	if (f.record.state?.status !== "running") reasons.push("record is not running");
	if (f.record.state?.checkpoint?.phase !== "execute") reasons.push("checkpoint phase is not execute");
	if (f.record.state?.checkpoint?.replay !== "unsafe") reasons.push("checkpoint replay is not unsafe");
	if (canonicalJson(f.record.state?.checkpoint?.arguments) !== canonicalJson(expect.args)) {
		reasons.push("checkpoint arguments are not the scripted arguments");
	}
	if (f.resultEntriesForCall !== 0)
		reasons.push(`${f.resultEntriesForCall} result entr(ies) already exist for the call`);
	return verdict(reasons);
}
