---
name: hello
description: Smallest skill the Claude Agent SDK will load through entwurf's skillPlugins surface. Use it as a copy-and-rename template; replace this file with your own SKILL.md for each skill you ship.
---

# hello

This is a placeholder skill. The Claude Agent SDK reads the YAML frontmatter
above (`name`, `description`) to expose the skill in the session's tool
schema. The body of `SKILL.md` is the instruction the model sees when it
activates the skill.

Replace the frontmatter and this body with the actual instruction for your
skill. If your skill needs auxiliary scripts or files, place them next to this
`SKILL.md` inside `skills/<name>/` — the SDK passes the directory through.

For the full SKILL.md authoring contract see the upstream Claude Agent SDK
documentation; entwurf does not reinterpret that contract.
