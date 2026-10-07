/**
 * pi-durable-runtime — whether THIS package's pi-durable carrier can run, and the resolver it runs
 * under (#129 W, #130).
 *
 * The experimental durable app is source-only upstream: published `@earendil-works/pi-coding-agent`
 * ships no `dist/experimental`. Entwurf therefore ships the app itself as a CARRIER — the pinned
 * upstream files, type-stripped and relocated (pi/pi-durable/carrier/, emitted only by the
 * maintainer's scripts/emit-pi-durable-carrier.ts) — and declares the published SDK set it runs
 * against as exact production dependencies. Nothing is provisioned beside the package: there is no
 * runtime directory, no source checkout and no model data to copy (it rides the published pi-ai).
 *
 * The carrier counts as runnable only when, read from where this package is installed:
 *   - every pinned carrier file, the license, the resolver and its relocation grammar are present
 *     (else `pi-durable-package-incomplete`);
 *   - each carrier file and the license carry the pinned sha256 (else `pi-durable-carrier-drift`);
 *   - every declared SDK member and direct dependency resolves from the carrier, and every member
 *     copy the carrier can reach — at any depth, nested copies included — resolves each of its own
 *     member dependencies (else `pi-durable-sdk-absent`);
 *   - each of those PHYSICAL edges lands on a package that is the one it names, at exactly the
 *     declared version (else `pi-durable-sdk-mismatch`). The members declare each other with caret ranges, so semver
 *     satisfaction is not the contract — the bytes a carrier import actually binds are. Sharing one
 *     copy with a host install of the same version is an ordinary layout and passes; how many copies
 *     of a version exist is not asked.
 *
 * Every refusal names the first failing item, in repair order. This leaf is the native-set check
 * only: the ordinary Pi HOST on PATH is a different subject (`pi_supported_range` in run.sh).
 *
 * Read-only: file reads and Node's own package resolution (`module.findPackageJSON`) from the
 * carrier's location. No git, no network, no environment, no credential, settings or session read.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { findPackageJSON } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/** Every way the carrier can be refused. Stable contract: these cross the launcher, setup and the
 * fresh-call surfaces as named refusals. */
export type PiDurableRuntimeRejectReason =
	| "pi-durable-package-incomplete"
	| "pi-durable-carrier-drift"
	| "pi-durable-sdk-absent"
	| "pi-durable-sdk-mismatch";

/** The package closure this module belongs to: the pin, the carrier and the compiled durable units. */
export interface PiDurablePackageLayout {
	readonly root: string;
	readonly overlayDir: string;
	/** The emitted upstream app files and their license. */
	readonly carrierDir: string;
	/** The `--import` resolver the launcher runs the bootstrap under. */
	readonly resolver: string;
	/** The relocation grammar the resolver imports. */
	readonly relocation: string;
	/** The packaged bootstrap the launcher executes under the resolver. */
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
	const durable = path.join(root, "pi", "pi-durable");
	const dist = path.join(root, "mcp", "entwurf-bridge", "dist");
	return {
		root,
		overlayDir: path.join(durable, "overlay"),
		carrierDir: path.join(durable, "carrier"),
		resolver: path.join(durable, "carrier-resolver.mjs"),
		relocation: path.join(durable, "carrier-relocation.mjs"),
		bootstrap: path.join(durable, "bootstrap.mjs"),
		adapter: path.join(dist, "pi-extensions", "meta-bridge-pi-durable.js"),
		bridgeEntry: path.join(dist, "mcp", "entwurf-bridge", "src", "index.js"),
		deliverability: path.join(dist, "pi-extensions", "lib", "entwurf-deliverability.js"),
	};
}

/**
 * The package closure, found from where THIS module lives: the source depth first, then the compiled
 * depth (`<root>/mcp/entwurf-bridge/dist/pi-extensions/lib/`). `null` when neither carries the pin —
 * a packaging defect, refused by name.
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

/** What the verifier reads from the packaged pin. */
export interface PiDurableCarrierPin {
	readonly files: readonly { readonly name: string; readonly sha256: string }[];
	readonly license: { readonly sha256: string };
	/** `@earendil-works/*` members: name → exact version. */
	readonly members: Readonly<Record<string, string>>;
	/** Third-party packages a carrier file imports itself: name → exact version. */
	readonly direct: Readonly<Record<string, string>>;
}

const SHA256 = /^[0-9a-f]{64}$/;
const EXACT = /^\d+\.\d+\.\d+$/;

