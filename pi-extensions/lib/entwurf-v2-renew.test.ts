/**
 * #151 R-2: a record mid-/renew (it carries a `renewing` block) is refused BY NAME on both lifecycle
 * doors a sibling can knock on — `entwurf_v2` delivery and `entwurf_resume_call` same-id resume —
 * before anything touches a socket, a mailbox, an adapter or a window. The production subjects are
 * `entwurf-v2-decider.ts`, `resume-launch-identity.ts` and `entwurf-v2-visible-resume.ts`; the oracle
 * is a real V3 record on disk read through the addressable reader, and the injected seams record
 * every call so "nothing was probed, nothing was opened" is counted, not assumed.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isPreProbeReject, rejectObservedLivenessWellFormed } from "./entwurf-v2-contract.ts";
import { type DispatchDeciderDeps, decideDispatch, type TargetResolution } from "./entwurf-v2-decider.ts";
import type { LockClaim } from "./entwurf-v2-lock.ts";
import type { ControlSocketPlan } from "./entwurf-v2-send.ts";
import { resolveDeadControlSendFallback } from "./entwurf-v2-send-fallback.ts";
import { renderVisibleResume, type VisibleResumeDeps, visibleResume } from "./entwurf-v2-visible-resume.ts";
import { type MetaIdentity, readAddressableMetaIdentity, serializeMetaIdentity } from "./meta-session.ts";
import { ResumeRenewInProgressError, resolveResumeLaunchIdentity } from "./resume-launch-identity.ts";

const GID = "20261003T164401-a30dda";
const OUTLINE = "이 글은 이전 장 에이전트가 작성하고 GLG가 전달 판본을 확인한 기억의 얼개다.\n[1장] …";
const sha = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex");

/** A first-renew record: the transition is marked, the outgoing chapter's file does not even exist. */
function renewingRecord(): MetaIdentity {
	return {
		schemaVersion: 3,
		gardenId: GID,
		backend: "pi",
		nativeSessionId: "native-n1",
		cwd: "/tmp/w",
		model: "stub/stub-1",
		transcriptPath: "/nonexistent/entwurf-151/n1.jsonl",
		createdAt: "2026-10-03T07:44:01.905Z",
		recordUpdatedAt: "2026-11-17T00:00:00.000Z",
		attachIncarnation: null,
		renewing: {
			from: "native-n1",
			to: null,
			token: "c".repeat(32),
			outlineSha: sha(OUTLINE),
			outline: OUTLINE,
			owner: { pid: 4242, startKey: "linux:123456" },
			startedAt: "2026-11-17T00:00:00.000Z",
		},
	};
}

let dir = "";
let savedEnv: string | undefined;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "renew-r2-"));
	savedEnv = process.env.ENTWURF_META_SESSIONS_DIR;
	process.env.ENTWURF_META_SESSIONS_DIR = dir;
});
afterEach(() => {
	if (savedEnv === undefined) delete process.env.ENTWURF_META_SESSIONS_DIR;
	else process.env.ENTWURF_META_SESSIONS_DIR = savedEnv;
	fs.rmSync(dir, { recursive: true, force: true });
});
function writeRecord(rec: MetaIdentity): void {
	fs.writeFileSync(path.join(dir, `${rec.gardenId}.meta.json`), serializeMetaIdentity(rec));
}

function lockClaim(gardenId: string): LockClaim {
	return {
		gardenId,
		pid: 4242,
		hostname: "test-host",
		createdAt: "2026-11-17T00:00:00.000Z",
		nonce: "deadbeefcafef00d",
		owner: "entwurf_v2",
		lockPath: `/fake/locks/${gardenId}.lock`,
	};
}

/** Decider seams over the REAL record; every other door counts its knocks. `afterFirstRead` runs
 * once, right after the first record read — the window a transition can write its mark into. */
function deciderDeps(afterFirstRead?: () => void) {
	const calls = { reads: 0, lock: 0, release: 0, inspect: 0, probe: 0, mailbox: 0, nativePush: 0 };
	const deps: DispatchDeciderDeps = {
		resolveTarget: (gardenId) => {
			const identity = readAddressableMetaIdentity(gardenId);
			calls.reads++;
			if (calls.reads === 1) afterFirstRead?.();
			return { identity, preProbeAddressConflict: false };
		},
		acquireLock: (gardenId) => {
			calls.lock++;
			return { ok: true, claim: lockClaim(gardenId) };
		},
		releaseLock: () => {
			calls.release++;
		},
		inspectSocket: async (gardenId) => {
			calls.inspect++;
			return { kind: "absent", socketPath: `/fake/ctl/${gardenId}.sock` };
		},
		probeSocket: async () => {
			calls.probe++;
			return "dead";
		},
		mailboxDeliverabilityFor: () => {
			calls.mailbox++;
			return { deliverable: false, reason: "fake" };
		},
		nativePushProbe: () => {
			calls.nativePush++;
			return { status: "dead", reason: "fake" };
		},
		mailboxDir: "/fake/mailbox",
		sessionsDir: dir,
	};
	return { deps, calls };
}

