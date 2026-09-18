#!/usr/bin/env bash
# smoke-codex-birth — hermetic install/doctor/inverse contract for the Codex
# birth unit. No Codex process, no model turn, no host path: HOME, XDG_DATA_HOME and
# CODEX_HOME are all sandboxed, so every byte this gate judges was written inside the fixture.
#
# The five things it exists to prove, none of which a reading of the script can establish:
#   1. the published declaration is the EXACT trust identity (matcher-less, type/command/
#      timeout, quoted fixed launcher path) — because that identity is what an operator
#      approves once, and any drift in it costs a second approval;
#   1b. entwurf owns ONLY that declaration inside a file it SHARES (#117): a neighbouring
#      integration's `SessionStart` group in either ordering leaves install/doctor green, is
#      reported as foreign, is never certified, survives install and inverse byte-for-byte, and
#      moves no verdict of ours when it is edited;
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
  "node -e 'const s=require(process.argv[1]); if(s.schema!==\"codex-birth-install-state/v2\")throw 0; if(s.status!==\"installed\")throw 0; if(s.hooksFile!==process.argv[2])throw 0; if(s.helperDir!==process.argv[3])throw 0;' '$STATE' '$HOOKS' '$HELPER'"
# The receipt is a DECLARATION digest, not a file digest. A state carrying a whole-file
# `hooksSha256` would be claiming authority over bytes a neighbour owns — the #117 defect itself.
want "[QK:CODEX-BIRTH-STATE-CERTIFIES-DECLARATION] the state records a declaration receipt and NO whole-file digest" \
  "node -e 'const s=require(process.argv[1]); const hex=v=>/^[0-9a-f]{64}\$/.test(v); if(\"hooksSha256\" in s)throw new Error(\"the state still claims the whole file\"); if(s.declaration.event!==\"SessionStart\")throw 0; if(typeof s.declaration.command!==\"string\")throw 0; if(!hex(s.declaration.sha256))throw 0;' '$STATE'"
want "the state records a digest for every published byte" \
  "node -e 'const s=require(process.argv[1]); const hex=v=>/^[0-9a-f]{64}\$/.test(v); if(s.helperFiles.length!==6)throw 0; for(const f of s.helperFiles){if(!hex(f.sha256))throw 0;}' '$STATE'"

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
want "reinstall recognises its own declaration by normalized digest and rewrites nothing" "grep -q 'NOT REWRITTEN, not one byte' '$SB/out'"
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

###############################################################################
# COEXISTENCE (#117) — the neighbour is joined, never adopted and never refused
#
# Until 0.22.0 this unit owned hooks.json WHOLE: a file it had not written was a zero-write
# refusal, and its whole-file digest went red the moment anyone else appended. That is exactly
# what Herdr's official Codex integration does, and the vendor keeps running both declarations
# because `[source]` discovery.rs:664-665 keys trust per `<path>:<event>:<group>:<handler>`.
# These cells are the new contract: one group is ours, everything else is foreign bytes we read
# and never write.
###############################################################################
FOREIGN_GROUP='      {
        "hooks": [
          {
            "command": "bash '"'"'/sandbox/.codex/herdr-agent-state.sh'"'"' session",
            "timeout": 10,
            "type": "command"
          }
        ]
      }'
neighbour_survives() { # <label>
  printf '%s' "$FOREIGN_GROUP" > "$SB/foreign-block.txt"
  grep -qF -f "$SB/foreign-block.txt" "$HOOKS" && ok "$1" || die "$1 (the foreign group's bytes changed)"
}
foreign_file() { # writes a hooks.json declaring ONLY the neighbour, in its own formatting AND
  # its own mode — both are things this unit must carry over rather than normalise.
  printf '{\n  "hooks": {\n    "SessionStart": [\n%s\n    ]\n  }\n}\n' "$FOREIGN_GROUP" > "$HOOKS"
  chmod 0600 "$HOOKS"
}

# ORDER A — the neighbour is there first and entwurf joins it.
foreign_file
cp "$HOOKS" "$SB/foreign-only.json"
want "[QK:CODEX-BIRTH-JOINS-FOREIGN-FILE] a foreign hooks.json is JOINED by text splice, never adopted and never refused" \
  "'$INSTALL' >'$SB/out' 2>&1 && grep -q 'appended entwurf' '$SB/out' && grep -q 'byte-for-byte' '$SB/out'"
