#!/usr/bin/env python3
"""mailbox-watch.py — P4 prototype (issue #98 option E): the out-of-harness
observation window.

WHY THIS EXISTS
    Every rail (pi / codex / agy / Claude Code) drops the SAME artifact into
    ~/.pi/agent/meta-mailbox/<garden-id>/: a `<stamp>.msg` whose body carries a
    human-shaped envelope (from / session / at / wants reply). The doorbell then
    renames it `.msg.delivered`, and `entwurf_inbox_read` archives it
    `.msg.delivered.read`. Those three suffixes are the per-message truth --
    `state.json` only ever holds a garden-wide "last activity" slot, which is why
    it cannot serve as a per-message receipt.

    So a single watcher on that directory renders EVERY sibling's traffic in one
    place, with zero changes to any delivery contract. That is what this prints.

WHY NOT inotifywait
    Issue #98 (v3, option E) specifies
    `inotifywait -r -m meta-mailbox -e create,moved_to,moved_from`.
    MEASURED on thinkpad 2026-09-03: `inotifywait` is NOT on PATH. inotify-tools
    exists only as a transitive nix-store path, which a GC may remove, so
    hard-coding it would be a fragile dependency. Adding it to
    nixos-config/scripts/external-packages.sh is a change outside this repo.
    This file therefore drives inotify(7) directly through ctypes -- Python
    stdlib only, no new dependency -- and measures the same events.

RECURSION
    `inotifywait` without -r would have watched ONLY the parent's own entries
    (the garden-id directories) and never seen a `.msg` inside them. This watcher
    adds a watch per garden-id directory AND keeps one on the parent so that a
    directory created later (a new citizen) is picked up while running.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import datetime
import errno
import os
import struct
import sys
from pathlib import Path

IN_CREATE = 0x00000100
IN_CLOSE_WRITE = 0x00000008
IN_MOVED_FROM = 0x00000040
IN_MOVED_TO = 0x00000080
IN_Q_OVERFLOW = 0x00004000
IN_ISDIR = 0x40000000

# The doorbell's `mv m m.delivered` is a rename WITHIN one directory, so it emits a
# MOVED_FROM/MOVED_TO pair, not a CREATE. Watching create+close_write alone would
# miss every delivery transition -- the reason the issue's event list was widened.
WATCH_MASK = IN_CREATE | IN_CLOSE_WRITE | IN_MOVED_FROM | IN_MOVED_TO

EVENT_HDR = struct.Struct("iIII")  # wd, mask, cookie, len

DEFAULT_ROOT = Path.home() / ".pi" / "agent" / "meta-mailbox"


def _libc() -> ctypes.CDLL:
	name = ctypes.util.find_library("c") or "libc.so.6"
	libc = ctypes.CDLL(name, use_errno=True)
	libc.inotify_init1.argtypes = [ctypes.c_int]
	libc.inotify_init1.restype = ctypes.c_int
	libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
	libc.inotify_add_watch.restype = ctypes.c_int
	return libc


def envelope(path: Path) -> tuple[str, str]:
	"""(sender, first body line) from a mailbox message.

	The envelope is the human-shaped header the mailbox writer emits; the body
	follows a horizontal rule. Unreadable/renamed-away files yield placeholders --
	a watcher must never crash on a file that moved under it.
	"""
	try:
		text = path.read_text(encoding="utf-8", errors="replace")
	except OSError:
		return ("?", "(unreadable)")
	sender, body_started, first = "?", False, ""
	for line in text.splitlines():
		if not body_started:
			stripped = line.strip()
			if stripped.startswith("from:"):
				sender = stripped[len("from:") :].strip()
			elif stripped.startswith("session:"):
				# The garden id is the reply address; prefer it over the backend label.
				sender = stripped[len("session:") :].strip().split()[0] or sender
			elif set(stripped) == {"─"}:
				body_started = True
			continue
		if line.strip():
			first = line.strip()
			break
	return (sender, first or "(empty body)")


def state_of(name: str) -> str | None:
	"""Map a filename to the per-message state its suffix encodes."""
	if name.endswith(".msg.delivered.read"):
		return "READ"
	if name.endswith(".msg.delivered"):
		return "RUNG"
	if name.endswith(".msg"):
		return "ARRIVED"
	return None


def main(argv: list[str]) -> int:
	root = Path(argv[1]).expanduser() if len(argv) > 1 else DEFAULT_ROOT
	if not root.is_dir():
		print(f"mailbox root not found: {root}", file=sys.stderr)
		return 2

	libc = _libc()
	fd = libc.inotify_init1(0)
	if fd < 0:
		print(f"inotify_init1 failed: {os.strerror(ctypes.get_errno())}", file=sys.stderr)
		return 1

	wd_dir: dict[int, Path] = {}
	# Names already reported by a directory sweep, so the sweep and the live event
	# for the same file do not print it twice.
	seen: set[str] = set()

	def report(gid: str, state: str, path: Path) -> None:
		sender, first = envelope(path)
		stamp = datetime.datetime.now().strftime("%H:%M:%S")
		print(f"{stamp}  {gid:24} {state:9} {sender} -> {first[:80]}", flush=True)

	def watch(d: Path, *, sweep: bool = False) -> None:
		wd = libc.inotify_add_watch(fd, str(d).encode(), WATCH_MASK)
		if wd < 0:
			err = ctypes.get_errno()
			# ENOSPC is the watch-limit ceiling; say so plainly instead of dying quiet.
			hint = " (raise fs.inotify.max_user_watches)" if err == errno.ENOSPC else ""
			print(f"  ! cannot watch {d.name}: {os.strerror(err)}{hint}", file=sys.stderr)
			return
		wd_dir[wd] = d
		if not sweep:
			return
		# RACE: a citizen's FIRST message can already be on disk before this watch
		# exists. `enqueueMetaMessage` (meta-session.ts:2484-2489) does
		# mkdirSync(dir) and then writeFileSync(messagePath) with nothing in between
		# -- no tmp+rename -- so the .msg can be fully written between our receiving
		# IN_CREATE for the directory and our adding a watch to it. Its CLOSE_WRITE
		# is then gone forever. MEASURED: without this sweep, a
		# `os.mkdir(d); open(d/'x.msg','w').write(...)` pair produced ZERO output.
		# Sweeping right after the watch is added closes the window: anything the
		# watch missed is still on disk, and anything it caught is deduped below.
		try:
			existing = sorted(p for p in d.iterdir() if state_of(p.name))
		except OSError:
			return
		for p in existing:
			if p.name in seen:
				continue
			seen.add(p.name)
			report(d.name, state_of(p.name) or "?", p)

	watch(root)
	gids = sorted(p for p in root.iterdir() if p.is_dir())
	for d in gids:
		watch(d)
	print(f"# watching {len(gids)} garden mailboxes under {root}", file=sys.stderr)
	print("# TIME     GID                      STATE     SENDER -> first line", file=sys.stderr)

	try:
		while True:
			buf = os.read(fd, 8192)
			off = 0
			while off < len(buf):
				wd, mask, _cookie, ln = EVENT_HDR.unpack_from(buf, off)
				off += EVENT_HDR.size
				raw = buf[off : off + ln].split(b"\0", 1)[0]
				off += ln
				name = raw.decode("utf-8", "replace")
				# The kernel drops events when the queue fills and reports it as a
				# single wd=-1 event with no name. Saying nothing here would be the
				# exact failure this whole issue is about: traffic that happened and
				# was never shown. Announce the loss instead of swallowing it.
				if mask & IN_Q_OVERFLOW:
					print(
						"  ! inotify queue overflow — events were LOST; this window is "
						"incomplete (raise fs.inotify.max_queued_events)",
						file=sys.stderr,
						flush=True,
					)
					continue
				parent = wd_dir.get(wd)
				if parent is None or not name:
					continue
				# A citizen created while we run: watch it AND sweep it, because its
				# first message may already be written (see the race note in watch()).
				if mask & IN_ISDIR and parent == root:
					watch(parent / name, sweep=True)
					continue
				state = state_of(name)
				if state is None:
					continue
				# Print on exactly one event per transition:
				#   CLOSE_WRITE — a new .msg whose body is fully flushed. CREATE fires
				#     first but the file may still be empty, so printing on CREATE both
				#     double-reports (CREATE then CLOSE_WRITE) and can read a half-written
				#     envelope. The issue's `-e create` would have hit exactly that.
				#   MOVED_TO — the arriving half of the doorbell's in-place rename.
				#     MOVED_FROM is the vacating half of the same rename; reporting it too
				#     would print every delivery twice under its OLD name.
				if not mask & (IN_CLOSE_WRITE | IN_MOVED_TO):
					continue
				if name in seen:
					seen.discard(name)  # the sweep already printed it; let it pass next time
					continue
				report(parent.name, state, parent / name)
	except KeyboardInterrupt:
		return 0
	finally:
		os.close(fd)


if __name__ == "__main__":
	sys.exit(main(sys.argv))
