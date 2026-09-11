/**
 * check-codex-sender-identity — deterministic gate for the codex REQUEST-SCOPED sender rail
 * (#95 step 6, the resolver half).
 *
 * WHAT IS DIFFERENT ABOUT THIS RAIL, and therefore what this gate has to pin. Every other
 * native citizen is identified by a pid marker its hook wrote: one process, one identity, read
 * once at bridge startup. Codex cannot be: in the delivery-capable (app-server-attached) launch
 * mode every hook and every MCP child of N live threads shares ONE parent pid — the app-server
 * — so a pid marker would be one marker for N citizens, which the store's `nativeSessionId`
 * uniqueness forbids (measured 2026-09-08, `scripts/raw-codex-measure/README.md` S1b-C). The
 * caller instead names itself on EVERY `tools/call`: `_meta.threadId` plus an
 * `x-codex-turn-metadata.{session_id,thread_id}` block, and that string is byte-identical to
 * the hook's `session_id` (S1b-D / D3). So identity here is per-REQUEST, and the whole risk
 * moves with it: the wire is now an identity carrier, and a wire field is written by the caller.
 *
 * The three properties this gate exists to hold, in the order they can fail:
 *
 *   1. ADMISSION IS EXPLICIT. Provenance is an argument, never an environment read — in
 *      particular never `ENTWURF_BRIDGE_EXTERNAL_AGENT_ID`, which is omp's root-policy label
 *      with its own policy attached. A process that merely looks like codex is not codex.
 *   2. METADATA IS A SELECTOR, NOT AN IDENTITY. The `_meta` block also carries `model` and a
 *      `workspaces` map. Every field of the answer — gardenId, cwd, model, backend — comes from
 *      the RECORD; a caller that could relabel its own citizen by asking would have turned a
 *      read into a write. This gate poisons all of them and demands the record's values.
 *   3. A HALF CLAIM IS LOUD, AN ABSENT CLAIM IS `null`. The two ids are built by two different
 *      vendor call sites, and that redundancy is the only reason a wire field can select a
 *      record at all. So a claim that is present but broken (missing corroborator, three ids
 *      disagreeing) is a refusal WITH A CAUSE, while a call that never claimed identity is
 *      plain `null` and the bridge's default anonymous refusal owns it.
 *
 * The store lookup is the strict store-wide listing, so a rotten store anywhere refuses a
 * healthy thread rather than answering from a snapshot the install doctor calls uncertifiable.
 * Cells 5 and 6 pin that, including the case the strictness exists for: a DUPLICATE of this
 * very thread's id, which a lenient listing would drop and then report as "no record".
 *
 * Everything here is deterministic and store-isolated: no codex binary, no app-server, no turn.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	CODEX_BRIDGE_PROVENANCE_LABEL,
	CODEX_MCP_CLIENT_NAME,
	META_SENDER_BACKENDS,
	readCodexRequestThreadId,
	reconcileSenderIdentityClaims,
	resolveCodexRequestSenderIdentity,
	type SenderIdentityClaim,
} from "../pi-extensions/lib/meta-sender-identity.ts";
import {
	type MetaIdentity,
	metaRecordFilename,
	mintMetaIdentity,
	serializeMetaIdentity,
	upsertMetaSession,
} from "../pi-extensions/lib/meta-session.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** A refusal is only useful if it names its own cause, so both the class NAME and a phrase from
 * the message are pinned — a resolver that threw the wrong error, or degraded to `null`, fails
 * here rather than looking green because "something threw". */
