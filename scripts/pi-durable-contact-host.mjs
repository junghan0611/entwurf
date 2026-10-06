// G-contact host half (#129 L-identity). Runs AS the durable host, under the pinned overlay
// checkout's source resolver, and is spawned only by scripts/check-pi-durable-contact.ts:
//
//   node --import <checkout>/packages/coding-agent/src/experimental/source-resolver.ts \
//        scripts/pi-durable-contact-host.mjs <bridge entry> new|continue \
//        [<sessions dir> <senders dir> <mailbox dir> <receivers dir>]
//
// The four optional directories are explicit garden roots handed to the contact, all or none;
// without them the contact uses the shared roots its environment selects.
//
// With ENTWURF_PI_DURABLE_CONTACT_FAULT=malformed-report (set only by the gate's control) the report
// line is deliberately not JSON.
//
// It opens the durable app through the production bootstrap composition (`openDurableCitizen`),
// then executes the contact's registered tools DIRECTLY — adapter-direct, harness-bypassed: no
// model turn and no ToolTask, so this proves the adapter's bridge contact, not the harness
// selecting or validating the tool. The report carries the contact's own `receiver()` state, never
// the path the attachment returned. It prints one JSON report line, holds the host and its
// bridge child alive until the orchestrator writes `close` (so /proc can be read from outside),
// closes, prints `{"closed":true}` and exits.
//
// The bridge's environment is observed at the SDK connector boundary only: the contact's existing
// `connect` injection wraps the COMPILED production `connectStdioBridge`, records the spawn spec's
// command/args/cwd, whether each of the four poisoned identity carrier NAMES is present, and the
// four root carrier VALUES — nothing else of the env — and forwards the spec unchanged to that real
// connector. It is the spec the adapter hands the SDK, not the kernel child environment; no
// /proc/<pid>/environ is read anywhere.
import { createInterface } from "node:readline";
import { connectStdioBridge } from "../mcp/entwurf-bridge/dist/pi-extensions/meta-bridge-pi-durable.js";
import { openDurableCitizen } from "../plugins/pi-durable/bootstrap.mjs";

const IDENTITY_CARRIERS = ["PI_SESSION_ID", "PI_AGENT_ID", "ENTWURF_META_SENDER_MARKER", "ENTWURF_BRIDGE_NATIVE_HOST"];
const ROOT_CARRIERS = [
	"ENTWURF_META_SESSIONS_DIR",
	"ENTWURF_META_SENDERS_DIR",
	"ENTWURF_META_MAILBOX_DIR",
	"ENTWURF_META_RECEIVERS_DIR",
];
const bridgeSpecs = [];
const connect = async (spec) => {
	bridgeSpecs.push({
		command: spec.command,
		args: [...spec.args],
		cwd: spec.cwd,
		identityCarrierPresent: Object.fromEntries(IDENTITY_CARRIERS.map((name) => [name, Object.hasOwn(spec.env, name)])),
		rootCarriers: Object.fromEntries(ROOT_CARRIERS.map((name) => [name, spec.env[name] ?? null])),
	});
	return connectStdioBridge(spec);
};

const [bridgeEntry, mode, ...rootArgs] = process.argv.slice(2);
if (bridgeEntry === undefined || (mode !== "new" && mode !== "continue") || ![0, 4].includes(rootArgs.length)) {
	throw new Error(
		"usage: pi-durable-contact-host.mjs <bridge entry> new|continue [<sessions dir> <senders dir> <mailbox dir> <receivers dir>]",
	);
}
const [sessionsDir, sendersDir, mailboxDir, receiversDir] = rootArgs;

const citizen = await openDurableCitizen({
	bridgeEntry,
	continueSession: mode === "continue",
	cwd: process.cwd(),
	contact: rootArgs.length === 0 ? { connect } : { sessionsDir, sendersDir, mailboxDir, receiversDir, connect },
});
let code = 0;
try {
	const run = async (name) => {
		const tool = citizen.contact.extension.tools.find((t) => t.name === name);
		if (tool === undefined) throw new Error(`the contact registers no ${name}`);
		const result = await tool.execute({}, undefined, {});
		return result.content.map((block) => block.text).join("\n");
	};
	const view = citizen.durable.view.current();
	const report = {
		hostPid: process.pid,
		session: view.session,
		attachment: citizen.attachment,
		receiver: citizen.contact.receiver(),
		toolNames: citizen.contact.extension.tools.map((t) => t.name),
		bridgeSpecs,
		self: await run("entwurf_self"),
		peers: await run("entwurf_peers"),
		notices: view.notices.map((n) => `${n.level}: ${n.message}`),
	};
	// The gate's malformed-report control: the report line is deliberately not JSON.
	if (process.env.ENTWURF_PI_DURABLE_CONTACT_FAULT === "malformed-report") {
		process.stdout.write(`{"malformed report line\n`);
	} else {
		process.stdout.write(`${JSON.stringify(report)}\n`);
	}
	const lines = createInterface({ input: process.stdin });
	for await (const line of lines) if (line.trim() === "close") break;
} catch (error) {
	code = 1;
	// The failure report keeps its cause first and carries, beside it, only the host pid and the same
	// connector-boundary record the success report has — so the gate can judge the scrub/root QKs before
	// it throws this error. It is never a success: no attachment, self, peers or session is reported.
	process.stdout.write(
		`${JSON.stringify({ error: error instanceof Error ? error.message : String(error), hostPid: process.pid, bridgeSpecs })}\n`,
	);
} finally {
	await citizen.close();
}
process.stdout.write(`${JSON.stringify({ closed: true })}\n`);
process.exit(code);
