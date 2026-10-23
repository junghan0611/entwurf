/**
 * #152 — antigravity native-push is PAUSED, proven beside the policy it pins.
 *
 * On the external send path entwurf measured (agy 1.2.16 in #128, agy 1.4.6 again here), agy's
 * language server refused the `agentapi` call with `Unauthenticated: missing CSRF token`. Whether
 * a first-party own-tool shell holds a token entwurf could legitimately present is UNMEASURED; this
 * pause does not claim it is impossible. So the three public entries that would reach the agy LS
 * refuse by name BEFORE any probe: v2 dispatch, a sender's own `replyable`, and
 * `entwurf_register_native`. One fixed constant (`NATIVE_PUSH_PAUSED_BACKENDS`) drives all three.
 *
 * The QK cell is an IO oracle, not a constant read: it RUNS all three entries first and records
 * what each one returned, what it threw and which IO seam it reached, then judges every
 * observation at the end. So emptying the constant reaches the trapped seams on every path and
 * the cell fails on what those paths actually did — no early assertion stops the later paths
 * from running.
 *
 * The agy citizen here is a REAL record minted through the production upsert into a temp store, so
 * "no record write" is a byte comparison of that store, not an assumption. Every IO seam the paused
 * path must not reach is a trap that counts and throws. Codex — the native-push backend that is
 * not paused — is driven through dispatch and sender replyable and must still probe and succeed.
 *
 * Not covered here: the fresh-cut quiescence probe, which is deliberately NOT behind the pause (it
 * protects an operator-named archive and keeps failing closed).
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeSelfAddressability } from "../entwurf-self-address.ts";
import { nativePushPaused } from "../entwurf-v2-contract.ts";
import { type DispatchDeciderDeps, type DispatchDecision, decideDispatch } from "../entwurf-v2-decider.ts";
import { probeNativeSenderAlive } from "../meta-sender-identity.ts";
import { type MetaIdentity, readMetaIdentityByGardenId, upsertMetaSession } from "../meta-session.ts";
import type { NativePushAdapter, NativePushProbeResult } from "./adapter.ts";
import { registerNativeConversation } from "./register.ts";

let dir = "";

beforeEach(() => {
	dir = mkdtempSync(path.join(os.tmpdir(), "entwurf-paused-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Every file in the temp store with its bytes — the "no record write" oracle. */
function storeBytes(): string {
	return readdirSync(dir)
		.sort()
		.map((f) => `${f}\n${readFileSync(path.join(dir, f), "utf8")}`)
		.join("\n---\n");
}

function mint(backend: "antigravity" | "codex", nativeSessionId: string): MetaIdentity {
	const { record } = upsertMetaSession({
		input: { backend, nativeSessionId, cwd: "/work/paused", model: null, transcriptPath: null },
		dir,
	});
	return readMetaIdentityByGardenId(record.gardenId, dir);
}

interface Counters {
	io: string[];
	probes: number;
}

/** Decider deps where every seam the paused path must not reach throws and is counted. */
function deciderDeps(
	identity: MetaIdentity,
	counters: Counters,
	nativePush: NativePushProbeResult,
): DispatchDeciderDeps {
	const trap = (name: string) => () => {
		counters.io.push(name);
		throw new Error(`paused gate: ${name} must not be reached`);
	};
	return {
		resolveTarget: () => ({ identity, preProbeAddressConflict: false }),
		acquireLock: trap("acquireLock"),
		releaseLock: trap("releaseLock"),
		inspectSocket: trap("inspectSocket"),
		probeSocket: trap("probeSocket"),
		mailboxDeliverabilityFor: trap("mailboxDeliverabilityFor"),
		nativePushProbe: () => {
			counters.probes++;
			return nativePush;
		},
		mailboxDir: path.join(dir, "mailbox"),
		sessionsDir: dir,
	};
}

/** An adapter resolver that counts and refuses — the paused path must never resolve one. */
function trapResolver(counters: Counters): (backend: string) => NativePushAdapter {
	return (backend: string) => {
		counters.io.push(`resolveAdapter(${backend})`);
		throw new Error("paused gate: no native-push adapter may be resolved for a paused backend");
	};
}

function aliveResolver(counters: Counters): (backend: string) => NativePushAdapter {
	return () => ({
		id: "codex",
		retriable: false,
		async probe() {
			counters.probes++;
			return { status: "alive", route: { backend: "codex", socketPath: "/tmp/gate-codex.sock" } };
		},
		async send() {
			throw new Error("paused gate: send must not be called by these entries");
		},
	});
}