function refuses(label: string, fn: () => unknown, name: string, pattern: RegExp): void {
	let caught: unknown;
	try {
		fn();
	} catch (err) {
		caught = err;
	}
	const err = caught instanceof Error ? caught : null;
	assert.ok(err, `${label} — expected a throw, got none`);
	assert.equal(err.name, name, `${label} — wrong error class (${err.message})`);
	assert.match(err.message, pattern, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// Isolated store roots — this gate never reads or writes the operator's real garden. The env
// SSOT is pointed at the temp root as well, so even a call that takes the DEFAULT store cannot
// reach the real one if a future edit forgets to pass `sessionsDir`.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-codex-sender-identity-"));
const SESSIONS_DIR = path.join(ROOT, "meta-sessions");
process.env.ENTWURF_META_SESSIONS_DIR = SESSIONS_DIR;

// Synthetic ids, deliberately not the measured live thread ids: a gate that wrote real-looking
// uuid7 threads into a log or a record would be planting evidence a later reader could mistake
// for a live measurement.
const THREAD = "00000000-gate-codex-thread-aaaa";
const OTHER_THREAD = "00000000-gate-codex-thread-bbbb";
const RECORD_CWD = "/gate/codex/record-cwd";
const RECORD_MODEL = "gate-model-from-record";

const CLIENT_INFO = { name: CODEX_MCP_CLIENT_NAME, title: "Codex", version: "0.153.4" };

/** A well-formed codex tool-call `_meta`, in the measured shape (S1b-D). `patch`/`turnPatch`
 * bend exactly one field per case so a failing assertion names one deviation. */
function callMeta(
	threadId: string,
	patch: Record<string, unknown> = {},
	turnPatch: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		callId: "exec-gate-0000",
		"x-codex-turn-metadata": {
			session_id: threadId,
			thread_id: threadId,
			turn_id: "00000000-gate-codex-turn-0001",
			turn_started_at_unix_ms: 1788877797276,
			thread_source: "user",
			sandbox: "seccomp",
			...turnPatch,
		},
		threadId,
		itemId: "ctc_gate",
		progressToken: 1,
		...patch,
	};
}

interface ResolveOverrides {
	provenance?: unknown;
	clientInfo?: unknown;
	sessionsDir?: string;
}

function resolve(requestMeta: unknown, over: ResolveOverrides = {}) {
	return resolveCodexRequestSenderIdentity({
		provenance: CODEX_BRIDGE_PROVENANCE_LABEL,
		clientInfo: CLIENT_INFO,
		sessionsDir: SESSIONS_DIR,
		requestMeta,
		...over,
	});
}

/** Write a record BESIDE the store writer, which is the only way to build the defects the
 * writer refuses to create (a duplicate native id, a corrupt body). Never used for a healthy
 * record — those go through `upsertMetaSession`, so the happy path is the production path. */
function plantRecord(dir: string, identity: MetaIdentity): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, metaRecordFilename(identity)), serializeMetaIdentity(identity));
}

