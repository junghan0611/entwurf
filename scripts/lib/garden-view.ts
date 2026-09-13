import path from "node:path";
import type { EntwurfDiagnostic } from "../../pi-extensions/lib/entwurf-fact-provider.ts";
import type { PeerFact } from "../../pi-extensions/lib/entwurf-facts.ts";
import { nativePushSupported } from "../../pi-extensions/lib/entwurf-v2-contract.ts";

/** tmux is placement evidence only; garden ids remain record authority. */
export interface TmuxPaneObservation {
	sessionId: string;
	sessionName: string;
	sessionClients: number;
	windowId: string;
	windowIndex: number;
	windowName: string;
	windowActive: boolean;
	paneId: string;
	paneIndex: number;
	paneActive: boolean;
	paneDead: boolean;
	command: string;
	cwd: string;
}
export interface TmuxPlacementSnapshot {
	source: "tmux";
	authority: "placement-observation-only";
	scope: "whole-current-server-inventory";
	status: "ok" | "unavailable";
	panes: TmuxPaneObservation[];
	error: string | null;
}
export interface GardenCitizenSnapshot {
	source: "entwurf-fact-provider";
	authority: "garden-id-record-and-rail-facts";
	scope: "retained-record-store";
	detailObservationLimit: number;
	peers: PeerFact[];
	diagnostics: EntwurfDiagnostic[];
}
export interface GardenViewSnapshot {
	schemaVersion: 1;
	observedAt: string;
	host: string;
	placement: TmuxPlacementSnapshot;
	garden: GardenCitizenSnapshot;
	join: { state: "not-performed"; reason: string };
	attention: { state: "not-observed"; reason: string };
}

export const TMUX_FIELD_SEPARATOR = "\u001f";
export const NO_JOIN_REASON =
	"tmux coordinates are placement observations, never garden identity; no launch/callback receipt was supplied";
export const NO_ATTENTION_REASON =
	"working/blocked/done requires an explicit backend report; liveness, receiver, transcript, and screen text do not imply it";

