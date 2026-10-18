// Build the Windows preview addon (#78) in CI, twice, from tracked source only.
//
//   node native/win32/build.mjs <outDir>
//
// Preconditions (each refused by name): win32-x64, Node 24.18.1, and native/win32/node_modules
// installed from the tracked lockfile (`npm ci --ignore-scripts`). The Node headers and node.lib
// are fetched from nodejs.org and accepted only at their pinned SHASUMS256 digests; node-gyp then
// builds from a pre-populated devdir with --ensure, so it downloads nothing itself.
//
// Output in <outDir>: entwurf_win.node (the first build), manifest.json (what the loader checks),
// build-receipt.json (both digests, reproducibility, imports, toolset, provenance), all written
// before any verdict. The binary is the tracked C plus declared upstream build glue: node-gyp's
// default win_delay_load_hook.cc (MIT) is compiled in, so its digest and license are recorded and
// the package-root notice LICENSES/node-gyp.txt must equal the pinned node-gyp's LICENSE. The import
// set must be exactly advapi32 + kernel32, with node.exe as the only delay-loaded host. A wrong
// import set exits 1; a second build that differs exits 3, "not byte-reproducible — publication
// blocked". This script never runs on a consumer machine.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "24.18.1";
const PINS = {
	headers: {
		url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-headers.tar.gz`,
		sha256: "bee7344a7fc6e3252c4822ca916a50cd6ddda9bb39374d6140a8046d9238fded",
	},
	nodeLib: {
		url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.lib`,
		sha256: "589684168a73547ca47cd22d76a4e465ef561abe89fb1b2b23fe35bbe857d505",
	},
};
const EXPECTED_IMPORTS = ["advapi32.dll", "kernel32.dll"];
const EXPECTED_DELAY_IMPORTS = ["node.exe"];
const NAPI_VERSION = 8;

const here = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function refuse(message) {
	console.error(`[entwurf-win32-build] refused: ${message}`);
	process.exit(2);
}

async function fetchPinned(name, { url, sha256: want }, dest) {
	const res = await fetch(url);
	if (!res.ok) refuse(`${name}: GET ${url} answered ${res.status}`);
	const bytes = Buffer.from(await res.arrayBuffer());
	const got = sha256(bytes);
	if (got !== want) refuse(`${name}: ${url} is sha256 ${got}, pinned ${want}`);
	fs.writeFileSync(dest, bytes);
	return got;
}

function vsTool(relative) {
	const vswhere = path.join(
		process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
		"Microsoft Visual Studio",
		"Installer",
		"vswhere.exe",
	);
	const found = execFileSync(vswhere, ["-latest", "-products", "*", "-find", relative], { encoding: "utf8" })
		.split(/\r?\n/)
		.filter(Boolean);
	if (found.length === 0) refuse(`vswhere found no ${relative}`);
	return found[0];
}

function importsOf(dumpbin, file) {
	const text = execFileSync(dumpbin, ["/nologo", "/imports", file], { encoding: "utf8" });
	const sections = { imports: [], delay: [] };
	let current = null;
	for (const line of text.split(/\r?\n/)) {
		if (/Section contains the following imports/i.test(line)) current = "imports";
		else if (/Section contains the following delay load imports/i.test(line)) current = "delay";
		else if (current) {
			const m = /^ {4}(\S+\.(?:dll|exe))\s*$/i.exec(line);
			if (m) sections[current].push(m[1].toLowerCase());
		}
	}
	for (const k of Object.keys(sections)) sections[k] = [...new Set(sections[k])].sort();
	return { ...sections, raw: text };
}

function toolset() {
	const vcxproj = path.join(here, "build", "entwurf_win.vcxproj");
	const proj = fs.readFileSync(vcxproj, "utf8");
	const pick = (tag) => new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(proj)?.[1] ?? null;
	const vswhere = path.join(
		process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
		"Microsoft Visual Studio",
		"Installer",
		"vswhere.exe",
	);
	const vs =
		JSON.parse(execFileSync(vswhere, ["-latest", "-products", "*", "-format", "json"], { encoding: "utf8" }))[0] ?? {};
	return {
		platformToolset: pick("PlatformToolset"),
		windowsTargetPlatformVersion: pick("WindowsTargetPlatformVersion"),
		visualStudio: { displayName: vs.displayName ?? null, installationVersion: vs.installationVersion ?? null },
	};
}