neighbour_survives "the neighbour's declaration survives the install byte-for-byte"
want "[QK:CODEX-BIRTH-SHARED-FILE-MODE-KEPT] the shared file keeps the mode it was found with — a file we only add a group to is not one whose permissions are ours to reset" \
  "[ \"\$(stat -c %a '$HOOKS')\" = '0600' ] || [ \"\$(stat -c %a '$HOOKS')\" = '600' ]"
want "entwurf's declaration was APPENDED, so the neighbour keeps index 0 and the trust receipt it already has" \
  "node -e 'const s=JSON.parse(require(\"node:fs\").readFileSync(process.argv[1],\"utf8\")); const g=s.hooks.SessionStart; if(g.length!==2)throw new Error(\"groups \"+g.length); if(g[0].hooks[0].command.includes(\"entwurf\"))throw new Error(\"entwurf took index 0\"); if(g[1].hooks[0].command!==\"'\''\"+process.argv[2]+\"'\''\")throw new Error(\"ours is not at index 1\");' '$HOOKS' '$LAUNCHER'"
want "[QK:CODEX-BIRTH-DOCTOR-COEXISTS] the doctor certifies entwurf's own declaration at its MEASURED index and stays green beside a neighbour" \
  "'$DOCTOR' --unit-only >'$SB/out' 2>&1 && grep -q \"entwurf's declaration is certified at .* group 1 handler 0\" '$SB/out'"
want "[QK:CODEX-BIRTH-DOCTOR-REPORTS-FOREIGN] the neighbour is reported as present-but-foreign, in its own section, and certified by nothing" \
  "grep -q 'FOREIGN (what else declares' '$SB/out' && grep -q 'SessionStart group 0: bash' '$SB/out' && grep -q 'present-but-foreign' '$SB/out' && grep -q 'never overwritten, never absorbed' '$SB/out'"

# THE VENDOR RECEIPT IS READ AT OUR MEASURED INDEX, and this is the cell that would have caught
# the #117 false green: with the neighbour at index 0, a constant `:0:0` reads THEIR approval and
# reports a birth hook the vendor was never asked to run.
trust_receipt "$HOOKS:session_start:1:0"
want "[QK:CODEX-BIRTH-TRUST-INDEX-MEASURED] the full doctor reads the vendor receipt at entwurf's MEASURED index (1:0 here), never at the constant :0:0" \
  "'$DOCTOR' >'$SB/out' 2>&1"
trust_receipt "$HOOKS:session_start:0:0"
"$DOCTOR" >"$SB/out" 2>&1 && die "the doctor read the NEIGHBOUR's receipt at :0:0 as entwurf's own approval"
want "a receipt at the neighbour's index is named as somebody else's approval, and the key looked for is ours" \
  "grep -q \"NONE at this unit's key $HOOKS:session_start:1:0\" '$SB/out'"
cp "$SB/config.before.toml" "$CFG"

# A neighbour EDITED after our install moves nothing of ours — it is not ours to certify.
python3 -c 'import json,sys
p=sys.argv[1]; d=json.load(open(p))
d["hooks"]["SessionStart"][0]["hooks"][0]["timeout"]=99
open(p,"w").write(json.dumps(d,indent=2))' "$HOOKS"
want "[QK:CODEX-BIRTH-FOREIGN-EDIT-NEUTRAL] a neighbour's declaration edited after our install is still reported and still certified by nothing — our verdict is unmoved" \
  "'$DOCTOR' --unit-only >'$SB/out' 2>&1 && grep -q \"entwurf's declaration is certified\" '$SB/out' && grep -q 'SessionStart group 0: bash' '$SB/out'"
"$INSTALL" >"$SB/out" 2>&1 || die "reinstall beside an edited neighbour failed: $(cat "$SB/out")"
want "a reinstall beside an edited neighbour does not rewrite hooks.json at all" "grep -q 'NOT REWRITTEN, not one byte' '$SB/out'"

# The inverse takes our group out and leaves the neighbour's bytes exactly where they were.
cp "$HOOKS" "$SB/before-inverse.json"
"$UNINSTALL" >"$SB/out" 2>&1 || die "the inverse failed beside a neighbour: $(cat "$SB/out")"
want "[QK:CODEX-BIRTH-INVERSE-KEEPS-FOREIGN] the inverse removes ONLY entwurf's group and keeps the shared file" \
  "[ -f '$HOOKS' ] && grep -q 'by text splice' '$SB/out' && ! grep -q 'codex-birth-launch.sh' '$HOOKS'"
