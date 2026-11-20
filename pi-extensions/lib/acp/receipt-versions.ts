/** The Receipts heading's first paragraph is the binding, not later dated historical rows. */
export function checkReceiptVersions(
	document: string,
	packageJson: unknown,
	adapterSource: string,
): { claude: string[]; agy: string[] } {
	const issues = { claude: [] as string[], agy: [] as string[] };
	const sections = document.split(/^## Receipts\s*$/m);
	const paragraph = sections.length === 2 ? sections[1].trimStart().split(/\r?\n\s*\r?\n/)[0] : "";
	const claudeMatches = [...paragraph.matchAll(/\bclaude-agent-acp\s+(\d+\.\d+\.\d+)(?![\w.+-])/g)];
	const agyMatches = [...paragraph.matchAll(/\bagy\s+(\d+\.\d+\.\d+)(?![\w.+-])/g)];
	const floors = [
		...adapterSource.matchAll(
			/export const AGY_ACP_AGENT = Object\.freeze\(\{ name: "Antigravity ACP Server", floor: "(\d+\.\d+\.\d+)" \}\);/g,
		),
	];
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
	if (agyMatches.length !== 1 || floors.length !== 1) {
		issues.agy.push(
			`Receipts header agy version and AGY_ACP_AGENT floor must each be unique (found ${agyMatches.length}/${floors.length})`,
		);
	} else {
		const have = agyMatches[0][1].split(".").map(Number);
		const floor = floors[0][1].split(".").map(Number);
		const first = have.findIndex((value, i) => value !== floor[i]);
		if (first !== -1 && have[first] < floor[first])
			issues.agy.push(`Receipts header agy ${agyMatches[0][1]} is below floor ${floors[0][1]}`);
	}
	return issues;
}
