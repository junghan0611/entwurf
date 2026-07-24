/**
 * control-socket-path — control-socket path grammar SSOT
 * (`<dir>/<gardenId>.sock`, and its inverse).
 *
 * Authored as `.js` for the exact reason `session-id.js` and `protocol.js` are
 * (see their headers): this leaf is imported from BOTH runtime paths —
 *   - tsc-emit path: `pi-extensions/entwurf-control.ts` under the root tsconfig
 *     (allowJs), which cannot enable `allowImportingTsExtensions` without losing
 *     the emit `check-models` relies on;
 *   - `node --experimental-strip-types` path: the MCP bridge and `scripts/` gates,
 *     which import libs with explicit `.ts` extensions.
 * `socket-discovery.ts` is a lib→lib VALUE importer (it pulls socket RPC + probe
 * IO), so it is excluded from the root program — which is precisely why
 * `entwurf-control.ts` could never import `controlSocketPath` and grew its own
 * copy of the grammar instead. A real `.js` leaf resolves identically in every
 * path, so the socket path grammar has ONE definition instead of one-per-importer.
 *
 * The grammar is a PAIR. Forward (`controlSocketPathIn`) and inverse
 * (`gardenIdFromSocketFilename`) must move together: a leaf owning only the join
 * leaves the dir-scanners re-implementing the parse.
 *
 * Directory SOURCE is deliberately NOT owned here. `defaultControlSocketDir`
 * takes `home` as an argument and never calls `os.homedir()` itself, so each
 * adapter keeps its own root policy: the pi side derives from HOME, the MCP
 * bridge honours `ENTWURF_DIR`. What is unified is the grammar, not the policy.
 *
 * Keep dependency-free except `node:path`.
 */

import * as path from "node:path";

/** Control-socket filename suffix. The stem is a bare garden id. */
export const CONTROL_SOCKET_SUFFIX = ".sock";

/**
 * Canonical control-socket directory for a given home root.
 * The caller supplies `home` — this leaf never reads the environment.
 *
 * @param {string} home
 * @returns {string}
 */
export function defaultControlSocketDir(home) {
	return path.join(home, ".pi", "entwurf-control");
}

/**
 * Forward grammar: `<dir>/<gardenId>.sock`.
 *
 * @param {string} dir
 * @param {string} gardenId
 * @returns {string}
 */
export function controlSocketPathIn(dir, gardenId) {
	return path.join(dir, `${gardenId}${CONTROL_SOCKET_SUFFIX}`);
}

/**
 * Inverse grammar: a socket filename back to its garden id, or `null` when the
 * name does not carry the suffix.
 *
 * The nullable return is load-bearing. Both dir-scanners used to guard with
 * `endsWith(SUFFIX)` before slicing; folding that guard in here makes the null
 * branch the caller's obligation, and `strict: true` forces each scanner to
 * handle it. Typed as a bare `string` this would silently reintroduce the
 * unguarded slice the leaf exists to remove.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function gardenIdFromSocketFilename(name) {
	if (!name.endsWith(CONTROL_SOCKET_SUFFIX)) return null;
	const gardenId = name.slice(0, -CONTROL_SOCKET_SUFFIX.length);
	return gardenId.length > 0 ? gardenId : null;
}