describe("#151 R-2: entwurf_v2 refuses a record mid-/renew before any probe", () => {
	it("[QK:V2-RENEW-IN-PROGRESS-PRE-PROBE] a renewing record is refused as renew-in-progress with no lock, socket, mailbox or adapter touched, and no liveness claimed", async () => {
		writeRecord(renewingRecord());
		const { deps, calls } = deciderDeps();
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, deps);
		expect(d.kind).toBe("reject");
		if (d.kind !== "reject") return;
		expect(d.receipt.reason).toBe("renew-in-progress");
		expect(d.receipt.observedLiveness).toBeNull();
		expect(calls).toEqual({ reads: 1, lock: 0, release: 0, inspect: 0, probe: 0, mailbox: 0, nativePush: 0 });
	});

	it("[QK:V2-RENEW-MARK-REREAD-UNDER-LOCK] a mark written after the pre-lock read is caught under the lock — refused and released before any socket inspection or probe", async () => {
		const { renewing: _dropped, ...plain } = renewingRecord();
		writeRecord(plain);
		const { deps, calls } = deciderDeps(() => writeRecord(renewingRecord()));
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, deps);
		expect(d.kind === "reject" ? d.receipt.reason : d.kind).toBe("renew-in-progress");
		expect(d.kind === "reject" ? d.receipt.observedLiveness : "not-a-reject").toBeNull();
		expect(calls).toEqual({ reads: 2, lock: 1, release: 1, inspect: 0, probe: 0, mailbox: 0, nativePush: 0 });
	});

	it("[QK:V2-RENEW-IN-PROGRESS-WELL-FORMED] renew-in-progress is a pre-probe reason, so its null observedLiveness is the well-formed receipt", async () => {
		writeRecord(renewingRecord());
		const { deps } = deciderDeps();
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, deps);
		expect(d.kind).toBe("reject");
		if (d.kind !== "reject") return;
		expect(isPreProbeReject("renew-in-progress")).toBe(true);
		expect(rejectObservedLivenessWellFormed(d.receipt.reason, d.receipt.observedLiveness)).toBe(true);
		// The other direction: a renew refusal that claimed a measured liveness would be malformed.
		expect(rejectObservedLivenessWellFormed("renew-in-progress", "dead")).toBe(false);
	});

	it("[QK:V2-RENEW-REFUSAL-ONLY-WHEN-MARKED] the same pi record without a renewing block goes on to its ordinary socket check", async () => {
		const { renewing: _dropped, ...plain } = renewingRecord();
		writeRecord(plain);
		const { deps, calls } = deciderDeps();
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, deps);
		expect(d.kind === "reject" ? d.receipt.reason : d.kind).not.toBe("renew-in-progress");
		expect(calls.inspect).toBe(1);
	});
});

describe("#151 R-2: the under-lock re-read keeps every refusal it can name, before the mark", () => {
	/** The pre-lock read sees an ordinary pi record; the under-lock read returns `second` — the
	 * resolution shapes production's resolveTarget gives for a record gone or quarantined since. */
	function rereadTo(second: TargetResolution) {
		const { renewing: _dropped, ...plain } = renewingRecord();
		const calls = { reads: 0, lock: 0, release: 0, inspect: 0, probe: 0 };
		const { deps } = deciderDeps();
		deps.resolveTarget = () => {
			calls.reads++;
			return calls.reads === 1 ? { identity: plain, preProbeAddressConflict: false } : second;
		};
		deps.acquireLock = (gardenId) => {
			calls.lock++;
			return { ok: true, claim: lockClaim(gardenId) };
		};
		deps.releaseLock = () => {
			calls.release++;
		};
		deps.inspectSocket = async (gardenId) => {
			calls.inspect++;
			return { kind: "absent", socketPath: `/fake/ctl/${gardenId}.sock` };
		};
		deps.probeSocket = async () => {
			calls.probe++;
			return "alive";
		};
		return { deps, calls };
	}

	it("[QK:V2-RENEW-REREAD-KEEPS-RECORD-GONE] a record gone since the first read is refused as record-less-socket or bad-target, released, with no socket inspection or probe", async () => {
		for (const [second, reason] of [
			[{ identity: null, preProbeAddressConflict: false, recordLessSocket: true }, "record-less-socket"],
			[{ identity: null, preProbeAddressConflict: false }, "bad-target"],
		] as const) {
			const { deps, calls } = rereadTo(second);
			const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, deps);
			expect(d.kind === "reject" ? d.receipt.reason : d.kind).toBe(reason);
			expect(d.kind === "reject" ? d.receipt.observedLiveness : "not-a-reject").toBeNull();
			expect(calls).toEqual({ reads: 2, lock: 1, release: 1, inspect: 0, probe: 0 });
		}
	});

	it("[QK:V2-RENEW-REREAD-KEEPS-CONFLICT] an address conflict seen on the under-lock read is refused, released, with no socket inspection or probe", async () => {
		const { renewing: _dropped, ...plain } = renewingRecord();
		const { deps, calls } = rereadTo({ identity: plain, preProbeAddressConflict: true });
		const d = await decideDispatch({ target: GID, intent: "fire-and-forget", message: "hi" }, deps);
		expect(d.kind === "reject" ? d.receipt.reason : d.kind).toBe("target-address-conflict");
		expect(calls).toEqual({ reads: 2, lock: 1, release: 1, inspect: 0, probe: 0 });
	});
});

