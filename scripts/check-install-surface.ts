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
 *   S1  run.sh reaches .ts ONLY through run_ts (one fence, one place).
 *   S2  every operator subcommand (one that is neither a check- nor a smoke- gate) that
 *       runs a .ts has a compiled twin declared in tsconfig.build.json — the exact miss
 *       that killed the three.
 *   S3  every npm bin shell wrapper that execs a .ts carries the node_modules branch.
 *   S4  dev-only gates are NOT emitted — the tarball ships operator surfaces, not 70+
 *       gate leaves (a build bloat regression is as real as a missing artifact).
 *   S5  offline verification never writes the operator's own installed state: a smoke
 *       that reads $HOME must isolate it, or a "test" run silently rewires the live host.
 *
 * Read-only: parses sources, spawns nothing.
 */

import { readdirSync, readFileSync } from "node:fs";
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

/** subcommand → the .ts it runs, by walking `case` labels down to their run_ts call. */
function subcommandTargets(): Map<string, string> {
	const map = new Map<string, string>();
	let current: string | null = null;
	for (const { line } of runShCodeLines()) {
		const label = line.match(/^\s{2}([a-z][a-z0-9-]*)\)\s*$/);
		if (label) current = label[1] as string;
		const call = line.match(/run_ts\s+scripts\/([a-z0-9-]+)\.ts/);
		if (call && current) map.set(current, call[1] as string);
	}
	return map;
}

const targets = subcommandTargets();
const isDevGate = (cmd: string): boolean => cmd.startsWith("check-") || cmd.startsWith("smoke-");
const operatorCmds = [...targets].filter(([cmd]) => !isDevGate(cmd));

{
	const dead = operatorCmds.filter(([, ts]) => !emitted.has(ts));
	ok(
		`S2: every operator subcommand has a compiled twin (${operatorCmds.length} operator surfaces)`,
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

	const bloat = [...targets].filter(([cmd, ts]) => isDevGate(cmd) && emitted.has(ts));
	ok(
		"S4: dev-only gates are not emitted into the tarball",
		bloat.length === 0,
		bloat.map(([cmd, ts]) => `'${cmd}' is a dev gate but scripts/${ts}.ts is in the build include`).join("\n"),
	);
}

// ─── S3 — npm bin wrappers that exec .ts carry the node_modules branch ───────────────
{
	const offenders: string[] = [];
	for (const rel of Object.values(PACKAGE_JSON.bin ?? {})) {
		if (!rel.endsWith(".sh")) continue;
		const src = readFileSync(path.join(REPO, rel), "utf8");
		const execsTs = /--experimental-strip-types[^\n]*\.ts|\.ts"?\s*$/m.test(src) && /\.ts/.test(src);
		if (!execsTs) continue; // python3/JS-only wrappers (the statuslines) never hit the fence
		if (!/node_modules\/\*/.test(src)) offenders.push(rel);
	}
	ok(
		"S3: every npm bin wrapper that execs a .ts branches on node_modules",
		offenders.length === 0,
		offenders.map((f) => `${f} execs a .ts with no */node_modules/* branch — it dies when installed`).join("\n"),
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
	const WRITE_TO_LIVE = new RegExp(
		// `rm -rf "$HOME/.claude/..."` / `mkdir -p ~/.pi/...` / `... > "$HOME/.gemini/..."`
		String.raw`(?:(?:${MUTATORS})\s+(?:-\w+\s+)*["']?${LIVE_ROOTS}|>>?\s*["']?${LIVE_ROOTS})`,
	);

	// The install smokes DO write "$HOME/.claude/…" — legally, because they first swap the
	// process HOME to a sandbox (`export HOME="$TMP/home"`), after which $HOME no longer
	// names the operator's home at all. So the offense is not "writes $HOME"; it is writing
	// a live path while $HOME still points at the real one: either with no swap in the file,
	// or on a line that runs BEFORE the swap.
	const offenders: { file: string; line: number; text: string }[] = [];
	for (const f of readdirSync(path.join(REPO, "scripts"))) {
		if (!/^(smoke|check)-.*\.sh$/.test(f) || LIVE_GATES.has(f)) continue;
		const lines = readFileSync(path.join(REPO, "scripts", f), "utf8").split("\n");
		const swapAt = lines.findIndex((l) => /^\s*export\s+HOME=/.test(l) && !/(\$HOME|~)\//.test(l));
		lines.forEach((line, i) => {
			if (/^\s*#/.test(line)) return;
			if (!WRITE_TO_LIVE.test(line)) return;
			const sandboxed = swapAt !== -1 && i > swapAt;
			if (!sandboxed) offenders.push({ file: f, line: i + 1, text: line.trim() });
		});
	}
	ok(
		"S5: offline smokes never write the real $HOME (verification cannot uninstall the operator)",
		offenders.length === 0,
		offenders.map((o) => `scripts/${o.file}:${o.line} mutates the operator's live install:\n  ${o.text}`).join("\n"),
	);
}

console.log(
	failed === 0
		? "\ncheck-install-surface: install surface is structurally fenced"
		: `\ncheck-install-surface: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
