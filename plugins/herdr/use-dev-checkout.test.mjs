// Offline composition proof: real shell + real ledger reader/root policy,
// sandbox HOME/XDG; harness/build/install commands are explicit fake executables.
// This is not a host switch, package-consumer proof, or vendor-turn acceptance.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	ledgerBody,
	resolveActivationLayout,
	resolveComponentRoots,
	writeLedger,
} from "../../scripts/herdr-activation.mjs";
import { resolveRuntimeLayout } from "../../scripts/herdr-runtime.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ owned = true, corrupt = false } = {}) {
	const dir = mkdtempSync(path.join(tmpdir(), "entwurf-dev-return-"));
	roots.push(dir);
	const root = path.join(dir, "checkout");
	const home = path.join(dir, "home");
	const bin = path.join(dir, "bin");
	const log = path.join(dir, "commands.log");
	for (const sub of [".git", "node_modules", "scripts", "plugins/herdr"])
		mkdirSync(path.join(root, sub), { recursive: true });
	mkdirSync(home, { recursive: true });
	mkdirSync(bin);
	writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ name: "@junghanacs/entwurf", version: "0.35.0", type: "module" }),
	);
	writeFileSync(path.join(root, "pnpm-lock.yaml"), "fixture only\n");
	for (const name of ["herdr-activation.mjs", "herdr-runtime.mjs"])
		cpSync(path.join(REPO, "scripts", name), path.join(root, "scripts", name));
	cpSync(path.join(REPO, "plugins/herdr/use-dev-checkout.sh"), path.join(root, "plugins/herdr/use-dev-checkout.sh"));
	const env = {
		PATH: `${bin}:${process.env.PATH}`,
		HOME: home,
		XDG_DATA_HOME: path.join(home, "data"),
		XDG_STATE_HOME: path.join(home, "state"),
		XDG_CACHE_HOME: path.join(home, "cache"),
		PI_CODING_AGENT_DIR: path.join(home, "pi"),
		CLAUDE_CONFIG_DIR: path.join(home, "claude"),
		TEST_ROOT: root,
		TEST_LOG: log,
	};
	const runtime = resolveRuntimeLayout(env);
	const owner = path.join(runtime.activeDir, "node_modules/@junghanacs/entwurf");
	env.TEST_OWNER = owner;
	const fake = `#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
tag = ("owner:" if str(pathlib.Path(sys.argv[0]).parent) == os.environ["TEST_OWNER"] else "source:") if name == "run.sh" else name + ":"
line = tag + " ".join(args)
with open(os.environ["TEST_LOG"], "a") as f: f.write(line + "\\n")
if os.environ.get("TEST_FAIL") == line: sys.exit(7)
if name == "ps":
 counter = pathlib.Path(os.environ["TEST_LOG"]).with_suffix(".ps-count")
 count = int(counter.read_text()) + 1 if counter.exists() else 1
 counter.write_text(str(count))
 print(os.environ.get("TEST_PS_SECOND", "") if count == 2 and os.environ.get("TEST_PS_SECOND") else os.environ.get("TEST_PS", ""))
if name == "pi":
 if args == ["--list-models", "entwurf"] and os.environ.get("TEST_PLAIN_OLD"): print("entwurf unrelated-fixture-model 1M 128K yes yes")
 else: print("entwurf claude-opus-5 1M 128K yes yes\\nentwurf claude-sonnet-5 1M 128K yes yes")
if name == "herdr" and args[:2] == ["plugin", "list"]:
 print(json.dumps({"result":{"plugins":[{"source":{"kind":os.environ.get("TEST_LINK_KIND", "local")},"enabled":True,"plugin_root":os.environ["TEST_ROOT"] + "/plugins/herdr"}]}}))
`;
	for (const name of ["pnpm", "pi", "claude", "herdr", "ps"])
		writeFileSync(path.join(bin, name), fake, { mode: 0o755 });
	writeFileSync(path.join(root, "run.sh"), fake, { mode: 0o755 });
	writeFileSync(
		path.join(root, "scripts/dev-bin.sh"),
		'#!/usr/bin/env bash\nprintf "dev-bin:%s\\n" "$*" >> "$TEST_LOG"\n',
		{ mode: 0o755 },
	);
	writeFileSync(
		path.join(root, "scripts/meta-bridge-store-doctor.ts"),
		'if (process.env.TEST_STORE_FAIL) process.exit(3); console.log("fixture store certified");\n',
	);
	if (owned) {
		mkdirSync(owner, { recursive: true });
		writeFileSync(path.join(owner, "run.sh"), fake, { mode: 0o755 });
		const layout = resolveActivationLayout(env);
		writeLedger(
			layout,
			ledgerBody({
				phase: "active",
				runtimeRoot: runtime.activeDir,
				artifactIdentity: {
					kind: "npm",
					name: "@junghanacs/entwurf",
					version: "0.35.0",
					expectedIntegrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
					observedDigest: `sha256-${"ab".repeat(32)}`,
				},
				roots: resolveComponentRoots(env),
				states: { pi: "active", "claude-code": "active" },
			}),
		);
		if (corrupt) writeFileSync(layout.ledgerPath, "{broken");
	}
	return {
		root,
		owner,
		env,
		run(args = [], extra = {}) {
			return spawnSync("bash", [path.join(root, "plugins/herdr/use-dev-checkout.sh"), ...args], {
				env: { ...env, ...extra },
				encoding: "utf8",
				timeout: 15000,
			});
		},
		lines() {
			try {
				return readFileSync(log, "utf8").trim().split("\n");
			} catch (err) {
				if (err.code === "ENOENT") return [];
				throw err;
			}
		},
	};
}

