#!/usr/bin/env bash
# smoke-herdr-raw-install-live — the FIRST USER PATH for the Herdr plugin (#118 홉 1, H1-4, H1-5).
#
# WHAT THIS IS THE ONLY EVIDENCE FOR. Every other herdr gate in this repository proves the
# plugin against a source we control: `check-herdr-plugin-build` drives a herdr-stub, and
# `smoke-herdr-plugin-build-live` redirects the product remote to a local bare clone with
# git `insteadOf` and asserts `identity.kind === "herdr-checkout"`. Both are honest about
# what they are, and neither has ever watched the plugin acquire its runtime from npm on a
# machine that has never seen this repository. VERIFY.md:61 says a source switch is a
# re-proof, and the production lock has said `npm` since dd84ac0 with that re-proof's
# acquisition axis still empty. Cells [1]–[5] close that one axis.
#
# THEN THE PATH KEEPS GOING, because an install is not a use. Cells [6]–[9] stay in the SAME
# container and ask what a user asks next: the runtime those bytes became is run (compiled
# entry, three executable bins, a real `check-bridge` printing its verb set); the pi that
# this plugin WIRED is started with no `-e` and no model turn, to see whether it becomes a
# garden citizen with a record and a control socket; `entwurf peer-facts` and the plugin's
# own status fan are asked about that citizen with neither side stubbed; and the shipped
# teardown deletes the runtime it is executing from and then comes back. Those are
# VERIFY.md:102's installed-runtime and deactivation rows, re-proved against the npm source
# rather than against a fixture.
#
# WHAT IT STILL DOES NOT CLOSE, kept explicit so a green run cannot be read as more than it
# is: swap / torn-swap recovery (owned by `smoke-herdr-plugin-build-live` cells 3–4 on the
# checkout carrier, and unmeasured on the npm one), the package-consumer proof, and the
# status fan drawing a citizen as a ROW — that needs `placement.kind === "herdr-pane"`, so
# the pi session must live in a herdr pane a session reference joins, and a headless
# container has no panes. Those stay where #118's table puts them.
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
#
# It takes a REMOTE REF — a branch or a tag — and NOT an arbitrary commit. Measured on herdr
# 0.9.1 (2026-09-19): `--ref 11ec0c3` fails as
#   git failed with status exit status: 128: fatal: couldn't find remote ref 11ec0c3
# because the checkout fetches the ref by name. So a candidate is addressed by its BRANCH and
# pinned by the resolved_commit this gate prints, which is the honest pairing anyway: the
# branch says what was asked for, the commit says what arrived.
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
# The pre-plugin baseline for [9]. Captured HERE and not later: everything after this line
# is the plugin's own writing, so this is the last moment the file still means what the
# host meant. Absence is a baseline too — `<absent>` below is a file the plugin created,
# and a teardown must not leave one behind carrying our entry.
cp "$HOME/.pi/agent/settings.json" /tmp/pi-settings-pre-plugin.json 2>/dev/null || rm -f /tmp/pi-settings-pre-plugin.json

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

# ── 6. the INSTALLED runtime, MEASURED instead of implied (#118 H1-5) ────────
# A green [2] already implies this: `certifyInstalledTree` refuses an install whose tree
# lacks the compiled entry, the three bins, or a `check-bridge` that exits 0
# (herdr-runtime.mjs:824-843). Implication is not observation, and VERIFY.md:102 lists
# "the installed runtime (name@version, compiled entry, three executable bins, a real
# check-bridge)" as its own re-proof row against THIS source. A row closed by inference
# cannot print the verb set it claims, so these lines run the npm-acquired bytes and print
# what they answered. The bin set is REQUIRED_BINS (herdr-runtime.mjs:165) — the package
# declares six, and the three named there are the ones an activation certifies.
echo; echo "[6] the installed runtime: compiled entry, three bins, a real check-bridge"
node -e '
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const [active, registry, pluginId] = process.argv.slice(1);
let bad = 0;
const ok = (m) => console.log("  ok    " + m);
const no = (m) => { console.log("  FAIL  " + m); bad = 1; };
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const reg = read(registry);
const entry = (Array.isArray(reg) ? reg : reg.plugins || []).find((e) => e.plugin_id === pluginId);
const managed = entry?.source?.managed_path || entry?.managed_path;
const lock = read(path.join(managed, "plugins", "herdr", "runtime-lock.json"));
const root = path.join(active, "node_modules", lock.name);

