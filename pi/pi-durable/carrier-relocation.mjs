// The pi-durable carrier's ONE relocation grammar (#130), shared by the maintainer emitter
// (scripts/emit-pi-durable-carrier.ts) and the runtime resolver (./carrier-resolver.mjs), so the
// rewrite the emitter performs and the resolution the runtime accepts cannot drift apart.
//
// The durable app is source-only upstream: published `@earendil-works/pi-coding-agent` ships no
// `dist/experimental`, and its exports map exposes no deep `dist/` path. The carrier is the pinned
// upstream app files, type-stripped, with exactly two rewrites:
//
//   "./<sibling>.ts"   → "./<sibling>.js"                 a carrier file importing another carrier file
//   "../../<path>.ts"  → entwurf-pi-dist:<path>.js        the app importing a pi-coding-agent internal
//
// Every other specifier — `@earendil-works/*`, `proper-lockfile`, `node:*` — is left untouched and
// resolves by Node's own rules from where the carrier is installed. The reserved scheme is chosen so
// that a carrier loaded WITHOUT the resolver fails by name (Node refuses an unknown URL scheme) rather
// than quietly resolving `../../` inside this package. The resolver accepts the scheme only from a
// declared carrier file and only for a declared target, and maps it to that file under the PHYSICAL
// root of the pi-coding-agent the carrier itself resolves — never through the exports map.
//
// Plain JS on purpose: the resolver is preloaded with `node --import` from an installed package,
// where Node does not strip types, and it must not depend on the compiled bridge closure.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CARRIER_SCHEME = "entwurf-pi-dist:";
export const CODING_AGENT = "@earendil-works/pi-coding-agent";

/** A refusal with a stable name first, as the bootstrap's. */
function refuse(reason, detail) {
	return Object.assign(new Error(`${reason}: ${detail}`), { reason });
}

/** A static import, export-from or side-effect import statement as upstream writes them: double quotes,
 * the statement ending its line. A multi-line `import {` … `} from "x";` matches from its `import`. */
