#!/usr/bin/env node
/**
 * resume — `entwurf resume [<garden-id>]`: reopen ONE dormant citizen under its own garden id, from
 * the operator's terminal (#173). With a garden id it goes straight to the leaf; with none it shows
 * a list to choose that id from. The decisions live in pi-extensions/lib/resume-cli.ts and, behind
 * it, in the same leaf `entwurf_resume_call` uses; this file is argv, wiring, two streams and the
 * exit code.
 *
 * It submits no prompt. A target that is live, unsupported or not provably dormant is refused by the
 * leaf and nothing is opened — never a send, a focus or a new session instead.
 *
 * `--caller-cwd <dir>` is NOT an operator flag. run.sh puts it first, with the directory the command
 * was typed in, because run_ts changes directory before this file runs. It filters the list and
 * locates the bookmark file; it is never a launch directory. Typed by hand it lands after that pair,
 * where it is a dash word and a usage error.
 *
 * EXIT: 0 launched and the backend's own same-id observation was positive (pi: socket connect ·
 * Claude Code: a new owner re-armed the receiver marker · pi-durable: the reservation was adopted,
 * which is not readiness) · 3 launched, that observation not positive in the bounded wait (the window
 * or tab stays visible; nothing was retried) · 4 refused, nothing opened (the leaf's reason, or no
 * launch context in this terminal) · 5 failed at the launch step (the recovery receipt says what was
 * created and what remains) · 6 the list was shown and nothing was chosen · 7 the list could not be
 * shown (store, bookmark file or terminal) · 2 usage: more than one argument, a dash word, or no
 * argument where there is no terminal · 1 the leaf threw (its own message is printed; e.g. no record
 * for that id).
 */
import { productionResumeCliDeps, runResumeCli } from "../pi-extensions/lib/resume-cli.ts";
import { runResumePicker } from "../pi-extensions/lib/resume-picker.ts";
import {
	listResumeFacts,
	processPickerIo,
	readResumePins,
	resumePickerHasTerminal,
} from "../pi-extensions/lib/resume-picker-production.ts";

const raw = process.argv.slice(2);
const handed = raw[0] === "--caller-cwd" && raw[1] !== undefined;
const callerCwd = handed ? (raw[1] as string) : null;
const argv = handed ? raw.slice(2) : raw;

const outcome = await runResumeCli(
	argv,
	productionResumeCliDeps({
		hasTerminal: resumePickerHasTerminal(),
		callerCwd,
		readPins: (cwd) => readResumePins(cwd),
		listFacts: (pins) => {
			// Reading every record and probing its rail is not instant on a long-lived host; say so, or
			// the terminal looks hung. On stderr, like the list itself.
			process.stderr.write("entwurf resume: reading the garden's records…\n");
			return listResumeFacts(pins);
		},
		pick: (listing, rail) => runResumePicker(listing, rail, processPickerIo()),
	}),
);
process.stdout.write(outcome.stdout);
process.stderr.write(outcome.stderr);
process.exitCode = outcome.exitCode;
