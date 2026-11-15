#!/usr/bin/env node
/**
 * check-openclaw-home-receipt — the landlord-home first-admission release MUST (#160 S6 §7).
 *
 * Reads the candidate-attributed receipt of the replacement-behaviour oracles named by
 * ENTWURF_OPENCLAW_HOME_RECEIPT (an absolute path) and judges it with `judgeOpenclawHomeReceipt` for
 * THIS checkout's HEAD and its commit time, the home named by ENTWURF_OPENCLAW_HOME_TARGET
 * (`<scope>/<agentId>/<sessionKey>#<gardenId>`, the operator's input, never read from the receipt),
 * and the sha256 of each evidence file on disk. No receipt named → the protocol SKIP (97), which
 * `release-gate --cut` refuses. A receipt without a target, or one that does not stand → exit 1,
 * problems on stderr. It measures nothing and touches no Gateway, store or record.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeOpenclawHomeReceipt } from "../pi-extensions/lib/openclaw-home-receipt.ts";
import { skipLive } from "./lib/live-skip.ts";

const LABEL = "check-openclaw-home-receipt";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const file = process.env.ENTWURF_OPENCLAW_HOME_RECEIPT;
if (!file) {
	skipLive(
		LABEL,
		"no landlord-home receipt named; measure the S6 oracles on a lab Gateway at this candidate and set ENTWURF_OPENCLAW_HOME_RECEIPT=<absolute path> and ENTWURF_OPENCLAW_HOME_TARGET=<scope>/<agentId>/<sessionKey>#<gardenId>",
	);
}
if (!path.isAbsolute(file)) {
	console.error(`${LABEL}: ENTWURF_OPENCLAW_HOME_RECEIPT must be an absolute path (got ${file})`);
	process.exit(1);
}
const expectedTarget = process.env.ENTWURF_OPENCLAW_HOME_TARGET;
if (!expectedTarget) {
	console.error(
		`${LABEL}: a receipt is named but ENTWURF_OPENCLAW_HOME_TARGET is not; the measured home is the operator's input`,
	);
	process.exit(1);
}
const git = (...args: string[]) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
const committedAtMs = Date.parse(git("show", "-s", "--format=%cI", "HEAD"));
let raw: unknown;
try {
	raw = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
	console.error(
		`${LABEL}: ${file} is not a readable JSON receipt (${err instanceof Error ? err.message : String(err)})`,
	);
	process.exit(1);
}
const digestOf = (p: string): string | null => {
	try {
		if (!lstatSync(p).isFile()) return null;
		return createHash("sha256").update(readFileSync(p)).digest("hex");
	} catch {
		return null;
	}
};
const verdict = judgeOpenclawHomeReceipt(raw, {
	candidateHead: head,
	candidateCommittedAtMs: committedAtMs,
	nowMs: Date.now(),
	expectedTarget,
	digestOf,
});
if (!verdict.ok) {
	console.error(`${LABEL}: ${file} does not stand for candidate ${head}:\n  ${verdict.problems.join("\n  ")}`);
	process.exit(1);
}
console.log(`${LABEL}: ${file} stands for candidate ${head}, home ${verdict.target}`);
