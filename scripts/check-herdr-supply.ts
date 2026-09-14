/**
 * check-herdr-supply — the herdr binary CI runs is the one this repository MEASURED (#116 C2b).
 *
 * No herdr binary is needed here, and no network: every cell below reads the supply manifest,
 * the installer and the workflow as text. That is the point — this gate judges the SUPPLY
 * AUTHORITY (who decides which bytes), while `check-herdr-sandbox` judges what those bytes do.
 *
 * WHY A MANIFEST INSTEAD OF A CONSTANT. C2a hardcoded `0.9.` inside the sandbox gate. A CI job
 * installing some other version would have satisfied the gate's own skip/fail logic while the
 * boundary check silently compared against a version nobody had installed — a drift with no
 * observer. One file now owns version, tag and per-architecture digest; the installer and the
 * gate both read it; and this gate refuses a second copy anywhere else.
 *
 * WHAT THE INTEGRITY EVIDENCE ACTUALLY IS, so nobody upgrades the claim later:
 * `[측정 2026-09-14]` GitHub publishes an IMMUTABLE-RELEASE attestation (in-toto
 * `release/v0.2`) listing each asset's digest for `pkg:github/herdrdev/herdr@v0.9.0`. That is
 * GitHub signing "these digests are this tag's assets" — it is NOT a SLSA build provenance
 * authored by herdr and NOT a reproducible-build proof. `[측정, gh 2.97.0]` `gh attestation
 * verify` cannot close that predicate, so the installer depends on a pinned sha256 and never on
 * that CLI. Our own digest is therefore the load-bearing check, with the attestation as
 * corroboration a human can pull through the REST API.
 *
 * Each claim carries its QK token on exactly ONE assertion.
 *
 *   HSUP-MANIFEST-SSOT        version/tag/digests exist ONLY in the manifest
 *   HSUP-DIGEST-SHAPE         every pinned digest is a full sha256 and they are distinct
 *   HSUP-ARCH-FAIL-CLOSED     an unmeasured architecture is refused, never approximated
 *   HSUP-VERIFY-BEFORE-CHMOD  the digest is checked while the file is still inert
 *   HSUP-NO-MUTABLE-SUPPLY    no curl-pipe, no `latest`, no package manager, no global install
 *   HSUP-NO-ATTESTATION-CLI   the installer does not depend on `gh attestation verify`
 *   HSUP-CI-INSTALL-BEFORE-FLOOR  CI installs the pinned binary before the floor runs
 *   HSUP-CI-REQUIRES-HERDR    that floor runs with absence turned red
 *   HSUP-CI-LINUX-ONLY        only the Linux check job takes this; the other jobs are untouched
 *   HSUP-SETUP-NEVER-INSTALLS the product's own setup/package never installs herdr (Rule 17)
 *   HSUP-X86-UNEXECUTED       the x86_64 asset is pinned but recorded as never executed
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = "scripts/fixtures/herdr-supply.json";
const INSTALLER_PATH = "scripts/install-herdr-ci.sh";
const CI_PATH = ".github/workflows/ci.yml";
const SANDBOX_GATE_PATH = "scripts/check-herdr-sandbox.ts";

const read = (rel: string): string => readFileSync(path.join(REPO_DIR, rel), "utf8");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

interface Supply {
	version: string;
	tag: string;
	tagCommit: string;
	measuredOn: string;
	measuredArch: string;
	releaseUrlPrefix: string;
	assets: Record<string, { name: string; sha256: string; executed: boolean; executedNote: string }>;
}

function main(): void {
	console.log("[check-herdr-supply]");

	const manifestText = read(MANIFEST_PATH);
	const supply = JSON.parse(manifestText) as Supply;
	const installer = read(INSTALLER_PATH);
	const ci = read(CI_PATH);
	const sandboxGate = read(SANDBOX_GATE_PATH);

	const digests = Object.values(supply.assets).map((a) => a.sha256);

	// ── the manifest is the only copy ────────────────────────────────────────────────────
	// Searching the whole tree would trip over this gate's own prose, so the set is the
	// files that could actually ACT on a wrong number: the installer, the workflow, and the
	// gate whose boundary check reads it.
	const consumers = [installer, ci, sandboxGate];
	ok(
		"[QK:HSUP-MANIFEST-SSOT] the version, the tag and every digest live ONLY in the manifest — the installer, the workflow and the sandbox gate READ it and none of them carries a second copy that could drift",
		consumers.every((text) => !digests.some((d) => text.includes(d))) &&
			!installer.includes(supply.version) &&
			!ci.includes(supply.version) &&
			!sandboxGate.includes(`"${supply.version}"`) &&
			installer.includes(MANIFEST_PATH) &&
			sandboxGate.includes(MANIFEST_PATH),
	);
	ok(
		"[QK:HSUP-DIGEST-SHAPE] every pinned digest is a full lowercase sha256 and no two architectures share one — a truncated or duplicated digest is a check that cannot fail",
		digests.length >= 2 &&
			digests.every((d) => /^[0-9a-f]{64}$/.test(d)) &&
			new Set(digests).size === digests.length &&
			/^[0-9a-f]{40}$/.test(supply.tagCommit) &&
			supply.tag === `v${supply.version}`,
	);

	// ── the installer's own refusals ─────────────────────────────────────────────────────
	ok(
		"[QK:HSUP-ARCH-FAIL-CLOSED] an architecture the manifest does not carry is REFUSED by name — there is no nearest-match binary, and a CI runner we have never measured must not silently get one",
		/if \(!asset\) \{/.test(installer) &&
			installer.includes("unsupported architecture") &&
			installer.includes("no measured herdr asset for"),
	);

	const shaIndex = installer.indexOf("sha256sum");
	const chmodIndex = installer.indexOf("chmod +x");
	const curlIndex = installer.indexOf("curl -fsSL");
	ok(
		"[QK:HSUP-VERIFY-BEFORE-CHMOD] the digest is verified while the downloaded file is still inert data, and only then is it made executable — a byte we did not choose never becomes something the job can run",
		curlIndex > 0 && shaIndex > curlIndex && chmodIndex > shaIndex && installer.includes('rm -f "$target"'),
	);
	// The installer's comments NAME every rejected supply path, which is the point of them —
	// so these cells read the code with comments stripped. A guard that banned the words would
	// have forced the reasons out of the file.
	const installerCode = installer.replace(/^\s*#.*$/gm, "");
	ok(
		"[QK:HSUP-NO-MUTABLE-SUPPLY] the installer's CODE contains no curl-pipe, no `latest`, no package manager and no global install location — each of those would make a green run a claim about a binary nobody chose",
		!/curl[^\n]*\|\s*(sh|bash)/.test(installerCode) &&
			!installerCode.includes("/latest/") &&
			!/\b(brew|mise|nix-env|npm i -g|sudo)\b/.test(installerCode) &&
			!installerCode.includes(".local/bin") &&
			installerCode.includes("RUNNER_TEMP"),
	);
	ok(
		"[QK:HSUP-NO-ATTESTATION-CLI] the installer does not depend on `gh attestation verify` — measured on gh 2.97.0 it cannot close herdr's in-toto release predicate, and a check we cannot run is not a check",
		!installerCode.includes("gh attestation") &&
			manifestText.includes("in-toto.io/attestation/release/v0.2") &&
			manifestText.includes("NOT a SLSA build provenance"),
	);

	// ── the CI wiring ────────────────────────────────────────────────────────────────────
	const installIndex = ci.indexOf("./scripts/install-herdr-ci.sh");
	const floorIndex = ci.indexOf("- run: pnpm run check:full");
	ok(
		"[QK:HSUP-CI-INSTALL-BEFORE-FLOOR] CI installs the pinned binary BEFORE the deterministic floor — installing after it would leave the herdr cell skipping in the one place it is supposed to be required",
		installIndex > 0 && floorIndex > installIndex,
	);
	const floorStep = ci.slice(floorIndex, floorIndex + 200);
	ok(
		"[QK:HSUP-CI-REQUIRES-HERDR] that floor runs with ENTWURF_REQUIRE_HERDR=1, so an absent binary is red in CI while it stays an explicit SKIP on an operator's machine",
		/ENTWURF_REQUIRE_HERDR:\s*"1"/.test(floorStep),
	);
	ok(
		"[QK:HSUP-CI-LINUX-ONLY] exactly one job installs herdr and it is the Linux check job — the install-surface, artifact-consumer and macOS jobs are unchanged, because this rail is certified on Linux only",
		ci.split("./scripts/install-herdr-ci.sh").length - 1 === 1 &&
			ci.slice(0, installIndex).lastIndexOf("runs-on: ubuntu-latest") >
				ci.slice(0, installIndex).lastIndexOf("\n  check:") - 1 &&
			installIndex < ci.indexOf("  install-surface:") &&
			installIndex < ci.indexOf("  macos-install-surface:"),
	);

	// ── the product never supplies someone else's bytes ──────────────────────────────────
	const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; bin?: Record<string, string> };
	const scriptText = Object.values(pkg.scripts).join(" ");
	ok(
		"[QK:HSUP-SETUP-NEVER-INSTALLS] no product script and no shipped bin reaches the CI installer — Entwurf supplies Entwurf's bytes, never a placement owner's (Hard Rule 17), and this file is job scaffolding rather than a surface",
		!scriptText.includes("install-herdr-ci") &&
			!Object.values(pkg.bin ?? {}).some((p) => p.includes("install-herdr-ci")) &&
			// run.sh DESCRIBES the supply gate in a comment; what matters is that no dispatch
			// path runs the installer. Read the code, not the prose — banning the word would
			// only push the explanation out of the file.
			!read("run.sh")
				.replace(/^\s*#.*$/gm, "")
				.includes("install-herdr-ci"),
	);

	// ── honesty about what has actually run ──────────────────────────────────────────────
	ok(
		"[QK:HSUP-X86-UNEXECUTED] the x86_64 asset is pinned but RECORDED AS NEVER EXECUTED — every measurement in this lane ran on aarch64, so a pinned digest must not read as evidence that the cell passes on the other architecture",
		supply.assets.x86_64?.executed === false &&
			supply.assets.aarch64?.executed === true &&
			supply.measuredArch === "aarch64" &&
			(supply.assets.x86_64?.executedNote ?? "").length > 0,
	);

	console.log(`\n[check-herdr-supply] ${passed} assertions ok`);
}

main();
