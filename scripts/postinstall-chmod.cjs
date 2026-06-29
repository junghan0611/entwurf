// Restore executable bits on shell scripts after install.
//
// Why: `pnpm publish` normalizes file modes in the published tarball
// to 0644, so the registry artifact loses the executable bit that the
// repo tracks (`git ls-files --stage` shows 100755). README documents
// running `run.sh install .` directly, and the entwurf-bridge MCP
// extension spawns `mcp/entwurf-bridge/start.sh` — both break with
// EACCES on a fresh `pi install npm:@junghanacs/entwurf`.
//
// CJS so it runs regardless of the consumer's package "type" and
// regardless of whether the installed copy includes our package.json
// (the script is co-located, no resolution needed).

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const targets = [
	"run.sh",
	"mcp/entwurf-bridge/start.sh",
	"mcp/entwurf-bridge/test.sh",
	"demo/demo.sh",
	"demo/demo-baseline.sh",
];

const scriptDirs = ["scripts"];

function chmodIfPresent(rel) {
	const abs = path.join(root, rel);
	try {
		if (!fs.existsSync(abs)) return;
		fs.chmodSync(abs, 0o755);
	} catch (err) {
		// Never fail install on chmod errors (Windows, read-only mount, etc.).
		console.warn(`[entwurf postinstall] chmod ${rel} skipped: ${err.message}`);
	}
}

for (const rel of targets) {
	chmodIfPresent(rel);
}

for (const dir of scriptDirs) {
	const abs = path.join(root, dir);
	try {
		if (!fs.existsSync(abs)) continue;
		for (const entry of fs.readdirSync(abs)) {
			if (entry.endsWith(".sh")) {
				chmodIfPresent(path.join(dir, entry));
			}
		}
	} catch (err) {
		console.warn(`[entwurf postinstall] scan ${dir}/*.sh skipped: ${err.message}`);
	}
}
