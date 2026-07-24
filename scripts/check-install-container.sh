#!/usr/bin/env bash
# check-install-container — the Linux artifact-CONSUMER gate (#51 gate C).
#
# WHY THIS EXISTS. Every verification surface in this repo runs on one host: the
# maintainer's, with the checkout present, every tree operator-owned, and the
# package installed project-locally. `check-pack-install` is the strongest of
# them and it still only ever proves THAT shape. This gate reproduces a clean
# Linux consumer instead: one candidate tarball, handed read-only to a container
# that has never seen this repository. Default mode packs once into a temp dir;
# release mode accepts `ENTWURF_CANDIDATE_TGZ=/preserved/candidate.tgz` and consumes
# those exact bytes without copying, chmodding, or re-packing them.
#
# WHAT IT ADDS OVER check-pack-install (the delta is the whole justification):
#   - `npm install -g` into an isolated prefix + resolution through the PATH shim
#     (the host gate only ever installs project-locally and calls bins by absolute path)
#   - a package directory that is READ-ONLY to the process consuming it
#   - structural invisibility of the checkout and of the repo's node_modules —
#     the repo is not mounted at all, which is stronger than declaring NODE_PATH=''
#   - a package cache thrown away with the container on every run
#   - the container's Node major bound to the ARTIFACT's own engines.node
#     (`FROM node:<major>-*` is a non-text carrier, explicitly outside
#     check-node-floor-coherence's sweep — it says so itself — so C binds it)
#   - DELIVERY through the globally installed PATH shim (0.12.8). The doctor's
#     delivery self-diagnostic spawns the live `mcpServers.entwurf-bridge` command,
#     and on this host that value is the bare `entwurf-bridge` bin — resolved through
#     PATH, from a read-only package, with no checkout anywhere. That is the reported
#     consumer shape (`npm install -g` + shim); check-pack-install can only ever drive
#     a project-local bin by absolute path. So this cell is the one that answers
#     "would the shipped registry corpse have died HERE" for the real install form.
#
# WHAT IT DOES NOT PROVE. It does not certify Claude's real hook spawn topology:
# the doctor fixture stands a synthetic owner up, and the plugin cache is PLANTED
# from the bundle this container assembles, because a fake CLI cannot materialize
# Claude's cache. Both are labelled as fixtures in the output. The host-shell
# matrix and the exec-form verdict are #51 gate 1 / B-B2, deliberately not here.
#
# In both modes the canonical artifact path + sha256 and container image identity are
# printed. Release publishes the SAME preserved file only after exact-mode acceptance.
#
# Docker absent -> honest SKIP. ENTWURF_REQUIRE_DOCKER=1 turns that SKIP into a
# failure, which is how required CI runs it: a lane nobody can prove is not a
# lane that silently passes.
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *) SOURCE="$DIR/$TARGET" ;;
  esac
done
HERE="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
REPO="$(cd -P -- "$HERE/.." && pwd)"

