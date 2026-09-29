/**
 * qualification-gh — the thin GitHub API boundary of the composite release oracle
 * (#124 stage 3b). Every GitHub read goes through an injected `GhApi` (json + raw
 * bytes), so the whole contract is testable offline with fixtures; the only networked
 * implementation is `ghCli`, a two-line `gh api` wrapper that no floor test calls.
 *
 * What it proves about ONE run, and how it refuses:
 *   - the run is the NEWEST `.github/workflows/ci.yml` run at the SHA (by id) from this
 *     repository (not a fork), via push or workflow_dispatch, completed — an older,
 *     friendlier run is never selected, and another workflow's runs are not candidates;
 *   - the run's CURRENT attempt is the one read: its jobs, and only an artifact named
 *     for that attempt. An older attempt's artifact is refused by name, not fallen back to;
 *   - the `check` job and its dispatch-only collect + upload steps succeeded — which
 *     means only that the collection finished and was uploaded, never that anything
 *     qualified;
 *   - for the final SHA, the four required jobs succeeded too;
 *   - the artifact's raw zip bytes (never a `gh run download` tree) pass admitArtifact.
 *
 * Unobserved, stated rather than assumed: this repository has never uploaded an
 * artifact (coordinator's read-only receipt 2026-09-29: total_count 0), so the real
 * GitHub zip layout is unmeasured. A layout the reader does not accept fails closed.
 */

import { spawnSync } from "node:child_process";
import { type ApiArtifact, admitArtifact, artifactName } from "./qualification-artifact.ts";
import type { Collection } from "./qualification-collection.ts";

export interface GhApi {
	json(path: string): unknown;
	bytes(path: string): Buffer;
}

export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
export const REQUIRED_JOBS = ["check", "install-surface", "artifact-consumer", "macos-install-surface"];
/**
 * The collection runs INSIDE the existing Linux `check` job (after its pinned herdr
 * install and the FULL floor), as dispatch-only steps — never a separate job, so the
 * environment matches the serial body's and the herdr supply contract is untouched.
 */
export const COMPOSITE_JOB = "check";
export const COMPOSITE_STEP = "collect qualification receipts (not a verdict)";
export const COMPOSITE_UPLOAD_STEP = "upload qualification collection";

interface ApiRun {
	id: number;
	run_attempt: number;
	head_sha: string;
	event: string;
	status: string;
	conclusion: string | null;
	path: string;
	head_repository: { full_name: string } | null;
}

interface ApiJob {
	name: string;
	conclusion: string | null;
	steps?: { name: string; conclusion: string | null }[];
}

export interface RunEvidence {
	errors: string[];
	runId: string | null;
	runAttempt: string | null;
	files: Record<string, Buffer> | null;
	collection: Collection | null;
	witness: string | null;
}

const fail = (errors: string[], run?: ApiRun): RunEvidence => ({
	errors,
	runId: run ? String(run.id) : null,
	runAttempt: run ? String(run.run_attempt) : null,
	files: null,
	collection: null,
	witness: null,
});

function ciRunsAt(api: GhApi, repo: string, sha: string): ApiRun[] {
	const body = api.json(`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`) as { workflow_runs?: ApiRun[] };
	return (body.workflow_runs ?? []).filter((r) => r.path === CI_WORKFLOW_PATH && r.head_sha === sha);
}

function jobsOf(api: GhApi, repo: string, run: ApiRun): ApiJob[] {
	const body = api.json(`repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`) as {
		jobs?: ApiJob[];
	};
	return body.jobs ?? [];
}

function compositeSucceeded(jobs: ApiJob[]): string[] {
	const job = jobs.find((j) => j.name === COMPOSITE_JOB);
	if (!job) return [`composite-job: no ${COMPOSITE_JOB} job in this attempt`];
	const errors: string[] = [];
	if (job.conclusion !== "success") errors.push(`composite-job: ${COMPOSITE_JOB} concluded ${String(job.conclusion)}`);
	for (const name of [COMPOSITE_STEP, COMPOSITE_UPLOAD_STEP]) {
		const step = (job.steps ?? []).find((s) => s.name === name);
		if (!step) errors.push(`composite-step: no step named "${name}" in ${COMPOSITE_JOB}`);
		else if (step.conclusion !== "success")
			errors.push(`composite-step: "${name}" concluded ${String(step.conclusion)}`);
	}
	return errors;
}

function checkRunIdentity(run: ApiRun, repo: string, sha: string, final: boolean): string[] {
	const errors: string[] = [];
	if (run.head_repository?.full_name !== repo) {
		errors.push(`run-repository: head repository ${String(run.head_repository?.full_name)} is not ${repo}`);
	}
	if (run.event !== "push" && run.event !== "workflow_dispatch") errors.push(`run-event: ${run.event}`);
	if (run.head_sha !== sha) errors.push(`run-head: ${run.head_sha}`);
	if (run.status !== "completed") errors.push(`run-status: ${run.status}`);
	if (final && run.conclusion !== "success") errors.push(`run-conclusion: ${String(run.conclusion)}`);
	return errors;
}

