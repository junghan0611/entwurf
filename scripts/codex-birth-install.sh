#!/usr/bin/env bash
# codex-birth-install — publish the Codex SessionStart birth unit. No root, ever.
#
# Three paths, all the operator's own:
#
#   $CODEX_HOME/hooks.json                          ONE SessionStart group inside a SHARED file
#   ${XDG_DATA_HOME:-~/.local/share}/entwurf/codex-birth/helper/
#                                                   launcher + the TS payload closure
#   .../entwurf/codex-birth/install-state.json      the digest inventory that licenses removal
#
# WHY THIS IS NOT A SYSTEM UNIT. An earlier candidate declared the same hook in the MANAGED
# `/etc` config layer, where the vendor skips its trust check entirely (`[source]`
# hooks/src/engine/discovery.rs:794-815). That bought a prompt-free install and charged
# root for it — and on a user-installed Codex (NixOS, pnpm-global) root is not a thing the
# operator agreed to spend. A user declaration is not rejected; it is TRUST-GATED. It runs
# after the operator answers "Trust all" ONCE, in their own visible Codex, and the vendor
# records that decision itself. Measured on this host: after that single answer, later
# plain sessions raise no prompt and are born automatically.
#
# THIS UNIT NEVER TOUCHES THAT DECISION. It does not compute, write, pre-seed or read a
# `trusted_hash`, and it never reads or writes config.toml — the file where the vendor keeps
# `[hooks.state]` (and where entwurf's two other user atoms live). Trust is the operator's to
# give; forging it in a file we already own would be the one shortcut that turns a security
# prompt into a silent install.
#
# WHAT THIS UNIT OWNS IN hooks.json, AND WHAT IT DOES NOT (#117). Until 0.22.0 this unit owned
# that file WHOLE: it refused any file it had not written and recorded a whole-file sha256. That
# was true only while entwurf was the only thing declaring a Codex hook. Herdr's official Codex
# integration appends its own `SessionStart` group and the vendor keeps running both, because
# `[source]` discovery.rs:664-665 keys trust by `<path>:<event>:<group_idx>:<handler_idx>` — trust
# is DECLARATION-scoped and always was. So this unit now owns exactly one group holding exactly
# one handler whose command is our quoted launcher path. Every other group is FOREIGN: reported,
# never certified, never rewritten. Adding and removing our group is a TEXT SPLICE
# (pi-extensions/lib/codex-declaration.js), so a neighbour's bytes come through untouched.
#
# THE TRUST IDENTITY IS THE LAUNCHER PATH. `[source]` discovery.rs:775-792 hashes a
# normalized identity of (event name + matcher group + the single handler) — so `type`, the
# quoted absolute `command`, `timeout` and the absent `matcher` ARE the operator's approval,
# while the launcher's CONTENTS, the payload closure, this unit's version and the hooks.json
# `description` are not. That asymmetry is the whole reason a user unit is affordable: the
# closure can be upgraded on every release without ever asking the operator again, as long as
# the launcher path and those three declaration fields never move.
set -euo pipefail

# A hostile inherited umask must not decide the mode of a directory this unit creates. The
# ownership preflight below refuses an EXISTING group/world-writable path, but a directory we
# make ourselves never passes through that check — measured: `umask 000` published the unit
# root, helper and lib directories 0777, i.e. a closure anyone on the host could rewrite
# between the digest we record and the exec codex performs. Both halves are fixed: this umask
# floors what the process can create, and every directory is chmod'ed to its exact mode after
# creation so the result does not depend on inheriting anything.
umask 022

die() { printf '[codex-birth-install] %s\n' "$1" >&2; exit 1; }
note() { printf '[codex-birth-install] %s\n' "$1"; }

for arg in "$@"; do
  case "$arg" in
    *) die "unknown argument '$arg' — this installer takes no options; its paths are fixed so the trust identity cannot drift." ;;
  esac
done

[ "$(uname -s)" = "Linux" ] || die "Linux only: this unit is measured against a Linux Codex CLI and publishes Linux paths."
[ "$(id -u)" != "0" ] || die "refusing to run as root: every path this unit owns belongs to the operator, and publishing them as root would leave bytes they cannot replace or remove."

