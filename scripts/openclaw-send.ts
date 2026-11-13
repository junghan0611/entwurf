#!/usr/bin/env node
/**
 * openclaw-send — `entwurf openclaw-send --decl <absolute file>` (#160 S2 card §3).
 *
 * The OpenClaw plugin's send tool runs this once per call with one JSON claim on stdin. This entry
 * reads THIS host's scope declaration once, checks the claim against it, joins the claim to exactly
 * one `openclaw` V3 record in the certified store, and hands the record-backed sender to the existing
 * v2 dispatch. The decision half and the trust model are in pi-extensions/lib/openclaw-send.ts.
 *
 * Scope: `--decl` must name THIS host's declaration (`openclawCitizensPath()`), absolute and
 * normalized-equal; any other path — even a valid declaration — is exit 2. The plugin carries the
 * path only so the argv shape is explicit; it selects nothing.
 *
 * replyable: the receive rail's own answer for the joined record — the OpenClaw native-push probe
 * alive and the backend not paused (who-sent ≠ replyable).
 *
 * EXIT CONTRACT (stdout carries a JSON receipt line only where named; remote-pair numbering):
 *   0 dispatched, the dispatch did not report an error — receipt
 *   4 dispatched, the dispatch reported an error — receipt
 *   3 refused by scope (`openclaw-scope-not-declared`) or record join
 *     (`openclaw-sender-not-citizen`), no dispatch ran — receipt
 *   2 --decl is not this host's declaration, the declaration is absent/broken, or the claim is
 *     invalid; no dispatch ran — `{kind:"invalid"}` receipt; wrong argv is also 2 with usage on
 *     stderr and no receipt
 *   1 an uncaught dispatch/store throw (crash, don't warn) — no receipt; the plugin reads it as
 *     indeterminate
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { nativePushPaused } from "../pi-extensions/lib/entwurf-v2-contract.ts";
import { runAndRenderEntwurfV2FromSurface } from "../pi-extensions/lib/entwurf-v2-surface.ts";
import {
	defaultMetaSessionsDir,
	listAllMetaIdentities,
	makeStoreRecordReader,
	readActiveStoreEntries,
} from "../pi-extensions/lib/meta-session.ts";
import { resolveNativePushAdapter } from "../pi-extensions/lib/native-push/adapter.ts";
import {
	type OpenclawCitizensDeclaration,
	openclawCitizensPath,
	readOpenclawCitizens,
} from "../pi-extensions/lib/openclaw-citizens.ts";
import {
	OPENCLAW_BACKEND,
	type OpenclawClaim,
	type OpenclawSendReceipt,
	openclawSendExitCode,
	parseOpenclawClaim,
	receiveOpenclawClaim,
} from "../pi-extensions/lib/openclaw-send.ts";

function emit(receipt: OpenclawSendReceipt): never {
	process.stdout.write(`${JSON.stringify(receipt)}\n`);
	process.exit(openclawSendExitCode(receipt));
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--decl") {
	console.error("usage: entwurf openclaw-send --decl <this host's openclaw-citizens.json>  (claim JSON on stdin)");
	process.exit(2);
}
const declFile = args[1];

let decl: OpenclawCitizensDeclaration;
let claim: OpenclawClaim;
try {
	const own = openclawCitizensPath();
	if (!path.isAbsolute(declFile) || path.normalize(declFile) !== own) {
		throw new Error(`--decl must be this host's declaration ${own} (got ${declFile})`);
	}
	const read = readOpenclawCitizens(own);
	if (read === null) throw new Error(`this host has no openclaw citizens declaration (${own} is absent)`);
	decl = read;
	claim = parseOpenclawClaim(readFileSync(0, "utf8"));
} catch (err) {
	emit({ kind: "invalid", detail: err instanceof Error ? err.message : String(err) });
}

const dir = defaultMetaSessionsDir();
const receipt = await receiveOpenclawClaim(claim, decl, {
	// The strict store-wide listing, as the codex request join uses: a duplicate or unreadable
	// neighbour refuses (uncaught → exit 1) instead of disappearing from the join.
	listIdentities: () =>
		listAllMetaIdentities(readActiveStoreEntries(dir), makeStoreRecordReader(dir), { mode: "strict" }).identities,
	replyable: async (record) => {
		if (nativePushPaused(OPENCLAW_BACKEND)) return false;
		return (await resolveNativePushAdapter(OPENCLAW_BACKEND).probe(record.nativeSessionId)).status === "alive";
	},
	dispatch: (params, sender) => runAndRenderEntwurfV2FromSurface(params, { senderProvider: () => sender }),
});
emit(receipt);
