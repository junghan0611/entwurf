// Deterministic gate for the S2b Claude config overlay materializer.
//
// Drives ensureClaudeConfigOverlay against INJECTED temp realDir/overlayDir
// (no operator ~/.claude touched), then asserts the overlay shape the ACP
// child must see:
//   - settings.json: permissions.defaultMode "default", autoMemoryEnabled
//     false, hooks === {} (configured-but-empty → mailbox absence by design);
//   - whitelisted operator entries symlinked to their real path;
//   - projects/sessions are overlay-PRIVATE real dirs, NOT symlinks;
//   - non-whitelist operator entries (CLAUDE.md, settings.local.json, plugins,
//     agents) never appear in the overlay;
//   - stale symlinks (a prior "linked everything" overlay) are cleaned up,
//     including a binary-owned STALE SYMLINK (backups → operator data) torn down
//     and a whitelist symlink whose real source is gone (telemetry) removed;
//   - binary-owned real files (.claude.json) are preserved across re-runs;
//   - claudeLaunchEnvDefaults plants CLAUDE_CONFIG_DIR = overlayDir;
//   - idempotent (a second run yields the identical shape).
//
// Pure/deterministic — no live model, no network, OUT of nothing (IN pnpm check).

import { strict as assert } from "node:assert";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claudeLaunchEnvDefaults,
	ensureClaudeConfigOverlay,
	OVERLAY_BINARY_OWNED,
	OVERLAY_EMPTY_DIRS,
	OVERLAY_PASSTHROUGH,
} from "../pi-extensions/lib/acp/overlay.ts";

const root = mkdtempSync(join(tmpdir(), "entwurf-s2b-overlay-"));
const realDir = join(root, "real-claude");
const overlayDir = join(root, "overlay");

