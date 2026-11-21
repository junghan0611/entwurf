/** One `export const <name> = Object.freeze({ … });` agent pin in the adapter source, read as text. */
function agentPins(adapterSource: string, name: string): Array<{ floor?: string; measured?: string }> {
	return [...adapterSource.matchAll(new RegExp(`export const ${name} = Object\\.freeze\\(\\{([^}]*)\\}\\);`, "g"))].map(
		(match) => ({
			floor: /\bfloor: "(\d+\.\d+\.\d+)"/.exec(match[1])?.[1],
			measured: /\bmeasured: "(\d+\.\d+\.\d+)"/.exec(match[1])?.[1],
		}),
	);
}

/** The Receipts heading's first paragraph is the binding, not later dated historical rows. */
export function checkReceiptVersions(
	document: string,
	packageJson: unknown,
	adapterSource: string,
): { claude: string[]; agy: string[]; claudeMeasured: string[]; agyMeasured: string[] } {
	const issues = {
		claude: [] as string[],
		agy: [] as string[],
		claudeMeasured: [] as string[],
		agyMeasured: [] as string[],
	};
	const sections = document.split(/^## Receipts\s*$/m);
	const paragraph = sections.length === 2 ? sections[1].trimStart().split(/\r?\n\s*\r?\n/)[0] : "";
	const claudeMatches = [...paragraph.matchAll(/\bclaude-agent-acp\s+(\d+\.\d+\.\d+)(?![\w.+-])/g)];
	const agyMatches = [...paragraph.matchAll(/\bagy\s+(\d+\.\d+\.\d+)(?![\w.+-])/g)];
	const claudePins = agentPins(adapterSource, "CLAUDE_ACP_AGENT");
	const agyPins = agentPins(adapterSource, "AGY_ACP_AGENT");
	const floors = agyPins.flatMap((pin) => (pin.floor ? [pin.floor] : []));
	const pkg = packageJson as { dependencies?: Record<string, unknown> } | null;
	const pin = pkg?.dependencies?.["@agentclientprotocol/claude-agent-acp"];
	if (
		claudeMatches.length !== 1 ||
		typeof pin !== "string" ||
		!/^\d+\.\d+\.\d+$/.test(pin) ||
		claudeMatches[0]?.[1] !== pin
	) {
		issues.claude.push(
			`Receipts header Claude version must uniquely match package.json exact pin (found ${claudeMatches.length})`,
		);
	}
	if (agyMatches.length !== 1 || agyPins.length !== 1 || floors.length !== 1) {
		issues.agy.push(
			`Receipts header agy version and AGY_ACP_AGENT floor must each be unique (found ${agyMatches.length}/${floors.length})`,
		);
	} else {
		const have = agyMatches[0][1].split(".").map(Number);
		const floor = floors[0].split(".").map(Number);
		const first = have.findIndex((value, i) => value !== floor[i]);
		if (first !== -1 && have[first] < floor[first])
			issues.agy.push(`Receipts header agy ${agyMatches[0][1]} is below floor ${floors[0]}`);
	}
	// #171 V5, decision 10: the version an attach may run on is the version the receipts measured.
	const measured = (vendor: string, header: RegExpMatchArray[], pins: Array<{ measured?: string }>) => {
		const constant = `${vendor === "Claude" ? "CLAUDE" : "AGY"}_ACP_AGENT.measured`;
		if (header.length !== 1 || pins.length !== 1 || !pins[0].measured)
			return [`Receipts header ${vendor} version and ${constant} must each be unique`];
		return header[0][1] === pins[0].measured
			? []
			: [`Receipts header ${vendor} ${header[0][1]} is not ${constant} ${pins[0].measured}`];
	};
	issues.claudeMeasured.push(...measured("Claude", claudeMatches, claudePins));
	issues.agyMeasured.push(...measured("agy", agyMatches, agyPins));
	return issues;
}
