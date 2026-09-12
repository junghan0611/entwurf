#!/usr/bin/env bash
# smoke-codex-birth — hermetic install/doctor/inverse contract for the Codex
# birth unit. No Codex process, no model turn, no host path: HOME, XDG_DATA_HOME and
# CODEX_HOME are all sandboxed, so every byte this gate judges was written inside the fixture.
#
# The five things it exists to prove, none of which a reading of the script can establish:
#   1. the published declaration is the EXACT trust identity (matcher-less, type/command/
#      timeout, quoted fixed launcher path) — because that identity is what an operator
#      approves once, and any drift in it costs a second approval;
#   2. config.toml is neither read nor written, so the vendor's [hooks.state] and entwurf's
#      own two user atoms survive install AND inverse byte-for-byte;
#   3. a foreign or edited hooks.json is a ZERO-WRITE refusal, never an adoption — this unit
#      owns the file whole, so adopting one would delete somebody else's hooks;
#   4. the inverse removes exactly what the state vouches for, and REFUSES a drifted path
#      instead of deleting an edit nobody can read back;
#   5. the doctor never claims the vendor's trust decision as its own green.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL="$REPO_DIR/scripts/codex-birth-install.sh"
UNINSTALL="$REPO_DIR/scripts/codex-birth-uninstall.sh"
DOCTOR="$REPO_DIR/scripts/codex-birth-doctor.sh"
pass=0
ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
die() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
safe_umask_fail() { die "[QK:CODEX-BIRTH-INSTALL-SAFE-UMASK] $1"; }
want() { eval "$2" && ok "$1" || die "$1"; }
refuses() { # <label> <expected-substring-on-stderr> <cmd...>
  local label="$1" needle="$2"; shift 2
  local err rc=0
  err="$("$@" 2>&1 >/dev/null)" || rc=$?
  [ "$rc" -ne 0 ] && printf '%s' "$err" | grep -q "$needle" || die "$label (rc=$rc, stderr: $err)"
  ok "$label"
}

REPO_BEFORE="$(cd "$REPO_DIR" && git status --porcelain)"
SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT
export HOME="$SB/home"
export XDG_DATA_HOME="$SB/xdg"
export CODEX_HOME="$HOME/.codex"
export PYTHONDONTWRITEBYTECODE=1
mkdir -p "$CODEX_HOME" "$XDG_DATA_HOME"

HOOKS="$CODEX_HOME/hooks.json"
CFG="$CODEX_HOME/config.toml"
UNIT_ROOT="$XDG_DATA_HOME/entwurf/codex-birth"
HELPER="$UNIT_ROOT/helper"
LAUNCHER="$HELPER/codex-birth-launch.sh"
STATE="$UNIT_ROOT/install-state.json"

seed_config() { # an operator config that ALREADY carries entwurf's two user atoms and the
  # vendor's own hook-trust state — the exact shape this unit must never touch.
  cat > "$CFG" <<'EOF'
model = "gpt-5.6-luna"
approval_policy = "never"
[tui]
status_line = ["thread-title", "model-with-reasoning", "current-dir"]
theme = "zenburn"
[hooks.state."/sandbox/.codex/hooks.json:session_start:0:0"]
trusted_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
[mcp_servers.entwurf-bridge]
command = "entwurf-bridge"
EOF
}
seed_config
cp "$CFG" "$SB/config.before.toml"

