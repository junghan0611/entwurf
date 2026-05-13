# compaction-policy-smoke

0.5.0 compaction-policy verification demo.

## What 0.5.0 declares

> `pi-shell-acp` does not implement compaction. ACP backends compact
> natively; the pi session survives that. The bridge boundary stays
> explicit. pi-side JSONL compaction stays blocked — it would not
> reduce the backend transcript anyway.

| Layer | Default |
|---|---|
| pi JSONL compaction | blocked |
| backend-native compaction | **always allowed (no bridge knob)** |

| Knob | Meaning | Default |
|---|---|---|
| `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` | Let pi-side `session_before_compact` proceed | unset (blocked) |
| `PI_SHELL_ACP_ALLOW_COMPACTION=1` (legacy) | — | **fail-fast throw at spawn intent** |

If a specific backend's auto-compaction must be turned off for a debugging
reason, export the backend's own native env/argv directly from your shell
(`DISABLE_AUTO_COMPACT=1` for Claude; for Codex, inline `-c model_auto_compact_token_limit=…`
via `CODEX_ACP_COMMAND`, or export `CODEX_HOME` so Codex reads your own
config tree instead of the bridge overlay). `process.env` wins over adapter defaults,
so the operator's shell always carries through. The bridge does not carry
a knob for this — it is not the bridge's policy to make.

## Six steps

| # | What it proves | Mode |
|---|---|---|
| 01 | Bridge does **not** inject backend compaction guards (Claude env `DISABLE_AUTO_COMPACT`/`DISABLE_COMPACT` absent; Codex argv `model_auto_compact_token_limit=…` absent). The bridge has no knob to opt out — backend-native compaction is always allowed. | deterministic |
| 02 | `session_before_compact` message honestly tells the operator: pi-side compact does **not** reduce the backend transcript, and points at the backend-native compaction path. Tone matches "entwurf already exists → use entwurf_resume". | deterministic |
| 03 | **Live**: Claude ACP session survives a backend `/compact`. Spawns a real ACP child via `runEntwurfSync`, plants a unique sentinel + asserts READY, sends literal `/compact` as a backend prompt (NOT pi-host `/compact`), then sends a recall prompt and asserts the sentinel survives. Same `taskId` across all three prompts, so persisted-mapping reuse is also covered. Cost a few cents on `claude-sonnet-4-6`. | LIVE=1 (real spawn) |
| 04 | **Live**: same 3-prompt driver against the Codex adapter, routed through pi-shell-acp ACP via `PI_ENTWURF_ACP_FOR_CODEX=1` so 0.5.0's bridge claim is what is exercised (not native codex CLI). Cost a few cents on `gpt-5.4`. | LIVE=1 (real spawn) |
| 05 | Legacy `PI_SHELL_ACP_ALLOW_COMPACTION=1` is rejected at spawn intent with a next-action message pointing at `PI_SHELL_ACP_ALLOW_PI_COMPACTION` (the only remaining bridge knob; backend compaction is no longer a bridge concern). | deterministic |
| 06 | **Live (exploratory)**: same 3-prompt driver against the Gemini adapter. Gemini ACP does not advertise `/compact` — the probe records the actual observation, not a release claim. | LIVE=1 (real spawn) |

Steps 01, 02, 05 form the **deterministic gate** for 0.5.0 (no network,
no real spawn). Steps 03, 04, 06 are the **live release-evidence probe**
— they exercise the exact pi-shell-acp prompt boundary the declaration
is about: ACP child spawn, three-turn flow with a literal `/compact` in
the middle, sentinel recall on the other side. The probe is gated behind
`LIVE=1` because it spawns a real backend session and costs a few cents
per backend. It is NOT a product-surface `/acp-compact` command — there
is no user-facing operator interface for triggering backend `/compact`.
It is a release evidence probe, not a feature.

Step 06 (Gemini) is exploratory only — Gemini ACP's command registry
does not include `compress` / `compact` (`gemini-cli/packages/cli/src/acp/acpCommandHandler.ts`),
so the literal `/compact` prompt lands as a regular user message. The
step is included so the three-backend axis stays honest (no implicit
carve-out); the survives-compact release claim itself is limited to
Claude + Codex.

