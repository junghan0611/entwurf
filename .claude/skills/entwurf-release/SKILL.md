---
name: entwurf-release
description: "Operate entwurf SemVer releases through two explicit modes: prepare and make. Use for release preparation, CHANGELOG promotion, package version and lockfile updates, static and LIVE release gates, release-prep commits, clean-HEAD tag/push preflight, agenda stamping, GitHub releases, prerelease versions such as 0.12.8-repair.0, and repair-tag publication handoffs. npm publish remains a separately authorized action. Triggers: prepare-release, make-release, release prep, release cut, prerelease, repair release."
user_invocable: true
---

# entwurf-release

Repository: `~/repos/gh/entwurf`.

This skill is the shared release-operation SSOT that replaces the former
`.pi/prompts/prepare-release.md` and `.pi/prompts/make-release.md` files.
Claude Code discovers it natively under `.claude/skills/`; pi discovers the same
file through `.pi/settings.json` and its `"skills": ["../.claude/skills"]`
entry.

## Invocation

```text
# Claude Code
/entwurf-release prepare 0.12.8-repair.0
/entwurf-release make 0.12.8-repair.0

# pi
/skill:entwurf-release prepare 0.12.8-repair.0
/skill:entwurf-release make 0.12.8-repair.0
```

Natural-language requests map to the same two modes.

- `prepare` edits release records, runs gates, and creates the release-prep
  commit. It never tags or pushes.
- `make` operates only on an already prepared clean HEAD and performs the
  tag/push/GitHub release sequence.

If the mode or version is missing, ask for it and stop. A prepare request is not
make authorization. A make request is not npm-publish authorization.

## Shared version contract

Accept a normal SemVer release or prerelease. Reject a leading `v`.

```bash
VERSION="<user argument>"
case "$VERSION" in
  "") echo "ABORT: version required (for example 0.12.8 or 0.12.8-repair.0)"; exit 1 ;;
  v*) echo "ABORT: drop the leading 'v'"; exit 1 ;;
esac
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
  echo "ABORT: version must be SemVer, optionally with a prerelease suffix"
  exit 1
fi
```

Valid examples: `0.12.8`, `0.12.8-repair`, and `0.12.8-repair.0`.
`npm version` remains the final package-version validator.

---

# PREPARE

Prepare edits, verifies, and commits. It does not tag or push.

## P0. Establish the release boundary

1. Read `AGENTS.md`, `NEXT.md`, and `VERIFY.md`. A narrower current release
   contract in those files overrides a generic instruction in this skill.
2. Read the `commit` skill before creating any commit.
3. Inspect the current state.

```bash
git status --short --branch
git diff --check
```

Do not mix pre-existing implementation or review fixes into the release-prep
commit. If a completed, clearly scoped fix is present and GLG has approved its
commit, close it as a separate atomic commit first. If the scope is ambiguous or
unrelated, stop and ask.

The prepare mode may commit only release-prep files such as `CHANGELOG.md`,
`package.json`, `pnpm-lock.yaml`, and an evidence handoff explicitly required by
the current release contract.

Forbidden in prepare mode:

- tags
- pushes
- GitHub releases
- release agenda stamps
- notifications
- npm publication

## P1. Audit changes since the last release

```bash
LAST_TAG=$(git tag --sort=-version:refname | head -1)
printf 'baseline=%s\n' "$LAST_TAG"
git log "${LAST_TAG}..HEAD" --oneline
```

Compare the commit range and closed `NEXT.md` work with the existing
`CHANGELOG.md` `## Unreleased` section. Record only verified changes. Do not
rewrite historical release sections.

## P2. Promote the release section

Use the current KST date and transform the top of the changelog into this shape:

```text
## Unreleased

## <VERSION> - YYYY-MM-DD
```

Keep a fresh empty `## Unreleased` section above the promoted release body.
Preserve the repository's existing heading punctuation if it uses an em dash.

Release-gate paths and summaries may live in the release section or in an
explicit operator handoff, following the repository's current convention. The
paths and the MUST/BEHAVIOR counts must not be lost.

## P3. Update package version and lockfile

```bash
VERSION="<validated version>"
npm version "$VERSION" --no-git-tag-version
pnpm install --lockfile-only
```

Inspect the resulting diff. Do not manufacture a lockfile change when the
resolver produced none.

## P4. Run the deterministic floor

```bash
pnpm check
```

Do not summarize the aggregate as a fixed number of gates. The current
`package.json` check script is the SSOT. If any check fails, stop at that axis,
fix it, and rerun the complete aggregate.

## P5. Run the LIVE release gate from fresh scratch

Use the `tmux` skill because this command is long-running. Preserve both the
scratch directory and the complete log.