// Public menu tests drive the REAL run.sh under a private PTY. Only the helper
// is stubbed here; its real shell/ledger composition is the separate suite below.
function menuFixture({ source = true } = {}) {
	const root = mkdtempSync(path.join(tmpdir(), "entwurf-dev-menu-"));
	roots.push(root);
	const home = path.join(root, "home");
	mkdirSync(home);
	cpSync(path.join(REPO, "run.sh"), path.join(root, "run.sh"));
	const log = path.join(root, "calls.log");
	if (source) {
		mkdirSync(path.join(root, ".git"));
		mkdirSync(path.join(root, "plugins/herdr"), { recursive: true });
		writeFileSync(
			path.join(root, "plugins/herdr/use-dev-checkout.sh"),
			'#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$MENU_LOG"\nif [ "$1" = --check ]; then exit "${MENU_CHECK_RC:-0}"; fi\nexit "${MENU_APPLY_RC:-0}"\n',
		);
	}
	const env = {
		PATH: process.env.PATH,
		HOME: home,
		XDG_DATA_HOME: path.join(home, "data"),
		XDG_STATE_HOME: path.join(home, "state"),
		XDG_CACHE_HOME: path.join(home, "cache"),
		PI_CODING_AGENT_DIR: path.join(home, "pi"),
		CLAUDE_CONFIG_DIR: path.join(home, "claude"),
		MENU_LOG: log,
	};
	const driver = `import os, subprocess, sys
master, slave = os.openpty()
p = subprocess.Popen(["bash", sys.argv[1], "menu", *sys.argv[3:]], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
os.close(slave)
try:
 os.write(master, sys.argv[2].encode())
 try: out, err = p.communicate(timeout=10)
 except subprocess.TimeoutExpired:
  p.kill()
  p.communicate()
  raise
 sys.stdout.write(out)
 sys.stderr.write(err)
 sys.exit(p.returncode)
finally: os.close(master)
`;
	return {
		run(input, extra = {}, args = []) {
			return spawnSync("python3", ["-c", driver, path.join(root, "run.sh"), input, ...args], {
				env: { ...env, ...extra },
				encoding: "utf8",
				timeout: 15000,
			});
		},
		pipe() {
			return spawnSync("bash", [path.join(root, "run.sh"), "menu"], { env, encoding: "utf8", input: "2\nDEV\n" });
		},
		lines() {
			try {
				return readFileSync(log, "utf8").trim().split("\n");
			} catch (err) {
				if (err.code === "ENOENT") return [];
				throw err;
			}
		},
	};
}

