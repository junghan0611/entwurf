/**
 * check-native-push-register — deterministic gate for registerNativeConversation (봉인 5),
 * the core of the `entwurf_register_native` MCP tool. Drives it with a FAKE adapter (no live
 * agy) and an ISOLATED temp meta-record store (never the real ~/.pi).
 *
 * Proves:
 *   - #152 PAUSE: antigravity — the only registerable backend — is refused by name BEFORE any
 *     adapter is resolved or probed, and NO record is written. While the pause holds, the create /
 *     attach / refuse-not-live mechanics behind that guard are unreachable, so this gate no longer
 *     claims them; they return with the pause's lift.
 *   - the paused-policy check sits BEFORE the probe in the register source.
 *   - RECEIVER-MARKER ABSTINENCE (보정①): the register source references NO receiver-marker
 *     writer — a native-push citizen has no idle-wake watch, so arming one would smuggle
 *     native-push liveness into the mailbox deliverability atom.
 *
 * Deterministic (trap adapter); the only IO is an isolated mkdtemp store (like the meta gates).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { registerNativeConversation } from "../pi-extensions/lib/native-push/register.ts";

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
	const dir = mkdtempSync(path.join(os.tmpdir(), "entwurf-register-"));
	try {
		// ── #152: antigravity is PAUSED → REFUSE by name, no adapter, NO record ──────
		let resolved = 0;
		const before = readdirSync(dir).length;
		let message = "";
		try {
			await registerNativeConversation(
				{ backend: "antigravity", nativeSessionId: "conv-abc", cwd: "/work/one" },
				{
					resolveAdapter: () => {
						resolved++;
						throw new Error("register gate: no adapter may be resolved for a paused backend");
					},
					sessionsDir: dir,
				},
			);
		} catch (err) {
			message = (err as Error).message;
		}
		ok("paused: register THROWS for antigravity", message !== "");
		ok("paused: the error names the pause (#152)", /paused/.test(message) && /#152/.test(message));
		ok("paused: no adapter resolved (nothing probed)", resolved === 0);
		ok("paused: NO record written", readdirSync(dir).length === before);
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
	ok(
		"wiring: the paused-policy check precedes the adapter probe",
		src.indexOf("nativePushPaused(input.backend)") > 0 &&
			src.indexOf("nativePushPaused(input.backend)") < src.indexOf(".probe("),
	);

	console.log(`\ncheck-native-push-register: ${passed} assertions passed`);
}

void main();
