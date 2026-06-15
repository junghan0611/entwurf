/**
 * entwurf-v2-resume-marker — the single source of truth for the env var name that a v2
 * spawn-bg resume plants on its resume child to authorize it as an Entwurf-child resident.
 *
 * Why its own leaf module (no imports): the PRODUCER is `entwurf-v2-spawn-production.ts` (a
 * lib module that imports siblings with `.ts` extensions, compiled by `scripts/tsconfig.json`
 * with `allowImportingTsExtensions`), but the CONSUMER is `entwurf-control.ts` (the extension
 * entry, compiled by the ROOT tsconfig WITHOUT that flag, importing siblings as `.js`).
 * Importing the const straight from `entwurf-v2-spawn-production.ts` into `entwurf-control.ts`
 * would drag the whole `.ts`-importing v2 decider/spawn subtree into the root program and
 * trip TS5097 on every `.ts` extension. A zero-import leaf const is root-safe from either side.
 *
 * Meaning: when this env var equals the child's own sessionId, the child is the resume citizen
 * a v2 spawn-bg resume promoted from a dormant `entwurf`-tagged session to a live
 * `--entwurf-control` resident (an AUTHORIZED Entwurf child resident — keeps its `entwurf` tag,
 * stays re-resumable once it dies). A human hand-opening the same session with
 * `--entwurf-control` carries no marker → still a "corrupt resident session name" crash. The
 * marker is sessionId-bound (not a generic boolean) so it authorizes only the exact session it
 * was minted for; it is a wrong-surface crash guard, not a security boundary. See
 * `entwurf-control.ts` `maybeSetResidentName` (consumer) and `entwurf-v2-spawn-production.ts`
 * `makeProductionSpawnBgResumeDeps` (producer).
 */
export const V2_RESUME_RESIDENT_SESSION_ENV = "PI_SHELL_ACP_V2_RESUME_RESIDENT_SESSION_ID";

/**
 * True when this process is the resume child a v2 spawn-bg resume launched for EXACTLY
 * `sessionId` — the marker equals the child's own id. The pure SSOT of the authorization
 * check (`env` is injectable so the guard is gate-provable without touching `process.env`).
 * The binding is to the exact id, not a generic boolean: a present-but-different marker is
 * NOT authorized, so the env var cannot be reused to wave a different session past the guard.
 */
export function isV2ResumeResidentAuthorized(sessionId: string, env: NodeJS.ProcessEnv = process.env): boolean {
	return env[V2_RESUME_RESIDENT_SESSION_ENV] === sessionId;
}
