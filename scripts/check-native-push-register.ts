/**
 * check-native-push-register — deterministic gate for registerNativeConversation (봉인 5),
 * the core of the `entwurf_register_native` MCP tool. Drives it with a FAKE adapter (no live
 * agy) and an ISOLATED temp meta-record store (never the real ~/.pi).
 *
 * Proves:
 *   - live probe → CREATE: a fresh live conversation mints a garden citizen whose meta-record
 *     carries the backend / nativeSessionId / caller-stated cwd; the action is "create".
 *   - re-register → ATTACH: the same conversation resolves to the SAME garden id and REFRESHES
 *     the cwd (봉인 5) — it never mints a second id.
 *   - not-live probe → REFUSE: a dead / indeterminate probe THROWS and writes NO record (no
 *     garden id is engraved onto a pointer that does not resolve to a live host).
 *   - RECEIVER-MARKER ABSTINENCE (보정①): the register source references NO receiver-marker
 *     writer — a native-push citizen has no idle-wake watch, so arming one would smuggle
 *     native-push liveness into the mailbox deliverability atom.
 *
 * Deterministic (fake adapter); the only IO is an isolated mkdtemp store (like the meta gates).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readMetaIdentityByGardenId } from "../pi-extensions/lib/meta-session.ts";
import type { NativePushAdapter, NativePushProbeResult } from "../pi-extensions/lib/native-push/adapter.ts";
import { registerNativeConversation } from "../pi-extensions/lib/native-push/register.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A fake native-push adapter whose probe returns a fixed result and whose send is unused. */
function fakeAdapter(probe: NativePushProbeResult): NativePushAdapter {
	return {
		id: "antigravity",
		async probe() {
			return probe;
		},
		async send() {
			throw new Error("register gate: adapter.send must not be called during registration");
		},
	};
}

const ALIVE: NativePushProbeResult = { status: "alive", route: { lsAddress: "127.0.0.1:5599" } };

async function main(): Promise<void> {
	const dir = mkdtempSync(path.join(os.tmpdir(), "entwurf-register-"));
	try {
		// ── live probe → CREATE ───────────────────────────────────────────────────
		const created = await registerNativeConversation(
			{ backend: "antigravity", nativeSessionId: "conv-abc", cwd: "/work/one" },
			{ resolveAdapter: () => fakeAdapter(ALIVE), sessionsDir: dir },
		);
		ok("create: action = create", created.action === "create");
		ok("create: gardenId shaped YYYYMMDDTHHMMSS-xxxxxx", /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(created.gardenId));
		ok("create: backend antigravity", created.backend === "antigravity");
		ok("create: nativeSessionId echoed", created.nativeSessionId === "conv-abc");
		ok("create: cwd = caller-stated", created.cwd === "/work/one");
		// the on-disk record agrees (read back through the authority).
		const rec = readMetaIdentityByGardenId(created.gardenId, dir);
		ok("create: record backend antigravity", rec.backend === "antigravity");
		ok("create: record nativeSessionId bound", rec.nativeSessionId === "conv-abc");
		ok("create: record cwd recorded", rec.cwd === "/work/one");

		// ── re-register same conversation → ATTACH (same gid, cwd refreshed) ───────
		const reattached = await registerNativeConversation(
			{ backend: "antigravity", nativeSessionId: "conv-abc", cwd: "/work/two" },
			{ resolveAdapter: () => fakeAdapter(ALIVE), sessionsDir: dir },
		);
		ok("attach: action = attach", reattached.action === "attach");
		ok("attach: SAME garden id (no second mint)", reattached.gardenId === created.gardenId);
		ok(
			"attach: cwd REFRESHED to the new value",
			reattached.gardenId === created.gardenId && reattached.cwd === "/work/two",
		);
		const rec2 = readMetaIdentityByGardenId(created.gardenId, dir);
		ok("attach: on-disk cwd refreshed", rec2.cwd === "/work/two");
		// exactly ONE record file for this conversation (no duplicate mint).
		const records = readdirSync(dir).filter((f) => f.endsWith(".meta.json"));
		ok("attach: exactly ONE meta-record (no duplicate garden id)", records.length === 1);

		// ── not-live probe → REFUSE (throw), NO record written ────────────────────
		for (const probe of [
			{ status: "dead", reason: "no host" } as const,
			{ status: "indeterminate", reason: "no port served" } as const,
		]) {
			const before = readdirSync(dir).length;
			let threw = false;
			try {
				await registerNativeConversation(
					{ backend: "antigravity", nativeSessionId: "conv-ghost", cwd: "/work/x" },
					{ resolveAdapter: () => fakeAdapter(probe), sessionsDir: dir },
				);
			} catch (err) {
				threw = true;
				ok(
					`refuse(${probe.status}): error names the non-live probe`,
					new RegExp(probe.status).test((err as Error).message),
				);
			}
			ok(`refuse(${probe.status}): THROWS (no garden id for a non-live conversation)`, threw);
			ok(`refuse(${probe.status}): NO record written`, readdirSync(dir).length === before);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	// ── RECEIVER-MARKER ABSTINENCE (보정①): source references no marker writer ───
	const src = readFileSync(path.join(REPO_DIR, "pi-extensions", "lib", "native-push", "register.ts"), "utf8");
	ok("no-marker: register source does NOT call writeMetaReceiverMarker", !/writeMetaReceiverMarker/.test(src));
	ok("no-marker: register source does NOT reference armProvenance", !/armProvenance/i.test(src));
	ok(
		"no-marker: register source does NOT reference META_RECEIVER_ARM_PROVENANCES",
		!/META_RECEIVER_ARM_PROVENANCES/.test(src),
	);
	// it DOES reuse the upsert authority (봉인 5) and the adapter probe.
	ok("wiring: register reuses upsertMetaSession", /upsertMetaSession/.test(src));
	ok("wiring: register probes the adapter before minting", /\.probe\(/.test(src));

	console.log(`\ncheck-native-push-register: ${passed} assertions passed`);
}

void main();
