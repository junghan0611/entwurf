/**
 * codex-socket-path — print the Codex app-server default control-socket path for THIS
 * environment, and nothing else.
 *
 * WHY A LEAF EXISTS FOR ONE LINE. `entwurf codex-app-server` is a bash launcher, and bash
 * cannot import `resolveCodexDefaultSocketPath`. Its first version re-derived the path
 * instead — `${CODEX_HOME:-$HOME/.codex}` plus a POSIX `[:space:]` trim — and a gate compared
 * the two spellings over four ASCII-normal inputs, which they agreed on.
 *
 * They did not agree everywhere. `[측정 2026-09-16]` with `CODEX_HOME=$'﻿'` the TS leaf
 * trims (JS `String.prototype.trim` strips U+FEFF) and falls back to `$HOME/.codex`, while the
 * bash trim keeps the byte and yields `<BOM>/app-server-control/app-server-control.sock`. Same
 * for `path.join`'s normalization of a trailing slash or a `..` segment. Every one of those is
 * a managed launch starting a server at an address delivery and preflight never look at — a
 * false success of exactly the kind this repo refuses.
 *
 * So the second spelling is gone rather than widened. There is ONE implementation of this
 * address, this leaf prints it, and the launcher asks. Matching a transcription against its
 * original can only ever test the inputs somebody thought of.
 *
 * Reads `process.env` directly: the resolver's contract is the ambient environment of whoever
 * is about to launch, and an argv seam here would be a way to redirect the address.
 */

import { resolveCodexDefaultSocketPath } from "../pi-extensions/lib/native-push/codex-ws-client.ts";

if (process.argv.length > 2) {
	console.error("usage: codex-socket-path   (no arguments; the environment is the input)");
	process.exit(2);
}

// No trailing newline: the caller substitutes this straight into an address.
process.stdout.write(resolveCodexDefaultSocketPath(process.env));
