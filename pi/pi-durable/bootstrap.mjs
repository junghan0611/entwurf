#!/usr/bin/env node
// Durable host bootstrap for Entwurf's pi-durable contact (#129). PACKAGED: this file ships in the
// package `files`, and every Entwurf module it imports is the COMPILED closure that ships beside it
// (`mcp/entwurf-bridge/dist/…`) — an installed package never imports checkout TypeScript. The bridge
// the contact spawns is derived from that same closure, never from argv. A checkout runs it the same
// way, after `pnpm run build-bridge`; `plugins/pi-durable/bootstrap.mjs` re-exports this file.
//
// The same shape as upstream `experimental/durable/main.ts` (parse, open, run the TUI, close),
// with these differences:
// - Entwurf's tools-only extension is handed to `openDurable`;
// - a NEW session is opened with an explicit model and an explicit width, never a default (below);
// - the citizen is born once `openDurable` returns, with the overlay's `submitToRoot` so its
//   doorbell can announce mail to the root conversation;
// - a launcher's first input, when given, is admitted to the root ONCE, after that birth;
// - the TUI is handed the native view with the garden id on every conversation label
//   (`withGardenIdentity`).
// Nothing of the native registry, controller or TUI is rebuilt here.
//
// The durable app itself is this package's CARRIER (./carrier/, the pinned upstream files emitted by
// the maintainer — upstream publishes no experimental app), and it runs under the carrier's resolver,
// which maps the app's pi-coding-agent internals to the published package the carrier resolves.
// `entwurf pi-durable` (run.sh) verifies the carrier and its SDK set (pi-durable-runtime.ts) and
// execs:
//
//   node --import <entwurf>/pi/pi-durable/carrier-resolver.mjs \
//        <entwurf>/pi/pi-durable/bootstrap.mjs \
//        --provider <provider> --model <model id> --width task-wide [--entwurf-bootstrap <json>]
//   ... bootstrap.mjs --continue
//
// Explicit means the native API, not a vendor argv: upstream's durable main takes only
// `--continue`, so `--provider`/`--model` reach pi's own `findInitialAgentModel` through the
// overlay's `model` option, for a new session only, and an unresolvable pair fails the open
// before any citizen is born (the native session directory may already exist by then). The model
// must be one registered catalog model of that provider, named by its canonical id or by
// `id:<level>` as pi's own parser reads a thinking level: a typo, a partial or case-variant match, a
// provider-prefixed id or an unregistered custom-id fallback is refused by the overlay as
// `explicit-model-not-exact`, before the birth and the first input.
// `--width task-wide` is the one width: no tool filter, so the model is offered exactly the tools
// the installed extensions register. It is a statement of what is OFFERED, not an approval or
// sandbox policy; the native app has no approval prompt, so a narrower width would be a sibling
// that can never reach its task's tools, and none is offered.
// `--entwurf-bootstrap` is the existing fixed `{v,task}` payload grammar (meta-bridge-omp.ts,
// read-only reuse): unknown keys — a target or a nonce included — are refused; the caller's
// address rides the process env only.
// `--continue` opens the newest session for this directory as upstream does (not a chosen
// record), so every flag that only a new session can honour is refused beside it by name.
//
// Without that resolver the carrier's first pi-coding-agent internal import fails by name (an
// unsupported entwurf-pi-dist: URL scheme), and that failure is the honest one.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeOmpBootstrapPayload } from "../../mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-omp.js";
import {
	closeAll,
	createPiDurableContact,
	failAfterCleanup,
	withGardenIdentity,
} from "../../mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-pi-durable.js";

const RUNTIME = "./carrier/runtime.js";
const TUI = "./carrier/tui.js";

/** The entwurf-bridge of THIS package closure: the one the contact spawns as its MCP hand. */
export const PACKAGED_BRIDGE_ENTRY = fileURLToPath(
	new URL("../../mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js", import.meta.url),
);

/** Flags that take a value. Anything else but `--continue`/`-c` is an unknown argument — a bridge
 * entry included: the launch argv cannot point the contact at another bridge. */