// The exact constant the bootstrap uses, spelled out so a drift in either place is visible
// here rather than absorbed: mcp/entwurf-bridge/dist/mcp/entwurf-bridge/src/index.js.
const COMPILED_ENTRY = path.join("mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js");
const entryPath = path.join(root, COMPILED_ENTRY);
if (fs.existsSync(entryPath)) ok(`compiled bridge entry present (${COMPILED_ENTRY})`);
else no(`no compiled bridge entry at ${entryPath} — the npm artifact shipped source without its dist`);

// Executable, not merely present. A bin entry npm did not chmod is the failure mode
// `postinstall-chmod` exists for, and `fs.existsSync` would call it green.
const binDir = path.join(active, "node_modules", ".bin");
for (const name of ["entwurf", "entwurf-bridge", "entwurf-statusline"]) {
  const bin = path.join(binDir, name);
  try { fs.accessSync(bin, fs.constants.X_OK); ok(`bin is executable: ${name}`); }
  catch (err) { no(`bin not executable: ${bin} (${err.code})`); }
}

// The REAL subcommand, from the installed bin, under node_modules — which is the branch of
// start.sh that runs the prebuilt dist. Its own oracle is an EXACT set (run.sh:5187), so a
// zero exit here is the artifact listing all seven garden verbs and no eighth.
const run = spawnSync(path.join(binDir, "entwurf"), ["check-bridge"], { encoding: "utf8" });
const said = `${run.stdout ?? ""}${run.stderr ?? ""}`;
// [a-z0-9_] and not [a-z_]: the first draft of this line printed `entwurf_v` for entwurf_v2
// and the cell still went green, because the EXIT CODE is the oracle and the verb list is
// the receipt. A receipt that misspells what it witnessed is the failure this cell exists
// to prevent one directory over, so it is spelled correctly here.
const verbs = (said.match(/entwurf_[a-z0-9_]+/g) ?? []).filter((v, i, a) => a.indexOf(v) === i).sort();
// A SECOND, INDEPENDENT COPY OF THE SET, ON PURPOSE (A5 D1). The exit code alone used to be
// the oracle here, which left the printed list as decoration a parser bug could quietly
// corrupt — and did, see the regex note just above. The package under test carries the
// expectation of run.sh:5187 in its own bytes, so reading the answer from there would let
// the artifact grade itself. The literal below is a copy that must AGREE with the shipped
// one; the two disagreeing is the signal, and a verb genuinely added upstream reddens this
// smoke until somebody says so here too.
const EXPECTED_VERBS = [
  "entwurf_fresh_call",
  "entwurf_inbox_read",
  "entwurf_peers",
  "entwurf_register_native",
  "entwurf_resume_call",
  "entwurf_self",
  "entwurf_v2",
];
console.log(`  VERBS ${verbs.join(",") || "<none>"}`);
if (run.status === 0) ok(`entwurf check-bridge exit 0 from the installed bin (${verbs.length} verbs listed)`);
else no(`entwurf check-bridge exit ${run.status}: ${said.trim().slice(0, 400)}`);
JSON.stringify(verbs) === JSON.stringify(EXPECTED_VERBS)
  ? ok(`the receipt names EXACTLY the seven garden verbs (${EXPECTED_VERBS.length}), parsed from what the installed bin answered`)
  : no(`verb set mismatch — want ${JSON.stringify(EXPECTED_VERBS)} got ${JSON.stringify(verbs)}`);
process.exit(bad);
' "$ACTIVE" "$REGISTRY" "$PLUGIN_ID" || fail=1

# ── 7. THE USE PATH: the wired runtime makes a citizen, with no model turn ───
# What [1]–[5] proved is that bytes landed. #118 H1-4 asks the next question, which is the
# one a user actually has: does the pi that this plugin wired come up as a GARDEN CITIZEN?
#
# NO `-e` AND NO `--no-extensions`. smoke-resident-garden-guard loads this checkout's
# extension explicitly, because its subject is the checkout. The subject HERE is the
# wiring — the user-scope packages[] entry that `herdr plugin install` wrote — so the
# extension has to arrive the way it arrives for a user, or the cell proves nothing about
# the install. A bare `pi` is the whole point.
#
# ZERO TOKENS, and no provider argument either. `--mode rpc` + one `get_state` is the
# 0-token shape smoke-resident-garden-guard's BIRTH cell uses; the record and the socket
# exist only WHILE pi is alive, which is why the snapshot is taken from inside the driver
# between ordered commands rather than after the process ends. A provider/model pair is NOT
# passed: measured here 2026-09-19, a bogus one (`--provider zzz`) exits 1 with
# `Unknown provider` BEFORE session_start, and omitting the pair lets pi resolve the
# default the extension itself registers — so this cell needs no vendor account, no auth
# file, and no model name that could rot.
echo; echo "[7] pi --entwurf-control on the plugin's wiring: record + control socket, 0 tokens"
cat > /tmp/use-path-drive.mjs <<'DRIVER_EOF'
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOME = process.env.HOME;
const SOCKET_DIR = path.join(HOME, ".pi", "entwurf-control");
const META_DIR = path.join(HOME, ".pi", "agent", "meta-sessions");
const ENTWURF_BIN = process.argv[2];

