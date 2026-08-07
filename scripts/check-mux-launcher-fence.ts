/**
 * check-mux-launcher-fence — deterministic gate for the shared operator-launcher protection
 * (`scripts/lib/claude-launcher-fence.ts`) both mux LIVE smokes must consume (issue #67).
 *
 * The closed incident: a Claude child launched with real HOME + fixture XDG_DATA_HOME
 * self-updated into the fixture tree and rewrote the operator's real `claude` launcher to point
 * there; fixture teardown then deleted the tree and left the launcher dangling. Everything below
 * replants that shape into DISPOSABLE fixture paths only — a simulated "operator" bin/versions
 * tree and a simulated fixture cleanup root, both under one mkdtemp. The gate never inspects,
 * touches or even resolves the real operator launcher.
 *
 *   LAUNCHFENCE-PREFLIGHT-FAIL-CLOSED   the preflight refuses to pin a launcher whose resolved
 *                                       target already lives inside the fixture cleanup root
 *   LAUNCHFENCE-RETARGET-BLOCKS-CLEANUP a post-launch retarget into the fixture (the incident's
 *                                       exact end state: a dangling reference into a tree about
 *                                       to be deleted) makes the cleanup guard BLOCK removal
 *   LAUNCHFENCE-CONTENT-CHANGE-DETECTED an in-place rewrite of the resolved target — same path,
 *                                       same link — is still reported before cleanup
 *   LAUNCHFENCE-XDG-EXACT-RESTORE       a real-HOME Claude cell gets EXACT operator XDG parity:
 *                                       original values restored, absent variables DELETED,
 *                                       never filled with a canonical default
 *   LAUNCHFENCE-WIRED-LIFECYCLE         smoke-mux-lifecycle-live actually consumes the fence:
 *   LAUNCHFENCE-WIRED-FRESH-CALL        preflight + integrity oracle BEFORE fixture removal +
 *                                       removal gated on cleanup verdict AND tracked-pane
 *                                       quiescence + XDG parity, in each smoke's own source
 *   LAUNCHFENCE-LIFECYCLE-CELL-BRANCH   lifecycle keeps its two truthful cell branches: ACP pi
 *                                       retains the four MEASURED canonical REAL_XDG_* roots,
 *                                       the direct Claude cell gets exact-parity restore
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	assessLauncherCleanup,
	resolveFromPath,
	restoreOriginalXdg,
	snapshotClaudeLauncher,
	snapshotOriginalXdg,
	verifyClaudeLauncher,
} from "./lib/claude-launcher-fence.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

function refusal(fn: () => unknown): string {
	try {
		fn();
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
	return "";
}

function relink(link: string, target: string): void {
	fs.rmSync(link);
	fs.symlinkSync(target, link);
}

function main(): void {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-mux-launcher-fence-"));
	try {
		// ── a disposable stand-in for the operator's install: bin/claude → versions/1.0.0/claude ──
		const opBin = path.join(tmp, "operator", "bin");
		const opTarget = path.join(tmp, "operator", "versions", "1.0.0", "claude");
		fs.mkdirSync(opBin, { recursive: true });
		fs.mkdirSync(path.dirname(opTarget), { recursive: true });
		fs.writeFileSync(opTarget, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		const launcher = path.join(opBin, "claude");
		fs.symlinkSync(opTarget, launcher);
		const fixtureRoot = path.join(tmp, "fixture");
		fs.mkdirSync(fixtureRoot);
		const env: NodeJS.ProcessEnv = { PATH: opBin };

		// ── PATH resolution mirrors the child's exec ─────────────────────────────
		ok(
			"resolution: the launcher is selected from the exact child PATH, not from this process's",
			resolveFromPath("claude", env) === launcher && resolveFromPath("claude", { PATH: tmp }) === null,
		);

		// ── the fail-closed preflight ────────────────────────────────────────────
		const snap = snapshotClaudeLauncher({ env, fixtureRoot });
		ok(
			"preflight: a healthy launcher is pinned — kind, link text, resolved target and content hash",
			snap.launcherPath === launcher &&
				snap.kind === "symlink" &&
				snap.linkText === opTarget &&
				snap.resolvedPath === fs.realpathSync(opTarget) &&
				snap.sha256.length === 64,
		);
		ok(
			"preflight: no `claude` on the child PATH refuses loudly instead of launching unpinned",
			refusal(() => snapshotClaudeLauncher({ env: { PATH: path.join(tmp, "empty") }, fixtureRoot })).includes(
				"no executable",
			),
		);
		{
			// The launcher ITSELF inside the cleanup root: refused on the launcher-path axis.
			const inBin = path.join(fixtureRoot, "in-bin");
			fs.mkdirSync(inBin, { recursive: true });
			fs.writeFileSync(path.join(inBin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			ok(
				"preflight: a launcher that itself lives inside the fixture cleanup root is refused",
				refusal(() => snapshotClaudeLauncher({ env: { PATH: inBin }, fixtureRoot })).includes(
					"INSIDE the fixture cleanup root",
				),
			);
		}
		{
			// The incident's precondition, replanted disposably: a launcher OUTSIDE the fixture whose
			// resolved target is INSIDE it — exactly what a prior self-update leaves behind.
			const fixtureExec = path.join(fixtureRoot, "claude", "versions", "9.0.0", "claude");
			fs.mkdirSync(path.dirname(fixtureExec), { recursive: true });
			fs.writeFileSync(fixtureExec, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
			const trapBin = path.join(tmp, "trap-bin");
			fs.mkdirSync(trapBin);
			fs.symlinkSync(fixtureExec, path.join(trapBin, "claude"));
			ok(
				"[QK:LAUNCHFENCE-PREFLIGHT-FAIL-CLOSED] preflight: a launcher whose RESOLVED TARGET lies inside the fixture cleanup root is refused before any child starts — launching would hand the self-updater a tree teardown is about to delete",
				refusal(() => snapshotClaudeLauncher({ env: { PATH: trapBin }, fixtureRoot })).includes(
					"INSIDE the fixture cleanup root",
				),
			);
			ok(
				"cleanup guard: a launcher retargeted at an EXISTING file inside the fixture blocks removal too, naming the reference",
				(() => {
					relink(launcher, fixtureExec);
					const verdict = assessLauncherCleanup(snap);
					relink(launcher, opTarget);
					return (
						!verdict.safeToRemove && verdict.problems.some((p) => p.includes("lies inside the fixture cleanup root"))
					);
				})(),
			);
		}

		// ── the incident's END state: a retarget whose fixture path is already gone ──
		{
			relink(launcher, path.join(fixtureRoot, "claude", "versions", "9.9.9", "claude"));
			const problems = verifyClaudeLauncher(snap);
			const verdict = assessLauncherCleanup(snap);
			ok(
				"[QK:LAUNCHFENCE-RETARGET-BLOCKS-CLEANUP] teardown: a launcher rewritten to point into the fixture tree — even when that fixture path is already dangling — is caught BEFORE removal: the integrity oracle reports it and the cleanup guard blocks rm naming the KNOWN fixture reference, not a vague uncertainty",
				problems.length > 0 &&
					!verdict.safeToRemove &&
					verdict.problems.some((p) => p.includes("lies inside the fixture cleanup root")),
			);
			ok(
				"teardown: the retarget is named on the link axis, not laundered into a generic failure",
				problems.some((p) => p.includes("link text changed")),
			);
			relink(launcher, opTarget);
		}

		// ── uncertainty is fail-closed AND honest: blocked, but never claimed as a known reference ──
		{
			relink(launcher, path.join(tmp, "operator", "versions", "gone", "claude"));
			const verdict = assessLauncherCleanup(snap);
			ok(
				"cleanup guard: a launcher whose chain cannot be fully resolved OUTSIDE the fixture blocks removal as 'not proven safe' — fail-closed on uncertainty without minting a false fixture reference",
				!verdict.safeToRemove &&
					verdict.problems.some((p) => p.includes("not proven safe")) &&
					!verdict.problems.some((p) => p.includes("lies inside the fixture cleanup root")),
			);
			relink(launcher, opTarget);
		}

		// ── change detection with NO path movement at all ────────────────────────
		{
			const fresh = snapshotClaudeLauncher({ env, fixtureRoot });
			fs.appendFileSync(opTarget, "# self-update rewrote me in place\n");
			const problems = verifyClaudeLauncher(fresh);
			ok(
				"[QK:LAUNCHFENCE-CONTENT-CHANGE-DETECTED] teardown: an in-place rewrite of the resolved target — same launcher path, same link text — is still reported before cleanup, because content identity is part of the pinned evidence",
				problems.some((p) => p.includes("sha256 mismatch")),
			);
			ok(
				"teardown: after the healthy state is restored, the oracle is quiet and the guard PROVES removal safe",
				(() => {
					fs.writeFileSync(opTarget, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
					const verdict = assessLauncherCleanup(fresh);
					return verifyClaudeLauncher(fresh).length === 0 && verdict.safeToRemove && verdict.problems.length === 0;
				})(),
			);
		}

		// ── exact operator-env XDG parity for a real-HOME Claude cell ────────────
		{
			const before: NodeJS.ProcessEnv = {
				XDG_CONFIG_HOME: "/op/custom-config",
				XDG_CACHE_HOME: "",
			};
			const originals = snapshotOriginalXdg(before);
			ok(
				"xdg: the snapshot records presence and value — a set variable (even empty) is a string, an absent one is null",
				originals.XDG_CONFIG_HOME === "/op/custom-config" &&
					originals.XDG_CACHE_HOME === "" &&
					originals.XDG_DATA_HOME === null &&
					originals.XDG_STATE_HOME === null,
			);
			const cell: NodeJS.ProcessEnv = {
				HOME: "/real/home",
				XDG_CONFIG_HOME: path.join(fixtureRoot, "xdg-config"),
				XDG_DATA_HOME: path.join(fixtureRoot, "xdg-data"),
				XDG_STATE_HOME: path.join(fixtureRoot, "xdg-state"),
				XDG_CACHE_HOME: path.join(fixtureRoot, "xdg-cache"),
			};
			restoreOriginalXdg(cell, originals);
			ok(
				"[QK:LAUNCHFENCE-XDG-EXACT-RESTORE] xdg: the cell gets EXACT operator parity — original values restored byte-for-byte and originally ABSENT variables DELETED, never filled with a canonical default path, because real HOME + fixture XDG_DATA_HOME is the measured state that let self-update rewrite the real launcher",
				cell.XDG_CONFIG_HOME === "/op/custom-config" &&
					cell.XDG_CACHE_HOME === "" &&
					!("XDG_DATA_HOME" in cell) &&
					!("XDG_STATE_HOME" in cell) &&
					cell.HOME === "/real/home",
			);
		}

		// ── the fence is actually consumed by BOTH smokes ────────────────────────
		const wired = (src: string): boolean => {
			const verifyAt = src.indexOf("verifyClaudeLauncher(launcherSnapshot)");
			const rmAt = src.indexOf("rmSync(root");
			return (
				src.includes('from "./lib/claude-launcher-fence.ts"') &&
				src.includes("snapshotClaudeLauncher({ env: process.env, fixtureRoot: root })") &&
				src.includes("assessLauncherCleanup(launcherSnapshot)") &&
				src.includes(".safeToRemove || !panesGone") &&
				src.includes("restoreOriginalXdg(") &&
				verifyAt !== -1 &&
				rmAt !== -1 &&
				verifyAt < rmAt
			);
		};
		ok(
			"[QK:LAUNCHFENCE-WIRED-LIFECYCLE] wiring: smoke-mux-lifecycle-live consumes the shared fence — fail-closed preflight from the exact child env, the integrity oracle BEFORE fixture removal, and a removal gated on BOTH the cleanup verdict and tracked-pane quiescence",
			wired(read("scripts/smoke-mux-lifecycle-live.ts")),
		);
		ok(
			"[QK:LAUNCHFENCE-WIRED-FRESH-CALL] wiring: smoke-mux-fresh-call-live consumes the SAME shared fence rather than a private copy — one protection, two smokes, per the issue's shared-repair requirement",
			wired(read("scripts/smoke-mux-fresh-call-live.ts")),
		);
		ok(
			"[QK:LAUNCHFENCE-LIFECYCLE-CELL-BRANCH] wiring: lifecycle's real-HOME cell env keeps its two truthful branches — the ACP-backed pi cell retains all four MEASURED canonical REAL_XDG_* assignments, and the direct Claude Code cell (the else branch) gets exact-parity restoreOriginalXdg instead",
			/if \(backend === "pi"\) \{\s*serverEnv\.XDG_CONFIG_HOME = REAL_XDG_CONFIG_HOME;\s*serverEnv\.XDG_DATA_HOME = REAL_XDG_DATA_HOME;\s*serverEnv\.XDG_STATE_HOME = REAL_XDG_STATE_HOME;\s*serverEnv\.XDG_CACHE_HOME = REAL_XDG_CACHE_HOME;\s*\} else \{\s*restoreOriginalXdg\(serverEnv, ORIGINAL_XDG\);\s*\}/.test(
				read("scripts/smoke-mux-lifecycle-live.ts"),
			),
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}

	console.log(`\ncheck-mux-launcher-fence: ${passed} checks passed`);
}

main();
