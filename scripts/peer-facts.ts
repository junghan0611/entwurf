#!/usr/bin/env node
/**
 * peer-facts — the read-only JSON projection of the OBSERVED peer listing (#116 M2-a).
 *
 * `meta-facts` (#65) emits what the meta-record STORE owns. This emits what the fact
 * PROVIDER owns: the same `listEntwurfFacts` assembly `entwurf_peers` renders, serialized
 * instead of drawn. It exists for the same reason #65 exists — so a consumer stops
 * carrying a decaying copy of a join it does not own.
 *
 * THE COPY THIS REFUSES. The placement axis joins a herdr pane to a citizen on
 * `nativeSessionId`, and on the pi side that key is recovered from a session FILENAME by a
 * strict conversion measured against one vendor floor (`herdr-placement.ts`
 * piNativeSessionIdFromPath). A consumer that re-implements that join forks a vendor floor
 * into a file no gate covers and no document owns (`docs/mux-launch-rail.md` §7). With this
 * verb the consumer's whole join becomes ONE opaque pane-id string equality, which is a
 * thing a shell script may correctly do.
 *
 * ONE PROVIDER, ONE RENDERER, NO SECOND JOIN. The payload is `renderEntwurfPeers().payload`
 * — the same provider (`listEntwurfFacts`) through the same renderer the MCP `entwurf_peers`
 * surface uses, so the SHAPE is that surface's payload shape and each row is a `PeerFact`
 * whose keyset `check-entwurf-peers-surface` pins to `{peers, diagnostics}`. Nothing here
 * recomputes, filters, re-sorts or re-words a provider fact, and nothing here re-implements
 * the join.
 *
 * It is NOT the same bytes as an `entwurf_peers` call, and the difference is deliberate, not
 * a drift: that surface is a human listing, so it passes `observationLimit` and returns only
 * rendered TEXT over the wire. This is a machine projection, so its observation is
 * UNBOUNDED — a rationed row would say `unobserved`, which a machine consumer cannot tell
 * apart from "nobody could look". Older rows can therefore read `exists`/`active` here where
 * the human surface says `unobserved`. Same facts, measured for more rows.
 *
 * `placement` STAYS STRUCTURED. The human surface prints `herdr <pane>` so a reader never
 * mistakes a pane id for one of ours; a machine consumer needs the tagged union itself
 * (`{kind:"herdr-pane",paneId}` / `unobserved` / `none` / `ambiguous`), so `renderPlacement`
 * is NOT applied here. A pane is an ephemeral view (Hard Rule 16), never an address.
 *
 * WHAT IS DELIBERATELY ABSENT. No herdr `agent_status`, no `interactive_ready`, no screen
 * text: those are herdr's own display verdicts, they are not delivery evidence
 * (`docs/herdr-launch-rail.md` §9), and keeping them out of every entwurf payload is what
 * makes "observed activity" unable to drift into delivery liveness. A consumer that wants
 * to show them reads herdr itself and labels them as herdr's report.
 *
 * ONE PLACEMENT READ. `readPlacementIndex` is left undefined, so the provider performs its
 * own single read per listing — the anti-watcher shape `entwurf-fact-provider.ts` documents.
 * This verb never loops, retries, or waits for a pane whose session reference has not landed.
 *
 * NO SOCKET COORDINATE LEAVES THIS VERB. `ENTWURF_DIR` selects the socket world that is
 * PROBED, and that is all it does: the control dir is never emitted. #50 C4 retired the
 * legacy `sessions` projection "with the `controlDir` it exposed" because the record is the
 * sole address axis and socket paths are dispatch-internal transport
 * (`entwurf-peers-render.ts` header). Re-publishing that path under a new verb would undo
 * that retirement, and no renderer needs it.
 *
 * stdout (deterministic, 2-space indent, trailing newline):
 *   {
 *     "schemaVersion": 1,        // of THIS projection
 *     "storeDir":    "/abs",     // the meta-record store that was read
 *     "peers":       [ <PeerFact, verbatim, provider order> ],
 *     "diagnostics": [ <EntwurfDiagnostic, verbatim> ]
 *   }
 *
 * EXIT CONTRACT — identical in shape to meta-facts, for the same reason:
 *   0 — the store was readable; the JSON above is on stdout (diagnostics in-band).
 *       A store that does not exist is a readable EMPTY store (ENOENT only).
 *   2 — usage error (bad argv).
 *   3 — the store could not be READ. No JSON is emitted: an unreadable host must
 *       never look like an empty one.
 * A provider wiring invariant (duplicate identity / unprobed in-domain citizen) is left to
 * THROW. It is not an unreadable store and must not be dressed as one (Hard Rule 15).
 */

import os from "node:os";
import { defaultControlSocketDir } from "../pi-extensions/lib/control-socket-path.js";
import { listEntwurfFacts } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import { renderEntwurfPeers } from "../pi-extensions/lib/entwurf-peers-render.ts";
import {
	type ActiveStoreEntry,
	defaultMetaSessionsDir,
	makeStoreRecordReader,
	readActiveStoreEntries,
} from "../pi-extensions/lib/meta-session.ts";

const arg = process.argv[2];
// A dash argv is a flag this command does not have, not a store directory — treating it as
// a path would answer `--help` with "empty store, exit 0", a silent wrong fact.
if (process.argv.length > 3 || (arg !== undefined && arg.startsWith("-"))) {
	console.error("usage: entwurf peer-facts [meta-sessions-dir]");
	process.exit(2);
}

const storeDir = arg ?? defaultMetaSessionsDir();
// The SAME override the bridge honours (`mcp/entwurf-bridge/src/index.ts` ENTWURF_DIR), so
// this verb and `entwurf_peers` probe one socket world. The pi side has no such override;
// the path grammar is the shared leaf either way. This value is an INPUT to the probe and
// never an output — see NO SOCKET COORDINATE LEAVES THIS VERB above.
const controlDir = process.env.ENTWURF_DIR ?? defaultControlSocketDir(os.homedir());

let metaEntries: ActiveStoreEntry[];
try {
	// Entries WITH their kind, never bare names: the listing must be able to refuse a
	// symlinked record without following it (Hard Rule 7). ENOENT is the empty store.
	metaEntries = readActiveStoreEntries(storeDir);
} catch (err) {
	console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(3); // see the EXIT CONTRACT above: 3 = unreadable store, never an empty one
}

const result = await listEntwurfFacts({
	metaEntries,
	readRecord: makeStoreRecordReader(storeDir),
	socket: { dir: controlDir },
	// No `observationLimit`: a budget would emit `unobserved` for rows nobody chose to
	// skip, and in a machine payload that is indistinguishable from "no herdr here". The
	// human surface may ration its own rows; a projection may not ration its facts.
});

const { payload } = renderEntwurfPeers(result);
const projection = { schemaVersion: 1, storeDir, ...payload };

process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
