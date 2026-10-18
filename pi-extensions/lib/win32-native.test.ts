/**
 * win32-native — the Windows preview's addon loader (#78), proven beside it.
 *
 * The loader's whole job is to refuse by name BEFORE `process.dlopen`: an install without
 * the addon is UNSUPPORTED, bytes that are not the manifest's bytes are DRIFT, and there is
 * no repair or fallback. `verifyWin32NativeAt` is pure apart from reading the two files, so
 * every refusal is measured here on a fixture root on any host. The dlopen itself and the
 * addon's Win32 behaviour are measured only on Windows (windows-native-preview.yml).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
	verifyWin32NativeAt,
	WIN32_DRIFT_CODE,
	WIN32_UNSUPPORTED_CODE,
	win32Native,
	win32NativePackageRoot,
	win32ReadNoFollow,
} from "./win32-native.js";

const ADDON_BYTES = Buffer.from("not a real addon, only bytes to hash\n");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const roots: string[] = [];
afterEach(() => {
	for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function fixtureRoot(manifest: unknown | null, addon: Buffer | null = ADDON_BYTES): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-win32-native-"));
	roots.push(root);
	const dir = path.join(root, "native", "win32-x64");
	fs.mkdirSync(dir, { recursive: true });
	if (manifest !== null) fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
	if (addon !== null) fs.writeFileSync(path.join(dir, "entwurf_win.node"), addon);
	return root;
}

const goodManifest = (over: Record<string, unknown> = {}) => ({
	schema: 1,
	platform: "win32",
	arch: "x64",
	file: "entwurf_win.node",
	sha256: sha(ADDON_BYTES),
	napiVersion: 8,
	...over,
});

function codeOf(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (err) {
		return (err as { code?: string }).code;
	}
	return undefined;
}

describe("verifyWin32NativeAt", () => {
	it("[QK:WIN32-NATIVE-ABSENT-UNSUPPORTED] an install without the addon manifest is UNSUPPORTED, not drift", () => {
		expect(codeOf(() => verifyWin32NativeAt(fixtureRoot(null, null), { napi: "10" }))).toBe(WIN32_UNSUPPORTED_CODE);
	});

	it("[QK:WIN32-NATIVE-SHA-DRIFT] one changed addon byte is DRIFT, refused before any load", () => {
		const changed = Buffer.from(ADDON_BYTES);
		changed[0] ^= 1;
		expect(codeOf(() => verifyWin32NativeAt(fixtureRoot(goodManifest(), changed), { napi: "10" }))).toBe(
			WIN32_DRIFT_CODE,
		);
	});

	it("[QK:WIN32-NATIVE-MANIFEST-DRIFT] a manifest naming another platform, arch or file is DRIFT", () => {
		for (const over of [{ platform: "linux" }, { arch: "arm64" }, { file: "other.node" }, { schema: 2 }]) {
			expect(codeOf(() => verifyWin32NativeAt(fixtureRoot(goodManifest(over)), { napi: "10" }))).toBe(WIN32_DRIFT_CODE);
		}
		expect(codeOf(() => verifyWin32NativeAt(fixtureRoot(goodManifest(), null), { napi: "10" }))).toBe(WIN32_DRIFT_CODE);
	});

	it("[QK:WIN32-NATIVE-NAPI-FLOOR] a Node below the manifest's N-API version is UNSUPPORTED", () => {
		expect(codeOf(() => verifyWin32NativeAt(fixtureRoot(goodManifest()), { napi: "7" }))).toBe(WIN32_UNSUPPORTED_CODE);
		expect(codeOf(() => verifyWin32NativeAt(fixtureRoot(goodManifest()), {}))).toBe(WIN32_UNSUPPORTED_CODE);
	});

	it("[QK:WIN32-NATIVE-ABI-DRIFT] a manifest declaring any N-API version but 8 is DRIFT, never a floor to honour", () => {
		for (const napiVersion of [0, -1, 7, 9, "8", null]) {
			expect(codeOf(() => verifyWin32NativeAt(fixtureRoot(goodManifest({ napiVersion })), { napi: "10" }))).toBe(
				WIN32_DRIFT_CODE,
			);
		}
	});

	it("verified bytes return the addon path and digest", () => {
		const root = fixtureRoot(goodManifest());
		const verified = verifyWin32NativeAt(root, { napi: "8" });
		expect(verified.addonPath).toBe(path.join(root, "native", "win32-x64", "entwurf_win.node"));
		expect(verified.sha256).toBe(sha(ADDON_BYTES));
	});
});

describe("win32NativePackageRoot", () => {
	it("finds this checkout from the source depth", () => {
		const here = path.dirname(fileURLToPath(import.meta.url));
		expect(win32NativePackageRoot(here)).toBe(path.resolve(here, "..", ".."));
	});

	it("[QK:WIN32-NATIVE-COMPILED-DEPTH] the compiled copy under mcp/entwurf-bridge/dist resolves the same package root", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-win32-root-"));
		roots.push(root);
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@junghanacs/entwurf" }));
		const compiled = path.join(root, "mcp", "entwurf-bridge", "dist", "pi-extensions", "lib");
		fs.mkdirSync(compiled, { recursive: true });
		// A package.json at the source depth of the compiled copy names something else: not the root.
		fs.writeFileSync(path.join(root, "mcp", "entwurf-bridge", "dist", "package.json"), JSON.stringify({ name: "x" }));
		expect(win32NativePackageRoot(compiled)).toBe(root);
	});

	it("is null where no depth carries the package", () => {
		expect(win32NativePackageRoot(path.join(os.tmpdir(), "a", "b", "c", "d", "e", "f"))).toBeNull();
	});
});

describe("win32Native", () => {
	it("[QK:WIN32-NATIVE-OFF-WINDOWS] off win32-x64 the native surface refuses by name instead of loading", () => {
		if (process.platform === "win32" && process.arch === "x64") return;
		// The platform refusal, not the later "this install has no addon" one this checkout would also give.
		expect(() => win32Native()).toThrow(/exists only on win32-x64/);
		expect(codeOf(() => win32Native())).toBe(WIN32_UNSUPPORTED_CODE);
	});

	it("[QK:WIN32-NATIVE-DOS-DEVICE] a DOS device name is refused as irregular before any open", () => {
		for (const name of ["C:\\store\\CON", "C:\\store\\nul.json", "C:\\store\\COM1.json", "C:\\store\\conout$"]) {
			expect(codeOf(() => win32ReadNoFollow(name))).toBe("ENTWURF_ENOTREG");
		}
	});
});
