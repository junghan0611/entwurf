<!-- ═══════════════════════════════════════════════════════════════════════
     SAMPLE — operator engraving carrier (entwurf)

     What this is: the markdown body below this comment is loaded VERBATIM
     into the backend's identity slot (Claude `_meta.systemPrompt`). It is
     the one place an operator stamps a short identity onto every entwurf
     ACP turn — replacing Claude's `claude_code` preset (which also strips
     the preset's auto-memory advertisement, the memory-containment lever).

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
     ═══════════════════════════════════════════════════════════════════════ -->

# Engraving Here
