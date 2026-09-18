#!/usr/bin/env bash
# codex-birth-uninstall — the inverse of codex-birth-install.sh.
#
# WHAT IT REMOVES FROM hooks.json, AND WHAT IT LEAVES (#117). Not the file: ONE `SessionStart`
# group, the one whose handler commands our launcher, taken out by TEXT SPLICE so every
# neighbouring declaration comes out byte-for-byte identical. The file itself is removed only
# when our group was the only group in it and no other event is declared — the case where
# removing our declaration leaves a document with nothing in it but our own prose. A top-level
# `description` is removed only when it is entwurf's own; anybody else's is a foreign byte.
#
# The ownership state is the ONLY input for the CLOSURE. Every removal there is licensed
# per-byte by a digest it recorded, so this inverse can say three different things about every
# path it published and never guesses at a fourth:
#
#   * already absent        -> done, not drift.
#   * bytes match the state -> removed.
#   * bytes DRIFTED         -> refuse THAT path, name it, leave it, exit non-zero. Somebody
#                              edited it, and deleting an edit nobody can read back is worse
#                              than leaving a file behind.
#
# The DECLARATION is licensed the same way but by its NORMALIZED digest rather than by file
# bytes, because a neighbour re-serializing the document (measured: Herdr does) changes every
# byte of that file and nothing about what entwurf declared.
#
# It never reads or writes config.toml, so the vendor's `[hooks.state]` trust record survives
# this inverse untouched. Removing the declaration does not un-trust it; re-publishing the
# SAME declaration later reuses the operator's original approval, because the trust identity
# is the declaration, not the file's history.
set -euo pipefail

die() { printf '[codex-birth-uninstall] %s\n' "$1" >&2; exit 1; }
note() { printf '[codex-birth-uninstall] %s\n' "$1"; }

for arg in "$@"; do
  case "$arg" in
    *) die "unknown argument '$arg' — this inverse takes no options; the ownership state is its only input." ;;
  esac
done

[ "$(uname -s)" = "Linux" ] || die "Linux only, like the installer."
[ "$(id -u)" != "0" ] || die "refusing to run as root: every path this inverse removes belongs to the operator, and root would remove them under the wrong authority."

PACKAGE_STATE_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/entwurf"
UNIT_ROOT="$PACKAGE_STATE_ROOT/codex-birth"
STATE_FILE="$UNIT_ROOT/install-state.json"
ME="$(id -u)"

