/**
 * take-recorder — the thin capture plumbing two demo takes share (#138). Not a harness, not a scene runner:
 * each take stays one linear script that decides its own steps and oracles. This only owns
 *   - the identity-carrier strip (this shell's citizen identity never reaches the take),
 *   - a PRIVATE tmux server (take-scoped config, never the operator's) with one subject session,
 *   - a recorder-only grouped `view` session: switching its window changes what is recorded and never the
 *     subject session's current window, layout or any citizen's placement,
 *   - asciinema attached read-only to that view, and its stop,
 *   - the assertion / view-switch log and the manifest it writes next to the cast.
 * Teardown kills only this private server, plus whatever a take registered as its own (registerTeardown).
 * Records, transcripts and native stores are left in place.
 */
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as meta from "../../pi-extensions/lib/meta-session.ts";
import { parseJsonLines } from "../../scripts/lib/codex-fresh-source-receipts.ts";

export const GARDEN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;
export const NONCE = /nonce:\s+(mux-fresh-call-[0-9a-f]+)/;
export const CONTROL_SOCKET_BOUNDARY =
	/^entwurf_v2 control-socket → (sent|queued-steer|queued-follow-up|accepted-unknown-boundary)/;

/**
 * This shell's citizen identity, session nesting and tmux placement carriers — and only those — removed before
 * anything is launched. Auth and provider settings (e.g. CLAUDE_CODE_OAUTH_TOKEN) stay as the operator has
 * them: the take never reads, copies or rewrites a credential.
 */
const IDENTITY_KEYS = new Set([
	"TMUX",
	"TMUX_PANE",
	"PI_SESSION_ID",
	"PI_AGENT_ID",
	"ENTWURF_CALLBACK_TARGET",
	"ENTWURF_CALLBACK_NONCE",
	"ENTWURF_META_SENDER_MARKER",
	"CLAUDECODE",
	"CLAUDE_PID",
	"CLAUDE_EFFORT",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_SESSION_ATTENDED",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_EXECPATH",
	"CLAUDE_CODE_MESSAGING_SOCKET",
	"CLAUDE_CODE_MESSAGING_TOKEN",
]);
export function stripIdentityEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...source };
	for (const name of Object.keys(env)) if (IDENTITY_KEYS.has(name)) delete env[name];
	return env;
}

/** A provider base-URL override that routes through OpenRouter, which no demo take may spend on; else null. */
export function openRouterOverride(env: NodeJS.ProcessEnv): string | null {
	for (const [name, value] of Object.entries(env))
		if (/BASE_URL$/.test(name) && typeof value === "string" && /openrouter\.ai/i.test(value)) return name;
	return null;
}

/** Messages that landed in a pi transcript as entwurf-message rows: payload + the anchored sender envelope. */
export function piInbound(entries: readonly unknown[]): Array<{ index: number; payload: string; sender: string }> {
	const out: Array<{ index: number; payload: string; sender: string }> = [];
	entries.forEach((raw, index) => {
		const e = raw as { type?: unknown; customType?: unknown; content?: unknown };
		if (e.type !== "custom_message" || e.customType !== "entwurf-message" || typeof e.content !== "string") return;
		const m = /^([\s\S]*)\n\n<sender_info>(\{[^\n]*\})<\/sender_info>$/.exec(e.content);
		if (!m) return;
		try {
			const s = JSON.parse(m[2] as string) as { sessionId?: unknown };
			if (typeof s.sessionId === "string") out.push({ index, payload: m[1] as string, sender: s.sessionId });
		} catch {
			/* not an envelope */
		}
	});
	return out;
}

/** provider/model of every assistant row in a pi transcript (the measured model, not a footer label). */
export function piAssistantModels(entries: readonly unknown[]): string[] {
	const models = new Set<string>();
	for (const raw of entries) {
		const e = raw as { type?: unknown; message?: { role?: unknown; provider?: unknown; model?: unknown } };
		if (e.type === "message" && e.message?.role === "assistant")
			models.add(`${String(e.message.provider)}/${String(e.message.model)}`);
	}
	return [...models];
}

