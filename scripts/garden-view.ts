#!/usr/bin/env node
/**
 * `entwurf garden` — dependency-free, read-only garden frontend (#114).
 *
 * Herdr's useful interaction is the shape: one live terminal view where placement and
 * agents are visible together. Entwurf keeps different authority. tmux is observed only
 * as launch placement; garden citizens come from the existing owner fact provider. This
 * process never parses transcripts, infers pane↔citizen identity, sends input, launches,
 * resumes, installs, or writes state.
 */

import { execFileSync } from "node:child_process";
import os from "node:os";
import { defaultControlSocketDir } from "../pi-extensions/lib/control-socket-path.js";
import { listEntwurfFacts } from "../pi-extensions/lib/entwurf-fact-provider.ts";
import {
	defaultMetaSessionsDir,
	makeStoreRecordReader,
	readActiveStoreEntries,
} from "../pi-extensions/lib/meta-session.ts";
import {
	type GardenViewSnapshot,
	NO_ATTENTION_REASON,
	NO_JOIN_REASON,
	parseTmuxPaneRows,
	renderGardenView,
	TMUX_FIELD_SEPARATOR,
	type TmuxPlacementSnapshot,
} from "./lib/garden-view.ts";

const TMUX_FORMAT = [
	"#{session_id}",
	"#{session_name}",
	"#{session_attached}",
	"#{window_id}",
	"#{window_index}",
	"#{window_name}",
	"#{window_active}",
	"#{pane_id}",
	"#{pane_index}",
	"#{pane_active}",
	"#{pane_dead}",
	"#{pane_current_command}",
	"#{pane_current_path}",
].join(TMUX_FIELD_SEPARATOR);

interface Args {
	mode: "once" | "watch" | "json";
	intervalMs: number;
}

function usage(): never {
	console.error("usage: entwurf garden [--once | --watch | --json] [--interval-ms N]");
	process.exit(2);
}

function parseArgs(argv: string[]): Args {
	let selected: Args["mode"] | null = null;
	let intervalMs = 1500;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			console.log("usage: entwurf garden [--once | --watch | --json] [--interval-ms N]");
			console.log("  exit: 0 success; 2 usage or non-TTY --watch; 3 runtime failure");
			console.log(
				"  --watch actively re-observes every frame: control-socket probes plus at most 32 receiver/transcript details.",
			);
			console.log("  default: --watch on an interactive terminal, --once otherwise");
			process.exit(0);
		}
		if (arg === "--once" || arg === "--watch" || arg === "--json") {
			const mode = arg.slice(2) as Args["mode"];
			if (selected !== null && selected !== mode) usage();
			selected = mode;
			continue;
		}
		if (arg === "--interval-ms") {
			const value = argv[++i];
			if (value === undefined || !/^\d+$/.test(value)) usage();
			intervalMs = Number(value);
			if (!Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 60_000) usage();
			continue;
		}
		usage();
	}
	return {
		mode: selected ?? (process.stdout.isTTY && process.stdin.isTTY ? "watch" : "once"),
		intervalMs,
	};
}

function tmuxPlacement(): TmuxPlacementSnapshot {
	try {
		const stdout = execFileSync("tmux", ["list-panes", "-a", "-F", TMUX_FORMAT], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 2000,
		});
		return {
			source: "tmux",
			authority: "placement-observation-only",
			scope: "whole-current-server-inventory",
			status: "ok",
			panes: parseTmuxPaneRows(stdout),
			error: null,
		};
	} catch (error) {
		const e = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
		const stderr = typeof e.stderr === "string" ? e.stderr : Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : "";
		const reason = e.code === "ENOENT" ? "tmux executable not found" : stderr.trim() || e.message;
		return {
			source: "tmux",
			authority: "placement-observation-only",
			scope: "whole-current-server-inventory",
			status: "unavailable",
			panes: [],
			error: reason.replace(/[\r\n]+/g, " "),
		};
	}
}

async function observe(): Promise<GardenViewSnapshot> {
	const sessionsDir = defaultMetaSessionsDir();
	const controlDir = process.env.ENTWURF_DIR ?? defaultControlSocketDir(os.homedir());
	const result = await listEntwurfFacts({
		metaEntries: readActiveStoreEntries(sessionsDir),
		readRecord: makeStoreRecordReader(sessionsDir),
		socket: { dir: controlDir },
		observationLimit: 32,
	});
	return {
		schemaVersion: 1,
		observedAt: new Date().toISOString(),
		host: os.hostname(),
		placement: tmuxPlacement(),
		garden: {
			source: "entwurf-fact-provider",
			authority: "garden-id-record-and-rail-facts",
			scope: "retained-record-store",
			detailObservationLimit: 32,
			peers: result.facts.peers,
			diagnostics: result.diagnostics,
		},
		join: { state: "not-performed", reason: NO_JOIN_REASON },
		attention: { state: "not-observed", reason: NO_ATTENTION_REASON },
	};
}

function terminalSize(): { columns: number; rows: number } {
	const envColumns = Number(process.env.COLUMNS);
	const envRows = Number(process.env.LINES);
	return {
		columns: process.stdout.columns ?? (Number.isFinite(envColumns) && envColumns > 0 ? envColumns : 120),
		rows: process.stdout.rows ?? (Number.isFinite(envRows) && envRows > 0 ? envRows : 32),
	};
}

async function printFrame(clear: boolean): Promise<void> {
	const snapshot = await observe();
	if (clear) process.stdout.write("\u001b[H\u001b[2J");
	process.stdout.write(`${renderGardenView(snapshot, terminalSize())}\n`);
}

async function watch(intervalMs: number): Promise<void> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.error("entwurf garden: --watch requires an interactive terminal");
		process.exit(2);
	}
	let stopped = false;
	let timer: NodeJS.Timeout | undefined;
	let drawing = false;
	const cleanup = () => {
		if (stopped) return;
		stopped = true;
		if (timer) clearInterval(timer);
		process.stdin.setRawMode(false);
		process.stdin.pause();
		process.stdout.write("\u001b[?25h\u001b[?1049l");
	};
	const draw = async () => {
		if (drawing || stopped) return;
		drawing = true;
		try {
			await printFrame(true);
		} catch (error) {
			cleanup();
			throw error;
		} finally {
			drawing = false;
		}
	};
	process.stdout.write("\u001b[?1049h\u001b[?25l");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", (chunk: Buffer) => {
		const key = chunk.toString("utf8");
		if (key === "q" || key === "\u0003") cleanup();
		else if (key === "r") void draw();
	});
	process.once("SIGTERM", cleanup);
	process.once("SIGHUP", cleanup);
	await draw();
	if (!stopped) timer = setInterval(() => void draw(), intervalMs);
	await new Promise<void>((resolve) => {
		const finish = setInterval(() => {
			if (!stopped) return;
			clearInterval(finish);
			resolve();
		}, 25);
	});
}

const args = parseArgs(process.argv.slice(2));
try {
	if (args.mode === "json") {
		process.stdout.write(`${JSON.stringify(await observe(), null, 2)}\n`);
	} else if (args.mode === "watch") {
		await watch(args.intervalMs);
	} else {
		await printFrame(false);
	}
} catch (error) {
	console.error(`entwurf garden: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(3);
}