describe("public run.sh developer menu", () => {
	it("can quit without invoking the helper", () => {
		const f = menuFixture();
		const result = f.run("0\n");
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain("developer board");
		expect(f.lines()).toEqual([]);
	});
	it("offers a read-only readiness check", () => {
		const f = menuFixture();
		expect(f.run("1\n").status).toBe(0);
		expect(f.lines()).toEqual(["--check"]);
	});
	it("requires exact DEV confirmation before apply [QK:DEV-MENU-EXPLICIT-CONFIRM]", () => {
		for (const confirmation of ["", "dev", "yes", "DEV "]) {
			const f = menuFixture();
			const result = f.run(`2\n${confirmation}\n`);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain("menu-cancelled");
			expect(f.lines()).toEqual(["--check"]);
		}
	});
	it("invokes the same helper's apply only after readiness and DEV", () => {
		const f = menuFixture();
		expect(f.run("2\nDEV\n").status).toBe(0);
		expect(f.lines()).toEqual(["--check", "--apply"]);
	});
	it("stops at a busy or otherwise refused readiness check", () => {
		const f = menuFixture();
		expect(f.run("2\nDEV\n", { MENU_CHECK_RC: "3" }).status).toBe(3);
		expect(f.lines()).toEqual(["--check"]);
	});
	it("preserves apply failure without retrying", () => {
		const f = menuFixture();
		expect(f.run("2\nDEV\n", { MENU_APPLY_RC: "7" }).status).toBe(7);
		expect(f.lines()).toEqual(["--check", "--apply"]);
	});
	it("rejects piped selections even when they contain DEV", () => {
		const f = menuFixture();
		const result = f.pipe();
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("menu-tty-required");
		expect(f.lines()).toEqual([]);
	});
	it("names the source-only refusal outside a checkout", () => {
		const f = menuFixture({ source: false });
		const result = f.run("2\nDEV\n");
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("developer-checkout-source-only");
		expect(f.lines()).toEqual([]);
	});
	it("refuses unknown selection and extra arguments without calling the helper", () => {
		const f = menuFixture();
		expect(f.run("9\n").status).toBe(2);
		expect(f.run("2\nDEV\n", {}, ["--apply"]).status).toBe(2);
		expect(f.lines()).toEqual([]);
	});
});

