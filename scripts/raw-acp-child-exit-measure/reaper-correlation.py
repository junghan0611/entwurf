#!/usr/bin/env python3
"""Correlate anomalous ACP turns against this host's reaper SIGTERM events — #72.

The population script says WHICH turns died at exit 0. This one says WHY, on a
host that runs `acp-zombie-reaper.service`: it lines every EXIT0 / between-turn
row up against the systemd user journal's reaping events and prints the delta.

    python3 acp-turn-population.py > acp-pop-<host>.json
    python3 reaper-correlation.py acp-pop-<host>.json

An EXIT0 turn whose delta is under a second was killed by that SIGTERM. A
`between` row's delta is the idle gap since the reap that killed the previous
child — the operator never sees those, pi just opens a new one.

Hosts without the reaper unit produce zero reap events; that is the expected
output on thinkpad and is itself the receipt for the host split.
"""
import json, re, sys, datetime, subprocess

pop = sys.argv[1] if len(sys.argv) > 1 else "acp-pop-oracle.json"
rows = json.load(open(pop))

out = subprocess.run(
	["journalctl", "--user", "-b", "0", "--no-pager"],
	capture_output=True, text=True,
).stdout
reaps = []
for line in out.splitlines():
	m = re.search(r"\[acp-reaper (\S+)\] reaping (\d+) stale.*: (.+)$", line)
	if m:
		t = datetime.datetime.fromisoformat(m.group(1)).astimezone(datetime.timezone.utc)
		reaps.append((t, m.group(3).strip()))

print(f"reaper SIGTERM events in this boot: {len(reaps)}")
if not reaps:
	print("no reaper on this host — nothing to correlate")
	sys.exit(0)

print(f"{'turn (UTC)':26} {'kind':13} {'between':8} {'nearest reap':22} {'delta(s)':>9}")
for r in rows:
	if r["kind"] != "EXIT0" and not r["between"]:
		continue
	t = datetime.datetime.fromisoformat(r["ts"].replace("Z", "+00:00"))
	best = min(reaps, key=lambda x: abs((x[0] - t).total_seconds()))
	d = (t - best[0]).total_seconds()
	print(f"{r['ts']:26} {r['kind']:13} {str(r['between']):8} "
	      f"{best[0].strftime('%Y-%m-%dT%H:%M:%SZ'):22} {d:>9.1f}  pid={best[1]}")