let bad = 0;
const ok = (m) => console.log("  ok    " + m);
const no = (m) => { console.log("  FAIL  " + m); bad = 1; };
const ls = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };

const child = spawn("pi", ["--entwurf-control", "--mode", "rpc"], { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => { stderr += d.toString(); });

let buf = "";
let settled = false;
const extensionErrors = [];
let agentStartSeen = false;

const done = (code) => {
	if (settled) return;
	settled = true;
	try { child.stdin.end(); } catch { /* best-effort */ }
	setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* best-effort */ } process.exit(code); }, 300);
};

const observe = (sessionId) => {
	const sockets = ls(SOCKET_DIR).filter((f) => f.endsWith(".sock"));
	const recordFiles = ls(META_DIR).filter((f) => f.endsWith(".meta.json"));
	const records = recordFiles.map((f) => {
		try { return JSON.parse(fs.readFileSync(path.join(META_DIR, f), "utf8")); } catch { return null; }
	}).filter((r) => r !== null);
	const mine = records.filter((r) => r.nativeSessionId === sessionId);
	console.log(`  PI    nativeSessionId=${sessionId}`);
	console.log(`  STORE records=${records.length} sockets=${JSON.stringify(sockets)}`);

	if (mine.length === 1) ok("exactly one V3 record claims this pi session");
	else { no(`${mine.length} records claim ${sessionId} — the wired extension did not birth exactly one citizen`); return null; }

	const rec = mine[0];
	console.log(`  RECORD gardenId=${rec.gardenId} backend=${rec.backend} schemaVersion=${rec.schemaVersion} model=${rec.model} transcriptPath=${JSON.stringify(rec.transcriptPath)}`);
	rec.schemaVersion === 3 && rec.backend === "pi"
		? ok("the record is V3 with backend:\"pi\"")
		: no(`record is schemaVersion=${rec.schemaVersion} backend=${rec.backend}`);
	// The address is the record's. A gardenId equal to pi's own id would mean the id
	// authority moved back into the harness — the split #50 C2 exists to hold.
	typeof rec.gardenId === "string" && /^\d{8}T\d{6}-[0-9a-f]{6}$/.test(rec.gardenId) && rec.gardenId !== sessionId
		? ok(`the record minted the address, not pi (${rec.gardenId})`)
		: no(`gardenId ${JSON.stringify(rec.gardenId)} is not a record-minted address distinct from pi's id`);
	// A 0-token birth writes no session file, so a resume target here would be a phantom.
	rec.transcriptPath === null ? ok("0-token birth carries transcriptPath=null (no phantom resume target)") : no(`transcriptPath=${JSON.stringify(rec.transcriptPath)} for a session with no turn`);

	sockets.includes(`${rec.gardenId}.sock`)
		? ok(`a control socket is open, keyed on the record gardenId (${rec.gardenId}.sock)`)
		: no(`no ${rec.gardenId}.sock among ${JSON.stringify(sockets)} — the citizen has an address but no rail`);
	sockets.some((s) => s === `${sessionId}.sock` || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s))
		? no(`a socket carries pi's own session id: ${JSON.stringify(sockets)}`)
		: ok("no socket carries pi's session id");
	return rec;
};

