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

That job is now **required**, not `continue-on-error`.

**The lane is committed and pushed.** `9cc5b09 feat(macos): make the shipped surface portable and
stop discovery gaps reading as clean` (34 files) sits on top of `70eda03`, and its own CI run
[`34316688064`](https://github.com/junghan0611/entwurf/actions/runs/34316688064) is **four jobs
green with the `check` job's qualification step concluding success** — the four-axis release
oracle would accept this SHA. A second, smaller commit closing the side-eye review is in the
worktree on top of it.

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

1. Close the side-eye review (grok, `20260909T151557-9eff5b`, on the pushed `9cc5b09`): **Blocker 0
   / Defect 3 / Observation 5.** The one defect this lane itself created is D1 — opening the
   install fences made `entwurf setup` on a Darwin host **with a harness present** print
   `result: green`, because setup grades "detected + install completed" and never runs the doctor,
   while the Darwin doctor is always nonzero. Documents and doctors stay honest; the command
   operators actually type does not. D2/D3 were the two NEXT files disagreeing with each other,
   and the uninstall refusal string still describing the retired install-side fence.
2. `pnpm run check:full` once on the frozen candidate, then `check-gate-qualification` once —
   this lane touched gates, mutants and manifests, so the scheduling contract requires the body.
   Nothing may edit the worktree while either runs, including this file.
3. GLG commits and pushes; CI must come back four-green with the qualification step success.
4. Borrowed Mac: run `sh scripts/raw-macos-measure/probe.sh` **once** — no entwurf install, no
   login, ~3.5s — and paste the whole output into the ledger under a `[host-darwin]` heading.
   That single command closes acceptance items 1–6. Items 7–9 need a logged-in harness.
5. GLG names 0.20.0. "macOS parity" would overclaim; "install surface CERTIFIED (CI) + shipped
   path portable, rails pending the borrowed-Mac receipt" is what the evidence carries.
6. 0.20.0 through the four release modes, each its own GLG approval.

## Carried observations — named, not opened

From the side-eye review; none is this lane's subject, all predate it:

- **agy's two doctors fold `pgrep` the way omp did** (`scripts/agy-bridge.sh:425-448`,
  `scripts/agy-statusline-bridge.sh:150-169`): exit 1, exit 2 and an absent `pgrep` all become
  one `live: SKIP`, so a failed enumeration skips the only live-RED. Same shape as B1, different
  axis (live-wiring, not identity).
- **Doctor asymmetry.** The Claude doctor is always red on Darwin; omp-birth and copilot-birth
  have no platform gate and can PASS with no live process. Only copilot-receive is always
  `UNVERIFIABLE` without `/proc`. Reading "doctor green" as "rail certified" is misled by the
  first two before it reaches the third.
- **`command -v python3` is presence, not function.** A macOS CommandLineTools stub is on PATH
  and fails when executed; the installer would die later, inside python. Probe cell M3 measures
  exactly this — decide after the Mac, not before.

## Do not

Touch the three Linux CI jobs · open native Windows · relabel WSL as Windows evidence · promote
macOS to supported without a physical receipt · comment on #78 (coordinator's) · touch #95.