const STATEMENT = /^(\s*(?:import|export|\})[^;]*?\bfrom\s*")([^"]+)(";[ \t]*)$|^(\s*import\s*")([^"]+)(";[ \t]*)$/gm;
/** Every place a module specifier can begin — the statements above, and anything they would miss. */
const ANY_SPECIFIER = /\b(?:from|import)\s*["'(]/g;

/**
 * Rewrite one type-stripped carrier source. `siblings` are the carrier file names (`runtime.js` …),
 * `targets` the declared pi-coding-agent dist paths (`core/model-runtime.js` …). Throws by name on a
 * relative specifier outside those two rules, a dynamic import, or a specifier the statement grammar
 * did not recognize. Returns the rewritten code and the targets it used.
 *
 * @param {string} file
 * @param {string} code
 * @param {{ siblings: readonly string[], targets: readonly string[] }} declared
 * @returns {{ code: string, used: string[] }}
 */
export function relocateCarrierSource(file, code, { siblings, targets }) {
	const used = new Set();
	let statements = 0;
	const rewrite = (spec) => {
		if (spec.startsWith("./")) {
			const name = `${spec.slice(2, -3)}.js`;
			if (!spec.endsWith(".ts") || !siblings.includes(name)) {
				throw refuse("carrier-relocation-unknown-sibling", `${file} imports ${spec}`);
			}
			return `./${name}`;
		}
		if (spec.startsWith("../../")) {
			const target = `${spec.slice(6, -3)}.js`;
			if (!spec.endsWith(".ts") || !targets.includes(target)) {
				throw refuse("carrier-relocation-unknown-target", `${file} imports ${spec}`);
			}
			used.add(target);
			return `${CARRIER_SCHEME}${target}`;
		}
		if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith(CARRIER_SCHEME)) {
			throw refuse("carrier-relocation-unknown-relative", `${file} imports ${spec}`);
		}
		return spec;
	};
	const out = code.replace(STATEMENT, (_all, headA, specA, tailA, headB, specB, tailB) => {
		statements++;
		return headA !== undefined ? `${headA}${rewrite(specA)}${tailA}` : `${headB}${rewrite(specB)}${tailB}`;
	});
	const begun = (code.match(ANY_SPECIFIER) ?? []).length;
	if (begun !== statements) {
		throw refuse(
			"carrier-relocation-unrecognized-import",
			`${file}: ${begun} specifier openings, ${statements} recognized statements (a dynamic import, a single-quoted or mid-line import)`,
		);
	}
	return { code: out, used: [...used].sort() };
}

/**
 * The carrier section of the packaged pin, validated. A malformed pin throws (crash, don't warn).
 *
 * @param {URL | string} pinPath
 * @returns {{ files: string[], targets: string[] }}
 */
export function readCarrierDeclaration(pinPath) {
	const pin = JSON.parse(readFileSync(pinPath, "utf8"));
	const carrier = pin?.carrier;
	const names = Array.isArray(carrier?.files) ? carrier.files.map((f) => f?.name) : undefined;
	const targets = carrier?.distTargets;
	const plain = (s) => typeof s === "string" && /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.js$/.test(s);
	if (!names?.every(plain) || names.length === 0 || names.some((n) => n.includes("/"))) {
		throw refuse("pi-durable-carrier-pin-malformed", "carrier.files must name plain carrier .js files");
	}
	if (!Array.isArray(targets) || targets.length === 0 || !targets.every(plain)) {
		throw refuse("pi-durable-carrier-pin-malformed", "carrier.distTargets must list relative dist .js paths");
	}
	return { files: names, targets };
}

/**
 * The PHYSICAL `dist/` directory of the pi-coding-agent the carrier resolves, from the URL its root
 * export resolved to (`<root>/dist/index.js`). Refuses by name when that is not the package root.
 *
 * @param {string} rootExportUrl
 */
export function codingAgentDistFrom(rootExportUrl) {
	const entry = rootExportUrl.startsWith("file:") ? fileURLToPath(rootExportUrl) : "";
	const dist = path.dirname(entry);
	const root = path.dirname(dist);
	const manifest = path.join(root, "package.json");
	if (path.basename(entry) !== "index.js" || path.basename(dist) !== "dist" || !existsSync(manifest)) {
		throw refuse(
			"pi-durable-carrier-host-root",
			`${CODING_AGENT} resolved to ${rootExportUrl}, not <root>/dist/index.js`,
		);
	}
	const name = JSON.parse(readFileSync(manifest, "utf8")).name;
	if (name !== CODING_AGENT) {
		throw refuse("pi-durable-carrier-host-root", `${manifest} names ${JSON.stringify(name)}, not ${CODING_AGENT}`);
	}
	return dist;
}

/**
 * Resolve one reserved specifier. Only a declared carrier file may ask, only for a declared target,
 * and the target file must exist. Returns the file URL; everything else throws by name.
 *
 * @param {string} specifier  begins with CARRIER_SCHEME
 * @param {string | undefined} parentURL
 * @param {{ carrierDirUrl: string, files: readonly string[], targets: readonly string[], dist: () => string }} declared
 */
export function resolveCarrierSpecifier(specifier, parentURL, { carrierDirUrl, files, targets, dist }) {
	const parent =
		typeof parentURL === "string" && parentURL.startsWith(carrierDirUrl) ? parentURL.slice(carrierDirUrl.length) : "";
	if (!files.includes(parent)) {
		throw refuse(
			"pi-durable-carrier-specifier-origin",
			`${specifier} asked from ${parentURL ?? "no parent"}, not a carrier file`,
		);
	}
	const target = specifier.slice(CARRIER_SCHEME.length);
	if (!targets.includes(target)) {
		throw refuse("pi-durable-carrier-specifier-unknown", `${specifier} (from ${parent}) is not a declared target`);
	}
	const file = path.join(dist(), target);
	if (!existsSync(file)) {
		throw refuse("pi-durable-carrier-target-missing", `${specifier} → ${file} does not exist`);
	}
	return pathToFileURL(file).href;
}