want "the inverse left the neighbour as the file's only declaration" \
  "node -e 'const s=JSON.parse(require(\"node:fs\").readFileSync(process.argv[1],\"utf8\")); if(s.hooks.SessionStart.length!==1)throw 0; if(!s.hooks.SessionStart[0].hooks[0].command.includes(\"herdr\"))throw 0;' '$HOOKS'"
want "the inverse removed entwurf's own description and left no entwurf prose behind" "! grep -q 'entwurf codex-birth' '$HOOKS'"
# The neighbour was re-indented by its own editor above; what must survive the SPLICE is every
# byte of the group as it stood immediately before the inverse ran.
node -e '
  const fs = require("node:fs");
  const before = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).hooks.SessionStart.filter((g) => !JSON.stringify(g).includes("codex-birth-launch"));
  const after = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).hooks.SessionStart;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("foreign groups changed across the inverse");
' "$SB/before-inverse.json" "$HOOKS" && ok "[QK:CODEX-BIRTH-INVERSE-FOREIGN-EXACT] every foreign group is value-identical across the inverse" || die "the inverse changed a foreign group"
rm -f "$HOOKS"

# ORDER B — entwurf is there first and the neighbour appends afterwards, re-serializing the
# WHOLE document on its way past (measured: Herdr does exactly this, oracle 2026-09-17).
"$INSTALL" >/dev/null 2>&1 || die "install before the order-B cell failed"
python3 -c 'import json,sys
p=sys.argv[1]; d=json.load(open(p))
g=d["hooks"]["SessionStart"][0]["hooks"][0]
d["hooks"]["SessionStart"][0]["hooks"][0]={"command":g["command"],"timeout":g["timeout"],"type":g["type"]}
d["hooks"]["SessionStart"].append({"hooks":[{"command":"bash \x27/sandbox/.codex/herdr-agent-state.sh\x27 session","timeout":10,"type":"command"}]})
open(p,"w").write(json.dumps(d,indent=2))' "$HOOKS"
BEFORE_SHA="$(sha256sum "$HOOKS" | cut -d" " -f1)"
want "[QK:CODEX-BIRTH-NORMALIZED-DIGEST] the certification is blind to key order and indentation a neighbour imposed — bytes changed, our declaration did not" \
  "'$DOCTOR' --unit-only >'$SB/out' 2>&1 && grep -q \"entwurf's declaration is certified at .* group 0 handler 0\" '$SB/out' && grep -q 'NORMALIZED digest, not by file bytes' '$SB/out'"
"$INSTALL" >"$SB/out" 2>&1 || die "reinstall after a neighbour re-serialized the file failed: $(cat "$SB/out")"
want "that reinstall rewrote NOT ONE BYTE of the shared file" \
  "grep -q 'NOT REWRITTEN, not one byte' '$SB/out' && [ \"\$(sha256sum '$HOOKS' | cut -d' ' -f1)\" = '$BEFORE_SHA' ]"

# OUR OWN declaration edited is still a named refusal — the narrowing is about WHOSE bytes, not
# about being lenient with ours. SHAPE catches it first: `timeout` is part of the identity the
# operator approved, so a value the installer never writes is not a digest question at all.
python3 -c 'import json,sys
p=sys.argv[1]; d=json.load(open(p))
d["hooks"]["SessionStart"][0]["hooks"][0]["timeout"]=31
open(p,"w").write(json.dumps(d,indent=2))' "$HOOKS"
refuses "[QK:CODEX-BIRTH-OWN-DECLARATION-DRIFT] an edit to entwurf's OWN handler is refused by name" "declaration-shape-drifted" "$INSTALL"
"$DOCTOR" --unit-only >"$SB/out" 2>&1 && die "the doctor was green over an edited entwurf declaration"
want "the doctor names our own drifted declaration and what about it drifted" "grep -q 'declaration is not certifiable' '$SB/out' && grep -q 'timeout must be 30' '$SB/out'"
"$UNINSTALL" >"$SB/out" 2>&1 && die "the inverse removed an edited entwurf declaration"
want "the inverse leaves our own drifted declaration in place" "grep -q 'DRIFT' '$SB/out' && grep -q 'declaration-shape-drifted' '$SB/out' && [ -f '$HOOKS' ]"

