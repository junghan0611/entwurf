/**
 * entwurf mailbox receiver — GitHub Copilot CLI extension.
 *
 * WHAT THIS REPLACES. The earlier Copilot probe reached the TUI through the
 * hidden `--ui-server` loopback port, and that rail was refused admission for a
 * reason no amount of care could fix from outside: its authentication was not
 * established (an unauthenticated SDK client connected; a token-bearing one got
 * AUTHENTICATION_NOT_CONFIGURED). This rail does not answer that objection — it
 * removes it. An extension is forked by the CLI itself and speaks JSON-RPC over
 * its own stdio, so there is no port, no token, and no listener to authenticate.
 * The trust boundary is the process fork.
 *
 * WHAT IT DOES. `joinSession()` attaches to the CLI's foreground session; the
 * extension then watches ONE per-session signal file and calls `session.send()`
 * when it changes. `fs.watch` -> `session.send()` is the pattern the bundled SDK
 * documents itself (copilot-sdk/docs/examples.md, "Detecting when the plan file
 * is created or edited"), not a mechanism discovered by inspection.
 *
 * ADDRESSED, NEVER BROADCAST. Each receiver owns `<root>/<sessionId>/` and
 * watches only its own signal, so a sender pokes exactly one session rather than
 * broadcasting. A two-process isolation run was observed, but its decisive B log
 * was not preserved; managed admission must rerun that D3 control.
 *
 * LAUNCH CONTRACT. Extensions sit behind an experimental feature flag; without
 * it the CLI never scans for them and this file is inert with no error:
 *
 *   COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS copilot --model auto
 *
 * `--experimental` is NOT required (measured separately). Discovery scopes are
 * user (`~/.copilot/extensions/`), plugin, session, and — interactive mode only
 * — project (`.github/extensions/`).
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { joinSession } from "@github/copilot-sdk/extension";

const root = process.env.COPILOT_MAILBOX_ROOT ?? join(homedir(), ".copilot", "mailbox");

const session = await joinSession();
const box = join(root, session.sessionId);
mkdirSync(box, { recursive: true });
const logPath = join(box, "ext.log");
const log = (line) => appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);

// The sender needs an address, and scraping ~/.copilot storage for one is what
// the old command-hook probe failed at (its sessionStart input carries no
// sessionId). The receiver publishes its own identity instead, so discovery is
// a file this process wrote about itself rather than an inference about it.
writeFileSync(
	join(box, "ready.json"),
	JSON.stringify(
		{
			sessionId: session.sessionId,
			pid: process.pid,
			cwd: process.cwd(),
			armedAt: new Date().toISOString(),
		},
		null,
		2,
	),
);

const signal = join(box, "inbox.signal");
if (!existsSync(signal)) writeFileSync(signal, "");
log(`ARMED sessionId=${session.sessionId} signal=${signal}`);

for (const type of ["user.message", "assistant.turn_start", "assistant.message", "session.idle"]) {
	session.on(type, (event) => {
		const d = event?.data ?? {};
		log(
			`EVENT ${type} ${JSON.stringify({
				turnId: d.turnId,
				content: typeof d.content === "string" ? d.content.slice(0, 200) : undefined,
				source: d.source,
			})}`,
		);
	});
}

// Serialized because a burst of writes to one signal file is normal and two
// overlapping drains would rename the same `.msg` twice.
let busy = false;
async function drain(why) {
	if (busy) return;
	busy = true;
	try {
		const pending = readdirSync(box)
			.filter((f) => f.endsWith(".msg"))
			.sort();
		for (const name of pending) {
			const from = join(box, name);
			const to = `${from}.delivered`;
			// Rename BEFORE sending: a crash between the two loses one delivery,
			// but sending before renaming would replay it on every later poke.
			renameSync(from, to);
			const body = readFileSync(to, "utf-8");
			log(`DELIVER (${why}) ${name} bytes=${body.length}`);
			await session.send({ prompt: body, mode: "enqueue" });
			log(`SENT ${name}`);
		}
	} catch (err) {
		log(`ERROR ${String(err)}`);
	} finally {
		busy = false;
	}
}

watch(signal, () => {
	void drain("signal");
});
// Messages that arrived while nothing was armed are still owed a delivery.
void drain("startup");
