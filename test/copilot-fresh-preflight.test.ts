/**
 * copilot-fresh-preflight cells — the pre-mutation capability check for a Copilot fresh call
 * (#82 RAIL 9, `docs/adding-a-harness.md` step 9 clauses 3 and 4).
 *
 * Everything here EXECUTES the leaf against a filesystem fixture. Nothing spawns the vendor,
 * nothing touches the operator's real `~/.copilot` or `~/.local/share/entwurf`: HOME,
 * XDG_DATA_HOME and PATH are all redirected, which is also the only way to assert a REFUSAL
 * without uninstalling something on the developer's host.
 *
 * The fixture is built COMPLETE and then broken one axis at a time. Building it broken and
 * repairing towards green is the shape that lets a second missing axis hide behind the first.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	COPILOT_PREFLIGHT_HINT,
	type CopilotPreflightRejectReason,
	copilotFreshPreflight,
} from "../pi-extensions/lib/copilot-fresh-preflight.ts";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_SRC = fs.readFileSync(path.join(REPO_DIR, "pi-extensions/lib/copilot-fresh-preflight.ts"), "utf8");

interface Fixture {
	env: NodeJS.ProcessEnv;
	home: string;
	xdg: string;
	/** `~/.copilot/settings.json` — the file the vendor reads for its footer. */
	settings: string;
	/** the MCP config the install-state claims to manage */
	mcpConfig: string;
	birthUnit: string;
	receiveUnit: string;
	statuslineState: string;
}

const writeJson = (file: string, value: unknown): void => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

/** A host where all four axes are in place. Returns after the fixture is complete, so any
 * refusal a cell observes is the one it broke on purpose. */
