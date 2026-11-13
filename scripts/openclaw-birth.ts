#!/usr/bin/env node
/**
 * openclaw-birth — `entwurf openclaw-birth --scope <s> --session-key <k> --cwd <abs>` (#160 S2 card §1).
 *
 * The ONE writer of `openclaw` records. Run by the operator for an existing declared session, or by
 * the fresh composition for a key it just created (its `cwd` is that `sessions.create` reply's
 * `entry.sessionRoot`; no read RPC returns it — [측정] S3 `R/s3-sessionroot-read.txt`). Order and
 * refusals are in pi-extensions/lib/openclaw-birth.ts: declaration scope → the receive adapter's
 * own `sessions.describe` probe must answer alive → idempotent upsert by native id.
 *
 * Prints one JSON line `{action, gardenId, nativeSessionId, cwd}` and exits 0. Any refusal or store
 * defect throws (exit 1, stderr). Wrong argv is exit 2 with usage.
 */

import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";
import { resolveNativePushAdapter } from "../pi-extensions/lib/native-push/adapter.ts";
import { birthOpenclawCitizen } from "../pi-extensions/lib/openclaw-birth.ts";
import { openclawCitizensPath, readOpenclawCitizens } from "../pi-extensions/lib/openclaw-citizens.ts";
import { OPENCLAW_BACKEND } from "../pi-extensions/lib/openclaw-send.ts";

const USAGE = "usage: entwurf openclaw-birth --scope <scope> --session-key <agent:<id>:<key>> --cwd <absolute dir>";
const args = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) flags.set(args[i], args[i + 1]);
const wanted = ["--scope", "--session-key", "--cwd"];
if (args.length !== 6 || flags.size !== 3 || !wanted.every((f) => typeof flags.get(f) === "string")) {
	console.error(USAGE);
	process.exit(2);
}

const result = await birthOpenclawCitizen(
	{
		scope: flags.get("--scope") as string,
		sessionKey: flags.get("--session-key") as string,
		cwd: flags.get("--cwd") as string,
	},
	{
		readDeclaration: () => readOpenclawCitizens(openclawCitizensPath()),
		probe: (nativeSessionId) => resolveNativePushAdapter(OPENCLAW_BACKEND).probe(nativeSessionId),
		upsert: (nativeSessionId, cwd) => {
			const r = upsertMetaSession({ input: { backend: OPENCLAW_BACKEND, nativeSessionId, cwd } });
			return { action: r.action, gardenId: r.record.gardenId };
		},
	},
);
process.stdout.write(`${JSON.stringify(result)}\n`);