# The state names absolute paths and this inverse deletes what it names, so a relative unit
# root would point the removal at whatever the caller's cwd happens to be.
case "$UNIT_ROOT" in /*) : ;; *) die "the unit root resolves to a relative path ('$UNIT_ROOT') — set an absolute XDG_DATA_HOME or HOME. Nothing removed." ;; esac

command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required (removal is licensed per-byte by digest) and is not on PATH."
NODE_BIN="$(command -v node)" || die "node is not on PATH — it parses the ownership state."
sha_of() { sha256sum -- "$1" | cut -d' ' -f1; }

REPO="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DECLARATION_LIB="$REPO/pi-extensions/lib/codex-declaration.js"

# One shared ownership predicate for the file this unit SHARES — see the installer's copy of this
# comment for why four surfaces had to stop deciding it three different ways.
owned_path_verdict() { # $1 = path, $2 = file|directory
  "$NODE_BIN" -e '
    import(process.argv[1]).then((m) => {
      const fs = require("node:fs");
      process.stdout.write(m.classifyOwnedPath(m.statOwnedPath(fs, process.argv[2]), process.getuid(), { kind: process.argv[3] }));
    }).catch((err) => { process.stderr.write(String(err && err.message ? err.message : err)); process.exit(1); });
  ' "$DECLARATION_LIB" "$1" "${2:-file}"
}
[ -f "$DECLARATION_LIB" ] || die "the declaration leaf is missing: $DECLARATION_LIB — without it this inverse cannot tell entwurf's declaration from a neighbour's. Nothing removed."

# Judged BEFORE anything is removed: a state sitting in a directory somebody else can write
# is a removal licence somebody else can forge.
safe_parent() { # $1 = dir, $2 = label
  [ -e "$1" ] || return 0
  [ -L "$1" ] && die "$2 ($1) is a SYMLINK — refusing to take removal authority through a link. Nothing removed."
  [ -d "$1" ] || die "$2 ($1) is not a directory. Nothing removed."
  local st mode uid
  st="$(stat -c '%a %u' -- "$1")"; mode="$(printf '%s' "$st" | cut -d' ' -f1)"; uid="$(printf '%s' "$st" | cut -d' ' -f2)"
  [ "$uid" = "$ME" ] || die "$2 ($1) is owned by uid $uid, not you ($ME) — it holds the state that licenses these removals. Nothing removed."
  [ $((8#$mode & 0022)) -eq 0 ] || die "$2 ($1) is group/world-writable (mode $mode), so the state inside it cannot authorize deleting anything. Nothing removed."
}
safe_parent "$PACKAGE_STATE_ROOT" "the package state root"
safe_parent "$UNIT_ROOT" "the unit root"

[ -e "$STATE_FILE" ] || [ -L "$STATE_FILE" ] || die "no ownership state at $STATE_FILE, so nothing on this host is provably ours.
This inverse removes only what that state vouches for. If you believe a declaration is left
over, inspect it and remove it deliberately."
[ -L "$STATE_FILE" ] && die "$STATE_FILE is a symlink — refusing to take removal authority from a link. Nothing removed."
[ -f "$STATE_FILE" ] || die "$STATE_FILE is not a regular file. Nothing removed."
STATE_ST="$(stat -c '%a %u' -- "$STATE_FILE")"
STATE_MODE="$(printf '%s' "$STATE_ST" | cut -d' ' -f1)"
STATE_UID="$(printf '%s' "$STATE_ST" | cut -d' ' -f2)"
[ "$STATE_UID" = "$ME" ] || die "$STATE_FILE is owned by uid $STATE_UID, not you ($ME) — it authorizes removals, so a foreign owner means someone else chose what this deletes. Nothing removed."
[ $((8#$STATE_MODE & 0022)) -eq 0 ] || die "$STATE_FILE is group/world-writable (mode $STATE_MODE), so it cannot authorize deleting anything. Nothing removed."

PLAN="$("$NODE_BIN" -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const hex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
  if (s.schema !== "codex-birth-install-state/v2") {
    throw new Error(
      "the ownership state is " + JSON.stringify(s.schema) + ". This inverse reads codex-birth-install-state/v2, " +
        "which certifies entwurf\u2019s own declaration; v1 claimed the WHOLE hooks.json and removing on its word " +
        "would delete a neighbour\u2019s. Run `entwurf install-codex-birth` once to supersede the receipt, then this inverse.",
    );
  }
  if (s.status !== "installed" && s.status !== "publishing") throw new Error("unknown status " + JSON.stringify(s.status));
  if (typeof s.hooksFile !== "string" || !s.hooksFile.startsWith("/")) throw new Error("hooksFile is not an absolute path");
  if (typeof s.helperDir !== "string" || !s.helperDir.startsWith("/")) throw new Error("helperDir is not an absolute path");
  const decl = s.declaration;
  if (decl === null || typeof decl !== "object" || Array.isArray(decl)) throw new Error("the state records no declaration receipt");
  if (decl.event !== "SessionStart") throw new Error("the recorded declaration event is " + JSON.stringify(decl.event));
  if (typeof decl.command !== "string" || decl.command.length === 0) throw new Error("the recorded declaration command is not a string");
  if (!hex(decl.sha256)) throw new Error("the recorded declaration digest is not a sha256 hex digest");
  if (!Array.isArray(s.helperFiles) || s.helperFiles.length === 0) throw new Error("helperFiles is empty");
  // Exactly the closure this unit publishes. Removing on a SHORT inventory would leave a file
  // behind and then delete the directory that held it; a LONG one would license deleting
  // something this unit never wrote.
  const expected = [
    "codex-birth-launch.sh",
    "meta-bridge-hook-codex.ts",
    "lib/meta-session.ts",
    "lib/native-push/codex-ws-client.ts",
    "lib/session-id.js",
    "entwurf-capabilities.json",
  ];
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
  // WHO CREATED THE FILE is a removal authority, and the receipt has always recorded it — the
  // inverse simply never read it (sol B2, 2026-09-18). Anything other than an explicit `false`
  // reads as "it was already there", which is the safe direction: an old receipt that predates
  // this field licenses a splice, never a delete.
  const createdByUs = s.hooksExistedBefore === false;
  const lines = [
    ["STATUS", s.status, s.unitVersion ?? ""].join("\t"),
    ["DECLCMD", "-", decl.command].join("\t"),
    ["HOOKSCREATED", "-", createdByUs ? "yes" : "no"].join("\t"),
    ["DECLARATION", decl.sha256, s.hooksFile].join("\t"),
  ];
  const seen = new Set();
  for (const f of s.helperFiles) {
    if (typeof f?.path !== "string" || f.path.length === 0 || f.path.startsWith("/") || f.path.split("/").includes("..")) {
      throw new Error("unsafe helper path " + JSON.stringify(f?.path));
    }
    if (!hex(f.sha256)) throw new Error("bad helper digest for " + f.path);
    if (seen.has(f.path)) throw new Error("duplicate helper path " + f.path);
    seen.add(f.path);
    lines.push(["HELPER", f.sha256, path.join(s.helperDir, f.path)].join("\t"));
  }
  lines.push(["HELPERDIR", "-", s.helperDir].join("\t"));
  process.stdout.write(lines.join("\n") + "\n");
' "$STATE_FILE" 2>&1)" || die "the ownership state is malformed, so what to remove is UNKNOWN: $PLAN
Inspect it and remove the unit deliberately. Nothing removed."

DRIFTED=0

# The declaration is not a file this inverse deletes — it is ONE GROUP inside a file it shares.
# Four verdicts, and only two of them touch a byte: already absent (done, not drift), drifted
# (named, left exactly as found), sole-owner (the file was ours whole, so the file goes), and
# shared (our group is spliced out and every neighbouring group comes through byte-for-byte).
REMOVE_DECLARATION() { # $1 = recorded normalized digest, $2 = hooks.json path
  local want="$1" target="$2" verdict kind detail tmp owned
  # THE SAME PREDICATE THE INSTALLER AND THE DOCTOR USE (sol B3, 2026-09-18). This inverse used to
  # ask only symlink-and-regular, so it would happily rewrite a hooks.json owned by another user or
  # writable by a group — a file whose next state nothing here can bind. Every non-`ok` verdict is
  # DRIFT: named, counted, and zero-write.
  owned="$(owned_path_verdict "$target" file)" || {
    printf '[codex-birth-uninstall] DRIFT: %s could not be judged for ownership (%s) — leaving it exactly as found.\n' "$target" "$owned" >&2
    DRIFTED=$((DRIFTED + 1)); return
  }
  if [ "$owned" = "missing" ]; then
    note "already absent: $target"; return
  fi
  if [ "$owned" != "ok" ]; then
    printf '[codex-birth-uninstall] DRIFT: the declaration file %s (%s) — refusing to edit it.\n' "$owned" "$target" >&2
    DRIFTED=$((DRIFTED + 1)); return
  fi
  tmp="$(mktemp)"
  verdict="$("$NODE_BIN" -e '
    const fs = require("node:fs");
    const [, lib, hooksFile, launcherCommand, wantDigest, outTmp, createdByUs] = process.argv;
    import(lib).then((m) => {
      const text = fs.readFileSync(hooksFile, "utf8");
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return process.stdout.write("DRIFT\t" + hooksFile + " is not readable JSON (" + err.message + ") — this inverse edits only its own group and will not rewrite a document it cannot read");
      }
      // The launcher the RECEIPT names, not one rebuilt from paths: the receipt is the authority.
      const launcher = launcherCommand.replace(/^\x27|\x27$/g, "");
      const sel = m.selectEntwurfDeclaration(parsed, launcher);
      if (!sel.ok) {
        if (sel.code === "declaration-absent") return process.stdout.write("ABSENT\t");
        return process.stdout.write("DRIFT\t" + sel.code + ": " + sel.detail);
      }
      if (sel.digest !== wantDigest) {
        return process.stdout.write(
          "DRIFT\tentwurf\u2019s declaration was edited after install (group " + sel.groupIndex + ": live " + sel.digest + ", recorded " + wantDigest + ")",
        );
      }
      // FILE — deleting the whole file — is the ONE verdict that can destroy a byte nobody here
      // wrote, so it takes three proofs and not one (sol B2, 2026-09-18). "Our group is the last
      // declaration" was the only one it used to take, and that is true of a file we merely
      // APPENDED to: `{"description":"foreign","hooks":{"SessionStart":[]}}` has no foreign GROUP,
      // so after our install the old shape classified it FILE and deleted top-level bytes
      // belonging to a neighbour.
      //   1. the receipt says this unit created the file (hooksExistedBefore === false),
      //   2. nothing but our own two top-level keys is in it, and the description is OURS,
      //   3. our group is the only declaration, under the only event.
      // Anything else SPLICES: our group comes out, every other byte stays.
      const events = Object.keys(parsed.hooks);
      const topLevel = Object.keys(parsed).sort().join(",");
      const ourDescription =
        typeof parsed.description === "string" && parsed.description.startsWith(m.CODEX_BIRTH_DESCRIPTION_PREFIX);
      const soleDeclaration = sel.foreign.length === 0 && events.length === 1 && events[0] === m.CODEX_BIRTH_EVENT;
      if (createdByUs === "yes" && soleDeclaration && topLevel === "description,hooks" && ourDescription) {
        return process.stdout.write("FILE\t");
      }
      const want = JSON.parse(text);
      want.hooks[m.CODEX_BIRTH_EVENT].splice(sel.groupIndex, 1);
      const description = want.description;
      let spliced = m.certifySplice(m.removeSessionStartGroup(text, sel.groupIndex), want);
      if (typeof description === "string" && description.startsWith(m.CODEX_BIRTH_DESCRIPTION_PREFIX)) {
        delete want.description;
        spliced = m.certifySplice(m.removeEntwurfDescription(spliced), want);
      }
      fs.writeFileSync(outTmp, spliced);
      process.stdout.write("SPLICE\t" + String(sel.foreign.length));
    }).catch((err) => {
      process.stderr.write(err && err.message ? err.message : String(err));
      process.exit(1);
    });
  ' "$DECLARATION_LIB" "$target" "$DECLARATION_COMMAND" "$want" "$tmp" "$HOOKS_CREATED_BY_US" 2>&1)" || {
    rm -f -- "$tmp"
    printf '[codex-birth-uninstall] DRIFT: the declaration could not be judged (%s) — leaving %s exactly as found.\n' "$verdict" "$target" >&2
    DRIFTED=$((DRIFTED + 1)); return
  }
  kind="$(printf '%s' "$verdict" | cut -f1)"
  detail="$(printf '%s' "$verdict" | cut -f2-)"
  case "$kind" in
    ABSENT) rm -f -- "$tmp"; note "already absent: entwurf declares nothing in $target" ;;
    DRIFT)
      rm -f -- "$tmp"
      printf '[codex-birth-uninstall] DRIFT: %s — LEFT IN PLACE (%s).\n' "$detail" "$target" >&2
      DRIFTED=$((DRIFTED + 1))
      ;;
    FILE) rm -f -- "$tmp" "$target"; note "removed $target (entwurf was its only declaration)" ;;
    SPLICE)
      # The file survives this inverse, so its MODE is one more thing that is not ours to
      # change: it is carried over from what we found rather than reset to what we publish.
      chmod "$(stat -c %a -- "$target")" -- "$tmp"
      cp -- "$tmp" "$target.tmp" && mv -f -- "$target.tmp" "$target"
      rm -f -- "$tmp"
      note "removed entwurf's declaration from $target by text splice — $detail foreign group(s) preserved byte-for-byte"
      ;;
    *) rm -f -- "$tmp"; die "the declaration reader returned '$verdict'. Nothing else removed." ;;
  esac
}

REMOVE_ONE() { # $1 = recorded digest, $2 = absolute path, $3 = label
  local want="$1" target="$2" label="$3" live
  if [ -L "$target" ]; then
    printf '[codex-birth-uninstall] DRIFT: %s is a SYMLINK now (%s) — refusing to remove through a link.\n' "$label" "$target" >&2
    DRIFTED=$((DRIFTED + 1)); return
  fi
  if [ ! -e "$target" ]; then
    note "already absent: $target"; return
  fi
  if [ ! -f "$target" ]; then
    printf '[codex-birth-uninstall] DRIFT: %s is no longer a regular file (%s) — leaving it.\n' "$label" "$target" >&2
    DRIFTED=$((DRIFTED + 1)); return
  fi
  live="$(sha_of "$target")"
  if [ "$live" != "$want" ]; then
    printf '[codex-birth-uninstall] DRIFT: %s was edited after install (%s: live %s, recorded %s) — LEFT IN PLACE.\n' "$label" "$target" "$live" "$want" >&2
    DRIFTED=$((DRIFTED + 1)); return
  fi
  rm -f -- "$target"
  note "removed $target"
}

HELPER_DIR=""
DECLARATION_COMMAND=""
HOOKS_CREATED_BY_US="no"
while IFS="$(printf '\t')" read -r kind digest target; do
  case "$kind" in
    STATUS) note "state: status=$digest unitVersion=$target" ;;
    DECLCMD) DECLARATION_COMMAND="$target" ;;
    HOOKSCREATED) HOOKS_CREATED_BY_US="$target" ;;
    DECLARATION) REMOVE_DECLARATION "$digest" "$target" ;;
    HELPER) REMOVE_ONE "$digest" "$target" "helper member" ;;
    HELPERDIR) HELPER_DIR="$target" ;;
  esac
done <<EOF
$PLAN
EOF

# Directories are removed only when EMPTY: a leftover file in there is either drift we just
# refused or something else's, and rmdir failing is the honest answer to both.
if [ -n "$HELPER_DIR" ] && [ -d "$HELPER_DIR" ] && [ ! -L "$HELPER_DIR" ]; then
  rmdir -- "$HELPER_DIR/lib/native-push" 2>/dev/null || true
  rmdir -- "$HELPER_DIR/lib" 2>/dev/null || true
  if rmdir -- "$HELPER_DIR" 2>/dev/null; then note "removed $HELPER_DIR"; else note "kept $HELPER_DIR (not empty)"; fi
fi

if [ "$DRIFTED" -ne 0 ]; then
  die "$DRIFTED path(s) DRIFTED and were left in place; the ownership state is KEPT so a later run can still license them. Nothing else to do automatically."
fi

rm -f -- "$STATE_FILE"
note "removed $STATE_FILE"
rmdir -- "$UNIT_ROOT" 2>/dev/null || true
note "uninstalled. config.toml was neither read nor written, so the vendor's own hook-trust record is untouched."