# SHAPE and DIGEST are two different authorities and only one of them is the recorded receipt.
# Shape asks "is this the declaration these fixed paths produce"; the digest asks "is this the
# declaration the STATE recorded". Tampering with the receipt alone is the only way to separate
# them, and it must be red: a receipt anyone can retune certifies nothing.
rm -rf "$HOOKS" "$UNIT_ROOT"
"$INSTALL" >/dev/null 2>&1 || die "install before the receipt-binding cell failed"
python3 -c 'import json,sys
p=sys.argv[1]; s=json.load(open(p))
s["declaration"]["sha256"]="0"*64
open(p,"w").write(json.dumps(s,indent=2))' "$STATE"
want "[QK:CODEX-BIRTH-DECLARATION-RECEIPT-BINDS] the live declaration is compared to the RECORDED normalized digest, and a receipt that no longer names it is red" \
  "! '$DOCTOR' --unit-only >'$SB/out' 2>&1 && grep -q 'declaration was EDITED after install' '$SB/out' && grep -q 'live normalized' '$SB/out' && grep -q 'recorded 0000' '$SB/out'"
"$INSTALL" >/dev/null 2>&1 || die "install should re-record the receipt over a tampered one"
"$DOCTOR" --unit-only >/dev/null 2>&1 || die "the unit axis should be green once the receipt is republished"
ok "install re-records the declaration receipt, and the unit axis is green again"

# ...and a SECOND copy of our declaration is a refusal too: the vendor would run the birth hook
# twice per session, and only one of those positions can carry the operator's receipt.
python3 -c 'import json,sys
p=sys.argv[1]; d=json.load(open(p)); g=d["hooks"]["SessionStart"]
g[0]["hooks"][0]["timeout"]=30
g.append(json.loads(json.dumps(g[0])))
open(p,"w").write(json.dumps(d,indent=2))' "$HOOKS"
refuses "[QK:CODEX-BIRTH-DECLARATION-DUPLICATED] our declaration present twice is refused by name, never first-match accepted" "declaration-duplicated" "$INSTALL"
"$DOCTOR" --unit-only >"$SB/out" 2>&1 && die "the doctor accepted a duplicated entwurf declaration"
want "the doctor names the duplication and both positions" "grep -q 'declaration-duplicated' '$SB/out' && grep -qE 'group [0-9]+ handler [0-9]+, group [0-9]+ handler [0-9]+' '$SB/out'"
rm -rf "$HOOKS" "$UNIT_ROOT"


ln -s "$SB/foreign-hooks.json" "$HOOKS"
refuses "a symlinked hooks.json is refused" "is a SYMLINK" "$INSTALL"
want "the symlink refusal wrote no state" "[ ! -e '$STATE' ] && [ -L '$HOOKS' ]"
rm -f "$HOOKS"

"$INSTALL" >/dev/null 2>&1 || die "install before the edited-declaration cell failed"
# WHITESPACE IS NOT DRIFT ANY MORE, and that is a contract change worth pinning: a normalized
# digest is blind to formatting precisely so a neighbour's re-serialize cannot fake an edit.
printf '\n' >> "$HOOKS"
want "[QK:CODEX-BIRTH-WHITESPACE-NOT-DRIFT] reformatting alone is not drift — the digest is over the declaration, not the bytes" \
  "'$DOCTOR' --unit-only >/dev/null 2>&1"
# An edit to a FIELD of our handler still is.
python3 -c 'import json,sys
p=sys.argv[1]; d=json.load(open(p))
d["hooks"]["SessionStart"][0]["hooks"][0]["timeout"]=7
open(p,"w").write(json.dumps(d,indent=2))' "$HOOKS"
cp "$HOOKS" "$SB/edited-hooks.json"
refuses "an edited declaration is refused instead of republished" "declaration-shape-drifted" "$INSTALL"
cmp -s "$SB/edited-hooks.json" "$HOOKS" && ok "the edited declaration survives the refusal byte-for-byte" || die "the edited hooks.json was overwritten"
"$DOCTOR" --unit-only >"$SB/out" 2>&1 && die "the unit axis should be red while the declaration is edited"
want "the doctor names the edited declaration" "grep -q 'declaration is not certifiable' '$SB/out'"

###############################################################################
# inverse — exact removal, and a refusal that leaves drift in place
###############################################################################
"$UNINSTALL" >"$SB/out" 2>&1 && die "the inverse should refuse while the declaration is drifted"
want "the inverse refuses the drifted declaration" "grep -q 'DRIFT' '$SB/out' && grep -q 'declaration-shape-drifted' '$SB/out'"
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
# ...and with nothing installed the FOREIGN axis says NOT READ, never "none": the UNIT axis never
# opened that file, and "none" would be this doctor asserting something about the operator's
# hooks.json it never looked at.
want "[QK:CODEX-BIRTH-FOREIGN-UNREAD-NOT-NONE] an unscanned FOREIGN axis reports NOT READ rather than claiming there are no neighbours" \
  "grep -q 'NOT READ' '$SB/out' && ! grep -q 'none — entwurf is the only' '$SB/out'"
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

