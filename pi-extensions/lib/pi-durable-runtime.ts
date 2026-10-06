/**
 * pi-durable-runtime — where the operator-provided durable runtime lives, and whether it is the pin
 * (#129 W, L3).
 *
 * The experimental durable app is SOURCE-ONLY upstream: the published Pi CLI ships no
 * `dist/experimental`, and `@earendil-works/pi-durable` on npm is the library, not this app. So its
 * runtime is a checkout the OPERATOR provides — the pinned commit plus this package's overlay patch
 * and the pinned model data — and Entwurf never downloads, installs, moves or deletes it. This leaf
 * only DETECTS it, at ONE fixed place:
 *
 *   $XDG_DATA_HOME/entwurf/pi-durable/runtime   (an absolute XDG_DATA_HOME; else ~/.local/share)
 *
 * There is no public path override. `ENTWURF_PI_DURABLE_RUNTIME` stays the CHECKOUT-ONLY input of
 * the `check-pi-durable-*` gates; nothing here reads it.
 *
 * A present runtime counts as the pin only when HEAD equals the pinned commit, the index equals HEAD
 * (nothing staged), `git diff --binary` equals the overlay patch bytes exactly, no non-ignored file is
 * untracked, the experimental source resolver is there, and the git-ignored model data matches the
 * pin's recorded digests. Anything else is present-but-wrong, a named refusal — never a guess and
 * never a repair. The index term is not optional: `git diff` compares the worktree to the INDEX, so a
 * staged edit to any other tracked file — or a staged new file, which is not "untracked" either —
 * would otherwise leave the diff equal to the patch.
 *
 * The diff bytes are compared, so the configuration knobs known to move them are pinned on the
 * command line to the form the packaged patch is in: abbreviation length, prefixes, colour,
 * external/textconv drivers, hunk algorithm and context, relative paths, and blank-context spacing
 * (`diff.suppressBlankEmpty`; the packaged patch has blank context lines). That is a bounded list,
 * not every knob git has: e.g. `diff.orderFile` (multi-file order) and line-ending conversion
 * (`core.autocrlf`/`core.eol`) are not neutralized, and a byte change they cause reads as pin drift.
 * Configuration is not disabled wholesale — `safe.directory` lives in global/system config.
 *
 * The overlay data (pin + patch) ships IN this package and is found relative to this module, at the
 * two depths the module is shipped at: the source checkout (`<root>/pi-extensions/lib/`) and the
 * compiled bridge closure (`<root>/mcp/entwurf-bridge/dist/pi-extensions/lib/`) — the same two-depth
 * arithmetic `metaCapabilitiesFilePath` answers. The compiled durable units are named from that same
 * root, so a launcher, a preflight and the bootstrap all read ONE package closure.
 *
 * Read-only: `git diff` and `git ls-files` run against a private COPY of the runtime's index
 * (`GIT_INDEX_FILE`), with GIT_OPTIONAL_LOCKS=0. The copy is not ceremony: `git diff` was measured
 * to refresh and rewrite a stat-dirty index even with optional locks off, so asking the operator's
 * own index would mutate their checkout. No network, no install, no credential, settings or session read.
 * Each `git` is a direct child with a wall-clock bound; one that does not answer in time is unverifiable.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** The fixed locator under the data home. Not configurable. */
export const PI_DURABLE_RUNTIME_SEGMENTS = ["entwurf", "pi-durable", "runtime"] as const;

/** The upstream source resolver the durable app runs under, inside the runtime checkout. */
export const PI_DURABLE_RESOLVER_RELATIVE = path.join(
	"packages",
	"coding-agent",
	"src",
	"experimental",
	"source-resolver.ts",
);

/** Every way the runtime can be refused. Stable contract: these cross the launcher, setup and the
 * fresh-call surfaces as named refusals. */
