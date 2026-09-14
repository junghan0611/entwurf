#!/usr/bin/env bash
# install-herdr-ci — put the MEASURED herdr binary on PATH for one CI job, and nothing else.
#
# This is not an installer for people. `entwurf setup` does not call it, the package does not
# ship it as a command, and it never writes outside the runner's temp dir: Hard Rule 17 says
# Entwurf supplies Entwurf's bytes, never a harness or a placement owner's. A CI job that wants
# the herdr rail proven fetches the exact asset this repository has measured, checks its digest
# BEFORE the file is ever made executable, and exposes only that one directory to later steps.
#
# What is deliberately NOT here, each for a reason:
#   - no `curl … | sh`. A pipe to a shell has no version and no digest to check; whatever the
#     upstream script does today it can do something else tomorrow, and the whole point of this
#     file is that CI runs a byte we have named.
#   - no package manager (brew/mise/nix). Each adds a layer whose contents we would then be
#     asserting about without measuring.
#   - no `latest`. A mutable URL turns a green run into a claim about a binary nobody chose.
#   - no `gh attestation verify`. `[측정 2026-09-14, gh 2.97.0]` it cannot close herdr's
#     predicate (`in-toto release/v0.2`) — default is 404, explicit is "no attestations found",
#     while the REST API returns the attestation. A check we cannot run is not a check.
#   - no global install, no ~/.local/bin, no sudo. The binary lives and dies with the job.
#
# Every version and digest comes from scripts/fixtures/herdr-supply.json. This file contains
# none of its own, on purpose: two copies of a digest is how a pin drifts.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${repo_dir}/scripts/fixtures/herdr-supply.json"

fail() {
	echo "[install-herdr-ci] FAIL — $1" >&2
	exit 1
}

[ -f "$manifest" ] || fail "the supply manifest is missing: ${manifest}"

# The runner's temp dir in CI; a private mktemp when someone runs this by hand. Never a
# directory that outlives the job.
dest_dir="${RUNNER_TEMP:-}"
if [ -z "$dest_dir" ]; then
	dest_dir="$(mktemp -d)"
fi
mkdir -p "$dest_dir"

read_manifest() {
	node -e '
		const fs = require("node:fs");
		const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
		const arch = process.argv[2];
		const asset = m.assets[arch];
		if (!asset) {
			// Fail closed. A machine architecture we have never measured does not get a
			// "closest" binary — there is no such thing.
			process.stderr.write(`unsupported architecture ${arch}; measured: ${Object.keys(m.assets).join(", ")}\n`);
			process.exit(3);
		}
		process.stdout.write([m.version, m.releaseUrlPrefix, m.tag, asset.name, asset.sha256].join("\n"));
	' "$manifest" "$1"
}

arch="$(uname -m)"
if ! fields="$(read_manifest "$arch")"; then
	fail "no measured herdr asset for $(uname -m) — the supply manifest owns that set"
fi
version="$(echo "$fields" | sed -n 1p)"
url_prefix="$(echo "$fields" | sed -n 2p)"
tag="$(echo "$fields" | sed -n 3p)"
asset_name="$(echo "$fields" | sed -n 4p)"
expected_sha="$(echo "$fields" | sed -n 5p)"

url="${url_prefix}/${tag}/${asset_name}"
target="${dest_dir}/herdr"

echo "[install-herdr-ci] fetching ${asset_name} (${tag}) for ${arch}"
curl -fsSL --retry 3 --retry-delay 2 -o "$target" "$url" || fail "download failed: ${url}"

# ORDER IS THE SAFETY ARGUMENT: the digest is checked while the file is still inert data.
# chmod comes after, so a byte we did not choose never becomes a thing this job can run.
actual_sha="$(sha256sum "$target" | cut -d' ' -f1)"
if [ "$actual_sha" != "$expected_sha" ]; then
	rm -f "$target"
	fail "digest mismatch for ${asset_name}: expected ${expected_sha}, got ${actual_sha}"
fi
chmod +x "$target"

reported="$("$target" --version 2>/dev/null || true)"
case "$reported" in
*"herdr ${version}"*) ;;
*) fail "the verified binary reports '${reported}', not 'herdr ${version}' — the manifest and the artifact disagree" ;;
esac

# Only this directory reaches later steps. Nothing is copied into a shared bin dir.
if [ -n "${GITHUB_PATH:-}" ]; then
	echo "$dest_dir" >>"$GITHUB_PATH"
fi
echo "[install-herdr-ci] ok — ${reported} at ${target} (sha256 ${expected_sha})"
echo "$dest_dir"
