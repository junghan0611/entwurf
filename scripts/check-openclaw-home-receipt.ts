#!/usr/bin/env node
/**
 * check-openclaw-home-receipt — the landlord-home first-admission release MUST (#160 S6 §7).
 *
 * Reads the candidate-attributed receipt of the replacement-behaviour oracles named by
 * ENTWURF_OPENCLAW_HOME_RECEIPT (an absolute path) and judges it for THIS checkout's HEAD with
 * `judgeOpenclawHomeReceipt`. No receipt named → the protocol SKIP (97), which `release-gate --cut`
 * refuses. A receipt that does not stand for this candidate and home → exit 1, problems on stderr.
 * It measures nothing and touches no Gateway, store or record.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
		"no landlord-home receipt named; measure the S6 oracles on a lab Gateway at this candidate and set ENTWURF_OPENCLAW_HOME_RECEIPT=<absolute path>",
	);
}
if (!path.isAbsolute(file)) {
	console.error(`${LABEL}: ENTWURF_OPENCLAW_HOME_RECEIPT must be an absolute path (got ${file})`);
	process.exit(1);
}
const head = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let raw: unknown;
try {
	raw = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
	console.error(
		`${LABEL}: ${file} is not a readable JSON receipt (${err instanceof Error ? err.message : String(err)})`,
	);
	process.exit(1);
}
const verdict = judgeOpenclawHomeReceipt(raw, head);
if (!verdict.ok) {
	console.error(`${LABEL}: ${file} does not stand for candidate ${head}:\n  ${verdict.problems.join("\n  ")}`);
	process.exit(1);
}
console.log(`${LABEL}: ${file} stands for candidate ${head}, home ${verdict.target}`);
