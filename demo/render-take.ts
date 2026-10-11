/**
 * render-take — credential-free render of ONE recorded take (#138): cast → GIF plus a sidecar manifest.
 *
 *   node demo/render-take.ts <take-dir> [<out.gif>]
 *
 * Never spawns a citizen or a model turn. Refuses when the cast's sha256 is not the one the take's manifest
 * recorded, or when the cast text carries an email address or a company-repo path.
 *
 * Destination: a `live-pass` take renders to `<out>` or the private artifacts dir. Any other verdict renders
 * ONLY to the private artifacts dir under a FAILED name; a caller-named destination is refused for it, so a
 * failed or synthetic take can never overwrite a published asset. Repository docs/assets destinations (including
 * parent aliases) are refused even for live-pass: publication is a separate operator-reviewed copy.
 *
 * Last good stays last good: agg writes a temp file beside the destination, and only a zero exit plus a GIF that
 * ffprobe actually DECODES (gif codec, positive dimensions, at least one frame, no decode error) promotes it by
 * one rename. A failed or undecodable render leaves the existing GIF and its sidecar untouched.
 * The pair is NOT one atomic unit: the sidecar follows by a second rename, so a crash between the two leaves the
 * new GIF beside the previous sidecar, whose gifSha256 then no longer matches (caption-take refuses that pair).
 * The destination must end in `.gif`; anything else is refused before any output is written.
 *
 * The one edit to the frames, declared in the sidecar: the recorder's own teardown — the strict tail suffix
 * of an alternate-screen-exit event followed by tmux's `[detached (from session …)]` notice, or a herdr client's
 * single exit event (only mode-restoring CSI sequences with the alternate-screen exit, then herdr's
 * `herdr: server shut down: …` line) — is dropped.
 * The same bytes anywhere else are the subject's and are kept; an unrecognized tail is not trimmed.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type CastEvent = [number, string, string];

const ALT_SCREEN_EXIT = "\u001b[?1049l";
const DETACH_NOTICE = /^\[detached \(from session [^)\n]*\)\]\r?\n$/;
// `[measured herdr 0.9.3, S0 s0b.cast]` the client restores the terminal modes (alternate-screen exit among them)
// and prints this line in ONE event.
const HERDR_SHUTDOWN = "herdr: server shut down: ";
const HERDR_SHUTDOWN_LINE = /herdr: server shut down: [^\r\n]*\r?\n$/;

/** True when `text` is nothing but CSI control sequences (ESC [ params intermediates final) — no printable content. */
export function isOnlyCsi(text: string): boolean {
	let i = 0;
	while (i < text.length) {
		if (text.charCodeAt(i) !== 0x1b || text[i + 1] !== "[") return false;
		i += 2;
		while (i < text.length && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x3f) i++;
		while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) i++;
		const final = text.charCodeAt(i);
		if (!(final >= 0x40 && final <= 0x7e)) return false;
		i++;
	}
	return true;
}

/** One output event that is ONLY the client's teardown: mode-restoring CSI sequences including the alternate-screen
 * exit, then herdr's own shutdown line. Any printable subject content before the line keeps the whole event. */
function isHerdrClientExit(event: CastEvent | undefined): boolean {
	if (event?.[1] !== "o" || !HERDR_SHUTDOWN_LINE.test(event[2])) return false;
	const prefix = event[2].slice(0, event[2].lastIndexOf(HERDR_SHUTDOWN));
	return prefix.includes(ALT_SCREEN_EXIT) && isOnlyCsi(prefix);
}

/** Drop the recorder teardown suffix — exactly [alt-screen exit, detach notice, (exit events)] or a herdr client's
 * [alt-screen exit + shutdown line, (exit events)] — or nothing. `what` names which one went. */
export function trimRecorderTeardown(events: readonly CastEvent[]): {
	events: CastEvent[];
	trimmed: number;
	what: string | null;
} {
	let end = events.length;
	while (end > 0 && events[end - 1]?.[1] === "x") end--;
	const notice = events[end - 1];
	const teardown = events[end - 2];
	if (
		notice?.[1] === "o" &&
		DETACH_NOTICE.test(notice[2]) &&
		teardown?.[1] === "o" &&
		teardown[2].includes(ALT_SCREEN_EXIT) &&
		isOnlyCsi(teardown[2])
	) {
		return {
			events: events.slice(0, end - 2),
			trimmed: events.length - (end - 2),
			what: "recorder teardown: alt-screen exit + tmux detach notice",
		};
	}
	if (isHerdrClientExit(notice)) {
		return {
			events: events.slice(0, end - 1),
			trimmed: events.length - (end - 1),
			what: "recorder teardown: herdr client exit (alt-screen exit + server shut down line)",
		};
	}
	return { events: [...events], trimmed: 0, what: null };
}

