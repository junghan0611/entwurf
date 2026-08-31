/**
 * omp-fresh-preflight — the pre-mutation capability check an OMP fresh call needs
 * (#87 Bundle C, `docs/adding-a-harness.md` step 9 clauses 3, 4 and 5).
 *
 * Same shape and the same reasons as `copilot-fresh-preflight.ts`: a doctor answers "is this
 * host correctly wired?" and may be slow, spawn the vendor and read live processes. This is not
 * that. It answers ONE narrower question at ONE moment — before `mux-fresh-call` mutates the
 * operator's tmux session, are the things the fresh contract requires actually in place on this
 * filesystem?
 *
 * ── Why OMP has FIVE axes where Copilot has four ──
 *
 *   birth            — without the birth extension the session mints no record, so the callback
 *                      carries no garden id and the sibling never becomes addressable.
 *   MCP hand         — without the native `entwurf-bridge` server the callback tool does not
 *                      exist in that session and the first turn has nothing to call.
 *   receive          — without the receiver extension the sibling can be launched and can call
 *                      home, and then nothing can ever be delivered TO it.
 *   visible identity — the garden id must be on the harness's own persistent surface.
 *   callback callable — THE OMP-SPECIFIC ONE. `tools.xdev` defaults to TRUE, which mounts MCP
 *                      tools as `xd://` devices whose schemas never reach the prompt. The tool
 *                      would be configured, the bridge would be running, and the model still
 *                      could not call `mcp__entwurf_bridge_entwurf_v`. Step 9 clause 5 makes the
 *                      callback the FIRST action, so a fresh call onto a default-config host
 *                      opens a window that can never name itself. `[측정]` #87 A-lane: the
 *                      vendor default wrapped the send tool and produced a false delivery report.
 *
 * Copilot's fourth axis is a statusline COMMAND that must resolve on PATH. OMP has no such
 * surface: `ctx.ui.setStatus` inside the birth extension is the only thing that renders
 * extension-owned text on a v18 TUI (`pi-extensions/meta-bridge-omp.ts:163-169`), and the
 * vendor gates it on `statusLine.showHookStatus` (default true). So visible identity here is
 * "the birth extension is installed AND the operator has not turned hook status off" — a
 * different predicate for the same clause, derived rather than copied.
 *
 * ── What this deliberately does NOT claim ──
 *
 * Ownership/configuration truth only. It does NOT prove omp loaded the extensions, connected
 * the MCP server, or rendered a garden id — that is runtime truth and belongs to
 * `doctor-omp-bridge` / `doctor-omp-receive` / `doctor-omp-mcp` and to the clause 7 LIVE
 * receipt. A green preflight is a statement about this filesystem, not a prediction about the
 * next process.
 *
 * No vendor spawn, no network, no await, no mutation.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

/** One reason per axis, plus the environment refusal. These strings are stable contract — they
 * cross the public surfaces as `entwurf_fresh_call` refusals, so a caller can act on them. */
export type OmpPreflightRejectReason =
	| "omp-agent-dir-ambiguous"
	| "omp-birth-unit-missing"
	| "omp-mcp-hand-missing"
	| "omp-receive-unit-missing"
	| "omp-visible-identity-missing"
	| "omp-callback-tool-uncallable";

