/**
 * caption-take — credential-free, declared polish of an already-rendered take GIF (#138).
 *
 *   node demo/caption-take.ts <take-dir> [<rendered.gif>]
 *
 * Writes a SEPARATE file (`<rendered>.captioned.gif` + sidecar); the rendered GIF it reads is never touched.
 * Its edits, all recorded in the sidecar, are exactly:
 *   - crop the bottom footer rows of the terminal (the operator's own status lines), whole GIF;
 *   - a caption band above the terminal: a fixed header from the manifest (stage, SHA, date, MEASURED models)
 *     and, per segment, the take's own recorded view label, timed from the manifest's view-switch log.
 * Captions narrate where the recording was pointed; they are not evidence. No terminal pixel is redrawn.
 *
 * Pairing: the input GIF's sidecar must name THIS take — same take, verdict, cast sha256 (also re-hashed from
 * `<take-dir>/take.cast`), token, start and git head — or nothing is written; take A's labels never land on
 * take B's frames. Output: ffmpeg writes a temp file; only a GIF that probeGif decodes is promoted by rename,
 * then the sidecar by a second rename (two renames, not one atomic pair). A failure leaves any existing
 * captioned GIF and sidecar untouched.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type CastEvent, parseCast, probeGif, trimRecorderTeardown } from "./render-take.ts";

/** GIF time of each cast event under agg's idle limit and speed: Σ min(dt, idle) / speed. */
export function gifTimes(events: readonly CastEvent[], idle: number, speed: number): number[] {
	let t = 0;
	return events.map((e) => {
		t += Math.min(e[0], idle) / speed;
		return t;
	});
}

/** GIF time at an absolute instant: the GIF time of the first event at or after it (the end after the last). */
export function gifTimeAt(
	startUnixSec: number,
	events: readonly CastEvent[],
	times: readonly number[],
	atMs: number,
): number {
	let abs = startUnixSec * 1000;
	for (let i = 0; i < events.length; i++) {
		abs += (events[i]?.[0] ?? 0) * 1000;
		if (abs >= atMs) return times[i] ?? 0;
	}
	return times[times.length - 1] ?? 0;
}

export interface Segment {
	from: number;
	to: number;
	text: string;
}

/** Snap a computed time to the GIF's own frame grid: the first frame at or after it, within `slack` seconds
 * earlier (agg quantizes event times to its frame rate). */
export function snapToFrame(t: number, framePts: readonly number[], slack = 0.1): number {
	return framePts.find((p) => p >= t - slack) ?? t;
}

/** One caption per recorded view switch, each lasting until the next (the last until the end). */
export function segments(
	views: ReadonlyArray<{ at: string; why: string }>,
	at: (ms: number) => number,
	end: number,
	framePts: readonly number[] = [],
): Segment[] {
	const starts = views.map((v, i) => {
		const t = Math.max(0, at(Date.parse(v.at)));
		return { t: i === 0 ? 0 : snapToFrame(t, framePts), text: v.why };
	});
	return starts.map((s, i) => ({ from: s.t, to: starts[i + 1]?.t ?? end, text: s.text }));
}

interface TakeManifest {
	take: string;
	verdict: string;
	token?: string;
	startedAt: string;
	recorderStartedAt?: string | null;
	stage: string;
	viewport: string;
	versions?: { gitHead?: string };
	cast?: { sha256?: string } | null;
	views: Array<{ at: string; why: string }>;
	measuredModels?: Record<string, string[]>;
	receipts?: { piModels?: string[]; pdNative?: { models?: string[] } };
}
interface RenderSidecar extends Partial<TakeManifest> {
	render?: { gifSha256?: string; castSha256?: string; aggArgs?: string[] };
}

