// Deterministic gate — the Claude ACP child launches under a name entwurf OWNS.
//
// WHY THIS IS A GATE AND NOT A COMMENT (#72). The vendor bin is called
// `claude-agent-acp`, and that name belongs to the package, not to us: any
// harness on the host spawning the same package produces a process with the
// same name. On GLG's oracle host a janitor installed for a DIFFERENT harness
// selects `claude-agent-acp` by argv SUBSTRING and SIGTERMs anything older than
// 900s. Because entwurf RETAINS its child across turns, its age is the age of
// the session — 12 of 12 anomalous terminations across two boots were that
// janitor (receipts: scripts/raw-acp-child-exit-measure/README.md §ANSWERED).
//
// The defense is a launcher whose own name carries no vendor substring. That is
// a property of a STRING, which is exactly the kind of thing that rots silently
// under a rename or a "harmless" revert — hence a gate that fails loudly.
//
// The second half matters as much: the launcher must remain TRANSPARENT. The
// vendor reads `--cli` / `--version` from `process.argv` and builds its own
// re-invocation command from `process.argv.slice(1)`. A launcher that consumed
// a flag of its own, or failed to start the vendor at all, would trade one
// silent breakage for another — so we RUN it and require the vendor to answer.

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { rmdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The substring the janitor matches on — the thing our launch argv must not contain. */
const VENDOR_PROCESS_MATCHER = "claude-agent-acp";

const TMP_EMIT = ".tmp-verify/acp-launch-namespace";
rmSync(TMP_EMIT, { recursive: true, force: true });
try {
	execFileSync("node_modules/.bin/tsc", ["--outDir", TMP_EMIT, "--rootDir", ".", "--noEmit", "false"], {
		stdio: "pipe",
	});
	const adapterUrl = pathToFileURL(resolve(TMP_EMIT, "pi-extensions/lib/acp/backend-adapter.js")).href;
	const mod = (await import(adapterUrl)) as {
		claudeAdapter: {
			resolveLaunch: (p: { cwd: string; modelId: string; nativeModelId: string; config: unknown }) => {
				command: string;
				args: string[];
			};
		};
	};

	const launch = mod.claudeAdapter.resolveLaunch({
		cwd: process.cwd(),
		modelId: "claude-sonnet-5",
		nativeModelId: "claude-sonnet-5",
		config: {},
	});

	// ----------------------------------------------------------------------
	// The claim: nothing a name-matching janitor scans contains the vendor name.
	// We check the WHOLE argv the way `ps` presents it, because that is what the
	// janitor's awk actually reads — not just the basename.
	// ----------------------------------------------------------------------
	const psLine = [launch.command, ...launch.args].join(" ");
	assert.ok(
		!psLine.includes(VENDOR_PROCESS_MATCHER),
		`[QK:CLAUDE-LAUNCH-IS-NAMESPACED] the default Claude ACP launch must not put "${VENDOR_PROCESS_MATCHER}" anywhere ` +
			"in its argv: a janitor installed for another harness selects that substring by age and SIGTERMs it, which is " +
			`the whole of #72. Got: ${JSON.stringify(psLine)}`,
	);
	assert.ok(
		launch.args.length === 1 && launch.args[0].endsWith("claude-acp-launch.js"),
		"the default launch is the entwurf-owned launcher and NOTHING else — an extra argv entry would be a flag of our " +
			`own, which the vendor's argv.slice(1) self-reinvocation cannot survive. Got: ${JSON.stringify(launch.args)}`,
	);

	// ----------------------------------------------------------------------
	// The launcher must still BE the vendor. A name split that stopped starting
	// the agent would pass every string assertion above and ship a dead backend,
	// so run it and make the vendor answer through it.
	// ----------------------------------------------------------------------
	const version = execFileSync(process.execPath, [...launch.args, "--version"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 60_000,
	}).trim();
	assert.match(
		version,
		/^\d+\.\d+\.\d+/,
		"[QK:CLAUDE-LAUNCH-IS-TRANSPARENT] the launcher must pass argv through untouched and start the real vendor — " +
			`\`--version\` has to reach it and answer. Got: ${JSON.stringify(version)}`,
	);

	// ----------------------------------------------------------------------
	// The debug override is an EXPLICIT operator choice and must stay literal:
	// an operator who names their own command owns the result, including losing
	// the name split. Routing it through the launcher would silently overrule them.
	// ----------------------------------------------------------------------
	process.env.CLAUDE_AGENT_ACP_COMMAND = "echo overridden";
	try {
		const overridden = mod.claudeAdapter.resolveLaunch({
			cwd: process.cwd(),
			modelId: "claude-sonnet-5",
			nativeModelId: "claude-sonnet-5",
			config: {},
		});
		assert.deepEqual(
			[overridden.command, ...overridden.args],
			["bash", "-lc", "echo overridden"],
			"CLAUDE_AGENT_ACP_COMMAND must stay verbatim — the launcher is the DEFAULT, never an override of the operator",
		);
	} finally {
		delete process.env.CLAUDE_AGENT_ACP_COMMAND;
	}
} finally {
	rmSync(TMP_EMIT, { recursive: true, force: true });
	try {
		// A leftover EMPTY parent dir reads as IMPURE tree drift in the
		// qualification harness; a concurrent sibling gate's emit keeps it alive
		// and this rmdir simply fails.
		rmdirSync(".tmp-verify");
	} catch {
		// non-empty or already gone — fine either way
	}
}

console.log(
	"[check-acp-launch-namespace] ok — the default Claude ACP launch carries no vendor process name in its argv (so a " +
		"name-matching janitor installed for another harness cannot select it), is exactly the entwurf-owned launcher " +
		"with no flag of its own, still starts the real vendor through argv passed untouched, and leaves an explicit " +
		"CLAUDE_AGENT_ACP_COMMAND override verbatim",
);
