#!/usr/bin/env node
/**
 * check-remote-pair-installed — #107 rail 3: the remote pair on an INSTALLED package.
 *
 * `./run.sh check-remote-pair-installed --tgz <absolute candidate tarball>`
 *
 * Why this is a scripts/ gate and not a source-adjacent vitest test: its subject is an ARTIFACT.
 * It installs a caller-supplied tarball into a fresh consumer prefix with npm and then drives
 * that install's own processes (its bridge `start.sh` → compiled dist, its `run.sh` → run_ts →
 * compiled entry). A test beside the source can only reach the source.
 *
 * What it does, once, with every writable root (HOME, npm cache/userconfig, XDG, PI agent dir)
 * inside one temp sandbox:
 *   1. copies the given tarball into the sandbox and installs THAT copy (never repacks; the copy's
 *      sha256 is printed). npm reads the package's declared dependencies from the registry into the
 *      sandbox cache — a network read, but no model, no operator config and no ssh;
 *   2. checks the installed package carries the receive entry's compiled twin and the remote libs;
 *   3. runs the installed `entwurf remote-pair-receive` with wrong argv: usage on stderr, exit 2 —
 *      the compiled twin was reached through run_ts, not a TS crossing;
 *   4. runs the existing T2 scene (pi-extensions/lib/remote-pair-roundtrip.test.ts) with its subject
 *      switched to this install: real installed bridge, stand-in ssh → installed run.sh → installed
 *      entry → production dispatch, with the same mailbox/provenance/receipt/reverse-dispatch oracles;
 *   5. audits checkout invisibility: a preload resolve hook records every module each SUBJECT
 *      process resolves; every file must sit (by real path) inside the consumer prefix. The
 *      orchestrator (vitest + its fixture writer) is this checkout and is not audited;
 *   6. control: the same hook on this checkout's own `run.sh remote-pair-receive` must report a
 *      checkout path, so the audit can see the thing it refuses.
 *
 * The subject switch (ENTWURF_REMOTE_PAIR_INSTALLED_PKG and the resolve-hook variables) is set
 * here and only here: it changes what the T2 cells measure, so it must not be set ambiently.
 *
 * Mutation proof covers only the audit's acceptance primitive (scripts/lib/remote-pair-installed-audit.ts);
 * the install, compiled-surface, twin and roundtrip cells are actual-runtime evidence with the
 * checkout control, not mutation-qualified.
 *
 * Not claimed: the published npm artifact (this is whatever tarball the caller passes), real sshd,
 * a real remote host, a durable host reading or replying, or the check-pack/check-pack-install floor.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { filesOutsideRoot as outside } from "./lib/remote-pair-installed-audit.ts";

const LABEL = "check-remote-pair-installed";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--tgz" || !path.isAbsolute(args[1])) {
	console.error(`usage: ./run.sh ${LABEL} --tgz <absolute candidate tarball>`);
	process.exit(2);
}
const tgz = args[1];
if (!fs.lstatSync(tgz).isFile()) {
	console.error(`${LABEL}: --tgz must be a regular file (${tgz})`);
	process.exit(2);
}

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
	if (cond) {
		passed++;
		console.log(`  ok    ${label}`);
	} else {
		failed++;
		console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
	}
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-remote-pair-installed-"));
const consumer = path.join(sandbox, "consumer");
const npmHome = path.join(sandbox, "npm-home");
const logs = path.join(sandbox, "resolve-logs");
const hook = path.join(sandbox, "resolve-hook.mjs");
for (const d of [consumer, npmHome, logs]) fs.mkdirSync(d, { recursive: true });

function sandboxEnv(home: string): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH ?? "",
		HOME: home,
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_DATA_HOME: path.join(home, ".local", "share"),
		XDG_STATE_HOME: path.join(home, ".local", "state"),
		XDG_CACHE_HOME: path.join(home, ".cache"),
		PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"),
	};
}

fs.writeFileSync(
	hook,
	[
		'import { appendFileSync } from "node:fs";',
		'import { registerHooks } from "node:module";',
		"const log = process.env.ENTWURF_REMOTE_PAIR_RESOLVE_LOG;",
		"if (log) {",
		"\tregisterHooks({",
		"\t\tresolve(specifier, context, next) {",
		"\t\t\tconst r = next(specifier, context);",
		'\t\t\tappendFileSync(log, r.url + "\\n");',
		"\t\t\treturn r;",
		"\t\t},",
		"\t});",
		"}",
		"",
	].join("\n"),
);

function hookEnv(label: string): NodeJS.ProcessEnv {
	return { NODE_OPTIONS: `--import=${hook}`, ENTWURF_REMOTE_PAIR_RESOLVE_LOG: path.join(logs, `${label}.log`) };
}

// The artifact is a snapshot: copy the caller's file into the sandbox once, then hash and install
// THAT copy, so what is measured is exactly what is installed. Never repacked.
const snapshot = path.join(sandbox, "artifact", path.basename(tgz));
fs.mkdirSync(path.dirname(snapshot), { recursive: true });
fs.copyFileSync(tgz, snapshot);
const sha = createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex");
console.log(
	`[${LABEL}] caller tarball ${tgz}\n[${LABEL}] snapshot ${snapshot}\n[${LABEL}] snapshot sha256 ${sha}\n[${LABEL}] sandbox ${sandbox}`,
);

try {
	// 1. Install as-is.
	fs.writeFileSync(
		path.join(consumer, "package.json"),
		JSON.stringify({ name: "remote-pair-consumer", private: true }),
	);
	const npm = spawnSync("npm", ["install", snapshot, "--no-audit", "--no-fund"], {
		cwd: consumer,
		encoding: "utf8",
		env: {
			...sandboxEnv(npmHome),
			npm_config_cache: path.join(sandbox, "npm-cache"),
			npm_config_userconfig: path.join(npmHome, ".npmrc"),
		},
	});
	ok(
		"[QK:RPI-INSTALLED] npm installs the given tarball into a fresh consumer prefix",
		npm.status === 0,
		npm.stderr.slice(-800),
	);
	const pkg = path.join(consumer, "node_modules", "@junghanacs", "entwurf");
	const pkgStat = fs.existsSync(pkg) ? fs.lstatSync(pkg) : null;
	ok(
		"[QK:RPI-INSTALLED] the package is a real directory inside the consumer (not a link to a checkout)",
		pkgStat !== null && pkgStat.isDirectory() && !pkgStat.isSymbolicLink(),
	);
	if (failed) throw new Error("install failed; later cells would not measure the artifact");

	// 2. The compiled surface is in the package.
	for (const rel of [
		"mcp/entwurf-bridge/dist/scripts/remote-pair-receive.js",
		"mcp/entwurf-bridge/dist/pi-extensions/lib/remote-pair-receive.js",
		"mcp/entwurf-bridge/dist/pi-extensions/lib/remote-pair-send.js",
		"mcp/entwurf-bridge/dist/pi-extensions/lib/remote-pair-transport.js",
	]) {
		ok(`[QK:RPI-COMPILED-SURFACE] the installed package carries ${rel}`, fs.existsSync(path.join(pkg, rel)));
	}

	// 3. The installed bin reaches the compiled twin.
	const home = path.join(sandbox, "usage-home");
	const usage = spawnSync(path.join(pkg, "run.sh"), ["remote-pair-receive"], {
		encoding: "utf8",
		env: { ...sandboxEnv(home), ...hookEnv("installed-usage") },
	});
	ok(
		"[QK:RPI-INSTALLED-ENTRY-TWIN] the installed `entwurf remote-pair-receive` answers wrong argv with usage on stderr, exit 2, no receipt",
		usage.status === 2 && /usage: entwurf remote-pair-receive/.test(usage.stderr) && usage.stdout === "",
		`status=${usage.status} stdout=${usage.stdout.slice(0, 200)} stderr=${usage.stderr.slice(0, 300)}`,
	);

	// 4. The T2 scene against the install.
	const vitest = spawnSync(
		path.join(REPO, "node_modules", ".bin", "vitest"),
		["run", "pi-extensions/lib/remote-pair-roundtrip.test.ts"],
		{
			cwd: REPO,
			encoding: "utf8",
			env: {
				...process.env,
				ENTWURF_REMOTE_PAIR_INSTALLED_PKG: pkg,
				ENTWURF_REMOTE_PAIR_RESOLVE_HOOK: hook,
				ENTWURF_REMOTE_PAIR_RESOLVE_LOG_DIR: logs,
			},
		},
	);
	const summary = (vitest.stdout.match(/Tests\s+.*$/m) ?? [""])[0].trim();
	ok(
		"[QK:RPI-ROUNDTRIP-ON-INSTALL] the T2 cells (A→B, reverse dispatch, opt-in absent off, other host refuses, both socket dirs) pass against the installed bridge and entry",
		vitest.status === 0 && /^Tests\s+5 passed\b/.test(summary),
		`${summary}\n${vitest.stdout
			.split("\n")
			.filter((l) => /×|FAIL|Error/.test(l))
			.slice(0, 10)
			.join("\n")}`,
	);

	// 5. Checkout invisibility of the subject processes.
	const all = fs.readdirSync(logs).map((n) => path.join(logs, n));
	const bridgeLogs = all.filter((f) => path.basename(f).startsWith("bridge-"));
	const entryLogs = all.filter((f) => path.basename(f).startsWith("entry-"));
	const subjectLogs = [...bridgeLogs, ...entryLogs, ...all.filter((f) => path.basename(f) === "installed-usage.log")];
	ok(
		"[QK:RPI-AUDIT-SAW-SUBJECTS] the resolve hook recorded the installed bridge processes and the installed entry processes",
		bridgeLogs.some((f) => fs.statSync(f).size > 0) && entryLogs.some((f) => fs.statSync(f).size > 0),
		`bridge logs=${bridgeLogs.length} entry logs=${entryLogs.length}`,
	);
	const audit = outside(subjectLogs, consumer);
	ok(
		`[QK:RPI-CHECKOUT-INVISIBLE] every module the installed subject processes resolved (${audit.total}) sits inside the consumer prefix`,
		audit.total > 0 && audit.outside.length === 0,
		audit.outside.slice(0, 10).join("\n        "),
	);

	// 6. Control: the audit sees a checkout when there is one.
	const control = spawnSync(path.join(REPO, "run.sh"), ["remote-pair-receive"], {
		encoding: "utf8",
		env: { ...sandboxEnv(path.join(sandbox, "control-home")), ...hookEnv("control-checkout") },
	});
	const controlAudit = outside([path.join(logs, "control-checkout.log")], consumer);
	const realRepo = fs.realpathSync(REPO);
	ok(
		"[QK:RPI-AUDIT-CONTROL] the same audit on this checkout's own entry reports checkout paths (the detector is live)",
		control.status === 2 && controlAudit.outside.some((p) => p.startsWith(`${realRepo}${path.sep}`)),
		`status=${control.status} outside=${controlAudit.outside.length}`,
	);
} catch (err) {
	ok(`[${LABEL}] gate ran to completion`, false, err instanceof Error ? err.message : String(err));
} finally {
	// Synthetic fixture data only. Kept on failure so the resolve logs and npm output can be read.
	if (failed === 0) fs.rmSync(sandbox, { recursive: true, force: true });
	else console.log(`[${LABEL}] kept the sandbox for diagnosis: ${sandbox}`);
}

console.log(
	`\n${LABEL}: ${passed} passed, ${failed} failed — installed artifact ${sha.slice(0, 12)}; no real ssh, no model`,
);
process.exit(failed === 0 ? 0 : 1);