async function main() {
	const outDir = process.argv[2];
	if (!outDir || !path.isAbsolute(outDir)) refuse("usage: node build.mjs <absolute outDir>");
	if (process.platform !== "win32" || process.arch !== "x64")
		refuse(`builds on win32-x64 only, not ${process.platform}-${process.arch}`);
	if (process.version !== `v${NODE_VERSION}`) refuse(`builds with Node v${NODE_VERSION} only, not ${process.version}`);
	const gypPkg = path.join(here, "node_modules", "node-gyp", "package.json");
	if (!fs.existsSync(gypPkg)) refuse("native/win32/node_modules is absent: run `npm ci --ignore-scripts` there first");
	const gyp = JSON.parse(fs.readFileSync(gypPkg, "utf8"));
	const pinnedGyp = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")).devDependencies["node-gyp"];
	if (gyp.version !== pinnedGyp) refuse(`node-gyp ${gyp.version} installed, ${pinnedGyp} pinned`);
	const gypDir = path.dirname(gypPkg);
	const hookSha = sha256(fs.readFileSync(path.join(gypDir, "src", "win_delay_load_hook.cc")));
	const gypLicense = fs.readFileSync(path.join(gypDir, "LICENSE"));
	const notice = fs.readFileSync(path.join(here, "..", "..", "LICENSES", "node-gyp.txt"));
	if (!notice.equals(gypLicense)) refuse("LICENSES/node-gyp.txt is not the pinned node-gyp LICENSE it must reproduce");
	// What is compiled or linked into the binary besides the tracked C. Node's headers (MIT) are
	// declarations; node.lib is the host's import library; the static CRT comes with the toolset
	// recorded in builtWith.
	const PROVENANCE = {
		statement: "tracked C + declared upstream build glue",
		compiled: {
			"entwurf_win.c": "tracked source",
			"node-gyp/src/win_delay_load_hook.cc": {
				version: gyp.version,
				sha256: hookSha,
				license: gyp.license,
				notice: "LICENSES/node-gyp.txt",
				licenseSha256: sha256(gypLicense),
			},
		},
		// Declared by binding.gyp/node-gyp, NOT measured: the measured facts are imports/delayImports.
		declaredLinkInputs: [
			"advapi32.lib",
			"kernel32.lib",
			`node.lib (import library, Node v${NODE_VERSION} win-x64)`,
			"MSVC static CRT (/MT)",
		],
		headers: `Node v${NODE_VERSION} headers tarball (MIT), declarations only`,
	};

	fs.mkdirSync(outDir, { recursive: true });
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-win32-build-"));
	const devdir = path.join(work, "devdir");
	const versionDir = path.join(devdir, NODE_VERSION);
	fs.mkdirSync(path.join(versionDir, "x64"), { recursive: true });
	const headersTgz = path.join(work, "headers.tar.gz");
	const headersSha = await fetchPinned("headers", PINS.headers, headersTgz);
	const nodeLibSha = await fetchPinned("node.lib", PINS.nodeLib, path.join(versionDir, "x64", "node.lib"));
	const extract = path.join(work, "extract");
	fs.mkdirSync(extract);
	// The OS bsdtar by absolute path: a GNU tar earlier on PATH reads `C:` as a remote host.
	const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
	execFileSync(tar, ["-xzf", headersTgz, "-C", extract], { stdio: "inherit" });
	fs.renameSync(path.join(extract, `node-v${NODE_VERSION}`, "include"), path.join(versionDir, "include"));
	fs.writeFileSync(path.join(versionDir, "installVersion"), `${gyp.installVersion}\n`);

	const gypBin = path.join(here, "node_modules", "node-gyp", "bin", "node-gyp.js");
	const built = path.join(here, "build", "Release", "entwurf_win.node");
	const builds = [];
	for (let i = 1; i <= 2; i++) {
		fs.rmSync(path.join(here, "build"), { recursive: true, force: true });
		execFileSync(process.execPath, [gypBin, "rebuild", "--release", "--arch=x64", `--devdir=${devdir}`, "--ensure"], {
			cwd: here,
			stdio: "inherit",
		});
		const bytes = fs.readFileSync(built);
		builds.push(sha256(bytes));
		fs.writeFileSync(path.join(outDir, `build-${i}.node`), bytes);
	}
	const tools = toolset();
	const dumpbin = vsTool("VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\dumpbin.exe");
	const imports = importsOf(dumpbin, path.join(outDir, "build-1.node"));
	fs.writeFileSync(path.join(outDir, "dumpbin-imports.txt"), imports.raw);
	const importsOk =
		JSON.stringify(imports.imports) === JSON.stringify(EXPECTED_IMPORTS) &&
		JSON.stringify(imports.delay) === JSON.stringify(EXPECTED_DELAY_IMPORTS);
	const reproducible = builds[0] === builds[1];

	fs.copyFileSync(path.join(outDir, "build-1.node"), path.join(outDir, "entwurf_win.node"));
	const source = Object.fromEntries(
		["entwurf_win.c", "binding.gyp", "package.json", "package-lock.json", "build.mjs"].map((f) => [
			f,
			sha256(fs.readFileSync(path.join(here, f))),
		]),
	);
	const manifest = {
		schema: 1,
		platform: "win32",
		arch: "x64",
		file: "entwurf_win.node",
		sha256: builds[0],
		napiVersion: NAPI_VERSION,
		builtWith: { node: NODE_VERSION, nodeGyp: gyp.version, ...tools },
		source,
		provenance: PROVENANCE,
	};
	fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	const receipt = {
		builds,
		reproducible,
		statement: reproducible
			? "byte-reproducible"
			: "rebuildable from tracked source at this SHA, not byte-reproducible — publication blocked",
		imports: imports.imports,
		delayImports: imports.delay,
		importsOk,
		expected: { imports: EXPECTED_IMPORTS, delayImports: EXPECTED_DELAY_IMPORTS },
		pins: { headers: headersSha, nodeLib: nodeLibSha, nodeGyp: gyp.version },
		toolset: tools,
		source,
		provenance: PROVENANCE,
	};
	fs.writeFileSync(path.join(outDir, "build-receipt.json"), `${JSON.stringify(receipt, null, "\t")}\n`);
	fs.rmSync(work, { recursive: true, force: true });
	console.log(
		JSON.stringify({ builds, reproducible, imports: imports.imports, delayImports: imports.delay, importsOk }),
	);
	if (!importsOk) {
		console.error(`[entwurf-win32-build] RED: import set ${JSON.stringify(imports)} is not the expected one`);
		process.exit(1);
	}
	if (!reproducible) {
		console.error(`[entwurf-win32-build] PUBLICATION BLOCKED: ${receipt.statement} (${builds.join(" != ")})`);
		process.exit(3);
	}
}

await main();
