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
 *   S9   `entwurf --help` and `entwurf help <command>` render root ENTWURF-CLI.json through
 *        scripts/cli-help.mjs. The root forms and the Unknown path print the ce92dc7 usage bytes (a
 *        fixture outside the tarball, pinned) with explicit amendments only — the `entwurf` prefix and
 *        the tool count EXPECTED_TOOLS holds. The source is read beside the renderer; of the PATH tools
 *        it watches, a help run starts only node on that renderer (a PATH watch, not an exec audit —
 *        the renderer's node:fs-only reach is read directly); a missing or malformed source fails by
 *        name with no fallback text, exit 1 on every form, apart from a refused help request's 2; an
 *        early-closed reader ends the page quietly, both pipe sides 0 under pipefail; the committed
 *        bytes are canonical — the only guard against a duplicated JSON property, which JSON.parse
 *        accepts. A help preflight between `cmd=${1:-}`
 *        and the dispatch case answers `help <command>` and `<command> -h|--help` before any arm: on a
 *        byte copy that stops at the case, every command run.sh has is asked — described ones print
 *        their page, undescribed ones are refused (exit 2) and never run, the four vendor launchers
 *        pass through — and extra argv, the `--help <command>` alias and odd names are refused on one
 *        line. fresh-cut's longer text matches its ce92dc7 source literal minus the old invocation.
 *        Coverage reads owners independently of the data: operator commands are the labels of a case
 *        byte-pinned to the reviewed ce92dc7 one (evidence for this change, not a ban on later work),
 *        gate commands are the functions bash itself defines from run.sh — so a definition left only
 *        as heredoc text is no command — and every description names one of them while the
 *        undescribed are exactly the ce92dc7 debt.
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
 * really imports; S9's root-help runs of the checkout's run.sh and of tmp copies carrying a broken
 * help source, under a PATH whose leading shims record what a help run starts, byte copies that
 * stop before the dispatch to list the functions bash defined (scratch HOME/XDG, the same refusing
 * shims), and a byte copy whose dispatch case is preceded by a sentinel exit, on which every command
 * is asked for its help without any arm being reachable. Each probe gets PATH plus at most the BASH_FUNC_* or scratch HOME/XDG its cell names,
 * never the host environment.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRESH_CUT_EXIT } from "../pi-extensions/lib/meta-session.ts";
import { EXPECTED_TOOLS } from "./probe-bridge-command.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_SH = readFileSync(path.join(REPO, "run.sh"), "utf8");
const BUILD_TSCONFIG = readFileSync(path.join(REPO, "mcp/entwurf-bridge/tsconfig.build.json"), "utf8");
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
	bin?: Record<string, string>;
};
// Bash parameter expansion, escaped so the string holds the literal `${1:-}` run.sh carries: the
// line the top-level dispatch starts at.
const DISPATCH = `\ncmd=\${1:-}\n`;
const CLI_JSON = "ENTWURF-CLI.json";
const CLI_RENDERER = "scripts/cli-help.mjs";

/** Copy the help source and its renderer beside a fixture run.sh, where its usage() reads them. */
function stageHelp(dir: string, json: string = readFileSync(path.join(REPO, CLI_JSON), "utf8")): void {
	mkdirSync(path.join(dir, "scripts"), { recursive: true });
	copyFileSync(path.join(REPO, CLI_RENDERER), path.join(dir, CLI_RENDERER));
	writeFileSync(path.join(dir, CLI_JSON), json);
}

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
		stageHelp(dir); // the Unknown path renders the usage, which reads beside run.sh
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