```bash
VERSION="<validated version>"
SCRATCH=$(mktemp -d "/tmp/psa-release-gate-${VERSION}.XXXXXX")
LOG="/tmp/pi-tmux-entwurf-release-gate-${VERSION}.log"
set -o pipefail
LIVE=1 ./run.sh release-gate "$SCRATCH" 2>&1 | tee "$LOG"
```

The release gate has two tiers:

- `MUST` is release-blocking and owns the exit code. `FAIL` must be zero.
- `BEHAVIOR` is advisory model-in-loop evidence. A failure does not block the
  release, but its PASS/FAIL counts and artifact/log path must be recorded.

Do not expect a fixed PASS count. Record the actual current output. Do not waive
a MUST failure without diagnosing and explicitly classifying the failing axis.
Do not hide a BEHAVIOR failure.

## P6. Apply release-specific acceptance

`NEXT.md` and `VERIFY.md` may require gates beyond `pnpm check` and the LIVE
release gate. Exact candidate tarballs, artifact-consumer CI, and installed-host
doctors are release contracts when those documents require them; none may be
replaced by a weaker generic gate.

For #51-style repair releases:

- A checkout pack-once green result is not release-artifact evidence.
- After the version commit, create and preserve one candidate tarball.
- Run
  `ENTWURF_CANDIDATE_TGZ=<absolute-path> ./run.sh check-install-container`
  so the gate consumes those exact bytes without repacking.
- Preserve the canonical path, SHA-256, image ID, and repository digest.
- Publishing that same tarball is not automatic in either prepare or make mode.

If an additional acceptance step can run only after a commit or push, record the
exact next gate in the handoff. Never claim an unrun gate as passed.

## P7. Create the release-prep commit

Stage only release-prep files. Never pull preceding implementation changes into
this commit.

```bash
git status --short
git diff --check
git diff --cached --check
git commit -m "chore(release): prepare v${VERSION}"
```

Do not bypass hooks. A commit request does not authorize a push.

## P8. Final preparation check

```bash
VERSION="<validated version>"
test "$(node -p "require('./package.json').version")" = "$VERSION"
grep -qE "^## ${VERSION}([[:space:]]|$)" CHANGELOG.md
git diff-index --quiet HEAD --
```

Report:

- prepared version and commit SHA
- `pnpm check` result
- release-gate scratch, log, and artifact paths
- actual `MUST: PASS=n FAIL=0 SKIP=n`
- actual `BEHAVIOR: PASS=n FAIL=n`
- completion or remaining status of release-specific acceptance
- clean-tree result

Only when every make prerequisite is closed, end with:

```text
Ready for /skill:entwurf-release make <version>
```

---

# MAKE

Make tags, pushes, stamps, and creates the GitHub release from a prepared clean
HEAD. It does not edit release files.

A `make <version>` invocation is explicit authorization for the tag and release
sequence. Read the `tag-release` skill before proceeding so its global push,
safety, and stamp rules remain active. Make mode still does not authorize npm
publication.

## M0. Preflight

Abort on the first failed check.

### Clean tree, version, changelog, and evidence

```bash
VERSION="<validated version>"
git diff-index --quiet HEAD --
test -z "$(git tag -l "v${VERSION}")"
test -z "$(git ls-remote --tags origin "v${VERSION}")"
grep -qE "^## ${VERSION}([[:space:]]|$)" CHANGELOG.md
test "$(node -p "require('./package.json').version")" = "$VERSION"
pnpm check
```

Confirm that a fresh release-gate scratch/log path and its actual MUST/BEHAVIOR
summary are present in the changelog or operator handoff. Do not tag when MUST
has a failure, evidence is missing, or `NEXT.md` still names a release-specific
blocker.

### GitHub identity and target

```bash
gh auth status
REMOTE=$(git remote get-url origin)
EXPECTED_REPO=$(printf '%s\n' "$REMOTE" | sed -E 's#^git@github(-[a-z]+)?\.com:##; s#^https://github.com/##; s#\.git$##')
GH_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
GH_PERM=$(gh repo view --json viewerPermission --jq .viewerPermission)
test "$GH_REPO" = "$EXPECTED_REPO"
case "$GH_PERM" in
  ADMIN|MAINTAIN|WRITE) ;;
  *) echo "ABORT: GitHub permission is $GH_PERM; WRITE or higher is required"; exit 1 ;;
esac
```

### Push dry-run

```bash
git push --dry-run origin main
git push --dry-run origin "HEAD:refs/tags/v${VERSION}"
```

## M1. Tag and push

Create a lightweight tag pointing exactly at the prepared HEAD.

```bash
SHA=$(git rev-parse HEAD)
git tag "v${VERSION}" "$SHA"
git push origin main
git push origin "v${VERSION}"
```

