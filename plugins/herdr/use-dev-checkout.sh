#!/usr/bin/env bash
# Source-only developer return path. Compose the existing owners; never edit their
# settings/ledger ourselves, fetch an Entwurf artifact, kill a session, or fall back.
# Deliberately limited to Pi + Claude Code + a local Herdr plugin link.
set -Eeuo pipefail

ROOT=$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
MODE=${1:---check}
case "$MODE" in
	--check|--apply) [ "$#" -le 1 ] || { echo 'usage: use-dev-checkout.sh [--check|--apply]' >&2; exit 2; } ;;
	--help|-h) echo 'usage: use-dev-checkout.sh [--check|--apply]'; exit 0 ;;
	*) echo 'usage: use-dev-checkout.sh [--check|--apply]' >&2; exit 2 ;;
esac
stage=preflight
[ "$(uname -s)" = Linux ] || { echo '[use-dev-checkout] Linux-only host procedure; other hosts are not certified.' >&2; exit 1; }
trap 'rc=$?; printf "[use-dev-checkout] STOP at %s (exit %s); no automatic rollback, kill or retry.\n" "$stage" "$rc" >&2; exit "$rc"' ERR
for bin in node python3 pnpm pi claude herdr ps; do
	command -v "$bin" >/dev/null || { echo "[use-dev-checkout] missing prerequisite: $bin" >&2; exit 1; }
done
[ -d "$ROOT/.git" ] && [ -d "$ROOT/node_modules" ] && [ -f "$ROOT/pnpm-lock.yaml" ] || {
	echo '[use-dev-checkout] requires a prepared source checkout; run pnpm install --frozen-lockfile there first.' >&2
	exit 1
}

# Use the shipped ledger reader and root/phase policy, not a second JSON parser.
OWNER=$(node --input-type=module - "$ROOT" <<'JS'
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const a = await import(pathToFileURL(path.join(root, 'scripts/herdr-activation.mjs')));
const r = await import(pathToFileURL(path.join(root, 'scripts/herdr-runtime.mjs')));
const ledger = a.readCertifiedLedger(a.resolveActivationLayout(process.env));
if (ledger !== null) {
	const layout = r.resolveRuntimeLayout(process.env);
	a.certifyRootsAgainstLedger(ledger, a.resolveComponentRoots(process.env), layout.activeDir);
	a.certifyPhaseForInverse(ledger);
	console.log(path.join(layout.activeDir, 'node_modules', r.readCheckoutPackageSpec(root).name));
}
JS
)

quiescent() {
	[ -n "$OWNER" ] || return 0
	# One read-only observation of argv paths, not a liveness oracle or a watcher.
	# Never delete the old runtime under processes that explicitly name its files.
	# This cannot observe every in-process loaded extension; manual quiescence is required.
	python3 - "$OWNER" <<'PY'
import os, subprocess, sys
root = sys.argv[1] + "/"
rows = subprocess.check_output(["ps", "-eo", "pid=,args="], text=True, timeout=5)
blocked = []
for row in rows.splitlines():
	parts = row.strip().split(None, 1)
	if len(parts) == 2 and parts[0] != str(os.getpid()) and root in parts[1]:
		blocked.append(row.strip())
if blocked:
	print("[use-dev-checkout] old-runtime-in-use — wiring/runtime unchanged. Close the listed sessions yourself, then rerun:", file=sys.stderr)
	print("\n".join(blocked), file=sys.stderr)
	sys.exit(3)
PY
}
quiescent
printf '[use-dev-checkout] checkout: %s\n' "$ROOT"
printf '[use-dev-checkout] old owner: %s\n' "${OWNER:-none (the existing inverse will check for unattributed leftovers)}"
# Meta records are preserved. A bad generation/access verdict blocks the switch;
# this script never fresh-cuts or prescribes a repair on its own.
node --experimental-strip-types "$ROOT/scripts/meta-bridge-store-doctor.ts"
if [ "$MODE" = --check ]; then
	echo '[use-dev-checkout] plan: build/check bridge -> owned deactivate -> checkout Pi/Claude wiring -> Herdr local link -> verification'
	echo '[use-dev-checkout] check only; no build, installation or settings writes. Apply with --apply.'
	echo '[use-dev-checkout] limited readiness: this does not certify every installer version floor, settings shape or destination ownership. A writer can still refuse after deactivation; no automatic rollback or retry.'
	exit 0
fi

stage=prepare-checkout
(cd "$ROOT" && pnpm run build-bridge)
"$ROOT/run.sh" check-bridge
# Confirm the actual source provider can load before removing the old owner.
SOURCE_MODELS=$(pi --no-extensions -e "$ROOT/pi-extensions/acp-provider.ts" --list-models entwurf)
printf '%s\n' "$SOURCE_MODELS"
SOURCE_IDS=$(printf '%s\n' "$SOURCE_MODELS" | awk '$1 == "entwurf" {print $2}')
[ -n "$SOURCE_IDS" ] || { echo '[use-dev-checkout] source provider registered no Entwurf models; old wiring retained.' >&2; exit 1; }
quiescent

stage=owned-deactivate
if [ -n "$OWNER" ]; then
	"$OWNER/run.sh" herdr-plugin-deactivate
else
	# Idempotent only on a clean plugin state; the existing inverse rejects any
	# unattributed journal/runtime/cache. No new deletion authority here.
	"$ROOT/run.sh" herdr-plugin-deactivate
fi

stage=checkout-wiring
bash "$ROOT/scripts/dev-bin.sh" expose entwurf
bash "$ROOT/scripts/dev-bin.sh" expose entwurf-bridge
"$ROOT/run.sh" install "$ROOT"
"$ROOT/run.sh" install-meta-bridge
stage=herdr-local-link
# Herdr's native link replaces the registry entry but runs no [[build]]; do not
# use plugin install here (that would reacquire the production npm runtime).
herdr plugin link "$ROOT/plugins/herdr" --enabled

stage=verify
"$ROOT/run.sh" doctor-pi-package
"$ROOT/run.sh" doctor-pi-provider
bash "$ROOT/scripts/dev-bin.sh" verify entwurf
bash "$ROOT/scripts/dev-bin.sh" verify entwurf-bridge
"$ROOT/run.sh" check-bridge
herdr plugin list --plugin junghan0611.entwurf --json | python3 -c '
import json, pathlib, sys
rows = json.load(sys.stdin)["result"]["plugins"]
expected = pathlib.Path(sys.argv[1]).resolve()
if len(rows) != 1 or rows[0]["source"]["kind"] != "local" or not rows[0]["enabled"] or pathlib.Path(rows[0]["plugin_root"]).resolve() != expected:
	raise SystemExit("Herdr plugin is not the enabled local checkout link")
print("[use-dev-checkout] Herdr local checkout link verified")
' "$ROOT/plugins/herdr"
ACTUAL_MODELS=$(pi --list-models entwurf)
printf '%s\n' "$ACTUAL_MODELS"
ACTUAL_IDS=$(printf '%s\n' "$ACTUAL_MODELS" | awk '$1 == "entwurf" {print $2}')
[ "$ACTUAL_IDS" = "$SOURCE_IDS" ] || { echo '[use-dev-checkout] actual Pi model IDs differ from the explicit checkout provider; not accepted.' >&2; exit 1; }
echo '[use-dev-checkout] done: development wiring uses this checkout. Start new Pi/Claude sessions; registration is not vendor-turn/release acceptance.'
