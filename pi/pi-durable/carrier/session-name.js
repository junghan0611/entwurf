/**
 * The durable session name grammar (#157 G3 B-L1), alone in its own file: no imports and no I/O, so the
 * bootstrap can hold a `--session` value to it before an operator module prepares the environment, without
 * loading the session store, the SDK config or a lock library first. sessions.ts selects by this same predicate.
 */
const SESSION_NAME = /^\d{13}-[0-9a-f-]{36}$/u;

/** Whether `name` has the exact shape of a session directory name: `<13-digit ms>-<uuid>`. */
export function isSessionName(name        )          {
	return SESSION_NAME.test(name);
}
