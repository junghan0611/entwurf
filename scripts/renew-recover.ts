#!/usr/bin/env node
/**
 * renew-recover — the explicit offline recovery of a /renew whose owner Pi is gone (#151, C1.4o).
 * A human runs it, once, in a quiet window, with no Pi holding that garden's chapters open. The
 * decisions live in pi-extensions/lib/renew-recover.ts; this is argv and the exit code.
 *
 *   entwurf renew-recover <gardenId>
 *       read only: from, to, the owner's pid and whether it is proven gone, the body's sha
 *   entwurf renew-recover <gardenId> --continue <absolute session file of the reserved chapter>
 *       hand the mark over and commit: the record names the reserved chapter. Pi is not opened.
 *   entwurf renew-recover <gardenId> --abort --save-outline <absolute new file>
 *       nothing was reserved: save the agreed body first, then hand over and clear.
 *
 * EXIT: 0 status or done · 2 usage · 4 refused (the record is unchanged; an abort names any save
 * file it already wrote) · 5 stopped after the hand-over (the line carries what the record says NOW
 * — it may already be committed or open; nothing is retried) · 1 unexpected.
 */
import { type RecoverPlan, recoverRenew } from "../pi-extensions/lib/renew-recover.ts";

const USAGE =
	"usage: entwurf renew-recover <gardenId> [--continue <abs session file> | --abort --save-outline <abs new file>]";
const argv = process.argv.slice(2);
const gardenId = argv[0];
let plan: RecoverPlan | null = null;
if (gardenId !== undefined && !gardenId.startsWith("-")) {
	const rest = argv.slice(1);
	if (rest.length === 0) plan = { kind: "status" };
	else if (rest.length === 2 && rest[0] === "--continue") plan = { kind: "continue", file: rest[1] as string };
	else if (rest.length === 3 && rest[0] === "--abort" && rest[1] === "--save-outline") {
		plan = { kind: "abort", saveOutline: rest[2] as string };
	}
}
if (gardenId === undefined || plan === null) {
	process.stderr.write(`${USAGE}\n`);
	process.exit(2);
}

try {
	const out = recoverRenew({ gardenId, plan });
	process.stdout.write(`${JSON.stringify(out)}\n`);
	const said =
		out.kind === "continued"
			? `garden ${gardenId}: the record now names chapter ${out.to} (${out.protection}). Pi has NOT been opened — ` +
				`open that chapter with: pi --session ${out.file}  — and check its address and first input there.`
			: out.kind === "aborted"
				? `garden ${gardenId}: the unreserved attempt was aborted; ${out.from} is the current chapter again. ` +
					`The agreed body is saved at ${out.savedAt}. A new /renew is a new show and confirm.`
				: out.kind === "status"
					? `garden ${gardenId}: mid-/renew from ${out.from} to ${out.to ?? "nothing reserved"}; owner pid ${out.owner.pid} is ${out.owner.verdict}`
					: `garden ${gardenId}: ${out.kind} (${out.code}): ${out.detail}` +
						(out.kind === "stopped"
							? ` — the record now: ${JSON.stringify(out.record)}, owner pid ${out.ownerPid}`
							: " — the record is unchanged") +
						(out.saved === undefined ? "" : ` — a save file exists at ${out.saved.path} (${out.saved.state})`);
	const notes = "notes" in out && out.notes.length > 0 ? ` [${out.notes.join("; ")}]` : "";
	process.stderr.write(`${said}${notes}\n`);
	process.exit(out.kind === "refused" ? 4 : out.kind === "stopped" ? 5 : 0);
} catch (err) {
	process.stderr.write(`renew-recover: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
}
