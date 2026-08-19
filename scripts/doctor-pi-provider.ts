#!/usr/bin/env node
// doctor-pi-provider — fail-loud doctor for the pi provider (entwurfProvider.mcpServers.
// entwurf-bridge) ownership (#46 Task 2). A BOUNDED BOOT PROBE, not a static inspector: it writes
// no operator state, but it does exec the configured command on this host (#81). Uses the config.ts SSOT
// `readProviderSettingsFile` so the effective (shadow-resolved) view matches what pi actually
// loads — NOT a re-implemented merge (GPT D: a python re-impl drifts into "doctor green, runtime
// red"). Reports user / project / EFFECTIVE command (project shadows user per-name, the
// resolveProviderConfig rule), plus install-state ownership, and gates on the stable bin actually
// BOOTING (#81) — not merely resolving. `command -v` answering yes is not evidence that pi gets a
// bridge: on the reference host the bare name resolved through a relocated pnpm shim whose $0-derived
// target did not exist, so the launcher exited 127, the ACP turn had no mcp__entwurf-bridge__* tool,
// and THIS doctor still printed ok. Resolvability is kept as the first, cheaper cell so the two
// failures stay distinguishable (nothing on PATH vs. on PATH but dead).
//
// The probe sends `initialize` + `tools/list` only — never a `tools/call` — so it takes no lock,
// writes no record and delivers nothing. That bounds OUR bridge tightly (start.sh is an `exec node`,
// so there is no grandchild). It does not make the doctor side-effect free in general: whatever the
// operator configured is what gets executed, and a foreign launcher's own startup is its own
// business. Running this doctor is therefore a decision to run that command. See
// probe-bridge-command.ts, which owns the bounded reap of the child it spawns.
//
// Env overrides (for the hermetic smoke):
//   PI_PROVIDER_GLOBAL_SETTINGS   default: $PI_CODING_AGENT_DIR/settings.json or ~/.pi/agent/settings.json
//   PI_PROVIDER_PROJECT_SETTINGS  default: <cwd>/.pi/settings.json
//   PI_PROVIDER_STATE             default: $XDG_DATA_HOME/entwurf/pi-provider/install-state.json
//
// Exit: 0 ok (incl. honest "never installed / unowned" notes) · 1 hard fail (malformed settings /
// state-owned-but-drifted / stable bin dangling / stable bin present but does NOT boot).
import { execFileSync } from "node:child_process";
import { accessSync, existsSync, constants as FS, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeMcpServers, readProviderSettingsFile } from "../pi-extensions/lib/acp/config.ts";
import { probeBridgeCommand } from "./probe-bridge-command.ts";

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

/** The configured stdio invocation for our key, as PRODUCTION would build it. */
interface BridgeEntry {
	command: string;
	args: string[];
	env: Record<string, string>;
}

// Build the effective entry EXACTLY the way production does (config.ts `resolveProviderConfig`):
// a shallow PER-NAME merge of the two `mcpServers` maps, then ONE `normalizeMcpServers` over the
// merged map. Hand-parsing command/args (this doctor's first shape) dropped a malformed arg
// silently and probed an invocation production never runs.
//
// The ORDER is load-bearing too. Normalizing each file separately validates entries production
// never sees: a malformed server in the global map that the project map shadows is gone by the time
// pi normalizes, yet a per-file doctor throws on it and calls a session red that in fact starts
// fine. That is the same "the doctor's subject differs from the runtime's" defect as the silent
// arg-drop, pointed the other way — and it is not confined to our key, since any unrelated global
// server could trip it.
//
// THROWS (McpServerConfigError) when the MERGED map is malformed — the fail-loud path, caught by
// the caller. That error names the offending SERVER and reason, not a file: after the merge an
// entry no longer belongs to one scope, so claiming a filename here would be a guess. A non-stdio
// (http/sse) entry is returned as `null` so the caller can say WHY it cannot be probed instead of
// pretending it is absent.
function mergedBridgeEntry(
	globalSettings: { mcpServers?: Record<string, unknown> },
	projectSettings: { mcpServers?: Record<string, unknown> },
): BridgeEntry | null | undefined {
	const mergedRaw = { ...(globalSettings.mcpServers ?? {}), ...(projectSettings.mcpServers ?? {}) };
	const { servers } = normalizeMcpServers(mergedRaw);
	const entry = servers.find((srv) => srv.name === KEY);
	if (entry === undefined) return undefined; // not configured in either scope
	if ("url" in entry) return null; // http/sse — a real config, but nothing to spawn
	return {
		command: entry.command,
		args: entry.args,
		// The ACP wire shape is a name/value list; collapse it to the env map a spawn wants.
		env: Object.fromEntries(entry.env.map((kv) => [kv.name, kv.value])),
	};
}

// Per-scope DISPLAY only — never validation. The scope lines exist so an operator can see which
// file supplied the effective entry; judging shape here would re-introduce the per-file validation
// the merge rule above exists to avoid.
function describeScope(settings: { mcpServers?: Record<string, unknown> }): string {
	const raw = settings.mcpServers?.[KEY];
	if (raw === undefined) return "entwurf-bridge NOT configured";
	const cmd = (raw as { command?: unknown } | null)?.command;
	return typeof cmd === "string" ? `'${cmd}'` : "configured (shape judged in the merged view)";
}