const BIRTH_UNIT = "entwurf-meta-omp";
const RECEIVE_UNIT = "entwurf-receive-omp";
const MCP_SERVER_KEY = "entwurf-bridge";
/** Vendor load order, `utils/src/dirs.ts` MAIN_CONFIG_FILENAMES. */
const MAIN_CONFIG_FILENAMES = ["config.yml", "config.yaml"] as const;
/** `utils/src/dirs.ts` PROFILE_NAME_RE, reproduced from `scripts/omp-bridge-oracle.sh`. */
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The agent directory omp itself would read, or `null` for REFUSE.
 *
 * This is `omp_agent_dir` from `scripts/omp-bridge-oracle.sh`, expressed in the language this
 * half is written in. It is a reproduction on purpose and not a spawn of that script: the fresh
 * lane runs inside the pi extension and inside the bundled MCP child, and resolving a sibling
 * shell script by relative path from two different emit depths is the exact arithmetic
 * `check-capability-bundle-reach` exists to catch. The AGREEMENT of the two implementations is
 * pinned by `check-omp-fresh-preflight`, which drives both over the same environments.
 *
 * A `PI_*` knob is a refusal and never a lookup (#87 ledger M6): omp is a pi fork that kept pi's
 * env vocabulary, so `PI_CODING_AGENT_DIR` steers TWO harnesses and a value in the environment
 * does not say which one it is addressing. Guessing here would aim the preflight at a directory
 * no live omp reads, and it would report green off an empty one.
 */
export function ompAgentDir(env: NodeJS.ProcessEnv): string | null {
	const explicit = env.ENTWURF_OMP_AGENT_DIR;
	if (typeof explicit === "string" && explicit.length > 0) {
		const home = env.HOME;
		const expanded =
			explicit === "~" || explicit.startsWith("~/")
				? typeof home === "string" && home.length > 0
					? path.join(home, explicit.slice(1))
					: null
				: explicit;
		return expanded === null ? null : path.resolve(expanded);
	}
	if (typeof env.PI_CODING_AGENT_DIR === "string" && env.PI_CODING_AGENT_DIR.length > 0) return null;
	if (typeof env.PI_CONFIG_DIR === "string" && env.PI_CONFIG_DIR.length > 0) return null;
	const ompProfile = env.OMP_PROFILE;
	const hasOmpProfile = typeof ompProfile === "string" && ompProfile.length > 0;
	if (typeof env.PI_PROFILE === "string" && env.PI_PROFILE.length > 0 && !hasOmpProfile) return null;
	const home = env.HOME;
	if (typeof home !== "string" || home.length === 0) return null;
	if (hasOmpProfile) {
		if (!PROFILE_NAME_RE.test(ompProfile)) return null;
		return path.join(home, ".omp", "profiles", ompProfile, "agent");
	}
	return path.join(home, ".omp", "agent");
}

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		// Bounded environment probing, Hard Rule 15's stated exception.
		return false;
	}
}

/** A JSON object or nothing. Unreadable, unparseable and not-an-object are the SAME answer,
 * because the caller's next move is identical in all three: run the installer. */
function readJsonObject(file: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * The effective value of one TOP-LEVEL-then-one-key path in omp's config, as a tri-state:
 * `true` / `false` / `null` for "not stated, or not readable with confidence".
 *
 * A deliberately NARROW block-YAML reader — it understands exactly the shape these two settings
 * are written in (`tools:` newline, two-space `xdev: false`) and answers `null` for everything
 * else. It mirrors `scripts/omp-tool-surface.py`'s scalar vocabulary for booleans, including its
 * `true/yes/on/y` word set and its comment stripping, but it does NOT try to be that parser: the
 * Python leaf reports a full verdict for a doctor, this one answers one question for a refusal.
 *
 * The tri-state is what makes both callers able to fail in the direction their axis needs, so
 * neither has to invent a default here.
 */
export function readOmpConfigFlag(agentDir: string, section: string, key: string): boolean | null {
	let text: string | null = null;
	for (const name of MAIN_CONFIG_FILENAMES) {
		const candidate = path.join(agentDir, name);
		if (!existsSync(candidate)) continue;
		try {
			if (statSync(candidate).isDirectory()) return null;
			text = readFileSync(candidate, "utf8");
		} catch {
			return null;
		}
		break;
	}
	if (text === null) return null;
	// A tab anywhere in the body makes this not-YAML for the vendor's own reader; refuse rather
	// than guess which indentation the vendor would have seen.
	let inSection = false;
	// The indent of the section's IMMEDIATE children, learned from the first one. Matching a key
	// at any deeper indent would read `tools.nested.xdev` as `tools.xdev` — a fail-OPEN misread
	// that would preflight green off a config which never set the flag. Caught by
	// `check-omp-fresh-preflight` when this reader was first compared against the python leaf.
	let childIndent = -1;
	for (const raw of text.split("\n")) {
		const body = stripComment(raw);
		if (body.trim() === "") continue;
		if (body.includes("\t")) return null;
		const indent = body.length - body.trimStart().length;
		const trimmed = body.trim();
		if (!inSection) {
			if (indent === 0 && trimmed === `${section}:`) inSection = true;
			continue;
		}
		if (indent === 0) break; // the section ended at the next top-level key
		if (childIndent === -1) childIndent = indent;
		if (indent !== childIndent) continue; // a grandchild, or a mis-indented line: not our key
		const colon = trimmed.indexOf(":");
		if (colon <= 0) continue;
		if (trimmed.slice(0, colon).trim() !== key) continue;
		return parseBool(trimmed.slice(colon + 1).trim());
	}
	return null;
}

/** Comment stripping with the same quote awareness as `omp-tool-surface.py:strip_comment`. */
function stripComment(raw: string): string {
	let inSingle = false;
	let inDouble = false;
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\" && inDouble) {
			escaped = true;
			continue;
		}
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === "#" && !inSingle && !inDouble) return raw.slice(0, i).trimEnd();
	}
	return raw.trimEnd();
}

