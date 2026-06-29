---
description: Cut a release of entwurf — pre-flight → tag → push → stamp → notes → release → verify → notify
argument-hint: "<version>  (e.g. 0.4.9 — no leading 'v', digits and dots only)"
---

You are running a standard release for entwurf.

User-supplied version: $ARGUMENTS

This command is **execution-only**. It does **not** prepare the tree.
Preparation belongs to `/prepare-release <version>`.

`/make-release <version>` assumes the repo is already release-ready:
- `CHANGELOG.md` already has `## <version> — YYYY-MM-DD`
- `package.json` already matches `<version>`
- release-prep changes are already committed
- a fresh `./run.sh release-gate <scratch-project-dir>` artifact is recorded in `CHANGELOG.md` / the operator notes
- `git diff-index --quiet HEAD --` already passes

This command tags HEAD, pushes, stamps, extracts release notes from
`CHANGELOG.md`, creates the GitHub release, verifies, and notifies.
It does **not** bump `package.json`, commit, run the live release gate,
or run `npm publish`.

## Variable contract

Slash command bash invocations are not guaranteed to share state. Each
step below restates `VERSION="$ARGUMENTS"` and re-derives any other
variables it needs (`REMOTE`, `REPO_URL`, `REPO_NAME`, `REPO_TAG`).

Do not assume any variable from a prior step is still defined.

## Pre-flight (must all pass — abort on first failure)

### 0. Argument shape

```bash
case "$ARGUMENTS" in
  "" )       echo "ABORT: version required (e.g. 0.4.9)"; exit 1 ;;
  v* )       echo "ABORT: drop leading 'v' (use 0.4.9 not v0.4.9)"; exit 1 ;;
  *[!0-9.]*) echo "ABORT: version must be digits + dots only"; exit 1 ;;
esac
```

### 1. Working tree clean

A staged-but-uncommitted tree is **not** release-ready. If this fails,
finish `/prepare-release <version>` first.

```bash
git diff-index --quiet HEAD --
```

If exit non-zero, abort. Commit or stash first.

### 2. Tag does not already exist

```bash
VERSION="$ARGUMENTS"
test -z "$(git tag -l "v${VERSION}")"
test -z "$(git ls-remote --tags origin "v${VERSION}")"
```

If either is non-empty, abort — the release was already done or
partially done. See **Recovery** at the bottom.

### 3. CHANGELOG has the section

If this fails, run `/prepare-release <version>` first.

```bash
VERSION="$ARGUMENTS"
grep -q "^## ${VERSION}\b" CHANGELOG.md
```

If missing, the operator pre-work step 2 (promote `## Unreleased`)
was not done. Abort.

### 4. package.json version matches

If this fails, run `/prepare-release <version>` first.

```bash
VERSION="$ARGUMENTS"
test "$(node -p "require('./package.json').version")" = "${VERSION}"
```

If mismatch, the operator pre-work step 3 (npm version bump) was not
done. Abort.

### 5. Static sanity gate

```bash
pnpm check
```

`pnpm check` is the deterministic/static floor and a cheap last-minute sanity check. The release prerequisite is stricter: `/prepare-release <version>` or the operator must already have run a fresh `./run.sh release-gate <scratch-project-dir>` and recorded the evidence. Do **not** rerun the live release gate from `/make-release`; this command is execution-only and should not spend another full live-gate cycle after HEAD is already release-ready.

### 6. Release-gate evidence is recorded

Confirm manually (do not invent paths) that the version's `CHANGELOG.md` section or the operator handoff records the fresh release-gate evidence. 0.11.0+ uses the two-tier release-gate summary: **MUST** is release-blocking and owns the exit code; **BEHAVIOR** is advisory and must be recorded but does not block the cut.

```text
./run.sh release-gate <scratch-project-dir>
MUST: PASS=<n> FAIL=0 SKIP=<n>
BEHAVIOR: PASS=<n> FAIL=<n>   # advisory / non-blocking
```

If the fresh MUST evidence is missing or has `FAIL>0`, abort and return to `/prepare-release <version>` / the release-prep session.

### 7. GitHub auth + target consistency

