/**
 * What the first-user augment tells an Antigravity ACP child about itself (#167). The Claude and
 * carrier-less renderings are pinned by `check-acp-carrier-augment`; this file pins only that an
 * agy child is told its own wire — the append seat and the MCP spelling agy mints — and that no
 * other backend's text moved to say so. Literals, never the module's constants.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildPiContextAugment } from "./augment.ts";

const empty = mkdtempSync(join(tmpdir(), "agy-augment-"));
afterAll(() => rmSync(empty, { recursive: true, force: true }));
const augment = (backend: string) => buildPiContextAugment({ backend, cwd: empty, mcpServerNames: [], homeDir: empty });

describe("first-user augment — an agy child is told its own carrier and tool spelling", () => {
	it("[QK:ACP-AGY-AUGMENT-PROVENANCE] the agy augment names the append seat, not a replaced system prompt", () => {
		const agy = augment("agy");
		expect(agy).toContain("`_meta.antigravity.systemPrompt.append`");
		expect(agy).toContain("system prompt = the backend's own, plus the short engraving");
		expect(agy).not.toContain("(`_meta.systemPrompt`)");
		expect(agy).not.toContain("system prompt = the short engraving;");
		// Claude keeps the sentence that is true of its wire.
		const claude = augment("claude");
		expect(claude).toContain("(`_meta.systemPrompt`)");
		expect(claude).toContain("system prompt = the short engraving;");
		// Lowercase on purpose: it is the carrier key (`_meta.antigravity…`), the one string the
		// provenance branch owns. The capitalised tool-surface line belongs to the other QK.
		expect(claude).not.toContain("antigravity");
	});

	it("[QK:ACP-AGY-AUGMENT-TOOL-SPELLING] only the agy augment states agy's MCP tool spelling", () => {
		expect(augment("agy")).toContain("mcp_<server>_<tool>, for example mcp_entwurf-bridge_entwurf_v2");
		for (const backend of ["claude", "cortex"]) expect(augment(backend), backend).not.toContain("mcp_entwurf-bridge_");
	});

	it("[QK:ACP-AGY-AUGMENT-CWD-AGENTS-DROPPED] an agy child is not handed the cwd AGENTS.md agy already loads", () => {
		const home = join(empty, "home");
		const cwd = join(home, "project");
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(home, "AGENTS.md"), "home rule HOME-RULE-41\n");
		writeFileSync(join(cwd, "AGENTS.md"), "project rule CWD-RULE-52\n");
		const render = (backend: string) => buildPiContextAugment({ backend, cwd, mcpServerNames: [], homeDir: home });
		const agy = render("agy");
		expect(agy).toContain("HOME-RULE-41");
		expect(agy).not.toContain("CWD-RULE-52");
		expect(agy).not.toContain(`## ${join(cwd, "AGENTS.md")}`);
		// Every other backend keeps both: nothing else loads the file for them.
		for (const backend of ["claude", "cortex"]) {
			expect(render(backend), backend).toContain("HOME-RULE-41");
			expect(render(backend), backend).toContain("CWD-RULE-52");
		}
	});
});
