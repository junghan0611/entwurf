/**
 * omp-receive-facts — the read-only projection of the OMP RECEIVE rail (#87 bundle B).
 *
 * WHY THIS EXISTS AS ITS OWN SURFACE. `meta-facts` projects the certified RECORD store
 * and says nothing about receiver markers (measured: its keys are storeDir / citizens /
 * defects). The receive doctor, the install-state smoke and the LIVE acceptance all need
 * the same question answered — "which omp citizens have a LIVE doorbell right now?" — and
 * a doctor that answered it with `ls` or a grep would be claiming an active receiver from
 * a filename. So the answer comes from the PRODUCTION reader, `readMetaReceiverMarker`,
 * exactly as the record count comes from the production certifier.
 *
 * IT REPORTS BOTH READINGS, AND THAT IS THE POINT. `verifyOwner:true` is the live answer
 * dispatch will get; `verifyOwner:false` is the file as written. Reporting only the first
 * would make a crashed session's leftover marker indistinguishable from no marker at all,
 * and the operator needs to tell "nothing armed" from "something armed and then died".
 *
 * READ-ONLY: it opens no session, writes no marker, and never repairs what it finds.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { type MetaReceiverMarker, ompMetaRoots, readMetaReceiverMarker } from "../pi-extensions/lib/meta-session.ts";

interface ReceiverFact {
	gardenId: string;
	backend: string;
	nativeSessionId: string;
	ownerPid: number;
	ownerKind: string;
	armProvenance: string;
	updatedAt: string;
	/** The reading dispatch gets: the owner pid is still the same live process. */
	ownerLive: boolean;
	/** Mailbox bodies the doorbell has already announced and the model has not drained. */
	unreadDelivered: number;
	/** Bodies enqueued but not yet announced — a doorbell that has not fired yet. */
	freshUnannounced: number;
	mailboxDir: string;
}

function countSuffix(dir: string, suffix: string): number {
	try {
		return fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).length;
	} catch {
		return 0;
	}
}

function main(): void {
	const roots = ompMetaRoots();
	const facts: ReceiverFact[] = [];
	const unreadable: string[] = [];
	let entries: string[] = [];
	try {
		entries = fs.readdirSync(roots.receiversDir).filter((f) => f.endsWith(".json"));
	} catch {
		entries = [];
	}
	for (const entry of entries.sort()) {
		const gardenId = entry.slice(0, -".json".length);
		let written: MetaReceiverMarker | null = null;
		try {
			written = readMetaReceiverMarker({
				gardenId,
				receiversDir: roots.receiversDir,
				verifyOwner: false,
			});
		} catch {
			written = null;
		}
		if (!written) {
			unreadable.push(entry);
			continue;
		}
		if (written.backend !== "omp") continue;
		const live = readMetaReceiverMarker({ gardenId, receiversDir: roots.receiversDir, verifyOwner: true }) !== null;
		const mailboxDir = path.join(roots.mailboxDir, gardenId);
		facts.push({
			gardenId: written.gardenId,
			backend: written.backend,
			nativeSessionId: written.nativeSessionId,
			ownerPid: written.ownerPid,
			ownerKind: written.ownerKind,
			armProvenance: written.armProvenance,
			updatedAt: written.updatedAt,
			ownerLive: live,
			unreadDelivered: countSuffix(mailboxDir, ".msg.delivered"),
			freshUnannounced: countSuffix(mailboxDir, ".msg"),
			mailboxDir,
		});
	}
	process.stdout.write(
		`${JSON.stringify(
			{
				schemaVersion: 1,
				receiversDir: roots.receiversDir,
				mailboxDir: roots.mailboxDir,
				receivers: facts,
				unreadableMarkers: unreadable,
			},
			null,
			2,
		)}\n`,
	);
}

main();
