/**
 * win32-native — the Windows preview's native surface (#78), and the only way to reach it.
 *
 * Node cannot open a file without following a final-component reparse point on Windows
 * (libuv `UV_FS_O_NOFOLLOW` is 0), and it cannot check who owns a named pipe before
 * talking to it. Those two capabilities come from one Entwurf-owned N-API addon,
 * `native/win32-x64/entwurf_win.node`, built in CI from `native/win32/entwurf_win.c` and
 * shipped beside `native/win32-x64/manifest.json`. This module verifies the manifest and
 * the addon bytes BEFORE `process.dlopen`, and refuses by name otherwise:
 *
 *   ENTWURF_WIN32_UNSUPPORTED     not win32-x64, no addon in this install (an ordinary
 *                                 Linux pack), a Node without the N-API floor, or a
 *                                 verified addon this host cannot load
 *   ENTWURF_WIN32_NATIVE_DRIFT    the manifest is malformed, or the addon bytes are not the
 *                                 bytes the manifest names
 *
 * There is no repair, no download and no fallback: a refusal is the whole answer.
 *
 * Authored as `.js` for the reason `control-socket-path.js` is: it is imported from the
 * tsc-emit root program and from the strip-types lanes alike. `meta-session.ts` reaches it
 * only through a win32-only `createRequire`, so the installers that copy `meta-session.ts`
 * on their own are unchanged on Linux and macOS. Keep dependency-free except node builtins.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const WIN32_UNSUPPORTED_CODE = "ENTWURF_WIN32_UNSUPPORTED";
export const WIN32_DRIFT_CODE = "ENTWURF_WIN32_NATIVE_DRIFT";

const PACKAGE_NAME = "@junghanacs/entwurf";
const NATIVE_DIR = path.join("native", "win32-x64");
const ADDON_FILE = "entwurf_win.node";
const SHA256 = /^[0-9a-f]{64}$/;
// The addon is built against exactly this N-API version (native/win32/binding.gyp, build.mjs). A
// manifest that declares any other value describes some other build: drift, not a floor to honour.
const ADDON_NAPI_VERSION = 8;
// One addon object per process, even if two module instances of this file exist (a
// transpiling loader and Node's own loader can each evaluate it once).
const SLOT = Symbol.for("entwurf.win32-native.addon");
// DOS device names open a device, not a file, at any directory. The addon's GetFileType
// check refuses a non-disk handle anyway; this keeps the open from ever being attempted.
const DOS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 * @returns {Error & { code: string }}
 */
function refusal(code, message, cause) {
	const err = /** @type {Error & { code: string }} */ (new Error(message, cause === undefined ? undefined : { cause }));
	err.code = code;
	return err;
}

/**
 * The package root, found from where THIS module lives: the source depth
 * (`<root>/pi-extensions/lib/`) first, then the compiled depth
 * (`<root>/mcp/entwurf-bridge/dist/pi-extensions/lib/`). The root is the directory whose
 * `package.json` names this package; `null` when neither depth does.
 *
 * @param {string} [from]
 * @returns {string | null}
 */
export function win32NativePackageRoot(from = path.dirname(fileURLToPath(import.meta.url))) {
	for (const up of [
		["..", ".."],
		["..", "..", "..", "..", ".."],
	]) {
		const root = path.resolve(from, ...up);
		let name;
		try {
			name = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))?.name;
		} catch {
			continue;
		}
		if (name === PACKAGE_NAME) return root;
	}
	return null;
}

/**
 * Verify `<root>/native/win32-x64/` and return the addon path to load. Pure apart from
 * reading the two files, so the refusals are provable on any host.
 *
 * @param {string} root
 * @param {{ napi?: string | undefined }} [versions]
 * @returns {{ addonPath: string, sha256: string, napiVersion: number }}
 */
