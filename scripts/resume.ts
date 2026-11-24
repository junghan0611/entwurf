#!/usr/bin/env node
/**
 * resume — `entwurf resume <garden-id>`: reopen ONE dormant citizen under its own garden id, from the
 * operator's terminal (#173). The decisions live in pi-extensions/lib/resume-cli.ts and, behind it,
 * in the same leaf `entwurf_resume_call` uses; this file is argv, two streams and the exit code.
 *
 * It submits no prompt. A target that is live, unsupported or not provably dormant is refused by the
 * leaf and nothing is opened — never a send, a focus or a new session instead.
 *
 * EXIT: 0 launched and the backend's own same-id observation was positive (pi: socket connect ·
 * Claude Code: a new owner re-armed the receiver marker · pi-durable: the reservation was adopted,
 * which is not readiness) · 3 launched, that observation not positive in the bounded wait (the window
 * or tab stays visible; nothing was retried) · 4 refused, nothing opened (the leaf's reason, or no
 * launch context in this terminal) · 5 failed at the launch step (the recovery receipt says what was
 * created and what remains) · 2 usage: not exactly one non-option argument · 1 the leaf threw (its
 * own message is printed; e.g. no record for that id).
 */
import { productionResumeCliDeps, runResumeCli } from "../pi-extensions/lib/resume-cli.ts";

const outcome = await runResumeCli(process.argv.slice(2), productionResumeCliDeps());
process.stdout.write(outcome.stdout);
process.stderr.write(outcome.stderr);
process.exitCode = outcome.exitCode;
