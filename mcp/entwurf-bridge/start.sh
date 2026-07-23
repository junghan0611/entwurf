#!/usr/bin/env bash
# entwurf-bridge MCP server launcher (dual-mode, chosen by LOCATION).
#
# PUBLISHED / INSTALLED (path is under node_modules): runs the prebuilt JS at
# dist/mcp/entwurf-bridge/src/index.js with plain `node`. This path exists
# because Node's --experimental-strip-types REFUSES `.ts` under node_modules
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so the 0.12.0 strip-types
# launcher broke the moment the package was npm-installed. `prepack`
# (pnpm run build-bridge → rm -rf dist && tsc -p tsconfig.build.json) emits a
# clean dist/ into the tarball; the package `files` allowlist ("mcp/") carries it.
#
# DEV CLONE (path is NOT under node_modules): runs src/index.ts via
# --experimental-strip-types. The clone lives outside node_modules so strip-types
# is allowed, edits are picked up with no build step, and a leftover dist/ (e.g.
# emitted by `prepack` during a `pnpm check` pack gate) can never silently shadow
# the source. Node >= 24 (engines.node in ../../package.json is the SSOT;
# check-node-floor-coherence binds this comment to it).
#
# Env file loading is strictly opt-in — the launcher never reads any dotfile
# unless ENTWURF_BRIDGE_ENV_FILE points at one. Rationale: entwurf is a
# public package; baking in personal conventions (~/.env.local, etc.) would
# bleed the original author's dotfile habits into every consumer's shell.
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *) SOURCE="$DIR/$TARGET" ;;
  esac
done
HERE="$(cd -P "$(dirname "$SOURCE")" && pwd)"

if [ -n "${ENTWURF_BRIDGE_ENV_FILE:-}" ] && [ -f "$ENTWURF_BRIDGE_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENTWURF_BRIDGE_ENV_FILE"
  set +a
fi

# rootDir is the repo root (the bridge graph spans mcp/ and pi-extensions/),
# so tsc mirrors the source tree under dist/ — hence the nested entry path.
DIST_ENTRY="$HERE/dist/mcp/entwurf-bridge/src/index.js"
SRC_ENTRY="$HERE/src/index.ts"

# Mode is decided by LOCATION, not by "does dist happen to exist". A dev clone
# lives outside node_modules and ALWAYS runs the TS source via strip-types, so an
# edit is picked up immediately and a stale dist (e.g. left behind by a prior
# `npm pack`/`prepack` during `pnpm check`) can never silently shadow the source.
# An installed package lives under node_modules, where Node refuses strip-types,
# so it MUST run the prebuilt dist. All chatter goes to stderr so it never
# confuses an MCP client reading JSON-RPC frames from stdout.
case "$HERE" in
  */node_modules/*)
    if [ ! -f "$DIST_ENTRY" ]; then
      echo "entwurf-bridge: installed under node_modules but the prebuilt dist is missing:" >&2
      echo "  $DIST_ENTRY" >&2
      echo "  The published tarball ships dist via prepack; reinstall @junghanacs/entwurf." >&2
      exit 1
    fi
    exec node "$DIST_ENTRY"
    ;;
esac

exec node --experimental-strip-types --disable-warning=ExperimentalWarning \
  "$SRC_ENTRY"
