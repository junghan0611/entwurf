/**
 * check-compaction-send-guard — deterministic oracle for #111.
 *
 * A compacting Pi citizen is neither idle nor an ordinary streaming turn. The
 * control-socket receiver must refuse every send mode without calling
 * `pi.sendMessage` and without emitting `delivered:true`. Event-armed compaction
 * names itself `compacting`. Quiet unknown non-idle (`!idle && !hasAgentSignal`)
 * is fail-closed as `busy` — `ctx.signal` is not `AgentSession.isStreaming`, so
 * that cell is not a proven compact. The predicate takes no send mode.
 *
 * No model / auth / pi process.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	BUSY_SEND_REJECT,
	COMPACTION_SEND_REJECT,
	compactionSendReject,
	createCompactionGuard,
	noteCompactionBefore,
	noteCompactionTerminal,
} from "../pi-extensions/lib/compaction-send-guard.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEAF_SRC = readFileSync(path.join(REPO, "pi-extensions/lib/compaction-send-guard.ts"), "utf8");
const CONTROL_SRC = readFileSync(path.join(REPO, "pi-extensions/entwurf-control.ts"), "utf8");

function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const leafCode = stripComments(LEAF_SRC);
const controlCode = stripComments(CONTROL_SRC);

ok("event-armed token is compacting", COMPACTION_SEND_REJECT === "compacting");
ok("quiet-unknown token is busy, not compacting", BUSY_SEND_REJECT === "busy");

ok(
	"[QK:COMPACT-SEND-NO-MODE] the predicate takes no send mode — omitted/follow_up/steer cannot diverge",
	!/mode/.test(leafCode) &&
		/compactionSendReject\s*\(\s*guard:\s*CompactionGuard,\s*facts:\s*CompactionSendFacts\s*\)/.test(LEAF_SRC),
);

{
	const g = createCompactionGuard();
	noteCompactionBefore(g);
	ok(
		"[QK:COMPACT-SEND-REJECT-ARMED] armed compacting-during-stream rejects as compacting",
		compactionSendReject(g, { idle: false, hasAgentSignal: true }) === COMPACTION_SEND_REJECT,
	);
}

{
	const g = createCompactionGuard();
	ok(
		"[QK:COMPACT-SEND-REJECT-QUIET] quiet unknown non-idle rejects as busy (start race / post-run / branch summary)",
		compactionSendReject(g, { idle: false, hasAgentSignal: false }) === BUSY_SEND_REJECT,
	);
	ok(
		"quiet unknown is not named compacting",
		compactionSendReject(g, { idle: false, hasAgentSignal: false }) !== COMPACTION_SEND_REJECT,
	);
}

{
	const g = createCompactionGuard();
	noteCompactionBefore(g);
	ok(
		"[QK:COMPACT-SEND-ADMIT-IDLE] idle admits even when armed (missed session_compact recovery)",
		compactionSendReject(g, { idle: true, hasAgentSignal: false }) === null,
	);
	ok("idle recovery disarms so a later ordinary stream is not stuck refused", g.armed === false);
}

{
	const g = createCompactionGuard();
	ok(
		"[QK:COMPACT-SEND-ADMIT-STREAM] live agent run (not armed, signal present) keeps steer/followUp",
		compactionSendReject(g, { idle: false, hasAgentSignal: true }) === null,
	);
	noteCompactionBefore(g);
	noteCompactionTerminal(g);
	ok(
		"session_compact / session_compact_failed disarms, so the next live run admits",
		compactionSendReject(g, { idle: false, hasAgentSignal: true }) === null,
	);
}

ok("fresh guard is not armed", createCompactionGuard().armed === false);
ok(
	"idle + not-armed admits (the preserved idle path)",
	compactionSendReject(createCompactionGuard(), { idle: true, hasAgentSignal: false }) === null,
);

ok(
	"[QK:COMPACT-SEND-WIRE] resident imports the leaf, consults it before pi.sendMessage, and refuses with the returned token",
	(() => {
		const imported =
			/from "\.\/lib\/compaction-send-guard\.js"/.test(CONTROL_SRC) && /compactionSendReject/.test(controlCode);
		const sendIdx = controlCode.indexOf('if (command.type === "send")');
		if (sendIdx < 0) return false;
		const sendBlock = controlCode.slice(sendIdx);
		const consult = sendBlock.search(/compactionSendReject\s*\(/);
		const sendMessage = sendBlock.search(/pi\.sendMessage\s*\(/);
		const ordered = consult >= 0 && sendMessage >= 0 && consult < sendMessage;
		const refused = /respond\(\s*false,\s*"send",\s*undefined,\s*compactionReject\s*\)/.test(controlCode);
		return imported && ordered && refused;
	})(),
);

ok(
	"[QK:COMPACT-SEND-EVENTS] resident arms on session_before_compact and disarms on both terminal compact events",
	/pi\.on\(\s*"session_before_compact"/.test(controlCode) &&
		/noteCompactionBefore\s*\(\s*state\.compaction\s*\)/.test(controlCode) &&
		/pi\.on\(\s*"session_compact"/.test(controlCode) &&
		/pi\.on\(\s*"session_compact_failed"/.test(controlCode) &&
		(controlCode.match(/noteCompactionTerminal\s*\(\s*state\.compaction\s*\)/g) ?? []).length >= 2,
);

console.log(`\ncheck-compaction-send-guard: ${passed} checks passed`);