/** peer-facts from the INSTALLED bin, while pi is still alive. */
const askPeers = (rec) => {
	const run = spawnSync(ENTWURF_BIN, ["peer-facts"], { encoding: "utf8" });
	if (run.status !== 0) { no(`installed \`entwurf peer-facts\` exit ${run.status}: ${(run.stderr ?? "").trim().slice(0, 300)}`); return; }
	let payload;
	try { payload = JSON.parse(run.stdout); } catch (err) { no(`peer-facts output is not JSON: ${err.message}`); return; }
	const peers = Array.isArray(payload?.peers) ? payload.peers : null;
	if (peers === null) { no("peer-facts payload has no `peers` array"); return; }
	const row = peers.find((p) => p.gardenId === rec.gardenId);
	console.log(`  PEERS total=${peers.length} mine=${row ? JSON.stringify(row) : "<absent>"}`);
	if (!row) { no(`peer-facts does not report ${rec.gardenId} — the citizen exists on disk and not in the listing`); return; }
	ok(`the installed \`entwurf peer-facts\` reports this citizen (backend=${row.backend})`);
	// Liveness is a FACT here, not a dispatch decision: the process is up and the socket is
	// bound, so anything but `alive` means the probe cannot see a rail that exists.
	row.liveness === "alive" ? ok("peer-facts reports liveness=alive while the session is up") : no(`peer-facts reports liveness=${row.liveness} for a running session`);
};

child.stdout.on("data", (d) => {
	buf += d.toString();
	let i;
	while ((i = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, i);
		buf = buf.slice(i + 1);
		if (!line.trim()) continue;
		let evt;
		try { evt = JSON.parse(line); } catch { continue; }
		if (evt.type === "agent_start") agentStartSeen = true;
		if (evt.type === "extension_error") extensionErrors.push({ path: evt.extensionPath, error: evt.error });
		if (evt.type !== "response" || evt.command !== "get_state") continue;
		const sessionId = evt.data?.sessionId ?? null;
		if (typeof sessionId !== "string") { no(`get_state returned no sessionId: ${line.slice(0, 300)}`); done(bad || 1); return; }
		extensionErrors.length === 0
			? ok("the wired extension loaded with no extension_error")
			: no(`extension errors: ${JSON.stringify(extensionErrors).slice(0, 400)}`);
		const rec = observe(sessionId);
		if (rec) askPeers(rec);
		agentStartSeen ? no("a model turn started — this cell is supposed to cost zero tokens") : ok("no model turn ran (zero tokens)");
		done(bad);
		return;
	}
});

child.on("error", (err) => { no(`pi failed to spawn: ${err.message}`); done(1); });
child.on("exit", (code) => {
	if (settled) return;
	no(`pi exited ${code} before answering get_state — stderr: ${stderr.trim().slice(0, 600)}`);
	done(1);
});

setTimeout(() => { child.stdin.write(`${JSON.stringify({ type: "get_state", id: "g1" })}\n`); }, 500);
setTimeout(() => { if (!settled) { no("pi did not answer get_state within 60s"); done(1); } }, 60_000);
DRIVER_EOF
node /tmp/use-path-drive.mjs "$ACTIVE/node_modules/.bin/entwurf" || fail=1

# ── 8. the status fan, driven by the REAL binaries this install produced ─────
# `check-herdr-plugin` already drives `lib/status.mjs` against stub `entwurf` and `herdr`
# executables, and its oracle is the call LOG: exactly one `entwurf peer-facts` and one
# `herdr agent list`, in that order. Here the same entry runs with neither side stubbed —
# `ENTWURF_BIN` is the npm-installed bin from [6], `HERDR_BIN_PATH` is the herdr the image
# scaffolded — so the question is whether that contract survives contact with the real two.
#
# TWO STATES, because the honest answer differs between them and both are a user's.
# (i) NO SERVER — the state everything above ran in. `herdr agent list` answers
#     {"error":{"code":"server_not_running"}} on exit 1 (measured, 0.9.1), so the fan must
#     name `herdr-agent-list-failed` and go RED. A failed read rendered as an empty table
#     is the one lie this surface could tell, and this is where it would tell it.
# (ii) HEADLESS SERVER — `herdr server` is scaffolding for the fan's SECOND read only; the
#     offline-persist measurement that cell [2] owns already happened without it, and the
#     server is stopped again before [9] so the reinstall there takes the same serverless
#     path. With a server and no panes the agent list is a real empty result, so the fan
#     exits 0 and the citizen from [7] is COUNTED rather than drawn: nobody observed a
#     placement for it, which is exactly the `unobserved` word the renderer reserves for
#     "nobody could look", as distinct from `none`.
#
# WHAT THIS CELL CANNOT CLOSE, stated rather than rounded: a citizen rendered as a ROW
# needs `placement.kind === "herdr-pane"`, which requires the pi session to be living in a
# herdr pane that herdr's own session reference joins. A headless container has no panes,
# so the row is out of reach here and stays with the host-side surface
# (`check-herdr-placement` for the join, GLG's raw PC for the picture).
echo; echo "[8] the status fan on real binaries — with no herdr server, then with one"
FAN="$(node -e '
const fs=require("node:fs");const path=require("node:path");
const [registry,pluginId]=process.argv.slice(1);
const reg=JSON.parse(fs.readFileSync(registry,"utf8"));
const e=(Array.isArray(reg)?reg:reg.plugins||[]).find((x)=>x.plugin_id===pluginId);
process.stdout.write(path.join(e?.source?.managed_path||e?.managed_path,"plugins","herdr","lib","status.mjs"));
' "$REGISTRY" "$PLUGIN_ID")"
if [ -f "$FAN" ]; then ok "the status fan ships in the managed checkout (${FAN#$HOME/})"; else bad "no status fan at $FAN"; fi