export type PiDurableRuntimeRejectReason =
	| "pi-durable-package-incomplete"
	| "pi-durable-runtime-locator-unset"
	| "pi-durable-runtime-absent"
	| "pi-durable-runtime-unverifiable"
	| "pi-durable-runtime-pin-drift"
	| "pi-durable-runtime-modeldata-drift";

/** The package closure this module belongs to: the overlay data and the compiled durable units. */
export interface PiDurablePackageLayout {
	readonly root: string;
	readonly overlayDir: string;
	/** The packaged bootstrap the launcher executes under the runtime's resolver. */
	readonly bootstrap: string;
	/** The compiled durable contact (birth, doorbell, visible identity decoration). */
	readonly adapter: string;
	/** The compiled entwurf-bridge entry the contact spawns as its MCP hand. */
	readonly bridgeEntry: string;
	/** The compiled sender/receiver owner join the bridge decides deliverability with. */
	readonly deliverability: string;
}

/** The layout rooted at `root`, as plain paths. */
export function piDurableLayoutAt(root: string): PiDurablePackageLayout {
	const dist = path.join(root, "mcp", "entwurf-bridge", "dist");
	return {
		root,
		overlayDir: path.join(root, "pi", "pi-durable", "overlay"),
		bootstrap: path.join(root, "pi", "pi-durable", "bootstrap.mjs"),
		adapter: path.join(dist, "pi-extensions", "meta-bridge-pi-durable.js"),
		bridgeEntry: path.join(dist, "mcp", "entwurf-bridge", "src", "index.js"),
		deliverability: path.join(dist, "pi-extensions", "lib", "entwurf-deliverability.js"),
	};
}

/**
 * The package closure, found from where THIS module lives: the source depth first, then the compiled
 * depth. `null` when neither carries the overlay pin — a packaging defect, refused by name.
 */
export function piDurablePackageLayout(from: string = import.meta.dirname): PiDurablePackageLayout | null {
	for (const up of [
		["..", ".."],
		["..", "..", "..", "..", ".."],
	]) {
		const root = path.resolve(from, ...up);
		const layout = piDurableLayoutAt(root);
		if (fs.existsSync(path.join(layout.overlayDir, "upstream-pin.json"))) return layout;
	}
	return null;
}

/** The fixed runtime location for this environment, or `null` when neither an absolute
 * XDG_DATA_HOME nor HOME exists to anchor it. A relative XDG_DATA_HOME is ignored (XDG spec). */
export function piDurableRuntimeDir(env: NodeJS.ProcessEnv): string | null {
	const xdg = env.XDG_DATA_HOME;
	if (typeof xdg === "string" && xdg.length > 0 && path.isAbsolute(xdg)) {
		return path.join(xdg, ...PI_DURABLE_RUNTIME_SEGMENTS);
	}
	const home = env.HOME;
	if (typeof home === "string" && home.length > 0 && path.isAbsolute(home)) {
		return path.join(home, ".local", "share", ...PI_DURABLE_RUNTIME_SEGMENTS);
	}
	return null;
}

export interface PiDurablePin {
	readonly commit: string;
	readonly patches: readonly string[];
	readonly modelData: {
		readonly path: string;
		readonly files: number;
		readonly aggregateSha256: string;
		readonly manifestSha256: string;
	};
}

