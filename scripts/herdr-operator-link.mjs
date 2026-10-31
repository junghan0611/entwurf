#!/usr/bin/env node
/**
 * herdr-operator-link — the operator's ONE explicit link to the Herdr runtime's `entwurf` (#153).
 *
 * The plugin puts nothing on PATH (`herdr-runtime.mjs` header). This verb is the single exception,
 * and only on request: `expose --bin-dir <abs>` makes exactly one symlink, `<bin-dir>/entwurf`, to
 * the stable runtime's `node_modules/.bin/entwurf`; `withdraw` takes exactly that link back. Nothing
 * else is named, no profile is edited, and no directory is chosen for the operator.
 *
 * THE RECEIPT IS THE SUB-OWNER. One file beside the activation ledger records the link — six keys,
 * three phases — and is the only authority any inverse acts on. A link without a receipt is someone
 * else's, whatever it points at, and nothing here goes looking along PATH for one.
 *
 * THE LEDGER FLOOR COMES FIRST. A receipt may exist only beside a schema-3 ledger: a reader that
 * admits only 2 refuses that ledger before its first write, so an artifact that does not know this
 * receipt can never tear down a runtime the link still names. The floor is raised here, and only
 * here, from a settled host with no receipt; it is never lowered — a withdraw keeps it.
 *
 * ORDER IS THE CRASH CONTRACT: floor 3 → receipt `linking` → symlink → receipt `linked`. Each step
 * is published atomically (write beside, rename) and judged again on the next call, so a process
 * stopped between any two leaves a state the next call names and continues. Power loss is not
 * certified (no fsync), as for the ledger itself.
 *
 * EVERY IMPORT IS STATIC. `herdr-plugin-deactivate` imports this module and then deletes the runtime
 * it runs from; a lazy import afterwards would fail.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	ActivationError,
	certifyLedgerDescribesRuntime,
	certifyPhaseForInverse,
	certifyRootsAgainstLedger,
	readCertifiedLedger,
	resolveActivationLayout,
	resolveComponentRoots,
	runtimeIdentityOnDisk,
	writeLedger,
} from "./herdr-activation.mjs";
import {
	artifactCompleteness,
	readCertifiedJournal,
	resolveRuntimeLayout,
	verifyInstalledRuntime,
} from "./herdr-runtime.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The one name this verb links, and the floor a receipt requires. */
const LINK_NAME = "entwurf";
const LEDGER_FLOOR_VERSION = 3;

export const OPERATOR_LINK_SCHEMA_VERSION = 1;
export const OPERATOR_LINK_KEYS = Object.freeze([
	"schemaVersion",
	"phase",
	"binDir",
	"linkPath",
	"target",
	"runtimeRoot",
]);
export const OPERATOR_LINK_PHASES = Object.freeze(["linking", "linked", "unlinking"]);

function refuse(code, detail) {
	throw new ActivationError(code, detail);
}

/** The receipt's fixed address: the ledger's own state root, its own file. */
export function resolveOperatorLinkLayout(env) {
	const { stateRoot } = resolveActivationLayout(env);
	return Object.freeze({ stateRoot, receiptPath: path.join(stateRoot, "operator-link.json") });
}

/** What the link points at: the stable runtime's own `entwurf`, lexically — never a resolved path. */
export function operatorLinkTarget(activeDir) {
	return path.join(activeDir, "node_modules", ".bin", LINK_NAME);
}

/** The receipt, certified, or null when none stands at its address. */
export function readCertifiedOperatorLink(layout, activeDir) {
	const kind = fs.lstatSync(layout.receiptPath, { throwIfNoEntry: false });
	if (kind === undefined) return null;
	const uncertified = (why) => refuse("operator-link-receipt-uncertified", `${layout.receiptPath}: ${why}`);
	if (!kind.isFile()) uncertified("only a regular file may stand at the receipt address");
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(layout.receiptPath, "utf8"));
	} catch (err) {
		uncertified(err.message);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) uncertified("not a JSON object");
	if (Object.keys(parsed).sort().join(",") !== [...OPERATOR_LINK_KEYS].sort().join(",")) {
		uncertified(`key set: ${Object.keys(parsed).sort()}`);
	}
	if (parsed.schemaVersion !== OPERATOR_LINK_SCHEMA_VERSION) uncertified(`schemaVersion ${parsed.schemaVersion}`);
	if (!OPERATOR_LINK_PHASES.includes(parsed.phase)) uncertified(`phase ${JSON.stringify(parsed.phase)}`);
	for (const key of ["binDir", "linkPath", "target", "runtimeRoot"]) {
		if (typeof parsed[key] !== "string" || !path.isAbsolute(parsed[key])) uncertified(`${key} is not an absolute path`);
	}
	if (parsed.linkPath !== path.join(parsed.binDir, LINK_NAME)) uncertified("linkPath is not <binDir>/entwurf");
	if (parsed.target !== operatorLinkTarget(activeDir)) uncertified(`target is not ${operatorLinkTarget(activeDir)}`);
	if (parsed.runtimeRoot !== activeDir) uncertified(`runtimeRoot is not this host's stable root ${activeDir}`);
	return Object.freeze(parsed);
}