const VALUE_FLAGS = ["--provider", "--model", "--width", "--entwurf-bootstrap"];
/** Flags only a NEW session can honour. */
const FRESH_ONLY_FLAGS = ["--provider", "--model", "--width", "--entwurf-bootstrap"];

/** A refusal with a stable name first, so a launcher and an operator can tell the repairs apart. */
function refuse(reason, detail) {
	return Object.assign(new Error(`${reason}: ${detail}`), { reason });
}

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Open the durable app with the contact installed, then birth the citizen and arm its doorbell on
 * the root conversation, then admit the first input (when given) to the root once. On any failure
 * the contact is told why (waiting tools reject by name), everything opened is closed again, and a
 * cleanup failure is reported beside the cause instead of replacing it.
 *
 * `model` and `firstInput` apply to a new session only; with `continueSession` they are refused
 * before anything opens. `contact` carries extra `createPiDurableContact` options (explicit garden
 * roots; tests also pass a connector). `open` replaces the runtime's `openDurable` for tests.
 * `bridgeEntry` defaults to this package's own compiled bridge; only a programmatic caller (the
 * checkout-only gates, which drive a private bundle) passes another one — never the launch argv.
 *
 * @param {{
 *   bridgeEntry?: string,
 *   continueSession?: boolean,
 *   cwd?: string,
 *   model?: { provider: string, model: string },
 *   firstInput?: string,
 *   contact?: Record<string, unknown>,
 *   open?: (options: { cwd: string, continueSession: boolean, extensions: readonly object[], model?: { provider: string, model: string } }) => Promise<any>,
 * }} options
 * @returns {Promise<{ durable: any, contact: any, attachment: { gardenId: string } & Record<string, any>, firstInput?: any, close(): Promise<void> }>}
 *   (stated, because the compiled closure carries no declarations: a cleanup path that rethrows
 *   through `failAfterCleanup` never resolves)
 */
export async function openDurableCitizen({
	bridgeEntry = PACKAGED_BRIDGE_ENTRY,
	continueSession = false,
	cwd = process.cwd(),
	model,
	firstInput,
	contact: contactOptions = {},
	open,
}) {
	if (continueSession && (model !== undefined || firstInput !== undefined)) {
		throw refuse(
			"fresh-only-argument-with-continue",
			"an explicit model and a first input apply only to a new session; a continued session is reopened as it was saved",
		);
	}
	if (model !== undefined && !(nonEmpty(model.provider) && nonEmpty(model.model))) {
		throw refuse("explicit-model-incomplete", "an explicit model names both its provider and its model id");
	}
	if (firstInput !== undefined && !nonEmpty(firstInput)) {
		throw refuse("first-input-empty", "a first input is a non-empty task");
	}
	const openDurable = open ?? (await import(RUNTIME)).openDurable;
	const contact = createPiDurableContact({ ...contactOptions, bridgeEntry });
	let durable;
	try {
		durable = await openDurable({
			cwd,
			continueSession,
			extensions: [contact.extension],
			...(model === undefined ? {} : { model }),
		});
	} catch (error) {
		contact.fail(error);
		throw error;
	}
	let attachment;
	try {
		attachment = await contact.attach(durable.view.current().session, { submitToRoot: durable.submitToRoot });
	} catch (error) {
		return failAfterCleanup(
			error,
			() => contact.close(),
			() => durable.close(),
		);
	}
	// After the birth, so a callback the input asks for finds a citizen. Admission, not the answer:
	// the turn runs under the TUI. A refused admission is the cause, never a notice.
	let first;
	if (firstInput !== undefined) {
		try {
			first = await durable.submitToRoot({
				type: "input",
				content: firstInput,
				requestId: `entwurf-first-input:${attachment.gardenId}`,
			});
		} catch (error) {
			return failAfterCleanup(
				error,
				() => contact.close(),
				() => durable.close(),
			);
		}
	}
	let closing;
	return {
		durable,
		contact,
		attachment,
		...(first === undefined ? {} : { firstInput: first }),
		close() {
			closing ??= closeAll(
				() => contact.close(),
				() => durable.close(),
			);
			return closing;
		},
	};
}

