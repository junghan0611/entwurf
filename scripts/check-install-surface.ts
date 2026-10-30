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
 *        leaves (a build bloat regression is as real as a missing artifact). A gate with no
 *        explicit arm is dispatched by its own name (`check-x` → `check_x`, run.sh's default
 *        arm), so S4 reads those from the function definitions; a case-label reader alone would
 *        lose every one of them and stay green on what it no longer sees.
 *   S5   no offline smoke carries an obvious write to the operator's real $HOME, and any
 *        smoke that swaps HOME into a sandbox swaps XDG_DATA_HOME with it — moving HOME
 *        alone still writes real install-state below the inherited XDG root, which is
 *        exactly how a verification sweep polluted a live host's provenance (2026-07-14).
 *   S5b  every offline smoke that swaps HOME also swaps XDG_DATA_HOME (HOME alone still
 *        writes real install-state below the inherited XDG root).
 *   S5c  every MUTATING run.sh drive in the offline floor is sandboxed at every root it
 *        writes (agent dir + XDG + HOME), not only by an enclosing export.
 *   S5d  a gate may isolate by PROCESS BOUNDARY instead of by HOME swap: lines inside a
 *        `CONTAINER_RUNNER_EOF` heredoc run in a container, so their $HOME is not this
 *        host's and S5 must not read them as host writes. The exemption covers the BLOCK,
 *        never the file — the same file's host half stays under the tripwire — and it is
 *        verified, not declared: exactly one block, and its command must START with
 *        `docker run` (containing the token is not enough — `echo docker run … <<TAG`
 *        contains it while executing right here).
 *   S7   the release operator surface is one repo-local Agent Skill shared by Claude Code and
 *        pi: project settings point pi at `.claude/skills`, land/prepare/make/publish coexist in
 *        one SKILL.md, the exact-SHA CI oracle ships beside it, and retired prompt copies stay
 *        absent. S7c also pins that the tracked settings carry NO packages key — entwurf's own
 *        checkout self-registers through user scope alone (#110).
 *   S6   tracked first-party text sources are NUL-free (a stray NUL makes git show nothing).
 *   S8   the by-name dispatch answers only for a gate function run.sh itself defined: a run.sh
 *        function that is not a gate (`usage`), a gate name nothing defines, one only an
 *        exported BASH_FUNC_* defines, and one only a comment/heredoc spells all stay the
 *        Unknown command; an admitted gate runs once, with no argv, its streams and exact exit
 *        status intact, and stops at its first failure.
 *
 * HONEST SCOPE — what a green run does and does not mean. S1-S4 are structural: they read the
 * dispatch graph and the build manifest, so they hold for any entrypoint written in this repo's
 * style. S5 is a static TRIPWIRE over shell source: it catches a literal live path and ONE hop
 * of variable aliasing, and it does not see a path assembled across several variables, built
 * inside an embedded python/node heredoc, or reached through a helper in another file. A green
 * S5 therefore means "no obvious destructive line", NOT "verification is sandboxed". The real
 * guarantee would be running the whole offline floor under a swapped HOME; that is not done,
 * and not claimed here. Every S was mutation-checked, including bypasses found in
 * review — do not add an S without proving it fails on the bug it names.
 *
 * Read-only for the repo: parses sources; spawns git, and S8's bounded bash probes — the
 * checkout's run.sh on the Unknown path, a byte copy of run.sh in a tmp dir with one fixture gate
 * defined ahead of the unchanged dispatch, and `bash -c` witnesses that an exported function
 * really imports. Each probe gets PATH plus at most the BASH_FUNC_* its cell names, never the
 * host environment.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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

/** Gates no explicit arm claims: run.sh's default arm reaches them by name, check-x → check_x. */
const byNameGates = new Map<string, string[]>();
for (const [fn, ts] of functionTargets()) {
	const cmd = fn.replace(/_/g, "-");
	if (/^(?:check|smoke)_[a-z0-9_]+$/.test(fn) && !targets.has(cmd)) byNameGates.set(cmd, ts);
}
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

	// Counted from the raw text, not through functionTargets, so a reader that stopped seeing gate
	// functions shrinks this set against an independent number instead of passing on fewer rows.
	const gateFnDefs = [...RUN_SH.matchAll(/^((?:check|smoke)_[a-z0-9_]+)\(\)\s*\{/gm)].map((m) => m[1] as string);
	const unaccounted = gateFnDefs.filter((fn) => {
		const cmd = fn.replace(/_/g, "-");
		return !targets.has(cmd) && !byNameGates.has(cmd);
	});
	ok(
		`[QK:DEV-GATE-BY-NAME-READ] S4 reads every gate function: ${byNameGates.size} dispatched by name + the rest under an explicit arm`,
		byNameGates.size > 0 && unaccounted.length === 0,
		unaccounted.length ? `gate functions S4 cannot see: ${unaccounted.join(", ")}` : "no gate is dispatched by name",
	);

	// Names alone are not coverage: a reader that kept every name but lost its leaves would pass
	// the bloat check on empty rows. Two gates the by-name arm reaches, with the leaf each one's
	// run.sh function runs (read off run.sh by hand, not off this reader).
	const knownLeaves: [cmd: string, leaf: string][] = [
		["check-peer-facts", "check-peer-facts"],
		["smoke-herdr-plugin-build-live", "smoke-herdr-plugin-build-live"],
	];
	const lostLeaves = knownLeaves.filter(([cmd, leaf]) => !(byNameGates.get(cmd) ?? []).includes(leaf));
	ok(
		"[QK:DEV-GATE-BY-NAME-LEAVES] S4 reads the run_ts leaf of a by-name gate, not only its name",
		lostLeaves.length === 0,
		lostLeaves.map(([cmd, leaf]) => `'${cmd}' should reach scripts/${leaf}.ts`).join("\n"),
	);

	const bloat = [...targets, ...byNameGates].flatMap(([cmd, tss]) =>
		isDevGate(cmd) ? tss.filter((ts) => emitted.has(ts)).map((ts) => [cmd, ts]) : [],
	);
	ok(
		"[QK:DEV-GATE-BY-NAME-NOT-EMITTED] S4: dev-only gates are not emitted into the tarball (explicit arms and by-name gates)",
		bloat.length === 0,
		bloat.map(([cmd, ts]) => `'${cmd}' is a dev gate but scripts/${ts}.ts is in the build include`).join("\n"),
	);
}

// ─── S8 — the by-name dispatch answers only for a defined gate function ──────────────
{
	// Only PATH crosses: the probes end on the Unknown path, and no host identity or secret has a
	// reason to reach them.
	const probe = (cmd: string) =>
		spawnSync("bash", [path.join(REPO, "run.sh"), cmd], {
			cwd: REPO,
			encoding: "utf8",
			env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
		});
	const isUnknown = (cmd: string): boolean => {
		const r = probe(cmd);
		return r.status === 1 && r.stderr === `Unknown command: ${cmd}\n` && r.stdout.startsWith("Usage:\n");
	};
	ok(
		"[QK:BY-NAME-GATE-PREFIX] S8a a run.sh function that is not a gate (`usage`) is still the Unknown command, never run by name",
		isUnknown("usage"),
	);
	ok(
		"[QK:BY-NAME-GATE-DEFINED] S8b a gate name no function defines is still the Unknown command (rc 1 + usage), never a bash command-not-found",
		isUnknown("check-no-such-gate"),
	);

	// A byte copy of run.sh with one fixture gate defined ahead of the dispatch, which stays
	// exactly the production text. The gate fails at its third line, so a dispatcher that loses
	// errexit runs the marker after it; a comment and a heredoc spell two more gate names that
	// nothing defines.
	const dir = mkdtempSync(path.join(os.tmpdir(), "entwurf-by-name-"));
	try {
		// Bash parameter expansion, escaped so the string holds the literal `${1:-}` run.sh carries.
		const DISPATCH = `\ncmd=\${1:-}\n`;
		if (RUN_SH.split(DISPATCH).length !== 2)
			throw new Error(`S8: run.sh no longer has exactly one \`cmd=\${1:-}\` line`);
		const fixture = [
			"check_dispatch_probe() {",
			"  printf 'argc=%s\\n' \"$#\"",
			"  echo probe-stderr >&2",
			"  (exit 7)",
			"  echo MARK-AFTER-FAILURE",
			"}",
			"# check_comment_only() { :; }",
			": <<'TEXT_ONLY'",
			"check_heredoc_only() { :; }",
			"TEXT_ONLY",
		].join("\n");
		const copy = path.join(dir, "run.sh");
		writeFileSync(copy, RUN_SH.replace(DISPATCH, `\n${fixture}${DISPATCH}`));
		const run = (argv: string[], extraEnv: Record<string, string> = {}) =>
			spawnSync("bash", [copy, ...argv], {
				cwd: dir,
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...extraEnv },
			});
		const unknownIn = (cmd: string, extraEnv: Record<string, string> = {}): boolean => {
			const r = run([cmd], extraEnv);
			return r.status === 1 && r.stderr === `Unknown command: ${cmd}\n` && r.stdout.startsWith("Usage:\n");
		};
		const probe = run(["check-dispatch-probe", "extra-a", "extra-b"]);
		ok(
			"[QK:BY-NAME-GATE-RUNS] S8c an admitted gate runs exactly once: its stdout/stderr pass through and its exact nonzero status (7) is run.sh's",
			probe.status === 7 && probe.stdout.split("argc=").length === 2 && probe.stderr === "probe-stderr\n",
			`rc=${probe.status} stdout=${JSON.stringify(probe.stdout)} stderr=${JSON.stringify(probe.stderr)}`,
		);
		ok(
			"[QK:BY-NAME-GATE-NO-ARGV] S8d the gate is called with no arguments, as the explicit arm it replaced did",
			probe.stdout.startsWith("argc=0\n"),
			`stdout=${JSON.stringify(probe.stdout)}`,
		);
		ok(
			"[QK:BY-NAME-GATE-STOPS] S8e the gate stops at its first failure: the line after it never runs",
			!probe.stdout.includes("MARK-AFTER-FAILURE") && probe.status === 7,
			`rc=${probe.status} stdout=${JSON.stringify(probe.stdout)}`,
		);
		// An exported function for `fn`, plus the witness that bash really imports that spelling —
		// without it, a malformed variable would leave no function to refuse and a cell would pass
		// on nothing.
		const exportFn = (fn: string): { env: Record<string, string>; imported: boolean } => {
			const env = { [`BASH_FUNC_${fn}%%`]: "() {  echo env-function-ran\n}" };
			const w = spawnSync("bash", ["-c", fn], {
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
			});
			return { env, imported: w.stdout === "env-function-ran\n" };
		};
		const envOnly = exportFn("check_env_only");
		ok(
			"[QK:BY-NAME-GATE-DEFINED-HERE] S8f a gate only an exported environment function defines is the Unknown command",
			envOnly.imported && unknownIn("check-env-only", envOnly.env),
			`import witness: ${envOnly.imported}`,
		);
		// The same refusal for a name run.sh spells only in a comment or a heredoc, with a real
		// exported function of that name present — the text must not vouch for it.
		const textOnly = ["check_comment_only", "check_heredoc_only"].map((fn) => {
			const e = exportFn(fn);
			return { fn, imported: e.imported, unknown: unknownIn(fn.replace(/_/g, "-"), e.env) };
		});
		ok(
			"S8g an exported function whose name run.sh spells only in a comment or a heredoc is the Unknown command",
			textOnly.every((c) => c.imported && c.unknown),
			JSON.stringify(textOnly),
		);
		const shadowed = run(["check-dispatch-probe"], { "BASH_FUNC_check_dispatch_probe%%": "() {  exit 0\n}" });
		ok(
			"S8h an environment function with the name of a gate run.sh defines does not replace it",
			shadowed.status === 7 && shadowed.stdout === "argc=0\n",
			`rc=${shadowed.status} stdout=${JSON.stringify(shadowed.stdout)}`,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
	// floor — everything in the check tiers (`pnpm check` / `pnpm run check:full`) — must not: it runs on every commit, and a smoke
	// that writes the real ~/.claude, ~/.gemini or ~/.pi would uninstall the operator's
	// own bridge as a side effect of "testing".
	const LIVE_GATES = new Set(["smoke-resident-garden-guard.sh", "smoke-meta-async-drift.sh"]);

	// Presence of a HOME= override SOMEWHERE in the file proves nothing — an isolated smoke
	// can still carry one destructive line aimed at the real install. Look at the WRITES
	// themselves: a mutation whose target is a literal $HOME/~ config path is operating on
	// the operator's own bridge, whatever the rest of the file does. Reads ($HOME/.current-device,
	// probing whether a real bundle exists) stay legal — they cannot uninstall anything.
	const LIVE_ROOTS = String.raw`(?:\$HOME|\$\{HOME\}|~)/\.(?:claude|copilot|gemini|pi|config/pi|local/share/(?:claude|entwurf))`;
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
	const RUNSH_DRIVE = /(?:\$\{?RUN\}?|run\.sh)\s+(install|setup|remove-user-scope|remove)\b/;
	// install/setup write the operator's REAL user-scope surfaces under "$HOME"
	// (settings.json registration follows PI_CODING_AGENT_DIR when set, but provider
	// state and the rest stay HOME/XDG-rooted), so sandboxing the agent dir alone is not
	// isolation for them; HOME is required. (setup:links died with
	// the target registry — #50 C3.)
	const HOME_ROOTED = new Set(["install", "setup"]);

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
					"HOME (install/setup write user-scope settings under $HOME/.pi/agent — the agent-dir override does not reach them)",
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
// invisible here, recreating the split this migration removes. Keep every authority mode in
// one file, and ship one executable exact-SHA CI oracle so both harnesses classify the same run.
{
	const settingsRel = ".pi/settings.json";
	const skillRel = ".claude/skills/entwurf-release/SKILL.md";
	const ciOracleRel = ".claude/skills/entwurf-release/scripts/verify-exact-ci.sh";
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
	const readCandidateMode = (file: string): string | null => {
		const stage = execFileSync("git", ["ls-files", "--stage", "--", file], { cwd: REPO, encoding: "utf8" }).trim();
		return stage === "" ? null : (stage.split(/\s+/, 1)[0] ?? null);
	};
	const settingsText = readCandidate(settingsRel);
	const skill = readCandidate(skillRel);
	const ciOracle = readCandidate(ciOracleRel);
	const ciOracleMode = readCandidateMode(ciOracleRel);
	ok(
		"S7a: the candidate index carries the shared release skill and exact-SHA CI oracle",
		settingsText !== null && skill !== null && ciOracle !== null,
		[settingsText === null ? settingsRel : "", skill === null ? skillRel : "", ciOracle === null ? ciOracleRel : ""]
			.filter(Boolean)
			.join("\n"),
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
	// S7c pins an INVARIANT, not a shape. #53 B: a host-absolute path must never reach
	// this tracked, biome-governed file. It used to be pinned as "the entry is exactly
	// `..`", which satisfied that invariant and carried a second, unintended one — the
	// checkout registers ITSELF. #110 showed what that second one buys: user scope
	// already registers this root absolutely, so in any OTHER checkout the two entries
	// name different directories, pi's dedupe (identity = `local:<resolved path>`) keeps
	// both, and two copies of pi-extensions/entwurf-control.ts fight over
	// `--entwurf-control` — the branch copy wins and the INSTALLED one fails, printing
	// the installed path as the loser. No packages key at all satisfies #53 B strictly
	// more than `..` did, and leaves self-registration where it is owned.
	ok(
		"S7c: candidate project settings never bind entwurf to a checkout path",
		settingsText === null || settings.packages === undefined,
		`${settingsRel}: expected NO packages key — entwurf's own checkout self-registers through user scope (#110)`,
	);
	const bridge = settings.entwurfProvider?.mcpServers?.["entwurf-bridge"];
	ok(
		"S7d: candidate project settings use the stable entwurf-bridge bin, never a host-absolute path",
		settingsText === null ||
			(bridge?.command === "entwurf-bridge" && Array.isArray(bridge.args) && bridge.args.length === 0),
		`${settingsRel}: expected entwurfProvider.mcpServers.entwurf-bridge to use the stable bin`,
	);
	const skillIsAscii = skill !== null && [...skill].every((char) => (char.codePointAt(0) ?? 128) <= 127);
	const oracleIsAscii = ciOracle !== null && [...ciOracle].every((char) => (char.codePointAt(0) ?? 128) <= 127);
	const skillAcceptsPrerelease =
		skill !== null &&
		skill.includes("version must be SemVer, optionally with a prerelease suffix") &&
		skill.includes("(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?");
	ok(
		"S7e: one English-only skill owns all four authority modes and accepts SemVer prereleases",
		skill === null ||
			(/^name:\s*entwurf-release$/m.test(skill) &&
				skill.includes("# LAND") &&
				skill.includes("# PREPARE") &&
				skill.includes("# MAKE") &&
				skill.includes("# PUBLISH") &&
				skillAcceptsPrerelease &&
				skillIsAscii),
		`${skillRel}: missing name, four authority modes, prerelease contract, or English/ASCII-only surface`,
	);
	ok(
		"S7g: the executable ASCII CI oracle binds headSha and all four required jobs",
		ciOracle === null ||
			(ciOracle.includes("headSha") &&
				ciOracle.includes('"check"') &&
				ciOracle.includes('"install-surface"') &&
				ciOracle.includes('"artifact-consumer"') &&
				ciOracle.includes('"macos-install-surface"') &&
				ciOracleMode === "100755" &&
				oracleIsAscii),
		`${ciOracleRel}: missing executable mode, exact-SHA classification, required jobs, or ASCII-only content`,
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