/** What one entry did: its value, or the message it threw. Nothing is swallowed — both are judged. */
type Outcome<T> = { value: T; error: null } | { value: null; error: string };

async function observe<T>(run: () => Promise<T> | T): Promise<Outcome<T>> {
	try {
		return { value: await run(), error: null };
	} catch (err) {
		return { value: null, error: err instanceof Error ? err.message : String(err) };
	}
}

describe("#152 agy native-push pause", () => {
	it("[QK:AGY-NATIVE-PUSH-PAUSED] dispatch, sender replyable and register all refuse agy before any probe, with zero IO and zero record writes", async () => {
		const agy = mint("antigravity", "conv-paused");
		const before = storeBytes();

		// RUN all three public entries first; judge them only after every one has run.
		// 1. v2 dispatch — the probe fake answers ALIVE, so a dispatch that reached it would execute.
		const d: Counters = { io: [], probes: 0 };
		const dispatch: Outcome<DispatchDecision> = await observe(() =>
			decideDispatch(
				{ target: agy.gardenId, intent: "fire-and-forget", message: "hello" },
				deciderDeps(agy, d, { status: "alive", route: { backend: "antigravity", lsAddress: "127.0.0.1:1" } }),
			),
		);
		// 2. a sender's own replyable — a resolved adapter would hit the trap and throw.
		const s: Counters = { io: [], probes: 0 };
		const sender = await observe(() => probeNativeSenderAlive(agy, { resolveAdapter: trapResolver(s) }));
		// 3. entwurf_register_native — a register that reached the adapter would hit the trap.
		const r: Counters = { io: [], probes: 0 };
		const register = await observe(() =>
			registerNativeConversation(
				{ backend: "antigravity", nativeSessionId: "conv-new", cwd: "/work/paused" },
				{ resolveAdapter: trapResolver(r), sessionsDir: dir },
			),
		);
		const after = storeBytes();
		const self = computeSelfAddressability({
			origin: "meta-session",
			metaDeliveryDomain: "native-push",
			recordBacked: true,
			probeAlive: sender.value === true,
			nativePushPaused: nativePushPaused(agy.backend),
		});

		// JUDGE every observation together, so one failure cannot hide the others.
		const receipt = dispatch.value?.kind === "reject" ? dispatch.value.receipt : null;
		expect({
			dispatch: {
				error: dispatch.error,
				kind: dispatch.value?.kind ?? null,
				reason: receipt?.reason ?? null,
				observedLiveness: receipt === null ? "no reject receipt" : receipt.observedLiveness,
				probes: d.probes,
				io: d.io,
			},
			sender: { error: sender.error, alive: sender.value, io: s.io },
			self: { replyable: self.replyable, namesPause: /paused \(#152\)/.test(self.reason) },
			register: {
				refusedByName: register.error !== null && /paused/.test(register.error) && /#152/.test(register.error),
				io: r.io,
			},
			storeUnchanged: after === before,
			agyRecordReadable: readMetaIdentityByGardenId(agy.gardenId, dir).backend,
		}).toEqual({
			dispatch: {
				error: null,
				kind: "reject",
				reason: "native-push-paused",
				observedLiveness: null,
				probes: 0,
				io: [],
			},
			sender: { error: null, alive: false, io: [] },
			self: { replyable: false, namesPause: true },
			register: { refusedByName: true, io: [] },
			storeUnchanged: true,
			agyRecordReadable: "antigravity",
		});
	});

	it("codex native-push is not paused: dispatch and sender replyable still probe and succeed", async () => {
		expect(nativePushPaused("codex"), "codex is not paused").toBe(false);
		const codex = mint("codex", "thread-live");

		const d: Counters = { io: [], probes: 0 };
		const decision = await decideDispatch(
			{ target: codex.gardenId, intent: "fire-and-forget", message: "hello" },
			deciderDeps(codex, d, { status: "alive", route: { backend: "codex", socketPath: "/tmp/gate-codex.sock" } }),
		);
		expect(decision.kind, "codex dispatch executes").toBe("execute");
		expect(d.probes, "codex dispatch probes once").toBe(1);

		const s: Counters = { io: [], probes: 0 };
		expect(await probeNativeSenderAlive(codex, { resolveAdapter: aliveResolver(s) }), "codex sender alive").toBe(true);
		expect(s.probes, "codex sender probed once").toBe(1);

		// entwurf_register_native is antigravity-only by type (register.ts), so it has no codex row:
		// the pause leaves that verb with no registerable backend until it lifts.
	});
});