/** `omp-tool-surface.py:parse_scalar`'s boolean vocabulary; anything else is "not a boolean". */
function parseBool(text: string): boolean | null {
	const folded = text.toLowerCase();
	if (["true", "yes", "on", "y"].includes(folded)) return true;
	if (["false", "no", "off", "n"].includes(folded)) return false;
	return null;
}

/**
 * The five axes, decided in the order an operator should repair them. Returns the FIRST missing
 * capability, or `null` when every one is in place.
 *
 * Order is not cosmetic. The agent dir comes first because every other predicate is a path under
 * it — reporting "birth unit missing" while the directory itself is ambiguous would send the
 * operator to reinstall into a directory omp may never read. Birth precedes the rest because a
 * host with no birth unit has nothing else worth checking, and visible identity depends on the
 * same unit.
 */
export function ompFreshPreflight(env: NodeJS.ProcessEnv): OmpPreflightRejectReason | null {
	const agentDir = ompAgentDir(env);
	if (agentDir === null) return "omp-agent-dir-ambiguous";

	const extensions = path.join(agentDir, "extensions");
	if (!isDir(path.join(extensions, BIRTH_UNIT))) return "omp-birth-unit-missing";

	// The native MCP entry omp reads, at the ONE non-configurable path the installer owns
	// (`scripts/omp-mcp-bridge.sh`: `<resolved omp agent dir>/mcp.json`).
	const mcp = readJsonObject(path.join(agentDir, "mcp.json"));
	const servers = mcp?.mcpServers;
	const hand =
		typeof servers === "object" && servers !== null && !Array.isArray(servers)
			? (servers as Record<string, unknown>)[MCP_SERVER_KEY]
			: undefined;
	if (typeof hand !== "object" || hand === null || Array.isArray(hand)) return "omp-mcp-hand-missing";

	if (!isDir(path.join(extensions, RECEIVE_UNIT))) return "omp-receive-unit-missing";

	// Visible identity: the vendor default is TRUE, so only an explicit false refuses. An
	// unreadable config is not a refusal HERE — it is one on the axis below, which needs proof
	// rather than absence, and reporting the same file twice under two names would send an
	// operator looking for two problems.
	if (readOmpConfigFlag(agentDir, "statusLine", "showHookStatus") === false) return "omp-visible-identity-missing";

	// Callback callable: the vendor default is TRUE and true is the BROKEN state, so this axis
	// requires positive proof of `false`. Absent file, absent key and unparseable config all
	// refuse — that is the fail-closed direction, and it is the opposite of the axis above for
	// the same reason: each fails toward the value the vendor would actually apply.
	if (readOmpConfigFlag(agentDir, "tools", "xdev") !== false) return "omp-callback-tool-uncallable";

	return null;
}

/** Repair text lives on the leaf that decides the predicate, so the sentence an operator reads
 * cannot drift away from the check that produced it. */
export const OMP_PREFLIGHT_HINT: Record<OmpPreflightRejectReason, string> = {
	"omp-agent-dir-ambiguous":
		"an inherited PI_CODING_AGENT_DIR / PI_CONFIG_DIR / PI_PROFILE makes it ambiguous which agent directory omp would read (omp is a pi fork and shares those names) — unset it, or set ENTWURF_OMP_AGENT_DIR explicitly; guessing would preflight a directory no live omp reads",
	"omp-birth-unit-missing":
		"this host has no OMP birth extension, so the sibling would mint no record and its callback would carry no garden id — run `entwurf install-omp-bridge`",
	"omp-mcp-hand-missing":
		"this host has no entwurf-bridge server in omp's own mcp.json, so the callback tool would not exist in that session — run `entwurf install-omp-mcp`",
	"omp-receive-unit-missing":
		"this host has no OMP receiver extension, so the sibling could call home and nothing could ever be delivered to it — run `entwurf install-omp-receive`",
	"omp-visible-identity-missing":
		"omp's statusLine.showHookStatus is set to false, so the citizen's garden id would render nowhere on its own TUI — remove that setting from the omp config",
	"omp-callback-tool-uncallable":
		"omp's tools.xdev is not set to false, so MCP tools mount as xd:// devices whose schemas never reach the prompt and the model cannot call the callback tool — set `tools: xdev: false` in the omp agent config",
};