run_fan() {
  env ENTWURF_BIN="$ACTIVE/node_modules/.bin/entwurf" HERDR_BIN_PATH="$(command -v herdr)" \
    node "$FAN" </dev/null 2>&1
}

fan_no_server="$(run_fan)"; fan_no_server_rc=$?
echo "$fan_no_server" | sed 's/^/    /'
echo "    → exit $fan_no_server_rc"
if [ "$fan_no_server_rc" -ne 0 ] && printf '%s' "$fan_no_server" | grep -q '^herdr-agent-list-failed'; then
  ok "with no herdr server the fan names herdr-agent-list-failed and goes red (not an empty table)"
else
  bad "with no herdr server the fan answered rc=$fan_no_server_rc without naming herdr-agent-list-failed"
fi

(herdr server >/tmp/herdr-server.log 2>&1 &)
server_up=0
for _ in $(seq 1 40); do
  if herdr agent list >/dev/null 2>&1; then server_up=1; break; fi
  sleep 0.5
done
[ "$server_up" -eq 1 ] && ok "a headless herdr server answered 'agent list' (scaffolding for the fan's second read)" || bad "the headless herdr server never answered agent list: $(head -3 /tmp/herdr-server.log)"

fan_with_server="$(run_fan)"; fan_with_server_rc=$?
echo "$fan_with_server" | sed 's/^/    /'
echo "    → exit $fan_with_server_rc"
if [ "$fan_with_server_rc" -eq 0 ]; then ok "with a herdr server the fan completes both reads and exits 0"; else bad "the fan exited $fan_with_server_rc with a live herdr server"; fi
# The WHOLE sentence, count included (A5 O1). The bare word `unobserved` also appears in
# `renderPlacement`'s fallback and could be carried by output that never accounted for
# anybody. status.mjs:205-213 writes `<n> citizen(s) not shown: ... (unobserved).`, and the
# store holds exactly the one citizen [7] created, so the count is a fact this cell may name.
if printf '%s' "$fan_with_server" | grep -qx '1 citizen(s) not shown: nobody could observe placement for them (unobserved)\.'; then
  ok "the ONE citizen with no observed placement is COUNTED by name (1 citizen(s) not shown ... unobserved), not silently dropped"
else
  bad "the fan drew no '1 citizen(s) not shown ... (unobserved)' accounting for the citizen born in [7]"
fi
herdr server stop >/dev/null 2>&1 || true

# ── 9. deactivate: the roundtrip, on the npm source (#118 H1-5) ──────────────
# `check-herdr-activation` cell 16 proves this against fixtures: [QK:HAC-DEACTIVATE-ROUNDTRIP]
# asserts the pi settings return to their ORIGINAL MEANING (JSON equality, not bytes — the
# writer may reindent), zero install-state survives, and the runtime and ledger are retired.
# VERIFY.md:102 lists deactivation as a row that must be re-run against the production
# source, and #118's table still carries it as `deactivate 미결`. This runs the verb that
# actually ships — `entwurf herdr-plugin-deactivate` from the npm-installed bin, deleting
# the runtime it is itself executing from — and then reinstalls, because a teardown nobody
# can come back from is not a roundtrip.
echo; echo "[9] entwurf herdr-plugin-deactivate, then reinstall"
"$ACTIVE/node_modules/.bin/entwurf" herdr-plugin-deactivate 2>&1 | sed 's/^/    /'
rc="${PIPESTATUS[0]}"
echo "    → exit $rc"
[ "$rc" -eq 0 ] && ok "herdr-plugin-deactivate exit 0 from the installed bin (it deleted its own runtime)" || bad "herdr-plugin-deactivate exit $rc"

