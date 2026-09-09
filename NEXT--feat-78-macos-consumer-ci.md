# NEXT — feat/78-macos-consumer-ci (disposable; delete before merge)

> This file was rewritten on 2026-09-09 after the lane grew from "one non-voting CI job" into
> the macOS parity body of 0.20.0. The original boot sector described a pre-push state and its
> fence claims are now RETIRED — four of those installers no longer refuse Darwin. Keeping the
> old text would have left a reader inheriting a stale half.

## Where the lane is

**Pushed and green.** CI run [`34303884286`](https://github.com/junghan0611/entwurf/actions/runs/34303884286)
@ `70eda03`, `event=push`, **all four jobs success** — `check` 38m17s (with
`check-gate-qualification` **388/388 killed**, step conclusion success), `install-surface`,
`artifact-consumer`, and **`macos-install-surface` 65s, steps 10/10**.

That job is now **required**, not `continue-on-error`. Everything after `70eda03` is uncommitted
worktree.

## What the macOS run actually proved

`[measured, run 34303884286]` On `macos-latest`: `npm pack` → install into a clean consumer root
outside the checkout → npm bin linking → packed `entwurf --help` → packed `entwurf check-bridge`
(direct MCP smoke, 246ms, the exact seven garden tools + `test.sh`) → all-harness-absent
`entwurf setup` printing five SKIPs (pi/claude/agy/copilot/omp), `bins: PASS`, `core: PASS`, a
computed `result: green`, five zero-write path assertions, and a byte-identical `auth.json`.

None of the five predicted failure points fired — including the one ranked first,
`validate_entwurf_bridge`'s 3000ms first-frame timeout, which cleared with 12x margin.

**That is CERTIFIED (CI) for the Entwurf-only install surface. It is not a rail claim.**

## Three states — do not mix them

- **CERTIFIED (CI)** — the install surface above.
- **NOT CERTIFIED — pending physical host** — every harness rail, marker join, ACP turn, mux.
  GLG is borrowing a company Mac; the code lands now, the receipt comes later.
- **UNSUPPORTED** — native Windows only. Locked behind explicit GLG product-scale approval.

## Uncommitted work in this worktree

Agent reports (gitignored) carry the per-slice receipts: `.agent-reports/macos-*-20260909.md`.

1. **CI promotion** — `macos-install-surface` non-voting → required, across all five consumers of
   the required set (`ci.yml`, `verify-exact-ci.sh:67`, `VERIFY.md`, the release `SKILL.md`, and
   `check-install-surface.ts` S7g).
2. **Install fences opened** — `meta-bridge-install.sh`, `copilot-bridge-install.sh`,
   `omp-bridge-install.sh`, `omp-receive-install.sh` accept Darwin on the
   `meta-bridge-uninstall.sh:20-23` precedent. **The platform-name refusal was replaced by the
   installers' real dependency (python3), not deleted.** `smoke-meta-install-state.sh` moved in
   the same change: the retired "Darwin refuses" pin became four sub-proofs.
3. **Doctors** — python `start_key`/`parent` now carry the TS core's two-tier fallback and mint a
   byte-identical `ps:` key; the two `/proc`-as-predicate-input axes emit non-green
   `UNVERIFIABLE` instead of a fail-open `note`; the Darwin verdict stays nonzero with a narrowed
   reason. Found on the way: GNU BRE alternation `\(create\|attach\)` (no BSD equivalent) would
   have made a RECOVERED macOS host report as a false RED.
4. **Bins** — `readlink -f` → the POSIX symlink walk already shipped at
   `mcp/entwurf-bridge/start.sh:25-34`; `grep -P` → awk; `sha256sum` → the repo's existing python3
   hashlib digest (not `shasum`, to avoid a second digest convention).
5. **Prose** — the three-state vocabulary across README/BASELINE/ROADMAP/docs, a macOS row in
   BASELINE marked shape-only, a CHANGELOG `## Unreleased` entry, and the `StartKeyScheme` doc
   comment now recording that the two schemes differ in RESOLUTION.
6. **`scripts/raw-macos-measure/`** — the borrowed-Mac probe (`/bin/sh`, cells M1–M9, ~3.5s) plus
   its ledger. Covers acceptance-checklist items 1–6, none of which need an entwurf install.

## Decisions that are settled — do not relitigate

- **start-key format does not change in 0.20.0.** `ps:` is 1-second resolution vs `linux:` 10ms,
  but a same-second pid reuse needs a full PID_MAX wrap inside one second (≈99,900 spawns/s vs a
  measured pathological ceiling of 14,873/s), the error direction only produces false `live`
  (never false `dead`), and the migration axis is measured empty (1,248 markers, all `linux:`,
  zero `ps:`). Graded Observation. Widening the key with argv was **refuted by measurement** —
  two same-argv children share the widened key, and same-argv restart is the normal harness shape.
- **No Darwin discovery mechanism was invented.** Probe cell M6 measures whether `ps -Eww` can
  read a foreign environment; until that receipt exists the axes stay `UNVERIFIABLE`.
- **`~/AGENTS.md` + repo `AGENTS.md` sit ~1.2KB under the 51,200-byte ACP augment cap.** Do not
  add prose to `AGENTS.md` in this lane.

## Next

1. Land the amendment bundle from the two independent reviews (terra: 2 Blocker / 4 Defect /
   1 Observation; grok: 0 / 9 / 6). The Blockers are both the same class and both reachable on
   Linux: a failed discovery command collapsing into a clean verdict.
2. `pnpm run check:full` **once** on the frozen candidate. Nothing may edit the worktree while it
   runs — including this file.
3. GLG commits.
4. Borrowed Mac: run `scripts/raw-macos-measure/probe.sh`, paste the output into the ledger under
   a `[host-darwin]` heading. Checklist items 7–9 need this code landed first.
5. 0.20.0 through the four release modes, each its own GLG approval.

## Do not

Touch the three Linux CI jobs · open native Windows · relabel WSL as Windows evidence · promote
macOS to supported without a physical receipt · comment on #78 (coordinator's) · touch #95.