###############################################################################
# install — the declaration, the closure, and the state
###############################################################################
"$INSTALL" >"$SB/out" 2>&1 || die "install failed: $(cat "$SB/out")"
want "install reports success" "grep -q '^\[codex-birth-install\] installed$' '$SB/out'"
want "the declaration exists as a regular file" "[ -f '$HOOKS' ] && [ ! -L '$HOOKS' ]"
want "the launcher is published and executable" "[ -f '$LAUNCHER' ] && [ -x '$LAUNCHER' ]"
want "the closure is published whole" "[ -f '$HELPER/meta-bridge-hook-codex.ts' ] && [ -f '$HELPER/lib/meta-session.ts' ] && [ -f '$HELPER/lib/native-push/codex-ws-client.ts' ] && [ -f '$HELPER/lib/session-id.js' ] && [ -f '$HELPER/entwurf-capabilities.json' ]"
want "the state is a regular non-symlink file" "[ -f '$STATE' ] && [ ! -L '$STATE' ]"
want "the state is bound to the fixed paths and finished publishing" \
  "node -e 'const s=require(process.argv[1]); if(s.schema!==\"codex-birth-install-state/v1\")throw 0; if(s.status!==\"installed\")throw 0; if(s.hooksFile!==process.argv[2])throw 0; if(s.helperDir!==process.argv[3])throw 0;' '$STATE' '$HOOKS' '$HELPER'"
want "the state records a digest for every published byte" \
  "node -e 'const s=require(process.argv[1]); const hex=v=>/^[0-9a-f]{64}\$/.test(v); if(!hex(s.hooksSha256))throw 0; if(s.helperFiles.length!==6)throw 0; for(const f of s.helperFiles){if(!hex(f.sha256))throw 0;}' '$STATE'"