node -e '
const fs = require("node:fs");
const path = require("node:path");
const [ledger, runtimeRoot, piSettings, piBaseline, claudeUserConfig, dataRoot] = process.argv.slice(1);
let bad = 0;
const ok = (m) => console.log("  ok    " + m);
const no = (m) => { console.log("  FAIL  " + m); bad = 1; };
const readOrNull = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

fs.existsSync(ledger) ? no(`the activation ledger survived at ${ledger}`) : ok("the activation ledger is retired");
fs.existsSync(runtimeRoot) ? no(`the runtime root survived at ${runtimeRoot}`) : ok("the stable runtime root is gone");

// The same oracle shape as [QK:HAC-DEACTIVATE-ROUNDTRIP]: JSON equality against what the
// host carried BEFORE the plugin touched it. `<absent>` is a real baseline too — a file the
// plugin created must not be left behind carrying our entry.
const before = readOrNull(piBaseline);
const after = readOrNull(piSettings);
console.log(`  PI-SETTINGS before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
if (before === null) {
  // NOT "absent, or anything without the word entwurf in it" (A5 D2). remove() is a FILTER,
  // not a file deletion: it rewrites data[packages] without our entries and writes the file
  // back, preserving every other key (register-pi-package.py:22,307-323). Deleting a
  // settings file it never created would be over-reach, so an emptied packages[] is the
  // CONTRACTED residue of a file the plugin itself created — and this branch runs only when
  // there was no baseline, which is exactly that case. The oracle is that shell and nothing
  // else: a surviving extra key, or somebody else packages left in the array, is a teardown
  // that left something behind, and the old substring test called both of those clean.
  const EMPTY_SHELL = JSON.stringify({ packages: [] });
  JSON.stringify(after) === EMPTY_SHELL
    ? ok(`pi settings are the contracted empty shell ${EMPTY_SHELL} — the plugin created the file, remove() filtered it, nothing else survives`)
    : no(`the plugin-created pi settings are ${JSON.stringify(after)}, not the contracted empty shell ${EMPTY_SHELL}`);
} else {
  JSON.stringify(after) === JSON.stringify(before)
    ? ok("pi settings are JSON-equal to their pre-plugin meaning")
    : no("pi settings did not return to their pre-plugin meaning");
}

const claude = readOrNull(claudeUserConfig) ?? {};
const owned = Object.keys(claude.mcpServers ?? {}).filter((k) => k.includes("entwurf"));
owned.length === 0 ? ok("the Claude MCP owner entry is gone") : no(`Claude MCP still carries ${JSON.stringify(owned)}`);

// FILES, not directories: an emptied pi-package/ is a reclaimed install-state, and calling
// the surviving directory name dirty would fail a clean inverse.
const leftover = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs); else leftover.push(path.relative(dataRoot, abs));
  }
};
walk(dataRoot);
leftover.length === 0 ? ok("zero install-state files survive under the entwurf data root") : no(`install-state survived: ${JSON.stringify(leftover)}`);
process.exit(bad);
' "$LEDGER" "$DATA/entwurf/herdr-plugin/runtime" "$HOME/.pi/agent/settings.json" /tmp/pi-settings-pre-plugin.json "$HOME/.claude.json" "$DATA/entwurf" || fail=1

# The return leg. Same serverless path as [2] and [4] — the headless server from [8] was
# stopped — so a green here is the plugin reinstalling onto a host it had fully left.
herdr plugin install "$REMOTE_SPEC" --ref "$REQUESTED_REF" --yes 2>&1 | sed 's/^/    /'
rc="${PIPESTATUS[0]}"
echo "    → exit $rc"
[ "$rc" -eq 0 ] && ok "reinstall after a full teardown exit 0" || bad "reinstall after teardown exited $rc"
node -e '
const fs = require("node:fs");
const [ledger] = process.argv.slice(1);
if (!fs.existsSync(ledger)) { console.log(`  FAIL  no activation ledger after the reinstall (${ledger})`); process.exit(1); }
const led = JSON.parse(fs.readFileSync(ledger, "utf8"));
const b = led.activatedBackends;
if (JSON.stringify(b) === JSON.stringify(["pi", "claude-code"])) { console.log(`  ok    the reinstall restored activatedBackends === ["pi","claude-code"]`); process.exit(0); }
console.log(`  FAIL  ledger activatedBackends === ${JSON.stringify(b)} after the reinstall`);
process.exit(1);
' "$LEDGER" || fail=1

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