type Subject = "pane" | "session-heading" | "record" | "legend";
type Row = { text: string; subject: Subject };
function bool(value: string, field: string): boolean {
	if (value === "1") return true;
	if (value === "0") return false;
	throw new Error(`tmux ${field} must be 0 or 1, got ${JSON.stringify(value)}`);
}
function index(value: string, field: string): number {
	if (!/^\d+$/.test(value)) throw new Error(`tmux ${field} must be an unsigned integer, got ${JSON.stringify(value)}`);
	return Number(value);
}
export function parseTmuxPaneRows(stdout: string): TmuxPaneObservation[] {
	if (!stdout) return [];
	return (stdout.endsWith("\n") ? stdout.slice(0, -1).split("\n") : stdout.split("\n"))
		.filter(Boolean)
		.map((row, n) => {
			const f = row.split(TMUX_FIELD_SEPARATOR);
			if (f.length !== 13) throw new Error(`tmux row ${n + 1} has ${f.length} fields; expected 13`);
			const [sessionId, sessionName, attached, windowId, wi, windowName, wa, paneId, pi, pa, pd, command, cwd] = f;
			if (!/^\$\d+$/.test(sessionId)) throw new Error(`tmux row ${n + 1} has invalid session id ${sessionId}`);
			if (!/^@\d+$/.test(windowId)) throw new Error(`tmux row ${n + 1} has invalid window id ${windowId}`);
			if (!/^%\d+$/.test(paneId)) throw new Error(`tmux row ${n + 1} has invalid pane id ${paneId}`);
			return {
				sessionId,
				sessionName,
				sessionClients: index(attached, "session_attached"),
				windowId,
				windowIndex: index(wi, "window_index"),
				windowName,
				windowActive: bool(wa, "window_active"),
				paneId,
				paneIndex: index(pi, "pane_index"),
				paneActive: bool(pa, "pane_active"),
				paneDead: bool(pd, "pane_dead"),
				command,
				cwd,
			};
		});
}
function clean(value: string): string {
	return [...value].map((c) => (c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f ? "?" : c)).join("");
}
function fitText(value: string, width: number): string {
	const safe = clean(value);
	if (width <= 0) return "";
	if (safe.length <= width) return safe.padEnd(width);
	return width === 1 ? "…" : `${safe.slice(0, width - 1)}…`;
}
function base(value: string): string {
	const name = path.basename(value);
	return name === "." || name === path.sep ? value : name;
}
function nativePushListingAbsent(peer: PeerFact): boolean {
	return peer.liveness === "unsupported" && peer.receiver === "n/a";
}
export function observationHorizon(peers: PeerFact[]): string {
	const ids = peers
		.filter((p) => p.transcript !== "unobserved")
		.map((p) => p.gardenId)
		.sort();
	return ids[0] ?? "none";
}
function backendLabel(backend: PeerFact["backend"], tiny: boolean): string {
	if (!tiny) return backend;
	return ({ pi: "pi", "claude-code": "cc", copilot: "cp", omp: "om", codex: "cx", antigravity: "ag" } as const)[
		backend
	];
}
function compactGardenRow(peer: PeerFact, tiny: boolean): string {
	const glyph = ({ alive: "●", dead: "○", indeterminate: "?", unsupported: "–" } as const)[peer.liveness];
	const recv = ({ "n/a": "-", none: "0", active: "+", inactive: "!", unobserved: "?" } as const)[peer.receiver];
	const tx = ({ exists: "+", absent: "-", unobserved: "?" } as const)[peer.transcript];
	return `pl? ${glyph} ${peer.gardenId} ${backendLabel(peer.backend, tiny)} recv${recv} tx${tx}${nativePushListingAbsent(peer) ? " np-listing?" : ""}`;
}
function fullGardenRow(peer: PeerFact): string {
	const live = peer.liveness === "dead" ? "dormant(dead rail)" : peer.liveness;
	const absence = nativePushListingAbsent(peer) ? " np-listing:absent" : "";
	return `pl:? ${peer.gardenId} ${peer.backend} ${live} recv:${peer.receiver} tr:${peer.transcript}${absence} cwd:${base(peer.cwd)}`;
}
function tmuxRows(snapshot: TmuxPlacementSnapshot, compact: boolean): Row[] {
	if (snapshot.status === "unavailable")
		return [{ text: `unavailable · ${snapshot.error ?? "tmux did not answer"}`, subject: "session-heading" }];
	const groups = new Map<string, TmuxPaneObservation[]>();
	for (const pane of snapshot.panes) groups.get(pane.sessionId)?.push(pane) ?? groups.set(pane.sessionId, [pane]);
	const rows: Row[] = [];
	for (const panes of [...groups.values()].sort((a, b) => a[0].sessionId.localeCompare(b[0].sessionId))) {
		const first = panes[0];
		rows.push({
			subject: "session-heading",
			text: `${first.sessionClients > 0 ? "●" : "○"} ${first.sessionName} ${first.sessionId}`,
		});
		for (const pane of panes) {
			const focus = pane.paneActive && pane.windowActive ? ">" : " ";
			const join = compact ? "gd?" : "gd:?";
			rows.push({
				subject: "pane",
				text: compact
					? `${join} ${pane.windowIndex}.${pane.paneIndex} ${pane.paneId} ${pane.command}`
					: `${join} ${focus} ${pane.windowIndex}.${pane.paneIndex} ${pane.paneId} ${pane.command}${pane.paneDead ? " dead" : ""} cwd:${base(pane.cwd)}`,
			});
		}
	}
	return rows.length
		? compact
			? [{ text: "gd?=no garden join · pl?=placement unknown", subject: "legend" }, ...rows]
			: rows
		: [{ text: "(no panes)", subject: "session-heading" }];
}
function gardenRows(snapshot: GardenCitizenSnapshot, compact: boolean, tiny: boolean): Row[] {
	const rows = [...snapshot.peers]
		.sort((a, b) => {
			const activeA = a.liveness === "alive" || a.receiver === "active" ? 0 : 1;
			const activeB = b.liveness === "alive" || b.receiver === "active" ? 0 : 1;
			return activeA - activeB || (a.recordUpdatedAt < b.recordUpdatedAt ? 1 : -1);
		})
		.map((peer): Row => ({ subject: "record", text: compact ? compactGardenRow(peer, tiny) : fullGardenRow(peer) }));
	return compact
		? [
				{ text: "● alive ○ dead ? indeterminate – unsupported", subject: "legend" },
				{ text: "recv/tx: + active/exists - n/a/absent ? unobserved", subject: "legend" },
				...rows,
			]
		: rows;
}
function omitted(rows: Row[], shown: number, panel: "tmux" | "garden"): string {
	const lost = rows.slice(Math.max(0, shown - 1));
	const count = (subject: Subject) => lost.filter((r) => r.subject === subject).length;
	return panel === "tmux"
		? `… hidden panes:${count("pane")} sessions:${count("session-heading")}`
		: `… hidden records:${count("record")}`;
}
function framed(title: string, rows: Row[], width: number, maxRows: number, panel: "tmux" | "garden"): string[] {
	const inner = Math.max(1, width - 2);
	const shown = rows.slice(0, Math.max(0, maxRows));
	if (rows.length > shown.length && shown.length)
		shown[shown.length - 1] = { text: omitted(rows, shown.length, panel), subject: "session-heading" };
	const label = `─ ${clean(title)} `;
	const rule = label.length <= inner ? `${label}${"─".repeat(inner - label.length)}` : fitText(label, inner);
	return [`┌${rule}┐`, ...shown.map((r) => `│${fitText(` ${r.text}`, inner)}│`), `└${"─".repeat(inner)}┘`];
}
export interface RenderGardenViewOptions {
	columns: number;
	rows: number;
}
export function renderGardenView(snapshot: GardenViewSnapshot, options: RenderGardenViewOptions): string {
	const columns = Math.max(48, options.columns),
		rows = Math.max(12, options.rows),
		compact = columns < 100,
		tiny = columns < 60;
	const horizon = observationHorizon(snapshot.garden.peers),
		unobserved = snapshot.garden.peers.filter((p) => p.transcript === "unobserved").length,
		observed = snapshot.garden.peers.length - unobserved;
	const nativeUnknown = snapshot.garden.peers.filter((peer) => nativePushSupported(peer.backend)).length;
	const warning = compact
		? `LU<${horizon}> unobs:${unobserved} np?:${nativeUnknown}`
		: `LIVE-UNKNOWN before ${horizon} · transcript-unobserved=${unobserved} · native-push listing-liveness unknown=${nativeUnknown}`;
	const titles = compact
		? ["TMUX gd? no join · ● alive · pl? placement?", `GARDEN pl? · recv/tx + - ? · ${warning}`]
		: ["TMUX WHOLE-CURRENT-SERVER INVENTORY · gd:? no garden join", `RETAINED GARDEN RECORD STORE · ${warning}`];
	const footer = [
		compact ? "attention:? explicit backend report only" : `ATTENTION ? · ${snapshot.attention.reason}`,
		compact
			? `rec:${snapshot.garden.peers.length} obs:${observed} unobs:${unobserved} diag:${snapshot.garden.diagnostics.length} readonly q/r`
			: `records=${snapshot.garden.peers.length} observed=${observed} unobserved=${unobserved} diagnostics=${snapshot.garden.diagnostics.length} · read-only q/r`,
	];
	const available = Math.max(1, rows - footer.length - 5),
		half = Math.max(1, Math.floor((available - 4) / 2));
	return [
		fitText(`ENTWURF GARDEN · ${snapshot.host} · ${snapshot.observedAt}`, columns).trimEnd(),
		fitText(warning, columns).trimEnd(),
		...framed(titles[0], tmuxRows(snapshot.placement, compact), columns, half, "tmux"),
		"",
		...framed(titles[1], gardenRows(snapshot.garden, compact, tiny), columns, half, "garden"),
		"",
		...footer.map((x) => fitText(x, columns).trimEnd()),
	].join("\n");
}
