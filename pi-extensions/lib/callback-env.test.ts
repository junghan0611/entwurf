import { describe, expect, it } from "vitest";
import {
	CALLBACK_NONCE_ENV,
	CALLBACK_NONCE_RE,
	CALLBACK_TARGET_ENV,
	callbackEnvAssignments,
	readCallbackEnv,
} from "./callback-env.ts";

const GID = "20260805T000000-abcdef";
const NONCE = "mux-fresh-call-deadbeefdeadbeefdeadbeef";

describe("callback-env", () => {
	it("formats a validated pair as KEY=value assignments", () => {
		expect(callbackEnvAssignments({ target: GID, nonce: NONCE })).toEqual([
			`${CALLBACK_TARGET_ENV}=${GID}`,
			`${CALLBACK_NONCE_ENV}=${NONCE}`,
		]);
	});

	it("refuses to inject a pair the verb would reject", () => {
		expect(() => callbackEnvAssignments({ target: "not-a-gid", nonce: NONCE })).toThrow(/malformed/);
		expect(() => callbackEnvAssignments({ target: GID, nonce: "nope" })).toThrow(/malformed/);
	});

	it("reads a well-formed pair and names absence vs malformation vs Codex", () => {
		expect(readCallbackEnv({ [CALLBACK_TARGET_ENV]: GID, [CALLBACK_NONCE_ENV]: NONCE })).toEqual({
			ok: true,
			target: GID,
			nonce: NONCE,
		});
		expect(readCallbackEnv({})).toEqual({ ok: false, reason: "callback-env-absent" });
		expect(readCallbackEnv({ [CALLBACK_TARGET_ENV]: GID })).toEqual({
			ok: false,
			reason: "callback-env-malformed",
		});
		expect(
			readCallbackEnv({
				[CALLBACK_TARGET_ENV]: GID,
				[CALLBACK_NONCE_ENV]: NONCE,
				ENTWURF_BRIDGE_NATIVE_HOST: "codex",
			}),
		).toEqual({ ok: false, reason: "codex-callback-env-unsupported" });
	});

	it("the nonce grammar matches mintNonce's 24-hex suffix", () => {
		expect(CALLBACK_NONCE_RE.test(NONCE)).toBe(true);
		expect(CALLBACK_NONCE_RE.test("herdr-fresh-call-0123456789abcdef01234567")).toBe(true);
		expect(CALLBACK_NONCE_RE.test("mux-fresh-call-deadbeef")).toBe(false);
	});
});
