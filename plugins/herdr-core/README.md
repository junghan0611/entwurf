# Herdr Core Entwurf

A guide to using pi and Claude Code sessions started in Herdr App terminals or `hc` terminals as Entwurf citizens. It is not a plugin to install and ships no code or check script.

Herdr App and herdr-core (`hc`) are a separate product line from the Herdr terminal multiplexer (`herdr`, the TUI). The TUI has its own Entwurf plugin and launch rail in [`plugins/herdr/`](../herdr/README.md); nothing there applies here, and nothing here installs it.

The App window arranges terminals and the core runs them, so App terminals and `hc` terminals are the same terminals on the same core (upstream README reading). One guide covers both. Path walked: App tab, measured on one laptop. Core-only `hc` attach: not measured.

## 1. Install

Do this on the machine that runs the Herdr App or core, as the user that runs it. This guide does not install Herdr.

Replace `VERSION` with a published version, then run:

```bash
npm install -g @junghanacs/entwurf@VERSION
entwurf setup /path/to/your-project
```

- Requirements: Node 24 or later, Python 3, and an already installed and logged-in pi or Claude Code. For the steps in detail, see [clean-host setup](../../docs/setup-clean-host.md).
- NixOS: install `herdr-desktop` and `herdr-core` from nixpkgs rather than the upstream `curl … /app/install.sh | sh`. In one check the upstream app binary (0.1.16, aarch64) was dynamically linked and needed `libxcb.so.1`, `libfontconfig.so.1` and `libxkbcommon.so.0`, which the default nix-ld library set lacks, so it is likely not to start as is (measured on oracle, aarch64; not run). The nixpkgs package builds from source and puts those libraries in place (nixpkgs `package.nix` reading).
- Versions seen: nixos-unstable had `herdr-desktop` 0.1.13 and `herdr-core` 0.1.18 on 2026-11-17 (measured, `nix eval`); upstream was then app 0.1.16 and core 0.1.21.

## 2. Start and check

Start the core **outside** the Herdr TUI, tmux and agent sessions: from a clean shell, or let the App start it. Then, in a terminal the core runs (App tab or `hc`):

```bash
env | grep -E '^(HERDR|HC|TMUX|CLAUDE)'
command -v entwurf
entwurf check-bridge
```

On the measured App terminal (t3) the first command printed three `HC_*` lines (`HC_SCOPE`, `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET`) and no `HERDR_*`, `TMUX` or `CLAUDE*` (measured n=1, thinkpad, `herdr-desktop` 0.1.13 + `herdr-core` 0.1.18); other versions and environments are unmeasured. What matters to Entwurf is that no `HERDR_*` line appears. There `command -v entwurf` found `~/.local/bin/entwurf` and `entwurf check-bridge` was green (measured, same run).

Inheritance trap: Entwurf decides it is inside Herdr only from its own environment: fresh call and resume choose the Herdr rail on `HERDR_ENV=1` (`selectFreshCallRail`, `pi-extensions/lib/fresh-call-dispatch.ts`), and `entwurf_peers` reads Herdr placement only when `HERDR_ENV=1` and `HERDR_BIN_PATH` are both set (`pi-extensions/lib/entwurf-peer-observe.ts`). A core keeps the environment of the shell that first started it. A core first started from inside a Herdr TUI pane therefore passes both variables to every later terminal (measured n=1, oracle aarch64, hc 0.1.21, sandbox HOME: a terminal opened with `hc run` from a clean shell still carried both; upstream README says `hc server restart` keeps the starting environment). Then `entwurf_fresh_call` and `entwurf_resume_call` choose the Herdr TUI rail and open the sibling as a tab in that TUI ([Herdr launch rail](../../docs/herdr-launch-rail.md); inferred from source, not run in this setup).

If `HERDR_*` shows:

- Upstream 0.1.21: run `hc server restart --fresh` from outside the TUI (upstream README reading).
- nixpkgs 0.1.18: there is no `--fresh` (measured, laptop). Stop the core and start it again from a clean shell outside the TUI, tmux and agent sessions; stop then start takes the new environment (upstream README reading; the restart itself unmeasured on 0.1.18).

## 3. Working together

Start `entwurf pi` in an App terminal, or press the App's Claude button. Both became citizens and exchanged messages with a sibling outside Herdr by garden id (measured n=1, same laptop run):

- `entwurf pi` replied through `control-socket → queued-follow-up`, and the reply appeared on the pi screen.
- The Claude button path replied through mailbox `enqueued`, and the reply appeared on screen.

Unmeasured: `entwurf claude` typed directly in a terminal, round trips between App tabs, Core-only `hc` attach, and hosts other than the laptop.

Do not use `hc send` as a delivery path: it pastes text plus Enter into a terminal, which is not Entwurf delivery (upstream behavior as described in the issue; unmeasured here). A terminal address such as `t3` is not a garden id.

## 4. What it writes to the server HOME

Not measured for the App or core. Install-time writes to `~/.claude` and `~/.pi` come from `entwurf setup`; see [clean-host setup](../../docs/setup-clean-host.md).

## 5. Scope and unmeasured

One laptop, one run, n=1 each, App tab only; the `HERDR_*` inheritance was measured separately on one oracle sandbox with hc 0.1.21. Evidence: [the #169 inheritance and NixOS notes](https://github.com/junghan0611/entwurf/issues/169) and the laptop round-trip comment on the same issue.

Not done here: a new Herdr Core adapter, and `entwurf_fresh_call` / `entwurf_resume_call` into the core. From these terminals, with `HERDR_*` absent, fresh and resume go to the tmux rail (inferred from the source predicate; not run). Opening a sibling from the core is future work.

Unmeasured:

- Core-only `hc` attach
- Terminal-launched `entwurf claude`
- Hosts and architectures other than the laptop; upstream latest (app 0.1.16, core 0.1.21) on an App terminal
- Behavior of a core first started inside a TUI on nixpkgs 0.1.18 (measured only on 0.1.21)
