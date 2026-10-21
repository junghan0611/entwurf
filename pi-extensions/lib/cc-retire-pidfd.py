"""cc-retire-pidfd — terminate ONE expected Linux process through a pidfd, or say why not (#147 G3).

A numeric PID names whichever process holds that number NOW. Checking a PID and then signalling
it leaves a window in which the process can exit and the number be reused, so the signal lands on
a stranger. A pidfd names the process it was opened on, for as long as the fd is open: a signal
sent through it can never reach a later holder of the number. This helper closes exactly that
check -> signal race, and nothing else.

    python3 -I -S cc-retire-pidfd.py <expected-pid> <expected-start-key>

Order, and why each step is where it is:

  1. Validate the inputs: a decimal pid > 1 and a `linux:<starttime>` start key (the scheme
     `processStartKey` in meta-session.ts mints from /proc/<pid>/stat field 22).
  2. pidfd_open(pid). From here the fd pins the process the number named at this instant.
  3. Re-read /proc/<pid>/stat and compare the start key. /proc is a NUMERIC path, so this read
     could already describe a reused number...
  4. ...which is why the fd is then asked whether ITS process has exited. Not exited + key match
     ties the fd and the stat to the same live process.
  5. Print `{"phase": "ready"}` and wait, bounded, for ONE complete control frame on stdin — at
     most CONTROL_MAX bytes of ASCII ending in a newline. Only the exact frame `go\n` proceeds;
     `cancel\n`, EOF (with or without partial bytes), an oversized or non-ASCII frame, any other
     line, a read failure, or the deadline (which partial input never extends) sends nothing. The caller re-checks its own
     record/marker binding while the fd is held; this helper reads no record, marker, role or
     permission and makes no decision of its own about WHETHER to terminate.
  6. On `go`: ask the fd again (exited -> no signal), then pidfd_send_signal(fd, SIGTERM, None, 0)
     ONCE, then poll the same fd for its exit within a fixed bound.

What it does NOT do, ever: signal a numeric pid, a process group, any signal but SIGTERM, a second
signal, an escalation, a retry, or a fallback to os.kill / kill(1) / Node's process.kill. A process
that ignores SIGTERM is left running and reported as `exit-unobserved`.

What the result does NOT mean:
  - `signal-requested` means the kernel accepted the signal for that process, nothing more.
  - `exited` means THAT process exited (its pidfd became readable). It is not its exit code, not
    proof it flushed anything, and not proof its children are gone.
  - A pidfd pins a PROCESS, not a conversation: a process that switched its native session after
    the caller's last check is still the process this terminates.
  - The start key is the same tick-resolution, same-boot value meta-session.ts compares; it is not
    a cryptographic identity. The helper, the caller and the target must share one host, one PID
    namespace and one procfs.

Output: JSON lines on stdout. Every normal protocol end prints `{"outcome": ..., ...}` as its last
line; a crash or a broken pipe can end without one, and a caller must read a missing outcome as
unknown — after `signal-requested` it means the signal may have been sent. Exit codes:
  0  exited          — SIGTERM was requested through the fd and that process's exit was observed
  2  refused         — nothing was opened or nothing was signalled: bad input, capability absent,
                       pid not found, permission, /proc unreadable, start-key mismatch, open error
  3  not-signalled   — the fd was held and NO signal was sent: cancelled, EOF, truncated / oversized
                       / bad control, control read failure, go deadline, or the process had already
                       exited
  4  unknown-after-signal — SIGTERM was requested but the exit was not observed in the bound, or
                       observing it failed; nothing is retried
"""

import errno
import json
import os
import re
import select
import signal
import sys
import time

# Fixed on purpose — no flag or environment knob, so an outcome means the same thing everywhere.
GO_DEADLINE_S = 10.0
EXIT_WAIT_S = 5.0

# Linux PID_MAX_LIMIT (2^22): no pid_t a Linux kernel hands out is larger, so anything above it is
# malformed input, refused before any syscall.
PID_MAX = 4194304
# PID_MAX has 7 digits; fullmatch on this bound runs BEFORE int(), so no input reaches int()'s
# string-length limit and every over-long decimal is the named malformed-pid refusal.
PID_RE = re.compile(r"[0-9]{1,7}")
KEY_RE = re.compile(r"linux:[0-9]{1,20}")
CONTROL_MAX = 16


def emit(obj):
    sys.stdout.write(json.dumps(obj, sort_keys=True) + "\n")
    sys.stdout.flush()


def finish(code, outcome, **facts):
    emit(dict(outcome=outcome, **facts))
    sys.exit(code)


def start_key(pid):
    """`linux:<starttime>` from /proc/<pid>/stat, split after the LAST ')' (comm may hold parens)."""
    with open("/proc/%d/stat" % pid, "r", encoding="ascii", errors="strict") as fh:
        stat = fh.read()
    fields = stat[stat.rindex(")") + 1:].split()
    starttime = fields[19]
    if not starttime.isdigit():
        raise ValueError("starttime field is not numeric")
    return "linux:" + starttime


