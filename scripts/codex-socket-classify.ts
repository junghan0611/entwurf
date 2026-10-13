/**
 * codex-socket-classify — classify the Codex app-server default control socket for THIS
 * environment, through the one product classifier, and print the answer for a shell.
 *
 * WHY A LEAF. `entwurf codex-app-server` is a bash launcher, and it has to decide whether a
 * launch would clobber something. From Codex 0.162.1 the advertised socket path is a
 * rendezvous alias into a vendor-owned directory, and telling the vendor's exact alias from any
 * other symlink takes a hash, an exact readlink comparison and ownership/mode checks. Doing that
 * in the launcher's Python would be a second implementation of a security classification, and
 * `codex-socket-path.ts` records what a second spelling of this socket did once (it diverged).
 * So the launcher asks `checkCodexSocketFile`, the classifier delivery and preflight use, and
 * only connects to what it was told.
 *
 * HOW IT IS REACHED. The launcher runs this file's COMPILED twin,
 * `mcp/entwurf-bridge/dist/scripts/codex-socket-classify.js`, directly with `node` — in a checkout
 * and in an installed package alike. There is no `run.sh` verb and no `run_ts` crossing for it:
 * `build-bridge` emits it (`pnpm install` runs that through `prepare`, packing through `prepack`),
 * and a missing twin is an incomplete installation the launcher refuses by name.
 *
 * One line on stdout, a word then a tab-separated detail:
 *   socket <connectPath>       a verified socket; the launcher connects there to tell live from stale
 *   absent                     nothing at the advertised path
 *   dangling <reason>          Codex's own alias whose socket is gone; the vendor removes it on start
 *   indeterminate <reason>     anything else; the launcher refuses
 *
 * Reads `process.env` and takes no argument, for the reason `codex-socket-path.ts` gives: an argv
 * seam would be a way to redirect the address. It has no daemon-root input either; the gate's
 * exact-alias cells drive `checkCodexSocketFile` directly with a sandbox root.
 */

import {
	checkCodexSocketFile,
	resolveCodexDefaultSocketPath,
} from "../pi-extensions/lib/native-push/codex-ws-client.ts";

if (process.argv.length > 2) {
	console.error("usage: codex-socket-classify   (no arguments; the environment is the input)");
	process.exit(2);
}

const oneLine = (text: string): string => text.replace(/[\t\r\n]+/g, " ");
const check = checkCodexSocketFile(resolveCodexDefaultSocketPath(process.env));
if (check.ok) process.stdout.write(`socket\t${check.connectPath}`);
else if (check.status === "dead" && check.layout === "absent") process.stdout.write("absent");
else if (check.status === "dead") process.stdout.write(`dangling\t${oneLine(check.reason)}`);
else process.stdout.write(`indeterminate\t${oneLine(check.reason)}`);