export function gardenIds(): Set<string> {
	return new Set(meta.listAllMetaIdentitiesDir(meta.defaultMetaSessionsDir()).identities.map((r) => r.gardenId));
}
export function newCitizensIn(cwd: string, before: Set<string>): string[] {
	return meta
		.listAllMetaIdentitiesDir(meta.defaultMetaSessionsDir())
		.identities.filter((r) => !before.has(r.gardenId) && r.cwd === cwd)
		.map((r) => r.gardenId);
}
/** A citizen's own transcript rows (pi JSONL), or [] while it is not written yet. */
export function piEntriesOf(gardenId: string): unknown[] {
	const t = meta.readMetaIdentityByGardenId(gardenId)?.transcriptPath ?? "";
	return t && fs.existsSync(t) ? parseJsonLines(fs.readFileSync(t, "utf8")) : [];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TakeInit {
	label: string;
	repo: string;
	cols: number;
	rows: number;
	files?: Record<string, string>;
}

export class Take {
	readonly label: string;
	readonly repo: string;
	readonly cols: number;
	readonly rows: number;
	readonly takeDir: string;
	readonly castPath: string;
	readonly env: NodeJS.ProcessEnv;
	readonly scratchRoot: string;
	readonly scratch: string;
	readonly assertions: Array<{ at: string; assertion: string; ok: boolean; detail?: string }> = [];
	readonly views: Array<{ at: string; window: string; why: string }> = [];
	readonly receipts: Record<string, unknown> = {};
	measuredModels: Record<string, string[]> = {};
	readonly startedAt: string;
	private readonly socket: string;
	private readonly tmuxConf: string;
	private serverUp = false;
	private recorder: ChildProcess | null = null;
	private recorderStartedAt: string | null = null;
	private recorderEnd: { code: number | null; signal: string | null; at: string; duringFinish: boolean } | null = null;
	private recorderError: string | null = null;
	private finishing = false;
	private readonly ownedTeardown: Array<() => void> = [];

	constructor(init: TakeInit) {
		this.label = init.label;
		this.repo = init.repo;
		this.cols = init.cols;
		this.rows = init.rows;
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const outRoot = process.env.ENTWURF_DEMO_OUT?.trim() || path.join(init.repo, ".tmp-verify", "138-demo-gifs");
		this.takeDir = path.join(outRoot, "takes", `${init.label}-${stamp}`);
		fs.mkdirSync(this.takeDir, { recursive: true });
		this.castPath = path.join(this.takeDir, "take.cast");
		this.env = stripIdentityEnv(process.env);
		this.scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "entwurf-demo-"));
		this.scratch = fs.realpathSync(this.scratchRoot);
		for (const [name, text] of Object.entries(init.files ?? {})) fs.writeFileSync(path.join(this.scratch, name), text);
		this.socket = path.join(this.scratchRoot, "demo.sock");
		// Take-scoped tmux config (never the operator's ~/.tmux.conf): pi warns without extended keys in csi-u.
		this.tmuxConf = path.join(this.scratchRoot, "demo.tmux.conf");
		fs.writeFileSync(this.tmuxConf, "set -s extended-keys on\nset -s extended-keys-format csi-u\n");
		this.startedAt = new Date().toISOString();
		process.on("exit", () => this.teardown());
	}

	step(name: string, ok: boolean, detail?: string): void {
		this.assertions.push({ at: new Date().toISOString(), assertion: name, ok, detail });
		console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail && !ok ? `\n        ${detail}` : ""}`);
	}

	/** A critical milestone: record it, and hand back whether the take may go on (the caller returns on false). */
	must(name: string, ok: boolean, detail?: string): boolean {
		this.step(name, ok, detail);
		return ok;
	}

	tmux(...args: string[]): string {
		return execFileSync("tmux", ["-S", this.socket, ...args], { env: this.env, encoding: "utf8" }).trim();
	}

	/** Start the subject session running ONE operator command, plus the recorder-only view; returns its window id. */
	startSubject(windowName: string, argv: string[]): string {
		execFileSync(
			"tmux",
			[
				"-S",
				this.socket,
				"-f",
				this.tmuxConf,
				"new-session",
				"-d",
				"-s",
				"main",
				"-n",
				windowName,
				"-x",
				String(this.cols),
				"-y",
				String(this.rows),
				"-c",
				this.scratch,
				...argv,
			],
			{ env: this.env },
		);
		this.serverUp = true;
		const window = this.tmux("display-message", "-p", "-t", `main:${windowName}`, "#{window_id}");
		this.tmux("new-session", "-d", "-s", "view", "-t", "main", "-x", String(this.cols), "-y", String(this.rows));
		this.tmux("set-option", "-t", "view", "status", "off");
		return window;
	}

	windowOfPane(pane: string): string {
		return this.tmux("display-message", "-p", "-t", pane, "#{window_id}");
	}

	show(windowId: string, why: string): void {
		this.tmux("select-window", "-t", `view:${windowId}`);
		this.views.push({ at: new Date().toISOString(), window: windowId, why });
		console.log(`  view  → ${windowId} (${why})`);
	}

	/** Record `command` (default: the read-only attach to this take's tmux view) under the take's env. */
	startRecorder(command = `tmux -S ${this.socket} attach -r -t view`): void {
		this.recorderStartedAt = new Date().toISOString();
		this.recorder = spawn(
			"asciinema",
			[
				"rec",
				"--overwrite",
				"--quiet",
				"--headless",
				"--window-size",
				`${this.cols}x${this.rows}`,
				"--command",
				command,
				this.castPath,
			],
			{ env: this.env, stdio: "ignore" },
		);
		this.recorder.on("error", (err) => {
			this.recorderError = err.message;
		});
		this.recorder.on("exit", (code, signal) => {
			this.recorderEnd = { code, signal, at: new Date().toISOString(), duringFinish: this.finishing };
		});
	}

	/** The capture is cut when the recorder failed or ended while the take was still running; else null. */
	private recordingLost(): string | null {
		if (!this.recorder) return null;
		if (this.recorderError) return `recorder failed: ${this.recorderError}`;
		if (this.recorderEnd && !this.recorderEnd.duringFinish)
			return `recorder ended before the take did: ${JSON.stringify(this.recorderEnd)}`;
		return null;
	}

	/**
	 * A resource the take itself created outside the private tmux server (e.g. a private herdr server whose
	 * client IS the recorded view). Runs once: in finish() after the view detach and before the recorder is
	 * awaited — so a client that exits with its server ends the cast — or on process exit when finish never ran.
	 * Synchronous; whatever it cannot prove it records, it does not widen to resources it did not create.
	 */
	registerTeardown(fn: () => void): void {
		this.ownedTeardown.push(fn);
	}

	private runOwnedTeardown(): void {
		for (const fn of this.ownedTeardown.splice(0)) {
			try {
				fn();
			} catch (err) {
				this.step("owned teardown", false, err instanceof Error ? (err.stack ?? err.message) : String(err));
			}
		}
	}

	async until<T>(what: string, timeoutMs: number, probe: () => T | null | undefined): Promise<T | null> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const lost = this.recordingLost();
			if (lost) {
				this.step(`the recording is intact while waiting for ${what}`, false, lost);
				return null;
			}
			let got: T | null | undefined = null;
			try {
				got = probe();
			} catch {
				got = null; // a half-written file is "not yet"
			}
			if (got !== null && got !== undefined) return got;
			if (Date.now() > deadline) {
				this.step(`waiting for ${what}`, false, `timed out after ${timeoutMs}ms`);
				return null;
			}
			await sleep(1000);
		}
	}

	private teardown(): void {
		this.runOwnedTeardown();
		if (this.serverUp) spawnSync("tmux", ["-S", this.socket, "kill-server"], { env: this.env, stdio: "ignore" });
		this.serverUp = false;
	}

	/** Detach the view (ends the recording), kill the private server, write the manifest; returns the verdict. */
	async finish(passed: boolean, fields: Record<string, unknown>): Promise<boolean> {
		const lostBeforeFinish = this.recordingLost();
		this.finishing = true;
		if (this.serverUp)
			spawnSync("tmux", ["-S", this.socket, "detach-client", "-s", "view"], { env: this.env, stdio: "ignore" });
		this.runOwnedTeardown();
		const recorder = this.recorder;
		let cutByTimeout = false;
		if (recorder && this.recorderEnd === null && this.recorderError === null)
			await new Promise<void>((resolve) => {
				const t = setTimeout(() => {
					cutByTimeout = true;
					recorder.kill("SIGTERM");
					resolve();
				}, 10_000);
				recorder.on("exit", () => {
					clearTimeout(t);
					resolve();
				});
			});
		// asciinema 3.2.0 exits 0 whatever its command did (measured); the command's own status is the cast's "x"
		// event. So the capture is judged by WHEN and HOW the recorder ended, not by the view command's status.
		const recording = { end: this.recorderEnd, error: this.recorderError, cutByTimeout, lostBeforeFinish };
		this.step(
			"the recording ran until the take ended and the recorder stopped cleanly (no cut, no signal, exit 0)",
			lostBeforeFinish === null &&
				!cutByTimeout &&
				this.recorderError === null &&
				this.recorderEnd?.duringFinish === true &&
				this.recorderEnd.code === 0 &&
				this.recorderEnd.signal === null,
			JSON.stringify(recording),
		);
		this.teardown();
		const verdict = passed && this.assertions.every((a) => a.ok) ? "live-pass" : "failed";
		const versions = {
			entwurf: JSON.parse(fs.readFileSync(path.join(this.repo, "package.json"), "utf8")).version as string,
			gitHead: execFileSync("git", ["-C", this.repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
			gitDirty: execFileSync("git", ["-C", this.repo, "status", "--porcelain"], { encoding: "utf8" }).trim() !== "",
			pi: spawnSync("pi", ["--version"], { env: this.env, encoding: "utf8" }).stdout.trim(),
			entwurfOnPath: spawnSync("bash", ["-c", 'readlink -f "$(command -v entwurf)"'], {
				env: this.env,
				encoding: "utf8",
			}).stdout.trim(),
		};
		const manifest = {
			take: this.label,
			verdict,
			stage: "SOURCE tooling (this checkout); entwurfOnPath is observed, not source-bound or package acceptance",
			startedAt: this.startedAt,
			recorderStartedAt: this.recorderStartedAt,
			endedAt: new Date().toISOString(),
			viewport: `${this.cols}x${this.rows}`,
			scratch: this.scratch,
			versions,
			...fields,
			views: this.views,
			assertions: this.assertions,
			receipts: this.receipts,
			recording: this.recorder ? recording : null,
			cast: fs.existsSync(this.castPath)
				? { path: this.castPath, sha256: createHash("sha256").update(fs.readFileSync(this.castPath)).digest("hex") }
				: null,
		};
		fs.writeFileSync(path.join(this.takeDir, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
		console.log(`[${this.label}] ${verdict} — ${this.takeDir}`);
		return verdict === "live-pass";
	}
}
