/**
 * runtime-bootstrap — a THIN RE-EXPORT of the shipped owner, and nothing else (#116 M3-b2).
 *
 * The implementation lives in `scripts/herdr-runtime.mjs` because that directory is in
 * `package.json.files` and this one is not. Herdr's `plugin uninstall` deletes the managed checkout
 * this file sits in and calls no cleanup hook, so the code that retires the runtime, reads its
 * journal and undoes an activation has to survive the checkout's deletion. Keeping a second copy
 * here would fork the schema: an install written by one implementation and an uninstall reading it
 * back through another is the exact disagreement this file exists to prevent.
 *
 * So: no logic, no constants, no re-derived paths. Anything added below that is not a re-export is
 * a fork.
 */

export * from "../../../scripts/herdr-runtime.mjs";
