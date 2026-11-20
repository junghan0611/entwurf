/**
 * Lexical inventory, not a semantic proof: unscoped package specs and current claims fail; named
 * history files and explicit Herdr history paragraphs are B, while Herdr current pins bind to the lock.
 */
export type Mention = { line: number; kind: "A" | "B" | "C" | "L"; text: string };

const HISTORY_FILES = new Set(["NEXT.md", "ROADMAP.md", "CHANGELOG.md", "BASELINE.md", "docs/baseline-receipts.md"]);
const VERSION =
	/@junghanacs\/entwurf@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|\bcurrent\s+v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|현재\s+v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/gi;

export type HerdrLock = { source: "npm"; version: string } | { source: "herdr-checkout" };

export function checkHerdrPin(raw: unknown, readme: string): { lock: HerdrLock; mismatch: boolean; pinCount: number } {
	if (typeof raw !== "object" || raw === null || !("source" in raw))
		throw new Error("Herdr runtime lock has no source");
	if (raw.source === "herdr-checkout") return { lock: { source: "herdr-checkout" }, mismatch: false, pinCount: 0 };
	if (
		raw.source !== "npm" ||
		!("version" in raw) ||
		typeof raw.version !== "string" ||
		!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(raw.version)
	)
		throw new Error("Herdr runtime lock has an invalid source or npm version");
	const pins = [
		...readme.matchAll(
			/The npm pin is `@junghanacs\/entwurf@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)`/g,
		),
	];
	return {
		lock: { source: "npm", version: raw.version },
		mismatch: pins.length !== 1 || pins[0]?.[1] !== raw.version,
		pinCount: pins.length,
	};
}

export function versionMentions(file: string, text: string, herdrLock?: HerdrLock): Mention[] {
	const out: Mention[] = [];
	let published = false;
	const lines = text.split(/\r?\n/);
	let paragraph = "";
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) paragraph = "";
		const open = line.indexOf("<!-- entwurf:published ");
		const close = line.indexOf("<!-- /entwurf:published -->");
		for (const match of line.matchAll(VERSION)) {
			const position = match.index;
			const inRegion = (published || (open >= 0 && open <= position)) && (close < 0 || close > position);
			const historyPrefix = `${paragraph} ${line.slice(0, position)}`;
			// Only the Herdr guide's explicitly historical paragraphs get this lexical hint.
			const oldHerdr =
				file === "plugins/herdr/README.md" &&
				/\b(?:previous|older|earlier|historical|receipt|last Pi 1\.3 snapshot)\b/i.test(historyPrefix) &&
				!/\bnpm\s+(?:install|i)\b/i.test(line);
			const historical = HISTORY_FILES.has(file) || /^NEXT--[^/]+\.md$/.test(file) || inRegion || oldHerdr;
			const spec = /^@junghanacs\/entwurf@/i.test(match[0]);
			const current = /^(?:current|현재)\s/i.test(match[0]);
			// The checkout carrier has no npm version: retain the pin as report-only until re-pin.
			const lockPin = file === "plugins/herdr/README.md" && spec && herdrLock !== undefined;
			const lockMatches =
				lockPin && (herdrLock.source === "herdr-checkout" || match[0] === `@junghanacs/entwurf@${herdrLock.version}`);
			const upstream = /\b(?:pi|sdk|node|herdr|upstream)\s+$/i.test(line.slice(0, position));
			out.push({
				line: index + 1,
				kind: historical ? "B" : lockMatches ? "L" : spec || (current && !upstream) ? "A" : "C",
				text: match[0],
			});
		}
		paragraph += ` ${line}`;
		if (open >= 0) published = true;
		if (close >= 0) published = false;
	}
	return out;
}