export function parseCast(text: string): { header: string; events: CastEvent[] } {
	const lines = text.split("\n").filter((l) => l !== "");
	const [header, ...rest] = lines;
	if (header === undefined || JSON.parse(header).version !== 3) throw new Error("render-take: not an asciicast v3");
	return { header, events: rest.map((l) => JSON.parse(l) as CastEvent) };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export interface RenderOptions {
	takeDir: string;
	out?: string;
	artifactsDir?: string;
	agg?: string;
	ffprobe?: string;
	aggArgs?: string[];
	timeoutMs?: number;
}
export interface RenderResult {
	gif: string;
	sidecar: string;
	verdict: string;
	bytes: number;
	sha256: string;
	trimmed: number;
}

function sha256(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** ffprobe's verdict on a file: a decodable GIF with positive dimensions and at least one frame, or why not. */
export function probeGif(file: string, ffprobe = process.env.ENTWURF_DEMO_FFPROBE ?? "ffprobe"): string | null {
	const run = spawnSync(
		ffprobe,
		[
			"-v",
			"error",
			"-count_frames",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=codec_name,width,height,nb_read_frames",
			"-of",
			"json",
			file,
		],
		{ encoding: "utf8", timeout: 60_000 },
	);
	if (run.error) return `ffprobe could not run: ${run.error.message}`;
	if (run.status !== 0 || run.stderr.trim() !== "") return `ffprobe exit ${run.status}: ${run.stderr.trim()}`;
	const stream = (JSON.parse(run.stdout) as { streams?: Array<Record<string, unknown>> }).streams?.[0];
	if (!stream) return "ffprobe found no video stream";
	if (stream.codec_name !== "gif") return `codec ${String(stream.codec_name)}, not gif`;
	if (!(Number(stream.width) > 0 && Number(stream.height) > 0)) return `dimensions ${stream.width}x${stream.height}`;
	if (!(Number(stream.nb_read_frames) >= 1)) return `frames ${String(stream.nb_read_frames)}`;
	return null;
}

/** Publication is a reviewed copy, never a renderer destination. Resolve existing parent aliases before IO. */
export function isPublicationOutput(out: string): boolean {
	const root = path.resolve(import.meta.dirname, "..", "docs", "assets");
	const publication = fs.existsSync(root) ? fs.realpathSync(root) : root;
	let parent = path.dirname(out);
	while (!fs.existsSync(parent)) parent = path.dirname(parent);
	const physical = path.resolve(fs.realpathSync(parent), path.relative(parent, out));
	const relative = path.relative(publication, physical);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function renderTake(opts: RenderOptions): RenderResult {
	const takeDir = path.resolve(opts.takeDir);
	const castPath = path.join(takeDir, "take.cast");
	const manifest = JSON.parse(fs.readFileSync(path.join(takeDir, "manifest.json"), "utf8")) as {
		take: string;
		verdict: string;
		cast?: { sha256?: string } | null;
	};
	const castBytes = fs.readFileSync(castPath);
	const castSha = sha256(castBytes);
	if (manifest.cast?.sha256 !== castSha)
		throw new Error(`render-take: cast sha256 ${castSha} is not the manifest's ${manifest.cast?.sha256}`);
	const castText = castBytes.toString("utf8");
	const emails = [...new Set(castText.match(EMAIL) ?? [])];
	if (emails.length > 0) throw new Error(`render-take: the cast text carries an email address: ${emails.join(", ")}`);
	if (castText.includes("repos/work")) throw new Error("render-take: the cast text carries a company-repo path");

	const name = manifest.take.replace(/^take-/, "");
	const artifactsDir = path.resolve(opts.artifactsDir ?? path.join(path.dirname(path.dirname(takeDir)), "artifacts"));
	let out: string;
	if (manifest.verdict === "live-pass") {
		out = path.resolve(opts.out ?? path.join(artifactsDir, `entwurf-${name}.gif`));
	} else {
		if (opts.out !== undefined)
			throw new Error(
				`render-take: verdict=${manifest.verdict} renders only to the private FAILED path, never to ${opts.out}`,
			);
		out = path.join(artifactsDir, `entwurf-${name}.FAILED-${path.basename(takeDir)}.gif`);
	}
	if (isPublicationOutput(out))
		throw new Error(`render-take: publication destination refused; review and copy separately: ${out}`);
	if (!out.endsWith(".gif")) throw new Error(`render-take: the destination must end in .gif, not ${out}`);
	const sidecar = out.replace(/\.gif$/, ".manifest.json");
	fs.mkdirSync(path.dirname(out), { recursive: true });

	const { header, events } = parseCast(castText);
	const { events: kept, trimmed, what: trimmedWhat } = trimRecorderTeardown(events);
	const tag = `${process.pid}-${randomBytes(4).toString("hex")}`;
	// Keep each render's exact input beside its private output, including failed attempts.
	// Never replace take.render.cast: it can be the original approved GIF's input evidence.
	const renderCast = path.join(path.dirname(out), `.${path.basename(out)}.${tag}.render.cast`);
	fs.writeFileSync(renderCast, `${[header, ...kept.map((e) => JSON.stringify(e))].join("\n")}\n`);
	const tmpGif = path.join(path.dirname(out), `.${path.basename(out)}.${tag}.tmp`);
	const tmpSidecar = path.join(path.dirname(out), `.${path.basename(sidecar)}.${tag}.tmp`);
	const aggArgs = opts.aggArgs ?? [
		"--idle-time-limit",
		process.env.GIF_IDLE ?? "2",
		"--speed",
		process.env.GIF_SPEED ?? "1",
		"--last-frame-duration",
		"8",
		"--font-size",
		process.env.GIF_FONT_SIZE ?? "14",
		"--theme",
		process.env.GIF_THEME ?? "monokai",
	];
	try {
		const run = spawnSync(opts.agg ?? process.env.ENTWURF_DEMO_AGG ?? "agg", [...aggArgs, renderCast, tmpGif], {
			stdio: ["ignore", "ignore", "pipe"],
			timeout: opts.timeoutMs ?? 300_000,
		});
		if (run.error || run.status !== 0)
			throw new Error(`render-take: agg failed (${run.error?.message ?? `exit ${run.status}`}) ${run.stderr ?? ""}`);
		if (!fs.existsSync(tmpGif)) throw new Error("render-take: agg produced no file");
		const undecodable = probeGif(tmpGif, opts.ffprobe);
		if (undecodable !== null) throw new Error(`render-take: agg output is not a decodable GIF — ${undecodable}`);
		const gif = fs.readFileSync(tmpGif);
		const result: RenderResult = {
			gif: out,
			sidecar,
			verdict: manifest.verdict,
			bytes: gif.length,
			sha256: sha256(gif),
			trimmed,
		};
		fs.writeFileSync(
			tmpSidecar,
			`${JSON.stringify(
				{
					...manifest,
					render: {
						gif: path.basename(out),
						gifSha256: result.sha256,
						bytes: result.bytes,
						castSha256: castSha,
						renderCast: path.basename(renderCast),
						renderCastSha256: sha256(fs.readFileSync(renderCast)),
						trimmedTailEvents: trimmed,
						trimmedWhat,
						aggArgs,
						renderedAt: new Date().toISOString(),
					},
				},
				null,
				"\t",
			)}\n`,
		);
		fs.renameSync(tmpGif, out);
		fs.renameSync(tmpSidecar, sidecar);
		return result;
	} finally {
		fs.rmSync(tmpGif, { force: true });
		fs.rmSync(tmpSidecar, { force: true });
	}
}

if (import.meta.main) {
	const [takeDir, out] = process.argv.slice(2);
	if (!takeDir) {
		console.error("usage: node demo/render-take.ts <take-dir> [<out.gif>]");
		process.exit(2);
	}
	const r = renderTake({ takeDir, out });
	if (r.verdict !== "live-pass") console.error(`render-take: verdict=${r.verdict} — FAILED diagnostic only`);
	console.log(`gif:      ${r.gif}\nsidecar:  ${r.sidecar}\nverdict:  ${r.verdict}`);
	console.log(`bytes:    ${r.bytes}\nsha256:   ${r.sha256}\ntrimmed:  ${r.trimmed} tail event(s) (recorder teardown)`);
}
