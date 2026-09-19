#!/usr/bin/env bash
# smoke-herdr-raw-install-live — the FIRST USER PATH for the Herdr plugin (#118 홉 1).
#
# WHAT THIS IS THE ONLY EVIDENCE FOR. Every other herdr gate in this repository proves the
# plugin against a source we control: `check-herdr-plugin-build` drives a herdr-stub, and
# `smoke-herdr-plugin-build-live` redirects the product remote to a local bare clone with
# git `insteadOf` and asserts `identity.kind === "herdr-checkout"`. Both are honest about
# what they are, and neither has ever watched the plugin acquire its runtime from npm on a
# machine that has never seen this repository. VERIFY.md:61 says a source switch is a
# re-proof, and the production lock has said `npm` since dd84ac0 with that re-proof's
# acquisition axis still empty. This closes that one axis and no other.
#
# WHAT IT DOES NOT CLOSE, kept explicit so a green run cannot be read as more than it is:
# installed-runtime depth beyond identity (compiled entry, three bins, a real
# `check-bridge`), swap / torn-swap recovery, deactivation, and the package-consumer proof.
# Those stay where #118's table puts them.
#
# SCAFFOLDING VS PRODUCT FACE (Hard Rule 17). pi, herdr and Claude Code are installed in the
# IMAGE BUILD, by this harness, for this one container. Entwurf's own setup and package
# install none of them, and nothing here changes that: the product face under test begins at
# `herdr integration install pi` and ends at the plugin's own activation. herdr itself is
# fetched by `scripts/install-herdr-ci.sh` against `scripts/fixtures/herdr-supply.json` — the
# same digest-before-chmod path CI uses, and the only place a herdr version or digest lives.
#
# NO HOST BLEED. No socket, config, cache or repo is mounted. The runner arrives on stdin, so
# the container depends on no file from this checkout. There is no `insteadOf`: the remote is
# the public one a user would type.
#
# THE FIRST MEASUREMENT IS THE POINT. Herdr's plugin registration talks to a running herdr
# server and falls back to `persist_plugin_offline` only when the send fails as a CONNECTION
# error (herdr src/cli/plugin.rs:914-981,1016-1021 @ c77af189 — 0.9.0 source, 0.9.1 unmeasured).
# A container has no server. Whether that fallback carries 0.9.1 is exactly what this smoke
# asks first, and a "no" is an INVESTIGATION RESULT for #118, never a completion. `--yes` is
# passed always: without it a non-interactive stdin is exit 2 by design (`:189`), and
# mistaking that for a missing server is the misdiagnosis this comment exists to prevent.
#
# Without LIVE=1 it SKIPs by name. Docker absent is a SKIP that ENTWURF_REQUIRE_DOCKER=1 turns
# red, the same shape check-install-container uses. Neither is a pass.
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