# Hard rule 10 — a dev-only gate has no compiled twin and no business running
# from an installed package. The tarball ships `scripts/` whole, so without this
# an operator's installed copy would happily re-pack itself and call the result a
# consumer proof. REFUSE legibly instead, in the same words run_ts uses.
case "$REPO" in
  */node_modules/*)
    echo "entwurf: 'check-install-container' is a dev-clone-only surface — the installed package ships no consumer harness." >&2
    echo "         (it packs the repo it lives in; from under node_modules that would only re-pack the installed copy.)" >&2
    exit 1
    ;;
esac

# ── Docker preflight ─────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  if [ "${ENTWURF_REQUIRE_DOCKER:-0}" = 1 ]; then
    echo "[check-install-container] FAIL — ENTWURF_REQUIRE_DOCKER=1 but no usable Docker daemon on this host." >&2
    echo "[check-install-container] The Linux artifact-consumer lane is REQUIRED here; an unprovable lane is not a passing lane." >&2
    exit 1
  fi
  echo "[check-install-container] SKIP — no usable Docker daemon on this host."
  echo "[check-install-container] (required CI sets ENTWURF_REQUIRE_DOCKER=1, which makes this exact condition RED)"
  exit 0
fi

# ── candidate artifact: pack once OR consume a caller-preserved exact file ────
VERSION="$(node -p "require('$REPO/package.json').version")"
FLOOR_SPEC="$(node -p "require('$REPO/package.json').engines.node")"
FLOOR_MAJOR="${FLOOR_SPEC#>=}"; FLOOR_MAJOR="${FLOOR_MAJOR%%.*}"
case "$FLOOR_MAJOR" in
  ''|*[!0-9]*) echo "[check-install-container] FAIL — cannot derive a major from engines.node ('$FLOOR_SPEC')" >&2; exit 1 ;;
esac
# Same derivation as check-pack-install: scope `@` stripped, `/` becomes `-`.
TGZ_NAME="junghanacs-entwurf-${VERSION}.tgz"
IMAGE="node:${FLOOR_MAJOR}-bookworm"
PACK_TMP=""

if [ -n "${ENTWURF_CANDIDATE_TGZ:-}" ]; then
  # Release acceptance mode: the caller already packed and preserved the candidate.
  # Resolve it once and NEVER chmod/copy/re-pack it; the exact bytes accepted here are
  # the bytes `npm publish <same.tgz> --tag repair` must receive later.
  [ -f "$ENTWURF_CANDIDATE_TGZ" ] || { echo "[check-install-container] FAIL — ENTWURF_CANDIDATE_TGZ is not a regular file: $ENTWURF_CANDIDATE_TGZ" >&2; exit 1; }
  [ -r "$ENTWURF_CANDIDATE_TGZ" ] || { echo "[check-install-container] FAIL — ENTWURF_CANDIDATE_TGZ is not readable: $ENTWURF_CANDIDATE_TGZ" >&2; exit 1; }
  TGZ_PATH="$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$ENTWURF_CANDIDATE_TGZ")"
  CANDIDATE_MODE="caller-preserved exact artifact (no repack)"
else
  # Default local/CI mode remains self-contained: make one candidate in a temp dir,
  # consume it once, then delete it with the temp dir.
  PACK_TMP="$(mktemp -d -t entwurf-container-pack.XXXXXX)"
  trap 'rm -rf "$PACK_TMP"' EXIT
  TGZ_PATH="$PACK_TMP/$TGZ_NAME"
  CANDIDATE_MODE="pack-once temporary artifact"
  # with-dist-lock: same whole-pack serialization check-pack/check-pack-install use;
  # unserialized packs race the shared dist dir.
  (cd "$REPO" && bash scripts/with-dist-lock.sh npm pack --dry-run=false --pack-destination "$PACK_TMP" >/dev/null 2>&1) || {
    echo "[check-install-container] FAIL — npm pack failed" >&2; exit 1; }
  [ -f "$TGZ_PATH" ] || { echo "[check-install-container] FAIL — tarball not produced at $TGZ_PATH" >&2; exit 1; }
  # The container consumer is non-root and does not share this host's uid map, so
  # a generated candidate must be world-readable. Caller-preserved mode is never
  # mutated; its readability was checked above and Docker mounts it read-only.
  chmod 0444 "$TGZ_PATH"
fi

PERM="$(stat -c '%a' "$TGZ_PATH")"
DIGEST="$(sha256sum "$TGZ_PATH" | cut -d' ' -f1)"
META="$(tar -xOf "$TGZ_PATH" package/package.json | node -e '
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  const p = JSON.parse(s);
  process.stdout.write(`${p.name}\t${p.version}`);
});
')" || { echo "[check-install-container] FAIL — cannot read package/package.json from candidate $TGZ_PATH" >&2; exit 1; }
IFS=$'\t' read -r ARTIFACT_NAME ARTIFACT_VERSION <<< "$META"
[ "$ARTIFACT_NAME" = "@junghanacs/entwurf" ] || { echo "[check-install-container] FAIL — candidate package name is '$ARTIFACT_NAME', expected @junghanacs/entwurf" >&2; exit 1; }
[ "$ARTIFACT_VERSION" = "$VERSION" ] || { echo "[check-install-container] FAIL — candidate version $ARTIFACT_VERSION does not match checkout release version $VERSION" >&2; exit 1; }

echo "[check-install-container] candidate mode: $CANDIDATE_MODE"
echo "[check-install-container] candidate canonical-path=$TGZ_PATH"
echo "[check-install-container] candidate package=$ARTIFACT_NAME version=$ARTIFACT_VERSION engines.node=$FLOOR_SPEC image=$IMAGE"
echo "[check-install-container] artifact sha256=$DIGEST bytes=$(stat -c%s "$TGZ_PATH") mode=$PERM"

# Name the image by identity, not just by tag: a tag is a moving pointer, and a
# consumer proof that cannot say which image produced it is a weaker claim.
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE" >/dev/null 2>&1 || {
  echo "[check-install-container] FAIL — image $IMAGE is unavailable and could not be pulled" >&2; exit 1; }
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo unknown)"
IMAGE_DIGEST="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}<none>{{end}}' "$IMAGE" 2>/dev/null || echo '<none>')"
echo "[check-install-container] image $IMAGE id=$IMAGE_ID repoDigest=$IMAGE_DIGEST"

# ── the consumer cell ────────────────────────────────────────────────────────
# ONE cell, non-root end to end: the same unprivileged user installs globally
# into a writable isolated prefix, freezes the installed package, and then
# consumes it. No repo mount, no checkout, no node_modules, no host $HOME.
# The runner arrives on stdin, so the container depends on no repo file. Keep one
# outer shell as container PID 1 and run the consumer shell beneath it: that inner
# shell stands in for Claude during the owner fixture, and a real owner must be >1.
# Running the consumer itself as PID 1 would correctly trip the hook's reparented-
# orphan guard and make the synthetic join vacuously impossible.
# The frozen upgrade fixtures travel as DATA in an env var, not as a mount. They
# are host state — the meta-record store a machine already had before this cut —
# so they must reach the container without giving it a repo directory to see.
# Mounting fixtures/ would have weakened the structural-invisibility claim above
# for no gain; the tar carries its own sha256 manifest and the container verifies
# it on arrival, which is the property that actually matters.
FIXTURES_B64="$(cd "$REPO/fixtures" && tar -cz meta-store | base64 -w0)"

set +e
docker run --rm -i \
  --user node \
  --workdir /tmp \
  -e HOME=/home/node \
  -e NODE_PATH= \
  -e "EXPECTED_FLOOR_MAJOR=$FLOOR_MAJOR" \
  -e "FIXTURES_B64=$FIXTURES_B64" \
  -v "$TGZ_PATH:/artifact/$TGZ_NAME:ro" \
  "$IMAGE" \
  bash -c 'bash -s -- "$1"; rc=$?; exit "$rc"' _ "/artifact/$TGZ_NAME" <<'CONTAINER_RUNNER_EOF'
set -uo pipefail

TGZ="${1:?candidate tarball path required}"

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }
die() { echo "  FAIL  $*"; echo; echo "container-consumer: FAIL (see above)"; exit 1; }

echo "container consumer (uid=$(id -u) user=$(id -un 2>/dev/null || echo '?') runner-pid=$$)"

# ── 1. environment facts ─────────────────────────────────────────────────────
# These are recorded as FACTS about the consumer cell. None of them is claimed as
# detection power on its own; the detection claim is the differential at the end.
echo "[consumer environment]"
if [ "$(id -u)" -ne 0 ]; then ok "non-root consumer (uid=$(id -u))"; else bad "running as root — the non-root install/consume lane is not exercised"; fi
if [ "$$" -gt 1 ]; then ok "consumer/stand-in-Claude pid=$$ (>1; outer container init remains PID 1)"; else bad "consumer runner is PID 1 — the synthetic owner would be an impossible/reparented owner"; fi
ok "/bin/sh -> $(readlink -f /bin/sh) (environment fact; hook launch topology is out of scope here)"
if [ -z "${NODE_PATH:-}" ]; then ok "NODE_PATH empty"; else bad "NODE_PATH=$NODE_PATH leaked into the consumer"; fi

# Structural checkout invisibility, checked BEFORE the package is installed so
# the package's own shipped copies cannot be mistaken for a visible checkout.
CHECKOUT_HITS="$(find / -xdev \( -path /proc -o -path /sys \) -prune -o \
  -type f \( -name 'entwurf-control.ts' -o -name 'NEXT.md' -o -name 'pnpm-workspace.yaml' \) -print 2>/dev/null | head -5)"
if [ -z "$CHECKOUT_HITS" ]; then
  ok "no entwurf checkout anywhere on this filesystem (structural invisibility, stronger than a declared NODE_PATH)"
else
  bad "checkout-like files are visible to the consumer:"$'\n'"$(printf '%s\n' "$CHECKOUT_HITS" | sed 's/^/        /')"
fi

FOREIGN="$HOME/foreign-cwd"
mkdir -p "$FOREIGN" && cd "$FOREIGN"
CLIMB="$(d="$PWD"; while [ "$d" != "/" ]; do [ -e "$d/package.json" ] && echo "$d/package.json"; d="$(dirname "$d")"; done)"
if [ -z "$CLIMB" ]; then ok "foreign cwd $PWD has no package.json on the path to /"; else bad "cwd can climb to $CLIMB"; fi

[ -r "$TGZ" ] || die "candidate artifact not readable at $TGZ"
if ( : > "$TGZ" ) 2>/dev/null; then bad "candidate artifact is WRITABLE — it must be mounted read-only"; else ok "candidate artifact is read-only to the consumer"; fi

# ── 2. non-root global install into a writable isolated prefix ───────────────
# This is the lane the host gate never takes: it only ever installs
# project-locally, so nothing there proves the global layout or the PATH shim.
echo "[global install (non-root, isolated prefix)]"
export npm_config_prefix="$HOME/.npm-global"
export npm_config_cache="$HOME/.npm-cache"
export npm_config_update_notifier=false
mkdir -p "$npm_config_prefix" "$npm_config_cache"
export PATH="$npm_config_prefix/bin:$PATH"

if ! INSTALL_LOG="$(npm install -g "$TGZ" --no-audit --no-fund 2>&1)"; then
  echo "$INSTALL_LOG" | tail -20 | sed 's/^/        /'
  die "npm install -g of the candidate artifact FAILED as a non-root user"
fi
ok "non-root 'npm install -g' succeeded into the writable isolated prefix $npm_config_prefix"

PKG="$npm_config_prefix/lib/node_modules/@junghanacs/entwurf"
[ -d "$PKG" ] || die "installed package not at $PKG"

# ── 3. the five bins, resolved THROUGH the global PATH shim ──────────────────
echo "[global bins via PATH shim]"
for b in entwurf entwurf-bridge entwurf-statusline entwurf-agy-statusline entwurf-agy-imprint; do
  RESOLVED="$(command -v "$b" || true)"
  if [ -z "$RESOLVED" ]; then bad "bin '$b' is not on PATH after a global install"
  elif [ "$RESOLVED" != "$npm_config_prefix/bin/$b" ]; then bad "bin '$b' resolved to $RESOLVED, not the global shim $npm_config_prefix/bin/$b"
  elif [ ! -x "$RESOLVED" ]; then bad "bin '$b' is on PATH but not executable (postinstall-chmod did not run under a global install?)"
  else ok "$b -> $RESOLVED"; fi
done

# ── 4. runtime floor, derived from the ARTIFACT ──────────────────────────────
# check-node-floor-coherence's own output says a non-text carrier such as a
# container image tag is OUTSIDE its sweep and must be bound by its own gate.
# This is that binding — and it reads the floor from the INSTALLED package.json,
# not from a value the host passed in, so the artifact stays the SSOT.
echo "[runtime floor bound to the artifact]"
FLOOR_SPEC="$(node -p "require('$PKG/package.json').engines.node")"
FLOOR_MAJOR="${FLOOR_SPEC#>=}"; FLOOR_MAJOR="${FLOOR_MAJOR%%.*}"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
case "$FLOOR_MAJOR" in
  ''|*[!0-9]*) bad "could not derive a major from the artifact's engines.node ('$FLOOR_SPEC')" ;;
  *)
    if [ "$NODE_MAJOR" = "$FLOOR_MAJOR" ]; then
      ok "artifact engines.node='$FLOOR_SPEC' (major $FLOOR_MAJOR) == this image's node $(node -p 'process.versions.node') — the image tag is bound to the declared floor"
    else
      bad "this image runs node major $NODE_MAJOR but the artifact declares floor major $FLOOR_MAJOR ('$FLOOR_SPEC') — the container image tag drifted from the engines SSOT"
    fi
    # The host derived the image tag from the same SSOT; disagreement means the
    # two halves of this gate read different package.json files.
    if [ "$FLOOR_MAJOR" != "${EXPECTED_FLOOR_MAJOR:-$FLOOR_MAJOR}" ]; then
      bad "the artifact declares floor major $FLOOR_MAJOR but the host built this cell for ${EXPECTED_FLOOR_MAJOR:-?} — host and artifact disagree on the SSOT"
    fi
    ;;
esac

# ── 5. FREEZE the installed package, then prove the freeze with real writes ──
# A real consumer does not own the tree it runs: under `sudo npm i -g` the tree
# is root-owned, on an image layer or a read-only mount the filesystem refuses.
# The host gate structurally cannot reproduce that — its install tree is
# operator-owned, so a surface that writes beside itself succeeds there and ships.
#
# WHAT IS FROZEN, AND WHY EXACTLY THAT MUCH. Only the package ROOT directory
# loses `w`. That is the write-beside-the-package shape, and it is the one this
# cell can model honestly.
#
# Two stricter freezes were tried and both produced FALSE reds, because `cp -r`
# copies source modes to the destination and this installer assembles the plugin
# by copying its own shipped skeleton into the XDG data dir and then writing into
# the copy. `chmod -R a-w` made the assembled DIRECTORY 555, so the next `cp`
# into it failed; freezing regular files made the assembled `hooks.json` 444, so
# the installer's own bake step could not rewrite it. Neither is reachable by a
# real consumer: under `sudo npm i -g` the tree is root-owned but still 755/644,
# so the copy lands writable and owned by whoever ran the install. Modelling a
# world stricter than any consumer inhabits manufactures failures instead of
# finding them, and a gate that goes red for a reason nobody can hit trains
# people to ignore it.
#
# LIMIT, stated rather than papered over: this single non-root cell cannot make
# in-place modification of a shipped file EACCES — that needs a second uid, and
# the root-install phase was removed on purpose.
#
# The freeze and the byte-fence are NOT two independent detectors of the same
# defect, and claiming so would overstate both. The freeze is a permission-level
# CONSUMER FACT: it makes this cell resemble a host where the package cannot be
# written beside. The byte-fence (section 7) is the DETECTOR: it compares a
# regular-file path+sha256 manifest, so it sees a persistent regular file appear
# or change anywhere in the tree — including, on its own, the write the freeze
# blocks. What the freeze uniquely provides is the EACCES itself: a consumer that
# actually refuses the write, rather than a tree we merely inspect afterwards.
echo "[installed package frozen]"
chmod a-w "$PKG"
if ( : > "$PKG/.entwurf-write-probe" ) 2>/dev/null; then
  rm -f "$PKG/.entwurf-write-probe" 2>/dev/null || true
  bad "the installed package ROOT is still writable after freeze — the write-beside-the-package lane is not real, so the claims below are weaker than they look"
else
  ok "installed package root refuses new files ($PKG) — a surface that writes beside itself now EACCESes"
fi

# ── 6. installed MCP surface ─────────────────────────────────────────────────
echo "[installed MCP bridge]"
if BOOT_OUT="$(START_SH="$(command -v entwurf-bridge)" node --input-type=module <<'JS' 2>&1
import { spawn } from 'node:child_process';
const env = { ...process.env };
delete env.NODE_PATH;
const child = spawn(process.env.START_SH, { stdio: ['pipe', 'pipe', 'pipe'], env });
let out = '', err = '', done = false;
const timer = setTimeout(() => { child.kill('SIGKILL'); console.error('boot timeout' + (err.trim() ? ': ' + err.trim() : '')); process.exit(1); }, 15000);
function finish(t) {
  if (done) return; done = true; clearTimeout(timer);
  let msg; try { msg = JSON.parse(t); } catch { console.error('unparseable tools/list: ' + t.slice(0, 300)); process.exit(1); }
  const names = (msg?.result?.tools ?? []).map((x) => x?.name).sort();
  for (const need of ['entwurf_v2', 'entwurf_peers', 'entwurf_self', 'entwurf_inbox_read', 'entwurf_register_native'])
    if (!names.includes(need)) { console.error('missing MCP tool: ' + need + ' — got ' + names.join(',')); process.exit(1); }
  console.log(names.join(','));
  child.kill('SIGTERM'); process.exit(0);
}
child.stdout.on('data', (d) => { out += d; const t = out.trim(); if (t) finish(t); });
child.stderr.on('data', (d) => { err += d; });
child.on('error', (e) => { clearTimeout(timer); console.error('spawn error: ' + e); process.exit(1); });
child.on('close', () => { if (done) return; clearTimeout(timer); console.error('closed with empty tools/list' + (err.trim() ? ': ' + err.trim() : '')); process.exit(1); });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
JS
)"; then ok "installed entwurf-bridge answers tools/list: $BOOT_OUT"
else echo "$BOOT_OUT" | tail -10 | sed 's/^/        /'; bad "installed entwurf-bridge did NOT answer tools/list from a frozen global install"; fi

# ── 7. fake Claude + install-meta-bridge, under a byte-fence ─────────────────
echo "[fake-Claude install-meta-bridge]"
export CLAUDE_CONFIG_DIR="$HOME/.claude"
export PI_CODING_AGENT_DIR="$HOME/agent"
AGENT="$PI_CODING_AGENT_DIR"
mkdir -p "$CLAUDE_CONFIG_DIR" "$AGENT"
echo '{}' > "$CLAUDE_CONFIG_DIR/settings.json"
echo '{}' > "$HOME/.claude.json"

MKT_NAME="meta-bridge-local"; PLUGIN="entwurf-meta-receive"
PLANTED="$CLAUDE_CONFIG_DIR/plugins/cache/$MKT_NAME/$PLUGIN/0.1.0"

FAKEBIN="$HOME/fakebin"; mkdir -p "$FAKEBIN"
export FAKE_CLAUDE_LOG="$HOME/fake-claude.log"; : > "$FAKE_CLAUDE_LOG"
export FAKE_INSTALL_PATH="$PLANTED"
cat > "$FAKEBIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_CLAUDE_LOG"
case "$1${2:+ $2}${3:+ $3}" in
  "--version") echo "2.1.217 (Claude Code)" ;;
  "plugin list --json")
    printf '[{"id":"entwurf-meta-receive@meta-bridge-local","version":"0.1.0","enabled":true,"installPath":"%s"}]\n' "$FAKE_INSTALL_PATH" ;;
  "plugin list"*) printf '%s\n' "entwurf-meta-receive@meta-bridge-local" "  Status: enabled" ;;
  "mcp get"*) printf '%s\n' "Scope: User config" "Status: ✔ Connected" ;;
  "mcp add"*)
    # Real Claude persists user-scope MCP into ~/.claude.json, and the doctor's
    # delivery self-diagnostic SPAWNS whatever command it finds there. Swallowing
    # `mcp add` would leave this consumer with no live command and turn the delivery
    # axis into an absence report. Parse the installer's real argv shape
    # (`-s user <name> -e K=V ... -- <cmd> [args]`) and write what Claude writes —
    # here that is the bare `entwurf-bridge` PATH shim, which is exactly the shape a
    # globally installed consumer runs.
    shift 2
    python3 - "$@" <<'PY'
import json, os, sys
argv, env, name, cmd, i = sys.argv[1:], {}, None, [], 0
while i < len(argv):
    a = argv[i]
    if a == "-s":
        i += 2; continue
    if a == "-e":
        k, _, v = argv[i + 1].partition("="); env[k] = v; i += 2; continue
    if a == "--":
        cmd = argv[i + 1:]; break
    if name is None:
        name = a
    i += 1
p = os.path.join(os.path.expanduser("~"), ".claude.json")
try:
    d = json.load(open(p, encoding="utf-8"))
except Exception:
    d = {}
if not isinstance(d, dict):
    d = {}
d.setdefault("mcpServers", {})[name] = {
    "type": "stdio",
    "command": cmd[0] if cmd else "",
    "args": cmd[1:],
    "env": env,
}
json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
    ;;
  "mcp remove"*)
    python3 - "${3:-}" <<'PY'
import json, os, sys
p = os.path.join(os.path.expanduser("~"), ".claude.json")
try:
    d = json.load(open(p, encoding="utf-8"))
except Exception:
    sys.exit(0)
if isinstance(d, dict) and isinstance(d.get("mcpServers"), dict):
    d["mcpServers"].pop(sys.argv[1], None)
    json.dump(d, open(p, "w", encoding="utf-8"), indent=2)
PY
    ;;
  *) : ;;
esac
exit 0
SH
chmod +x "$FAKEBIN/claude"
export PATH="$FAKEBIN:$PATH"

# Fingerprint the installed tree BEFORE the install runs. mtime heuristics are
# not enough (npm's own extraction order skews them); this is the same byte-level
# before/after shape check-pack-install uses for its self-fence.
#
# SCOPE, precisely: a REGULAR-FILE path+sha256 manifest. It is NOT a whole-tree
# guarantee — it compares no permissions, no ownership, no symlink targets, and
# no directory entry that holds no regular file. Read a green as "no persistent
# regular file appeared, vanished or changed", never as "the tree is untouched".
PKG_BEFORE="$( (find "$PKG" -type f -print0 | sort -z | xargs -0r sha256sum) 2>/dev/null || true)"

if MB_LOG="$(entwurf install-meta-bridge 2>&1)"; then
  ok "installed 'entwurf install-meta-bridge' completed from a frozen package dir under a fake Claude CLI"
else
  echo "$MB_LOG" | tail -20 | sed 's/^/        /'
  die "installed 'entwurf install-meta-bridge' FAILED in the container"
fi

PKG_AFTER="$( (find "$PKG" -type f -print0 | sort -z | xargs -0r sha256sum) 2>/dev/null || true)"
if [ "$PKG_BEFORE" != "$PKG_AFTER" ]; then
  bad "install-meta-bridge changed the installed package's regular-file manifest — a surface writes beside itself:"$'\n'"$(diff <(printf '%s\n' "$PKG_BEFORE") <(printf '%s\n' "$PKG_AFTER") | sed 's/^/        /' | head -8)"
else
  ok "installed package regular-file path+sha256 manifest unchanged across install-meta-bridge (manifest only — not perms/ownership/symlinks)"
fi

ASM="$HOME/.local/share/entwurf/meta-bridge/.assembled"
[ -f "$ASM/$PLUGIN/meta-bridge-hook.js" ] || bad "assembled bundle has no compiled hook JS at $ASM/$PLUGIN/meta-bridge-hook.js"
[ -f "$ASM/$PLUGIN/meta-bridge-hook.ts" ] && bad "assembled bundle shipped a raw .ts hook — installed packages must run compiled JS"

# ── 7b. the upgrade host-state matrix ────────────────────────────────────────
# Everything above meets a machine with no meta-record store at all. That is the
# CLEAN host — the one state nobody doubted. A real fleet is not clean: an
# existing development machine already carries a store this cut cannot read, and
# until now no cell had ever handed the candidate artifact such a host.
#
# Each state below gets its own HOME, its own Claude config, its own agent dir
# and its own fake-Claude log, so a refusal's byte fence means "this host was not
# touched", not "the previous state's writes are still there".
echo "[upgrade host-state matrix]"
FIXROOT="$HOME/fixtures"
mkdir -p "$FIXROOT" "$HOME/logs"
printf '%s' "${FIXTURES_B64:?fixture payload missing}" | base64 -d | tar -xz -C "$FIXROOT"
if (cd "$FIXROOT/meta-store" && sha256sum -c MANIFEST.sha256 >/dev/null 2>&1); then
  ok "frozen upgrade fixtures arrived intact (sha256 manifest re-verified inside the container)"
else
  die "upgrade fixtures failed their own manifest inside the container — the host state under test is not the state it claims"
fi

new_host() { # $1=state -> host root on stdout
  local st="$1" root="$HOME/hosts/$1"
  rm -rf "$root"; mkdir -p "$root/.claude" "$root/agent"
  echo '{}' > "$root/.claude/settings.json"
  echo '{}' > "$root/.claude.json"
  : > "$root/fake-claude.log"
  if [ "$st" != absent ]; then
    mkdir -p "$root/agent/meta-sessions"
    node -e '
      const fs = require("node:fs"), path = require("node:path");
      const [fix, state, dest] = process.argv.slice(1);
      const hosts = JSON.parse(fs.readFileSync(path.join(fix, "hosts.json"), "utf8"));
      for (const id of hosts[state]) {
        fs.copyFileSync(path.join(fix, "records", id + ".meta.json"), path.join(dest, id + ".meta.json"));
      }
    ' "$FIXROOT/meta-store" "$st" "$root/agent/meta-sessions"
  fi
  printf '%s' "$root"
}

in_host() { # $1=host root, rest=command
  local root="$1"; shift
  env HOME="$root" \
      CLAUDE_CONFIG_DIR="$root/.claude" \
      PI_CODING_AGENT_DIR="$root/agent" \
      FAKE_CLAUDE_LOG="$root/fake-claude.log" \
      "$@"
}

# Persistent regular files below the host root, with the fake-Claude log checked
# separately as an exact zero-invocation signal. This manifest does not cover
# permissions, ownership, symlink targets, or empty directories.
host_bytes() { (find "$1" -type f ! -name fake-claude.log -print0 | sort -z | xargs -0r sha256sum) 2>/dev/null || true; }
store_bytes() { (find "$1/agent/meta-sessions" -type f -print0 2>/dev/null | sort -z | xargs -0r sha256sum) 2>/dev/null || true; }

# — state: already migrated. A V3-only host must install like any other, and the
#   install must not touch the store it was gated on.
V3H="$(new_host v3-only)"
V3_STORE_BEFORE="$(store_bytes "$V3H")"
if in_host "$V3H" entwurf install-meta-bridge >"$HOME/logs/v3-only.log" 2>&1; then
  ok "V3-only host: install-meta-bridge PASSES (an already-migrated machine is not punished)"
else
  tail -12 "$HOME/logs/v3-only.log" | sed 's/^/        /'
  bad "V3-only host: install-meta-bridge FAILED — the gate rejects a store that certifies"
fi
if [ "$V3_STORE_BEFORE" = "$(store_bytes "$V3H")" ]; then
  ok "V3-only host: the seeded record is byte-identical after a successful install (install activates, it never migrates)"
else
  bad "V3-only host: install mutated the meta-record store"
fi

# — state: pre-cut, and carrying parentage values only a human may discard.
PCH="$(new_host v2-parentage)"
PC_BEFORE="$(host_bytes "$PCH")"
if in_host "$PCH" entwurf install-meta-bridge >"$HOME/logs/precut.log" 2>&1; then
  tail -12 "$HOME/logs/precut.log" | sed 's/^/        /'
  bad "pre-cut host: install-meta-bridge ACCEPTED a store the runtime cannot read"
else
  ok "pre-cut host: install-meta-bridge REFUSES"
fi
if [ "$PC_BEFORE" = "$(host_bytes "$PCH")" ]; then
  ok "pre-cut host: the refusal left every persistent regular file unchanged (path+sha256 manifest below the host root)"
else
  bad "pre-cut host: the refusal still mutated the host:"$'\n'"$(diff <(printf '%s\n' "$PC_BEFORE") <(printf '%s\n' "$(host_bytes "$PCH")") | sed 's/^/        /' | head -8)"
fi
if [ -s "$PCH/fake-claude.log" ]; then
  bad "pre-cut host: the claude CLI was invoked before the refusal — the store gate must decide first:"$'\n'"$(sed 's/^/        /' "$PCH/fake-claude.log")"
else
  ok "pre-cut host: ZERO claude invocations before the refusal (no external CLI contact at all)"
fi
if grep -q 'entwurf meta-bridge-migrate-v3 migrate' "$HOME/logs/precut.log"; then
  ok "pre-cut host: the refusal names the INSTALLED migrate form — the only one this consumer can type"
else
  bad "pre-cut host: the refusal did not hand this consumer a command it can run"
fi

# — the operator's move, from inside the container, through the global shim.
if in_host "$PCH" entwurf meta-bridge-migrate-v3 migrate >"$HOME/logs/precut-migrate.log" 2>&1; then
  bad "pre-cut host: migrate discarded parentage values without --drop-parentage"
else
  ok "pre-cut host: plain migrate REFUSES to discard parentage on the operator's behalf"
fi
if [ -n "$(find "$PCH/agent" -maxdepth 1 -name 'meta-sessions.v3-migration-backup-*' 2>/dev/null)" ]; then
  bad "pre-cut host: the refused migrate left a backup — it began work it should not have"
else
  ok "pre-cut host: the refused migrate took no backup (store untouched)"
fi

if in_host "$PCH" entwurf meta-bridge-migrate-v3 migrate --drop-parentage >"$HOME/logs/precut-drop.log" 2>&1; then
  ok "pre-cut host: explicit --drop-parentage migrates"
else
  tail -12 "$HOME/logs/precut-drop.log" | sed 's/^/        /'
  bad "pre-cut host: --drop-parentage FAILED"
fi
PC_BACKUP="$(find "$PCH/agent" -maxdepth 1 -type d -name 'meta-sessions.v3-migration-backup-*' | head -1)"
if [ -n "$PC_BACKUP" ]; then
  WANT="$(sha256sum "$FIXROOT/meta-store/records/20260305T000000-dddd05.meta.json" | cut -d' ' -f1)"
  GOT="$(sha256sum "$PC_BACKUP/20260305T000000-dddd05.meta.json" 2>/dev/null | cut -d' ' -f1)"
  if [ "$WANT" = "$GOT" ]; then
    ok "pre-cut host: the discarded parentage survives in the backup as the ORIGINAL frozen bytes"
  else
    bad "pre-cut host: backup bytes are not the original record (fixture $WANT, backup $GOT)"
  fi
else
  bad "pre-cut host: --drop-parentage rewrote the store without a backup"
fi
if in_host "$PCH" entwurf meta-bridge-migrate-v3 verify 2>&1 | grep -q 'non-V3=0'; then
  ok "pre-cut host: the migrated store certifies non-V3=0 through the global shim"
else
  bad "pre-cut host: the migrated store does not certify"
fi
if in_host "$PCH" entwurf install-meta-bridge >"$HOME/logs/precut-retry.log" 2>&1; then
  ok "pre-cut host: install-meta-bridge PASSES on the retry — the prescribed upgrade sequence lands on a consumer machine"
else
  tail -20 "$HOME/logs/precut-retry.log" | sed 's/^/        /'
  bad "pre-cut host: install-meta-bridge STILL fails after the prescribed migration"
fi
if grep -q 'plugin install' "$PCH/fake-claude.log"; then
  ok "pre-cut host: the retry actually did the work (plugin install reached)"
else
  bad "pre-cut host: the retry exited 0 without installing the plugin"
fi

# — state: mixed. A machine that opened one session under the new cut now has a
#   v3 record sitting beside its pre-cut ones. It is still not installable, and
#   this is the state a "just pull and re-setup" upgrade actually produces.
MXH="$(new_host mixed)"
MX_BEFORE="$(host_bytes "$MXH")"
if in_host "$MXH" entwurf install-meta-bridge >"$HOME/logs/mixed.log" 2>&1; then
  bad "mixed host: install-meta-bridge ACCEPTED a store holding both v2 and v3 records"
else
  ok "mixed host: install-meta-bridge REFUSES a half-migrated store"
fi
if [ "$MX_BEFORE" = "$(host_bytes "$MXH")" ]; then
  ok "mixed host: the refusal left every persistent regular file unchanged"
else
  bad "mixed host: the refusal mutated the host"
fi

# ── 8. doctor fixture, built only from package artifacts ─────────────────────
echo "[doctor fixture]"
mkdir -p "$PLANTED"
cp -r "$ASM/$PLUGIN/." "$PLANTED/"
chmod -R u+w "$PLANTED"
ok "plugin cache PLANTED from the container-assembled bundle — a FIXTURE, not evidence that 'claude plugin install' works"

mapfile -t HOOK_ARGV < <(python3 -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
leaf = d["hooks"]["SessionStart"][0]["hooks"][0]
root = sys.argv[2]
print(leaf["command"].replace("${CLAUDE_PLUGIN_ROOT}", root))
for a in leaf["args"]:
    print(a.replace("${CLAUDE_PLUGIN_ROOT}", root))
' "$PLANTED/hooks/hooks.json" "$PLANTED")
printf '%s' '{"session_id":"container-native-1","transcript_path":"/tmp/entwurf-container-transcript.jsonl","cwd":"/tmp","hook_event_name":"SessionStart","model":{"id":"container-model"}}' > "$HOME/hook-input.json"
# THIS shell stands in for Claude: exec the installed owner ARGV directly (no shell,
# per-element placeholder substitution — exactly what Claude does for an exec form) as
# a foreground child. hook-launch.sh execs the payload, so the hook's parent is $$ and
# it keys both markers to $$. On this image /bin/sh is dash, which under the retired
# shell form would have RETAINED a wrapper and broken that join — the exec form has no
# shell to differ, which is the whole point of running this cell on a foreign host.
OWNER_MARKER="$AGENT/meta-senders/claude-code/$$.json"
if env CLAUDE_PLUGIN_ROOT="$PLANTED" "${HOOK_ARGV[@]}" < "$HOME/hook-input.json" > "$HOME/hook-run.txt" 2>&1 \
   && [ -f "$OWNER_MARKER" ]; then
  MARKER_OWNER="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).ownerPid' "$OWNER_MARKER")"
  if [ "$MARKER_OWNER" = "$$" ] && [ "$MARKER_OWNER" -gt 1 ]; then
    ok "installed owner argv execs directly (no shell): marker ownerPid=$MARKER_OWNER == stand-in Claude pid=$$ (>1) — a FIXTURE owner, not a real Claude process"
  else
    bad "owner fixture marker names ownerPid=$MARKER_OWNER, expected stand-in Claude pid=$$ and >1"
  fi
else
  bad "owner fixture drive failed: $(tr '\n' ' ' < "$HOME/hook-run.txt" | cut -c1-300)"
fi

env ENTWURF_BRIDGE_EXTERNAL_AGENT_ID=external-mcp/claude-code \
    PI_CODING_AGENT_DIR="$AGENT" \
    sleep 600 &
BRIDGE_PID=$!
trap 'kill "$BRIDGE_PID" 2>/dev/null || true' EXIT
ok "fake live entwurf MCP bridge as a child of the stand-in Claude pid (pid=$BRIDGE_PID) — the /proc live-join fixture"

# ── 9. THE STRICT DOCTOR — the release oracle, from the installed package ────
echo "[strict doctor oracle]"
DOC_RC=0
DOC_OUT="$(entwurf doctor-meta-bridge 2>&1)" || DOC_RC=$?
if [ "$DOC_RC" -eq 0 ] && printf '%s\n' "$DOC_OUT" | grep -q 'meta-bridge doctor: PASS'; then
  ok "installed 'entwurf doctor-meta-bridge' reaches PASS (exit 0) — checkout-invisible, non-root, frozen package"
else
  bad "installed doctor did NOT reach PASS (exit $DOC_RC):"
  printf '%s\n' "$DOC_OUT" | grep -E '^  (FAIL|WARN)' | sed 's/^/        /'
fi
# Exit code alone would be a vacuous pass: the doctor must be seen making the
# claims that matter on a consumer host, not merely returning 0.
for claim in \
  'active cached artifact resolved from plugin installPath' \
  'exec-form launch contract supported' \
  'launch form: exec form through the shipped hook-launch.sh' \
  'sender + receiver owner join is live and record-backed' \
  'live bridge command DELIVERS'
do
  printf '%s\n' "$DOC_OUT" | grep -qF "$claim" \
    && ok "doctor claim present: $claim" \
    || bad "doctor never made the claim: $claim"
done

echo
if [ "$fail" -eq 0 ]; then echo "container-consumer: PASS"; else echo "container-consumer: FAIL (see above)"; exit 1; fi
CONTAINER_RUNNER_EOF
RC=$?
set -e

echo "[check-install-container] container exit=$RC (artifact sha256=$DIGEST, image id=$IMAGE_ID)"
if [ "$RC" -ne 0 ]; then
  echo "[check-install-container] FAIL — the Linux artifact consumer rejected this candidate" >&2
  exit 1
fi
echo "[check-install-container] ok — candidate $TGZ_NAME consumed clean by a checkout-invisible Node $FLOOR_MAJOR Linux consumer"