try {
	// --- seed a fake operator ~/.claude ---
	mkdirSync(realDir, { recursive: true });
	// whitelisted (must be linked)
	writeFileSync(join(realDir, ".credentials.json"), '{"fake":"creds"}\n', "utf8");
	mkdirSync(join(realDir, "skills"), { recursive: true });
	mkdirSync(join(realDir, "cache"), { recursive: true });
	writeFileSync(join(realDir, "stats-cache.json"), "{}\n", "utf8");
	// NON-whitelist operator personal config (must NOT appear in overlay)
	writeFileSync(join(realDir, "CLAUDE.md"), "# personal\n", "utf8");
	writeFileSync(join(realDir, "settings.local.json"), '{"env":{"SECRET":"x"}}\n', "utf8");
	mkdirSync(join(realDir, "plugins"), { recursive: true });
	mkdirSync(join(realDir, "agents"), { recursive: true });
	// operator data the overlay must shadow with empty dirs
	mkdirSync(join(realDir, "projects", "some-cwd"), { recursive: true });
	mkdirSync(join(realDir, "sessions"), { recursive: true });

	// --- pre-seed a STALE overlay from an earlier "linked everything" version ---
	mkdirSync(overlayDir, { recursive: true });
	symlinkSync(join(realDir, "plugins"), join(overlayDir, "plugins")); // stale non-whitelist symlink
	symlinkSync(join(realDir, "projects"), join(overlayDir, "projects")); // stale projects symlink → must become empty dir
	writeFileSync(join(overlayDir, ".claude.json"), '{"binary":"owned"}\n', "utf8"); // binary-owned real file → preserved
	symlinkSync(join(realDir, "plugins"), join(overlayDir, "backups")); // binary-owned STALE SYMLINK → must be torn down (not preserved)
	symlinkSync(join(realDir, "telemetry"), join(overlayDir, "telemetry")); // whitelist symlink whose real source is GONE → must be removed

	// --- run ---
	ensureClaudeConfigOverlay(realDir, overlayDir);

	// settings.json
	const settings = JSON.parse(readFileSync(join(overlayDir, "settings.json"), "utf8"));
	assert.equal(settings.permissions?.defaultMode, "default", "settings.permissions.defaultMode must be 'default'");
	assert.equal(settings.autoMemoryEnabled, false, "settings.autoMemoryEnabled must be false");
	assert.ok(
		settings.hooks && typeof settings.hooks === "object" && Object.keys(settings.hooks).length === 0,
		"settings.hooks must be a configured-but-EMPTY object {} (mailbox absence by design)",
	);

	// whitelisted entries → symlinks to the real path
	for (const entry of OVERLAY_PASSTHROUGH) {
		const overlayPath = join(overlayDir, entry);
		const realPath = join(realDir, entry);
		if (entry === ".credentials.json" || entry === "skills" || entry === "cache" || entry === "stats-cache.json") {
			const st = lstatSync(overlayPath);
			assert.ok(st.isSymbolicLink(), `whitelist entry ${entry} must be a symlink`);
			assert.equal(readlinkSync(overlayPath), realPath, `whitelist entry ${entry} must point at the real path`);
		} else {
			// not seeded in realDir → must be absent in overlay
			assert.throws(() => lstatSync(overlayPath), `unseeded whitelist entry ${entry} must not exist in overlay`);
		}
	}

	// projects/sessions → real dirs, NOT symlinks
	for (const entry of OVERLAY_EMPTY_DIRS) {
		const st = lstatSync(join(overlayDir, entry));
		assert.ok(st.isDirectory() && !st.isSymbolicLink(), `${entry} must be an overlay-private real dir, not a symlink`);
	}

	// non-whitelist operator config never leaks
	for (const leak of ["CLAUDE.md", "settings.local.json", "plugins", "agents"]) {
		assert.throws(() => lstatSync(join(overlayDir, leak)), `non-whitelist entry ${leak} must NOT appear in overlay`);
	}

	// binary-owned real file preserved
	assert.ok(OVERLAY_BINARY_OWNED.has(".claude.json"), "test premise: .claude.json is binary-owned");
	assert.equal(
		readFileSync(join(overlayDir, ".claude.json"), "utf8"),
		'{"binary":"owned"}\n',
		"binary-owned .claude.json must be preserved across overlay build",
	);

	// binary-owned STALE SYMLINK torn down — a binary-owned name is preserved only
	// when it is a real binary-authored file/dir; a symlink pointing at operator
	// data (migration residue) must be removed so the binary re-inits fresh.
	assert.ok(OVERLAY_BINARY_OWNED.has("backups"), "test premise: backups is binary-owned");
	assert.throws(
		() => lstatSync(join(overlayDir, "backups")),
		"binary-owned stale symlink (backups → operator data) must be torn down, not preserved",
	);

	// whitelist entry whose real source is GONE → stale overlay copy removed (the
	// telemetry symlink was preseeded but realDir/telemetry was never created).
	assert.throws(
		() => lstatSync(join(overlayDir, "telemetry")),
		"whitelist entry must be removed when its operator-side source no longer exists",
	);

	// launch env builder
	assert.deepEqual(
		claudeLaunchEnvDefaults(overlayDir),
		{ CLAUDE_CONFIG_DIR: overlayDir },
		"claudeLaunchEnvDefaults must plant CLAUDE_CONFIG_DIR = overlayDir",
	);

	// idempotency — a second run yields the identical critical shape
	ensureClaudeConfigOverlay(realDir, overlayDir);
	const credSt = lstatSync(join(overlayDir, ".credentials.json"));
	assert.ok(credSt.isSymbolicLink(), "credentials symlink must survive a second run");
	const projSt = lstatSync(join(overlayDir, "projects"));
	assert.ok(projSt.isDirectory() && !projSt.isSymbolicLink(), "projects must stay a real dir on re-run");
	assert.throws(() => lstatSync(join(overlayDir, "plugins")), "stale plugins symlink must stay gone on re-run");

	console.log(
		`[check-acp-overlay] ok — overlay authors hooks:{} settings, symlinks ${OVERLAY_PASSTHROUGH.size}-entry whitelist, ` +
			`shadows projects/sessions with private dirs, hides operator personal config, preserves binary-owned real files ` +
			`while tearing down binary-owned/whitelist stale symlinks, plants CLAUDE_CONFIG_DIR, idempotent`,
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