Never force and never bypass verification. If a push fails, stop before stamp,
GitHub release creation, or notification.

## M2. Stamp the agenda

```bash
REMOTE=$(git remote get-url origin)
REPO_URL=$(echo "$REMOTE" | sed -E 's|git@github(-[a-z]+)?\.com:|https://github.com/|;s|\.git$||')
REPO_NAME=$(basename "$REMOTE" .git)
REPO_TAG=$(echo "$REPO_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[-.]//g')
STAMP="$HOME/.pi/agent/skills/pi-skills/agenda/scripts/agenda-stamp.sh"
[ -x "$STAMP" ] || STAMP="$HOME/.claude/skills/agenda/scripts/agenda-stamp.sh"
"$STAMP" \
  "${REPO_NAME}: release v${VERSION} [[${REPO_URL}/releases/tag/v${VERSION}][v${VERSION}]]" \
  "pi:release:${REPO_TAG}"
```

If the stamp fails, report the exact command and error and stop. Do not invent a
manual fallback on the agenda target.

## M3. Create and verify the GitHub release

```bash
NOTES_FILE="/tmp/release-notes-v${VERSION}.md"
VERSION="$VERSION" python3 - <<'PY'
import os
from pathlib import Path

version = os.environ["VERSION"]
lines = Path("CHANGELOG.md").read_text().splitlines()
out = []
inside = False
for line in lines:
    if line.startswith(f"## {version} ") or line == f"## {version}":
        inside = True
        continue
    if inside and line.startswith("## "):
        break
    if inside:
        out.append(line)
Path(f"/tmp/release-notes-v{version}.md").write_text("\n".join(out).strip() + "\n")
PY

test -s "$NOTES_FILE"
gh release create "v${VERSION}" --title "v${VERSION}" --notes-file "$NOTES_FILE"
gh release view "v${VERSION}" --json tagName,name,url
rm -f "$NOTES_FILE"
```

Do not notify until `gh release view` verifies the expected tag.

## M4. Notify

Run only after the GitHub release is verified.

```bash
source ~/.env.local
gog chat messages send "$GOG_CHAT_SPACE_ID" \
  --account "$GOG_CHAT_ACCOUNT" \
  --text "entwurf v${VERSION} released
${REPO_URL}/releases/tag/v${VERSION}"
```

A notification failure does not undo an existing release, but it must be
reported exactly.

## M5. npm artifact publication requires separate authorization

Make mode never runs `npm publish`. A repair dist-tag is independent from the
GitHub tag. Only when GLG explicitly authorizes publication in the current
session may the already accepted preserved tarball be published.

```bash
npm publish <same-preserved.tgz> --tag repair
npm view @junghanacs/entwurf dist-tags --json
```

Immediately prove the registry-installed package source, not the checkout or the
preserved local tarball:

```bash
TMP_AGENT=$(mktemp -d -t entwurf-registry-smoke.XXXXXX)
PI_CODING_AGENT_DIR="$TMP_AGENT" pi install "npm:@junghanacs/entwurf@${VERSION}"
printf '%s\n' "{ \"packages\": [\"npm:@junghanacs/entwurf@${VERSION}\"] }" > "$TMP_AGENT/settings.json"
BRIDGE=$(PI_CODING_AGENT_DIR="$TMP_AGENT" node --experimental-strip-types scripts/resolve-acp-bridge.ts)
test "$BRIDGE" = "$TMP_AGENT/npm/node_modules/@junghanacs/entwurf"
PI_CODING_AGENT_DIR="$TMP_AGENT" pi --no-extensions -e "$BRIDGE" --list-models entwurf
rm -rf "$TMP_AGENT"
```

The output must include `entwurf` and the curated Claude anchors, with no
`Unknown provider` or `No models matching` error. A failed registry smoke after
publication is a stop-and-classify event; do not notify downstream consumers.
Downstream consumer pin bumps remain a separate repository operation.

For the current #51 contract, verify `latest=0.12.7` and
`repair=<approved version>`. After publication, the final Linux recovery proof
is:

1. Install the approved package on the target host.
2. Run installed `entwurf install-meta-bridge`.
3. Restart every already-open Claude Code session.
4. Open a new session with its live MCP child.
5. Require installed `entwurf doctor-meta-bridge` to pass.

## Half-release recovery

| State | Recovery |
|---|---|
| Local tag exists; push failed | Fix the cause and retry M1 push |
| Tag is pushed; GitHub release is absent | Resume at M3 |
| GitHub release exists; notification failed | Resume at M4 only |
| Wrong local tag; not pushed | Delete the local tag and rerun preflight |
| Wrong pushed tag | Do not force; report to GLG |
