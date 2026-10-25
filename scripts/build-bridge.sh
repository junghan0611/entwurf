#!/usr/bin/env bash
#
# Raw entwurf-bridge dist emit (the inner half of the `build-bridge` npm script).
# `rm -rf` the dist dir then tsc-emit into it. Serialization against concurrent
# packs/builds is NOT done here — it is the caller's job via scripts/with-dist-lock.sh
# (package.json wraps this: `with-dist-lock.sh build-bridge.sh`). Keeping the emit
# lock-free here is deliberate: the vulnerable window is the WHOLE `npm pack`
# (prepack build + npm's post-build dist read), not just this emit, so the lock has
# to wrap the pack, not this script — see with-dist-lock.sh for the full rationale.
set -euo pipefail

REPO_DIR=$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

rm -rf "$REPO_DIR/mcp/entwurf-bridge/dist"

# Prefer the repo-local tsc (present under both pnpm and npm layouts); fall back to
# a PATH tsc for a bare invocation outside the npm lifecycle.
TSC="$REPO_DIR/node_modules/.bin/tsc"
[ -x "$TSC" ] || TSC=tsc
"$TSC" -p "$REPO_DIR/mcp/entwurf-bridge/tsconfig.build.json"

# One authored product-guidance source (#154). The fixed module-relative reader resolves
# ../../ENTWURF.json from dist/pi-extensions/lib/, so its deterministic exact copy belongs at
# the DIST ROOT, not beside the capability registry. This is transport, never another source.
GUIDANCE_SOURCE="$REPO_DIR/ENTWURF.json"
if [ ! -f "$GUIDANCE_SOURCE" ] || [ -L "$GUIDANCE_SOURCE" ]; then
  echo "build-bridge: $GUIDANCE_SOURCE is missing or not a regular file" >&2
  exit 1
fi
cp "$GUIDANCE_SOURCE" "$REPO_DIR/mcp/entwurf-bridge/dist/ENTWURF.json"

# The capability registry must TRAVEL WITH the bundle.
#
# `metaCapabilitiesFilePath()` computes its path from the module's own location.
# The emit puts meta-session.js at `dist/pi-extensions/lib/` — three levels deeper
# than the source it was compiled from — so its repo branch (`../../pi/`) lands
# inside `dist/` and finds nothing. Its bundle branch (`../`) is the contract for
# exactly this case: the registry sits at the bundle root next to `lib/`, which is
# how the meta-bridge plugin already ships it (meta-bridge-install.sh copies it
# there; doctor-meta-bridge asserts it). The bridge bundle had no such copy step,
# so every entwurf_v2 send through the installed MCP server died ENOENT while the
# registry-free verbs (entwurf_self/entwurf_peers) stayed green and hid it.
#
# Gated by check-capability-bundle-reach, which re-asks EVERY shipped copy of the
# module from where it actually lives (the source-path gates cannot: a location-
# dependent function called from its own location always resolves).
cp "$REPO_DIR/pi/entwurf-capabilities.json" \
  "$REPO_DIR/mcp/entwurf-bridge/dist/pi-extensions/entwurf-capabilities.json"

# The Claude Code retire helper must TRAVEL WITH the bundle too (#147 G3).
#
# `ccRetireHelperPath()` resolves ONE fixed basename beside its own module, so the emitted
# dist/pi-extensions/lib/cc-retire-request.js finds the helper only if it sits next to it. The
# canonical bytes are pi-extensions/lib/cc-retire-pidfd.py; this is a byte copy, never an edit.
# A missing or non-regular source fails the build — there is no fallback location. Gated by
# check-capability-bundle-reach (the compiled adapter asks from where it lives, bytes compared).
CC_RETIRE_HELPER="$REPO_DIR/pi-extensions/lib/cc-retire-pidfd.py"
if [ ! -f "$CC_RETIRE_HELPER" ] || [ -L "$CC_RETIRE_HELPER" ]; then
  echo "build-bridge: $CC_RETIRE_HELPER is missing or not a regular file" >&2
  exit 1
fi
cp "$CC_RETIRE_HELPER" "$REPO_DIR/mcp/entwurf-bridge/dist/pi-extensions/lib/cc-retire-pidfd.py"