/** Artifact of the run's CURRENT attempt, raw zip bytes, admitted. */
function admitRunArtifact(
	api: GhApi,
	repo: string,
	run: ApiRun,
	independentCoreFiles: Record<string, string> | undefined,
): RunEvidence {
	const listed = api.json(`repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`) as {
		artifacts?: ApiArtifact[];
	};
	const artifacts = listed.artifacts ?? [];
	const want = artifactName(String(run.id), String(run.run_attempt));
	const hits = artifacts.filter((a) => a.name === want);
	if (hits.length !== 1) {
		const older = artifacts.filter((a) => a.name.startsWith(`qualification-collection-${run.id}-`) && a.name !== want);
		return fail(
			[
				older.length > 0 && hits.length === 0
					? `artifact-attempt: attempt ${run.run_attempt} has no artifact; ${older.map((a) => a.name).join(", ")} belongs to an older attempt and is refused`
					: `artifact-select: ${hits.length} artifacts named ${want}, need exactly 1`,
			],
			run,
		);
	}
	const zip = api.bytes(`repos/${repo}/actions/artifacts/${hits[0].id}/zip`);
	const admitted = admitArtifact({
		runId: String(run.id),
		runAttempt: String(run.run_attempt),
		headSha: run.head_sha,
		artifact: hits[0],
		zip,
		independentCoreFiles,
	});
	return {
		errors: admitted.errors,
		runId: String(run.id),
		runAttempt: String(run.run_attempt),
		files: admitted.files,
		collection: admitted.collection,
		witness: admitted.witness,
	};
}

/** The final SHA: newest ci.yml run, four required jobs, composite collection, artifact. */
export function finalRunEvidence(
	api: GhApi,
	repo: string,
	sha: string,
	independentCoreFiles: Record<string, string>,
): RunEvidence {
	const runs = ciRunsAt(api, repo, sha);
	if (runs.length === 0) return fail([`run-missing: no ${CI_WORKFLOW_PATH} run at ${sha}`]);
	const run = runs.reduce((a, b) => (b.id > a.id ? b : a));
	const identity = checkRunIdentity(run, repo, sha, true);
	if (identity.length > 0) return fail(identity, run);
	const jobs = jobsOf(api, repo, run);
	const errors: string[] = [];
	for (const name of REQUIRED_JOBS) {
		const j = jobs.find((x) => x.name === name);
		if (j?.conclusion !== "success")
			errors.push(`required-job: ${name} concluded ${String(j?.conclusion ?? "absent")}`);
	}
	errors.push(...compositeSucceeded(jobs));
	if (errors.length > 0) return fail(errors, run);
	return admitRunArtifact(api, repo, run, independentCoreFiles);
}

/**
 * An ancestor SHA: the operator names a run id; it must be a ci.yml run of this repo at
 * that SHA whose current attempt collected successfully, AND no newer ci.yml run at the
 * same SHA may also carry a successful collection (the newest evidence wins).
 */
export function ancestorRunEvidence(api: GhApi, repo: string, sha: string, runId: string): RunEvidence {
	const runs = ciRunsAt(api, repo, sha);
	const run = runs.find((r) => String(r.id) === runId);
	if (!run) return fail([`run-missing: ${runId} is not a ${CI_WORKFLOW_PATH} run at ${sha}`]);
	const identity = checkRunIdentity(run, repo, sha, false);
	if (identity.length > 0) return fail(identity, run);
	const own = compositeSucceeded(jobsOf(api, repo, run));
	if (own.length > 0) return fail(own, run);
	// Every newer ci.yml run at this SHA is classified on two separate axes: did it ATTEMPT
	// a collection (its collect step ran, i.e. was not skipped/absent, or it uploaded a
	// collection artifact), and did that attempt SUCCEED. A newer failed attempt rejects
	// this older one — a new collection's failure is never papered over by an old green.
	// A newer run that never attempted (push/schedule: step skipped or absent, no artifact)
	// is not a collection and does not displace this one.
	for (const r of runs.filter((x) => x.id > run.id).sort((x, y) => y.id - x.id)) {
		const jobs = jobsOf(api, repo, r);
		const step = jobs.find((j) => j.name === COMPOSITE_JOB)?.steps?.find((st) => st.name === COMPOSITE_STEP);
		const listed = api.json(`repos/${repo}/actions/runs/${r.id}/artifacts?per_page=100`) as {
			artifacts?: ApiArtifact[];
		};
		const uploaded = (listed.artifacts ?? []).some((a) => a.name.startsWith(`qualification-collection-${r.id}-`));
		const attempted = (step !== undefined && step.conclusion !== "skipped") || uploaded;
		if (!attempted) continue;
		if (compositeSucceeded(jobs).length > 0 || r.conclusion !== "success") {
			return fail(
				[`run-newer-collection-failed: run ${r.id} at the same SHA attempted a collection and did not succeed`],
				run,
			);
		}
		return fail([`run-not-newest: run ${r.id} at the same SHA also collected`], run);
	}
	return admitRunArtifact(api, repo, run, undefined);
}

/** The only networked GhApi. Not called by any floor test. */
export function ghCli(): GhApi {
	const call = (path: string): Buffer => {
		const r = spawnSync("gh", ["api", path], { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 });
		if (r.status !== 0) throw new Error(`gh api ${path} failed: ${r.stderr.toString("utf8").trim()}`);
		return r.stdout;
	};
	return { json: (path) => JSON.parse(call(path).toString("utf8")), bytes: call };
}
