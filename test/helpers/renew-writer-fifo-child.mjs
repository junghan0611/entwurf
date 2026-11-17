// Child process for pi-extensions/lib/renew-writer.test.ts [QK:RENEW-B2-ORIGINAL-FIFO-NO-WAIT] (#151 b2).
//
// A record whose leaving chapter's original is a FIFO with no writer. The commit must refuse it at
// fstat without waiting; an open that waits never returns, so the parent runs this in its own
// process with a timeout — a failing candidate stops here, not the whole test file. Throwaway HOME /
// PI_CODING_AGENT_DIR come from the parent.
//
// Usage: node renew-writer-fifo-child.mjs <base dir>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { birthPiCitizen } from "../../pi-extensions/lib/pi-citizen-birth.ts";
import { commitRenew, reserveRenewTo, writeRenewStart } from "../../pi-extensions/lib/renew-writer.ts";

const [base] = process.argv.slice(2);
const sessionsDir = join(base, "meta-sessions");
const recordArmLocksDir = join(base, "meta-record-arm-locks");
const fifo = join(base, "n0.fifo");
execFileSync("mkfifo", [fifo]);
const N0 = "01900000-0000-7000-8000-0000000151f0";
const N1 = "01900000-0000-7000-8000-0000000151f1";
const token = "c".repeat(32);
const outline = "이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다.";
const { gardenId } = birthPiCitizen({
	nativeSessionId: N0,
	cwd: "/tmp",
	transcriptPath: fifo,
	sessionsDir,
	recordArmLocksDir,
	controlSocketDir: join(base, "sockets"),
});
const t = { gardenId, token, sessionsDir, recordArmLocksDir };
writeRenewStart({ ...t, expectedNative: N0, outline, precondition: () => undefined });
reserveRenewTo({ ...t, from: N0, to: N1 });
try {
	commitRenew({
		...t,
		from: N0,
		to: N1,
		expectedOutlineSha: createHash("sha256").update(outline, "utf8").digest("hex"),
		newTranscriptPath: join(base, "n1.jsonl"),
	});
	console.log(JSON.stringify({ code: null }));
} catch (err) {
	console.log(JSON.stringify({ code: err?.code ?? null, message: String(err?.message ?? err) }));
}
process.exit(0);
