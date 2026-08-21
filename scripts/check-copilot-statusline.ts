/**
 * check-copilot-statusline — #82 Copilot footer renderer, without Copilot.
 *
 * Subject: scripts/copilot-statusline.sh. Cells: record → exact gid; duplicate
 * nativeSessionId → `!`; no record → `?`; no session_id / empty / malformed
 * → `ready`; every path exit 0.
 * Copilot blanks the slot on nonzero (bundle Fxi). Isolated HOME+store.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "copilot-statusline.sh");
const GID_RE = /\d{8}T\d{6}-[0-9a-f]{6}/;
const GID = "20260821T075400-c0ffee";
const SID = "4269fad4-d5f5-4281-969f-bbeb211f0d7c";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const root = mkdtempSync(path.join(tmpdir(), "entwurf-copilot-statusline."));
const home = path.join(root, "home");
const store = path.join(root, "meta-sessions");
mkdirSync(home);
mkdirSync(store);

function run(stdin: string, extraEnv: NodeJS.ProcessEnv = {}): { status: number; stdout: string } {
	const result = spawnSync("bash", [SCRIPT], {
		cwd: root,
		env: {
			...process.env,
			...extraEnv,
			HOME: home,
			ENTWURF_META_SESSIONS_DIR: store,
			PI_CODING_AGENT_DIR: "",
		},
		encoding: "utf8",
		input: stdin,
		timeout: 10_000,
	});
	return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function env(sessionId: unknown): string {
	return JSON.stringify({ session_id: sessionId });
}

const noRecord = run(env(SID));
ok("no-record exits 0", noRecord.status === 0);
ok("no-record is ?", noRecord.stdout === "🪛 ? cop");
ok("no-record plants no gid", !GID_RE.test(noRecord.stdout));

writeFileSync(
	path.join(store, `${GID}.meta.json`),
	`${JSON.stringify({
		schemaVersion: 3,
		gardenId: GID,
		backend: "copilot",
		nativeSessionId: SID,
	})}\n`,
);
const withRecord = run(env(SID));
ok("record-present exits 0", withRecord.status === 0);
ok("record-present is the exact gid", withRecord.stdout === `🪛 ${GID} cop`);

const duplicateGid = "20260821T075401-deadbe";
writeFileSync(
	path.join(store, `${duplicateGid}.meta.json`),
	`${JSON.stringify({
		schemaVersion: 3,
		gardenId: duplicateGid,
		backend: "copilot",
		nativeSessionId: SID,
	})}\n`,
);
const duplicate = run(env(SID));
ok("duplicate nativeSessionId exits 0", duplicate.status === 0);
ok("duplicate nativeSessionId is !", duplicate.stdout === "🪛 ! cop");

const empty = run("");
ok("empty stdin exits 0", empty.status === 0);
ok("empty stdin is ready", empty.stdout === "🪛 ready cop");
ok("empty stdin plants no gid", !GID_RE.test(empty.stdout));

const malformed = run("{this is not json");
ok("malformed stdin exits 0", malformed.status === 0);
ok("malformed stdin is ready", malformed.stdout === "🪛 ready cop");
ok("malformed stdin plants no gid", !GID_RE.test(malformed.stdout));

const missing = run("{}");
ok("missing session_id exits 0", missing.status === 0);
ok("missing session_id is ready", missing.stdout === "🪛 ready cop");

const nullId = run(env(null));
ok("null session_id exits 0", nullId.status === 0);
ok("null session_id is ready — no leftover lookup", nullId.stdout === "🪛 ready cop");
ok("null session_id plants no gid", !GID_RE.test(nullId.stdout));

const catBin = path.join(root, "cat-bin");
mkdirSync(catBin);
writeFileSync(path.join(catBin, "cat"), "#!/bin/sh\nexit 73\n", { mode: 0o755 });
const catFailure = run(env(SID), { PATH: `${catBin}${path.delimiter}${process.env.PATH ?? ""}` });
ok("stdin read failure exits 0", catFailure.status === 0);
ok("stdin read failure is ready, not blank", catFailure.stdout === "🪛 ready cop");

const pythonBin = path.join(root, "python-bin");
mkdirSync(pythonBin);
writeFileSync(path.join(pythonBin, "python3"), "#!/bin/sh\nprintf partial\nexit 12\n", { mode: 0o755 });
const pythonFailure = run(env(SID), { PATH: `${pythonBin}${path.delimiter}${process.env.PATH ?? ""}` });
ok("partial interpreter failure exits 0", pythonFailure.status === 0);
ok("partial interpreter failure is ?, not partial", pythonFailure.stdout === "🪛 ? cop");

console.log(`\ncheck-copilot-statusline: ${passed} assertions ok`);