function sha256(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Why this rendered GIF's sidecar does not belong to this take, or null when it does. */
export function pairingMismatch(manifest: TakeManifest, sidecar: RenderSidecar, castSha: string): string | null {
	if (!sidecar.render) return "the input sidecar has no render section";
	if (manifest.cast?.sha256 !== castSha) return `take.cast sha256 ${castSha} is not the take manifest's`;
	const pairs: Array<[string, unknown, unknown]> = [
		["take", sidecar.take, manifest.take],
		["verdict", sidecar.verdict, manifest.verdict],
		["cast sha256", sidecar.cast?.sha256, manifest.cast?.sha256],
		["render castSha256", sidecar.render.castSha256, manifest.cast?.sha256],
		["token", sidecar.token, manifest.token],
		["startedAt", sidecar.startedAt, manifest.startedAt],
		["git head", sidecar.versions?.gitHead, manifest.versions?.gitHead],
	];
	for (const [what, a, b] of pairs) if (a !== b) return `${what} differs: input ${String(a)} vs take ${String(b)}`;
	if (manifest.verdict !== "live-pass") return `verdict ${manifest.verdict} is not live-pass`;
	return null;
}

function measuredModelsText(m: TakeManifest): string {
	if (m.measuredModels)
		return Object.entries(m.measuredModels)
			.map(([who, models]) => `${who} ${models.join(",")}`)
			.join(" · ");
	return `pi ${m.receipts?.piModels?.join(",")} · pi-durable ${m.receipts?.pdNative?.models?.join(",")}`;
}

export interface CaptionOptions {
	takeDir: string;
	input?: string;
	ffmpeg?: string;
	ffprobe?: string;
	font?: string;
}

export function captionTake(opts: CaptionOptions): {
	gif: string;
	sidecar: string;
	sha256: string;
	bytes: number;
	segments: Segment[];
} {
	const takeDir = path.resolve(opts.takeDir);
	const manifest = JSON.parse(fs.readFileSync(path.join(takeDir, "manifest.json"), "utf8")) as TakeManifest;
	const name = String(manifest.take).replace(/^take-/, "");
	const artifacts = path.join(path.dirname(path.dirname(takeDir)), "artifacts");
	const input = path.resolve(opts.input ?? path.join(artifacts, `entwurf-${name}.gif`));
	if (!input.endsWith(".gif") || input.endsWith(".captioned.gif"))
		throw new Error(`caption-take: the input must be a rendered .gif, not ${input}`);
	const sidecarIn = JSON.parse(fs.readFileSync(input.replace(/\.gif$/, ".manifest.json"), "utf8")) as RenderSidecar;
	if (sha256(fs.readFileSync(input)) !== sidecarIn.render?.gifSha256)
		throw new Error(`caption-take: ${input} is not the GIF its sidecar names`);
	const castText = fs.readFileSync(path.join(takeDir, "take.cast"), "utf8");
	const mismatch = pairingMismatch(manifest, sidecarIn, sha256(castText));
	if (mismatch !== null) throw new Error(`caption-take: the input is not this take's render — ${mismatch}`);

	const ffprobe = opts.ffprobe ?? "ffprobe";
	const args = sidecarIn.render?.aggArgs ?? [];
	const idle = Number(args[args.indexOf("--idle-time-limit") + 1] ?? 2);
	const speed = Number(args[args.indexOf("--speed") + 1] ?? 1);
	const { header, events: raw } = parseCast(castText);
	const { events } = trimRecorderTeardown(raw);
	const times = gifTimes(events, idle, speed);
	// The cast header's start is whole seconds (≤ the true start); the take stamps `recorderStartedAt` (older
	// takes: `startedAt`) in ms when it spawns the recorder (also ≤ the true start). The later is the tighter anchor.
	const anchor = manifest.recorderStartedAt ?? manifest.startedAt;
	const start = Math.max(Number(JSON.parse(header).timestamp), Date.parse(anchor) / 1000);
	const probe = spawnSync(
		ffprobe,
		["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", input],
		{ encoding: "utf8" },
	);
	const info = JSON.parse(probe.stdout) as {
		format: { duration?: string };
		streams: Array<{ width: number; height: number }>;
	};
	const { width, height } = info.streams[0] as { width: number; height: number };
	const framePts = spawnSync(
		ffprobe,
		["-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", input],
		{ encoding: "utf8" },
	)
		.stdout.split("\n")
		.filter((l) => l.trim() !== "")
		.map(Number);
	const duration = Number(info.format.duration);
	const end = Number.isFinite(duration) ? duration : (framePts[framePts.length - 1] ?? 0) + 1;
	const segs = segments(manifest.views, (ms) => gifTimeAt(start, events, times, ms), end, framePts);

	const rows = Number(String(manifest.viewport).split("x")[1]);
	const rowPx = height / rows;
	const footerRows = 4;
	const cropH = Math.max(1, Math.round(height - footerRows * rowPx));
	const band = 56;
	const font =
		opts.font ?? spawnSync("fc-match", ["-f", "%{file}", "DejaVu Sans Mono"], { encoding: "utf8" }).stdout.trim();
	if (!font || !fs.existsSync(font)) throw new Error("caption-take: no DejaVu Sans Mono font file (fc-match)");
	const head = `LIVE take · ${manifest.stage.split(" ")[0]} ${String(manifest.versions?.gitHead).slice(0, 7)} · ${manifest.startedAt.slice(0, 10)} · measured models: ${measuredModelsText(manifest)}`;

	const out = input.replace(/\.gif$/, ".captioned.gif");
	const sidecarOut = out.replace(/\.gif$/, ".manifest.json");
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "caption-take-"));
	const textFile = (i: number, text: string) => {
		const f = path.join(work, `t${i}.txt`);
		fs.writeFileSync(f, text);
		return f;
	};
	const draw = [
		`drawtext=fontfile=${font}:textfile=${textFile(0, head)}:x=12:y=8:fontsize=14:fontcolor=0x9a9a9a`,
		...segs.map(
			(s, i) =>
				`drawtext=fontfile=${font}:textfile=${textFile(i + 1, `▸ ${s.text}`)}:x=12:y=30:fontsize=17:fontcolor=white:enable='gte(t,${s.from.toFixed(2)})*lt(t,${(i === segs.length - 1 ? s.to + 60 : s.to).toFixed(2)})'`,
		),
	];
	const filter =
		`crop=${width}:${cropH}:0:0,pad=${width}:${cropH + band}:0:${band}:color=0x1b1c18,${draw.join(",")},` +
		"split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
	const tag = `${process.pid}-${randomBytes(4).toString("hex")}`;
	const tmp = path.join(path.dirname(out), `.${path.basename(out)}.${tag}.tmp.gif`);
	const tmpSidecar = path.join(path.dirname(out), `.${path.basename(sidecarOut)}.${tag}.tmp`);
	try {
		const run = spawnSync(
			opts.ffmpeg ?? "ffmpeg",
			["-v", "error", "-i", input, "-filter_complex", filter, "-loop", "0", "-y", tmp],
			{ stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 300_000 },
		);
		if (run.error || run.status !== 0)
			throw new Error(
				`caption-take: ffmpeg failed (${run.error?.message ?? `exit ${run.status}`}) ${run.stderr ?? ""}`,
			);
		if (!fs.existsSync(tmp)) throw new Error("caption-take: ffmpeg produced no file");
		const undecodable = probeGif(tmp, ffprobe);
		if (undecodable !== null) throw new Error(`caption-take: output is not a decodable GIF — ${undecodable}`);
		const bytes = fs.readFileSync(tmp);
		const sha = sha256(bytes);
		fs.writeFileSync(
			tmpSidecar,
			`${JSON.stringify(
				{
					...sidecarIn,
					caption: {
						from: path.basename(input),
						fromSha256: sidecarIn.render?.gifSha256,
						gif: path.basename(out),
						gifSha256: sha,
						bytes: bytes.length,
						edits: [
							`crop bottom ${footerRows} terminal rows (operator footer)`,
							`caption band ${band}px above the terminal`,
						],
						header: head,
						segments: segs,
						note: "captions are the take's recorded view labels, timed from its view-switch log; not evidence",
					},
				},
				null,
				"\t",
			)}\n`,
		);
		fs.renameSync(tmp, out);
		fs.renameSync(tmpSidecar, sidecarOut);
		return { gif: out, sidecar: sidecarOut, sha256: sha, bytes: bytes.length, segments: segs };
	} finally {
		fs.rmSync(tmp, { force: true });
		fs.rmSync(tmpSidecar, { force: true });
		fs.rmSync(work, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const r = captionTake({ takeDir: process.argv[2] ?? "", input: process.argv[3] });
	console.log(`gif:      ${r.gif}\nbytes:    ${r.bytes}\nsha256:   ${r.sha256}`);
	for (const s of r.segments) console.log(`  ${s.from.toFixed(1)}–${s.to.toFixed(1)}s  ${s.text}`);
}