function withFixture<T>(run: (fx: Fixture) => T): T {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-copilot-preflight-"));
	try {
		const home = path.join(root, "home");
		const xdg = path.join(root, "xdg");
		const bin = path.join(root, "bin");
		fs.mkdirSync(bin, { recursive: true });

		const birthUnit = path.join(xdg, "entwurf", "meta-bridge-copilot", ".assembled", "entwurf-meta-receive-copilot");
		writeJson(path.join(birthUnit, "hooks", "hooks.json"), { hooks: {} });

		const mcpConfig = path.join(home, ".copilot", "mcp-config.json");
		writeJson(mcpConfig, { mcpServers: { "entwurf-bridge": { type: "local", command: "entwurf-bridge" } } });
		writeJson(path.join(xdg, "entwurf", "copilot-mcp", "install-state.json"), {
			schemaVersion: 1,
			managedConfigPath: mcpConfig,
			serverKey: "entwurf-bridge",
		});

		const receiveUnit = path.join(home, ".copilot", "extensions", "entwurf-receive");
		fs.mkdirSync(receiveUnit, { recursive: true });
		fs.writeFileSync(path.join(receiveUnit, "extension.mjs"), "// receiver\n");
		writeJson(path.join(xdg, "entwurf", "copilot-receive", "install-state.json"), {
			schemaVersion: 1,
			unit: "entwurf-receive",
			path: receiveUnit,
		});

		const settings = path.join(home, ".copilot", "settings.json");
		writeJson(settings, {
			statusLine: { command: "entwurf-copilot-statusline" },
			footer: { showCustom: true },
		});
		fs.writeFileSync(path.join(bin, "entwurf-copilot-statusline"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

		return run({
			env: { HOME: home, XDG_DATA_HOME: xdg, PATH: bin },
			home,
			xdg,
			settings,
			mcpConfig,
			birthUnit,
			receiveUnit,
			statuslineState: path.join(xdg, "entwurf", "copilot-statusline", "install-state.json"),
		});
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

describe("a complete host", () => {
	it("[QK:COPILOT-PREFLIGHT-COMPLETE-HOST-PASSES] all four capabilities present answers null — a preflight that could not say yes would be a permanent refusal wearing a check's clothes", () => {
		withFixture((fx) => {
			expect(copilotFreshPreflight(fx.env)).toBeNull();
		});
	});

	it("reads ONLY the redirected roots: the same fixture with the real process env left out still answers from HOME/XDG_DATA_HOME/PATH", () => {
		withFixture((fx) => {
			expect(Object.keys(fx.env).sort()).toEqual(["HOME", "PATH", "XDG_DATA_HOME"]);
			expect(copilotFreshPreflight(fx.env)).toBeNull();
		});
	});
});

describe("one refusal per capability, each naming its own repair", () => {
	it("[QK:COPILOT-PREFLIGHT-BIRTH-AXIS] a missing birth unit is refused: without it the session mints no record and the callback would carry no garden id", () => {
		withFixture((fx) => {
			fs.rmSync(path.join(fx.birthUnit, "hooks", "hooks.json"));
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-birth-unit-missing");
		});
	});

	it("[QK:COPILOT-PREFLIGHT-MCP-AXIS] a missing MCP hand is refused: without the bridge server the callback tool does not exist in that session", () => {
		withFixture((fx) => {
			fs.rmSync(path.join(fx.xdg, "entwurf", "copilot-mcp", "install-state.json"));
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-mcp-hand-missing");
		});
	});

	it("[QK:COPILOT-PREFLIGHT-MCP-CONFIG-DRIFT] a CURRENT install-state over a config that lost the server key is still refused — ownership truth and the file the CLI actually reads are two facts, and the first turn depends on the second", () => {
		withFixture((fx) => {
			writeJson(fx.mcpConfig, { mcpServers: { "somebody-else": {} } });
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-mcp-hand-missing");
		});
	});

	it("[QK:COPILOT-PREFLIGHT-RECEIVE-AXIS] a missing receiver unit is refused: the sibling could call home and then nothing could ever be delivered to it", () => {
		withFixture((fx) => {
			fs.rmSync(path.join(fx.receiveUnit, "extension.mjs"));
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-receive-unit-missing");
		});
	});

	it("[QK:COPILOT-PREFLIGHT-RECEIVE-PATH-MISMATCH] a real unit whose install-state path is not the DEST this env will scan is refused — the managed launcher compares claimed_path to COPILOT_EXTENSIONS_DIR/HOME/.copilot/extensions with string equality, and a preflight that skipped that check would PASS, open a window, then die inside it", () => {
		withFixture((fx) => {
			const elsewhere = path.join(fx.home, "other-extensions", "entwurf-receive");
			fs.mkdirSync(elsewhere, { recursive: true });
			fs.copyFileSync(path.join(fx.receiveUnit, "extension.mjs"), path.join(elsewhere, "extension.mjs"));
			writeJson(path.join(fx.xdg, "entwurf", "copilot-receive", "install-state.json"), {
				schemaVersion: 1,
				unit: "entwurf-receive",
				path: elsewhere,
			});
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-receive-unit-missing");
			// The same files pass when the launcher's own env seam names that root.
			expect(copilotFreshPreflight({ ...fx.env, COPILOT_EXTENSIONS_DIR: path.dirname(elsewhere) })).toBeNull();
		});
	});

	it("every reason carries a repair line naming the command that installs it", () => {
		const reasons: CopilotPreflightRejectReason[] = [
			"copilot-birth-unit-missing",
			"copilot-mcp-hand-missing",
			"copilot-receive-unit-missing",
			"copilot-visible-identity-missing",
		];
		for (const r of reasons) {
			expect(COPILOT_PREFLIGHT_HINT[r]).toMatch(/entwurf (install|doctor)-copilot-/);
		}
	});

	it("the axes answer in the order the fresh contract consumes them, so a host missing everything is told to be born first", () => {
		withFixture((fx) => {
			fs.rmSync(path.join(fx.birthUnit, "hooks", "hooks.json"));
			fs.rmSync(path.join(fx.xdg, "entwurf", "copilot-mcp", "install-state.json"));
			fs.rmSync(path.join(fx.receiveUnit, "extension.mjs"));
			fs.rmSync(fx.settings);
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-birth-unit-missing");
		});
	});
});

describe("visible identity — effective settings, not an ownership receipt (step 9 clause 4)", () => {
	it("[QK:COPILOT-PREFLIGHT-VISIBLE-IDENTITY-EFFECTIVE] a host whose footer is correctly configured PASSES with NO statusline install-state — measured on the acceptance host 2026-08-24, where doctor-copilot-statusline reported `settings: configured (resolvable)` / `state: absent` / rc=0. Gating on the receipt instead of the configuration would refuse a working visible identity", () => {
		withFixture((fx) => {
			expect(fs.existsSync(fx.statuslineState)).toBe(false);
			expect(copilotFreshPreflight(fx.env)).toBeNull();
		});
	});

	it("[QK:COPILOT-PREFLIGHT-VISIBLE-IDENTITY-REQUIRED] a host with no footer configuration is refused — a garden id readable only by scraping records is not the visible identity step 4 requires", () => {
		withFixture((fx) => {
			writeJson(fx.settings, { footer: { showCustom: true } });
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-visible-identity-missing");
		});
	});

	it("showCustom must be exactly true — a truthy string renders nothing, so it is not accepted as configured", () => {
		withFixture((fx) => {
			writeJson(fx.settings, { statusLine: { command: "entwurf-copilot-statusline" }, footer: { showCustom: "yes" } });
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-visible-identity-missing");
		});
	});

	it("a configured but UNRESOLVABLE command is refused — the settings would name a renderer the vendor cannot run", () => {
		withFixture((fx) => {
			fs.rmSync(path.join(fx.env.PATH as string, "entwurf-copilot-statusline"));
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-visible-identity-missing");
		});
	});

	it("[QK:COPILOT-PREFLIGHT-STATUSLINE-STATE-DRIFT] an install-state that manages a DIFFERENT settings file is refused, while one managing this very file passes — the receipt is checked for the one thing it can still contradict", () => {
		withFixture((fx) => {
			writeJson(fx.statuslineState, { schemaVersion: 1, managedSettingsPath: path.join(fx.home, "elsewhere.json") });
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-visible-identity-missing");
			writeJson(fx.statuslineState, { schemaVersion: 1, managedSettingsPath: fx.settings });
			expect(copilotFreshPreflight(fx.env)).toBeNull();
		});
	});

	it("a symlinked settings file is refused rather than certified — the shipped adapter calls that somebody else's SSOT and will not touch it either", () => {
		withFixture((fx) => {
			const real = path.join(fx.home, "foreign-settings.json");
			writeJson(real, { statusLine: { command: "entwurf-copilot-statusline" }, footer: { showCustom: true } });
			fs.rmSync(fx.settings);
			fs.symlinkSync(real, fx.settings);
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-visible-identity-missing");
		});
	});

	it("honors the same env seams as the shipped adapter, so preflight and doctor cannot disagree about which files they mean", () => {
		withFixture((fx) => {
			const moved = path.join(fx.home, "moved-settings.json");
			fs.renameSync(fx.settings, moved);
			// Without the seam the default path is gone → refused.
			expect(copilotFreshPreflight(fx.env)).toBe("copilot-visible-identity-missing");
			expect(copilotFreshPreflight({ ...fx.env, COPILOT_SETTINGS_CONFIG: moved })).toBeNull();
			// And the command name seam, exactly as COPILOT_STATUSLINE_COMMAND does for install.
			writeJson(moved, { statusLine: { command: "other-renderer" }, footer: { showCustom: true } });
			fs.writeFileSync(path.join(fx.env.PATH as string, "other-renderer"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			expect(
				copilotFreshPreflight({
					...fx.env,
					COPILOT_SETTINGS_CONFIG: moved,
					COPILOT_STATUSLINE_COMMAND: "other-renderer",
				}),
			).toBeNull();
		});
	});
});

describe("boundaries (structural contracts)", () => {
	it("[QK:COPILOT-PREFLIGHT-NO-VENDOR-SPAWN] the leaf spawns nothing and awaits nothing — it is a filesystem answer at one moment, not a doctor", () => {
		const code = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).not.toMatch(/child_process|spawn|exec\(|execSync|await\s|setTimeout|setInterval/);
	});

	it("stays a narrow Copilot leaf: it imports no mux module, no entwurf core, and no record store", () => {
		expect(MODULE_SRC).not.toMatch(/from "\.\/(mux-|entwurf-|meta-session)/);
		expect(MODULE_SRC).not.toMatch(/readAddressableMetaIdentity|entwurf-peers|process\.cwd/);
	});

	it("never mutates: no write, no mkdir, no unlink, no rename", () => {
		expect(MODULE_SRC).not.toMatch(/writeFileSync|mkdirSync|rmSync|unlinkSync|renameSync|appendFileSync/);
	});
});
