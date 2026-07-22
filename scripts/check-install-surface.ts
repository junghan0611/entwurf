/**
 * check-install-surface — the structural half of the node_modules strip-types fence.
 *
 * Node REFUSES `--experimental-strip-types` for any .ts below node_modules. An installed
 * package therefore MUST reach compiled JS for every surface an operator can invoke. That
 * rule was enforced by hand, per surface, and it failed three times: the agy imprint hook
 * (0.12.7 blocker) plus `doctor-pi-provider` / `new-session-id` / `meta-bridge-prune`,
 * which all shipped dead under node_modules while every dev clone stayed green.
 *
 * check-pack-install proves the fence is crossed by DRIVING the installed commands. This
 * gate proves no NEW surface can reintroduce the class, statically and with no side
 * effects — sweeping every subcommand for real would run installers and LIVE gates.
 *
 *   S1   run.sh reaches .ts ONLY through run_ts (one fence, one place).
 *   S2   every operator subcommand (one that is neither a check- nor a smoke- gate) that runs
 *        a .ts — directly OR through a helper function, which is the house style — has a
 *        compiled twin declared in tsconfig.build.json. The exact miss that killed the three.
 *   S3a  no npm bin points at a raw .ts at all; S3b every .sh bin that execs one branches.
 *   S4   dev-only gates are NOT emitted — the tarball ships operator surfaces, not 70+ gate
 *        leaves (a build bloat regression is as real as a missing artifact).
 *   S5   no offline smoke carries an obvious write to the operator's real $HOME, and any
 *        smoke that swaps HOME into a sandbox swaps XDG_DATA_HOME with it — moving HOME
 *        alone still writes real install-state below the inherited XDG root, which is
 *        exactly how a verification sweep polluted a live host's provenance (2026-07-14).
 *   S5d  a gate may isolate by PROCESS BOUNDARY instead of by HOME swap: lines inside a
 *        `CONTAINER_RUNNER_EOF` heredoc run in a container, so their $HOME is not this
 *        host's and S5 must not read them as host writes. The exemption covers the BLOCK,
 *        never the file — the same file's host half stays under the tripwire — and it is
 *        verified, not declared: exactly one block, and its command must START with
 *        `docker run` (containing the token is not enough — `echo docker run … <<TAG`
 *        contains it while executing right here).
 *   S7   the release operator surface is one repo-local Agent Skill shared by Claude Code and
 *        pi: project settings point pi at `.claude/skills`, the prepare/make modes coexist in
 *        one SKILL.md, and the retired pi-only prompt copies stay absent.
 *
 * HONEST SCOPE — what a green run does and does not mean. S1-S4 are structural: they read the
 * dispatch graph and the build manifest, so they hold for any entrypoint written in this repo's
 * style. S5 is a static TRIPWIRE over shell source: it catches a literal live path and ONE hop
 * of variable aliasing, and it does not see a path assembled across several variables, built
 * inside an embedded python/node heredoc, or reached through a helper in another file. A green
 * S5 therefore means "no obvious destructive line", NOT "verification is sandboxed". The real
 * guarantee is running the whole offline floor under a swapped HOME; that is an open item in
 * NEXT.md, not a claim made here. Every S was mutation-checked, including bypasses found in
 * review — do not add an S without proving it fails on the bug it names.
 *
 * Read-only: parses sources, spawns nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_SH = readFileSync(path.join(REPO, "run.sh"), "utf8");
const BUILD_TSCONFIG = readFileSync(path.join(REPO, "mcp/entwurf-bridge/tsconfig.build.json"), "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
	bin?: Record<string, string>;
};

let failed = 0;
function ok(label: string, cond: boolean, detail?: string): void {
	if (cond) {
		console.log(`  ok    ${label}`);
		return;
	}
	failed += 1;
	console.error(`  FAIL  ${label}`);
	if (detail) console.error(detail.replace(/^/gm, "        "));
}

/** Lines of run.sh with comments and the run_ts definition body excluded. */
function runShCodeLines(): { line: string; n: number }[] {
	const out: { line: string; n: number }[] = [];
	let inRunTs = false;
	RUN_SH.split("\n").forEach((line, i) => {
		if (/^run_ts\(\)\s*\{/.test(line)) inRunTs = true;
		else if (inRunTs && /^\}/.test(line)) inRunTs = false;
		else if (!inRunTs && !/^\s*#/.test(line)) out.push({ line, n: i + 1 });
	});
	return out;
}

// ─── S1 — run.sh crosses the fence in exactly one place ──────────────────────────────
{
	const raw = runShCodeLines().filter(({ line }) => /node\s+--experimental-strip-types/.test(line));
	ok(
		"S1: run.sh reaches .ts only through run_ts (no raw strip-types call sites)",
		raw.length === 0,
		raw.map(({ line, n }) => `run.sh:${n}: ${line.trim()}`).join("\n"),
	);
}

// ─── S2/S4 — operator commands are compiled; dev gates are not ───────────────────────
const emitted = new Set(
	[...BUILD_TSCONFIG.matchAll(/"\.\.\/\.\.\/scripts\/([a-z0-9-]+)\.ts"/g)].map((m) => m[1] as string),
);

/**
 * subcommand → every .ts it can reach.
 *
 * The naive version — read the `run_ts` call sitting directly under a `case` label — is what the
 * dominant style in this file does NOT look like: nearly every subcommand delegates to a function
 * (`check-shell-quote) check_shell_quote ;;`). A gate that only sees direct calls would pass a new
 * operator command written in the house style with no compiled twin, which is the very bug this
 * file exists to prevent. So resolve through function bodies too.
 */
const RUN_TS_CALL = /run_ts\s+scripts\/([a-z0-9-]+)\.ts/;

function functionTargets(): Map<string, string[]> {
	const byFn = new Map<string, string[]>();
	let fn: string | null = null;
	for (const { line } of runShCodeLines()) {
		// Read the definition line's own tail too: `f() { run_ts scripts/x.ts; }` is a single line,
		// and a parser that only looks at SUBSEQUENT lines walks right past it.
		const def = line.match(/^(?:function\s+)?([a-z_][a-z0-9_]*)\s*\(\)\s*\{(.*)$/);
		if (def) {
			fn = def[1] as string;
			byFn.set(fn, []);
			const tail = def[2] ?? "";
			const inlineCall = tail.match(RUN_TS_CALL);
			if (inlineCall) byFn.get(fn)?.push(inlineCall[1] as string);
			if (tail.includes("}")) fn = null; // one-liner: body opened and closed here
			continue;
		}
		if (fn && /^\}/.test(line)) {
			fn = null;
			continue;
		}
		const call = line.match(RUN_TS_CALL);
		if (fn && call) byFn.get(fn)?.push(call[1] as string);
	}
	return byFn;
}

function subcommandTargets(): Map<string, string[]> {
	const byFn = functionTargets();
	const map = new Map<string, string[]>();
	let current: string | null = null;
	let inCaseBody = false;
	for (const { line } of runShCodeLines()) {
		const label = line.match(/^\s{2}([a-z][a-z0-9-]*)\)\s*$/);
		if (label) {
			current = label[1] as string;
			inCaseBody = true;
			map.set(current, []);
			continue;
		}
		if (!current || !inCaseBody) continue;
		if (/^\s{4};;\s*$/.test(line)) {
			inCaseBody = false;
			continue;
		}
		const direct = line.match(/run_ts\s+scripts\/([a-z0-9-]+)\.ts/);
		if (direct) map.get(current)?.push(direct[1] as string);
		// …and one hop through a helper function, which is how most subcommands are written.
		for (const word of line.trim().split(/[\s;|&(]+/)) {
			const viaFn = byFn.get(word);
			if (viaFn?.length) map.get(current)?.push(...viaFn);
		}
	}
	return map;
}

const targets = subcommandTargets();
const isDevGate = (cmd: string): boolean => cmd.startsWith("check-") || cmd.startsWith("smoke-");
const operatorCmds = [...targets].filter(([cmd, ts]) => !isDevGate(cmd) && ts.length > 0);

{
	const dead = operatorCmds.flatMap(([cmd, tss]) => tss.filter((ts) => !emitted.has(ts)).map((ts) => [cmd, ts]));
	ok(
		`S2: every operator subcommand has a compiled twin (${operatorCmds.length} operator surfaces, direct + via helper)`,
		dead.length === 0,
		dead
			.map(
				([cmd, ts]) =>
					`'entwurf ${cmd}' runs scripts/${ts}.ts, which tsconfig.build.json does not emit —\n` +
					`it will die under node_modules with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.\n` +
					`Add "../../scripts/${ts}.ts" to the build include and to the check-pack artifact list.`,
			)
			.join("\n\n"),
	);

	const bloat = [...targets].flatMap(([cmd, tss]) =>
		isDevGate(cmd) ? tss.filter((ts) => emitted.has(ts)).map((ts) => [cmd, ts]) : [],
	);
	ok(
		"S4: dev-only gates are not emitted into the tarball",
		bloat.length === 0,
		bloat.map(([cmd, ts]) => `'${cmd}' is a dev gate but scripts/${ts}.ts is in the build include`).join("\n"),
	);
}

// ─── S3 — no npm bin can reach a raw .ts when installed ──────────────────────────────
{
	// Two ways a bin dies under node_modules: it IS a .ts, or it is a wrapper that execs one
	// without branching. The first is flatly forbidden — there is no correct way to point an npm
	// bin at a raw .ts, since Node cannot strip types there at all.
	const rawTsBins: string[] = [];
	const unbranchedWrappers: string[] = [];
	for (const [name, rel] of Object.entries(PACKAGE_JSON.bin ?? {})) {
		if (/\.ts$/.test(rel)) {
			rawTsBins.push(`${name} → ${rel}`);
			continue;
		}
		if (!rel.endsWith(".sh")) continue;
		const src = readFileSync(path.join(REPO, rel), "utf8");
		const execsTs = /--experimental-strip-types[^\n]*\.ts|\.ts"?\s*$/m.test(src) && /\.ts/.test(src);
		if (!execsTs) continue; // python3/JS-only wrappers (the statuslines) never hit the fence
		if (!/node_modules\/\*/.test(src)) unbranchedWrappers.push(rel);
	}
	ok(
		"S3a: no npm bin points at a raw .ts (Node cannot strip types under node_modules at all)",
		rawTsBins.length === 0,
		rawTsBins.map((b) => `bin ${b} is a raw .ts — it can never run from an installed package`).join("\n"),
	);
	ok(
		"S3b: every npm bin wrapper that execs a .ts branches on node_modules",
		unbranchedWrappers.length === 0,
		unbranchedWrappers
			.map((f) => `${f} execs a .ts with no */node_modules/* branch — it dies when installed`)
			.join("\n"),
	);
}

// ─── S5 — verification must not rewire the operator's live host ──────────────────────
{
	// A LIVE gate legitimately drives the real host (that is what LIVE means). The offline
	// floor — everything in `pnpm check` — must not: it runs on every commit, and a smoke
	// that writes the real ~/.claude, ~/.gemini or ~/.pi would uninstall the operator's
	// own bridge as a side effect of "testing".
	const LIVE_GATES = new Set(["smoke-resident-garden-guard.sh", "smoke-meta-async-drift.sh"]);

	// Presence of a HOME= override SOMEWHERE in the file proves nothing — an isolated smoke
	// can still carry one destructive line aimed at the real install. Look at the WRITES
	// themselves: a mutation whose target is a literal $HOME/~ config path is operating on
	// the operator's own bridge, whatever the rest of the file does. Reads ($HOME/.current-device,
	// probing whether a real bundle exists) stay legal — they cannot uninstall anything.
	const LIVE_ROOTS = String.raw`(?:\$HOME|\$\{HOME\}|~)/\.(?:claude|gemini|pi|config/pi|local/share/(?:claude|entwurf))`;
	const MUTATORS = String.raw`rm\s+-\w+|rm|mv|cp|install|mkdir\s+-p|mkdir|touch|tee|ln\s+-s\w*|truncate`;

	// A mutating run.sh drive is shell code, not prose. `bad "… re-run ./run.sh install-meta-bridge"`
	// and a python assertion string both carry the same token, so normalize a line to its code
	// before looking for a drive: drop message arguments, keep "$RUN" / "$REPO/run.sh" as the
	// executable tokens they are, and blank every other quoted literal.
	const MSG_ARG = /\b(?:bad|ok|echo|log|warn|fail|printf)\s+"(?:[^"\\]|\\.)*"/g;
	const EXEC_TOKEN = /"(\$\{?RUN\}?|\$[A-Za-z_]\w*\/run\.sh|\.{0,2}\/?run\.sh)"/g;
	const shellCode = (l: string) =>
		l
			.replace(MSG_ARG, "")
			.replace(EXEC_TOKEN, "$1")
			.replace(/"(?:[^"\\]|\\.)*"/g, '""')
			.replace(/'(?:[^'\\]|\\.)*'/g, "''");
	const RUNSH_DRIVE = /(?:\$\{?RUN\}?|run\.sh)\s+(install|setup:links|setup|remove-user-scope|remove)\b/;
	// ensure_agent_dir_symlinks() hard-codes "$HOME/.pi/agent" and ignores PI_CODING_AGENT_DIR
	// entirely (run.sh:424), so these commands relink the operator's REAL agent dir no matter how
	// the override is set. Sandboxing the agent dir is not isolation for them; only HOME is.
	const HOME_ROOTED = new Set(["install", "setup", "setup:links"]);

	// A THIRD isolation shape, alongside "swaps HOME" and "is a LIVE gate": code that never
	// runs on this host at all. #51's artifact-consumer gate ships its runner as a heredoc fed
	// to `docker run`, so its `$HOME` is the container's, and every live-path write inside it is
	// correct. A whole-file exemption would be too blunt — that file also has real host code
	// (pack, chmod, digest) that must stay under the tripwire — so exempt the BLOCK, not the file.
	//
	// The exemption is not a promise, it is checked: the reserved tag only silences lines when
	// the file demonstrably hands that heredoc to `docker run`. Laundering host code through the
	// reserved name is itself an offense, reported below. (Same discipline as S5c: match the
	// construct, then demand the isolation — never the other way round.)
	const CONTAINER_TAG = "CONTAINER_RUNNER_EOF";
	const containerLaunderers: string[] = [];
	function containerBlock(f: string, lines: string[]): Set<number> {
		const inside = new Set<number>();
		const openers = lines.flatMap((l, i) => (l.includes(`<<'${CONTAINER_TAG}'`) ? [i] : []));
		const closers = lines.flatMap((l, i) => (l.trim() === CONTAINER_TAG ? [i] : []));
		if (openers.length === 0 && closers.length === 0) return inside;

		// Exactly one block, exactly one terminator. Several blocks (or a stray
		// terminator) make "which lines are exempt" ambiguous, and an ambiguous
		// exemption is the thing to fail on, not to resolve by guessing.
		if (openers.length !== 1 || closers.length !== 1) {
			containerLaunderers.push(
				`scripts/${f}: expected exactly one '${CONTAINER_TAG}' block, found ${openers.length} opener(s) and ${closers.length} terminator(s) — an ambiguous exemption is refused, never guessed`,
			);
			return inside;
		}
		const opensAt = openers[0] as number;
		const closesAt = closers[0] as number;
		if (closesAt <= opensAt) {
			containerLaunderers.push(`scripts/${f}:${opensAt + 1} '${CONTAINER_TAG}' terminator precedes its opener`);
			return inside;
		}

		// The heredoc word sits on the `docker run` command line or a continuation of it, so
		// walk back over backslash continuations to find the command it actually feeds — and
		// ANCHOR on that command's first word. Merely CONTAINING the token is not enough:
		// `echo docker run ... <<'TAG'` contains it while executing on this host, which is
		// exactly the laundering this rule exists to refuse.
		let cmdStart = opensAt;
		while (cmdStart > 0 && /\\\s*$/.test(lines[cmdStart - 1] as string)) cmdStart -= 1;
		if (!/^\s*docker\s+run\b/.test(lines[cmdStart] as string)) {
			containerLaunderers.push(
				`scripts/${f}:${opensAt + 1} opens a '${CONTAINER_TAG}' block whose command starts with \`${(lines[cmdStart] as string).trim().split(/\s+/)[0] ?? "?"}\`, not \`docker run\` — the container exemption cannot be claimed for host code`,
			);
			return inside;
		}
		for (let i = opensAt + 1; i < closesAt; i += 1) inside.add(i);
		return inside;
	}

	const offenders: { file: string; line: number; text: string }[] = [];
	const xdgOffenders: string[] = [];
	const agentDirXdgOffenders: string[] = [];
	for (const f of readdirSync(path.join(REPO, "scripts"))) {
		if (!/^(smoke|check)-.*\.sh$/.test(f) || LIVE_GATES.has(f)) continue;
		const lines = readFileSync(path.join(REPO, "scripts", f), "utf8").split("\n");
		const inContainer = containerBlock(f, lines);

		// The install smokes DO write "$HOME/.claude/…" — legally, because they first swap the
		// process HOME to a sandbox (`export HOME="$TMP/home"`), after which $HOME no longer names
		// the operator's home at all. So the offense is not "writes $HOME"; it is writing a live
		// path while $HOME still points at the real one: with no swap, or before the swap.
		const swapAt = lines.findIndex((l) => /^\s*export\s+HOME=/.test(l) && !/(\$HOME|~)\//.test(l));

		// A HOME swap DECLARES isolation — and isolation that inherits the operator's real
		// XDG_DATA_HOME is a lie: every install adapter roots its state at
		// ${XDG_DATA_HOME:-$HOME/.local/share}/entwurf, so the "sandboxed" run keeps writing
		// real state records whose managed targets are sandbox paths. That is the exact leak
		// that broke a live host's provenance on 2026-07-14 (AGENTS.md hard rule 11: swap BOTH).
		// The swap must not itself lean on the unswapped variable ($XDG_DATA_HOME on the RHS).
		const xdgSwapAt = lines.findIndex((l) => /^\s*export\s+XDG_DATA_HOME=/.test(l) && !/\$\{?XDG_DATA_HOME/.test(l));
		const xdgSwapped = xdgSwapAt !== -1;
		if (swapAt !== -1 && !xdgSwapped) xdgOffenders.push(f);

		// A mutating run.sh drive writes through THREE roots, and no single override covers them:
		// the agent dir (settings target), ${XDG_DATA_HOME}/entwurf (the ownership state whose
		// recorded managedSettingsPath an inverse FOLLOWS), and $HOME (the hard-coded agent-dir
		// symlinks). smoke-user-scope-citizen sandboxed the first and passed the operator's real
		// second, so `pnpm check` removed the live MCP key while reporting green (2026-07-14).
		// Find the drive, then demand what that command actually needs — in whatever env form
		// carries it. The leak shipped as inline env; the same drive hoisted into an `export` is
		// the same leak, and a tripwire that only sees one syntactic form is how the next one ships.
		const agentDirExportAt = lines.findIndex((l) => /^\s*export\s+PI_CODING_AGENT_DIR=/.test(l));
		lines.forEach((line, i) => {
			if (/^\s*#/.test(line)) return;
			const code = shellCode(line);
			const drive = code.match(RUNSH_DRIVE);
			if (!drive) return;
			const cmd = drive[1] as string;
			const homeOk = /(?:^|\s)HOME=/.test(code) || (swapAt !== -1 && i > swapAt);
			const xdgOk = /XDG_DATA_HOME=/.test(code) || (xdgSwapAt !== -1 && i > xdgSwapAt);
			const agentOk = /PI_CODING_AGENT_DIR=/.test(code) || (agentDirExportAt !== -1 && i > agentDirExportAt) || homeOk;
			const missing: string[] = [];
			if (!xdgOk)
				missing.push(
					"XDG_DATA_HOME (real ownership state — an inverse follows its managedSettingsPath to the live host)",
				);
			if (!agentOk) missing.push("PI_CODING_AGENT_DIR or HOME (real ~/.pi/agent/settings.json)");
			if (HOME_ROOTED.has(cmd) && !homeOk)
				missing.push(
					"HOME (ensure_agent_dir_symlinks hard-codes $HOME/.pi/agent — the agent-dir override does not reach it)",
				);
			if (missing.length)
				agentDirXdgOffenders.push(
					`scripts/${f}:${i + 1} drives \`run.sh ${cmd}\` without a sandbox ${missing.join("\n  and without a sandbox ")}`,
				);
		});

		// One hop of aliasing: `VICTIM="$HOME/.gemini/…"` taints VICTIM, so `rm -rf "$VICTIM"` is
		// caught too. Without this, renaming the path into a variable walks straight past the
		// tripwire — which it did, until a review mutation proved it.
		const tainted = new Set<string>();
		lines.forEach((line, i) => {
			if (/^\s*#/.test(line)) return;
			const assign = line.match(new RegExp(String.raw`^\s*(?:local\s+|export\s+)?([A-Za-z_]\w*)=["']?${LIVE_ROOTS}`));
			if (assign && (swapAt === -1 || i < swapAt)) tainted.add(assign[1] as string);
		});
		const aliasAlt = tainted.size
			? String.raw`|(?:${MUTATORS})\s+(?:-\w+\s+)*["']?\$\{?(?:${[...tainted].join("|")})\b`
			: "";
		const WRITE_TO_LIVE = new RegExp(
			String.raw`(?:(?:${MUTATORS})\s+(?:-\w+\s+)*["']?${LIVE_ROOTS}|>>?\s*["']?${LIVE_ROOTS}${aliasAlt})`,
		);

		lines.forEach((line, i) => {
			if (/^\s*#/.test(line)) return;
			if (inContainer.has(i)) return; // executes in the container, not on this host
			if (!WRITE_TO_LIVE.test(line)) return;
			const sandboxed = swapAt !== -1 && i > swapAt;
			if (!sandboxed) offenders.push({ file: f, line: i + 1, text: line.trim() });
		});
	}
	ok(
		`S5d: the '${CONTAINER_TAG}' exemption is a single block whose command STARTS with \`docker run\` (verified, not declared)`,
		containerLaunderers.length === 0,
		containerLaunderers.join("\n"),
	);
	ok(
		"S5: no offline smoke carries an obvious write to the real $HOME (static tripwire, not a sandbox proof)",
		offenders.length === 0,
		offenders.map((o) => `scripts/${o.file}:${o.line} mutates the operator's live install:\n  ${o.text}`).join("\n"),
	);
	ok(
		"S5b: every offline smoke that swaps HOME also swaps XDG_DATA_HOME (HOME alone still writes real install-state)",
		xdgOffenders.length === 0,
		xdgOffenders
			.map(
				(f) =>
					`scripts/${f} exports a sandbox HOME but never exports a sandbox XDG_DATA_HOME —\n` +
					`its install-state writes land under the operator's real ~/.local/share/entwurf.`,
			)
			.join("\n"),
	);
	ok(
		"S5c: every mutating run.sh drive in the offline floor is sandboxed at every root it writes",
		agentDirXdgOffenders.length === 0,
		agentDirXdgOffenders.join("\n"),
	);
}

// ── S7: one multi-harness release skill, no pi-only prompt copies ───────────
// Claude Code discovers `.claude/skills` natively. Pi sees the SAME directory only
// through project settings — without that one line the skill works in Claude and is
// invisible here, recreating the split this migration removes. Keep prepare + make in
// one file so their SemVer/prerelease contract cannot drift apart again.
{
	const settingsRel = ".pi/settings.json";
	const skillRel = ".claude/skills/entwurf-release/SKILL.md";
	const retiredRels = [".pi/prompts/prepare-release.md", ".pi/prompts/make-release.md"];
	// Read the CANDIDATE INDEX, not the operator's working tree. An untracked skill
	// can make local discovery and every working-tree read green while CI receives
	// no file at all. `git show :path` also rejects intent-to-add/unstaged-content
	// laundering: the bytes judged here are exactly the bytes a commit would carry.
	const readCandidate = (file: string): string | null => {
		try {
			return execFileSync("git", ["show", `:${file}`], {
				cwd: REPO,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			return null;
		}
	};
	const settingsText = readCandidate(settingsRel);
	const skill = readCandidate(skillRel);
	ok(
		"S7a: the candidate index carries both halves of the shared release-skill surface",
		settingsText !== null && skill !== null,
		[settingsText === null ? settingsRel : "", skill === null ? skillRel : ""].filter(Boolean).join("\n"),
	);
	let settings: {
		skills?: unknown;
		packages?: unknown;
		entwurfProvider?: { mcpServers?: { "entwurf-bridge"?: { command?: unknown; args?: unknown } } };
	} = {};
	let settingsParseError = "";
	if (settingsText !== null) {
		try {
			settings = JSON.parse(settingsText);
		} catch (error) {
			settingsParseError = error instanceof Error ? error.message : String(error);
		}
	}
	ok(
		"S7b: candidate pi settings load the Claude-native repo skill directory",
		settingsText === null ||
			(settingsParseError === "" && Array.isArray(settings.skills) && settings.skills.includes("../.claude/skills")),
		settingsParseError || `${settingsRel}: expected skills to include ../.claude/skills`,
	);
	ok(
		"S7c: candidate project settings keep the local package source portable",
		settingsText === null ||
			(Array.isArray(settings.packages) && settings.packages.length === 1 && settings.packages[0] === ".."),
		`${settingsRel}: expected packages to be the settings-relative repo root '..'`,
	);
	const bridge = settings.entwurfProvider?.mcpServers?.["entwurf-bridge"];
	ok(
		"S7d: candidate project settings use the stable entwurf-bridge bin, never a host-absolute path",
		settingsText === null ||
			(bridge?.command === "entwurf-bridge" && Array.isArray(bridge.args) && bridge.args.length === 0),
		`${settingsRel}: expected entwurfProvider.mcpServers.entwurf-bridge to use the stable bin`,
	);
	const skillIsAscii = skill !== null && [...skill].every((char) => (char.codePointAt(0) ?? 128) <= 127);
	ok(
		"S7e: one English-only entwurf-release skill owns prepare + make and accepts the repair prerelease example",
		skill === null ||
			(/^name:\s*entwurf-release$/m.test(skill) &&
				skill.includes("# PREPARE") &&
				skill.includes("# MAKE") &&
				skill.includes("0.12.8-repair.0") &&
				skillIsAscii),
		`${skillRel}: missing from the index, or missing name, prepare/make mode, prerelease contract, or English/ASCII-only surface`,
	);
	const retired = retiredRels.filter((file) => readCandidate(file) !== null);
	ok(
		"S7f: the candidate index omits the retired pi-only release prompts (no second release SSOT)",
		retired.length === 0,
		retired.join("\n"),
	);
}

// ── S6: tracked first-party sources are TEXT ────────────────────────────────
// A single stray NUL byte makes a source file `data` to file(1) and BINARY to git:
// `git diff` stops showing content, and every reviewer and safety hook that reads the
// diff is reading nothing. That is not a cosmetic defect — it is a hole straight
// through the review surface, and it is silent because tsc, biome and the test run all
// keep passing (a NUL inside a JS string literal is perfectly valid code).
// This is not hypothetical: a `.join("\0")` typo shipped in a new gate here on
// 2026-07-22 and was caught by cross-review reading `file`, not by any gate.
{
	const tracked = execFileSync(
		"git",
		["ls-files", "--cached", "--", "*.ts", "*.js", "*.sh", "*.py", "*.json", "*.md"],
		{
			cwd: REPO,
			encoding: "utf8",
		},
	)
		.split("\n")
		.filter(Boolean)
		// `git ls-files --cached` still names an unstaged deletion. Release-surface
		// migrations deliberately delete tracked prompt files before the commit
		// workflow stages them; absence is not binary content and must not crash this
		// read-only gate before it can inspect the candidate files that remain.
		.filter((f) => existsSync(path.join(REPO, f)));
	const binary = tracked.filter((f) => readFileSync(path.join(REPO, f)).includes(0));
	ok(
		`S6: all ${tracked.length} present tracked first-party text sources are NUL-free (git shows them as diffable text)`,
		tracked.length >= 20 && binary.length === 0,
		binary.length ? binary.map((f) => `${f}: contains a NUL byte`).join("\n") : "git ls-files returned too few files",
	);
}

console.log(
	failed === 0
		? "\ncheck-install-surface: install surface is structurally fenced"
		: `\ncheck-install-surface: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
