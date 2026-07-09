#!/usr/bin/env node
/**
 * entwurf-agy-imprint — Antigravity PreInvocation birth hook.
 *
 * Reads agy's camelCase PreInvocation payload from stdin, idempotently upserts an
 * antigravity meta-session by conversationId, and ALWAYS prints exactly the
 * PreInvocation neutral response so the agy loop keeps running.
 *
 * This hook is intentionally thin: no transcript hydration, no cwd guessing from
 * process.cwd(), no mailbox/receiver marker. The record body is the authority.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { upsertMetaSession } from "../pi-extensions/lib/meta-session.ts";

const NEUTRAL_RESPONSE = '{"injectSteps":[]}';

type Payload = {
	conversationId?: unknown;
	workspacePaths?: unknown;
	transcriptPath?: unknown;
	modelName?: unknown;
};

function logPath(): string {
	const root = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
	return path.join(root, "entwurf", "agy-imprint.log");
}

function logLine(message: string): void {
	try {
		const file = logPath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, { encoding: "utf8", mode: 0o600 });
	} catch {
		// Logging is best-effort; never break agy's PreInvocation loop.
	}
}

function readStdin(): string {
	try {
		return fs.readFileSync(0, "utf8");
	} catch (err) {
		logLine(`read-stdin-failed ${err instanceof Error ? err.message : String(err)}`);
		return "";
	}
}

function firstWorkspace(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	const first = value[0];
	return typeof first === "string" && first.trim() ? first : null;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function imprint(raw: string): void {
	let payload: Payload;
	try {
		const parsed = JSON.parse(raw || "{}");
		payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Payload) : {};
	} catch (err) {
		logLine(`skip invalid-json ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	const conversationId = optionalString(payload.conversationId);
	if (!conversationId) {
		logLine("skip missing-conversationId");
		return;
	}

	const cwd = firstWorkspace(payload.workspacePaths);
	if (!cwd) {
		logLine(`skip missing-workspacePaths conversationId=${conversationId}`);
		return;
	}

	try {
		const result = upsertMetaSession({
			input: {
				backend: "antigravity",
				nativeSessionId: conversationId,
				cwd,
				model: optionalString(payload.modelName),
				transcriptPath: optionalString(payload.transcriptPath),
			},
		});
		logLine(`ok ${result.action} gardenId=${result.record.gardenId} conversationId=${conversationId} cwd=${cwd}`);
	} catch (err) {
		logLine(
			`upsert-failed conversationId=${conversationId} ${err instanceof Error ? err.stack || err.message : String(err)}`,
		);
	}
}

imprint(readStdin());
process.stdout.write(`${NEUTRAL_RESPONSE}\n`);
