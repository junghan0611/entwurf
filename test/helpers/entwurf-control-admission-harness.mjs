// Child-process harness for pi-extensions/entwurf-control.admission.test.ts (#151 b3 admission).
//
// Loads the REAL entwurf-control extension through Pi's REAL public loader, births the session into a
// throwaway store through its own session_start, then calls the REAL registered session_before_switch
// and session_before_fork handlers the way Pi's runner would, recording what each RETURNS (or throws).
// Store fixtures (another garden's reserved next chapter, this garden's K1 mark, a store defect) are
// made with the real lib writers. Pi's own runner and an SDK switch are not exercised here.
//
// Usage: node entwurf-control-admission-harness.mjs <extensionPath> <cwd>
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { birthPiCitizen } from "../../pi-extensions/lib/pi-citizen-birth.ts";
import { reserveRenewTo, writeRenewStart } from "../../pi-extensions/lib/renew-writer.ts";

const [extensionPath, cwd] = process.argv.slice(2);
const agentDir = process.env.PI_CODING_AGENT_DIR;
const sessionsDir = join(agentDir, "meta-sessions");
const recordArmLocksDir = join(agentDir, "meta-record-arm-locks");
const out = { errors: [], bridgeMissing: 0 };
const BRIDGE_MISSING = "[entwurf-control] compiled entwurf-bridge missing at ";

const loaded = await discoverAndLoadExtensions([extensionPath], cwd, agentDir);
if (loaded.errors.length > 0) {
	console.log(JSON.stringify({ loadErrors: loaded.errors }));
	process.exit(2);
}
loaded.runtime.flagValues.set("entwurf-control", true);
loaded.runtime.sendMessage = () => {};
const extension = loaded.extensions[0];
mkdirSync(agentDir, { recursive: true });

const NATIVE = "01900000-0000-7000-8000-0000000151b3";
let notifyThrows = false;
const notices = [];
const ctx = {
	cwd,
	hasUI: true,
	mode: "rpc",
	model: { provider: "gate", id: "entwurf-control-admission" },
	signal: undefined,
	isIdle: () => true,
	sessionManager: {
		getSessionId: () => NATIVE,
		getSessionFile: () => undefined,
		getEntries: () => [],
		getBranch: () => [],
		getLeafId: () => null,
	},
	ui: {
		theme: { fg: (_c, t) => t, bg: (_c, t) => t },
		setStatus: () => {},
		notify: (text, level) => {
			if (notifyThrows) throw new Error("harness: notify failed");
			notices.push({ text, level });
		},
		select: async () => undefined,
	},
};
const stderrLines = [];
let stderrThrows = false;
const realWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
	if (stderrThrows) throw new Error("harness: stderr failed");
	stderrLines.push(String(chunk));
	return realWrite(chunk, ...rest);
};
const call = async (event, payload) => {
	const results = [];
	for (const handler of extension.handlers.get(event) ?? []) {
		try {
			results.push({ returned: (await handler(payload, ctx)) ?? null });
		} catch (err) {
			results.push({ threw: String(err instanceof Error ? err.message : err) });
		}
	}
	return results;
};
for (const handler of extension.handlers.get("session_start") ?? []) {
	try {
		await handler({ type: "session_start", reason: "startup" }, ctx);
	} catch (err) {
		const message = String(err instanceof Error ? err.message : err);
		if (message.startsWith(BRIDGE_MISSING)) out.bridgeMissing++;
		else out.errors.push(`session_start: ${message}`);
	}
}
const header = (id) =>
	`${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-11-01T00:00:00.000Z", cwd: "/tmp" })}\n`;
const plain = join(agentDir, "plain.jsonl");
writeFileSync(plain, header("01900000-0000-7000-8000-00000000f1ee"));

// 1. Nothing mid-/renew, nothing claimed: both pass.
out.clean = {
	newSwitch: await call("session_before_switch", { type: "session_before_switch", reason: "new" }),
	resume: await call("session_before_switch", {
		type: "session_before_switch",
		reason: "resume",
		targetSessionFile: plain,
	}),
};