/** The packaged pin's carrier and SDK declarations. A malformed pin throws (crash, don't warn). */
export function readPiDurableCarrierPin(overlayDir: string): PiDurableCarrierPin {
	const pin = JSON.parse(fs.readFileSync(path.join(overlayDir, "upstream-pin.json"), "utf8"));
	const files = pin?.carrier?.files;
	const license = pin?.carrier?.license;
	const members = pin?.sdk?.members;
	const direct = pin?.sdk?.direct;
	const versions = (set: unknown) =>
		typeof set === "object" && set !== null && Object.values(set).every((v) => typeof v === "string" && EXACT.test(v));
	if (
		!Array.isArray(files) ||
		files.length === 0 ||
		!files.every((f) => typeof f?.name === "string" && /^[a-z0-9-]+\.js$/.test(f.name) && SHA256.test(f?.sha256)) ||
		!SHA256.test(license?.sha256) ||
		!versions(members) ||
		Object.keys(members).length === 0 ||
		!versions(direct)
	) {
		throw new Error("pi-durable pin: carrier files/license digests and exact sdk members/direct versions are required");
	}
	return { files, license, members, direct };
}

/** One physical dependency edge: `to` as resolved from `from`'s location. */
export interface PiDurableSdkEdge {
	/** `carrier` or the member the edge leaves. */
	readonly from: string;
	readonly to: string;
	readonly want: string;
	/** The resolved package's version, or `null` when it does not resolve. */
	readonly got: string | null;
	/** The name the resolved package.json declares, or `null` — must be `to` itself. */
	readonly name: string | null;
	/** The resolved package directory, or `null`. */
	readonly at: string | null;
}

/** What the installed package holds, read without changing it. */
export interface PiDurableRuntimeFacts {
	/** A carrier/resolver/relocation file that is not there. */
	readonly missing: readonly string[];
	/** A carrier file (or LICENSE) whose bytes are not the pinned ones. */
	readonly drifted: readonly string[];
	readonly edges: readonly PiDurableSdkEdge[];
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** `name` resolved from `fromFile` by Node's own package resolution: its version and directory. */
function resolveEdge(from: string, to: string, want: string, fromFile: string): PiDurableSdkEdge {
	let manifest: string | undefined;
	try {
		manifest = findPackageJSON(to, pathToFileURL(fromFile));
	} catch {
		// Bounded environment probe: an unresolvable package is the `got: null` answer.
		manifest = undefined;
	}
	if (manifest === undefined) return { from, to, want, got: null, name: null, at: null };
	const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
	return {
		from,
		to,
		want,
		got: typeof json.version === "string" ? json.version : null,
		name: typeof json.name === "string" ? json.name : null,
		at: fs.realpathSync(path.dirname(manifest)),
	};
}

export function inspectPiDurableRuntime(layout: PiDurablePackageLayout): PiDurableRuntimeFacts {
	const pin = readPiDurableCarrierPin(layout.overlayDir);
	const missing: string[] = [];
	const drifted: string[] = [];
	const pinned = [...pin.files, { name: "LICENSE", sha256: pin.license.sha256 }];
	for (const file of pinned) {
		const at = path.join(layout.carrierDir, file.name);
		if (!fs.existsSync(at)) missing.push(path.relative(layout.root, at));
		else if (sha256(fs.readFileSync(at)) !== file.sha256) drifted.push(path.relative(layout.root, at));
	}
	for (const at of [layout.resolver, layout.relocation]) {
		if (!fs.existsSync(at)) missing.push(path.relative(layout.root, at));
	}
	const edges: PiDurableSdkEdge[] = [];
	// From the carrier's own location: the bare imports its files make resolve from there.
	const base = path.join(layout.carrierDir, pin.files[0].name);
	// Every member COPY the carrier can reach is walked, at any depth: a nested copy's own member
	// dependencies are edges too. One physical directory is walked once (shared and duplicate copies
	// are ordinary; a member cycle terminates), keyed by its realpath.
	const pending: { name: string; at: string }[] = [];
	for (const [name, want] of Object.entries({ ...pin.members, ...pin.direct })) {
		const edge = resolveEdge("carrier", name, want, base);
		edges.push(edge);
		if (name in pin.members && edge.at !== null) pending.push({ name, at: edge.at });
	}
	const walked = new Set<string>();
	for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
		if (walked.has(next.at)) continue;
		walked.add(next.at);
		const manifest = path.join(next.at, "package.json");
		const deps = JSON.parse(fs.readFileSync(manifest, "utf8")).dependencies ?? {};
		for (const dep of Object.keys(deps)
			.filter((d) => d in pin.members)
			.sort()) {
			const edge = resolveEdge(next.name, dep, pin.members[dep], manifest);
			edges.push(edge);
			if (edge.at !== null) pending.push({ name: dep, at: edge.at });
		}
	}
	return { missing, drifted, edges };
}