```bash
gh auth status

REMOTE=$(git remote get-url origin)
EXPECTED_REPO=$(printf '%s\n' "$REMOTE" | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\.git$##')

GH_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
GH_PERM=$(gh repo view --json viewerPermission --jq .viewerPermission)

test "$GH_REPO" = "$EXPECTED_REPO"
case "$GH_PERM" in
  ADMIN|MAINTAIN|WRITE) ;;
  *) echo "ABORT: GitHub viewerPermission is $GH_PERM (need WRITE+)"; exit 1 ;;
esac
```

If `gh` is authenticated against the wrong account/host or is pointed at a
repo different from `origin`, abort before tagging.

### 8. Push dry-run

```bash
VERSION="$ARGUMENTS"
git push --dry-run origin main
git push --dry-run origin "HEAD:refs/tags/v${VERSION}"
```

This is the real permission/network/divergence check. `gh auth status`
alone proves login, not pushability.

## Steps

### Step 1 — Tag at HEAD

```bash
VERSION="$ARGUMENTS"
SHA=$(git rev-parse HEAD)
git tag "v${VERSION}" "$SHA"
git tag -l "v${VERSION}"
```

Lightweight tag is fine — release notes come from `--notes-file`, not
from tag annotation, so `--notes-from-tag` would just produce empty
release bodies. Do not use `--notes-from-tag`.

### Step 2 — Push main + tag

```bash
VERSION="$ARGUMENTS"
git push origin main
git push origin "v${VERSION}"
```

If push fails (network / auth / divergence), abort before stamp /
release / notify. Do not leave a half-released state.

### Step 3 — Agenda stamp

After push, the GitHub release URL resolves. Stamp links to the
release page (operator clicks → GitHub release in Emacs), and uses
the `pi:release:` tag (org-agenda can filter releases separately
from regular `pi:commit:` stamps).

```bash
VERSION="$ARGUMENTS"
REMOTE=$(git remote get-url origin)
REPO_URL=$(echo "$REMOTE" | sed 's|git@github.com:|https://github.com/|;s|\.git$||')
REPO_NAME=$(basename "$REMOTE" .git)
REPO_TAG=$(echo "$REPO_NAME" | sed 's/[-.]//g')

~/.pi/agent/skills/pi-skills/agenda/scripts/agenda-stamp.sh \
  "${REPO_NAME}: release v${VERSION} [[${REPO_URL}/releases/tag/v${VERSION}][v${VERSION}]]" \
  "pi:release:${REPO_TAG}"
```

Stamp failure is best-effort — log and proceed.

### Step 4 — Extract release notes from CHANGELOG

```bash
VERSION="$ARGUMENTS"
NOTES_FILE="/tmp/release-notes-v${VERSION}.md"

VERSION="$ARGUMENTS" python - <<'PY'
import os
from pathlib import Path
version = os.environ["VERSION"]
text = Path("CHANGELOG.md").read_text()
lines = text.splitlines()
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

test -s "$NOTES_FILE" || { echo "ABORT: empty release notes"; rm -f "$NOTES_FILE"; exit 1; }
cat "$NOTES_FILE"
```

Use Python here rather than a fragile one-liner `awk` range expression.
The release step must be boring and deterministic.

If the CHANGELOG body needs flattening / tightening for the GitHub
release surface (e.g. internal cross-references trimmed), edit the
**temp file** — do not edit `CHANGELOG.md` itself. CHANGELOG is the
canonical record; release body is the public-surface render.

### Step 5 — GitHub release

```bash
VERSION="$ARGUMENTS"
NOTES_FILE="/tmp/release-notes-v${VERSION}.md"

gh release create "v${VERSION}" \
  --title "v${VERSION}" \
  --notes-file "$NOTES_FILE"
```

Title is fixed `v${VERSION}`. Release theme lives in the body's first
H3 (e.g. `### L5 — Memory containment`) and in the notify message
below. Title proliferation is what produces low-quality releases —
do not invent a title here.

If `gh release create` fails, abort before notify. Notification with
a broken link is worse than no notification.

### Step 6 — Verify

```bash
VERSION="$ARGUMENTS"
gh release view "v${VERSION}" --json tagName,name,url
```

Must return non-empty JSON with the correct `tagName`. If missing,
re-run Step 5. Do not proceed to notify with an unverified release.

### Step 7 — Notify Google Chat

