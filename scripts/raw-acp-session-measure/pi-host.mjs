// #171 step 9 — one real Pi resident in rpc mode inside the run sandbox, shared by pi-smoke and
// pi-unknown. NOT a gate.
//
// Sandbox: HOME, XDG and PI_CODING_AGENT_DIR are the run's (common.mjs refuses otherwise). Production
// reads the vendor's real config at `$HOME/.claude` / `$HOME/.gemini`, so those two names are created
// in the sandbox HOME as symlinks to the operator's directories: the same exposure as the overlay
// links of the other probes (README, "What it touches"). No file inside them is opened here.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CLAUDE_CRED, mt, REAL_CLAUDE, REAL_GEMINI, REPO, RUN, TOKEN } from "./common.mjs";

export const backend = process.argv[3] === "agy" ? "agy" : "claude";
export const MODEL =
	process.env.ENTWURF_RAW_PI_MODEL || (backend === "agy" ? "agy-gemini-3.8-flash" : "claude-sonnet-5-5");
const HOME = process.env.HOME;
export const AGENT = process.env.PI_CODING_AGENT_DIR;
const WORK = join(RUN, "work");
// session-store.ts `sessionCacheDir`.
const RECORDS = join(AGENT, "cache", "entwurf", "sessions");
mkdirSync(WORK, { recursive: true });
// The sandbox's own Pi settings: keep almost nothing on compaction, so this short session has something to
// summarise (the default keeps the last 20k tokens and would refuse it as too small).
writeFileSync(join(AGENT, "settings.json"), `${JSON.stringify({ compaction: { keepRecentTokens: 1 } })}\n`);
if (!existsSync(join(HOME, ".claude"))) symlinkSync(REAL_CLAUDE, join(HOME, ".claude"));
if (!existsSync(join(HOME, ".gemini"))) symlinkSync(REAL_GEMINI, join(HOME, ".gemini"));

export const TURN_MS = 240_000;
export const mtimeBefore = { claude: mt(CLAUDE_CRED), agy: mt(TOKEN) };
export const steps = [];
let launches = 0;

/** One Pi resident in rpc mode. `sessionFile`: reopen that session. `env`: added to the sandbox environment. */
export function launch(sessionFile, env = {}) {
	const name = `pi-${++launches}`;
	const args = ["--no-extensions", "-e", "builtin:mcp", "-e", REPO, "--entwurf-control"];
	if (sessionFile) args.push("--session", sessionFile);
	args.push("--provider", "entwurf", "--model", MODEL, "--mode", "rpc");
	const child = spawn("pi", args, {
		cwd: WORK,
		stdio: ["pipe", "pipe", "pipe"],
		detached: true,
		env: { ...process.env, ...env },
	});
	let stderr = "";
	child.stderr.on("data", (d) => {
		stderr += d;
	});
	const events = [];
	const waiters = [];
	createInterface({ input: child.stdout }).on("line", (line) => {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		events.push(event);
		for (const w of [...waiters]) if (w.test(event)) w.done(event);
	});
	const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
	const waitFor = (test, ms, what) =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`${name}: no ${what} within ${ms}ms`)), ms);
			const w = {
				test,
				done: (event) => {
					clearTimeout(timer);
					waiters.splice(waiters.indexOf(w), 1);
					resolve(event);
				},
			};
			waiters.push(w);
		});
	let seq = 0;
	const command = async (body, ms = 30_000) => {
		const id = `${name}-${++seq}`;
		const answer = waitFor((e) => e.type === "response" && e.id === id, ms, `response to ${body.type}`);
		child.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
		return answer;
	};
	/**
	 * Send one prompt and wait until Pi will not continue by itself. `abortAfterMs`: press Esc then.
	 * `during`: awaited once Pi accepted the prompt.
	 */
	const turn = async (label, message, abortAfterMs, during) => {
		const from = events.length;
		const settled = waitFor((e) => e.type === "agent_settled", TURN_MS, `agent_settled (${label})`);
		await command({ type: "prompt", message });
		if (abortAfterMs !== undefined) {
			await new Promise((r) => setTimeout(r, abortAfterMs));
			await command({ type: "abort" });
		}
		if (during) await during();
		await settled;
		const seen = events.slice(from);
		const last = seen.filter((e) => e.type === "message_end" && e.message?.role === "assistant").at(-1)?.message;
		const blocks = Array.isArray(last?.content) ? last.content.filter((b) => b.type === "text") : [];
		const step = {
			label,
			pi: name,
			stopReason: last?.stopReason ?? null,
			errorMessage: last?.errorMessage ?? null,
			responseId: last?.responseId ?? null,
			notices: blocks.filter((b) => b.textSignature).map((b) => b.text.trim()),
			text: blocks
				.filter((b) => !b.textSignature)
				.map((b) => b.text)
				.join("")
				.slice(0, 400),
			diagnostics: (last?.diagnostics ?? []).map((d) => d.type),
			assistantMessages: seen.filter((e) => e.type === "message_end" && e.message?.role === "assistant").length,
		};
		steps.push(step);
		return step;
	};
	const quit = async () => {
		child.stdin.end();
		const timer = setTimeout(() => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
		}, 30_000);
		const end = await exited;
		clearTimeout(timer);
		writeFileSync(join(RUN, `${name}.stderr.log`), stderr);
		writeFileSync(join(RUN, `${name}.events.ndjson`), events.map((e) => JSON.stringify(e)).join("\n"));
		return end;
	};
	return { name, command, turn, quit, child };
}

export const list = (dir) => {
	try {
		return readdirSync(dir, { recursive: true }).map(String).sort();
	} catch {
		return [];
	}
};
export const records = () =>
	list(RECORDS)
		.filter((f) => f.endsWith(".json"))
		.map((f) => JSON.parse(readFileSync(join(RECORDS, f), "utf8")));
export const leases = () => list(join(AGENT, "entwurf-acp-holders")).filter((f) => f.endsWith(".json"));
export const mtimes = () => ({ claude: mt(CLAUDE_CRED), agy: mt(TOKEN) });
/** What Pi stored of this provider's answers in `sessionFile`. */
export const storedAnswers = (sessionFile) =>
	readFileSync(sessionFile, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l))
		.filter((e) => e.type === "message" && e.message?.role === "assistant" && e.message?.provider === "entwurf")
		.map((e) => ({
			stopReason: e.message.stopReason,
			responseId: e.message.responseId ?? null,
			diagnostics: (e.message.diagnostics ?? []).map((d) => d.type),
			signedBlocks: (e.message.content ?? []).filter((b) => b.textSignature).length,
		}));
