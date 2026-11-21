// #171 step 9 — stand between Entwurf and one ACP agent and copy what Entwurf writes to it.
//
//   node wire-tee.mjs <log-dir> <command> [args...]
//
// Used by pi-unknown only. Every line of this process's stdin goes, unchanged, to the command's stdin
// and to `<log-dir>/wire-<pid>.ndjson`; the agent's stdout and stderr are inherited. The agent stays
// in this process's group, so a signal to the group reaches both. Nothing is read from the agent.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [dir, command, ...args] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const log = join(dir, `wire-${process.pid}.ndjson`);
appendFileSync(log, "");
const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });
process.stdin.on("data", (chunk) => {
	appendFileSync(log, chunk);
	child.stdin.write(chunk);
});
process.stdin.on("end", () => child.stdin.end());
child.stdin.on("error", () => {});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal === "SIGTERM" ? "SIGKILL" : signal);
	else process.exit(code ?? 1);
});
