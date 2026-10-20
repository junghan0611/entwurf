#!/usr/bin/env node
/**
 * remote-pair-receive — `entwurf remote-pair-receive --pair <absolute file>` (#107 rail 1).
 *
 * The receiving host's entry for one declared remote pair. The sending host runs it over one
 * SSH call and writes one JSON claim to stdin. This entry reads the operator-named pair
 * declaration once, applies the pair scope check, and hands a matching claim to the existing
 * v2 dispatch. The scope and trust model are in pi-extensions/lib/remote-pair-receive.ts.
 *
 * Scope: `--pair` must name THIS host's own opt-in file (`remotePairOptInPath()`), absolute and
 * normalized-equal; any other path — even a valid declaration — is exit 2. That one file is the pair
 * this host accepts and, because it names the sender's host as its route, the declared route back.
 * The sender's declaration carries the path only so the argv shape is explicit; it selects nothing.
 *
 * EXIT CONTRACT (stdout carries a JSON receipt line only where named):
 *   0 dispatched, the dispatch did not report an error — receipt on stdout
 *   4 dispatched, the dispatch reported an error (its text says what is known, e.g. a
 *     rejection or `retry-safe: false` after a possible write) — receipt
 *   3 refused by the pair scope check, no dispatch ran — receipt
 *   2 --pair is not this host's opt-in, the opt-in is absent/broken, or the claim is invalid; no
 *     dispatch ran — `{kind:"invalid"}` receipt;
 *     wrong argv is ALSO 2 but prints usage on stderr only, with no receipt
 *   1 an uncaught dispatch/store throw (crash, don't warn) — no receipt; stderr carries the
 *     error. The sending host reads that as indeterminate.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runAndRenderEntwurfV2FromSurface } from "../pi-extensions/lib/entwurf-v2-surface.ts";
import {
	parseRemoteClaim,
	type RemotePairDeclaration,
	type RemoteReceiveReceipt,
	receiveRemoteClaim,
} from "../pi-extensions/lib/remote-pair-receive.ts";
import { readRemotePairOptIn, remotePairOptInPath } from "../pi-extensions/lib/remote-pair-send.ts";

function emit(receipt: RemoteReceiveReceipt | { kind: "invalid"; detail: string }, code: number): never {
	process.stdout.write(`${JSON.stringify(receipt)}\n`);
	process.exit(code);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--pair") {
	console.error("usage: entwurf remote-pair-receive --pair <this host's opt-in file>  (claim JSON on stdin)");
	process.exit(2);
}
const pairFile = args[1];

let decl: RemotePairDeclaration;
let claim: ReturnType<typeof parseRemoteClaim>;
try {
	// The scope is THIS host's own opt-in, never a file the sender picks: `--pair` must name it
	// exactly (absolute, normalized), and that one file is read for this receive.
	const own = remotePairOptInPath();
	if (!path.isAbsolute(pairFile) || path.normalize(pairFile) !== own) {
		throw new Error(`--pair must be this host's opt-in file ${own} (got ${pairFile})`);
	}
	const route = readRemotePairOptIn(own);
	if (route === null) throw new Error(`this host has no remote pair opt-in (${own} is absent)`);
	decl = { remoteGardenId: route.remoteGardenId, ssh: route.ssh, localGardenId: route.localGardenId };
	claim = parseRemoteClaim(readFileSync(0, "utf8"));
} catch (err) {
	emit({ kind: "invalid", detail: err instanceof Error ? err.message : String(err) }, 2);
}

const receipt = await receiveRemoteClaim(claim, decl, {
	dispatch: (params, sender) => runAndRenderEntwurfV2FromSurface(params, { senderProvider: () => sender }),
	// The scope file IS this host's own opt-in, and it names the sender's host as its route: a
	// matching claim always has a declared route back. Declared, not probed.
	replyRoute: "declared",
});
emit(receipt, receipt.kind === "rejected" ? 3 : receipt.isError ? 4 : 0);
