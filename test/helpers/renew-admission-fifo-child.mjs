// Child process for pi-extensions/lib/renew-admission.test.ts [QK:RENEW-B3-ADMIT-FIFO-NO-WAIT] (#151 b3).
//
// A switch target that is a FIFO with no writer, in a store that holds a reserved next chapter. The
// classifier must answer without waiting (unidentified, so cancelled while a claim exists); an open
// that waits never returns, so the parent runs this in its own process under a time limit.
//
// Usage: node renew-admission-fifo-child.mjs <base dir>
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { birthPiCitizen } from "../../pi-extensions/lib/pi-citizen-birth.ts";
import { classifySwitchTarget } from "../../pi-extensions/lib/renew-admission.ts";
import { reserveRenewTo, writeRenewStart } from "../../pi-extensions/lib/renew-writer.ts";

const [base] = process.argv.slice(2);
const sessionsDir = join(base, "meta-sessions");
const recordArmLocksDir = join(base, "meta-record-arm-locks");
const N0 = "01900000-0000-7000-8000-0000000151a0";
const { gardenId } = birthPiCitizen({
	nativeSessionId: N0,
	cwd: "/tmp",
	sessionsDir,
	recordArmLocksDir,
	controlSocketDir: join(base, "s"),
});
const t = { gardenId, token: "c".repeat(32), sessionsDir, recordArmLocksDir };
writeRenewStart({ ...t, expectedNative: N0, outline: "outline", precondition: () => undefined });
reserveRenewTo({ ...t, from: N0, to: "01900000-0000-7000-8000-0000000151a1" });
const fifo = join(base, "target.fifo");
execFileSync("mkfifo", [fifo]);
console.log(JSON.stringify(classifySwitchTarget(fifo, sessionsDir)));
process.exit(0);
