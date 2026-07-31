<!-- ═══════════════════════════════════════════════════════════════════════
     SAMPLE — operator engraving carrier (entwurf)

     What this is: the engraving file is loaded VERBATIM into the backend's
     identity slot (Claude `_meta.systemPrompt`). It is the one place an
     operator stamps a short identity onto every entwurf ACP turn —
     replacing Claude's `claude_code` preset (which also strips the preset's
     auto-memory advertisement, the memory-containment lever).

     VERBATIM means the WHOLE file, this comment included — the loader does
     not strip markdown comments. Copy this sample and delete everything you
     do not want on the wire; do not point the runtime at it as-is.

     Where it loads from:
       • Runtime default = pi-extensions/lib/acp/prompts/engraving.md
         (ships as the minimal `# Engraving Here` placeholder; a gate pins
         it non-empty so the containment lever stays ON).
       • THIS root copy is a documented sample / starting point. Point the
         runtime at your own file with
         ENTWURF_ACP_ENGRAVING_PATH=/path/to/your.md — it is NOT loaded by
         default (the lib copy above is).

     Rules:
       • Template variables: {{backend}}, {{mcp_servers}}.
       • Keep it TINY. Do NOT paste AGENTS.md, the bridge narrative, or
         tool catalogs here — a large Claude carrier can route OAuth
         sessions to metered "extra usage" billing.
       • An empty or missing file = opt-out (no engraving). That is fine.
       • Do NOT open the file with a blank line to separate yourself from
         Claude's fixed SDK sentence. Your leading/trailing whitespace is
         trimmed (it would otherwise drift the reuse signature) and the
         loader opens the carrier with that blank line itself.
     ═══════════════════════════════════════════════════════════════════════ -->

# Engraving Here
