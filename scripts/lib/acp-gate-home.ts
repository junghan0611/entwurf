// In-process HOME sandbox for the ACP gates that drive the compiled `backend.streamAcpTurn`
// (Rule 12: offline verification never rewires the operator).
//
// The turn loop resolves the REAL routed adapter from the model id and calls its
// `ensureOverlay()`; there is no deps seam for it (`AcpTurnDeps`). Claude's overlay, the session
// cache and the operator settings path are `homedir()` constants evaluated when the compiled
// modules load. So the sandbox must exist BEFORE the first import of the emitted backend, and the
// gate proves it by reading the overlay constant from that same emitted module graph. Same env
// set as `pi-extensions/lib/acp/backend.vendor-rejection.test.ts`.

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SANDBOXED_ENV = [
	"HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"XDG_CACHE_HOME",
	"PI_CODING_AGENT_DIR",
	"PI_SESSION_ID",
	"PI_AGENT_ID",
	"CLAUDE_AGENT_ACP_COMMAND",
	"PI_EMACS_AGENT_SOCKET",
] as const;

export interface AcpGateHome {
	readonly home: string;
	/** Restore every sandboxed variable and remove the sandbox root. */
	restore(): void;
}

/** Point HOME, XDG and the pi agent dir into a fresh temp root. Call before importing backend. */
export function sandboxAcpGateHome(prefix: string): AcpGateHome {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const saved = new Map<string, string | undefined>(SANDBOXED_ENV.map((key) => [key, process.env[key]]));
	const home = join(root, "home");
	mkdirSync(home, { recursive: true });
	process.env.HOME = home;
	process.env.XDG_CONFIG_HOME = join(root, "xdg-config");
	process.env.XDG_DATA_HOME = join(root, "xdg-data");
	process.env.XDG_STATE_HOME = join(root, "xdg-state");
	process.env.XDG_CACHE_HOME = join(root, "xdg-cache");
	process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
	delete process.env.PI_SESSION_ID;
	delete process.env.PI_AGENT_ID;
	delete process.env.CLAUDE_AGENT_ACP_COMMAND;
	delete process.env.PI_EMACS_AGENT_SOCKET;
	return {
		home,
		restore() {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(root, { recursive: true, force: true });
		},
	};
}

/** Refuse to drive a turn unless the emitted overlay constant resolves inside the sandbox HOME. */
export async function assertOverlayInSandbox(emitDir: string, sandbox: AcpGateHome): Promise<void> {
	const overlayMod = (await import(pathToFileURL(resolve(emitDir, "pi-extensions/lib/acp/overlay.js")).href)) as {
		CLAUDE_CONFIG_OVERLAY_DIR: string;
	};
	assert.equal(
		overlayMod.CLAUDE_CONFIG_OVERLAY_DIR,
		join(sandbox.home, ".pi", "agent", "claude-config-overlay"),
		"the compiled backend resolved the Claude overlay outside the gate's sandbox HOME, so its real " +
			"ensureOverlay() would refresh the operator's overlay [QK:ACP-GATE-HOME-SANDBOXED]",
	);
}
