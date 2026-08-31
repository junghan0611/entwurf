/**
 * check-omp-fresh-preflight — the agreement gate for the OMP fresh preflight's two reproduced
 * resolvers (#87 Bundle C).
 *
 * ── Why this gate exists at all ──
 *
 * `pi-extensions/lib/omp-fresh-preflight.ts` contains TWO functions that already existed
 * elsewhere in this repo, in another language:
 *
 *   `ompAgentDir`        reproduces `omp_agent_dir` from `scripts/omp-bridge-oracle.sh`
 *   `readOmpConfigFlag`  reproduces the `tools.xdev` half of `scripts/omp-tool-surface.py`
 *
 * They are reproductions rather than calls for a stated reason — the preflight runs inside the pi
 * extension AND inside the bundled MCP child, and resolving a sibling shell/python script by
 * relative path from two different emit depths is exactly the arithmetic
 * `check-capability-bundle-reach` exists to catch. But a reproduction is a second implementation,
 * and a second implementation that nothing compares is a divergence with a date on it: the shell
 * oracle changes for the installer's reasons, the preflight keeps answering the old way, and the
 * two halves of the omp lane start addressing different directories while both look correct.
 * `docs/adding-a-harness.md` step 3 names that failure by name.
 *
 * ── The oracle discipline this follows ──
 *
 * Step 1: "never the resolver under test". This gate never asks the TS half to confirm itself.
 * It drives the SHIPPED shell and python leaves — the ones the installer and the doctor actually
 * run — and requires the TS half to produce the same answer for the same input. When they
 * disagree the gate names which input separated them, because "they differ" is not something an
 * operator can act on.
 *
 * The environment matrix deliberately includes every REFUSAL the shell oracle has, not just the
 * happy path: the refusals are the load-bearing half (#87 ledger M6 — a pi-shaped env knob must
 * refuse rather than guess), and a TS half that resolved a directory where the shell refuses
 * would preflight green against a store no live omp reads.
 *
 * Pure + subprocess, no network, no model, no vendor spawn. Fixtures only — this gate never
 * reads the operator's real `~/.omp`.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ompAgentDir, readOmpConfigFlag } from "../pi-extensions/lib/omp-fresh-preflight.ts";

const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** The SHIPPED shell oracle, asked exactly the way the installer and the doctor ask it.
 * Returns the resolved absolute path, or `null` for the oracle's refusal (rc 1). */
function shellAgentDir(env: Record<string, string>): string | null {
	try {
		const out = execFileSync(
			"bash",
			["-c", `set -euo pipefail; . "${path.join(REPO_DIR, "scripts/omp-bridge-oracle.sh")}"; omp_agent_dir`],
			{ encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] },
		);
		return out.trim();
	} catch {
		return null;
	}
}

/** The SHIPPED python leaf's effective `tools.xdev` reading, reduced to the tri-state the
 * preflight consumes: explicitly false / effectively true / could not be read. */
function pythonXdev(agentDir: string): "false" | "true" | "unreadable" {
	const out = execFileSync("python3", [path.join(REPO_DIR, "scripts/omp-tool-surface.py"), agentDir], {
		encoding: "utf8",
	});
	const fields = new Map(
		out
			.split("\n")
			.filter((l) => l.trim() !== "")
			.map((l) => {
				const at = l.indexOf(" ");
				return [l.slice(0, at), l.slice(at + 1)] as [string, string];
			}),
	);
	if (fields.get("verdict") === "unreadable") return "unreadable";
	return fields.get("xdev") === "false" ? "false" : "true";
}