/** Receipts are replaced, never patched: write beside, then rename. */
function writeOperatorLink(layout, body) {
	fs.mkdirSync(layout.stateRoot, { recursive: true });
	const tmp = `${layout.receiptPath}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
	fs.renameSync(tmp, layout.receiptPath);
}

/**
 * A receipt, in any phase, belongs to a certified schema-3 ledger for this runtime and these roots.
 * Anything else is refused before a byte is written — it is never adopted, and the floor is never
 * raised to make it fit.
 */
function certifyReceiptBinding(receipt, ledger, roots, activeDir) {
	if (receipt === null) return;
	if (ledger === null) refuse("operator-link-orphan", "an operator-link receipt stands with no activation ledger");
	if (ledger.schemaVersion !== LEDGER_FLOOR_VERSION)
		refuse("operator-link-floor-mismatch", `the ledger is schema ${ledger.schemaVersion}, not ${LEDGER_FLOOR_VERSION}`);
	certifyRootsAgainstLedger(ledger, roots, activeDir);
}

/** `real` (a physical directory that is its own realpath), `gone`, or `alias`. */
function assessBinDir(binDir) {
	const kind = fs.lstatSync(binDir, { throwIfNoEntry: false });
	if (kind === undefined) return "gone";
	if (!kind.isDirectory()) return "alias";
	if (fs.realpathSync(binDir) !== binDir) return "alias";
	return "real";
}

/** `absent`, `ours` (a symlink whose text is exactly the target), or `foreign`. */
function assessLink(linkPath, target) {
	const kind = fs.lstatSync(linkPath, { throwIfNoEntry: false });
	if (kind === undefined) return "absent";
	if (kind.isSymbolicLink() && fs.readlinkSync(linkPath) === target) return "ours";
	return "foreign";
}

function isExecutableFile(file) {
	try {
		if (fs.statSync(file).isDirectory()) return false;
		fs.accessSync(file, fs.constants.X_OK);
		return true;
	} catch {
		// Bounded probe: missing or not executable is simply "not a candidate".
		return false;
	}
}

/**
 * Where B stands in THIS caller's PATH, judged by path alone — no program is run. An empty entry is
 * the cwd and a relative one is relative to it, which is why the run.sh arm does not cd. Aliases,
 * functions, the shell's hash table and other shells' PATHs are outside this judgement.
 */
function pathSelection(binDir, { PATH, cwd }) {
	for (const entry of (PATH ?? "").split(path.delimiter)) {
		const dir = path.resolve(cwd, entry === "" ? "." : entry);
		if (dir === binDir) return { onPath: true, shadowedBy: null };
		const candidate = path.join(dir, LINK_NAME);
		if (isExecutableFile(candidate)) return { onPath: false, shadowedBy: candidate };
	}
	return { onPath: false, shadowedBy: null };
}

/** A public verb runs only as the active runtime's own package — never from a checkout or a copy. */
function admitSelf(runtime, verb) {
	let same = false;
	try {
		same =
			fs.realpathSync(PACKAGE_ROOT) ===
			fs.realpathSync(path.join(runtime.activeDir, "node_modules", "@junghanacs", "entwurf"));
	} catch {
		// Bounded probe: no package at the stable address means this is not it.
		same = false;
	}
	if (!same) {
		refuse(
			"operator-link-not-active-package",
			`${verb} runs only from the Herdr runtime's own package (${runtime.activeDir}); this is ${PACKAGE_ROOT}`,
		);
	}
}

function usage(detail) {
	refuse(
		"operator-link-usage",
		`${detail} — usage: herdr-plugin-expose-operator --bin-dir <absolute dir> | herdr-plugin-withdraw-operator`,
	);
}

