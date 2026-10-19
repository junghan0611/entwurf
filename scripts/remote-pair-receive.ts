#!/usr/bin/env node
/**
 * remote-pair-receive — `entwurf remote-pair-receive --pair <absolute file>` (#107 rail 1).
 *
 * The receiving host's entry for one declared remote pair. The sending host runs it over one
 * SSH call and writes one JSON claim to stdin. This entry reads the operator-named pair
 * declaration once, applies the pair scope check, and hands a matching claim to the existing
 * v2 dispatch. The scope and trust model are in pi-extensions/lib/remote-pair-receive.ts.
 *
 * The declaration path is an operator-named ABSOLUTE regular file. Nothing is discovered: no
 * default location, no environment override.
 *
 * EXIT CONTRACT (stdout carries a JSON receipt line only where named):
 *   0 dispatched, the dispatch did not report an error — receipt on stdout
 *   4 dispatched, the dispatch reported a non-delivery (its text names the reject) — receipt
 *   3 refused by the pair scope check, no dispatch ran — receipt
 *   2 unreadable declaration or invalid claim, no dispatch ran — `{kind:"invalid"}` receipt;
 *     wrong argv is ALSO 2 but prints usage on stderr only, with no receipt
 *   1 an uncaught dispatch/store throw (crash, don't warn) — no receipt; stderr carries the
 *     error. The sending host reads that as indeterminate.
 */

import { lstatSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { runAndRenderEntwurfV2FromSurface } from "../pi-extensions/lib/entwurf-v2-surface.ts";
import {
	parseRemoteClaim,
	parseRemotePairDeclaration,
	type RemoteReceiveReceipt,
	receiveRemoteClaim,
} from "../pi-extensions/lib/remote-pair-receive.ts";

function emit(receipt: RemoteReceiveReceipt | { kind: "invalid"; detail: string }, code: number): never {
	process.stdout.write(`${JSON.stringify(receipt)}\n`);
	process.exit(code);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--pair") {
	console.error("usage: entwurf remote-pair-receive --pair <absolute declaration file>  (claim JSON on stdin)");
	process.exit(2);
}
const pairFile = args[1];

let declText: string;
let claimText: string;
try {
	if (!path.isAbsolute(pairFile)) throw new Error(`--pair must be an absolute path (got ${pairFile})`);
	const st = lstatSync(pairFile);
	if (!st.isFile()) throw new Error(`--pair must name a regular non-symlink file (${pairFile})`);
	declText = readFileSync(pairFile, "utf8");
	claimText = readFileSync(0, "utf8");
} catch (err) {
	emit({ kind: "invalid", detail: err instanceof Error ? err.message : String(err) }, 2);
}

let decl: ReturnType<typeof parseRemotePairDeclaration>;
let claim: ReturnType<typeof parseRemoteClaim>;
try {
	decl = parseRemotePairDeclaration(declText);
	claim = parseRemoteClaim(claimText);
} catch (err) {
	emit({ kind: "invalid", detail: err instanceof Error ? err.message : String(err) }, 2);
}

const receipt = await receiveRemoteClaim(claim, decl, {
	dispatch: (params, sender) => runAndRenderEntwurfV2FromSurface(params, { senderProvider: () => sender }),
});
emit(receipt, receipt.kind === "rejected" ? 3 : receipt.isError ? 4 : 0);
