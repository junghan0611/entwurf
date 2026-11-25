// #175 M4 — how a Pi process ends, observed from inside it. NOT a gate; loaded only by pi-quit.mjs through
// NODE_OPTIONS=--require, and only into the Pi process: it removes NODE_OPTIONS from its own environment
// at once, so nothing Pi spawns (the ACP agent, the MCP bridge) inherits it.
//
// Records, as JSON lines in $ENTWURF_RAW_QUIT_TRACE:
//   start          pid and node version
//   process.exit   a call to process.exit: its code, the caller's stack and the active resources then
//   beforeExit     the event loop drained (Node emits this only when nothing keeps it alive)
//   exit           the 'exit' event: its code and the active resources
//   samples        the last 400 samples of process.getActiveResourcesInfo(), every 25 ms, on an unref'd
//                  interval (it never keeps the process alive), written once at 'exit'
// ENTWURF_RAW_QUIT_KEEPALIVE=1 adds one ref'd interval for the process's whole life: the counterfactual in
// which something keeps the loop alive until Pi's own process.exit.
"use strict";
const fs = require("node:fs");

const out = process.env.ENTWURF_RAW_QUIT_TRACE;
delete process.env.NODE_OPTIONS;
delete process.env.ENTWURF_RAW_QUIT_TRACE;
const keepalive = process.env.ENTWURF_RAW_QUIT_KEEPALIVE === "1";
delete process.env.ENTWURF_RAW_QUIT_KEEPALIVE;

if (out) {
	const t0 = Date.now();
	const log = (k, v = {}) => {
		try {
			fs.appendFileSync(out, `${JSON.stringify({ t: Date.now() - t0, k, ...v })}\n`);
		} catch {
			// the trace is evidence, never a reason for the traced process to fail
		}
	};
	const resources = () => {
		const counts = {};
		for (const r of process.getActiveResourcesInfo()) counts[r] = (counts[r] ?? 0) + 1;
		return counts;
	};
	log("start", { pid: process.pid, node: process.version, keepalive });
	const samples = [];
	let last = "";
	const sampler = setInterval(() => {
		const now = JSON.stringify(resources());
		if (now === last) return;
		last = now;
		samples.push({ t: Date.now() - t0, r: JSON.parse(now) });
		if (samples.length > 400) samples.shift();
	}, 25);
	sampler.unref();
	if (keepalive) setInterval(() => {}, 60_000);
	const realExit = process.exit.bind(process);
	process.exit = (code) => {
		log("process.exit", {
			code: code ?? null,
			stack: String(new Error().stack)
				.split("\n")
				.slice(2, 10)
				.map((s) => s.trim()),
			resources: resources(),
		});
		return realExit(code);
	};
	process.on("beforeExit", (code) => log("beforeExit", { code, resources: resources() }));
	process.on("exit", (code) => {
		log("exit", { code, resources: resources() });
		log("samples", { samples });
	});
}
