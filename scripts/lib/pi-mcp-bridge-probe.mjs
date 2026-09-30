// Child probe for scripts/check-pi-mcp-bridge.ts (#125). Runs in its OWN process with a throwaway
// HOME / PI_CODING_AGENT_DIR set by the parent — entwurf-control reads HOME at module load and births
// into PI_CODING_AGENT_DIR, so this must never run inside an operator session.
//
// REAL: Pi's AgentSessionRuntime (createAgentSessionRuntime → newSession, the CLI /new contract), its
// extension loader, the built-in MCP extension registered exactly as the CLI registers it (a
// `builtin: true` entry → the `builtin:mcp` path), Pi's default stdio transport, entwurf-control's
// record birth and registration, and the COMPILED entwurf-bridge child. FAUX: only the model's
// responses (pi-ai `fauxProvider` on the public ModelRuntime seam). No network, no paid call.
//
// It REPORTS, it does not judge: every fact goes out as JSON on the last stdout line and the parent
// decides. The only thing it reads beyond Pi's own answers is /proc (children of THIS process).
//
// Usage: node pi-mcp-bridge-probe.mjs <repoRoot> <cwd>
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	createMcpExtension,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

const [repo, cwd] = process.argv.slice(2);
const agentDir = process.env.PI_CODING_AGENT_DIR;
const out = {
	parentPid: process.pid,
	execPath: process.execPath,
	phases: {},
	declaredPerCall: [],
	toolResults: [],
	errors: [],
};

function proc(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		return { state: rest[0], ppid: Number(rest[1]), starttime: rest[19] };
	} catch {
		return null;
	}
}
// Every direct child of this process, with the facts the kernel holds for it: argv, the two identity
// env keys, and its working directory.
function children() {
	const kids = [];
	for (const d of readdirSync("/proc")) {
		if (!/^\d+$/.test(d)) continue;
		const info = proc(Number(d));
		if (!info || info.ppid !== process.pid) continue;
		const kid = { pid: Number(d), ...info, argv: [], env: {}, cwd: null };
		try {
			kid.argv = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").filter(Boolean);
			for (const kv of readFileSync(`/proc/${d}/environ`, "utf8").split("\0")) {
				const i = kv.indexOf("=");
				const k = kv.slice(0, i);
				if (k === "PI_SESSION_ID" || k === "PI_AGENT_ID") kid.env[k] = kv.slice(i + 1);
			}
			kid.cwd = readlinkSync(`/proc/${d}/cwd`);
		} catch (err) {
			kid.readError = String(err instanceof Error ? err.message : err);
		}
		kids.push(kid);
	}
	return kids;
}

const faux = fauxProvider();
const callSelf = (ctx) => {
	out.declaredPerCall.push(getCurrentTools(ctx.messages).map((t) => t.name));
	return fauxAssistantMessage(
		[fauxToolCall("mcp__entwurf-bridge__entwurf_self", {}, { id: `pmb-self-${out.declaredPerCall.length}` })],
		{
			stopReason: "toolUse",
		},
	);
};
faux.setResponses([
	callSelf,
	fauxAssistantMessage([fauxText("s1 done")]),
	callSelf,
	fauxAssistantMessage([fauxText("s2 done")]),
]);
const modelRuntime = await ModelRuntime.create({
	authPath: join(agentDir, "auth.json"),
	modelsPath: join(agentDir, "models.json"),
});
modelRuntime.registerNativeProvider(faux.provider);

const createRuntime = async ({ cwd: c, agentDir: a, sessionManager, sessionStartEvent }) => {
	const services = await createAgentSessionServices({
		cwd: c,
		agentDir: a,
		modelRuntime,
		extensionFlagValues: new Map([["entwurf-control", true]]),
		resourceLoaderOptions: {
			additionalExtensionPaths: [join(repo, "pi-extensions", "entwurf-control.ts")],
			extensionFactories: [{ name: "mcp", factory: createMcpExtension(), replaceable: true, builtin: true }],
		},
	});
	const created = await createAgentSessionFromServices({
		services,
		sessionManager,
		sessionStartEvent,
		model: faux.getModel(),
	});
	return { ...created, services, diagnostics: services.diagnostics };
};

let runtime;
try {
	runtime = await createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager: SessionManager.create(cwd),
	});

	async function turn(tag) {
		const session = runtime.session;
		const unsubscribe = session.subscribe((ev) => {
			if (ev.type === "tool_execution_end") {
				const text = (ev.result?.content ?? [])
					.filter((c) => c.type === "text")
					.map((c) => c.text)
					.join("\n");
				out.toolResults.push({ tag, toolName: ev.toolName, isError: ev.isError === true, text: text.slice(0, 1200) });
			}
		});
		try {
			await session.bindExtensions({
				mode: "rpc",
				onError: (e) => out.errors.push(`${tag} ${e.event ?? ""}: ${e.error}`),
			});
			await session.prompt(`probe ${tag}`);
		} catch (err) {
			out.errors.push(`${tag} prompt: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			unsubscribe();
		}
		return session.sessionManager.getSessionId();
	}

	const native1 = await turn("s1");
	const s1Children = children();
	out.phases.s1 = { native: native1, children: s1Children };
	out.phases.newSession = await runtime.newSession();
	out.phases.afterNew = {
		parentAlive: proc(process.pid) !== null,
		p1: s1Children.map((k) => ({ pid: k.pid, starttime: k.starttime, now: proc(k.pid) })),
		children: children(),
	};
	const native2 = await turn("s2");
	out.phases.s2 = { native: native2, children: children() };
	out.fauxCalls = faux.state.callCount;
	out.fauxPending = faux.getPendingResponseCount();
} catch (err) {
	out.errors.push(`probe: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
} finally {
	try {
		await runtime?.dispose();
	} catch (err) {
		out.errors.push(`dispose: ${err instanceof Error ? err.message : String(err)}`);
	}
}
console.log(JSON.stringify(out));
process.exit(0);