describe("#151 R-2: the dead-control fallback re-resolves on its own and must see the mark too", () => {
	it("[QK:V2-RENEW-FALLBACK-REFUSED] a record that started a /renew since the first attempt is refused by name under the held lock, with no re-inspect or re-probe", async () => {
		writeRecord(renewingRecord());
		const calls = { inspect: 0, probe: 0, mailbox: 0 };
		const plan: ControlSocketPlan = {
			transport: "control-socket",
			action: "send",
			targetGardenId: GID,
			socketPath: `/fake/ctl/${GID}.sock`,
			mode: "follow_up",
			wantsReply: false,
			message: "hi",
		};
		const res = await resolveDeadControlSendFallback(plan, lockClaim(GID), {
			resolveTarget: (gardenId) => ({
				identity: readAddressableMetaIdentity(gardenId),
				preProbeAddressConflict: false,
			}),
			inspectSocket: async (gardenId) => {
				calls.inspect++;
				return { kind: "absent", socketPath: `/fake/ctl/${gardenId}.sock` };
			},
			probeSocket: async () => {
				calls.probe++;
				return "alive";
			},
			mailboxDeliverabilityFor: () => {
				calls.mailbox++;
				return { deliverable: false, reason: "fake" };
			},
			mailboxDir: "/fake/mailbox",
			sessionsDir: dir,
		});
		expect(res).toEqual({ kind: "reject", reason: "renew-in-progress" });
		expect(calls).toEqual({ inspect: 0, probe: 0, mailbox: 0 });
	});
});

describe("#151 R-2: entwurf_resume_call refuses a record mid-/renew before any window", () => {
	it("[QK:RESUME-RENEW-IN-PROGRESS-NAMED] the record read names the transition before any transcript check — a missing outgoing file is not reported as an integrity error", () => {
		writeRecord(renewingRecord());
		expect(() => resolveResumeLaunchIdentity(GID)).toThrow(ResumeRenewInProgressError);
	});

	it("[QK:RESUME-RENEW-IN-PROGRESS-NO-WINDOW] visibleResume answers target-renew-in-progress under its lock, opens nothing, releases the lock, and renders the hint once", async () => {
		writeRecord(renewingRecord());
		const calls = { acquire: 0, release: 0, other: [] as string[] };
		const refuse = (name: string) => (): never => {
			calls.other.push(name);
			throw new Error(`${name} must not be reached for a record mid-/renew`);
		};
		const deps: VisibleResumeDeps = {
			acquireLock: (gid) => {
				calls.acquire++;
				return { ok: true, claim: lockClaim(gid) };
			},
			releaseLock: () => {
				calls.release++;
				return "released";
			},
			resolveIdentity: resolveResumeLaunchIdentity,
			inspectSocket: refuse("inspectSocket"),
			probeSocket: refuse("probeSocket"),
			inspectReceiver: refuse("inspectReceiver"),
			launch: refuse("launch"),
			reservePiDurable: refuse("reservePiDurable"),
			withdrawPiDurable: refuse("withdrawPiDurable"),
			observePiDurable: refuse("observePiDurable"),
			sleep: refuse("sleep"),
			now: () => 0,
		} as VisibleResumeDeps;
		const result = await visibleResume(GID, deps);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("target-renew-in-progress");
		expect(calls).toEqual({ acquire: 1, release: 1, other: [] });
		const { text, isError } = renderVisibleResume(result);
		expect(isError).toBe(true);
		expect(text).toContain("entwurf_resume_call rejected: target-renew-in-progress — ");
		expect(text).toContain("would reopen the outgoing chapter");
		expect(text).toContain("No window was opened.");
		expect(text).not.toContain("..");
	});
});
