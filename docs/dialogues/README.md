# Dialogues

Release-time conversations between GLG and a Claude chat outside the garden, kept as the narrative behind the CHANGELOG. They are history, not contract: when a dialogue and a source, gate or owning document disagree, the owner wins.

Each period has two files with the same message numbers `[n]`:

- `<from>--<to>-<surface>.md` — reading copy: every GLG message in full, each Claude reply cut to its opening paragraphs with a `… (이하 생략)` marker.
- `<from>--<to>-<surface>.full.md` — the complete transcript.

| Period | Surface | Messages (GLG / Claude) | Span |
|---|---|---|---|
| [2026-04-15 — 2026-11-22](./2026-04-15--2026-11-22-claude-ai.md) ([full](./2026-04-15--2026-11-22-claude-ai.full.md)) | claude.ai (previous workplace account) | 137 / 141 | pi-shell-acp research → v0.60.0 / v0.61.0 notes |

Conversion: the saved claude.ai page converted to Markdown with pandoc (GFM), timestamps in KST. Tool calls (web search, page reads) are reduced to one `> ⚙` line in the full copy and dropped from the reading copy; their results were not in the page. Eight attachments appear only as "hidden when shared" and have no content here. Identity terms are substituted with the garden's public replacements before commit.

Add a new period as a new pair of files and a new table row; do not rewrite earlier ones.
