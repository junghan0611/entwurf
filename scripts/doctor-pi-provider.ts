#!/usr/bin/env node
// doctor-pi-provider — fail-loud doctor for the pi provider (entwurfProvider.mcpServers.
// entwurf-bridge) ownership (#46 Task 2). Side-effect FREE (read-only). Uses the config.ts SSOT
// `readProviderSettingsFile` so the effective (shadow-resolved) view matches what pi actually
// loads — NOT a re-implemented merge (GPT D: a python re-impl drifts into "doctor green, runtime
// red"). Reports user / project / EFFECTIVE command (project shadows user per-name, the
// resolveProviderConfig rule), plus install-state ownership, and gates on stable-bin resolvability.
//
// Env overrides (for the hermetic smoke):
//   PI_PROVIDER_GLOBAL_SETTINGS   default: $PI_CODING_AGENT_DIR/settings.json or ~/.pi/agent/settings.json
//   PI_PROVIDER_PROJECT_SETTINGS  default: <cwd>/.pi/settings.json
//   PI_PROVIDER_STATE             default: $XDG_DATA_HOME/entwurf/pi-provider/install-state.json
//
// Exit: 0 ok (incl. honest "never installed / unowned" notes) · 1 hard fail (malformed settings /
// state-owned-but-drifted / stable bin dangling).
import { execSync } from "node:child_process";
import { existsSync, constants as FS, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readProviderSettingsFile } from "../pi-extensions/lib/acp/config.ts";

const BARE = "entwurf-bridge";
const KEY = "entwurf-bridge";

const home = homedir();
const agentDir = process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
const globalPath = process.env.PI_PROVIDER_GLOBAL_SETTINGS || join(agentDir, "settings.json");
const projectPath = process.env.PI_PROVIDER_PROJECT_SETTINGS || join(process.cwd(), ".pi", "settings.json");
const xdg = process.env.XDG_DATA_HOME || join(home, ".local", "share");
const statePath = process.env.PI_PROVIDER_STATE || join(xdg, "entwurf", "pi-provider", "install-state.json");

let hardFail = 0;
const log = (s: string) => process.stdout.write(s + "\n");

function commandOf(settings: { mcpServers?: Record<string, unknown> }): string | undefined {
	const entry = settings.mcpServers?.[KEY];
	if (entry && typeof entry === "object" && typeof (entry as { command?: unknown }).command === "string") {
		return (entry as { command: string }).command;
	}
	return undefined;
}

// Does the command resolve in the environment (best local proxy for "where pi/agy runs")?
// A bare name is looked up on PATH; a path must be an executable file.
function resolvable(cmd: string): boolean {
	if (cmd.includes("/")) {
		try {
			statSync(cmd);
			// eslint-disable-next-line no-bitwise
			return (statSync(cmd).mode & FS.S_IXUSR) !== 0;
		} catch {
			return false;
		}
	}
	try {
		// `command -v` is a POSIX sh builtin; use the default /bin/sh (NixOS has no /bin/bash).
		execSync(`command -v ${cmd}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

log("[pi-provider doctor]");

// Read via the SSOT — a malformed settings file THROWS here (fail-loud, named file).
let userCmd: string | undefined;
let projCmd: string | undefined;
try {
	userCmd = commandOf(readProviderSettingsFile(globalPath).settings);
	projCmd = commandOf(readProviderSettingsFile(projectPath).settings);
} catch (err) {
	log(`  FAIL: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
}

// EFFECTIVE = project shadows user per-name (the resolveProviderConfig merge rule).
const effectiveCmd = projCmd ?? userCmd;
const effectiveScope = projCmd !== undefined ? "project" : userCmd !== undefined ? "user(global)" : "none";

log("── scopes (project shadows user per-name)");
log(`  user(global) ${globalPath}: ${userCmd ? `'${userCmd}'` : "entwurf-bridge NOT configured"}`);
log(`  project      ${projectPath}: ${projCmd ? `'${projCmd}'` : "entwurf-bridge NOT configured"}`);
log(`  EFFECTIVE (${effectiveScope}): ${effectiveCmd ? `'${effectiveCmd}'` : "none"}`);

// install-state ownership (user scope). absent state on a configured effective is either a
// pre-Task-2 install or a user-override we deliberately did not own.
let ownership: string | undefined;
if (existsSync(statePath)) {
	try {
		const st = JSON.parse(readFileSync(statePath, "utf8")) as { ownership?: string };
		ownership = typeof st.ownership === "string" ? st.ownership : undefined;
		log(`  state: install-state present (ownership=${ownership}).`);
	} catch {
		log(`  state: FAIL — install-state ${statePath} is unreadable/corrupt.`);
		hardFail = 1;
	}
} else {
	log("  state: no user-scope install-state.");
}

log("── verdict");
if (effectiveCmd === undefined) {
	log(
		"  note: no entwurfProvider.mcpServers.entwurf-bridge in any scope (never installed — this is the '?'; run ./run.sh setup).",
	);
} else if (effectiveCmd === BARE) {
	if (resolvable(effectiveCmd)) {
		log(`  ok: effective command is the bare stable bin '${BARE}' and it RESOLVES.`);
	} else {
		log(`  FAIL: effective command is '${BARE}' but it does NOT resolve (run ./run.sh expose-dev-bin / npm bin-link).`);
		hardFail = 1;
	}
} else {
	// effective is NOT the bare bin. If state says we own it → drift (FAIL). Otherwise classify
	// the effective command honestly: our OWN legacy repo start.sh (not yet adopted) is NOT a
	// user override — say so distinctly so "run setup" is the clear next step. A truly foreign
	// command is an unowned override left as the operator's choice. Neither is a hard fail.
	const isLegacyManaged = effectiveCmd.endsWith("/entwurf/mcp/entwurf-bridge/start.sh");
	if (ownership && ownership !== "user-override") {
		log(
			`  FAIL: state owns entwurf-bridge (ownership=${ownership}) but the effective command drifted to '${effectiveCmd}'.`,
		);
		hardFail = 1;
	} else if (isLegacyManaged) {
		log(
			`  note: effective is our LEGACY managed repo path ('${effectiveCmd}'), not yet adopted to the bare stable bin. Run ./run.sh setup to normalize (this is the pre-Task-2 '?').`,
		);
	} else {
		log(
			`  note: entwurf-bridge is an UNOWNED override ('${effectiveCmd}') — effective is not the stable bin. Left as the operator's choice (run ./run.sh setup to adopt the bare bin).`,
		);
	}
}

if (hardFail) {
	log("pi-provider doctor: FAIL.");
	process.exit(1);
}
log("pi-provider doctor: ok.");