// Does the command resolve in the environment (best local proxy for "where pi/agy runs")?
// A bare name is looked up on PATH; a path must be an executable file.
function resolvable(cmd: string): boolean {
	if (cmd.includes("/")) {
		try {
			accessSync(cmd, FS.X_OK);
			return true;
		} catch {
			return false;
		}
	}
	try {
		// `command -v` is a POSIX sh builtin. Pass the configured name as argv, never shell text:
		// an unowned override is still operator data and must not become a doctor injection surface.
		execFileSync("sh", ["-c", 'command -v -- "$1" >/dev/null 2>&1', "sh", cmd], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

log("[pi-provider doctor]");

// Read via the SSOT — a malformed settings file THROWS here (fail-loud, named file).
let effectiveEntry: BridgeEntry | null | undefined;
let userScopeDesc = "";
let projScopeDesc = "";
let effectiveScope = "none";
try {
	const userSettings = readProviderSettingsFile(globalPath).settings;
	const projSettings = readProviderSettingsFile(projectPath).settings;
	userScopeDesc = describeScope(userSettings);
	projScopeDesc = describeScope(projSettings);
	// EFFECTIVE = project shadows user per-NAME. The whole ENTRY shadows, not a field of it, so
	// command, args and env always come from one scope; the scope label is decided by which map
	// owns the key, which is exactly what the merge spread resolves.
	effectiveEntry = mergedBridgeEntry(userSettings, projSettings);
	const ownsKey = (m: Record<string, unknown> | undefined): boolean => m !== undefined && Object.hasOwn(m, KEY);
	effectiveScope = ownsKey(projSettings.mcpServers)
		? "project"
		: ownsKey(userSettings.mcpServers)
			? "user(global)"
			: "none";
} catch (err) {
	log(`  FAIL: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
}

const effectiveDesc =
	effectiveEntry === undefined
		? "entwurf-bridge NOT configured"
		: effectiveEntry === null
			? "configured as an http/sse server"
			: `'${effectiveEntry.command}'`;

log("── scopes (project shadows user per-name)");
log(`  user(global) ${globalPath}: ${userScopeDesc}`);
log(`  project      ${projectPath}: ${projScopeDesc}`);
log(`  EFFECTIVE (${effectiveScope}): ${effectiveDesc}`);

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
if (effectiveEntry === undefined) {
	log(
		"  note: no entwurfProvider.mcpServers.entwurf-bridge in any scope (never installed — this is the '?'; run ./run.sh setup).",
	);
} else if (effectiveEntry === null) {
	// A real, well-formed config that this bridge cannot be: entwurf-bridge is a stdio server, so
	// an http/sse entry under our key means pi would connect to something that is not us. Nothing
	// here is spawnable, so there is no boot to prove — say that plainly rather than reporting the
	// absence of a failure as ok.
	log(
		`  FAIL: entwurf-bridge is configured as an http/sse server in ${effectiveScope} scope. This bridge is a stdio server — pi would reach something that is not entwurf, and no boot evidence is possible. Restore a stdio entry with ./run.sh setup, or remove the key if the override is deliberate.`,
	);
	hardFail = 1;
} else {
	const cmd = effectiveEntry.command;
	const isBare = cmd === BARE;
	const isLegacyManaged = cmd.endsWith("/entwurf/mcp/entwurf-bridge/start.sh");

	// Runtime truth is independent of ownership truth. An unowned override remains the operator's
	// choice, but it still shadows the stable bridge in production; calling a dead override green
	// repeats #81 under a different spelling. Probe the exact normalized command + args + env for
	// EVERY effective stdio entry, then classify who owns that entry separately below.
	if (!resolvable(cmd)) {
		log(`  FAIL: effective command '${cmd}' does NOT resolve or is not executable.`);
		hardFail = 1;
	} else {
		log(`  effective command '${cmd}' RESOLVES — probing the exact configured invocation…`);
		const probe = await probeBridgeCommand({
			command: cmd,
			args: effectiveEntry.args,
			env: { ...process.env, ...effectiveEntry.env },
		});
		if (probe.ok) {
			log(
				isBare
					? `  ok: effective command is the bare stable bin '${BARE}' and it BOOTS — ${probe.detail}`
					: `  runtime: configured override BOOTS — ${probe.detail}`,
			);
		} else {
			log(`  FAIL: effective invocation does NOT serve MCP [${probe.reason}] — ${probe.detail}`);
			log(`         Diagnose its launcher and configured args/env; entwurf will not overwrite an unowned command.`);
			hardFail = 1;
		}
	}

	if (!isBare) {
		// Ownership classification never rounds a broken runtime up to green. It only says who may
		// repair the non-canonical entry after the independent boot verdict above.
		if (ownership && ownership !== "user-override") {
			log(`  FAIL: state owns entwurf-bridge (ownership=${ownership}) but the effective command drifted to '${cmd}'.`);
			hardFail = 1;
		} else if (isLegacyManaged) {
			log(
				`  note: effective is our LEGACY managed repo path ('${cmd}'), not yet adopted to the bare stable bin. Run ./run.sh setup to normalize.`,
			);
		} else {
			log(
				`  note: entwurf-bridge is an UNOWNED override ('${cmd}'). Runtime was judged above; run ./run.sh setup only if you choose to adopt the bare stable bin.`,
			);
		}
	}
}

if (hardFail) {
	log("pi-provider doctor: FAIL.");
	process.exit(1);
}
log("pi-provider doctor: ok.");