# The trust identity, asserted field by field. This is the cell that costs a second operator
# approval if it ever drifts, so it is checked literally rather than by shape.
want "the declaration is the EXACT trust identity (matcher-less, type/command/timeout, quoted fixed launcher)" \
  "node -e '
    const f=require(process.argv[1]);
    if(Object.keys(f).sort().join(\",\")!==\"description,hooks\")throw new Error(\"top level\");
    if(Object.keys(f.hooks).join(\",\")!==\"SessionStart\")throw new Error(\"events\");
    const g=f.hooks.SessionStart; if(g.length!==1)throw new Error(\"groups\");
    if(\"matcher\" in g[0])throw new Error(\"matcher present\");
    if(Object.keys(g[0]).join(\",\")!==\"hooks\")throw new Error(\"group keys\");
    if(g[0].hooks.length!==1)throw new Error(\"handlers\");
    const h=g[0].hooks[0];
    if(Object.keys(h).sort().join(\",\")!==\"command,timeout,type\")throw new Error(\"handler keys\");
    if(h.type!==\"command\"||h.timeout!==30)throw new Error(\"type/timeout\");
    if(h.command!==\"'\"'\"'\"+process.argv[2]+\"'\"'\"'\")throw new Error(\"command \"+h.command);
  ' '$HOOKS' '$LAUNCHER'"
want "the declaration carries no trust key of any kind" "! grep -qi 'trusted_hash\|hooks.state' '$HOOKS'"
want "the launcher bakes a resolved absolute node and execs the published payload" \
  "grep -qE '^NODE_BIN=\"/' '$LAUNCHER' && grep -q 'PAYLOAD=\"$HELPER/meta-bridge-hook-codex.ts\"' '$LAUNCHER' && grep -q '^exec \"\$NODE_BIN\" --experimental-strip-types' '$LAUNCHER'"

# config.toml — the file the vendor keeps [hooks.state] in, and the one entwurf's other two
# user atoms own. This unit must not have opened it for writing at all.
cmp -s "$SB/config.before.toml" "$CFG" && ok "install left config.toml byte-identical (vendor trust state and entwurf atoms intact)" || die "install modified config.toml"

###############################################################################
# TRUST — the vendor's receipt, read and never written
#
# The bytes being ours is half the verdict. The other half belongs to the operator: until
# the vendor records their one-time "Trust all" for THIS declaration identity, the hook is
# declared and never runs, and a doctor that called that green would sell a birth nobody
# will ever have. The sandbox has no vendor, so the receipt is forged here as a FIXTURE —
# what is under test is the reading, never the deciding.
###############################################################################
# The seed already carries a receipt for SOMEBODY ELSE's declaration — the honest starting
# shape on a host whose operator has trusted other hooks before. It is not ours.
"$DOCTOR" >"$SB/out" 2>&1 && die "[QK:CODEX-BIRTH-DOCTOR-REQUIRES-TRUST] the doctor was green with no vendor trust receipt for THIS declaration"
want "a receipt at a foreign key is refused by name" "grep -q \"NONE at this unit's key\" '$SB/out'"
want "the red carries the operator instruction, not a repair this unit could do" \
  "grep -q \"open a visible plain Codex\" '$SB/out' && grep -q \"Trust all and continue\" '$SB/out'"
# ...and with no [hooks.state] at all the refusal names that instead of guessing.
grep -v '^\[hooks.state' "$SB/config.before.toml" | grep -v '^trusted_hash' > "$CFG"
"$DOCTOR" >"$SB/out" 2>&1 && die "the doctor was green with no [hooks.state] table at all"
want "trust-absent is red and says which table is missing" "grep -q 'no vendor trust receipt for this declaration' '$SB/out' && grep -q 'no \[hooks.state\] table' '$SB/out'"
cp "$SB/config.before.toml" "$CFG"
"$DOCTOR" --unit-only >"$SB/out" 2>&1 || safe_umask_fail "--unit-only should be green on intact bytes: $(cat "$SB/out")"
want "--unit-only reports the trust axis as SKIPPED, never as green" \
  "grep -q 'the TRUST axis was skipped' '$SB/out' && grep -q 'This is a skipped axis, not a green one' '$SB/out'"

trust_receipt() { # $1 = the key to write a well-formed receipt under
  cp "$SB/config.before.toml" "$CFG"
  printf '\n[hooks.state."%s"]\ntrusted_hash = "sha256:%s"\n' "$1" "4647c53b6948cd38f2283a3fdf63e40e83b7ff29ecf14650b7e61eec9315e1cc" >> "$CFG"
}
trust_receipt "$HOOKS:session_start:0:0"
sed -i 's/^trusted_hash = .*/trusted_hash = "not-a-digest"/' "$CFG"
"$DOCTOR" >"$SB/out" 2>&1 && die "a malformed trusted_hash was accepted"
want "a malformed trusted_hash is refused by shape" "grep -q 'trusted_hash is not sha256:<64 hex>' '$SB/out'"
trust_receipt "$HOOKS:session_start:0:0"
cp "$CFG" "$SB/config-trusted.toml"
"$DOCTOR" >"$SB/out" 2>&1 || die "the doctor should be green once the vendor receipt is present: $(cat "$SB/out")"
want "the full doctor is green with unit bytes AND the vendor receipt" \
  "grep -q 'the vendor trust receipt is present for this declaration' '$SB/out'"
want "the green is worded as a vendor RECEIPT, never as a validated hash" \
  "grep -q 'not a cryptographic validation' '$SB/out' && ! grep -qi 'valid trust\|verified hash' '$SB/out'"
cmp -s "$SB/config-trusted.toml" "$CFG" && ok "reading the receipt wrote nothing back to the vendor config" || die "the doctor modified config.toml"
cp "$SB/config.before.toml" "$CFG"

###############################################################################
# idempotence — the strongest form is an untouched file
###############################################################################
MT1="$(stat -c %Y "$HOOKS")"; sleep 1.1
"$INSTALL" >"$SB/out" 2>&1 || die "reinstall failed: $(cat "$SB/out")"
MT2="$(stat -c %Y "$HOOKS")"
want "reinstall does not rewrite the declaration" "[ '$MT1' = '$MT2' ]"
want "reinstall adopts its own published declaration by digest" "grep -q 'adopting the hooks.json this unit published' '$SB/out'"
cmp -s "$SB/config.before.toml" "$CFG" && ok "reinstall still left config.toml byte-identical" || die "reinstall modified config.toml"

###############################################################################
# reinstall over an edited closure — a REFUSAL, never a silent repair
#
# The declaration is licensed by digest; the closure must be too, and for a sharper
# reason: publishing a new generation copies over these exact paths, so a member that
# drifted is somebody's edit that a `cp` would destroy with no trace. The unit repairs
# only what it can prove it wrote, so present-and-different stops the whole publish and
# every byte — hooks.json, helper members, state — must come out unchanged.
###############################################################################
cp "$HOOKS" "$SB/pre-drift-hooks.json"
cp "$STATE" "$SB/pre-drift-state.json"
cp "$LAUNCHER" "$SB/pre-drift-launcher.sh"
printf '# operator edit\n' >> "$LAUNCHER"
cp "$LAUNCHER" "$SB/drifted-launcher.sh"
DRIFT_ERR="$("$INSTALL" 2>&1 >/dev/null)" && die "[QK:CODEX-BIRTH-REINSTALL-REFUSES-CLOSURE-DRIFT] reinstall over an edited launcher was ACCEPTED instead of refused"
ok "reinstall over an edited launcher is refused, not silently repaired"
printf '%s' "$DRIFT_ERR" | grep -qE "$LAUNCHER was edited after install \(live [0-9a-f]{64}, recorded [0-9a-f]{64}\)" \
  && ok "the refusal names the exact drifted path and both digests" \
  || die "the refusal did not name the path and both digests: $DRIFT_ERR"
cmp -s "$SB/drifted-launcher.sh" "$LAUNCHER" && ok "the edited launcher survives the refused reinstall byte-for-byte" || die "the refused reinstall overwrote the edited launcher"
cmp -s "$SB/pre-drift-hooks.json" "$HOOKS" && ok "the refused reinstall left the declaration byte-identical" || die "the refused reinstall rewrote hooks.json"
cmp -s "$SB/pre-drift-state.json" "$STATE" && ok "the refused reinstall left the ownership state byte-identical" || die "the refused reinstall rewrote the state"
cmp -s "$SB/config.before.toml" "$CFG" && ok "the refused reinstall left config.toml byte-identical" || die "the refused reinstall modified config.toml"

# A drifted PAYLOAD member is the same refusal — the rule is the inventory, not the launcher.
cp "$SB/pre-drift-launcher.sh" "$LAUNCHER"
printf '// operator edit\n' >> "$HELPER/meta-bridge-hook-codex.ts"
refuses "reinstall over an edited closure member is refused too" "meta-bridge-hook-codex.ts was edited after install" "$INSTALL"
want "the drifted payload is still there" "[ -f '$HELPER/meta-bridge-hook-codex.ts' ]"

# ...and an ABSENT member is not drift: a publish interrupted after the state write must
# stay repairable by the same command, exactly as the inverse calls an absent path done.
rm -f "$HELPER/meta-bridge-hook-codex.ts"
"$INSTALL" >"$SB/out" 2>&1 || die "reinstall should REPAIR an absent closure member: $(cat "$SB/out")"
want "an absent closure member is republished, not refused" "grep -q 'closure member absent, will be republished' '$SB/out' && [ -f '$HELPER/meta-bridge-hook-codex.ts' ]"
"$DOCTOR" --unit-only >/dev/null 2>&1 || die "the unit axis should be green again after the repair"
ok "the unit axis is green again after the absent member was republished"

###############################################################################
# refusals — a foreign file, an edited file, a symlink; each ZERO-WRITE
###############################################################################
"$UNINSTALL" >/dev/null 2>&1 || die "clean uninstall before the refusal cells failed"
printf '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"/opt/operator/own-hook.sh","timeout":10}]}]}}\n' > "$HOOKS"
cp "$HOOKS" "$SB/foreign-hooks.json"
refuses "[QK:CODEX-BIRTH-FOREIGN-HOOKS-REFUSED] a foreign hooks.json is refused, not adopted" "already exists and this host has NO entwurf ownership state" "$INSTALL"
cmp -s "$SB/foreign-hooks.json" "$HOOKS" && ok "the foreign declaration survives the refusal byte-for-byte" || die "the foreign hooks.json was overwritten"
want "the foreign refusal wrote no state and no helper" "[ ! -e '$STATE' ] && [ ! -e '$HELPER' ]"
rm -f "$HOOKS"

ln -s "$SB/foreign-hooks.json" "$HOOKS"
refuses "a symlinked hooks.json is refused" "is a SYMLINK" "$INSTALL"
want "the symlink refusal wrote no state" "[ ! -e '$STATE' ] && [ -L '$HOOKS' ]"
rm -f "$HOOKS"

"$INSTALL" >/dev/null 2>&1 || die "install before the edited-declaration cell failed"
printf '\n' >> "$HOOKS"
cp "$HOOKS" "$SB/edited-hooks.json"
refuses "an edited declaration is refused instead of republished" "was edited after install" "$INSTALL"
cmp -s "$SB/edited-hooks.json" "$HOOKS" && ok "the edited declaration survives the refusal byte-for-byte" || die "the edited hooks.json was overwritten"
"$DOCTOR" --unit-only >"$SB/out" 2>&1 && die "the unit axis should be red while the declaration is edited"
want "the doctor names the edited declaration" "grep -q 'was EDITED after install' '$SB/out'"

###############################################################################
# inverse — exact removal, and a refusal that leaves drift in place
###############################################################################
"$UNINSTALL" >"$SB/out" 2>&1 && die "the inverse should refuse while the declaration is drifted"
want "the inverse refuses the drifted declaration" "grep -q 'DRIFT: the declaration was edited after install' '$SB/out'"
want "the drifted declaration is LEFT IN PLACE" "[ -f '$HOOKS' ]"
want "the inverse keeps the state so a later run can still license the path" "[ -f '$STATE' ]"
cmp -s "$SB/edited-hooks.json" "$HOOKS" && ok "the drifted declaration is byte-identical after the refused inverse" || die "the refused inverse changed the drifted file"

cp "$SB/edited-hooks.json" "$SB/keep.json"
rm -f "$HOOKS"
"$INSTALL" >/dev/null 2>&1 || die "reinstall after clearing the drift failed"
printf '# operator edit\n' >> "$LAUNCHER"
"$UNINSTALL" >"$SB/out" 2>&1 && die "the inverse should refuse while the launcher is drifted"
want "the inverse refuses a drifted helper member by digest" "grep -q 'DRIFT: helper member was edited after install' '$SB/out'"
want "the drifted launcher is LEFT IN PLACE" "[ -f '$LAUNCHER' ]"
want "the declaration it already removed is gone, and the state remains" "[ ! -e '$HOOKS' ] && [ -f '$STATE' ]"

rm -f "$LAUNCHER"
"$INSTALL" >/dev/null 2>&1 || die "reinstall before the exact-inverse cell failed"
"$UNINSTALL" >"$SB/out" 2>&1 || die "the exact inverse failed: $(cat "$SB/out")"
want "the inverse removed the declaration" "[ ! -e '$HOOKS' ]"
want "the inverse removed the helper closure and its directory" "[ ! -e '$HELPER' ]"
want "the inverse removed its own state" "[ ! -e '$STATE' ]"
want "the inverse says config.toml was never touched" "grep -q 'config.toml was neither read nor written' '$SB/out'"
cmp -s "$SB/config.before.toml" "$CFG" && ok "the full install/inverse cycle left config.toml byte-identical" || die "the cycle modified config.toml"
# An absent unit is RED, not a note. A host that trusted an OLDER declaration still carries a
# vendor receipt, so a doctor that shrugged at "nothing installed" could report green over an
# empty unit on the strength of somebody else's approval — measured exactly that way once.
"$DOCTOR" --unit-only >"$SB/out" 2>&1 && die "[QK:CODEX-BIRTH-DOCTOR-ABSENT-IS-RED] the unit axis was green with NOTHING installed"
want "an absent unit is named as red, not as an informational note" "grep -q 'no Codex birth unit is installed here' '$SB/out'"
trust_receipt "$HOOKS:session_start:0:0"
"$DOCTOR" >"$SB/out" 2>&1 && die "a stale vendor receipt made an ABSENT unit green"
want "a stale receipt cannot carry an absent unit" "grep -q 'no Codex birth unit is installed here' '$SB/out'"
cp "$SB/config.before.toml" "$CFG"

###############################################################################
# unsafe paths — ownership the unit cannot vouch for
###############################################################################
"$INSTALL" >/dev/null 2>&1 || die "install before the unsafe-path cell failed"
chmod 0777 "$HELPER"
refuses "a group/world-writable helper directory is refused" "group/world-writable" "$INSTALL"
chmod 0755 "$HELPER"
chmod 0666 "$STATE"
refuses "a group/world-writable ownership state cannot license anything" "group/world-writable" "$INSTALL"
refuses "the inverse refuses the same unsafe state" "group/world-writable" "$UNINSTALL"
chmod 0644 "$STATE"
"$UNINSTALL" >/dev/null 2>&1 || die "final cleanup uninstall failed"

###############################################################################
# a hostile umask, a short inventory, and a relative root
###############################################################################
# `umask 000` is the operator's shell, not our decision. A directory published under it that
# anyone can rewrite would let a third party swap the launcher between the digest we record
# and the exec codex performs — the closure would still match its state and still be somebody
# else's code.
rm -rf "$CODEX_HOME/hooks.json" "$UNIT_ROOT"
( umask 000; "$INSTALL" >/dev/null 2>&1 ) || die "install under umask 000 failed"
UNSAFE_DIRS="$(find "$XDG_DATA_HOME" "$CODEX_HOME" -type d -perm /022 2>/dev/null || true)"
[ -z "$UNSAFE_DIRS" ] && ok "every directory published under umask 000 is non-group/world-writable" \
  || safe_umask_fail "umask 000 published writable directories: $UNSAFE_DIRS"
want "the published files are not group/world-writable either" \
  "[ -z \"\$(find '$UNIT_ROOT' -type f -perm /022 2>/dev/null)\" ] && [ ! -w /dev/null -o -z \"\$(find '$HOOKS' -perm /022 2>/dev/null)\" ]"

# The inventory IS the authority. A state naming only the launcher would leave the payload
# unlisted: nothing could reclaim it, and nothing would judge it.
python3 - "$STATE" <<'PY_INV'
import json, sys
s = json.load(open(sys.argv[1]))
s["helperFiles"] = [f for f in s["helperFiles"] if f["path"] == "codex-birth-launch.sh"]
open(sys.argv[1], "w").write(json.dumps(s))
PY_INV
printf '// unlisted\n' >> "$HELPER/meta-bridge-hook-codex.ts"
refuses "[QK:CODEX-BIRTH-EXACT-CLOSURE-INVENTORY] a short closure inventory is refused by the installer" "exact six members" "$INSTALL"
want "the unlisted payload survives that refusal" "grep -q '^// unlisted$' '$HELPER/meta-bridge-hook-codex.ts'"
"$DOCTOR" --unit-only >"$SB/out" 2>&1 && die "the doctor accepted a short closure inventory"
want "the doctor names the missing inventory members" "grep -q 'recorded closure inventory is missing' '$SB/out'"
"$UNINSTALL" >"$SB/out" 2>&1 && die "the inverse accepted a short closure inventory"
want "the inverse refuses and removes NOTHING" \
  "grep -q 'exact six members' '$SB/out' && [ -f '$HOOKS' ] && [ -f '$HELPER/meta-bridge-hook-codex.ts' ] && [ -f '$STATE' ]"
rm -rf "$CODEX_HOME/hooks.json" "$UNIT_ROOT"

# An unknown status is not a receipt, however well its digests match. `publishing` is the one
# interrupted generation the installer knows how to finish; anything else is a state this unit
# never wrote, and adopting it would let a stranger's file license our next publish.
"$INSTALL" >/dev/null 2>&1 || die "install before the status cell failed"
python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); s["status"]="garbage"; open(sys.argv[1],"w").write(json.dumps(s))' "$STATE"
cp "$STATE" "$SB/garbage-state.json"; cp "$HOOKS" "$SB/garbage-hooks.json"
refuses "[QK:CODEX-BIRTH-INSTALL-REFUSES-UNKNOWN-STATUS] a state in an unknown status is refused even with exact digests" "unknown state status" "$INSTALL"
want "that refusal wrote nothing" \
  "cmp -s '$SB/garbage-state.json' '$STATE' && cmp -s '$SB/garbage-hooks.json' '$HOOKS'"
# ...while the interrupted generation the installer DOES define is still repairable.
python3 -c 'import json,sys; s=json.load(open(sys.argv[1])); s["status"]="publishing"; open(sys.argv[1],"w").write(json.dumps(s))' "$STATE"
"$INSTALL" >/dev/null 2>&1 || die "an interrupted `publishing` state should be finishable, not refused"
want "the finished publish records installed" "grep -q '\"status\": \"installed\"' '$STATE'"

# The directory holding the receipt carries the receipt's authority. Children untouched: what
# changed is only who may replace the inventory every digest is compared against.
chmod 0777 "$UNIT_ROOT"
refuses "[QK:CODEX-BIRTH-STATE-PARENT-AUTHORITY] reinstall refuses a unit root anyone can rewrite" "group/world-writable" "$INSTALL"
want "the refused reinstall neither repaired nor published over the unsafe root" \
  "[ \"\$(stat -c %a '$UNIT_ROOT')\" = '777' ]"
"$DOCTOR" --unit-only >"$SB/out" 2>&1 && die "the doctor accepted a unit root anyone can rewrite"
want "the doctor names the writable unit root" "grep -q 'unit root.*group/world-writable' '$SB/out'"
"$UNINSTALL" >"$SB/out" 2>&1 && die "the inverse removed things on the word of a state anyone can replace"
want "the inverse refuses and removes NOTHING from an unsafe root" \
  "grep -q 'group/world-writable' '$SB/out' && [ -f '$STATE' ] && [ -f '$HOOKS' ] && [ -f '$LAUNCHER' ]"
chmod 0755 "$UNIT_ROOT"
"$DOCTOR" --unit-only >/dev/null 2>&1 || die "the unit axis should be green once the root is safe again"
ok "the unit axis is green again once the root is no longer writable"
"$UNINSTALL" >/dev/null 2>&1 || die "cleanup uninstall after the parent-authority cell failed"

# A relative root would make "the fixed launcher path" depend on the caller's cwd — and that
# path is exactly what the vendor keys its trust receipt to.
( cd "$SB" && CODEX_HOME="relative/.codex" "$INSTALL" >"$SB/out" 2>&1 ) && die "[QK:CODEX-BIRTH-REFUSES-RELATIVE-ROOT] a relative CODEX_HOME was accepted"
want "a relative CODEX_HOME is refused zero-write" \
  "grep -q 'CODEX_HOME resolves to a relative path' '$SB/out' && [ ! -e '$SB/relative' ]"
( cd "$SB" && XDG_DATA_HOME="relative/share" "$INSTALL" >"$SB/out" 2>&1 ) && die "a relative XDG_DATA_HOME was accepted"
want "a relative XDG_DATA_HOME is refused zero-write" \
  "grep -q 'unit root resolves to a relative path' '$SB/out' && [ ! -e '$SB/relative' ]"
( cd "$SB" && CODEX_HOME="relative/.codex" "$DOCTOR" --unit-only >"$SB/out" 2>&1 ) && die "the doctor judged a relative CODEX_HOME"
want "the doctor refuses a relative CODEX_HOME before judging anything" "grep -q \"CODEX_HOME resolves to a relative path\" '$SB/out'"

REPO_AFTER="$(cd "$REPO_DIR" && git status --porcelain)"
[ "$REPO_BEFORE" = "$REPO_AFTER" ] && ok "the checkout is untouched (every byte lived in the sandbox)" || die "this gate modified the repository"

printf '\nsmoke-codex-birth: %d checks passed\n' "$pass"