Judgment for steps 03/04 (live) combines three independent signals:

1. **text classifier** — `classifyCompactResponse((b).text, sentinel)`
   classifies the backend's reply to `/compact` as `ack`
   (response talks about compaction/summary/context-reduction),
   `refusal` (says the backend does not recognize the command),
   or `ambiguous` (neither). Sentinel echo is stripped before
   matching so the planted `GLG-COMPACT-...` token cannot
   self-trigger an `ack`. Catches Codex-shape: codex-acp emits
   "Context compacted" verbatim.
2. **wire classifier** — `classifyUsageEvidence(...)` reads the new
   `[pi-shell-acp:usage] meter=acpUsageUpdate ...` lines that appeared
   in the bridge stderr during turn (b). Two positive shapes:
   `compact_boundary_signal` (an explicit `used=0` synthetic
   usage_update — claude-agent-acp emits this when the SDK actually
   performs compaction, see acp-agent.js:477-498), or `usage_drop`
   (final used >= 50% lower than the pre-/compact baseline).
   `no_evidence` means neither. Catches Claude-shape: the SDK
   compacted but the textual assistant chunk on the wire was
   ordinary, while `used=0` told the truth.
3. **sentinel recalled** — does the recall prompt's reply contain the
   planted sentinel verbatim.

| text | wire | sentinel recalled | outcome |
|---|---|---|---|
| `ack` | any | yes | **pass** |
| `ack` | any | no | **observed** — backend acked compact but lost the sentinel (backend-internal lossy property, not a bridge regression) |
| any | `compact_boundary_signal` | yes | **pass** — wire-level evidence is authoritative even when text is ambiguous |
| any | `compact_boundary_signal` | no | **observed** |
| any | `usage_drop` | yes | **pass** |
| any | `usage_drop` | no | **observed** |
| `refusal` | `no_evidence` | any | **observed** — backend has no native `/compact` surface reachable through this prompt path |
| `ambiguous` | `no_evidence` | any | **observed** — cannot conclude compaction happened from text or wire |

**fail** is reserved for "no assistant text" / entwurf path error — the
bridge or the backend is dead. `pass` requires positive backend-compact
evidence from EITHER the text classifier OR the wire classifier AND the
sentinel must come back through the bridge on the recall turn. Survival
alone is necessary but not sufficient. The dual-classifier shape exists
specifically because the two supported backends signal compaction on
different ACP wire surfaces — text-only or wire-only would mis-judge
one of them.

## Run

From repo root:

```bash
./run.sh smoke-compaction-policy
```

Single step:

```bash
node --experimental-strip-types scripts/compaction-policy-smoke.ts --step=01
```

Run the full surface including the live probe (spawns a real ACP child
per backend; cost a few cents each):

```bash
LIVE=1 ./run.sh smoke-compaction-policy
```

Or just one backend at a time:

```bash
LIVE=1 ./run.sh smoke-compaction-policy --step=03   # Claude
LIVE=1 ./run.sh smoke-compaction-policy --step=04   # Codex (routed via ACP bridge)
LIVE=1 ./run.sh smoke-compaction-policy --step=06   # Gemini (exploratory)
```

Each step prints a human-readable block and a single line
`RESULT NN: pass | fail — reason | observed — note`. The runner ends
with `SUMMARY: P pass, F fail, O observed`. Exit code is non-zero iff
any deterministic step fails. `observed` rows are records, not gate
failures.

## Why this demo exists

0.4.x reached its long-session ceiling by **disabling** both Claude and
Codex native compaction at the bridge surface. That was a deliberate,
temporary expedient — the bridge needed to be a small, knowable surface
first; reasoning about backend-native compaction came later. 0.5.0 pays
that debt back. The bridge no longer pretends to own compaction. The
backend does its own thing. The pi session lives.

The demo is shaped like the rest of the repo's tone: an honest message
that tells you what is happening and what the next action is. It does
not paper over a missing knob; it surfaces what is missing and what to
do.
