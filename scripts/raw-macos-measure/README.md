# raw-macos-measure — Darwin host measurement for the macOS parity lane (#78)

Lane: `#78` macOS row, opened by the first green `macos-install-surface` CI run
([`34303884286`](https://github.com/junghan0611/entwurf/actions/runs/34303884286) @ `70eda03`,
2026-09-09, `macos-latest`). That run certifies the **Entwurf-only install path** and nothing
else — it is CERTIFIED (CI), which in this repo is deliberately weaker than a physical-host
doctor green. This ledger is where the *rest* of the axis gets measured before any code claims it.

This file is a MEASUREMENT-ONLY ledger, on the `raw-codex-measure` precedent. Nothing here is
written by an entwurf installer, no meta-record is minted, and no operator config is edited.

**Evidence-state vocabulary:** **[host-linux]** = measured on the Linux oracle (control run —
tells us what the probe reports where we already know the answer); **[host-darwin]** = measured on
the borrowed Mac; **[source]** = read at `file:line`; **[hypothesis]** = inference not yet
confirmed by a run.

## Why a probe script and not a prose ledger

The other `raw-*-measure` lanes were written on the host that owns the vendor. This one is not:
the Darwin host is **borrowed**, so its measurement window is short and probably single-shot. The
executable half (`probe.sh`) exists so that window costs one command instead of a live debugging
session, and so a mistake in the probe is found on Linux rather than on the Mac.

```sh
./scripts/raw-macos-measure/probe.sh          # ~1.2s, writes nothing outside its own mktemp dir
```

It is `/bin/sh`, not bash, deliberately: macOS ships bash 3.2 and *what a shell may assume here*
is itself one of the measurements (cell M2). Every cell prints a verdict token — `PRESENT` /
`ABSENT` / `OK` / `FAIL` / `DIFFERS` / `UNKNOWN` — so no reader has to interpret raw tool output.

## Cells

| Cell | Question it answers | Consumer of the answer |
|---|---|---|
| **M1** | Which Darwin, which arch, which machine | BASELINE host record |
| **M2** | bash version at `/bin/bash` and via `env bash`; are bash-4 features (`declare -A`, `mapfile`) available | the two gates that use bash 4 (`check-install-container.sh`, `check-meta-doctor-oracle.sh`) |
| **M3** | node / npm / pnpm / python3 / git / tmux presence and versions, **and whether `python3` is the CommandLineTools stub** | `docs/setup-clean-host.md` requirements table; a stub python3 is a total failure of the install+doctor surface, not a degraded cell |
| **M4** | GNU-vs-BSD tool matrix, measured **behaviourally** (presence is not compatibility) | the P1 substitution surface — `sha256sum` (10 files), `stat -c` (19), `xargs -0` (13), `sort -z` (12), `realpath` (11), `readlink -f` (5), `grep -P` (2), `date -d` (2), `timeout(1)` (5 files) |
| **M5** | **The identity rail.** Which start-key source exists, at what resolution, and whether a sub-second one is reachable | `processStartKey()` `pi-extensions/lib/meta-session.ts:1554` — the defense that stops a stale marker granting the wrong garden identity |
| **M6** | Can a reader see another process's argv/environment — measured as a **contrast**, not a single reading | the bridge/receiver discovery paths that read `/proc/<pid>/{environ,cmdline}` (`scripts/omp-bridge-doctor.sh:258-267`, `scripts/copilot-receive-bridge.sh:264-289`) |
| **M7** | How reachable is a same-second pid reuse (`kern.maxproc`, PID_MAX) | the severity grade of the M5 finding |
| **M8** | Case-sensitivity, HOME/XDG shape, symlink support, `~/.local/bin` on PATH | installers and the `~/.local/bin/entwurf` symlink ownership |
| **M9** | Does a **rename-over** raise an `fs.watch` event on the watched path | the mailbox doorbell — the receiver arms a watch, the sender delivers by staging then renaming into place |

### Why M6 is a contrast and not a reading

A first draft of this probe asked `ps -E` about a `/bin/sleep` child. That would have produced a
**false negative on Darwin**: Apple-signed, SIP-protected binaries refuse environment reads *by
construction*, so `REJECTED` there says nothing about our actual case — an unrestricted
Homebrew/nvm `node` (the entwurf MCP child) and the Copilot CLI. The probe therefore starts a
`node` child carrying `ENTWURF_PROBE_MARKER=hello-entwurf` and asks whether that exact string is
visible, **and** keeps the `/bin/sleep` control beside it. `VISIBLE` on the node row next to
`REJECTED` on the sleep row is the evidence; either row alone is not.

`[measured by the audit lane, 2026-09-09]` The Darwin conditions under which `ps -E` can read a
foreign environment are: same process, SIP disabled, a development kernel, target not restricted,
or a dedicated entitlement. Only "target not restricted" is satisfiable on a normal host, which is
exactly why the target choice decides the answer.

## M5 — the finding that already exists, measured on Linux

The identity core is dual-scheme **[source, `meta-session.ts:1554-1576`]**: `/proc/<pid>/stat`
field 22 → `linux:<ticks>`, else `ps -o lstart=` → `ps:<lstart>`, else `""` (fail-closed).
`startKeyScheme()` **[source, `:1630-1633`]** accepts both. **Darwin has no `/proc`, so it always
takes the `ps:` branch.**

**[host-linux, oracle, 2026-09-09 12:32]** The two schemes do not have the same resolution, and
the gap is measurable without a Mac:

```
  /proc present?    YES
  ps -o lstart= self: Wed Sep  9 12:32:26 2026        <- 1-second granular
  linux ticks       65958142                          <- 10ms granular (100 ticks/s)
  child A (556824): Wed Sep  9 12:32:27 2026
  child B (556825): Wed Sep  9 12:32:27 2026
  RESOLUTION        1-SECOND (two back-to-back starts share one key string)
  widened key A     Wed Sep  9 12:32:27 2026 sleep 4
  widened key B     Wed Sep  9 12:32:27 2026 sleep 4
  WIDENING          INSUFFICIENT ALONE (identical argv collides even widened)
```

Two consequences, stated at the size of the evidence:

1. **The `ps:` scheme's pid-reuse window is 1 second, not 10ms.** The key is compared per-pid, so
   two *different* pids sharing an `lstart` string is harmless. The reachable failure is the
   specific sequence the source comment names **[source, `:1538-1544`]**: a process exits, its pid
   is reused **within the same second**, and the new process's `lstart` matches the recorded key —
   so a stale marker validates against the wrong process and grants it the wrong garden identity.
2. **Widening the key with argv does not close it.** Both children ran identical argv on purpose,
   because that is the worst case and the worst case is what a fail-closed rail must survive — and
   a harness restarting under the same command line is the *normal* shape, not an exotic one.

Whether that window is reachable in practice is an M7 question (pid space vs spawn rate), and the
grade of the finding — blocker or observation — follows from it. `probe.sh` also tests whether a
microsecond source is reachable on Darwin (`libproc` `proc_pidinfo(PROC_PIDTBSDINFO)` →
`pbi_start_tvsec`/`pbi_start_tvusec` through python3 ctypes); on Linux that cell degrades with a
named reason rather than a silent skip:

```
  libproc            UNAVAILABLE (/usr/lib/libproc.dylib: cannot open shared object file: ...)
```

## If the Mac is single-shot: what this one command already buys

The portability audit (`.agent-reports/macos-portability-audit-20260909.md` §8) enumerates a
nine-item acceptance checklist. **Items 1–6 need no entwurf install and no fence change**, so they
can all be taken on first contact — and running `probe.sh` once covers every one of them:

| Checklist item | Closes | Covered by |
|---|---|---|
| 1 · run the probe | the host facts | the whole run |
| 2 · `ps -Eww` on a marker-carrying `node` child | **P2-2 · P2-3 · P2-4** | **M6**, with the SIP-protected `/bin/sleep` control beside it |
| 3 · `ps -o lstart=` and the two-child cell | **P2-5 · P0-8** | **M5** |
| 4 · `proc_pidinfo` microsecond cell | **P2-5 Plan B** | **M5** |
| 5 · expected-failure battery (`readlink -f`, `shasum`, `grep -P`, `timeout`) | **P1-1 · P1-3 · P1-4** | **M4** |
| 6 · `python3 -V` without the CommandLineTools dialog | **P3-3** | **M3** |
| 7–9 · installs, `doctor-meta-bridge`, receive round trip | **P3-1 · P3-2 · P2-1 · P3-4 · P3-5** | NOT the probe — needs the 0.20.0 code landed and a real logged-in harness |

So the ordering for a scarce window is: **run the probe, keep the output, leave.** Items 7–9 can
be attempted with whatever time is left, but items 1–6 are the ones that convert open design
questions into facts, and none of them can be answered from Linux.

A cell that comes back the *opposite* of what we expect is worth as much as one that confirms —
item 5 in particular is a battery of EXPECTED FAILURES, and a surprise success there changes a
substitution's justification rather than validating it.

## Control run — Linux oracle

**[host-linux, oracle, 2026-09-09]** The probe was run on Linux before being handed to a Darwin
host, to prove the probe itself is not the thing under test. Selected verdicts: `stat -c %s` OK ·
`readlink -f` OK · all three sha256 producers agree on the known digest of `abc` · `sort -z` /
`xargs -0` / `xargs -0r` / `grep -P` / `date -d` all OK · `ps -E` **REJECTED** even on Linux (so
the environment-visibility question in M6 is not Darwin-specific) · case-sensitive volume · total
runtime 1.2s.

That control matters for one reason: every `OK` above is a **GNU** answer. The same probe on
Darwin is expected to turn several of them into `FAIL`, and the list of which ones is exactly the
P1 substitution work.

## Darwin cells — NOT YET MEASURED

Nothing below the line has been run on a Mac. GLG is borrowing a company host; when it lands, run
`probe.sh` once and paste the whole output here under a `[host-darwin]` heading with the date,
the Darwin version, and who ran it.

Do not fill these in from documentation, from a CI runner image spec, or from another project's
notes. This lane exists because `#78` says *claim only what physical evidence proves*.