/** Exactly `--bin-dir <absolute>`; nothing else, in no other order. */
function parseExposeArgv(argv) {
	if (argv.length !== 2 || argv[0] !== "--bin-dir")
		usage(`expose takes exactly --bin-dir <dir>, got ${JSON.stringify(argv)}`);
	if (!path.isAbsolute(argv[1])) usage(`--bin-dir must be absolute, got ${JSON.stringify(argv[1])}`);
	return argv[1];
}

/**
 * Make the one link, or say by name why not. Every judgement comes before the first write.
 *
 * @returns a one-line outcome for the operator.
 */
export function expose(env, argv, { cwd }) {
	const binDir = parseExposeArgv(argv);
	const runtime = resolveRuntimeLayout(env);
	const activation = resolveActivationLayout(env);
	const roots = resolveComponentRoots(env);
	const layout = resolveOperatorLinkLayout(env);
	admitSelf(runtime, "expose");

	const journal = readCertifiedJournal(runtime);
	if (journal === null || journal.phase !== "runtime-ready") {
		refuse("operator-link-runtime-not-ready", `${runtime.activeDir} has no certified runtime-ready journal behind it`);
	}
	verifyInstalledRuntime(runtime.activeDir, artifactCompleteness(journal.artifactIdentity));
	const ledger = readCertifiedLedger(activation);
	if (ledger === null || ledger.phase !== "active") {
		refuse(
			"operator-link-activation-not-settled",
			`the activation ledger is ${ledger === null ? "absent" : ledger.phase}, not active`,
		);
	}
	certifyRootsAgainstLedger(ledger, roots, runtime.activeDir);
	certifyLedgerDescribesRuntime(ledger, runtimeIdentityOnDisk(journal));
	if (
		fs.lstatSync(runtime.stagingDir, { throwIfNoEntry: false }) ||
		fs.lstatSync(runtime.previousDir, { throwIfNoEntry: false })
	) {
		refuse(
			"operator-link-runtime-not-settled",
			"a staged or backed-up runtime stands beside the active one; finish or recover that install first",
		);
	}
	const target = operatorLinkTarget(runtime.activeDir);
	if (!isExecutableFile(target)) refuse("operator-link-target-missing", `${target} is not an executable file`);
	if (assessBinDir(binDir) !== "real") {
		refuse("operator-link-bin-dir-refused", `${binDir} is not an existing physical directory that is its own realpath`);
	}
	const selection = pathSelection(binDir, { PATH: env.PATH, cwd });
	if (selection.shadowedBy !== null) {
		refuse(
			"operator-link-path-shadowed",
			`${selection.shadowedBy} comes before ${binDir} on PATH; a link there would not be the one that runs`,
		);
	}
	if (!selection.onPath) refuse("operator-link-bin-dir-off-path", `${binDir} is not an entry of the current PATH`);

	const linkPath = path.join(binDir, LINK_NAME);
	const receipt = readCertifiedOperatorLink(layout, runtime.activeDir);
	certifyReceiptBinding(receipt, ledger, roots, runtime.activeDir);
	const link = assessLink(linkPath, target);
	const body = (phase) => ({
		schemaVersion: OPERATOR_LINK_SCHEMA_VERSION,
		phase,
		binDir,
		linkPath,
		target,
		runtimeRoot: runtime.activeDir,
	});

	if (receipt === null) {
		if (link !== "absent")
			refuse("operator-link-foreign", `${linkPath} exists and no receipt says it is ours; remove it yourself if it is`);
		const { schemaVersion, ...entry } = ledger;
		if (schemaVersion !== LEDGER_FLOOR_VERSION) writeLedger(activation, LEDGER_FLOOR_VERSION, entry);
		writeOperatorLink(layout, body("linking"));
		fs.symlinkSync(target, linkPath);
		writeOperatorLink(layout, body("linked"));
		return `linked ${linkPath} -> ${target}`;
	}
	if (receipt.binDir !== binDir) {
		refuse(
			"operator-link-other-bin-dir",
			`the operator link already lives in ${receipt.binDir}; withdraw it before asking for ${binDir}`,
		);
	}
	if (receipt.phase === "unlinking")
		refuse("operator-link-unlinking", "a withdraw is half done; run herdr-plugin-withdraw-operator to finish it");
	if (link === "foreign") refuse("operator-link-foreign", `${linkPath} is no longer the link the receipt names`);
	if (receipt.phase === "linked") {
		if (link === "absent")
			refuse("operator-link-drift", `the receipt says ${linkPath} is linked but it is gone; withdraw, then ask again`);
		return `already linked ${linkPath} -> ${target}`;
	}
	// `linking`: a run stopped after recording its intent. Our exact link is published as linked
	// without being made again; an absent one is made now.
	if (link === "absent") fs.symlinkSync(target, linkPath);
	writeOperatorLink(layout, body("linked"));
	return `linked ${linkPath} -> ${target} (resumed)`;
}

