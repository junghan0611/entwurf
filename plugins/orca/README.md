# Orca Entwurf

A guide to using pi and Claude Code sessions started on an Orca server as Entwurf citizens. It is not an Orca plugin, and it ships no code or check script.

## 1. Install

Do this on the server that runs `orca serve`, as the user account that runs it.

```bash
npm install -g @junghanacs/entwurf@<version>
entwurf setup <repo path>
```

This guide does not choose `<version>`. You need Node 24 or later, Python 3, and an already installed and logged-in pi or Claude Code (Entwurf installs and logs in no harness; if a harness version does not fit, `entwurf setup` reports FAIL). For the steps in detail, see [clean-host setup](../../docs/setup-clean-host.md).

PATH trap: an Orca terminal inherits the PATH of the `orca serve` process (measured). So check that `$(npm prefix -g)/bin` is on the PATH when you start serve. If it is missing, the terminal will likely say `entwurf: not found` (inferred).

## 2. Start and check

Run these in an Orca terminal.

```bash
entwurf --help
entwurf check-bridge
```

After you have started Claude Code once, you can also run `entwurf doctor-meta-bridge`. With no Claude session ever started it ends NOT CERTIFIED.

## 3. Working together in the same workspace

Open a tab in the same workspace and start `entwurf claude` or `entwurf pi` from its terminal. Siblings started this way become citizens and exchanged messages with a sibling outside Orca by garden id (measured). Between tabs: [unmeasured].

The + button on the GUI tab bar lets you pick a terminal or an agent and open it as a tab in the same workspace. It is the same place as opening one more tmux window beside the current one (the maintainer's GUI observation). Pick Claude Code as the agent and it should become a citizen as is (inferred from the measured GUI launches; the + button path itself is unmeasured); start pi from a terminal tab with `entwurf pi` (or `pi --entwurf-control`).

- Measured: starting from a workspace terminal creates no new worktree.
- Measured: Claude Code started from the GUI became a citizen in both Terminal and Chat mode. In the measured runs, two Claude Code agents started from the GUI each landed in its own new worktree (`~/orca/workspaces/<repo>/<name>`; Orca picks the branch name). Which GUI action was used then was not recorded. Cleaning up and merging a worktree is done by a person in Orca.
- Unmeasured: round trips between tabs.
- Measured: putting `--entwurf-control` in the GUI Settings Pi Arguments is saved but did not apply to a pi started from the GUI (cause unmeasured).
- Observation (n=1 each): Claude Code read incoming mail automatically but did not act on its content at once; it waited for the pane user's instruction or approval.
- Phone and remote GUI pairing follow the Orca docs [unmeasured].
- Do not have a citizen inside Orca call `entwurf_fresh_call`. Start siblings directly in Orca. Opening a new sibling in the same workspace is future work.

## 4. What Orca writes to the server HOME

Only what affects other pi and Claude Code sessions sharing that HOME is listed.

- `~/.claude/settings.json`: adds 16 hooks pointing at `~/.orca/agent-hooks/claude-hook`. The original is kept as `settings.json.bak`. Written when `orca serve` starts.
- `~/.claude/keybindings.json`: if it is a symlink, Orca follows the link, edits the original (adds `ctrl+alt+g`) and leaves a `.bak`. Written when `orca serve` starts.
- Three Pi extensions, `~/.pi/agent/extensions/orca-{agent-status,prefill,titlebar-spinner}.ts`: they appear even if you do not use pi, as long as `~/.pi/agent` already exists in the server HOME, when the first Orca terminal is opened after serve. Reading the upstream source, they do nothing without `ORCA_PANE_KEY`.

After `orca serve` was stopped, the terminal processes were still alive, and restarting it listed the same handle (measured).

## 5. Scope and unmeasured

One host, Orca v1.4.259, n=1 each, and the GUI was paired over 127.0.0.1 on the same host. Evidence: [the #164 measurement summary](https://github.com/junghan0611/entwurf/issues/164#issuecomment-6906503079).

Not done here: an Orca code plugin (`orca plugin install` works only on the Electron runtime, and the default `orca serve` has no plugin service), installing or logging in a harness, and using key input such as `terminal send` as a delivery path.

Unmeasured:

- Remote GUI and phone access
- Round trips between tabs
- With an Orca Claude account profile (a changed `CLAUDE_CONFIG_DIR`), Claude may start in a config directory with no Entwurf hook and not become a citizen (source reading)
- Other Orca versions and OSes