case "$REPO" in
  */node_modules/*)
    echo "entwurf: 'smoke-herdr-raw-install-live' is a dev-clone-only surface — the installed package ships no container harness." >&2
    exit 1
    ;;
esac

# `--ref` defaults to `main`, not to a pinned SHA: receipt (a) is defined as what a user gets
# TODAY from the public remote, and a SHA frozen in this file would quietly stop being that.
# herdr resolves the ref and this gate prints the resolved commit, so the receipt is still exact.
REF="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
    *) echo "[smoke-herdr-raw-install-live] unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "${LIVE:-0}" != 1 ]; then
  echo "[smoke-herdr-raw-install-live] SKIP — needs LIVE=1 (container build + npm registry + GitHub network)."
  echo "[smoke-herdr-raw-install-live] (this is a SKIP, not a pass: the first-user-path axis was not measured)"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  if [ "${ENTWURF_REQUIRE_DOCKER:-0}" = 1 ]; then
    echo "[smoke-herdr-raw-install-live] FAIL — ENTWURF_REQUIRE_DOCKER=1 but no usable Docker daemon." >&2
    exit 1
  fi
  echo "[smoke-herdr-raw-install-live] SKIP — no usable Docker daemon on this host."
  exit 0
fi

PI_SPEC="$(node -p "require('$REPO/package.json').devDependencies['@earendil-works/pi-coding-agent']")"
# Pinned, not floating: a receipt that cannot say WHICH Claude Code it ran is not
# reproducible. This is the version measured in the container on 2026-09-19. Claude Code
# is scaffolding here (Rule 17) — the product face starts at `herdr integration install`.
CLAUDE_SPEC="2.1.278"
FLOOR_SPEC="$(node -p "require('$REPO/package.json').engines.node")"
FLOOR_MAJOR="${FLOOR_SPEC#>=}"; FLOOR_MAJOR="${FLOOR_MAJOR%%.*}"
HERDR_VERSION="$(node -p "require('$REPO/scripts/fixtures/herdr-supply.json').version")"
BASE_IMAGE="node:${FLOOR_MAJOR}-bookworm"
# Tagged by everything the image content depends on, so a changed pin rebuilds instead of
# silently reusing a stale layer cache.
IMAGE="entwurf-herdr-raw-install:node${FLOOR_MAJOR}-pi${PI_SPEC}-herdr${HERDR_VERSION}-claude${CLAUDE_SPEC}"

echo "[smoke-herdr-raw-install-live] ref=$REF base=$BASE_IMAGE pi=$PI_SPEC herdr=$HERDR_VERSION claude=$CLAUDE_SPEC"

CTX="$(mktemp -d -t entwurf-herdr-raw.XXXXXX)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/scripts/fixtures"
# The supply manifest travels WITH its installer: install-herdr-ci.sh resolves the manifest
# relative to its own parent, and duplicating a digest here is exactly how a pin drifts.
cp "$REPO/scripts/install-herdr-ci.sh" "$CTX/scripts/install-herdr-ci.sh"
cp "$REPO/scripts/fixtures/herdr-supply.json" "$CTX/scripts/fixtures/herdr-supply.json"

cat > "$CTX/Dockerfile" <<DOCKERFILE_EOF
FROM ${BASE_IMAGE}
# git is what herdr shells out to for the remote checkout; curl is what the pinned-digest
# herdr installer uses. Both are scaffolding, and both are named so the image has no
# unexplained content.
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \\
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @earendil-works/pi-coding-agent@${PI_SPEC} @anthropic-ai/claude-code@${CLAUDE_SPEC}
COPY scripts /scaffold/scripts
RUN d="\$(bash /scaffold/scripts/install-herdr-ci.sh | tail -1)" \\
 && install -m 0755 "\$d/herdr" /usr/local/bin/herdr \\
 && rm -rf "\$d" \\
 && herdr --version
USER node
DOCKERFILE_EOF

echo "[smoke-herdr-raw-install-live] building scaffolding image $IMAGE"
docker build -q -t "$IMAGE" "$CTX" >/dev/null || {
  echo "[smoke-herdr-raw-install-live] FAIL — scaffolding image build failed" >&2; exit 1; }
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
BASE_DIGEST="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}<none>{{end}}' "$BASE_IMAGE" 2>/dev/null || echo '<none>')"
echo "[smoke-herdr-raw-install-live] image id=$IMAGE_ID base=$BASE_IMAGE repoDigest=$BASE_DIGEST"
echo "[smoke-herdr-raw-install-live] scaffolded: pi@$PI_SPEC herdr@$HERDR_VERSION claude-code@$CLAUDE_SPEC"

set +e
docker run --rm -i \
  --workdir /tmp \
  -e HOME=/home/node \
  -e "REQUESTED_REF=$REF" \
  "$IMAGE" \
  bash -c 'bash -s' <<'CONTAINER_RUNNER_EOF'
set -uo pipefail

fail=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; fail=1; }

PLUGIN_ID="junghan0611.entwurf"
REMOTE_SPEC="junghan0611/entwurf/plugins/herdr"
DATA="$HOME/.local/share"
STATE="$HOME/.local/state"
JOURNAL="$DATA/entwurf/herdr-plugin/journal.json"
ACTIVE="$DATA/entwurf/herdr-plugin/runtime/active"
LEDGER="$STATE/entwurf/herdr-plugin/activation.json"
REGISTRY="$HOME/.config/herdr/plugins.json"

echo "[container] uid=$(id -u) user=$(id -un) HOME=$HOME"
echo "[container] $(herdr --version 2>&1 | head -1) | pi $(pi --version 2>&1 | head -1) | claude $(claude --version 2>&1 | head -1)"

# ── environment facts: nothing of the host's is reachable ────────────────────
[ ! -e /home/junghan ] && ok "no host home in the container" || bad "a host home path exists in the container"
[ -z "$(ls -A "$HOME" 2>/dev/null)" ] && ok "HOME starts empty" || echo "  note  HOME is not empty at start: $(ls -A "$HOME" | tr '\n' ' ')"
if git config --get-regexp 'url\..*\.insteadof' >/dev/null 2>&1; then bad "an insteadOf rewrite is configured — this must be the public remote"; else ok "no git insteadOf rewrite (public remote, as a user would type it)"; fi

# ── 0. harness first-run state ───────────────────────────────────────────────
# NOT a shortcut, and not a mkdir. `herdr integration install <agent>` refuses an agent that
# has never run: it creates `~/.pi/agent/extensions` only when `~/.pi/agent` already exists,
# and refuses Claude outright unless `~/.claude` is a directory (herdr
# src/integration/targets.rs:66-78,123-130 @ c77af189). A user reaching this point has started
# both harnesses at least once; a fresh container has not. So the REAL binaries are driven
# once, with the cheapest invocation measured to produce that state — no model turn, no login,
# no network account.
#   `pi --help`       → creates ~/.pi/agent   (`pi --version` does NOT — measured here)
#   `claude mcp list`  → creates ~/.claude and ~/.claude.json
#                        (`claude --version` / `--help` do NOT — measured here)
# This is also a FINDING about the first user path, not only about this harness: the install
# order a README can promise starts at "run each harness once".
echo; echo "[0] harness first-run state (real binaries, no model turn)"
pi --help >/dev/null 2>&1 || true
claude mcp list >/dev/null 2>&1 || true
[ -d "$HOME/.pi/agent" ] && ok "pi first-run state exists (~/.pi/agent)" || bad "pi never created ~/.pi/agent — herdr will refuse to integrate it"
[ -d "$HOME/.claude" ] && ok "claude first-run state exists (~/.claude)" || bad "claude never created ~/.claude — herdr will refuse to integrate it"

# ── 1. integrate pi ──────────────────────────────────────────────────────────
echo; echo "[1] herdr integration install pi"
herdr integration install pi; rc=$?
if [ "$rc" -eq 0 ]; then
  ok "integration install pi exit 0"
else
  bad "integration install pi exit $rc — every later assertion would be a SECOND explanation for this one red"
  echo; echo "smoke-herdr-raw-install-live: FAIL (harness integration, before the product face)"
  exit 1
fi

# ── 2. THE FIRST MEASUREMENT: plugin install with no herdr server ────────────
echo; echo "[2] herdr plugin install $REMOTE_SPEC --ref $REQUESTED_REF --yes"
herdr plugin install "$REMOTE_SPEC" --ref "$REQUESTED_REF" --yes 2>&1 | sed 's/^/    /'
rc="${PIPESTATUS[0]}"
echo "    → exit $rc"
if [ "$rc" -ne 0 ]; then
  bad "plugin install exited $rc — see the lines above; this is #118's investigation output, not a completion"
  echo; echo "smoke-herdr-raw-install-live: FAIL (first user path did not complete)"
  exit 1
fi
ok "plugin install exit 0 with no herdr server running (the offline-persist path carries 0.9.x)"

# ── 3. what the install actually left behind ─────────────────────────────────
echo; echo "[3] acquisition identity and ledger"
node -e '
const fs = require("node:fs");
const path = require("node:path");
const [registry, journal, active, ledger, pluginId, requestedRef] = process.argv.slice(1);
let bad = 0;
const ok = (m) => console.log("  ok    " + m);
const no = (m) => { console.log("  FAIL  " + m); bad = 1; };
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const reg = read(registry);
const entry = (Array.isArray(reg) ? reg : reg.plugins || []).find((e) => e.plugin_id === pluginId);
if (!entry) { no(`herdr registry has no ${pluginId} entry`); process.exit(1); }
ok(`herdr registry carries ${pluginId}`);
const src = entry.source || {};
console.log(`  REF requested=${src.requested_ref ?? requestedRef} resolved_commit=${src.resolved_commit ?? "<none>"}`);
if (src.resolved_commit) ok("the registry records a resolved commit"); else no("no resolved commit recorded");

// The lock the INSTALLED checkout committed — read from herdr managed path, so this assertion
// follows whatever --ref was asked for instead of trusting the host working tree.
const managed = src.managed_path || entry.managed_path;
if (!managed) { no("no managed checkout path recorded"); process.exit(1); }
const lock = read(path.join(managed, "plugins", "herdr", "runtime-lock.json"));
console.log(`  LOCK source=${lock.source} ${lock.name}@${lock.version}`);
console.log(`  LOCK integrity=${lock.integrity}`);
if (lock.source === "npm") ok("the committed lock at this ref names npm as the production source");
else no(`the committed lock names ${lock.source}, not npm — this ref is not the production source`);

if (!fs.existsSync(journal)) {
  no(`no runtime journal at ${journal}`);
  console.log("  note  build.mjs exits 0 WITHOUT writing when the activation set A is empty, so this");
  console.log("  note  is what an install with no integrated harness also looks like. Check step [1].");
  process.exit(1);
}
const j = read(journal);
// Measured key, not a guess. The journal top level is exactly
// schemaVersion, phase, runtimeRoot, artifactIdentity, previousRuntime.
const id = j.artifactIdentity;
if (!id) { no(`no runtime identity in ${journal}: keys ${Object.keys(j)}`); process.exit(1); }
console.log(`  RUNTIME kind=${id.kind} ${id.name}@${id.version}`);
console.log(`  RUNTIME expectedIntegrity=${id.expectedIntegrity}`);
console.log(`  RUNTIME observedDigest=${id.observedDigest}`);
id.kind === "npm" ? ok("runtime identity.kind === npm (acquired from the registry, not a checkout)") : no(`runtime identity.kind === ${id.kind}`);
id.name === lock.name && id.version === lock.version ? ok(`runtime name@version matches the committed lock (${id.name}@${id.version})`) : no(`runtime ${id.name}@${id.version} != lock ${lock.name}@${lock.version}`);
id.expectedIntegrity === lock.integrity ? ok("expected integrity is the committed sha512") : no("expected integrity differs from the committed lock");
// observedDigest is a sha256 CONTENT ADDRESS of the tarball that arrived, not a second copy of
// the sha512 integrity — the two are different hashes of the same bytes. The sha512 comparison is
// not repeated here because it cannot be: npmAcquire hashes the fetched tarball and THROWS
// runtime-artifact-integrity-mismatch before installing anything (herdr-runtime.mjs:924-930), so a
// journal existing at all is that comparison having passed. What is left to check is that a real
// digest of real bytes was recorded.
/^sha256-[0-9a-f]{64}$/.test(id.observedDigest ?? "")
  ? ok("a sha256 content address of the FETCHED bytes is recorded (and the sha512 gate upstream let the install proceed)")
  : no(`observedDigest is not a sha256 content address: ${JSON.stringify(id.observedDigest)}`);

// The active dir is an npm PREFIX, so the package lands under node_modules/<name>
// (herdr-runtime.mjs:805-806), not at its root.
const installedRoot = path.join(active, "node_modules", lock.name);
if (!fs.existsSync(path.join(installedRoot, "package.json"))) {
  no(`no installed runtime at ${installedRoot}`);
} else {
  const pkg = read(path.join(installedRoot, "package.json"));
  pkg.name === lock.name && pkg.version === lock.version
    ? ok(`the active runtime on disk is ${pkg.name}@${pkg.version}`)
    : no(`active runtime is ${pkg.name}@${pkg.version}`);
}

if (!fs.existsSync(ledger)) { no(`no activation ledger at ${ledger}`); process.exit(1); }
const led = read(ledger);
const backends = led.activatedBackends;
JSON.stringify(backends) === JSON.stringify(["pi"]) ? ok(`ledger activatedBackends === ["pi"]`) : no(`ledger activatedBackends === ${JSON.stringify(backends)}`);
process.exit(bad);
' "$REGISTRY" "$JOURNAL" "$ACTIVE" "$LEDGER" "$PLUGIN_ID" "$REQUESTED_REF" || fail=1

# The pi wiring must point INTO the active runtime, never at a checkout herdr will delete.
pi_hit="$(grep -rl "entwurf" "$HOME/.pi/agent" 2>/dev/null | head -1)"
if [ -n "$pi_hit" ]; then
  if grep -q "$ACTIVE" "$pi_hit"; then ok "pi wiring at ${pi_hit#$HOME/} names the active runtime path"; else bad "pi wiring at ${pi_hit#$HOME/} does not name $ACTIVE"; fi
  cp "$pi_hit" /tmp/pi-settings-phase-a.json
  PI_FILE="$pi_hit"
else
  bad "no pi wiring found under \$HOME/.pi/agent"
  PI_FILE=""
fi

# ── 4. add Claude, reinstall, and watch the ledger widen ─────────────────────
echo; echo "[4] herdr integration install claude, then reinstall (refresh)"
herdr integration install claude; rc=$?
[ "$rc" -eq 0 ] && ok "integration install claude exit 0" || bad "integration install claude exit $rc"
herdr plugin install "$REMOTE_SPEC" --ref "$REQUESTED_REF" --yes 2>&1 | sed 's/^/    /'
rc="${PIPESTATUS[0]}"
echo "    → exit $rc"
[ "$rc" -eq 0 ] && ok "reinstall (refresh) exit 0" || bad "reinstall exited $rc"

echo; echo "[5] the {pi} → {pi, claude-code} transition"
node -e '
const fs = require("node:fs");
const [ledger, claudeUserConfig] = process.argv.slice(1);
let bad = 0;
const ok = (m) => console.log("  ok    " + m);
const no = (m) => { console.log("  FAIL  " + m); bad = 1; };
if (!fs.existsSync(ledger)) { no(`no activation ledger at ${ledger}`); process.exit(1); }
if (!fs.existsSync(claudeUserConfig)) { no(`no Claude user config at ${claudeUserConfig}`); process.exit(1); }
const led = JSON.parse(fs.readFileSync(ledger, "utf8"));
const backends = led.activatedBackends;
JSON.stringify(backends) === JSON.stringify(["pi", "claude-code"])
  ? ok(`ledger activatedBackends === ["pi","claude-code"]`)
  : no(`ledger activatedBackends === ${JSON.stringify(backends)}`);
const cfg = JSON.parse(fs.readFileSync(claudeUserConfig, "utf8"));
const servers = cfg.mcpServers || {};
const owned = Object.keys(servers).filter((k) => k.includes("entwurf"));
owned.length === 1 ? ok(`exactly one Claude MCP owner entry (${owned[0]})`) : no(`Claude MCP owner entries: ${JSON.stringify(owned)}`);
process.exit(bad);
' "$LEDGER" "$HOME/.claude.json" || fail=1

if [ -n "$PI_FILE" ]; then
  if diff -q /tmp/pi-settings-phase-a.json "$PI_FILE" >/dev/null 2>&1; then
    ok "pi wiring is byte-identical across the reinstall"
  else
    bad "pi wiring changed across the reinstall:"; diff /tmp/pi-settings-phase-a.json "$PI_FILE" | sed 's/^/        /'
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "smoke-herdr-raw-install-live: PASS (first user path green on the public remote + npm runtime)"
else
  echo "smoke-herdr-raw-install-live: FAIL (see above)"
fi
exit "$fail"
CONTAINER_RUNNER_EOF
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
  echo "[smoke-herdr-raw-install-live] FAIL — container cell exited $rc (ref=$REF image=$IMAGE_ID)" >&2
  exit 1
fi
echo "[smoke-herdr-raw-install-live] ok — ref=$REF image=$IMAGE_ID base=$BASE_DIGEST"