try {
	// ── CELL 1 — the happy path, through the production writer ────────────────
	const born = upsertMetaSession({
		input: { backend: "codex", nativeSessionId: THREAD, cwd: RECORD_CWD, model: RECORD_MODEL },
		dir: SESSIONS_DIR,
	});
	{
		ok(
			"birth mints a codex citizen whose nativeSessionId IS the threadId (no mapping layer)",
			born.record.nativeSessionId === THREAD,
		);

		const sender = resolve(callMeta(THREAD));
		ok("a well-formed codex tool call resolves to exactly one sender", sender !== null);
		ok("the resolved citizen is the record the birth minted", sender?.identity.gardenId === born.record.gardenId);
		ok("the resolved citizen carries backend=codex", sender?.identity.backend === "codex");
		ok(
			"the selector is echoed and equals the record's nativeSessionId",
			sender?.threadId === THREAD && sender?.identity.nativeSessionId === THREAD,
		);
		ok("the answer states the provenance that admitted the rail", sender?.provenance === CODEX_BRIDGE_PROVENANCE_LABEL);

		// The pure half is the wire contract: it must answer without any store at all, which is
		// what lets the bridge validate a claim before it decides to touch the filesystem.
		ok(
			"the metadata reader is pure — it yields the threadId with no store in play",
			readCodexRequestThreadId({
				provenance: CODEX_BRIDGE_PROVENANCE_LABEL,
				clientInfo: CLIENT_INFO,
				requestMeta: callMeta(THREAD),
			}) === THREAD,
		);
	}

	// ── CELL 2 — the record is the ONLY source of identity fields ─────────────
	// Every field below is one a caller could plausibly want to steer: its cwd (workspace
	// relabelling), its model (grade inflation), its garden id (impersonation). All three are
	// present in the real `_meta` shape, and all three are ignored.
	{
		const poisoned = callMeta(
			THREAD,
			{
				cwd: "/gate/poison/from-the-wire",
				model: "poison-model-from-the-wire",
				gardenId: "20200101T000000-abcdef",
				backend: "pi",
			},
			{
				model: "poison-model-from-turn-metadata",
				workspaces: { "/gate/poison/workspace": { latest_git_commit_hash: "deadbeef" } },
				cwd: "/gate/poison/turn-cwd",
			},
		);
		const sender = resolve(poisoned);
		ok("poisoned metadata still resolves (it is a selector, not a veto)", sender !== null);
		ok("cwd comes from the record, never from `_meta` or the workspaces map", sender?.identity.cwd === RECORD_CWD);
		ok("model comes from the record, never from the turn metadata", sender?.identity.model === RECORD_MODEL);
		ok(
			"gardenId comes from the record — a wire-supplied garden id cannot impersonate",
			sender?.identity.gardenId === born.record.gardenId,
		);
		ok(
			"backend comes from the record — a wire-supplied backend cannot switch rails",
			sender?.identity.backend === "codex",
		);
	}
	ok(
		"no provenance → null (admission is explicit, never inferred)",
		resolve(callMeta(THREAD), { provenance: undefined }) === null,
	);
	ok(
		"a foreign provenance namespace → null (`external-mcp/codex` is not this label)",
		resolve(callMeta(THREAD), { provenance: "external-mcp/codex" }) === null,
	);
	ok("another host's provenance → null", resolve(callMeta(THREAD), { provenance: "external-mcp/omp" }) === null);
	ok("a truthy non-string provenance → null", resolve(callMeta(THREAD), { provenance: true }) === null);

	// The env label is omp's root-policy atom and carries policy of its own. Setting it here
	// proves the codex rail cannot be opened by an environment a native host may hand down.
	process.env.ENTWURF_BRIDGE_EXTERNAL_AGENT_ID = CODEX_BRIDGE_PROVENANCE_LABEL;
	process.env.ENTWURF_BRIDGE_NATIVE_HOST = CODEX_BRIDGE_PROVENANCE_LABEL;
	ok(
		"ENTWURF_BRIDGE_EXTERNAL_AGENT_ID / ENTWURF_BRIDGE_NATIVE_HOST in the env open NOTHING — the resolver reads no env",
		resolve(callMeta(THREAD), { provenance: undefined }) === null,
	);
	delete process.env.ENTWURF_BRIDGE_EXTERNAL_AGENT_ID;
	delete process.env.ENTWURF_BRIDGE_NATIVE_HOST;

	ok("no clientInfo → null", resolve(callMeta(THREAD), { clientInfo: undefined }) === null);
	ok(
		"a non-codex client name → null (host kind is a gate, and it is checked)",
		resolve(callMeta(THREAD), { clientInfo: { name: "smoke", version: "0" } }) === null,
	);
	ok(
		"the client name as a bare string, not an object → null",
		resolve(callMeta(THREAD), { clientInfo: CODEX_MCP_CLIENT_NAME }) === null,
	);
	ok(
		"clientInfo as an array → null (an array is not a JSON object)",
		resolve(callMeta(THREAD), { clientInfo: [CLIENT_INFO] }) === null,
	);

	ok("no `_meta` at all → null (initialize / tools-list shape)", resolve(undefined) === null);
	ok("`_meta` null → null", resolve(null) === null);
	ok("`_meta` a string → null", resolve("threadId") === null);
	ok("`_meta` an array → null", resolve([callMeta(THREAD)]) === null);
	ok(
		"`_meta` present with NO threadId member → null (a call that never claimed identity)",
		resolve({ callId: "exec-gate-0000", progressToken: 1 }) === null,
	);

	ok(
		"a well-formed claim for a thread no record holds → null (the pre-birth window)",
		resolve(callMeta(OTHER_THREAD)) === null,
	);
	ok(
		"an absent store → null (a host with no generation is not a broken host)",
		resolve(callMeta(THREAD), { sessionsDir: path.join(ROOT, "never-existed") }) === null,
	);

	// ── CELL 4 — a PRESENT claim that does not hold together is loud ──────────
	// The line between cell 3 and cell 4 is the presence of `threadId`: absent is silence,
	// present-but-unusable is a broken claim, and folding them would report "no identity" for a
	// caller that named itself.
	{
		const bad =
			(patch: Record<string, unknown>, turnPatch: Record<string, unknown> = {}) =>
			() =>
				resolve(callMeta(THREAD, patch, turnPatch));

		refuses(
			"threadId empty string → loud",
			bad({ threadId: "" }),
			"EntwurfCodexIdentityMetadataError",
			/not a nonempty string/,
		);
		refuses(
			"threadId a number → loud",
			bad({ threadId: 42 }),
			"EntwurfCodexIdentityMetadataError",
			/not a nonempty string \(got number 42\)/,
		);
		refuses(
			"threadId null → loud",
			bad({ threadId: null }),
			"EntwurfCodexIdentityMetadataError",
			/not a nonempty string \(got null\)/,
		);
		refuses(
			"the corroborating turn-metadata block absent → loud (one id alone is a half claim)",
			bad({ "x-codex-turn-metadata": undefined }),
			"EntwurfCodexIdentityMetadataError",
			/x-codex-turn-metadata` is undefined, not an object/,
		);
		refuses(
			"the turn-metadata block a string → loud",
			bad({ "x-codex-turn-metadata": "session_id=…" }),
			"EntwurfCodexIdentityMetadataError",
			/not an object/,
		);
		refuses(
			"session_id missing → loud (that field is the one the birth hook also sees)",
			bad({}, { session_id: undefined }),
			"EntwurfCodexIdentityMetadataError",
			/session_id` is not a nonempty string/,
		);
		refuses(
			"session_id a number → loud",
			bad({}, { session_id: 7 }),
			"EntwurfCodexIdentityMetadataError",
			/session_id` is not a nonempty string/,
		);
		refuses(
			"thread_id missing → loud",
			bad({}, { thread_id: undefined }),
			"EntwurfCodexIdentityMetadataError",
			/thread_id` is not a nonempty string/,
		);
		refuses(
			"an outer threadId that disagrees with the block → loud, never resolved from either",
			bad({ threadId: OTHER_THREAD }),
			"EntwurfCodexIdentityMetadataError",
			/the three ids disagree/,
		);
		refuses(
			"a block whose thread_id disagrees with its own session_id → loud",
			bad({}, { thread_id: OTHER_THREAD }),
			"EntwurfCodexIdentityMetadataError",
			/the three ids disagree/,
		);
		// The sharpest case: the disagreeing id is one a record DOES hold, so a resolver that
		// preferred either field would have found a citizen and sent under it.
		{
			const otherBorn = upsertMetaSession({
				input: { backend: "codex", nativeSessionId: OTHER_THREAD, cwd: RECORD_CWD },
				dir: SESSIONS_DIR,
			});
			ok("a second codex citizen exists for the disagreeing id", otherBorn.record.nativeSessionId === OTHER_THREAD);
			refuses(
				"disagreeing ids refuse even when BOTH name real citizens (no field wins by priority)",
				bad({ threadId: OTHER_THREAD }),
				"EntwurfCodexIdentityMetadataError",
				/the three ids disagree/,
			);
			fs.rmSync(path.join(SESSIONS_DIR, metaRecordFilename(otherBorn.record)));
		}
	}

	// ── CELL 5 — the threadId selects a record that is not a codex citizen ────
	{
		const foreignStore = path.join(ROOT, "store-foreign");
		plantRecord(foreignStore, mintMetaIdentity({ backend: "claude-code", nativeSessionId: THREAD, cwd: RECORD_CWD }));
		refuses(
			"a threadId bound to another backend → loud (never `null`, never the foreign citizen)",
			() => resolve(callMeta(THREAD), { sessionsDir: foreignStore }),
			"EntwurfCodexIdentityBackendError",
			/backend is "claude-code", not "codex"/,
		);

		// A pi citizen is the same defect with the backend that is NOT even a v2 native host —
		// pinned because `pi` is in the citizen set but not in `META_BACKENDS`.
		const piStore = path.join(ROOT, "store-pi");
		plantRecord(piStore, mintMetaIdentity({ backend: "pi", nativeSessionId: THREAD, cwd: RECORD_CWD }));
		refuses(
			"a threadId bound to a pi citizen → loud on the same rule",
			() => resolve(callMeta(THREAD), { sessionsDir: piStore }),
			"EntwurfCodexIdentityBackendError",
			/backend is "pi", not "codex"/,
		);
	}

	// ── CELL 6 — the store lookup is the STRICT store-wide certification ──────
	{
		// (a) A duplicate of THIS thread's id. This is the case the strictness exists for: a
		// lenient listing drops both rivals, and the resolver would then answer `null` — "no
		// record for your thread" — for a store that in fact holds two.
		const dupStore = path.join(ROOT, "store-duplicate");
		plantRecord(
			dupStore,
			mintMetaIdentity(
				{ backend: "codex", nativeSessionId: THREAD, cwd: RECORD_CWD },
				new Date("2026-01-01T00:00:00Z"),
			),
		);
		plantRecord(
			dupStore,
			mintMetaIdentity(
				{ backend: "codex", nativeSessionId: THREAD, cwd: RECORD_CWD },
				new Date("2026-02-02T00:00:00Z"),
			),
		);
		ok("the duplicate store really holds two records", fs.readdirSync(dupStore).length === 2);
		refuses(
			"two records claiming this threadId → loud, never a `null` that reads as 'no record'",
			() => resolve(callMeta(THREAD), { sessionsDir: dupStore }),
			"MetaRecordError",
			/duplicate nativeSessionId/,
		);

		// (b) A rotten record ELSEWHERE in the store. The codex thread's own record is healthy,
		// and it still refuses: an uncertifiable store is not a store to take an address from.
		const rottenStore = path.join(ROOT, "store-rotten");
		plantRecord(rottenStore, mintMetaIdentity({ backend: "codex", nativeSessionId: THREAD, cwd: RECORD_CWD }));
		fs.writeFileSync(path.join(rottenStore, "20200101T000000-abcdef.meta.json"), "{ not json");
		refuses(
			"a rotten record elsewhere in the store refuses a HEALTHY thread (store-wide strictness)",
			() => resolve(callMeta(THREAD), { sessionsDir: rottenStore }),
			"MetaRecordError",
			/unreadable meta-record/,
		);

		// (c) The store path is not a directory at all — the ENOTDIR shape that must never
		// launder into "certified empty".
		const notADir = path.join(ROOT, "store-is-a-file");
		fs.writeFileSync(notADir, "not a store\n");
		refuses(
			"a non-directory store path → loud (an unreadable store is not an empty one)",
			() => resolve(callMeta(THREAD), { sessionsDir: notADir }),
			"MetaRecordError",
			/failure to inspect the store/,
		);
	}

	// ── CELL 7 — conflict-ready output for the later MCP integration ──────────
	// The bridge will hold up to three claims at once (pi env, the pid marker, this request).
	// Reconciliation is order-independent by construction: agreement returns one address with
	// every rail that named it, disagreement refuses, and no rail wins by position.
	{
		const codexClaim: SenderIdentityClaim = { rail: "codex-request", id: born.record.gardenId };
		const markerClaim: SenderIdentityClaim = { rail: "meta-sender-marker", id: born.record.gardenId };
		const piClaim: SenderIdentityClaim = { rail: "pi-session", id: "20200101T000000-000001" };

		ok(
			"no claims → null (anonymous; the bridge's default refusal owns that)",
			reconcileSenderIdentityClaims([]) === null,
		);

		const single = reconcileSenderIdentityClaims([codexClaim]);
		ok(
			"one claim → that address, naming its rail",
			single?.id === born.record.gardenId && single?.rails.join(",") === "codex-request",
		);

		const agreed = reconcileSenderIdentityClaims([markerClaim, codexClaim]);
		const agreedReversed = reconcileSenderIdentityClaims([codexClaim, markerClaim]);
		ok(
			"two rails AGREEING is not a conflict — one address, both rails",
			agreed?.id === born.record.gardenId && agreed?.rails.join(",") === "codex-request,meta-sender-marker",
		);
		ok(
			"the answer does not depend on the order the claims were collected in",
			JSON.stringify(agreed) === JSON.stringify(agreedReversed),
		);
		ok(
			"a rail naming the same address twice is de-duplicated, not counted twice",
			reconcileSenderIdentityClaims([codexClaim, codexClaim])?.rails.join(",") === "codex-request",
		);

		refuses(
			"two rails naming DIFFERENT addresses → loud, naming both rails and both ids",
			() => reconcileSenderIdentityClaims([piClaim, codexClaim]),
			"EntwurfSenderIdentityConflictError",
			/pi-session=20200101T000000-000001, codex-request=/,
		);
		refuses(
			"two agreeing rails plus one dissenter still refuses (majority is not authority)",
			() => reconcileSenderIdentityClaims([markerClaim, codexClaim, piClaim]),
			"EntwurfSenderIdentityConflictError",
			/conflicting sender identity/,
		);
	}
	ok(
		"`codex` is NOT in META_SENDER_BACKENDS — codex birth writes no pid marker, so the marker scan must never look for one",
		!(META_SENDER_BACKENDS as readonly string[]).includes("codex"),
	);
	ok(
		"the provenance label is the codex host atom, not an `external-mcp/*` namespace",
		CODEX_BRIDGE_PROVENANCE_LABEL === "codex",
	);
	ok("the client-kind gate pins the vendor literal", CODEX_MCP_CLIENT_NAME === "codex-mcp-client");

	console.log(`\ncheck-codex-sender-identity: ${passed} checks passed`);
} finally {
	fs.rmSync(ROOT, { recursive: true, force: true });
}
