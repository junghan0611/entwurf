# Garden view

`entwurf garden` is the read-only operator frontend for a tmux-backed Entwurf garden.
It borrows the useful Herdr interaction shape — one live terminal view instead of
polling panes one by one — without adopting Herdr as a runtime or address layer.

```bash
entwurf garden                 # live view on a TTY; q quits, r refreshes
entwurf garden --once          # one bounded frame
entwurf garden --json          # one machine-readable snapshot
entwurf garden --watch --interval-ms 1000
```

The command has no third-party frontend dependency. Keep it open in a narrow side
terminal beside the tmux client for the Herdr-like sidebar pattern, or run it full-width
as a standalone dashboard. Exit status is `0` success, `2` usage/non-TTY `--watch`, and
`3` runtime failure. Watch is active read IO: every frame re-runs control-socket probes
and at most 32 receiver/transcript detail observations. It reads two existing sources and keeps them in separate **vertical** panels and
separate JSON objects:

| Panel | JSON scope | Source | What it can assert |
|---|---|---|---|
| `TMUX WHOLE-CURRENT-SERVER INVENTORY` | `placement.scope = whole-current-server-inventory` | `tmux list-panes -a` on the current tmux server | current machine inventory: session/window/pane, foreground command, cwd. It is not a launch-placement receipt for any citizen. |
| `RETAINED GARDEN RECORD STORE` | `garden.scope = retained-record-store` | Entwurf's existing `listEntwurfFacts` owner composition | retained record-backed garden id, backend, cwd history, rail liveness, receiver/transcript observations, diagnostics. It is not a current-process roster. |

`garden.detailObservationLimit = 32` is part of the JSON contract. It bounds only the
expensive receiver/transcript detail observation; it does **not** slice or make live the
retained record store. The terminal footer repeats this limit and the count of
`unobserved` details. A `dead` rail fact is rendered as `dead`: it is a
retained socket-domain fact, never an assertion that the viewer observed a process die now.

## The visible separation is a contract

A tmux pane is not a citizen address. A garden id is not a pane. Even when a pane and a
record show the same cwd or runtime name, the frontend does not join them. JSON makes
that boundary explicit:

```text
placement.authority = placement-observation-only
placement.scope     = whole-current-server-inventory
garden.authority    = garden-id-record-and-rail-facts
garden.scope        = retained-record-store
garden.detailObservationLimit = 32
join.state          = not-performed
```

The missing join is intentional and visible on every subject row: full rows say
`gd:?` (pane garden-id unknown) / `pl:?` (citizen placement unknown); compact rows use
`gd?` / `pl?`. Compact garden rows are human-readable: liveness glyph (`●` alive, `○` dead,
`?` indeterminate, `–` unsupported), then garden id, backend, `recv+/-/0/!/?`, and
`tx+/-/?`. At 48–59 columns backend aliases are `cc/cp/om/cx/ag`; the panel legend
names this. `np-listing?` names native-push listing-liveness absence, and the top band
always totals it even when rows are omitted. `recv-` (`n/a`) and `recv?` (`unobserved`) are deliberately different. The panels are vertical, not
side-by-side, so matching cwd/backend/count cannot form an implied row pairing. A future
projection may display a correlation only when an explicit launch/callback receipt
supplies it; cwd, command names, process ids, pane titles, and screen text are not
receipts.

The view also leaves `working`, `blocked`, and `done` unobserved. Those are attention
states, not liveness states. Entwurf will show one only after the backend supplies an
explicit lifecycle report; it does not infer attention from terminal pixels,
transcript timestamps, receiver state, or whether a process answers.

## Read-only means read-only

The viewer does not send keys, switch panes, launch or resume a citizen, dispatch a
message, install a bridge, edit configuration, or write state. Use the existing
surfaces after choosing a subject:

- inspect the placement in tmux;
- address an existing citizen by garden id with `entwurf_v2`;
- open a new visible sibling with `entwurf_fresh_call`;
- reopen a dormant pi citizen with `entwurf_resume_call`.

Those verbs resolve their own live contracts at call time. The viewer never bakes a
`sendable`, `resumable`, or transport decision into a row.
