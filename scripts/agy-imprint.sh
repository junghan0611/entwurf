#!/usr/bin/env bash
# Stable bin wrapper for Antigravity PreInvocation birth imprint.
set -euo pipefail
SELF="${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
  RESOLVED="$(readlink -f "$SELF" 2>/dev/null || printf '%s' "$SELF")"
else
  RESOLVED="$SELF"
fi
HERE="$(cd "$(dirname "$RESOLVED")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# Node refuses --experimental-strip-types for raw .ts below node_modules. Dev
# clones keep the transparent source path; installed npm/pnpm bins must use the
# prepack-emitted JS closure, exactly like entwurf-bridge and meta-bridge hooks.
case "$ROOT" in
  */node_modules/*)
    DIST="$ROOT/mcp/entwurf-bridge/dist/scripts/agy-imprint.js"
    if [ ! -f "$DIST" ]; then
      echo "entwurf-agy-imprint: installed package is missing prebuilt $DIST" >&2
      exit 1
    fi
    exec node "$DIST"
    ;;
  *)
    exec node --experimental-strip-types "$HERE/agy-imprint.ts"
    ;;
esac