# A v1 ownership receipt recorded a digest of the WHOLE hooks.json. Reading it leniently would
# certify bytes a neighbour owns, so every reader refuses it by name — and the installer is the
# one forward path, superseding it without removing anything or rewriting a foreign byte.
rm -rf "$HOOKS" "$UNIT_ROOT"
"$INSTALL" >/dev/null 2>&1 || die "install before the v1-supersede cell failed"
python3 -c 'import json,sys
p=sys.argv[1]; s=json.load(open(p))
s["schema"]="codex-birth-install-state/v1"
s["hooksSha256"]="1"*64
del s["declaration"]
open(p,"w").write(json.dumps(s,indent=2))' "$STATE"
want "[QK:CODEX-BIRTH-STATE-V1-REFUSED] the doctor refuses a v1 receipt by name and names the one forward path" \
  "! '$DOCTOR' --unit-only >'$SB/out' 2>&1 && grep -q 'codex-birth-install-state/v1' '$SB/out' && grep -q 'WHOLE hooks.json' '$SB/out' && grep -q 'install-codex-birth' '$SB/out'"
"$UNINSTALL" >"$SB/out" 2>&1 && die "the inverse removed things on the word of a v1 receipt"
want "the inverse refuses a v1 receipt and removes NOTHING" \
  "grep -q 'codex-birth-install-state/v2' '$SB/out' && [ -f '$HOOKS' ] && [ -f '$LAUNCHER' ] && [ -f '$STATE' ]"
HOOKS_BEFORE_V1="$(sha256sum "$HOOKS" | cut -d' ' -f1)"
"$INSTALL" >"$SB/out" 2>&1 || die "the installer should supersede a v1 receipt: $(cat "$SB/out")"
want "the installer supersedes v1 forward, says so, and rewrites not one byte of hooks.json" \
  "grep -q 'superseding a v1 ownership receipt' '$SB/out' && grep -q 'NOT REWRITTEN, not one byte' '$SB/out' && [ \"\$(sha256sum '$HOOKS' | cut -d' ' -f1)\" = \"$HOOKS_BEFORE_V1\" ]"
"$DOCTOR" --unit-only >/dev/null 2>&1 || die "the unit axis should be green once the receipt is v2"
ok "the unit axis is green once the receipt has been superseded to v2"

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

# ── the FILE verdict has to EARN its delete (sol B2, 2026-09-18) ─────────────────────────────
# The counterexample, derived from the source rather than imagined: a hooks.json that existed
# BEFORE this unit, carrying a foreign top-level `description` and an EMPTY SessionStart array.
# Our install appends one group, so afterwards there is no foreign GROUP, one event, and one
# declaration — which is exactly what the old FILE test asked. It deleted the whole file, and the
# neighbour's description with it, while the receipt had recorded `hooksExistedBefore: true` the
# entire time and nothing read it.
"$UNINSTALL" >/dev/null 2>&1 || true
printf '{\n  "description": "a neighbour wrote this",\n  "note": "and this",\n  "hooks": {\n    "SessionStart": []\n  }\n}\n' > "$HOOKS"
chmod 0600 "$HOOKS"
PRE_EXISTING_SHA="$(sha256sum "$HOOKS" | cut -d' ' -f1)"
"$INSTALL" >/dev/null 2>&1 || die "install into a pre-existing empty-declaration file failed"
"$UNINSTALL" >"$SB/out" 2>&1 || die "uninstall after that install failed: $(cat "$SB/out")"
want "[QK:CODEX-BIRTH-INVERSE-KEEPS-PRE-EXISTING-FILE] a file that existed BEFORE this unit survives the inverse whole — our group comes out by splice and the neighbour's top-level bytes come back byte-for-byte, because hooksExistedBefore is a removal authority and not a decoration" \
  "[ -f '$HOOKS' ] && [ \"\$(sha256sum '$HOOKS' | cut -d' ' -f1)\" = \"$PRE_EXISTING_SHA\" ] && grep -q 'by text splice' '$SB/out'"