```bash
VERSION="$ARGUMENTS"
REMOTE=$(git remote get-url origin)
REPO_URL=$(echo "$REMOTE" | sed 's|git@github.com:|https://github.com/|;s|\.git$||')
REPO_NAME=$(basename "$REMOTE" .git)

source ~/.env.local && gog chat messages send "$GOG_CHAT_SPACE_ID" \
  --account "$GOG_CHAT_ACCOUNT" \
  --text "🔨 *${REPO_NAME}* v${VERSION} released
→ ${REPO_URL}/releases/tag/v${VERSION}"
```

Optionally append a one-line theme summary (e.g. "L5 — Memory
Containment + claude-acp 0.32.0 / codex-acp 0.13.0") before sending.
Notify failure is best-effort — release is already published.

### Step 8 — Cleanup

```bash
VERSION="$ARGUMENTS"
rm -f "/tmp/release-notes-v${VERSION}.md"
```

## What this does NOT do

- **Does not bump `package.json`** — operator pre-work step 3.
- **Does not commit anything** — the agent's commit cycle is separate;
  this command does not author a "Release v..." commit. The release
  is identified by the tag, not by a marker commit.
- **Does not run `pnpm publish`** — operator decides separately. If the
  operator publishes the npm package after this command, run the post-publish
  registry smoke below before declaring the cut complete.
- **Does not auto-author release titles** — title is always
  `v<version>`, theme stays in the CHANGELOG body.
- **Does not bump downstream consumers** — `agent-config` pins
  entwurf by tag (`package.json` / `pi/settings.server.json` /
  `run.sh`'s `PI_SHELL_ACP_VERSION` / `CHANGELOG.md`). See
  agent-config's own `AGENTS.md § Release` for the consumer bump
  procedure.
- **Does not delete or move tags on failure** — operator inspects and
  retries. Force-pushing a moved tag to remote is out of scope here.

## Post-publish registry smoke (operator checklist)

If the operator runs `pnpm publish --access public`, immediately prove the
registry-installed package source, not just the local tarball:

```bash
VERSION="$ARGUMENTS"
TMP_AGENT=$(mktemp -d -t psa-registry-smoke.XXXXXX)
PI_CODING_AGENT_DIR="$TMP_AGENT" pi install "npm:@junghanacs/entwurf@${VERSION}"
printf '%s\n' "{ \"packages\": [\"npm:@junghanacs/entwurf@${VERSION}\"] }" > "$TMP_AGENT/settings.json"
BRIDGE=$(PI_CODING_AGENT_DIR="$TMP_AGENT" node --experimental-strip-types scripts/resolve-acp-bridge.ts)
test "$BRIDGE" = "$TMP_AGENT/npm/node_modules/@junghanacs/entwurf"
PI_CODING_AGENT_DIR="$TMP_AGENT" pi --no-extensions -e "$BRIDGE" --list-models entwurf
rm -rf "$TMP_AGENT"
```

Pass criteria: output includes `entwurf` and `claude-sonnet-4-6`, with no
`Unknown provider` / `No models matching`. If this fails after publish, stop and
ask GLG whether to deprecate/yank before notifying downstream consumers.

## Failure modes

| Failure | Action |
|---|---|
| pre-flight fail | abort, report which check failed |
| push fail (network / auth) | abort before stamp / release / notify |
| stamp fail | log, proceed (best-effort) |
| `gh release create` fail | abort before notify (broken-link prevention) |
| `gh release view` returns missing | abort, re-run Step 5 |
| notify fail | log (release already published) |

## Recovery if half-released

| State | Recovery |
|---|---|
| local tag exists, push failed | retry Step 2 |
| tag pushed, gh release missing | run Steps 4–7 |
| gh release exists, notify failed | run Step 7 only |
| local tag pointing at wrong commit, NOT pushed | `git tag -d v<version>`, fix HEAD, redo Step 1 |
| pushed tag pointing at wrong commit | out of scope — requires force-push, ask operator |

## Why no `scripts/release.sh`

Earlier releases used `scripts/release.sh` + `--notes-from-tag --title v<version>`. That combination is the cause of v0.4.7 / v0.4.6 / v0.4.1 / v0.3.x being published with empty release bodies and bare-version titles. The script created lightweight tags (no message), then `--notes-from-tag` produced empty bodies. Removed in 0.4.9. This prompt is now self-contained.
