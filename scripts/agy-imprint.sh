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
exec node --experimental-strip-types "$HERE/agy-imprint.ts"
