#!/usr/bin/env python3
"""Population of ACP turns from a host's pi session transcripts — the #72 receipt.

Reads every `~/.pi/agent/sessions/*/*.jsonl` and emits ONE row per assistant turn
that carried an entwurf ACP lifecycle notice. The point is to compare turns that
FAILED with a clean child exit(0) against turns that SUCCEEDED on the same host,
so a candidate cause (context size, tool-call volume, elapsed time, a stderr
warning) can be retired by a counterexample instead of by argument.

The classifier is deliberately narrow:

  EXIT0        stopReason=error, "ACP connection closed", "exit code 0"
               — the #72 shape: the child left cleanly while owing an answer.
  CLOSED-other same close, no exit fact preserved (pre-df7525f evidence loss).
  ERR-other    any other error, INCLUDING the retired 600s `prompt timed out`
               turns. Those are a different, already-removed failure — the
               classifier keeps them separate so they cannot be folded in.
  OK           the turn answered.

`between` marks a turn whose notice says the PREVIOUS child had already ended at
exit 0 between turns. Those deaths are invisible to the operator (pi just opens a
new child), so counting them is what shows that the user-visible failure is a
RACE with an in-flight prompt, not a distinct failure mode.

Run it on each host and diff the two outputs; a cause must survive both.

    python3 acp-turn-population.py > acp-pop-<host>.json
"""
import json, sys, os, glob, datetime

rows = []
for f in glob.glob(os.path.expanduser("~/.pi/agent/sessions/*/*.jsonl")):
	prev_end = None
	spawn = None
	try:
		lines = open(f, encoding="utf-8", errors="replace").readlines()
	except OSError:
		continue
	for line in lines:
		# Cheap prefilter: the vast majority of records are not assistant turns.
		if '"assistant"' not in line:
			continue
		try:
			o = json.loads(line)
		except ValueError:
			continue
		if o.get("type") != "message":
			continue
		m = o.get("message") or {}
		if m.get("role") != "assistant":
			continue
		c = m.get("content") or []
		# The lifecycle notice is what marks a turn as ACP-backed at all.
		notices = [b.get("text", "").strip() for b in c if b.get("textSignature") == "entwurf:lifecycle-notice-v1"]
		if not notices:
			continue
		ts = o.get("timestamp")
		t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
		newchild = any("preparing claude session" in n for n in notices)
		if newchild:
			spawn = t
		texts = [b.get("text") for b in c if isinstance(b.get("text"), str)]
		# "Terminal" is only the vendor's placeholder TITLE for a Bash call whose
		# `input.command` has not finished streaming, so a start is one tool call.
		starts = sum(1 for x in texts if x.startswith("\n[tool:start]"))
		dones = sum(1 for x in texts if x.startswith("\n[tool:done]") or x.startswith("\n[tool:failed]"))
		em = m.get("errorMessage") or ""
		if m.get("stopReason") != "error":
			kind = "OK"
		elif "ACP connection closed" in em and "exit code 0" in em:
			kind = "EXIT0"
		elif "ACP connection closed" in em:
			kind = "CLOSED-other"
		else:
			kind = "ERR-other"
		rows.append(dict(
			f=os.path.basename(f), ts=ts, kind=kind,
			reuse=any("reusing live session" in n for n in notices),
			newchild=newchild,
			between=any("ended between turns" in n for n in notices),
			starts=starts, dones=dones,
			idle=(t - prev_end).total_seconds() if prev_end else None,
			age=(t - spawn).total_seconds() if spawn else None,
			tt=(m.get("usage") or {}).get("totalTokens"),
			model=m.get("model"),
		))
		prev_end = t

json.dump(rows, sys.stdout)