export function verifyWin32NativeAt(root, versions = process.versions) {
	const dir = path.join(root, NATIVE_DIR);
	const manifestPath = path.join(dir, "manifest.json");
	let raw;
	try {
		raw = fs.readFileSync(manifestPath, "utf8");
	} catch (err) {
		if (/** @type {{ code?: unknown }} */ (err).code === "ENOENT") {
			throw refusal(
				WIN32_UNSUPPORTED_CODE,
				`this entwurf install carries no Windows addon (${manifestPath} is absent): only the Windows preview ` +
					"artifact runs on Windows; an ordinary pack does not.",
			);
		}
		throw refusal(WIN32_DRIFT_CODE, `cannot read ${manifestPath}`, err);
	}
	let manifest;
	try {
		manifest = JSON.parse(raw);
	} catch (err) {
		throw refusal(WIN32_DRIFT_CODE, `${manifestPath} is not JSON`, err);
	}
	if (
		manifest?.schema !== 1 ||
		manifest.platform !== "win32" ||
		manifest.arch !== "x64" ||
		manifest.file !== ADDON_FILE ||
		typeof manifest.sha256 !== "string" ||
		!SHA256.test(manifest.sha256) ||
		manifest.napiVersion !== ADDON_NAPI_VERSION
	) {
		throw refusal(WIN32_DRIFT_CODE, `${manifestPath} does not describe one win32-x64 ${ADDON_FILE}`);
	}
	const napi = Number(versions.napi);
	if (!(napi >= ADDON_NAPI_VERSION)) {
		throw refusal(
			WIN32_UNSUPPORTED_CODE,
			`the Windows addon needs N-API ${ADDON_NAPI_VERSION}; this Node offers ${versions.napi ?? "none"}`,
		);
	}
	const addonPath = path.join(dir, ADDON_FILE);
	let bytes;
	try {
		bytes = fs.readFileSync(addonPath);
	} catch (err) {
		throw refusal(WIN32_DRIFT_CODE, `the manifest names ${addonPath}, which cannot be read`, err);
	}
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	if (sha256 !== manifest.sha256) {
		throw refusal(
			WIN32_DRIFT_CODE,
			`${addonPath} is not the addon its manifest names (sha256 ${sha256} != ${manifest.sha256})`,
		);
	}
	return { addonPath, sha256, napiVersion: ADDON_NAPI_VERSION };
}

/**
 * @typedef {object} Win32NativeAddon
 * @property {(file: string) => Buffer} readNoFollow
 * @property {(name: string, line: string, timeoutMs: number) => Promise<{ responseLine: string, serverPid: number }>} pipeRpc
 * @property {(name: string, timeoutMs: number) => Promise<{ serverPid: number }>} pipeProbe
 * @property {() => { live: number, cancelledIncomplete: number }} ioStats
 */

/** @returns {Win32NativeAddon} */
export function win32Native() {
	const held = /** @type {Record<symbol, Win32NativeAddon | undefined>} */ (/** @type {unknown} */ (process))[SLOT];
	if (held) return held;
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw refusal(
			WIN32_UNSUPPORTED_CODE,
			`the Windows native surface exists only on win32-x64, not ${process.platform}-${process.arch}`,
		);
	}
	const root = win32NativePackageRoot();
	if (root === null) {
		throw refusal(WIN32_UNSUPPORTED_CODE, `cannot find the ${PACKAGE_NAME} package root beside this module`);
	}
	const { addonPath } = verifyWin32NativeAt(root);
	const module = { exports: {} };
	try {
		process.dlopen(module, addonPath);
	} catch (err) {
		throw refusal(WIN32_UNSUPPORTED_CODE, `this host cannot load the verified Windows addon ${addonPath}`, err);
	}
	const addon = /** @type {Win32NativeAddon} */ (module.exports);
	/** @type {Record<symbol, Win32NativeAddon | undefined>} */ (/** @type {unknown} */ (process))[SLOT] = addon;
	return addon;
}

/**
 * Read a record's bytes on Windows, refusing a final-component reparse point (`ELOOP`) and
 * a non-regular entry (`ENTWURF_ENOTREG`) on the very handle the read uses. Over 16 MiB is
 * `EFBIG`; other Win32 failures are `EWIN32_<n>`.
 *
 * @param {string} file
 * @returns {Buffer}
 */
export function win32ReadNoFollow(file) {
	const stem = path.win32.basename(file).split(".")[0].replace(/[ ]+$/, "");
	if (DOS_DEVICE.test(stem)) {
		throw refusal("ENTWURF_ENOTREG", `${path.win32.basename(file)} names a DOS device, never a record`);
	}
	return win32Native().readNoFollow(file);
}