function parseArgs(argv) {
	let continueSession = false;
	const values = new Map();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--continue" || arg === "-c") {
			continueSession = true;
			continue;
		}
		if (!VALUE_FLAGS.includes(arg)) throw new Error(`Unknown argument: ${arg}`);
		if (values.has(arg)) throw refuse("argument-repeated", `${arg} is given more than once`);
		const value = argv[++i];
		if (value === undefined || value === "" || value.startsWith("-")) {
			throw refuse("argument-value-missing", `${arg} needs a value`);
		}
		values.set(arg, value);
	}
	const fresh = FRESH_ONLY_FLAGS.filter((flag) => values.has(flag));
	if (continueSession && fresh.length > 0) {
		throw refuse(
			"fresh-only-argument-with-continue",
			`${fresh.join(", ")} apply only to a new session; --continue reopens this directory's newest session as it was saved`,
		);
	}
	if (continueSession) return { continueSession };
	const provider = values.get("--provider");
	if (provider === undefined) {
		throw refuse(
			"explicit-provider-required",
			"a new session names its provider with --provider; a model is never resolved to a provider by inference",
		);
	}
	const model = values.get("--model");
	if (model === undefined) throw refuse("explicit-model-required", "a new session names its model with --model");
	const width = values.get("--width");
	if (width !== "task-wide") {
		throw refuse(
			width === undefined ? "width-required" : "width-unsupported",
			"a new session is opened with --width task-wide: every tool the installed extensions register is offered",
		);
	}
	const payload = values.get("--entwurf-bootstrap");
	let firstInput;
	if (payload !== undefined) {
		const decoded = decodeOmpBootstrapPayload(payload);
		if (!decoded.ok) throw refuse("bootstrap-payload-rejected", decoded.reason);
		firstInput = decoded.value.task;
	}
	return {
		continueSession,
		model: { provider, model },
		...(firstInput === undefined ? {} : { firstInput }),
	};
}

/**
 * Parse, load the TUI, open, run, close. `loadTui`, `open` and `contact` are test seams.
 *
 * @param {readonly string[]} argv
 * @param {{
 *   loadTui?: () => Promise<{ runDurableTui: (...args: any[]) => Promise<void> }>,
 *   open?: (options: any) => Promise<any>,
 *   contact?: Record<string, unknown>,
 * }} [seams]
 */
export async function main(argv, { loadTui = () => import(TUI), open, contact } = {}) {
	// Every refusal is decided here, before the TUI loads and before anything opens.
	const args = parseArgs(argv);
	// Loaded before anything opens, as upstream main.ts imports it statically: a TUI that cannot
	// load opens no session, mints no citizen and leaves nothing to clean up.
	const { runDurableTui } = await loadTui();
	const citizen = await openDurableCitizen({ ...args, open, contact });
	try {
		await runDurableTui(
			withGardenIdentity(citizen.durable.view, citizen.attachment.gardenId),
			citizen.durable.controller,
			citizen.durable.settings,
		);
	} catch (error) {
		return failAfterCleanup(error, () => citizen.close());
	}
	await citizen.close();
}

// Run only when THIS file is the process entry (`node --import <resolver> bootstrap.mjs …`), decided
// by an argv realpath as in meta-bridge-hook-codex.ts — not by the `main` flag on import.meta, which
// Node gained in 24.2.0, above the package's major-24 floor. Importing this file starts nothing.
const invokedDirectly = (() => {
	const entry = process.argv[1];
	if (typeof entry !== "string" || entry.length === 0) return false;
	try {
		return realpathSync(entry) === realpathSync(import.meta.filename);
	} catch {
		// Bounded environment probe: an entry that cannot be resolved is not this file.
		return false;
	}
})();
if (invokedDirectly) await main(process.argv.slice(2));