const edgeText = (e: PiDurableSdkEdge): string =>
	`${e.from} → ${e.to} wants ${e.want}, ${
		e.got === null
			? "resolves nothing"
			: `binds ${e.name === e.to ? "" : `${e.name ?? "(unnamed)"}@`}${e.got} at ${e.at}`
	}`;

/** The verdict over those facts, in repair order: `null` is "the carrier can run". */
export function piDurableRuntimeVerdict(
	facts: PiDurableRuntimeFacts,
): { reason: PiDurableRuntimeRejectReason; detail: string } | null {
	if (facts.missing.length > 0)
		return { reason: "pi-durable-package-incomplete", detail: `missing ${facts.missing.join(", ")}` };
	if (facts.drifted.length > 0)
		return { reason: "pi-durable-carrier-drift", detail: `changed ${facts.drifted.join(", ")}` };
	const absent = facts.edges.find((e) => e.got === null);
	if (absent !== undefined) return { reason: "pi-durable-sdk-absent", detail: edgeText(absent) };
	const mismatch = facts.edges.find((e) => e.got !== e.want || e.name !== e.to);
	if (mismatch !== undefined) return { reason: "pi-durable-sdk-mismatch", detail: edgeText(mismatch) };
	return null;
}

export type PiDurableRuntimeCheck =
	| { ok: true; resolver: string; edges: readonly PiDurableSdkEdge[] }
	| { ok: false; reason: PiDurableRuntimeRejectReason; detail: string };

/** Locate and verify. The launcher, setup, the fresh preflight and the durable gates all ask this. */
export function checkPiDurableRuntime(layout: PiDurablePackageLayout | null): PiDurableRuntimeCheck {
	if (layout === null) {
		return { ok: false, reason: "pi-durable-package-incomplete", detail: "no pi-durable pin next to this code" };
	}
	const facts = inspectPiDurableRuntime(layout);
	const verdict = piDurableRuntimeVerdict(facts);
	if (verdict !== null) return { ok: false, ...verdict };
	return { ok: true, resolver: layout.resolver, edges: facts.edges };
}

export const PI_DURABLE_RUNTIME_HINT: Record<PiDurableRuntimeRejectReason, string> = {
	"pi-durable-package-incomplete":
		"this Entwurf package is missing part of its pi-durable carrier — reinstall Entwurf; nothing outside the package supplies it",
	"pi-durable-carrier-drift":
		"a pi-durable carrier file is not the bytes pi/pi-durable/overlay/upstream-pin.json records — reinstall Entwurf; the carrier is never edited in place",
	"pi-durable-sdk-absent":
		"a declared pi SDK package does not resolve from the carrier — reinstall Entwurf so its dependencies are installed",
	"pi-durable-sdk-mismatch":
		"a pi SDK package the carrier binds is not the declared version (another install's copy, an override or a partial upgrade) — reinstall Entwurf into a tree whose @earendil-works packages are the pinned version",
};

/** Exit codes of the CLI below, read by `run.sh`: 0 verified, 3 refused. There is no "absent"
 * answer any more: the carrier ships in the package, so a missing piece is an incomplete install. */
export const PI_DURABLE_RUNTIME_EXIT = { verified: 0, refused: 3 } as const;

/**
 * `resolve`: print the verified carrier's resolver path (stdout) and exit 0, or print
 * `<reason>: <detail> — <hint>` (stderr) and exit 3. The launcher execs node under that resolver;
 * setup maps the two codes to PASS / FAIL.
 */
export function runPiDurableRuntimeCli(
	argv: readonly string[],
	layout: PiDurablePackageLayout | null,
	out: { stdout: (line: string) => void; stderr: (line: string) => void },
): number {
	if (argv.length !== 1 || argv[0] !== "resolve") {
		out.stderr("usage: pi-durable-runtime resolve");
		return 2;
	}
	const checked = checkPiDurableRuntime(layout);
	if (checked.ok) {
		out.stdout(checked.resolver);
		return PI_DURABLE_RUNTIME_EXIT.verified;
	}
	out.stderr(`${checked.reason}: ${checked.detail} — ${PI_DURABLE_RUNTIME_HINT[checked.reason]}`);
	return PI_DURABLE_RUNTIME_EXIT.refused;
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
	process.exitCode = runPiDurableRuntimeCli(process.argv.slice(2), piDurablePackageLayout(), {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	});
}