// ─── S9 — `entwurf --help` renders ENTWURF-CLI.json, which describes only real commands ─
{
	// The independent oracle is what ce92dc7's usage() heredoc actually printed, kept byte for byte
	// outside the tarball; the pin fences the fixture itself so neither can drift alone. It is the
	// CONTENT oracle of the root page, and no expected root text or inventory is derived from the new
	// description data. The command pages further down are checked against a page built from the
	// data entry — a routing and format oracle; their content is bound by this root fixture (every
	// synopsis and summary also prints on the root page) and by fresh-cut's own fixture (details).
	const OLD_USAGE_FIXTURE = "test/fixtures/cli-help/usage-ce92dc7.txt";
	const OLD_USAGE_SHA256 = "e67f1cb97e5022b865f525d8fb37e3cd0fd0adac927323efd2f27beb9c9e23e6";
	const oldUsage = readFileSync(path.join(REPO, OLD_USAGE_FIXTURE), "utf8");
	const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
	if (sha256(oldUsage) !== OLD_USAGE_SHA256) throw new Error(`S9: ${OLD_USAGE_FIXTURE} is not the ce92dc7 usage`);

	// The root page today is that fixture with exactly these explicit amendments applied, each naming
	// the source that justifies it — never a text regenerated from the new data. The prefix: a command
	// line names the product, not the checkout's script; columns are absolute, so the character the
	// prefix loses becomes one more space before `#`. The literals: an old phrase that is no longer
	// true, replaced where it stands.
	const respell = (l: string): string =>
		l.replace(/^ {2}\.\/run\.sh (\S.*?)( +)# /, (_m, syn, gap) => `  entwurf ${syn}${gap} # `);
	const toolCountWord = ({ 9: "nine" } as Record<number, string>)[EXPECTED_TOOLS.length];
	const literalAmendments: { old: string; next: string; receipt: string }[] = [
		{
			old: "EXACTLY the eight shipped garden verbs",
			next: `EXACTLY the ${toolCountWord} shipped garden verbs`,
			receipt:
				"scripts/probe-bridge-command.ts EXPECTED_TOOLS; check-entwurf-bridge-boot G1f checks the live tools/list",
		},
		{
			old: "roots and BOTH component inverses read-only first; mutates only when every preflight is green; then Claude -> Pi user scope -> runtime -> ledger LAST. A component failure stops with the runtime and ledger intact as retry authority. With NO ledger it removes nothing: a clean host exits 0, and anything found at the plugin's journal/runtime/cache addresses is named",
			next: "roots, BOTH component inverses and the operator link (#153) read-only first; mutates only when every preflight is green; then the operator link -> Claude -> Pi user scope -> runtime -> ledger LAST. A component failure stops with the runtime and ledger intact as retry authority. With NO ledger it removes nothing: a clean host exits 0, and anything found at the plugin's journal/runtime/cache addresses or its operator-link receipt is named",
			receipt:
				"scripts/herdr-plugin-deactivate.mjs: preflightOperatorLink beside the component preflights, removeOperatorLink before the components, operatorLinkLeftovers with no ledger (#153)",
		},
	];
	const respelled = oldUsage.split("\n").filter((l) => respell(l) !== l).length;
	let expectedRoot = oldUsage.split("\n").map(respell).join("\n");
	const amendmentProblems: string[] = [];
	if (toolCountWord === undefined)
		amendmentProblems.push(`EXPECTED_TOOLS has ${EXPECTED_TOOLS.length} tools, no reviewed word`);
	for (const a of literalAmendments) {
		if (expectedRoot.split(a.old).length !== 2) amendmentProblems.push(`not exactly once in the fixture: ${a.old}`);
		expectedRoot = expectedRoot.replace(a.old, a.next);
	}
	// A line the old usage never had: a debt name described since, inserted right after the fixture
	// line it belongs beside. The text is a reviewed literal whose receipt is the arm it describes.
	const insertedLines: { after: string; line: string; receipt: string }[] = [
		{
			after: "  entwurf pi-durable [args...]        # ",
			line: "  entwurf pi [args...]                # #118: the MANAGED pi launch. exec()s the pi that `type -P` finds on PATH (a file, never a shell function or alias) in THIS terminal, with --entwurf-control added ahead of your argv, which passes through untouched. Refuses by name when ENTWURF_PI_LAUNCH_ACTIVE is non-empty (it exports that to the pi it starts), when no pi is on PATH (it launches the pi coding agent, it does not install one), or when that path is not an executable regular file",
			receipt:
				"run.sh `pi)` arm: type -P pi, the non-empty ENTWURF_PI_LAUNCH_ACTIVE refusal, the missing and non-regular refusals, exec with --entwurf-control",
		},
		{
			after: "  entwurf herdr-plugin-deactivate    # ",
			line: "  entwurf herdr-plugin-expose-operator --bin-dir <abs>  # #153 the ONE explicit operator link: creates exactly <abs>/entwurf -> the Herdr runtime's own node_modules/.bin/entwurf, recorded by a receipt beside the activation ledger (raised to schema 3 first, so an artifact that cannot undo the link refuses the host). Runs only as the active runtime's package, only from a settled runtime with an active ledger, only into a physical directory that is an entry of the caller's PATH with no earlier entwurf on it; an existing file there without a receipt is someone else's and is refused. Never edits a profile or picks a directory",
			receipt: "run.sh `herdr-plugin-expose-operator)` arm -> scripts/herdr-operator-link.mjs expose (#153)",
		},
		{
			after: "  entwurf herdr-plugin-expose-operator --bin-dir <abs>  # ",
			line: "  entwurf herdr-plugin-withdraw-operator  # #153 the opt-out of herdr-plugin-expose-operator: removes exactly the receipt's link — only while it is still that link — and then the receipt; the ledger stays at schema 3. Runs only as the active runtime's package. herdr-plugin-deactivate removes the same link first, before any component",
			receipt: "run.sh `herdr-plugin-withdraw-operator)` arm -> scripts/herdr-operator-link.mjs withdraw (#153)",
		},
	];
	for (const ins of insertedLines) {
		const rows = expectedRoot.split("\n");
		const at = rows.flatMap((l, i) => (l.startsWith(ins.after) ? [i] : []));
		if (at.length !== 1) amendmentProblems.push(`insertion anchor not exactly once: ${ins.after}`);
		else rows.splice(at[0] + 1, 0, ins.line);
		expectedRoot = rows.join("\n");
	}

	const helpEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin" };
	const runHelp = (runSh: string, argv: string[], cwd: string, env: Record<string, string> = helpEnv) =>
		spawnSync("bash", [runSh, ...argv], { cwd, encoding: "utf8", env });
	const rootForms: string[][] = [[], ["-h"], ["--help"], ["help"]];
	/** Recording shims for the tools a help run must not start; `node` gets `nodeTail` instead. */
	const makeShims = (dir: string, nodeTail: string): { bin: string; trace: string } => {
		const bin = path.join(dir, "shims");
		const trace = path.join(dir, "trace");
		mkdirSync(bin);
		writeFileSync(trace, "");
		const watched = [
			"python3",
			"pnpm",
			"npm",
			"git",
			"tmux",
			"herdr",
			"pi",
			"claude",
			"codex",
			"copilot",
			"ssh",
			"curl",
		];
		for (const name of ["node", ...watched]) {
			writeFileSync(
				path.join(bin, name),
				`#!/bin/sh\nprintf '%s' "${name}" >>'${trace}'; printf ' %s' "$@" >>'${trace}'; echo >>'${trace}'\n${name === "node" ? nodeTail : "exit 99"}\n`,
				{ mode: 0o755 },
			);
		}
		return { bin, trace };
	};
	const rendersRoot = (runSh: string, cwd: string): string[] => {
		const bad: string[] = [];
		for (const argv of rootForms) {
			const r = runHelp(runSh, argv, cwd);
			if (r.status !== 0 || r.stderr !== "" || r.stdout !== expectedRoot) {
				bad.push(`${JSON.stringify(argv)}: rc=${r.status} stdout-sha=${sha256(r.stdout)} stderr=${r.stderr.trim()}`);
			}
		}
		const u = runHelp(runSh, ["no-such-command"], cwd);
		if (u.status !== 1 || u.stderr !== "Unknown command: no-such-command\n" || u.stdout !== expectedRoot) {
			bad.push(`unknown: rc=${u.status} stdout-sha=${sha256(u.stdout)} stderr=${u.stderr.trim()}`);
		}
		return bad;
	};
	const rootBad = rendersRoot(path.join(REPO, "run.sh"), REPO);
	ok(
		"[QK:CLI-HELP-ROOT-BYTES] S9a the root help (no argv, -h, --help, help) and the Unknown path print exactly the ce92dc7 usage bytes with the reviewed amendments",
		rootBad.length === 0,
		rootBad.join("\n"),
	);
	const rootNow = runHelp(path.join(REPO, "run.sh"), ["--help"], REPO).stdout;
	ok(
		"[QK:CLI-HELP-AMENDMENTS] S9a' each amendment is exact: every command line is spelled `entwurf`, the tool count is the one EXPECTED_TOOLS holds, and no replaced phrase survives",
		amendmentProblems.length === 0 &&
			respelled === 189 &&
			!/^ {2}\.\/run\.sh /m.test(rootNow) &&
			literalAmendments.every((a) => rootNow.split(a.next).length === 2 && !rootNow.includes(a.old)),
		[...amendmentProblems, `respelled lines: ${respelled}`].join("\n"),
	);
	// pi left the description debt: its root line is the reviewed literal, once, beside pi-durable,
	// and `entwurf help pi` prints that same summary as its page.
	const piRows = rootNow.split("\n");
	const piLine = insertedLines[0].line;
	const piAt = piRows.flatMap((l, i) => (l === piLine ? [i] : []));
	const piPage = runHelp(path.join(REPO, "run.sh"), ["help", "pi"], REPO);
	const piSummary = piLine.slice(piLine.indexOf("# ") + 2);
	ok(
		"[QK:CLI-HELP-PI-DESCRIBED] S9a'' `pi` is described by the reviewed literal: one root line, right after pi-durable's, and `entwurf help pi` prints that summary",
		piAt.length === 1 &&
			piRows[piAt[0] - 1].startsWith(insertedLines[0].after) &&
			piPage.status === 0 &&
			piPage.stderr === "" &&
			piPage.stdout === `Usage: entwurf pi [args...]\n\n${piSummary}\n`,
		JSON.stringify({ lines: piAt.length, rc: piPage.status, stderr: piPage.stderr, page: piPage.stdout.slice(0, 200) }),
	);

	const scratch = mkdtempSync(path.join(os.tmpdir(), "entwurf-cli-help-"));
	try {
		// A decoy source in the caller's cwd and HOME: the renderer must read the bytes beside itself.
		const decoy = path.join(scratch, "decoy");
		mkdirSync(path.join(decoy, "scripts"), { recursive: true });
		writeFileSync(path.join(decoy, CLI_JSON), "{");
		const r = runHelp(path.join(REPO, "run.sh"), ["--help"], decoy, { ...helpEnv, HOME: decoy });
		ok(
			"[QK:CLI-HELP-MODULE-RELATIVE] S9b the help source is read beside the renderer, never from the caller's cwd or HOME",
			r.status === 0 && r.stdout === expectedRoot,
			`rc=${r.status} stderr=${r.stderr.trim()}`,
		);

		// Production run.sh under a PATH whose first entries record what a help run starts, among the
		// tools shimmed here: node is wrapped and then really runs, the rest refuse. This is a PATH
		// watch, not a full exec audit — an absolute-path exec or a module node imports is not seen. The
		// renderer's own reach is read directly: it imports node:fs alone and reads one module-relative
		// file. Within that scope a help run starts one thing: node on the shipped renderer, no argument.
		const { bin: shims, trace } = makeShims(scratch, `exec '${process.execPath}' "$@"`);
		const traced = { PATH: `${shims}:${helpEnv.PATH}` };
		for (const argv of [...rootForms, ["no-such-command"]]) runHelp(path.join(REPO, "run.sh"), argv, REPO, traced);
		const want = `node ${path.join(REPO, CLI_RENDERER)}\n`.repeat(rootForms.length + 1);
		const got = readFileSync(trace, "utf8");
		ok(
			"[QK:CLI-HELP-ONLY-RENDERER] S9c of the PATH tools watched (node, python3, pnpm, npm, git, tmux, herdr, pi, claude, codex, copilot, ssh, curl), a help run starts only node on scripts/cli-help.mjs",
			got === want,
			`trace:\n${got}`,
		);

		// A fixture copy whose description source is missing or malformed. Each must fail by name with
		// nothing on stdout — the root forms and the Unknown path alike, no older text behind them.
		// These are the RUNTIME refusals. A duplicated JSON property is not one of them: JSON.parse
		// keeps the last value silently, so only S9g's check-time canonical comparison sees it.
		const good = JSON.parse(readFileSync(path.join(REPO, CLI_JSON), "utf8")) as {
			schemaVersion: number;
			usage: { commandGroups: Record<string, unknown>[][] };
		};
		const variant = (edit: (d: typeof good) => void): string => {
			const d = structuredClone(good);
			edit(d);
			return JSON.stringify(d);
		};
		const first = good.usage.commandGroups[0]?.[0];
		const broken: [label: string, json: string | null][] = [
			["missing", null],
			["not JSON", "{"],
			[
				"unsupported schemaVersion",
				variant((d) => {
					d.schemaVersion = 1;
				}),
			],
			[
				"an entry with a field the schema does not know",
				variant((d) => {
					d.usage.commandGroups[0]![0]!.run = "x";
				}),
			],
			[
				"one command described twice",
				variant((d) => {
					d.usage.commandGroups[1]!.push({ ...first });
				}),
			],
			[
				"details that start on an empty line",
				variant((d) => {
					d.usage.commandGroups[0]![0]!.details = ["", "text"];
				}),
			],
			[
				"details that are not single-line strings",
				variant((d) => {
					d.usage.commandGroups[0]![0]!.details = ["one\ntwo"];
				}),
			],
		];
		const failures: string[] = [];
		const strictness: Record<string, boolean> = {};
		for (const [label, json] of broken) {
			const dir = path.join(scratch, `broken-${Object.keys(strictness).length}`);
			mkdirSync(dir);
			writeFileSync(path.join(dir, "run.sh"), RUN_SH);
			stageHelp(dir, json ?? "");
			if (json === null) rmSync(path.join(dir, CLI_JSON));
			let refused = true;
			// The root forms, the Unknown path and a command help: each must be the metadata failure —
			// exactly 1, never the help refusal's 2 — with nothing on stdout.
			for (const argv of [["--help"], ["no-such-command"], ["peer-facts", "--help"]]) {
				const b = runHelp(path.join(dir, "run.sh"), argv, dir);
				if (b.status !== 1 || b.stdout !== "" || !b.stderr.includes(`entwurf: ${CLI_JSON} `)) {
					refused = false;
					failures.push(
						`${label} ${JSON.stringify(argv)}: rc=${b.status} stdout=${b.stdout.length}B stderr=${b.stderr.trim()}`,
					);
				}
			}
			strictness[label] = refused;
		}
		ok(
			"[QK:CLI-HELP-FAIL-LOUD] S9d a missing or unparseable help source fails help by name, with no stdout and no fallback text",
			strictness.missing === true && strictness["not JSON"] === true,
			failures.join("\n"),
		);
		ok(
			"[QK:CLI-HELP-STRICT-FIELDS] S9e the renderer refuses the old schemaVersion, a field the schema does not know, and details that start empty or span lines",
			strictness["unsupported schemaVersion"] === true &&
				strictness["an entry with a field the schema does not know"] === true &&
				strictness["details that start on an empty line"] === true &&
				strictness["details that are not single-line strings"] === true,
			failures.join("\n"),
		);
		ok(
			"[QK:CLI-HELP-UNIQUE] S9f the renderer refuses a command described twice",
			strictness["one command described twice"] === true,
			failures.join("\n"),
		);
		// The two failure kinds stay apart: a broken source is exit 1 on every form above, while the
		// same command-help shape against an intact source, naming nothing it describes, is the help
		// refusal's exit 2.
		const intactRefusal = runHelp(path.join(REPO, "run.sh"), ["help", "no-such-command"], REPO);
		ok(
			"[QK:CLI-HELP-METADATA-EXIT] S9f' a missing or malformed source is exit 1 on root, Unknown and command help alike — distinct from the exit 2 of a refused help request",
			Object.keys(strictness).length === broken.length &&
				Object.values(strictness).every(Boolean) &&
				intactRefusal.status === 2 &&
				intactRefusal.stdout === "" &&
				intactRefusal.stderr.startsWith("entwurf: no help for "),
			[...failures, `intact refusal: rc=${intactRefusal.status} stderr=${intactRefusal.stderr.trim()}`].join("\n"),
		);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}

	// Check time only: the committed bytes are the canonical serialisation of what they parse to.
	// This is what catches a duplicated JSON property (JSON.parse keeps the last one silently, so it
	// would change the rendering without failing), and it pins one format so a review reads one
	// shape. It says nothing about a file someone edits after install.
	const cliBytes = readFileSync(path.join(REPO, CLI_JSON), "utf8");
	ok(
		"[QK:CLI-HELP-CANONICAL] S9g ENTWURF-CLI.json is its own canonical serialisation (no duplicated property survives the commit)",
		cliBytes === `${JSON.stringify(JSON.parse(cliBytes), null, "\t")}\n`,
		'rewrite it with JSON.stringify(data, null, "\\t") + "\\n"',
	);

	// Coverage, read independently of the data. Operator commands are the case labels of the
	// top-level dispatch: the `case "$cmd" in` after the `cmd=${1:-}` line, to the column-0 `esac`
	// that closes it. That is a text read, so it is bound to the reviewed ce92dc7 case (plus its reviewed
	// #153 two-arm amendment) by a byte pin
	// — evidence for this change, not a ban on later dispatch work: a change to the case re-reviews
	// its labels and moves the pin in the same change. The labels are not claimed to be
	// runtime-proven. Gate commands are the check_/smoke_ functions bash itself defines when it reads
	// run.sh — a definition spelled only in a heredoc or a comment defines nothing, and an
	// environment function is not run.sh's.
	const CASE_LINE = 'case "$cmd" in\n';
	const start = RUN_SH.indexOf(DISPATCH);
	const caseAt = RUN_SH.indexOf(`\n${CASE_LINE}`, start) + 1;
	const end = RUN_SH.indexOf("\nesac\n", caseAt) + "\nesac\n".length;
	// Moved for #153: two operator-link arms (herdr-plugin-expose-operator / -withdraw-operator), re-reviewed.
	const REVIEWED_CASE_SHA256 = "33a3af3671da176400229ca59858ed1643fec75f0f740a506a13cd9c4260dfeb";
	ok(
		"[QK:CLI-HELP-DISPATCH-REVIEWED] S9h the case the operator labels are read from is the reviewed ce92dc7 case plus the reviewed #153 two-arm amendment, byte for byte",
		start > 0 && caseAt > start && sha256(RUN_SH.slice(caseAt, end)) === REVIEWED_CASE_SHA256,
		"the top-level case changed: re-review its labels against ENTWURF-CLI.json and the debt below, then move the pin",
	);
	// The help preflight sits between `cmd=${1:-}` and that case, and nowhere else: the only case is
	// the pinned one, and the preflight's code opens no case, esac or heredoc that could hide a
	// second dispatch or move the pinned one.
	const preflightCode = RUN_SH.slice(start + DISPATCH.length, caseAt)
		.split("\n")
		.filter((l) => !/^\s*#/.test(l))
		.join("\n");
	ok(
		"[QK:CLI-HELP-PREFLIGHT-PLACEMENT] S9h' the help preflight is plain if/elif code between the dispatch's `cmd=` line and the one pinned case",
		RUN_SH.split(CASE_LINE).length === 2 &&
			/\bexec node "\$REPO_DIR\/scripts\/cli-help\.mjs" --command\b/.test(preflightCode) &&
			!/\bcase\b|\besac\b|<</.test(preflightCode),
		preflightCode,
	);
	const labels = [...RUN_SH.slice(caseAt, end).matchAll(/^ {2}([a-z][a-z0-9-]*)\)$/gm)].map((m) => m[1] as string);

	// A byte copy that stops right before the dispatch and lists what bash defined while reading it.
	// Everything above the dispatch runs — assignments and definitions — so the probe gets a scratch
	// HOME/XDG and the same recording shims as S9c (node included, refusing): nothing may start and
	// nothing may be written.
	const bashDefinedGates = (text: string): { names: Set<string>; problems: string[] } => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "entwurf-gate-fns-"));
		try {
			if (text.split(DISPATCH).length !== 2) throw new Error("S9: the copy has no single dispatch line");
			const home = path.join(dir, "home");
			mkdirSync(home);
			const { bin, trace } = makeShims(dir, "exit 99");
			const copy = path.join(dir, "run.sh");
			const probe = 'shopt -s extdebug\nfor __f in $(compgen -A function); do declare -F "$__f"; done\nexit 0';
			writeFileSync(copy, text.replace(DISPATCH, `\n${probe}${DISPATCH}`));
			const r = spawnSync("bash", [copy], {
				cwd: dir,
				encoding: "utf8",
				env: {
					PATH: `${bin}:${helpEnv.PATH}`,
					HOME: home,
					XDG_CONFIG_HOME: path.join(home, ".config"),
					XDG_DATA_HOME: path.join(home, ".local/share"),
					XDG_STATE_HOME: path.join(home, ".local/state"),
					XDG_CACHE_HOME: path.join(home, ".cache"),
				},
			});
			const problems: string[] = [];
			if (r.status !== 0 || r.stderr !== "") problems.push(`probe rc=${r.status} stderr=${r.stderr.trim()}`);
			const started = readFileSync(trace, "utf8");
			if (started !== "") problems.push(`the probe started:\n${started}`);
			if (readdirSync(home, { recursive: true }).length > 0) problems.push("the probe wrote below its HOME");
			const names = new Set<string>();
			for (const line of r.stdout.split("\n")) {
				const m = line.match(/^((?:check|smoke)_[a-z0-9_]+) [1-9][0-9]* (.*)$/);
				if (m && m[2] === copy) names.add((m[1] as string).replace(/_/g, "-"));
			}
			return { names, problems };
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};
	const defined = bashDefinedGates(RUN_SH);
	const inventory = new Set([...labels, ...defined.names]);
	const described = (
		JSON.parse(cliBytes) as { usage: { commandGroups: { synopsis: string }[][] } }
	).usage.commandGroups.flatMap((g) => g.map((e) => e.synopsis.split(" ", 1)[0] as string));
	const orphansOf = (inv: Set<string>): string[] => described.filter((n) => !inv.has(n));
	const orphans = orphansOf(inventory);
	ok(
		`[QK:CLI-HELP-NO-ORPHAN] S9i every described command is a reviewed dispatch label or a gate function bash defines from run.sh (${described.length} described, ${labels.length} labels + ${defined.names.size} gate functions)`,
		labels.length > 0 && defined.names.size > 0 && defined.problems.length === 0 && orphans.length === 0,
		[...defined.problems, orphans.length ? `described but not reachable: ${orphans.join(", ")}` : ""]
			.filter(Boolean)
			.join("\n"),
	);

	// The negative that makes the owner read worth having: a real, described gate whose definition
	// survives only as heredoc text. A text reader still finds `check_peer_facts() {` there; bash
	// defines nothing, so the name leaves the inventory and its description becomes an orphan.
	const ownerAt = RUN_SH.indexOf("\ncheck_peer_facts() {\n");
	const ownerEnd = RUN_SH.indexOf("\n}\n", ownerAt) + "\n}".length;
	if (ownerAt < 0 || ownerEnd <= ownerAt) throw new Error("S9: run.sh no longer defines check_peer_facts");
	const textOnlyOwner = bashDefinedGates(
		`${RUN_SH.slice(0, ownerAt)}\n: <<'TEXT_ONLY'${RUN_SH.slice(ownerAt, ownerEnd)}\nTEXT_ONLY${RUN_SH.slice(ownerEnd)}`,
	);
	ok(
		"[QK:CLI-HELP-REAL-OWNER] S9j a described gate whose definition is left only as heredoc text is not a command: it leaves the inventory and its description is an orphan",
		defined.names.has("check-peer-facts") &&
			textOnlyOwner.problems.length === 0 &&
			!textOnlyOwner.names.has("check-peer-facts") &&
			orphansOf(new Set([...labels, ...textOnlyOwner.names])).includes("check-peer-facts"),
		JSON.stringify({ problems: textOnlyOwner.problems, stillDefined: textOnlyOwner.names.has("check-peer-facts") }),
	);

	// The commands that had no line in the ce92dc7 usage, computed from that commit's run.sh with
	// the reader above. The set only shrinks: a new command arrives with its description, and a
	// described debt name leaves this list in the same change.
	const DESCRIPTION_DEBT = new Set([
		"check-acp-backend-preflight",
		"check-acp-carrier-augment",
		"check-acp-config",
		"check-acp-cortex",
		"check-acp-event-mapper",
		"check-acp-foreground-only",
		"check-acp-launch-namespace",
		"check-acp-overlay",
		"check-acp-prompt-builder",
		"check-acp-prompt-lifecycle",
		"check-acp-provider-surface",
		"check-acp-sdk-surface",
		"check-acp-session-reuse",
		"check-acp-session-store",
		"check-acp-set-model-readback",
		"check-acp-stop-reason",
		"check-acp-stream-hooks",
		"check-acp-tool-surface",
		"check-acp-usage-accounting",
		"check-acp-vendor-rejection",
		"check-agent-guidance-beside",
		"check-auth-boundary",
		"check-cc-retire-pidfd",
		"check-cc-retire-request",
		"check-claude-floor-coherence",
		"check-control-retire",
		"check-control-send-receipt",
		"check-control-socket-path",
		"check-entwurf-control-rpc",
		"check-entwurf-resume-args",
		"check-entwurf-v2-native-push",
		"check-entwurf-v2-production",
		"check-entwurf-v2-retire",
		"check-entwurf-v2-runner",
		"check-entwurf-v2-send",
		"check-entwurf-v2-surface",
		"check-entwurf-v2-visible-resume",
		"check-env-namespace",
		"check-fresh-call-dispatch",
		"check-fresh-call-provider",
		"check-herdr-fresh-call",
		"check-herdr-sandbox",
		"check-herdr-supply",
		"check-install-preflight",
		"check-install-surface",
		"check-mux-fresh-call",
		"check-mux-launch",
		"check-mux-launch-tmux",
		"check-mux-placement",
		"check-mux-placement-tmux",
		"check-omp-receive-arm",
		"check-pack-win32-carrier",
		"check-pi-import-surface",
		"check-pi-launch",
		"check-pi-preflight",
		"check-pi-queue-oracle",
		"check-pi-retire-request",
		"check-pi-runtime-version",
		"check-probe-bridge-command",
		"check-retirement-event",
		"check-tests-beside-behavior",
		"check-win32-preview",
		"doctor-pi-provider",
		"expose-dev-bin",
		"remove-dev-bin",
		"smoke-acp-bundled-mcp-live",
		"smoke-acp-carrier-augment-live",
		"smoke-acp-cortex-live",
		"smoke-acp-long-turn-live",
		"smoke-acp-mcp-live",
		"smoke-acp-memory-containment-live",
		"smoke-acp-ordering-probe-live",
		"smoke-acp-overlay-live",
		"smoke-acp-provider-live",
		"smoke-acp-raw-turn-live",
		"smoke-acp-rgg-live",
		"smoke-acp-session-reuse-live",
		"smoke-acp-skill-live",
		"smoke-acp-socket-citizen-live",
		"smoke-acp-v2-send-live",
		"smoke-herdr-fresh-call-live",
		"smoke-herdr-plugin-build-live",
		"smoke-herdr-raw-install-live",
		"smoke-mux-fresh-call-live",
		"smoke-omp-receive-state",
		"smoke-pi-provider-state",
		"wire-agy-bridge",
		"wire-agy-hooks",
		"wire-agy-statusline",
	]);
	const undescribed = [...inventory].filter((n) => !described.includes(n));
	const newDebt = undescribed.filter((n) => !DESCRIPTION_DEBT.has(n));
	const paid = [...DESCRIPTION_DEBT].filter((n) => !undescribed.includes(n));
	ok(
		`[QK:CLI-HELP-DEBT-EXACT] S9k the commands with no description are exactly the ${DESCRIPTION_DEBT.size} the ce92dc7 usage already lacked`,
		newDebt.length === 0 && paid.length === 0,
		[
			newDebt.length ? `no description in ${CLI_JSON}: ${newDebt.join(", ")}` : "",
			paid.length ? `described or removed — drop from DESCRIPTION_DEBT: ${paid.join(", ")}` : "",
		]
			.filter(Boolean)
			.join("\n"),
	);
	// ── the help preflight, proven on a copy that cannot dispatch ─────────────────────────
	// A byte copy of run.sh with one line added right before the unchanged case: whatever gets past
	// the preflight stops there (stderr DISPATCHED, exit 97) instead of entering an arm, so every
	// command can be asked safely. The bare root forms and the Unknown path go through that case and
	// are S9a's, on the real file. Expected pages are built from the entry the data holds; what is
	// compared is the output of the whole run.sh path — routing and format, not content, which the
	// root and fresh-cut fixtures bind.
	const VENDORS = ["pi", "pi-durable", "copilot", "codex-app-server"];
	type Entry = { synopsis: string; summary: string; details?: string[] };
	const entryOf = new Map<string, Entry>();
	for (const g of (JSON.parse(cliBytes) as { usage: { commandGroups: Entry[][] } }).usage.commandGroups)
		for (const e of g) entryOf.set(e.synopsis.split(" ", 1)[0] as string, e);
	const page = (e: Entry): string =>
		`${[`Usage: entwurf ${e.synopsis}`, "", e.summary, ...(e.details ? ["", ...e.details] : [])].join("\n")}\n`;
	const gated = mkdtempSync(path.join(os.tmpdir(), "entwurf-help-preflight-"));
	try {
		const copy = path.join(gated, "run.sh");
		writeFileSync(copy, RUN_SH.replace(`\n${CASE_LINE}`, `\necho DISPATCHED >&2; exit 97\n${CASE_LINE}`));
		stageHelp(gated);
		const run = (argv: string[], env: Record<string, string> = helpEnv) =>
			spawnSync("bash", [copy, ...argv], { cwd: gated, encoding: "utf8", env });
		type R = ReturnType<typeof run>;
		const dispatched = (r: R): boolean => r.status === 97 && r.stderr === "DISPATCHED\n" && r.stdout === "";
		const refused = (r: R): boolean =>
			r.status === 2 && r.stdout === "" && /^entwurf: [^\n]*\n$/.test(r.stderr) && !r.stderr.includes("DISPATCHED");
		const answers =
			(name: string) =>
			(r: R): boolean => {
				const e = entryOf.get(name);
				return e !== undefined && r.status === 0 && r.stderr === "" && r.stdout === page(e);
			};
		const show = (argv: string[], r: R): string =>
			`${JSON.stringify(argv)}: rc=${r.status} stdout=${r.stdout.length}B stderr=${JSON.stringify(r.stderr.slice(0, 160))}`;

		// Axis 1 — every command run.sh has, asked `--help`, one run each, in order.
		const t0 = Date.now();
		const bad = { described: [] as string[], undescribed: [] as string[], vendor: [] as string[] };
		const count = { described: 0, undescribed: 0, vendor: 0 };
		for (const name of [...inventory].sort()) {
			const argv = [name, "--help"];
			const r = run(argv);
			if (VENDORS.includes(name)) {
				count.vendor++;
				if (!dispatched(r)) bad.vendor.push(show(argv, r));
			} else if (entryOf.has(name)) {
				count.described++;
				if (!answers(name)(r)) bad.described.push(show(argv, r));
			} else {
				count.undescribed++;
				if (!(refused(r) && r.stderr.includes(JSON.stringify(name)))) bad.undescribed.push(show(argv, r));
			}
		}
		const axisSeconds = ((Date.now() - t0) / 1000).toFixed(1);
		ok(
			`[QK:CLI-HELP-COMMAND] S9l every described command answers \`<command> --help\` with its own page on stdout, exit 0, nothing on stderr, and no arm entered (${count.described} commands, axis ${axisSeconds}s)`,
			count.described > 0 && bad.described.length === 0,
			bad.described.join("\n"),
		);
		ok(
			`[QK:CLI-HELP-NO-DISPATCH] S9m every undescribed command asked \`--help\` is refused (one stderr line naming it, exit 2) and never run (${count.undescribed} commands)`,
			count.undescribed > 0 && bad.undescribed.length === 0,
			bad.undescribed.join("\n"),
		);

		// Axis 2 — the other shapes, on a few representative names.
		const debtGate = [...DESCRIPTION_DEBT].find((n) => defined.names.has(n) && !VENDORS.includes(n)) as string;
		const shapes = (cells: [string[], (r: R) => boolean][]): string[] =>
			cells.flatMap(([argv, judge]) => {
				const r = run(argv);
				return judge(r) ? [] : [show(argv, r)];
			});
		const formsBad = shapes([
			[["peer-facts", "-h"], answers("peer-facts")],
			[["help", "peer-facts"], answers("peer-facts")],
			[["help", "meta-bridge-fresh-cut"], answers("meta-bridge-fresh-cut")],
			[["help", "copilot"], answers("copilot")],
			[["help", debtGate], refused],
			[["help", "pi"], answers("pi")],
			[["help", "no-such-command"], refused],
			[["no-such-command", "--help"], refused],
		]);
		ok(
			"[QK:CLI-HELP-FORMS] S9n `help <command>` and `<command> -h` answer like `--help`; a vendor launcher's own entry answers `help`; an undescribed or unknown name is refused",
			formsBad.length === 0,
			formsBad.join("\n"),
		);
		const extraBad = shapes([
			[["peer-facts", "--help", "x"], refused],
			[["peer-facts", "-h", "x"], refused],
			[["help", "peer-facts", "x"], refused],
			[["help", "copilot", "x"], refused],
			[["help", "pi", "x"], refused],
			[[debtGate, "--help", "x"], refused],
		]);
		ok(
			"[QK:CLI-HELP-EXTRA-REFUSED] S9o a help form with more argv after it is refused, exit 2, and runs nothing",
			extraBad.length === 0,
			extraBad.join("\n"),
		);
		const aliasBad = shapes([
			[["--help", "peer-facts"], refused],
			[["-h", "peer-facts"], refused],
		]);
		ok(
			"[QK:CLI-HELP-ALIAS-REFUSED] S9p `--help <command>` / `-h <command>` are refused, not read as `help <command>`",
			aliasBad.length === 0,
			aliasBad.join("\n"),
		);
		const vendorBad = [
			...bad.vendor,
			...shapes([
				[["copilot", "--help", "x"], dispatched],
				[["pi", "-h", "x"], dispatched],
			]),
		];
		ok(
			`[QK:CLI-HELP-VENDOR-PASSTHROUGH] S9q the four vendor launchers keep every argv, help flags included: each reaches its arm (${count.vendor} of ${VENDORS.length})`,
			count.vendor === VENDORS.length && vendorBad.length === 0,
			vendorBad.join("\n"),
		);
		const positionBad = shapes([
			[["peer-facts", "x", "--help"], dispatched],
			[["peer-facts", "--", "--help"], dispatched],
		]);
		ok(
			"[QK:CLI-HELP-NOT-HELP-POSITION] S9r a help flag anywhere but right after the command, or after `--`, is not a help request: it reaches the dispatch as before",
			positionBad.length === 0,
			positionBad.join("\n"),
		);
		const odd = "bad\nname\u0007";
		const oddRun = run(["help", odd]);
		ok(
			"[QK:CLI-HELP-ONE-LINE] S9s an unknown name with a newline and a control character is quoted onto one stderr line",
			refused(oddRun) && oddRun.stderr.includes(JSON.stringify(odd)),
			show(["help", odd], oddRun),
		);

		// What a command help starts, among the watched PATH tools: node on the renderer, asked for that
		// one command, and nothing else.
		const { bin, trace } = makeShims(gated, `exec '${process.execPath}' "$@"`);
		for (const argv of [
			["peer-facts", "--help"],
			["help", "peer-facts"],
		])
			run(argv, { PATH: `${bin}:${helpEnv.PATH}` });
		const traced = readFileSync(trace, "utf8");
		ok(
			"[QK:CLI-HELP-COMMAND-TRACE] S9t observed on peer-facts in both forms (`--help`, `help`): of the watched PATH tools, only node on scripts/cli-help.mjs --command peer-facts starts",
			traced === `node ${path.join(gated, CLI_RENDERER)} --command peer-facts\n`.repeat(2),
			`trace:\n${traced}`,
		);
	} finally {
		rmSync(gated, { recursive: true, force: true });
	}

	// fresh-cut's longer text: kept whole as the ce92dc7 source literal of its usage() (the template
	// slots filled with the constants it named) — read from the source, not captured from a run. The
	// details carry it with one explicit amendment: the two lines that named the old `node
	// --experimental-strip-types` invocation and the blank line after them, which the synopsis
	// `entwurf meta-bridge-fresh-cut` replaces. Nothing else is trimmed. The exit numbers are checked
	// against the constant the verb itself returns, here in the gate only.
	const FC_FIXTURE = "test/fixtures/cli-help/fresh-cut-usage-ce92dc7.source-literal.txt";
	const FC_SHA256 = "f31c766a64fc99705ce81cc413bc4eadc40edd8e031127551d92fa68a8ac35a2";
	const fcText = readFileSync(path.join(REPO, FC_FIXTURE), "utf8");
	if (sha256(fcText) !== FC_SHA256) throw new Error(`S9: ${FC_FIXTURE} is not the ce92dc7 source literal`);
	const fcLines = fcText.slice(0, -1).split("\n"); // the file's final LF is framing, not a line
	const invocationDropped =
		fcLines[0]?.startsWith("usage: node --experimental-strip-types ") === true &&
		fcLines[1]?.trimStart().startsWith("(dev clone:") === true &&
		fcLines[2] === "";
	const fcDetails = entryOf.get("meta-bridge-fresh-cut")?.details ?? [];
	const exitMarks: [keyof typeof FRESH_CUT_EXIT, string][] = [
		["COMPLETE", "cut complete:"],
		["NO_MOVE", "NOTHING MOVED:"],
		["USAGE", "usage."],
		["HALF_CUT", "CUT TRANSITION INCOMPLETE:"],
		["CLEANUP_INCOMPLETE", "CUT COMPLETE, CLEANUP INCOMPLETE:"],
	];
	const exitsAgree = exitMarks.every(
		([k, mark]) => fcDetails.filter((l) => l.startsWith(`  ${FRESH_CUT_EXIT[k]}  ${mark}`)).length === 1,
	);
	ok(
		"[QK:CLI-HELP-DETAILS-ORACLE] S9u fresh-cut's details are its ce92dc7 usage text minus only the old invocation lines, and every exit number is the one FRESH_CUT_EXIT returns",
		invocationDropped && JSON.stringify(fcDetails) === JSON.stringify(fcLines.slice(3)) && exitsAgree,
		`details=${fcDetails.length} lines, oracle=${fcLines.length - 3} lines, exits agree=${exitsAgree}`,
	);

	// A reader that stops early (`entwurf --help | head`) closes the pipe. Adopted as a UX amendment:
	// that ends the page quietly with exit 0 — a stated choice, not a claim about what the old `cat`
	// returned. pipefail is on and both sides' statuses are read back, so the producer's 0 is seen,
	// not hidden behind head's.
	const piped = spawnSync(
		"bash",
		[
			"-c",
			`set -o pipefail; bash '${path.join(REPO, "run.sh")}' --help | head -c 1 >/dev/null; echo "\${PIPESTATUS[0]} \${PIPESTATUS[1]}"`,
		],
		{ cwd: REPO, encoding: "utf8", env: helpEnv },
	);
	ok(
		"[QK:CLI-HELP-EPIPE-QUIET] S9v `entwurf --help | head` ends without an error on stderr",
		piped.stderr === "",
		`stderr=${piped.stderr.slice(0, 200)}`,
	);
	ok(
		"[QK:CLI-HELP-EPIPE-EXIT] S9v' under pipefail, the help producer and head both end 0 when the reader stops early",
		piped.status === 0 && piped.stdout === "0 0\n",
		`rc=${piped.status} statuses=${JSON.stringify(piped.stdout)}`,
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
