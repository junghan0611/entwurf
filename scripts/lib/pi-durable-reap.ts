// The cleanup verdict of check-pi-durable-send (#129 L-send), as a pure function so the exact
// predicate the gate uses can be checked on its own.
//
// Green only when every owned process is gone, no signal failed, the scripted endpoint closed, and
// every owned host's children were OBSERVED before it went away. A host that exited before /proc
// could be asked about its children leaves an unknown, and an unknown is not a clean reap.

export interface ReapFacts {
	/** Owned processes still alive with their recorded start key. */
	alive: readonly number[];
	/** Signal or exit failures met while reaping. */
	problems: readonly string[];
	endpointClosed: boolean;
	endpointListening: boolean;
	/** Hosts that exited before their children were observed. */
	observationNotes: readonly string[];
}

export function ownedReapVerdict(facts: ReapFacts): { green: boolean; reasons: string[] } {
	const reasons = [
		...(facts.alive.length > 0 ? [`still alive: ${facts.alive.join(",")}`] : []),
		...facts.problems,
		...(facts.endpointClosed && !facts.endpointListening ? [] : ["the scripted endpoint did not close"]),
		...facts.observationNotes.map((note) => `unobserved: ${note}`),
	];
	return { green: reasons.length === 0, reasons };
}