REPO="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HOOKS_FILE="$CODEX_HOME/hooks.json"
PACKAGE_STATE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf"
UNIT_ROOT="$PACKAGE_STATE_ROOT/codex-birth"
HELPER_DIR="$UNIT_ROOT/helper"
LAUNCHER_NAME="codex-birth-launch.sh"
LAUNCHER="$HELPER_DIR/$LAUNCHER_NAME"
STATE_FILE="$UNIT_ROOT/install-state.json"
PAYLOAD_NAME="meta-bridge-hook-codex.ts"

# Every path below is derived from the operator's environment, so a relative CODEX_HOME or
# XDG_DATA_HOME would make "the fixed launcher path" depend on the caller's cwd — and that
# path IS the identity the vendor trust receipt is keyed to. A declaration whose meaning
# changes with `cd` is not an identity; refuse before anything is read or written.
case "$CODEX_HOME" in /*) : ;; *) die "CODEX_HOME resolves to a relative path ('$CODEX_HOME'); the declaration records an absolute launcher path and the vendor keys its trust receipt to it. Nothing written." ;; esac
case "$UNIT_ROOT" in /*) : ;; *) die "the unit root resolves to a relative path ('$UNIT_ROOT') — set an absolute XDG_DATA_HOME or HOME. Nothing written." ;; esac

command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required (every published byte is recorded by digest) and is not on PATH."
NODE_BIN="$(command -v node)" || die "node is not on PATH — the hook payload runs under it."
NODE_BIN="$(cd -P -- "$(dirname -- "$NODE_BIN")" && pwd)/$(basename -- "$NODE_BIN")"
[ -x "$NODE_BIN" ] || die "resolved node is not executable: $NODE_BIN"
case "$NODE_BIN" in /*) : ;; *) die "resolved node path is not absolute: $NODE_BIN" ;; esac
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 24 ] 2>/dev/null || die "node >= 24 is required (the payload is stripped, not compiled); $NODE_BIN reports major '$NODE_MAJOR'."

DECLARATION_LIB="$REPO/pi-extensions/lib/codex-declaration.js"
[ -f "$DECLARATION_LIB" ] || die "the declaration leaf is missing: $DECLARATION_LIB (reinstall the package, or check out the repo completely)."

PAYLOAD_SRC="$REPO/pi-extensions/$PAYLOAD_NAME"
LIB_SRC="$REPO/pi-extensions/lib/meta-session.ts"
CODEX_CLIENT_SRC="$REPO/pi-extensions/lib/native-push/codex-ws-client.ts"
SESSION_ID_SRC="$REPO/pi-extensions/lib/session-id.js"
REGISTRY_SRC="$REPO/pi/entwurf-capabilities.json"
for f in "$PAYLOAD_SRC" "$LIB_SRC" "$CODEX_CLIENT_SRC" "$SESSION_ID_SRC" "$REGISTRY_SRC"; do
  [ -f "$f" ] || die "closure member missing: $f (reinstall the package, or check out the repo completely)."
done

UNIT_VERSION="$("$NODE_BIN" -p 'require("'"$REPO"'/package.json").version' 2>/dev/null || true)"
case "$UNIT_VERSION" in
  ""|*[![:graph:]]*) die "could not read a single printable version token from $REPO/package.json (got '${UNIT_VERSION:-<empty>}') — it travels into the ownership state." ;;
esac

sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }
ME="$(id -u)"

# A path we are allowed to own: present, not a link, ours, and not writable by anyone else.
# The subject is the operator: nothing here is licensed by root, and nothing asks for it.
safe_own_dir() { # $1 = dir, $2 = label
  local st mode uid
  st="$(stat -c '%f %a %u' -- "$1" 2>/dev/null)" || die "$2 ($1) cannot be stat'ed. Nothing written."
  mode="$(printf '%s' "$st" | cut -d' ' -f2)"; uid="$(printf '%s' "$st" | cut -d' ' -f3)"
  [ -L "$1" ] && die "$2 ($1) is a SYMLINK — this unit publishes through no link. Nothing written."
  [ -d "$1" ] || die "$2 ($1) is not a directory. Nothing written."
  [ "$uid" = "$ME" ] || die "$2 ($1) is owned by uid $uid, not you ($ME). Nothing written."
  [ $((8#$mode & 0022)) -eq 0 ] || die "$2 ($1) is group/world-writable (mode $mode), so its contents are not provably ours. Nothing written."
}

# ── ownership preflight — READ-ONLY, and every refusal is zero-write ─────────
# Three different facts, three different refusals, none of them silent:
#   a foreign hooks.json (no state behind it), a hand-edited one (state disagrees), and a
#   symlink (whose target could be any file on the host).
# The directory holding the ownership state is part of that state's authority: anyone who can
# write it can replace the receipt that licenses every removal below. So it is judged BEFORE
# the state is read, and it is NEVER repaired on the way past — silently chmod-ing an unsafe
# directory we found would erase the evidence that it was unsafe and then trust it.
[ -e "$PACKAGE_STATE_ROOT" ] && safe_own_dir "$PACKAGE_STATE_ROOT" "the package state root"
[ -e "$UNIT_ROOT" ] && safe_own_dir "$UNIT_ROOT" "the unit root (it holds the ownership state)"

STATE_PRESENT=0
RECORDED_SCHEMA=""
if [ -e "$STATE_FILE" ] || [ -L "$STATE_FILE" ]; then
  [ -L "$STATE_FILE" ] && die "$STATE_FILE is a symlink — refusing to take replacement authority from a link. Nothing written."
  [ -f "$STATE_FILE" ] || die "$STATE_FILE is not a regular file. Nothing written."
  STATE_ST="$(stat -c '%a %u' -- "$STATE_FILE")"
  STATE_MODE="$(printf '%s' "$STATE_ST" | cut -d' ' -f1)"; STATE_UID="$(printf '%s' "$STATE_ST" | cut -d' ' -f2)"
  [ "$STATE_UID" = "$ME" ] || die "$STATE_FILE is owned by uid $STATE_UID, not you ($ME) — it licenses deletions, so a foreign owner means someone else chooses what this removes. Nothing written."
  [ $((8#$STATE_MODE & 0022)) -eq 0 ] || die "$STATE_FILE is group/world-writable (mode $STATE_MODE) — the same authority problem. Nothing written."
  STATE_READ="$("$NODE_BIN" -e '
    const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const path = require("node:path");
    // v1 is READ HERE AND NOWHERE ELSE, and only to be SUPERSEDED. It recorded a whole-file
    // hooksSha256 this installer no longer consults: whether hooks.json may be edited is now
    // decided by reading the live document and selecting our own declaration, not by a receipt
    // from a generation that claimed the whole file. What v1 still holds that this run needs is
    // the CLOSURE inventory, whose shape is identical in both schemas. Every other reader —
    // uninstall, doctor, preflight — refuses v1 by name and sends the operator here.
    if (s.schema !== "codex-birth-install-state/v2" && s.schema !== "codex-birth-install-state/v1") throw new Error("foreign state schema " + JSON.stringify(s.schema));
    // A state this unit never wrote — or one left in a status it does not define — is not a
    // receipt, however well its digests happen to match. `publishing` is the one interrupted
    // generation this installer knows how to finish.
    if (s.status !== "installed" && s.status !== "publishing") throw new Error("unknown state status " + JSON.stringify(s.status));
    if (s.hooksFile !== process.argv[2]) throw new Error("state is bound to " + s.hooksFile + ", not " + process.argv[2]);
    if (s.helperDir !== process.argv[3]) throw new Error("state is bound to helper dir " + s.helperDir);
    // The inventory is the removal/replacement authority, so it must be EXACTLY the closure
    // this unit publishes: a state naming fewer members would leave an unlisted file in the
    // helper directory that nothing can reclaim, and one naming more would license deleting
    // something we never wrote.
    const expected = [
      "codex-birth-launch.sh",
      "meta-bridge-hook-codex.ts",
      "lib/meta-session.ts",
      "lib/native-push/codex-ws-client.ts",
      "lib/session-id.js",
      "entwurf-capabilities.json",
    ];
    if (!Array.isArray(s.helperFiles)) throw new Error("helperFiles is not an array");
    const named = s.helperFiles.map((f) => (f == null ? "" : f.path));
    const missing = expected.filter((name) => !named.includes(name));
    const extra = named.filter((name) => !expected.includes(name));
    const duplicate = named.filter((name, i) => named.indexOf(name) !== i);
    if (missing.length || extra.length || duplicate.length) {
      throw new Error(
        "the recorded closure inventory is not the exact six members this unit publishes" +
          (missing.length ? "; missing " + missing.join(", ") : "") +
          (extra.length ? "; unexpected " + extra.join(", ") : "") +
          (duplicate.length ? "; duplicated " + duplicate.join(", ") : ""),
      );
    }
    const lines = ["SCHEMA\t" + s.schema];
    for (const f of s.helperFiles) {
      if (typeof f?.path !== "string" || f.path.length === 0 || f.path.startsWith("/") || f.path.split("/").includes("..")) {
        throw new Error("unsafe helper path " + JSON.stringify(f?.path));
      }
      if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error("bad helper digest for " + f.path);
      lines.push(["HELPER", f.sha256, path.join(s.helperDir, f.path)].join("\t"));
    }
    process.stdout.write(lines.join("\n"));
  ' "$STATE_FILE" "$HOOKS_FILE" "$HELPER_DIR" 2>&1)" || die "the ownership state is malformed or bound elsewhere, so replacement authority is UNKNOWN: $STATE_READ
Move $STATE_FILE aside deliberately and re-run. Nothing written."
  RECORDED_SCHEMA="$(printf '%s\n' "$STATE_READ" | sed -n 's/^SCHEMA\t//p')"
  STATE_PRESENT=1

  # The closure is licensed by the SAME rule as the declaration, and for the same reason.
  # A reinstall publishes a new generation over these exact paths, so a member that no
  # longer matches the digest the old state recorded is somebody's edit — and a `cp` over
  # it would destroy the one copy of a change nobody can read back. This unit repairs
  # nothing it cannot prove it wrote: present-and-different is a REFUSAL here, not a fix.
  #
  # ABSENT is deliberately not drift, mirroring the inverse's own vocabulary ("already
  # absent" is done, not DRIFT): a publish interrupted between the state write and the
  # closure copy leaves members missing, and refusing those would make a crash
  # unrecoverable by the very command that repairs it.
  while IFS="$(printf '\t')" read -r kind want target; do
    [ "$kind" = "HELPER" ] || continue
    if [ -L "$target" ]; then
      die "$target is a SYMLINK now — this unit published a regular file there and refuses to write through a link. Refusing; nothing written."
    fi
    if [ ! -e "$target" ]; then
      note "closure member absent, will be republished: $target"
      continue
    fi
    [ -f "$target" ] || die "$target is no longer a regular file. Refusing; nothing written."
    MEMBER_ST="$(stat -c '%a %u' -- "$target")"
    MEMBER_MODE="$(printf '%s' "$MEMBER_ST" | cut -d' ' -f1)"
    MEMBER_UID="$(printf '%s' "$MEMBER_ST" | cut -d' ' -f2)"
    [ "$MEMBER_UID" = "$ME" ] || die "$target is owned by uid $MEMBER_UID, not you ($ME) — it is not ours to replace. Refusing; nothing written."
    [ $((8#$MEMBER_MODE & 0022)) -eq 0 ] || die "$target is group/world-writable (mode $MEMBER_MODE), so its current bytes are not provably ours. Refusing; nothing written."
    MEMBER_LIVE="$(sha_of "$target")"
    if [ "$MEMBER_LIVE" != "$want" ]; then
      die "$target was edited after install (live $MEMBER_LIVE, recorded $want).
Republishing would throw away an edit this unit cannot read back. Refusing; nothing written.
If the edit was yours, keep it and stop using this unit; otherwise run the inverse first."
    fi
  done <<EOF
$STATE_READ
EOF
fi

if [ -L "$HOOKS_FILE" ]; then
  die "$HOOKS_FILE is a SYMLINK. This unit owns that path as ONE regular file and never publishes through a link. Refusing; nothing written."
fi
if [ -e "$HOOKS_FILE" ]; then
  [ -f "$HOOKS_FILE" ] || die "$HOOKS_FILE exists and is not a regular file. Refusing; nothing written."
fi
if [ "$STATE_PRESENT" = "1" ] && [ "$RECORDED_SCHEMA" = "codex-birth-install-state/v1" ]; then
  note "superseding a v1 ownership receipt (it claimed the WHOLE hooks.json) with v2 (it certifies entwurf's own declaration) — no foreign byte is read as ours, and none is rewritten."
fi

if [ -e "$HELPER_DIR" ] || [ -L "$HELPER_DIR" ]; then
  [ "$STATE_PRESENT" = "1" ] || die "$HELPER_DIR already exists and this host has NO entwurf ownership state ($STATE_FILE) — its contents are not ours to replace. Refusing; nothing written.
Move it aside deliberately and re-run."
  safe_own_dir "$HELPER_DIR" "the helper directory"
fi
[ -e "$CODEX_HOME" ] && safe_own_dir "$CODEX_HOME" "the Codex config folder"

# ── stage — everything is built and digested before ANY published path moves ─
STAGE="$(mktemp -d)"
HOOKS_TMP="$(mktemp)"
STATE_TMP="$(mktemp)"
cleanup() { rm -rf -- "$STAGE" "$HOOKS_TMP" "$STATE_TMP"; }
trap cleanup EXIT

mkdir -p -- "$STAGE/lib/native-push"
cp -- "$PAYLOAD_SRC" "$STAGE/$PAYLOAD_NAME"
cp -- "$LIB_SRC" "$STAGE/lib/meta-session.ts"
cp -- "$CODEX_CLIENT_SRC" "$STAGE/lib/native-push/codex-ws-client.ts"
cp -- "$SESSION_ID_SRC" "$STAGE/lib/session-id.js"
cp -- "$REGISTRY_SRC" "$STAGE/entwurf-capabilities.json"

# The launcher is the indirection the trust identity points at. Its bytes are NOT hashed by
# the vendor, which is exactly why the node path and the payload location live in here and
# not in the declaration: this file may be rewritten on every upgrade, the declaration may
# not. `exec`, not call — the payload keeps this pid.
cat > "$STAGE/$LAUNCHER_NAME" <<LAUNCHER
#!/usr/bin/env bash
# GENERATED by codex-birth-install.sh (entwurf $UNIT_VERSION) — DO NOT EDIT.
# Its exact bytes are recorded in $STATE_FILE; an edit makes the doctor red and makes the
# inverse refuse to remove this file.
set -uo pipefail

NODE_BIN="$NODE_BIN"
PAYLOAD="$HELPER_DIR/$PAYLOAD_NAME"

if [ ! -x "\$NODE_BIN" ]; then
  echo "entwurf codex-birth: the recorded node is missing or not executable: \$NODE_BIN" >&2
  echo "entwurf codex-birth: re-run './run.sh install-codex-birth' after a node change." >&2
  exit 1
fi
if [ ! -f "\$PAYLOAD" ]; then
  echo "entwurf codex-birth: hook payload missing: \$PAYLOAD (half-removed install?)" >&2
  exit 1
fi

exec "\$NODE_BIN" --experimental-strip-types --disable-warning=ExperimentalWarning "\$PAYLOAD"
LAUNCHER
chmod 0755 -- "$STAGE/$LAUNCHER_NAME"
chmod 0644 -- "$STAGE/$PAYLOAD_NAME" "$STAGE/lib/meta-session.ts" "$STAGE/lib/native-push/codex-ws-client.ts" "$STAGE/lib/session-id.js" "$STAGE/entwurf-capabilities.json"

LAUNCHER_SHA="$(sha_of "$STAGE/$LAUNCHER_NAME")"
PAYLOAD_SHA="$(sha_of "$STAGE/$PAYLOAD_NAME")"
LIB_SHA="$(sha_of "$STAGE/lib/meta-session.ts")"
CODEX_CLIENT_SHA="$(sha_of "$STAGE/lib/native-push/codex-ws-client.ts")"
SESSION_ID_SHA="$(sha_of "$STAGE/lib/session-id.js")"
REGISTRY_SHA="$(sha_of "$STAGE/entwurf-capabilities.json")"

# ── the declaration — the ONLY bytes the operator's trust decision covers ────
# `[source]` hooks.json is `HooksFile { description?, hooks }` (config/src/hook_config.rs:12-17),
# each event a list of `MatcherGroup { matcher?, hooks }` (:36-61, :153-159), each handler a
# `#[serde(tag="type")]` variant (:161-200). Three omissions carry meaning:
#   matcher  omitted, so this fires for all four SessionStart sources; "" is NOT the same.
#   async    omitted: birth must be SYNCHRONOUS — the MCP child of the same turn resolves its
#            identity from the record this hook writes.
#   state    not a hooks.json key at all; `[hooks.state]` is the vendor's, in config.toml, and
#            this unit neither reads nor writes that file.
#
# FOUR OUTCOMES, AND ONLY TWO OF THEM WRITE (#117). The declaration leaf decides, because it is
# the same leaf the doctor and the fresh preflight judge with:
#
#   PRESENT+CERTIFIED  our group is there, shaped right, and its normalized digest is the one
#                      this unit publishes -> hooks.json is NOT TOUCHED AT ALL. Not rewritten,
#                      not re-serialized, mtime unchanged. This is the ordinary re-run on a host
#                      where a neighbour has since re-serialized the document.
#   ABSENT             our group is not there -> it is APPENDED by text splice. Every foreign
#                      group comes through byte-for-byte, and appending (rather than inserting)
#                      leaves a neighbour's index — and therefore their trust receipt — alone.
#   CREATE             no file at all -> this unit writes the whole document, description and all.
#                      A description is OURS only on a file we created; into a shared file this
#                      unit adds no prose, because that member belongs to whoever made it.
#   DRIFTED/DUPLICATED our group is there and edited, or there twice -> zero-write REFUSAL by
#                      name. Republishing would throw away an edit nobody can read back, and
#                      duplication is a birth hook the vendor would run twice.
#
# Every splice is re-parsed and deep-compared to the value it intended before it reaches a file
# (`certifySplice`), so a span edit that lands anywhere else is a refusal, not a written file.
HOOKS_DESCRIPTION="entwurf codex-birth $UNIT_VERSION — mints one garden meta-record per top-level Codex thread on its first turn. Managed by scripts/codex-birth-install.sh; inverse: scripts/codex-birth-uninstall.sh. This unit owns ONLY this SessionStart declaration; any other group in this file is foreign and is never read as ours. The vendor's trust decision for this declaration lives in config.toml and is the operator's alone."
DECISION="$("$NODE_BIN" -e '
  const fs = require("node:fs");
  const [, lib, hooksFile, launcher, description, outTmp] = process.argv;
  import(lib).then((m) => {
    const group = m.entwurfDeclarationGroup(launcher);
    const digest = m.declarationDigest(group);
    const emit = (verdict, detail) => process.stdout.write([verdict, digest, detail ?? ""].join("\t"));
    if (!fs.existsSync(hooksFile)) {
      fs.writeFileSync(outTmp, JSON.stringify({ description, hooks: { SessionStart: [group] } }, null, 2) + "\n");
      return emit("CREATE", "");
    }
    const text = fs.readFileSync(hooksFile, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(hooksFile + " is not readable JSON (" + err.message + "). This unit edits only its own declaration inside that file and will not rewrite a document it cannot read.");
    }
    const sel = m.selectEntwurfDeclaration(parsed, launcher);
    if (sel.ok) {
      if (sel.digest !== digest) {
        throw new Error(
          "entwurf\u2019s own declaration in " + hooksFile + " was EDITED after install (group " + sel.groupIndex +
            ": live " + sel.digest + ", this unit publishes " + digest + "). Republishing would throw away an edit this unit cannot read back. If the edit was yours, keep it and stop using this unit; otherwise run the inverse first.",
        );
      }
      return emit("UNCHANGED", String(sel.foreign.length));
    }
    if (sel.code !== "declaration-absent") throw new Error(sel.code + ": " + sel.detail);
    const want = JSON.parse(text);
    if (want.hooks === null || typeof want.hooks !== "object" || Array.isArray(want.hooks)) {
      throw new Error(hooksFile + " carries no `hooks` object, so there is nowhere to declare a SessionStart group without rewriting somebody else\u2019s grammar.");
    }
    want.hooks.SessionStart = (Array.isArray(want.hooks.SessionStart) ? want.hooks.SessionStart : []).concat([group]);
    fs.writeFileSync(outTmp, m.certifySplice(m.appendSessionStartGroup(m.ensureSessionStartArray(text), group), want));
    return emit("APPEND", String(sel.foreign.length));
  }).catch((err) => {
    process.stderr.write(err && err.message ? err.message : String(err));
    process.exit(1);
  });
' "$DECLARATION_LIB" "$HOOKS_FILE" "$LAUNCHER" "$HOOKS_DESCRIPTION" "$HOOKS_TMP" 2>&1)" || die "$DECISION
Refusing; nothing written."
HOOKS_ACTION="$(printf '%s' "$DECISION" | cut -f1)"
DECL_SHA="$(printf '%s' "$DECISION" | cut -f2)"
FOREIGN_COUNT="$(printf '%s' "$DECISION" | cut -f3)"
case "$DECL_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
  *) die "the declaration leaf returned no digest (got '$DECISION'). Nothing written." ;;
esac
[ -f "$HOOKS_TMP" ] && chmod 0644 -- "$HOOKS_TMP"

# Prove the staged bytes carry EXACTLY our declaration before they are published: a broken or
# absorbed hooks.json is a hook nobody declared and nobody can see failing. The same leaf reads
# it back, so what is asserted here is what the doctor and the preflight will assert later.
if [ "$HOOKS_ACTION" != "UNCHANGED" ]; then
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const [, lib, staged, launcher, wantDigest] = process.argv;
    import(lib).then((m) => {
      const sel = m.selectEntwurfDeclaration(JSON.parse(fs.readFileSync(staged, "utf8")), launcher);
      if (!sel.ok) throw new Error("the staged document does not carry our declaration: " + sel.code + " " + sel.detail);
      if (sel.digest !== wantDigest) throw new Error("the staged declaration digest is " + sel.digest + ", not " + wantDigest);
    }).catch((err) => {
      process.stderr.write(err && err.message ? err.message : String(err));
      process.exit(1);
    });
  ' "$DECLARATION_LIB" "$HOOKS_TMP" "$LAUNCHER" "$DECL_SHA" || die "the staged hooks.json is not the exact declaration this unit publishes. Nothing written."
fi
write_state() { # $1 = status
  # Created here only when absent — the safe umask floors it and the explicit mode removes any
  # doubt. An EXISTING root was judged above and is left exactly as it was found.
  if [ ! -e "$UNIT_ROOT" ]; then mkdir -p -- "$UNIT_ROOT" && chmod 0755 -- "$UNIT_ROOT"; fi
  cat > "$STATE_TMP" <<STATE
{
  "schema": "codex-birth-install-state/v2",
  "status": "$1",
  "unitVersion": "$UNIT_VERSION",
  "writtenAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "nodeBin": "$NODE_BIN",
  "hooksFile": "$HOOKS_FILE",
  "declaration": { "event": "SessionStart", "command": "'$LAUNCHER'", "sha256": "$DECL_SHA" },
  "hooksExistedBefore": $HOOKS_EXISTED,
  "helperDir": "$HELPER_DIR",
  "helperFiles": [
    { "path": "$LAUNCHER_NAME", "sha256": "$LAUNCHER_SHA", "mode": "0755" },
    { "path": "$PAYLOAD_NAME", "sha256": "$PAYLOAD_SHA", "mode": "0644" },
    { "path": "lib/meta-session.ts", "sha256": "$LIB_SHA", "mode": "0644" },
    { "path": "lib/native-push/codex-ws-client.ts", "sha256": "$CODEX_CLIENT_SHA", "mode": "0644" },
    { "path": "lib/session-id.js", "sha256": "$SESSION_ID_SHA", "mode": "0644" },
    { "path": "entwurf-capabilities.json", "sha256": "$REGISTRY_SHA", "mode": "0644" }
  ]
}
STATE
  chmod 0644 -- "$STATE_TMP"
  cp -- "$STATE_TMP" "$STATE_TMP.pub"
  mv -f -- "$STATE_TMP.pub" "$STATE_FILE"
}

HOOKS_EXISTED=false
[ -f "$HOOKS_FILE" ] && HOOKS_EXISTED=true

# ── publish — state first, closure second, declaration last ─────────────────
# ORDER IS LOAD-BEARING twice over. The state goes first so a crash anywhere below still
# leaves removal authority for whatever reached disk. The launcher goes before hooks.json
# because the declaration NAMES it: the reverse order leaves a window where every new Codex
# session runs a hook command that is not there.
write_state publishing

# Exact modes for what we create, never a repair of what we found (see the umask note at the
# top and the parent-authority check above).
for dir in "$HELPER_DIR" "$HELPER_DIR/lib" "$HELPER_DIR/lib/native-push"; do
  if [ ! -e "$dir" ]; then mkdir -p -- "$dir" && chmod 0755 -- "$dir"; fi
done
cp -- "$STAGE/$LAUNCHER_NAME" "$HELPER_DIR/$LAUNCHER_NAME.tmp" && mv -f -- "$HELPER_DIR/$LAUNCHER_NAME.tmp" "$LAUNCHER"
cp -- "$STAGE/$PAYLOAD_NAME" "$HELPER_DIR/$PAYLOAD_NAME"
cp -- "$STAGE/lib/meta-session.ts" "$HELPER_DIR/lib/meta-session.ts"
cp -- "$STAGE/lib/native-push/codex-ws-client.ts" "$HELPER_DIR/lib/native-push/codex-ws-client.ts"
cp -- "$STAGE/lib/session-id.js" "$HELPER_DIR/lib/session-id.js"
cp -- "$STAGE/entwurf-capabilities.json" "$HELPER_DIR/entwurf-capabilities.json"
chmod 0755 -- "$LAUNCHER"
chmod 0644 -- "$HELPER_DIR/$PAYLOAD_NAME" "$HELPER_DIR/lib/meta-session.ts" "$HELPER_DIR/lib/native-push/codex-ws-client.ts" "$HELPER_DIR/lib/session-id.js" "$HELPER_DIR/entwurf-capabilities.json"

if [ ! -e "$CODEX_HOME" ]; then mkdir -p -- "$CODEX_HOME" && chmod 0755 -- "$CODEX_HOME"; fi
# Strongest idempotence is an UNTOUCHED file, and on a shared hooks.json that is also the only
# honest one: re-serializing a document to reproduce bytes we already agree with would rewrite
# every neighbouring declaration for no reason at all.
case "$HOOKS_ACTION" in
  UNCHANGED)
    note "hooks.json already carries entwurf's declaration (normalized sha256 $DECL_SHA) — NOT REWRITTEN, not one byte"
    ;;
  APPEND)
    # The file was somebody else's before this line and is shared after it, so its MODE is
    # carried over from what we found rather than reset to the one a fresh publish would use.
    chmod "$(stat -c %a -- "$HOOKS_FILE")" -- "$HOOKS_TMP"
    cp -- "$HOOKS_TMP" "$HOOKS_FILE.tmp" && mv -f -- "$HOOKS_FILE.tmp" "$HOOKS_FILE"
    note "appended entwurf's declaration to the existing hooks.json by text splice — every foreign group came through byte-for-byte"
    ;;
  CREATE)
    cp -- "$HOOKS_TMP" "$HOOKS_FILE.tmp" && mv -f -- "$HOOKS_FILE.tmp" "$HOOKS_FILE"
    ;;
  *)
    die "unknown declaration decision '$HOOKS_ACTION'. Nothing more written."
    ;;
esac

write_state installed

note "installed"
note "  declaration : $HOOKS_FILE (normalized sha256 $DECL_SHA)"
case "$FOREIGN_COUNT" in
  ""|0) note "  neighbours  : none — entwurf is the only SessionStart declaration in that file" ;;
  *) note "  neighbours  : $FOREIGN_COUNT foreign SessionStart group(s) in that file, neither certified nor touched" ;;
esac
note "  launcher    : $LAUNCHER"
note "  state       : $STATE_FILE"
note "The vendor will ask the operator to trust this declaration ONCE, in the Codex TUI."
note "This unit does not answer that prompt and records nothing about it."