// ===========================================================================
// 1. Agent-dir agreement, refusals included.
// ===========================================================================
{
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-omp-oracle-"));
	try {
		const cases: Array<[label: string, env: Record<string, string>]> = [
			["plain host", { HOME: home }],
			["explicit ENTWURF_OMP_AGENT_DIR wins over everything", { HOME: home, ENTWURF_OMP_AGENT_DIR: `${home}/x` }],
			[
				"explicit override still wins beside a pi knob",
				{ HOME: home, ENTWURF_OMP_AGENT_DIR: `${home}/x`, PI_CODING_AGENT_DIR: "/elsewhere" },
			],
			["inherited PI_CODING_AGENT_DIR refuses", { HOME: home, PI_CODING_AGENT_DIR: "/elsewhere" }],
			["inherited PI_CONFIG_DIR refuses", { HOME: home, PI_CONFIG_DIR: ".pi" }],
			["PI_PROFILE with no OMP_PROFILE refuses", { HOME: home, PI_PROFILE: "work" }],
			["PI_PROFILE beside OMP_PROFILE resolves", { HOME: home, PI_PROFILE: "work", OMP_PROFILE: "work" }],
			["OMP_PROFILE moves the root", { HOME: home, OMP_PROFILE: "work" }],
			["OMP_PROFILE with a dot/dash is a valid name", { HOME: home, OMP_PROFILE: "a.b-c_1" }],
			["an uppercase OMP_PROFILE is refused", { HOME: home, OMP_PROFILE: "Work" }],
			["an OMP_PROFILE with a slash is refused", { HOME: home, OMP_PROFILE: "a/b" }],
			["an OMP_PROFILE starting with a dot is refused", { HOME: home, OMP_PROFILE: ".hidden" }],
		];
		for (const [label, env] of cases) {
			const shell = shellAgentDir(env);
			const ts = ompAgentDir(env);
			ok(
				`[QK:OMP-PREFLIGHT-AGENT-DIR-ORACLE] agent dir agrees with the shipped shell oracle — ${label} (shell=${shell ?? "REFUSE"}, ts=${ts ?? "REFUSE"})`,
				shell === ts,
			);
		}
		// An empty override is not an override: both halves must fall through to the default
		// rather than resolving the empty string into the process cwd.
		ok(
			"[QK:OMP-PREFLIGHT-AGENT-DIR-EMPTY-ENV] an empty ENTWURF_OMP_AGENT_DIR falls through in both halves instead of resolving to cwd",
			shellAgentDir({ HOME: home, ENTWURF_OMP_AGENT_DIR: "" }) ===
				ompAgentDir({ HOME: home, ENTWURF_OMP_AGENT_DIR: "" }),
		);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
}

// ===========================================================================
// 2. `tools.xdev` agreement over hand-written config shapes.
//
//    The corpus is what an operator actually types, including the shapes that
//    are NOT valid YAML — the fail-closed direction only matters on those, and a
//    corpus of well-formed files would never exercise it.
// ===========================================================================
{
	const CONFIGS: Array<[label: string, yaml: string | null]> = [
		["absent config file", null],
		["empty file", ""],
		["the operator's real shape", "tools:\n  xdev: false\n"],
		["xdev true", "tools:\n  xdev: true\n"],
		["tools section without xdev", "tools:\n  approvalMode: yolo\n"],
		["no tools section at all", "theme:\n  dark: titanium\n"],
		["xdev false with a trailing comment", "tools:\n  xdev: false # required by entwurf\n"],
		["xdev false among siblings", "tools:\n  approvalMode: yolo\n  xdev: false\n  timeout: 30\n"],
		["a later top-level section after tools", "tools:\n  xdev: false\nstatusLine:\n  separator: ascii\n"],
		["xdev quoted", 'tools:\n  xdev: "false"\n'],
		["xdev word form", "tools:\n  xdev: off\n"],
		["xdev at a deeper indent", "tools:\n    xdev: false\n"],
		["a nested xdev that is NOT tools.xdev", "tools:\n  nested:\n    xdev: false\n"],
		["a top-level xdev outside tools", "xdev: false\ntools:\n  approvalMode: yolo\n"],
		["tab indentation (not YAML for the vendor)", "tools:\n\txdev: false\n"],
		["broken flow scalar", "tools: [oops\n"],
		// The shape the VENDOR's own settings writer produces: `key:` on one line with an
		// indented flow collection under it. The python leaf's block-only reader returned
		// None for the WHOLE file here, so an untouched operator config classified as
		// `unreadable` and doctor-omp-mcp went RED for a reason unrelated to tools.xdev
		// (measured on a real host, omp 18.0.0). Agreement alone could never catch it —
		// both halves collapse `unreadable` and `true` into "not false" — so the direct
		// assertion below is the one that holds the reader to the vendor's own output.
		["the vendor's own writer output (empty flow map sibling)", "modelRoles: \n  {}\ntools: \n  xdev: false\n"],
		["a populated flow map sibling", "modelRoles: \n  {default: xai/grok}\ntools: \n  xdev: false\n"],
		["a flow sequence sibling", "disabledProviders: \n  [openrouter, google]\ntools: \n  xdev: false\n"],
	];
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-omp-xdev-"));
	try {
		for (const [label, yaml] of CONFIGS) {
			const dir = fs.mkdtempSync(path.join(root, "case-"));
			if (yaml !== null) fs.writeFileSync(path.join(dir, "config.yml"), yaml);
			const python = pythonXdev(dir);
			const ts = readOmpConfigFlag(dir, "tools", "xdev");
			// The preflight's question is narrower than the doctor's: it needs "is this provably
			// false?", so the python leaf's `unreadable` and `true` both map to "not false". That
			// collapse is the CONTRACT, not a looseness — the two states send an operator to the
			// same repair and the preflight refuses on both.
			const pythonSaysFalse = python === "false";
			ok(
				`[QK:OMP-PREFLIGHT-XDEV-ORACLE] tools.xdev agrees with the shipped python leaf — ${label} (python=${python}, ts=${String(ts)})`,
				pythonSaysFalse === (ts === false),
			);
		}
		// Agreement is not enough on the vendor's own shapes: two readers that BOTH fail
		// closed agree perfectly and still leave the doctor red on a healthy host. These
		// name the answer instead of comparing the halves.
		for (const [label, yaml] of CONFIGS) {
			if (
				!label.startsWith("the vendor's own writer output") &&
				!label.startsWith("a populated flow map") &&
				!label.startsWith("a flow sequence")
			)
				continue;
			const dir = fs.mkdtempSync(path.join(root, "vendor-"));
			fs.writeFileSync(path.join(dir, "config.yml"), yaml as string);
			ok(
				`[QK:OMP-XDEV-VENDOR-SHAPE-READABLE] the python leaf READS tools.xdev on ${label} — a flow collection elsewhere in the file is not an unreadable config`,
				pythonXdev(dir) === "false",
			);
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

console.log(`[check-omp-fresh-preflight] ${passed} assertions ok`);
