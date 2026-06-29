---
description: Prepare an entwurf release — changelog promote → version bump → commit
argument-hint: "<version>  (e.g. 0.4.11 — no leading 'v', digits and dots only)"
---

You are preparing a standard release for entwurf.

User-supplied version: $ARGUMENTS

This command is **preparation-only**. It updates `CHANGELOG.md`, bumps
`package.json`, refreshes the lockfile, runs checks, and commits the release
prep. It does **not** tag, push, create a GitHub release, stamp, or notify.
After this command succeeds, the repo should be ready for
`/make-release <version>`.

## Goal

Finish the documented release pre-work so that `/make-release <version>` can
run on a **clean HEAD** without additional edits.

Release-ready means all of the following are true:
- `CHANGELOG.md` contains `## <version> — YYYY-MM-DD`
- `package.json` version equals `<version>`
- `pnpm-lock.yaml` is refreshed if needed
- `pnpm check` passes as the deterministic/static floor
- a fresh `./run.sh release-gate <scratch-project-dir>` passes and its log/artifact paths are recorded in `CHANGELOG.md` or the operator handoff
- all release-prep changes are committed
- `git diff-index --quiet HEAD --` succeeds

## Context and constraints

- This command is the preparation half of release.
- `/make-release` is the execution half.
- Do not tag.
- Do not push.
- Do not create a GitHub release.
- Do not run `npm publish`.
- If the working tree contains unrelated modifications, stop and ask.
- Commit only files that belong to release prep.

## Process

### 0. Argument shape

```bash
case "$ARGUMENTS" in
  "" )       echo "ABORT: version required (e.g. 0.4.9)"; exit 1 ;;
  v* )       echo "ABORT: drop leading 'v' (use 0.4.9 not v0.4.9)"; exit 1 ;;
  *[!0-9.]*) echo "ABORT: version must be digits + dots only"; exit 1 ;;
esac
```

### 1. Refresh `## Unreleased`

Use the repo changelog rules and the recent commit history since the last tag.
Read the relevant files before editing.

Minimum audit steps:

```bash
git tag --sort=-version:refname | head -1
git log "$(git tag --sort=-version:refname | head -1)"..HEAD --oneline
```

Then update `CHANGELOG.md` so `## Unreleased` accurately reflects the current
work.

### 2. Promote release section

Promote:

```text
## Unreleased
```

to:

```text
## Unreleased

## <version> — YYYY-MM-DD
```

Keep a fresh empty `## Unreleased` above the new version section.

### 3. Bump version + lockfile

```bash
VERSION="$ARGUMENTS"
npm version "$VERSION" --no-git-tag-version
pnpm install --lockfile-only
```

### 4. Static quality gate

```bash
pnpm check
```

The deterministic/static floor must pass. The exact gate set evolves with the repo; do not summarize it as a fixed count.

### 5. Live release gate

Run the official release prerequisite from a fresh scratch project and preserve the evidence paths:

```bash
SCRATCH=$(mktemp -d /tmp/psa-release-gate-${VERSION}.XXXXXX)
LIVE=1 ./run.sh release-gate "$SCRATCH"
```

0.11.0+ release-gate reports a **two-tier** summary. The **MUST** tier is release-blocking and owns the exit code; the **BEHAVIOR** tier is advisory model-in-loop signal (for example S7 Bash-bypass) and must be recorded but does not block the cut.

Expected 0.11.0 shape:

```text
MUST: PASS=17  FAIL=0  SKIP=0
BEHAVIOR: PASS=<n>  FAIL=<n>   # advisory / non-blocking
```

If any MUST step fails, stop at the failing axis and fix or explicitly classify it before committing release prep. Do not replace this with `pnpm check`; the live gate is the release floor. A BEHAVIOR fail is not a release blocker, but its count and artifact/log path must be recorded honestly in `CHANGELOG.md` or the operator handoff.

### 6. Commit release prep

Commit the bump + changelog promotion together. Use a concise Conventional
Commits-style subject, for example:

```text
chore(release): prepare v<version>
```

Stage only release-prep files.

### 7. Final readiness check

```bash
VERSION="$ARGUMENTS"
test "$(node -p "require('./package.json').version")" = "$VERSION"
grep -q "^## ${VERSION}\b" CHANGELOG.md
git diff-index --quiet HEAD --
```

## Output

Report:
- prepared version
- commit SHA
- whether `pnpm check` passed
- release-gate log/artifact/scratch paths and the two-tier summary (`MUST PASS=<n> FAIL=0 SKIP=<n>` plus `BEHAVIOR PASS=<n> FAIL=<n>` advisory split)
- whether the tree is clean
- explicit final line:

```text
Ready for /make-release <version>
```

## What this does NOT do

- tag creation
- `git push`
- agenda stamp
- GitHub release creation
- Google Chat notify
- `npm publish`

Those belong to `/make-release <version>`.