# And the delete arm still exists for the case it was written for: a file this unit created,
# holding nothing but its own description and its own group.
rm -f "$HOOKS"
"$INSTALL" >/dev/null 2>&1 || die "install into a host with no hooks.json failed"
"$UNINSTALL" >"$SB/out" 2>&1 || die "uninstall of a file we created failed: $(cat "$SB/out")"
want "a hooks.json this unit CREATED, holding only its own description and group, is still removed whole" \
  "[ ! -e '$HOOKS' ] && grep -q 'entwurf was its only declaration' '$SB/out'"

# ── the SHARED file's own ownership, decided ONCE for four surfaces (sol B3, 2026-09-18) ─────
# The split this closes: install and uninstall asked only symlink-and-regular, the doctor asked
# NOTHING about who owned hooks.json, and only the fresh-call preflight refused a foreign uid or a
# group-writable mode. So a host could install clean, read GREEN, and have every Codex launch
# refuse it as `codex-birth-unit-missing` — three surfaces saying yes about bytes the fourth said
# no about. All four now decide with `classifyOwnedPath` in the shared declaration leaf.
#
# We still never chmod what we share. The cells below prove the mode we found is the mode left
# behind: an unsafe shared file is a zero-write REFUSAL, not a file we normalise on the way past.
"$INSTALL" >/dev/null 2>&1 || die "install before the shared-ownership cells failed"
HOOKS_BEFORE_UNSAFE="$(sha256sum "$HOOKS" | cut -d' ' -f1)"
chmod 0666 "$HOOKS"
refuses "[QK:CODEX-BIRTH-SHARED-FILE-OWNERSHIP] install refuses a hooks.json anyone else can rewrite — a receipt cannot bind bytes somebody else controls" \
  "group/world-writable" "$INSTALL"
want "the refused install neither repaired the mode nor wrote a byte" \
  "[ \"\$(stat -c %a '$HOOKS')\" = '666' ] && [ \"\$(sha256sum '$HOOKS' | cut -d' ' -f1)\" = \"$HOOKS_BEFORE_UNSAFE\" ]"
# ONE assertion, because the exit code and the wording are one claim: a doctor that stayed green
# would fail a separate negative line first, and that line could not carry the token (a manifest
# may name its QK exactly once per gate source), so the mutant would die unattributable.
DOCTOR_RC=0
"$DOCTOR" --unit-only >"$SB/out" 2>&1 || DOCTOR_RC=$?
want "[QK:CODEX-BIRTH-DOCTOR-SHARED-OWNERSHIP] the doctor asks the same ownership question BEFORE it measures any digest — a digest taken in a file somebody else can rewrite certifies nothing, and a green here would contradict the launcher" \
  "[ \"$DOCTOR_RC\" -ne 0 ] && grep -q 'group/world-writable' '$SB/out' && grep -q 'every Codex fresh call refuses this host' '$SB/out'"
"$UNINSTALL" >"$SB/out" 2>&1 || true   # drift is a nonzero exit; the WORDS and the bytes are the claim
want "[QK:CODEX-BIRTH-INVERSE-SHARED-OWNERSHIP] the inverse asks it too and leaves an unsafe shared file exactly as found, counted as DRIFT — it used to rewrite a file it could not bind" \
  "grep -q 'DRIFT: the declaration file writable-by-others' '$SB/out' && [ \"\$(sha256sum '$HOOKS' | cut -d' ' -f1)\" = \"$HOOKS_BEFORE_UNSAFE\" ]"
chmod 0600 "$HOOKS"
# That inverse removed the closure it COULD account for and left the shared file alone, so the
# way back to green is an install — which is itself the claim: the refusal was about this file's
# ownership and nothing else, and it lifts the moment the ownership does.
"$INSTALL" >/dev/null 2>&1 || die "install should succeed again once the shared file is no longer writable by others"
"$DOCTOR" --unit-only >/dev/null 2>&1 || die "the unit axis should be green again once the shared file is no longer writable by others"
ok "all four surfaces agree again once the shared file is safe"
ln -sf "$SB/foreign-only.json" "$SB/hooks-link.json"
refuses "a symlinked hooks.json is refused with its OWN word — the repair is not a mode change, it is a different file" \
  "SYMLINK" env CODEX_HOME="$CODEX_HOME" HOOKS_LINK=1 bash -c "cp '$HOOKS' '$SB/hooks-real.json'; rm '$HOOKS'; ln -s '$SB/hooks-real.json' '$HOOKS'; '$INSTALL'"
rm -f "$HOOKS"; cp "$SB/hooks-real.json" "$HOOKS"; chmod 0600 "$HOOKS"
"$UNINSTALL" >/dev/null 2>&1 || die "cleanup uninstall after the shared-ownership cells failed"

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