/**
 * Before deactivate's first write: the receipt (or null) and every judgement its removal needs.
 * No self admission here — deactivate's own tail must stay resumable after the runtime is gone.
 */
export function preflightOperatorLink(env, ledger, roots, activeDir) {
	const receipt = readCertifiedOperatorLink(resolveOperatorLinkLayout(env), activeDir);
	if (receipt === null) return null;
	certifyReceiptBinding(receipt, ledger, roots, activeDir);
	assessForRemoval(receipt);
	return receipt;
}

/** `ours` or `absent` (B gone counts as absent); a present B that drifted, or a foreign link, refuses. */
function assessForRemoval(receipt) {
	const bin = assessBinDir(receipt.binDir);
	if (bin === "alias")
		refuse(
			"operator-link-bin-dir-drifted",
			`${receipt.binDir} is no longer a physical directory that is its own realpath`,
		);
	const link = bin === "gone" ? "absent" : assessLink(receipt.linkPath, receipt.target);
	if (link === "foreign")
		refuse("operator-link-foreign", `${receipt.linkPath} is not the link the receipt names; nothing was removed`);
	return link;
}

/** Remove exactly the receipt's link, then the receipt. Shared by withdraw and deactivate. */
export function removeOperatorLink(env, receipt) {
	const layout = resolveOperatorLinkLayout(env);
	assessForRemoval(receipt);
	writeOperatorLink(layout, { ...receipt, phase: "unlinking" });
	if (assessForRemoval(receipt) === "ours") fs.unlinkSync(receipt.linkPath);
	fs.rmSync(layout.receiptPath, { force: true });
}

/** The opt-out. The ledger floor stays where it is. */
export function withdraw(env, argv) {
	if (argv.length !== 0) usage(`withdraw takes no arguments, got ${JSON.stringify(argv)}`);
	const runtime = resolveRuntimeLayout(env);
	admitSelf(runtime, "withdraw");
	const receipt = readCertifiedOperatorLink(resolveOperatorLinkLayout(env), runtime.activeDir);
	if (receipt === null) return "no operator link";
	const ledger = readCertifiedLedger(resolveActivationLayout(env));
	certifyReceiptBinding(receipt, ledger, resolveComponentRoots(env), runtime.activeDir);
	certifyPhaseForInverse(ledger);
	removeOperatorLink(env, receipt);
	return `withdrew ${receipt.linkPath}`;
}

/** Without a ledger: what stands at the receipt address, and — only from a certified receipt — its link. */
export function operatorLinkLeftovers(env) {
	const layout = resolveOperatorLinkLayout(env);
	const kind = fs.lstatSync(layout.receiptPath, { throwIfNoEntry: false });
	if (kind === undefined) return [];
	const found = [`operator-link-receipt (${layout.receiptPath})`];
	let receipt = null;
	try {
		receipt = readCertifiedOperatorLink(layout, resolveRuntimeLayout(env).activeDir);
	} catch {
		// A damaged receipt names only its own fixed address; no link address is trusted from it.
		receipt = null;
	}
	if (receipt !== null && fs.lstatSync(receipt.linkPath, { throwIfNoEntry: false }) !== undefined) {
		found.push(`operator-link (${receipt.linkPath})`);
	}
	return found;
}

function sameFile(a, b) {
	try {
		return fs.realpathSync(a) === fs.realpathSync(b);
	} catch {
		return false;
	}
}

if (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
	const [verb, ...rest] = process.argv.slice(2);
	try {
		let outcome;
		if (verb === "expose") outcome = expose(process.env, rest, { cwd: process.cwd() });
		else if (verb === "withdraw") outcome = withdraw(process.env, rest);
		else usage(`unknown verb ${JSON.stringify(verb)}`);
		process.stdout.write(`[herdr-operator-link] ${outcome}\n`);
		process.exit(0);
	} catch (err) {
		process.stderr.write(`[herdr-operator-link] ${err.code ?? "operator-link-failed"}: ${err.detail ?? err.message}\n`);
		process.exit(err.code === "operator-link-usage" ? 2 : 1);
	}
}
