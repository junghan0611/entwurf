---
description: Prepare a pi-shell-acp release — changelog promote → version bump → commit
argument-hint: "<version>  (e.g. 0.4.11 — no leading 'v', digits and dots only)"
---

You are preparing a standard release for pi-shell-acp.

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
- `pnpm check` passes
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

### 4. Quality gate

```bash
pnpm check
```

All eight static gates must pass.

### 5. Commit release prep

Commit the bump + changelog promotion together. Use a concise Conventional
Commits-style subject, for example:

```text
chore(release): prepare v<version>
```

Stage only release-prep files.

### 6. Final readiness check

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