describe("developer checkout return composition", () => {
	it("has valid shell syntax", () => {
		execFileSync("bash", ["-n", path.join(REPO, "plugins/herdr/use-dev-checkout.sh")]);
	});
	it("defaults to a read-only check", () => {
		const f = fixture();
		const result = f.run();
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("check only");
		expect(result.stdout).toContain("limited readiness");
		expect(result.stdout).toContain("writer can still refuse after deactivation");
		expect(f.lines()).toEqual(["ps:-eo pid=,args="]);
	});
	it("refuses a root-bound old process before any build or wiring", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_PS: `123 node ${f.owner}/mcp/bridge.js` });
		expect(result.status).toBe(3);
		expect(result.stderr).toContain("old-runtime-in-use");
		expect(result.stderr).toContain("STOP at preflight (exit 3)");
		expect(f.lines()).toEqual(["ps:-eo pid=,args="]);
	});
	it("a malformed ledger refuses without any command mutation", () => {
		const f = fixture({ corrupt: true });
		const result = f.run(["--apply"]);
		expect(result.status).not.toBe(0);
		expect(f.lines()).toEqual([]);
	});
	it("a broken build leaves the old owner intact", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_FAIL: "pnpm:run build-bridge" });
		expect(result.status).toBe(7);
		expect(result.stderr).toContain("prepare-checkout");
		expect(f.lines()).not.toContain("owner:herdr-plugin-deactivate");
	});
	it("an uncertifiable store blocks preparation and teardown", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_STORE_FAIL: "1" });
		expect(result.status).toBe(3);
		expect(f.lines()).toEqual(["ps:-eo pid=,args="]);
	});
	it("[QK:HERDR-DEV-PREPARE-BEFORE-TEARDOWN] proves preparation before the old owner is removed, never install/setup/takeover or a turn", () => {
		const f = fixture();
		const result = f.run(["--apply"]);
		expect(result.status, result.stderr).toBe(0);
		const lines = f.lines();
		const deact = lines.indexOf("owner:herdr-plugin-deactivate");
		const build = lines.indexOf("pnpm:run build-bridge");
		const bridge = lines.indexOf("source:check-bridge");
		const sourceModels = lines.indexOf(
			`pi:--no-extensions -e ${f.root}/pi-extensions/acp-provider.ts --list-models entwurf`,
		);
		for (const index of [deact, build, bridge, sourceModels]) expect(index).toBeGreaterThanOrEqual(0);
		expect(bridge).toBeGreaterThan(build);
		expect(sourceModels).toBeGreaterThan(bridge);
		expect(deact).toBeGreaterThan(sourceModels);
		expect(lines.indexOf(`source:install ${f.root}`)).toBeGreaterThan(deact);
		expect(lines.indexOf("source:install-meta-bridge")).toBeGreaterThan(deact);
		expect(lines.indexOf(`herdr:plugin link ${f.root}/plugins/herdr --enabled`)).toBeGreaterThan(
			lines.indexOf("source:install-meta-bridge"),
		);
		expect(lines.filter((line) => line.startsWith("pi:")).every((line) => line.includes("--list-models"))).toBe(true);
		expect(lines.join("\n")).not.toMatch(/plugin install|takeover|source:setup|--model /);
	});
	it("[QK:HERDR-DEV-RECHECK-BEFORE-TEARDOWN] newly busy old runtime during preparation stops before deactivation or wiring", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_PS_SECOND: `123 node ${f.owner}/mcp/bridge.js` });
		expect(result.status).toBe(3);
		expect(result.stderr).toContain("old-runtime-in-use");
		expect(result.stderr).toContain("STOP at prepare-checkout (exit 3)");
		expect(f.lines().filter((line) => line.startsWith("ps:"))).toHaveLength(2);
		expect(f.lines()).toContain("pnpm:run build-bridge");
		expect(f.lines()).not.toContain("owner:herdr-plugin-deactivate");
		expect(f.lines()).not.toContain(`source:install ${f.root}`);
		expect(f.lines().some((line) => line.startsWith("herdr:plugin link"))).toBe(false);
	});
	it("a failed preparation bridge proof keeps the old owner and wiring", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_FAIL: "source:check-bridge" });
		expect(result.status).toBe(7);
		expect(result.stderr).toContain("STOP at prepare-checkout");
		expect(f.lines()).not.toContain("owner:herdr-plugin-deactivate");
		expect(f.lines()).not.toContain(`source:install ${f.root}`);
	});
	it("an inverse failure stops before source wiring or Herdr linking", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_FAIL: "owner:herdr-plugin-deactivate" });
		expect(result.status).toBe(7);
		expect(f.lines()).not.toContain(`source:install ${f.root}`);
		expect(f.lines().some((line) => line.startsWith("herdr:plugin link"))).toBe(false);
	});
	it("supports an already-direct clean host without inventing an owner", () => {
		const f = fixture({ owned: false });
		const result = f.run(["--apply"]);
		expect(result.status, result.stderr).toBe(0);
		expect(f.lines()).toContain("source:herdr-plugin-deactivate");
		expect(f.lines().some((line) => line.startsWith("owner:"))).toBe(false);
	});
	it("[QK:HERDR-DEV-NO-SUCCESS-ON-DRIFT] actual Pi model IDs must match the source provider before claiming success", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_PLAIN_OLD: "1" });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("actual Pi model IDs differ");
		expect(result.stdout).not.toContain("done:");
	});
	it("does not claim success when Herdr still names a GitHub plugin", () => {
		const f = fixture();
		const result = f.run(["--apply"], { TEST_LINK_KIND: "github" });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("Herdr plugin is not");
		expect(result.stdout).not.toContain("done:");
	});
});
