#!/usr/bin/env bash
# fake-copilot-vendor.sh — ONE factory for the stateful fake Copilot CLI the
# aggregate-setup gates drive (#86 C3b). Two consumers share it so their fakes
# cannot drift: smoke-setup-verdict's copilot-present cell and check-pack-install's
# installed copilot-present consumer row. The answer shapes are the MEASURED CLI's
# (copilot 1.0.80, 2026-08-27) — the same shapes check-copilot-birth-hook.ts bakes
# into its own TS fake: `plugin list` prints qualified ids with a `(vX)` suffix
# followed by the vendor's `(enabled)` state token and an indented `from <path>`
# continuation line (measured on copilot 1.0.81, 2026-08-31),
# `plugin marketplace list` prints `<name> (Local: <abs path>)`, and `--force`
# anywhere is refused loudly (the real `marketplace remove --force` uninstalls that
# marketplace's plugins as a side effect; no entwurf surface may reach for it).
#
# This factory models the SUCCESS host only. A failing-list vendor is two lines and
# stays inline in the cell that needs it (check-setup-qualification Cell D).
#
# usage: bash scripts/fake-copilot-vendor.sh <dir> <plugin_json>
#
# EXECUTE this file; do not source it. `_check_pack_install_impl` holds a
# `trap … RETURN` around its temp roots, and bash fires a RETURN trap when a
# `.`/`source` finishes too — sourcing this factory there deleted the whole
# npm sandbox mid-gate (measured 2026-08-27). A child process cannot.
#
#   Writes <dir>/copilot (executable) plus its state files into <dir>:
#     installed.txt      qualified ids `plugin install` appended
#     marketplaces.txt   `<name>\t<path>` rows `plugin marketplace add` appended
#     calls.log          every argv line the fake answered
#   The advertised version is read from <plugin_json> (the same file the real
#   installer reads), so the post-install exact-row check joins on one SSOT.
set -euo pipefail

make_fake_copilot() { # $1 = dir, $2 = plugin.json path
	local dir="$1" plugin_json="$2" ver
	ver="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$plugin_json")" || return 1
	mkdir -p "$dir"
	: > "$dir/installed.txt"
	: > "$dir/marketplaces.txt"
	: > "$dir/calls.log"
	cat > "$dir/copilot" <<FAKE
#!/usr/bin/env bash
STATE="$dir/installed.txt"
MKTS="$dir/marketplaces.txt"
LOG="$dir/calls.log"
VER="$ver"
echo "\$*" >> "\$LOG"
for a in "\$@"; do [ "\$a" = "--force" ] && { echo "fake copilot: --force is forbidden here" >&2; exit 99; }; done
case "\$1 \$2 \$3" in
  "plugin marketplace list")
    echo "Included with GitHub Copilot:"
    while IFS=\$'\t' read -r n p; do [ -n "\$n" ] && echo "  • \$n (Local: \$p)"; done < "\$MKTS"
    exit 0 ;;
  "plugin marketplace add") printf "%s\t%s\n" "meta-bridge-copilot-local" "\$4" >> "\$MKTS"; exit 0 ;;
  "plugin marketplace remove") awk -F"\t" -v n="\$4" '\$1 != n' "\$MKTS" > "\$MKTS.tmp"; mv "\$MKTS.tmp" "\$MKTS"; exit 0 ;;
esac
case "\$1 \$2" in
  "plugin list") echo "Live Plugins (loaded from a local marketplace directory, never copied):"; while read -r id; do [ -n "\$id" ] && { echo "  • \$id (v\$VER) (enabled)"; echo "      from $dir"; }; done < "\$STATE"; exit 0 ;;
  "plugin uninstall") grep -Fvx "\$3" "\$STATE" > "\$STATE.tmp"; mv "\$STATE.tmp" "\$STATE"; exit 0 ;;
  "plugin install") echo "\$3" >> "\$STATE"; exit 0 ;;
esac
exit 0
FAKE
	chmod +x "$dir/copilot"
}

if [ "$#" -ne 2 ]; then
	echo "usage: fake-copilot-vendor.sh <dir> <plugin_json>" >&2
	exit 2
fi
make_fake_copilot "$1" "$2"