/** The packaged pin and its one patch. A malformed pin throws (crash, don't warn). */
export function readPiDurablePin(overlayDir: string): { pin: PiDurablePin; patchBytes: Buffer } {
	const pin = JSON.parse(fs.readFileSync(path.join(overlayDir, "upstream-pin.json"), "utf8")) as PiDurablePin;
	if (typeof pin.commit !== "string" || !/^[0-9a-f]{40}$/.test(pin.commit)) {
		throw new Error(`pi-durable pin: commit is not a full sha (${JSON.stringify(pin.commit)})`);
	}
	if (!Array.isArray(pin.patches) || pin.patches.length !== 1 || typeof pin.patches[0] !== "string") {
		throw new Error("pi-durable pin: exactly one overlay patch is expected");
	}
	const md = pin.modelData;
	if (
		typeof md !== "object" ||
		md === null ||
		typeof md.path !== "string" ||
		typeof md.files !== "number" ||
		typeof md.aggregateSha256 !== "string" ||
		typeof md.manifestSha256 !== "string"
	) {
		throw new Error("pi-durable pin: modelData is malformed");
	}
	return { pin, patchBytes: fs.readFileSync(path.join(overlayDir, pin.patches[0])) };
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** The patch shape the packaged patch is in, fixed on the command line for the knobs the header lists:
 * git's default output with 8-hex `index` abbreviations. Two of those knobs are config-only and ride
 * beside these as `-c` at the call: `core.abbrev=8` ("auto" scales with the clone's object count) and
 * `diff.suppressBlankEmpty=false` (true drops the space before an empty context line). */
export const PI_DURABLE_DIFF_SHAPE = [
	"--binary",
	"--no-ext-diff",
	"--no-color",
	"--no-textconv",
	"--src-prefix=a/",
	"--dst-prefix=b/",
	"--no-relative",
	"--diff-algorithm=myers",
	"--indent-heuristic",
	"-U3",
	"--inter-hunk-context=0",
] as const;

/** Wall-clock bound for each local `git` the verifier runs (it also runs inside the bridge process). */
export const PI_DURABLE_GIT_TIMEOUT_MS = 30_000;

/** What a runtime directory holds, read without changing it. */
export interface PiDurableRuntimeFacts {
	readonly runtimeDir: string;
	readonly present: boolean;
	/** `git` answered all four questions (rev-parse, cached diff, diff, ls-files). */
	readonly gitAnswered: boolean;
	readonly head: string;
	/** The index equals HEAD: nothing is staged. */
	readonly indexMatchesHead: boolean;
	readonly diffEqualsPatch: boolean;
	readonly untracked: string;
	readonly resolverPresent: boolean;
	readonly modelDataFiles: number;
	readonly modelDataAggregate: string;
	readonly manifestSha256: string;
}

export function inspectPiDurableRuntime(runtimeDir: string, overlayDir: string): PiDurableRuntimeFacts {
	const { pin, patchBytes } = readPiDurablePin(overlayDir);
	const present = (() => {
		try {
			return fs.statSync(runtimeDir).isDirectory();
		} catch {
			// Bounded environment probe (Hard Rule 15's stated exception): absence is the answer.
			return false;
		}
	})();
	const base = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
	const git = (args: string[], env: NodeJS.ProcessEnv = base) =>
		spawnSync("git", ["-C", runtimeDir, ...args], {
			maxBuffer: 64 * 1024 * 1024,
			env,
			timeout: PI_DURABLE_GIT_TIMEOUT_MS,
		});
	const headRun = present ? git(["rev-parse", "HEAD"]) : undefined;
	// A private copy of the index, so the refresh `git diff` performs lands in a file this process owns.
	let scratch: string | undefined;
	let cachedRun: ReturnType<typeof git> | undefined;
	let diffRun: ReturnType<typeof git> | undefined;
	let untrackedRun: ReturnType<typeof git> | undefined;
	try {
		const indexPath = present ? git(["rev-parse", "--git-path", "index"]) : undefined;
		const index = indexPath?.status === 0 ? path.resolve(runtimeDir, indexPath.stdout.toString().trim()) : undefined;
		if (index !== undefined && fs.existsSync(index)) {
			scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-index-"));
			const copy = path.join(scratch, "index");
			fs.copyFileSync(index, copy);
			const onCopy = { ...base, GIT_INDEX_FILE: copy };
			// HEAD → index: exit 0 = nothing staged, 1 = something staged; anything else is no answer.
			cachedRun = git(["diff", "--cached", "--quiet", "--no-ext-diff", "--no-relative"], onCopy);
			diffRun = git(
				["-c", "core.abbrev=8", "-c", "diff.suppressBlankEmpty=false", "diff", ...PI_DURABLE_DIFF_SHAPE],
				onCopy,
			);
			untrackedRun = git(["ls-files", "--others", "--exclude-standard"], onCopy);
		}
	} finally {
		if (scratch !== undefined) fs.rmSync(scratch, { recursive: true, force: true });
	}
	const gitAnswered =
		headRun?.status === 0 &&
		(cachedRun?.status === 0 || cachedRun?.status === 1) &&
		diffRun?.status === 0 &&
		untrackedRun?.status === 0;
	const dataDir = path.join(runtimeDir, pin.modelData.path);
	const dataFiles = (() => {
		try {
			return fs
				.readdirSync(dataDir)
				.filter((n) => n.endsWith(".json") && !n.startsWith("."))
				.sort();
		} catch {
			return [];
		}
	})();
	const manifest = path.join(dataDir, ".manifest.json");
	return {
		runtimeDir,
		present,
		gitAnswered,
		head: headRun?.stdout?.toString().trim() ?? "",
		indexMatchesHead: cachedRun?.status === 0,
		diffEqualsPatch: diffRun?.status === 0 && Buffer.isBuffer(diffRun.stdout) && diffRun.stdout.equals(patchBytes),
		untracked: untrackedRun?.stdout?.toString().trim() ?? "",
		resolverPresent: present && fs.existsSync(path.join(runtimeDir, PI_DURABLE_RESOLVER_RELATIVE)),
		modelDataFiles: dataFiles.length,
		modelDataAggregate: sha256(
			dataFiles.map((n) => `${sha256(fs.readFileSync(path.join(dataDir, n)))}  ${n}\n`).join(""),
		),
		manifestSha256: fs.existsSync(manifest) ? sha256(fs.readFileSync(manifest)) : "absent",
	};
}

/** The verdict over those facts against the pin: `null` is "this is the pin". */
export function piDurableRuntimeVerdict(
	facts: PiDurableRuntimeFacts,
	pin: PiDurablePin,
): PiDurableRuntimeRejectReason | null {
	if (!facts.present) return "pi-durable-runtime-absent";
	if (!facts.gitAnswered) return "pi-durable-runtime-unverifiable";
	if (!facts.indexMatchesHead) return "pi-durable-runtime-pin-drift";
	if (facts.head !== pin.commit || !facts.diffEqualsPatch || facts.untracked !== "" || !facts.resolverPresent) {
		return "pi-durable-runtime-pin-drift";
	}
	if (
		facts.modelDataFiles !== pin.modelData.files ||
		facts.modelDataAggregate !== pin.modelData.aggregateSha256 ||
		facts.manifestSha256 !== pin.modelData.manifestSha256
	) {
		return "pi-durable-runtime-modeldata-drift";
	}
	return null;
}

export type PiDurableRuntimeCheck =
	| { ok: true; runtimeDir: string; resolver: string }
	| { ok: false; reason: PiDurableRuntimeRejectReason; runtimeDir: string | null };

/** Locate and verify, in that order. The launcher, setup and the fresh preflight all ask this. */
export function checkPiDurableRuntime(
	env: NodeJS.ProcessEnv,
	layout: PiDurablePackageLayout | null,
): PiDurableRuntimeCheck {
	if (layout === null) return { ok: false, reason: "pi-durable-package-incomplete", runtimeDir: null };
	const runtimeDir = piDurableRuntimeDir(env);
	if (runtimeDir === null) return { ok: false, reason: "pi-durable-runtime-locator-unset", runtimeDir: null };
	const { pin } = readPiDurablePin(layout.overlayDir);
	const reason = piDurableRuntimeVerdict(inspectPiDurableRuntime(runtimeDir, layout.overlayDir), pin);
	if (reason !== null) return { ok: false, reason, runtimeDir };
	return { ok: true, runtimeDir, resolver: path.join(runtimeDir, PI_DURABLE_RESOLVER_RELATIVE) };
}

export const PI_DURABLE_RUNTIME_HINT: Record<PiDurableRuntimeRejectReason, string> = {
	"pi-durable-package-incomplete":
		"this Entwurf package carries no pi-durable overlay pin next to its code — reinstall Entwurf; the package itself is incomplete",
	"pi-durable-runtime-locator-unset":
		"neither an absolute XDG_DATA_HOME nor HOME is set, so the fixed runtime location cannot be named",
	"pi-durable-runtime-absent":
		"no operator-provided durable runtime at the fixed location — Entwurf never installs it: provide the pinned upstream checkout plus the overlay patch and model data there (docs/setup-clean-host.md)",
	"pi-durable-runtime-unverifiable":
		"the runtime location exists but git could not read it as a checkout, so it cannot be proven to be the pin",
	"pi-durable-runtime-pin-drift":
		"the runtime is not the pin: HEAD, the overlay patch bytes, an untracked file or the source resolver differs from the packaged pi/pi-durable/overlay/upstream-pin.json — re-provision it at the pinned commit with exactly the packaged patch",
	"pi-durable-runtime-modeldata-drift":
		"the runtime's git-ignored model data is not the pinned bytes — restore the model data the pin records",
};

/** Exit codes of the CLI below, read by `run.sh`: 0 verified, 4 absent (setup SKIP), 3 anything else. */
export const PI_DURABLE_RUNTIME_EXIT = { verified: 0, absent: 4, refused: 3 } as const;

/**
 * `resolve`: print the verified runtime's source-resolver path (stdout) and exit 0, or print
 * `<reason>: <hint>` (stderr) and exit 4 for an absent runtime / 3 for every other refusal.
 * The launcher execs node under that resolver; setup maps the three codes to PASS / SKIP / FAIL.
 */
export function runPiDurableRuntimeCli(
	argv: readonly string[],
	env: NodeJS.ProcessEnv,
	layout: PiDurablePackageLayout | null,
	out: { stdout: (line: string) => void; stderr: (line: string) => void },
): number {
	if (argv.length !== 1 || argv[0] !== "resolve") {
		out.stderr("usage: pi-durable-runtime resolve");
		return 2;
	}
	const checked = checkPiDurableRuntime(env, layout);
	if (checked.ok) {
		out.stdout(checked.resolver);
		return PI_DURABLE_RUNTIME_EXIT.verified;
	}
	out.stderr(
		`${checked.reason}${checked.runtimeDir === null ? "" : ` (${checked.runtimeDir})`}: ${PI_DURABLE_RUNTIME_HINT[checked.reason]}`,
	);
	return checked.reason === "pi-durable-runtime-absent"
		? PI_DURABLE_RUNTIME_EXIT.absent
		: PI_DURABLE_RUNTIME_EXIT.refused;
}

// RUN AS THE CLI ONLY WHEN THIS FILE IS THE PROCESS ENTRY. Decided by an argv comparison, as in
// meta-bridge-hook-codex.ts, and not by the `main` flag on import.meta: that flag landed in Node 24.2.0
// and the package floor is major 24, so on 24.0/24.1 it is undefined — `resolve` would exit 0 having
// printed nothing, which setup reads as PASS and the launcher as a resolver.
const invokedDirectly = (() => {
	const entry = process.argv[1];
	if (typeof entry !== "string" || entry.length === 0) return false;
	try {
		return fs.realpathSync(entry) === fs.realpathSync(import.meta.filename);
	} catch {
		// Bounded environment probe: an entry that cannot be resolved is not this file.
		return false;
	}
})();
if (invokedDirectly) {
	process.exitCode = runPiDurableRuntimeCli(process.argv.slice(2), process.env, piDurablePackageLayout(), {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	});
}