def exited(fd):
    """True when the pidfd's process has exited (readable); raises when the fd cannot be observed."""
    poller = select.poll()
    poller.register(fd, select.POLLIN)
    events = poller.poll(0)
    for _, mask in events:
        if mask & (select.POLLNVAL | select.POLLERR):
            raise OSError(errno.EBADF, "pidfd not observable")
        if mask & select.POLLIN:
            return True
    return False


def read_control(deadline):
    """ONE complete control frame from stdin before `deadline` (monotonic; partial input does not
    extend it). Returns (kind, line): ("line", text) for a complete ASCII frame, or one of
    ("eof",), ("truncated",), ("oversize",), ("bad-encoding",), ("deadline",), ("read-failed",)."""
    buf = b""
    stdin = sys.stdin.fileno()
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return ("deadline", None)
        try:
            ready, _, _ = select.select([stdin], [], [], remaining)
            if not ready:
                continue
            chunk = os.read(stdin, CONTROL_MAX + 1)
        except OSError:
            return ("read-failed", None)
        if not chunk:
            return ("eof", None) if not buf else ("truncated", None)
        buf += chunk
        if b"\n" in buf:
            frame = buf.split(b"\n", 1)[0]
            if len(frame) > CONTROL_MAX:
                return ("oversize", None)
            try:
                return ("line", frame.decode("ascii"))
            except UnicodeDecodeError:
                return ("bad-encoding", None)
        if len(buf) > CONTROL_MAX:
            return ("oversize", None)


def main(argv):
    if len(argv) != 3:
        finish(2, "refused", reason="usage")
    raw_pid, key = argv[1], argv[2]
    if not PID_RE.fullmatch(raw_pid) or not 1 < int(raw_pid) <= PID_MAX:
        finish(2, "refused", reason="malformed-pid")
    if not KEY_RE.fullmatch(key):
        finish(2, "refused", reason="malformed-start-key")
    pid = int(raw_pid)
    if not sys.platform.startswith("linux") or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        finish(2, "refused", reason="capability-unsupported")

    try:
        fd = os.pidfd_open(pid, 0)
    except OSError as err:
        if err.errno == errno.ESRCH:
            finish(2, "refused", reason="pid-not-found")
        if err.errno == errno.EPERM:
            finish(2, "refused", reason="permission-denied")
        if err.errno in (errno.ENOSYS, errno.EINVAL):
            finish(2, "refused", reason="capability-unsupported", errno=errno.errorcode.get(err.errno, err.errno))
        finish(2, "refused", reason="open-failed", errno=errno.errorcode.get(err.errno, err.errno))

    try:
        try:
            observed = start_key(pid)
        except (OSError, ValueError, IndexError, UnicodeError):
            finish(2, "refused", reason="proc-unreadable")
        if observed != key:
            finish(2, "refused", reason="start-key-mismatch")
        try:
            if exited(fd):
                finish(3, "already-exited")
        except OSError:
            finish(2, "refused", reason="observe-failed")

        emit({"phase": "ready", "pid": pid})
        kind, line = read_control(time.monotonic() + GO_DEADLINE_S)
        if kind == "deadline":
            finish(3, "go-deadline")
        if kind == "eof":
            finish(3, "cancelled-eof")
        if kind == "truncated":
            finish(3, "truncated-control")
        if kind == "oversize":
            finish(3, "oversize-control")
        if kind == "read-failed":
            finish(3, "control-read-failed")
        if kind != "line":
            finish(3, "bad-control")
        if line == "cancel":
            finish(3, "cancelled")
        if line != "go":
            finish(3, "bad-control")

        try:
            if exited(fd):
                finish(3, "already-exited")
        except OSError:
            finish(3, "observe-failed-before-signal")
        try:
            signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
        except OSError as err:
            if err.errno == errno.ESRCH:
                finish(3, "already-exited")
            if err.errno == errno.EPERM:
                finish(2, "refused", reason="permission-denied")
            finish(2, "refused", reason="signal-failed", errno=errno.errorcode.get(err.errno, err.errno))
        emit({"phase": "signal-requested", "signal": "SIGTERM"})

        poller = select.poll()
        poller.register(fd, select.POLLIN)
        deadline = time.monotonic() + EXIT_WAIT_S
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                finish(4, "exit-unobserved", waitedS=EXIT_WAIT_S)
            try:
                events = poller.poll(int(remaining * 1000) + 1)
            except OSError:
                finish(4, "observe-failed")
            for _, mask in events:
                if mask & (select.POLLNVAL | select.POLLERR):
                    finish(4, "observe-failed")
                if mask & select.POLLIN:
                    finish(0, "exited")
    finally:
        os.close(fd)


if __name__ == "__main__":
    main(sys.argv)