// 2. Another garden reserves its next chapter R; a resume to a file of R is cancelled.
const OTHER = "01900000-0000-7000-8000-0000000151c0";
const R = "01900000-0000-7000-8000-0000000151c1";
const other = birthPiCitizen({
	nativeSessionId: OTHER,
	cwd: "/tmp",
	sessionsDir,
	recordArmLocksDir,
	controlSocketDir: join(agentDir, "s"),
});
const ot = { gardenId: other.gardenId, token: "d".repeat(32), sessionsDir, recordArmLocksDir };
writeRenewStart({ ...ot, expectedNative: OTHER, outline: "outline", precondition: () => undefined });
reserveRenewTo({ ...ot, from: OTHER, to: R });
const reservedFile = join(agentDir, "r.jsonl");
writeFileSync(reservedFile, header(R));
out.reserved = {
	resume: await call("session_before_switch", {
		type: "session_before_switch",
		reason: "resume",
		targetSessionFile: reservedFile,
	}),
	stillPlain: await call("session_before_switch", {
		type: "session_before_switch",
		reason: "resume",
		targetSessionFile: plain,
	}),
};

// 3. A store defect is an error inside the decision: cancelled, never thrown. (Before this garden is
//    marked, so the decision reaches the certified read; the defect is removed afterwards.)
const junk = join(sessionsDir, "zz-not-a-record.meta.json");
writeFileSync(junk, "{");
out.defect = await call("session_before_switch", {
	type: "session_before_switch",
	reason: "resume",
	targetSessionFile: plain,
});
rmSync(junk);

// 4. This garden is mid-/renew (its K1 is written): a new switch and a fork are cancelled.
const mine = birthPiCitizen({
	nativeSessionId: NATIVE,
	cwd,
	sessionsDir,
	recordArmLocksDir,
	controlSocketDir: join(agentDir, "s"),
});
writeRenewStart({
	gardenId: mine.gardenId,
	token: "c".repeat(32),
	sessionsDir,
	recordArmLocksDir,
	expectedNative: NATIVE,
	outline: "outline",
	precondition: () => undefined,
});
out.renewing = {
	newSwitch: await call("session_before_switch", { type: "session_before_switch", reason: "new" }),
	fork: await call("session_before_fork", { type: "session_before_fork", entryId: "e1", position: "at" }),
};

// 5. A notice that fails does not undo the cancel, and its own failure is said on stderr; with
//    stderr failing too, the cancel still stands and nothing is thrown.
notifyThrows = true;
const linesBeforeNotify = stderrLines.length;
out.notifyFails = await call("session_before_switch", { type: "session_before_switch", reason: "new" });
out.notifyFailureLines = stderrLines
	.slice(linesBeforeNotify)
	.filter((l) => l.includes("notice of a cancelled session"));
stderrThrows = true;
out.bothFail = await call("session_before_switch", { type: "session_before_switch", reason: "new" });
stderrThrows = false;
notifyThrows = false;

// 6. Scopes: with the control flag off this Pi has no resident garden — a /new and a fork do not read
//    the store at all (they pass over a defect), while a resume's target protection still reads it
//    (the defect is an error, so the resume is cancelled).
loaded.runtime.flagValues.set("entwurf-control", false);
for (const handler of extension.handlers.get("session_start") ?? []) {
	try {
		await handler({ type: "session_start", reason: "startup" }, ctx);
	} catch (err) {
		out.errors.push(`session_start(flag off): ${String(err instanceof Error ? err.message : err)}`);
	}
}
const junk2 = join(sessionsDir, "zz-not-a-record.meta.json");
writeFileSync(junk2, "{");
out.scopes = {
	newSwitch: await call("session_before_switch", { type: "session_before_switch", reason: "new" }),
	fork: await call("session_before_fork", { type: "session_before_fork", entryId: "e1", position: "at" }),
	resume: await call("session_before_switch", {
		type: "session_before_switch",
		reason: "resume",
		targetSessionFile: plain,
	}),
};
rmSync(junk2);
process.stderr.write = realWrite;

out.notices = notices.map((n) => n.text);
console.log(JSON.stringify(out));
process.exit(0);
