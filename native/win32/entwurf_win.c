// entwurf_win — the Windows-only native surface of the Entwurf preview (#78).
//
// Three capabilities Node cannot reach on Windows, and nothing else:
//   readNoFollow(path)                  synchronous record read that refuses a final-component
//                                       reparse point on the very handle it reads from
//   pipeRpc(name, line, timeoutMs)      one owner-validated request/response line over a pipe
//   pipeProbe(name, timeoutMs)          the same connect + owner validation, no I/O
// plus ioStats() for the timeout proof. Built from this file in CI only; never at install.
//
// I/O ownership: each pipe call owns one ref-counted context on the Windows thread pool. The
// connect worker, the deadline timer and every submitted overlapped I/O hold one reference each;
// the LAST reference reclaims (handle, thread-pool objects, buffers). Completions arrive through
// CreateThreadpoolIo; the deadline timer cancels and settles the Promise once (threadsafe
// function). No JS or libuv thread ever waits on pipe I/O; only the connect worker waits, bounded
// by the call's single deadline.

#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif
#include <node_api.h>
#include <windows.h>
#include <aclapi.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define READ_CAP (16u * 1024u * 1024u)
#define REQUEST_CAP (64u * 1024u)
#define RESPONSE_CAP (1024u * 1024u)
#define LIVE_LIMIT 8
#define DEGRADED_LIMIT 4

static volatile LONG g_live = 0;              // contexts not yet reclaimed
static volatile LONG g_cancelledIncomplete = 0; // cancelled while an I/O was still pending

// ---------------------------------------------------------------- errors

static napi_value make_error(napi_env env, const char* code, DWORD winError, const char* message) {
	napi_value msg, err, codeVal, winVal;
	napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &msg);
	napi_create_error(env, NULL, msg, &err);
	napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &codeVal);
	napi_set_named_property(env, err, "code", codeVal);
	napi_create_uint32(env, winError, &winVal);
	napi_set_named_property(env, err, "winError", winVal);
	return err;
}

static napi_value throw_code(napi_env env, const char* code, DWORD winError, const char* message) {
	napi_throw(env, make_error(env, code, winError, message));
	return NULL;
}

static const char* map_open_error(DWORD e) {
	switch (e) {
		case ERROR_FILE_NOT_FOUND:
		case ERROR_PATH_NOT_FOUND: return "ENOENT";
		case ERROR_ACCESS_DENIED: return "EACCES";
		case ERROR_SHARING_VIOLATION: return "EBUSY";
		default: return NULL;
	}
}

static wchar_t* get_wstring(napi_env env, napi_value v) {
	size_t len = 0;
	if (napi_get_value_string_utf16(env, v, NULL, 0, &len) != napi_ok) return NULL;
	wchar_t* buf = (wchar_t*)calloc(len + 1, sizeof(wchar_t));
	if (!buf) return NULL;
	napi_get_value_string_utf16(env, v, (char16_t*)buf, len + 1, &len);
	return buf;
}

// ---------------------------------------------------------------- readNoFollow

static napi_value ReadNoFollow(napi_env env, napi_callback_info info) {
	size_t argc = 1;
	napi_value argv[1];
	napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
	if (argc < 1) return throw_code(env, "EINVAL", 0, "readNoFollow(path) requires a path");
	wchar_t* path = get_wstring(env, argv[0]);
	if (!path) return throw_code(env, "EINVAL", 0, "readNoFollow: path is not a string");
	// Precondition: an absolute drive path (X:\...). Device, \\?\, \\.\ and UNC forms are refused.
	if (!(((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z')) && path[1] == L':' && path[2] == L'\\')) {
		free(path);
		return throw_code(env, "EINVAL", 0, "readNoFollow: not an absolute drive path");
	}
	HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
												 OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
	free(path);
	if (h == INVALID_HANDLE_VALUE) {
		DWORD e = GetLastError();
		const char* code = map_open_error(e);
		char buf[32];
		if (!code) { snprintf(buf, sizeof buf, "EWIN32_%lu", (unsigned long)e); code = buf; }
		return throw_code(env, code, e, "readNoFollow: open failed");
	}
	// Classification on the opened handle, kind before any disk metadata.
	DWORD type = GetFileType(h);
	if (type != FILE_TYPE_DISK) {
		DWORD e = (type == FILE_TYPE_UNKNOWN) ? GetLastError() : 0;
		CloseHandle(h);
		if (type == FILE_TYPE_UNKNOWN && e != NO_ERROR) {
			char buf[32];
			snprintf(buf, sizeof buf, "EWIN32_%lu", (unsigned long)e);
			return throw_code(env, buf, e, "readNoFollow: GetFileType failed");
		}
		return throw_code(env, "ENTWURF_ENOTREG", 0, "readNoFollow: not a disk file");
	}
	FILE_ATTRIBUTE_TAG_INFO tag;
	if (!GetFileInformationByHandleEx(h, FileAttributeTagInfo, &tag, sizeof tag)) {
		DWORD e = GetLastError();
		CloseHandle(h);
		char buf[32];
		snprintf(buf, sizeof buf, "EWIN32_%lu", (unsigned long)e);
		return throw_code(env, buf, e, "readNoFollow: attribute query failed");
	}
	if (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) {
		CloseHandle(h);
		return throw_code(env, "ELOOP", 0, "readNoFollow: reparse point at the final component");
	}
	if (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
		CloseHandle(h);
		return throw_code(env, "ENTWURF_ENOTREG", 0, "readNoFollow: a directory");
	}
	size_t cap = 4096, len = 0;
	char* data = (char*)malloc(cap);
	if (!data) { CloseHandle(h); return throw_code(env, "ENOMEM", 0, "readNoFollow: out of memory"); }
	for (;;) {
		if (len == cap) {
			if (cap > READ_CAP) break;  // read one byte past the cap: that is how EFBIG is known
			size_t next = cap * 2 > (size_t)READ_CAP + 1 ? (size_t)READ_CAP + 1 : cap * 2;
			char* grown = (char*)realloc(data, next);
			if (!grown) { free(data); CloseHandle(h); return throw_code(env, "ENOMEM", 0, "readNoFollow: out of memory"); }
			data = grown; cap = next;
		}
		DWORD got = 0;
		if (!ReadFile(h, data + len, (DWORD)(cap - len), &got, NULL)) {
			DWORD e = GetLastError();
			free(data); CloseHandle(h);
			char buf[32];
			snprintf(buf, sizeof buf, "EWIN32_%lu", (unsigned long)e);
			return throw_code(env, buf, e, "readNoFollow: read failed");
		}
		if (got == 0) break;
		len += got;
	}
	CloseHandle(h);
	if (len > READ_CAP) { free(data); return throw_code(env, "EFBIG", 0, "readNoFollow: record larger than 16 MiB"); }
	napi_value out;
	napi_create_buffer_copy(env, len, data, NULL, &out);
	free(data);
	return out;
}

// ---------------------------------------------------------------- owner policy

// Expected pipe owner = this token's default owner, which must be the user SID, or BUILTIN\
// Administrators only when the token is elevated. Returns a LocalAlloc'd copy, or NULL with *code.
static PSID expected_owner(const char** code) {
	HANDLE tok = NULL;
	PSID result = NULL;
	BYTE ownerBuf[256], userBuf[256];
	DWORD n = 0;
	TOKEN_ELEVATION elev = {0};
	*code = "ENTWURF_TOKEN_OWNER_UNSUPPORTED";
	if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) return NULL;
	if (GetTokenInformation(tok, TokenOwner, ownerBuf, sizeof ownerBuf, &n) &&
			GetTokenInformation(tok, TokenUser, userBuf, sizeof userBuf, &n) &&
			GetTokenInformation(tok, TokenElevation, &elev, sizeof elev, &n)) {
		PSID owner = ((TOKEN_OWNER*)ownerBuf)->Owner;
		PSID user = ((TOKEN_USER*)userBuf)->User.Sid;
		BOOL ok = EqualSid(owner, user) || (elev.TokenIsElevated && IsWellKnownSid(owner, WinBuiltinAdministratorsSid));
		if (ok) {
			DWORD len = GetLengthSid(owner);
			result = LocalAlloc(LPTR, len);
			if (result && CopySid(len, result, owner)) *code = NULL;
			else if (result) { LocalFree(result); result = NULL; }
		}
	}
	CloseHandle(tok);
	return result;
}

// ---------------------------------------------------------------- pipe call context

typedef enum { PH_CONNECT, PH_WRITE, PH_READ } Phase;

typedef struct {
	napi_deferred deferred;
	int ok;
	char code[48];
	DWORD winError;
	DWORD serverPid;
	char* line;       // response line (rpc), heap, freed by call_js
	size_t lineLen;
	int probe;
} SettleMsg;

typedef struct {
	volatile LONG refs;
	volatile LONG settled;
	volatile LONG timerRefHeld;
	volatile LONG ioPending;  // 0 = no I/O, 1 = pending, 2 = pending and counted as cancelled
	int probe;
	Phase phase;
	wchar_t* name;
	HANDLE pipe;
	PTP_IO io;
	PTP_TIMER timer;
	OVERLAPPED ov;
	char* req; DWORD reqLen, reqDone;
	char* resp; DWORD respLen;
	ULONGLONG deadline;
	DWORD serverPid;
	napi_threadsafe_function tsfn;
	napi_deferred deferred;
} Ctx;

static void ctx_release(Ctx* c);

static void ctx_reclaim(Ctx* c) {
	if (c->timer) { SetThreadpoolTimer(c->timer, NULL, 0, 0); CloseThreadpoolTimer(c->timer); }
	if (c->pipe && c->pipe != INVALID_HANDLE_VALUE) CloseHandle(c->pipe);
	if (c->io) CloseThreadpoolIo(c->io);
	free(c->name); free(c->req); free(c->resp);
	free(c);
	InterlockedDecrement(&g_live);
}

static void ctx_release(Ctx* c) {
	if (InterlockedDecrement(&c->refs) == 0) ctx_reclaim(c);
}

static void settle(Ctx* c, int ok, const char* code, DWORD winError) {
	if (InterlockedCompareExchange(&c->settled, 1, 0) != 0) return;
	SettleMsg* m = (SettleMsg*)calloc(1, sizeof(SettleMsg));
	if (m) {
		m->deferred = c->deferred;
		m->ok = ok;
		m->probe = c->probe;
		m->winError = winError;
		m->serverPid = c->serverPid;
		if (code) strncpy(m->code, code, sizeof m->code - 1);
		if (ok && !c->probe && c->resp) {
			m->line = (char*)malloc(c->respLen + 1);
			if (m->line) { memcpy(m->line, c->resp, c->respLen); m->line[c->respLen] = 0; m->lineLen = c->respLen; }
		}
	}
	// Node v24.18.1 node_api.cc ThreadSafeFunction::Push: on a closing TSFN (environment
	// teardown) the call itself drops this thread's count and may delete the TSFN, returning
	// napi_closing; the docs forbid any further use. Only napi_ok enqueues the message. So:
	// a message that was not enqueued is ours to free, and Release runs only while our count is
	// still held. The TSFN's own cleanup hook drains queued messages into call_js with env NULL
	// (native free, no JS). Native resources are still reclaimed by the last context reference.
	napi_status st = m ? napi_call_threadsafe_function(c->tsfn, m, napi_tsfn_nonblocking) : napi_generic_failure;
	if (m && st != napi_ok) { free(m->line); free(m); }
	if (st != napi_closing && st != napi_invalid_arg) napi_release_threadsafe_function(c->tsfn, napi_tsfn_release);
	c->tsfn = NULL;
}

static void call_js(napi_env env, napi_value js_cb, void* context, void* data) {
	(void)js_cb; (void)context;
	SettleMsg* m = (SettleMsg*)data;
	if (!m) return;
	if (env) {
		napi_value result;
		if (m->ok) {
			napi_create_object(env, &result);
			napi_value pid;
			napi_create_uint32(env, m->serverPid, &pid);
			napi_set_named_property(env, result, "serverPid", pid);
			if (!m->probe) {
				napi_value line;
				napi_create_string_utf8(env, m->line ? m->line : "", m->lineLen, &line);
				napi_set_named_property(env, result, "responseLine", line);
			}
			napi_resolve_deferred(env, m->deferred, result);
		} else {
			char message[96];
			snprintf(message, sizeof message, "pipe %s failed: %s", m->probe ? "probe" : "rpc", m->code);
			napi_reject_deferred(env, m->deferred, make_error(env, m->code, m->winError, message));
		}
	}
	free(m->line);
	free(m);
}

static const char* map_io_error(DWORD e) {
	switch (e) {
		case ERROR_BROKEN_PIPE:
		case ERROR_PIPE_NOT_CONNECTED:
		case ERROR_NO_DATA: return "EPIPE";
		case ERROR_OPERATION_ABORTED: return "ETIMEDOUT";
		default: return "EWIN32_IO";
	}
}

// Count a pending I/O as cancelled exactly once, then cancel everything on the handle.
static void cancel_pending(Ctx* c) {
	if (InterlockedCompareExchange(&c->ioPending, 2, 1) == 1) {
		InterlockedIncrement(&g_cancelledIncomplete);
		CancelIoEx(c->pipe, NULL);
	}
}

// The I/O finished (or was never going to notify): clear the state, uncount if counted.
static void clear_pending(Ctx* c) {
	if (InterlockedExchange(&c->ioPending, 0) == 2) InterlockedDecrement(&g_cancelledIncomplete);
}

// Never from timer_cb itself (it would wait on its own callback). The caller holds a reference.
static void disarm_timer(Ctx* c) {
	if (!c->timer || !c->timerRefHeld) return;
	SetThreadpoolTimer(c->timer, NULL, 0, 0);
	WaitForThreadpoolTimerCallbacks(c->timer, TRUE);
	if (InterlockedExchange(&c->timerRefHeld, 0)) ctx_release(c);
}

// Submit one overlapped I/O. Returns 1 when a completion is guaranteed to arrive.
static int submit_io(Ctx* c) {
	InterlockedIncrement(&c->refs);
	InterlockedExchange(&c->ioPending, 1);
	memset(&c->ov, 0, sizeof c->ov);
	StartThreadpoolIo(c->io);
	BOOL r;
	if (c->phase == PH_WRITE) r = WriteFile(c->pipe, c->req + c->reqDone, c->reqLen - c->reqDone, NULL, &c->ov);
	else r = ReadFile(c->pipe, c->resp + c->respLen, RESPONSE_CAP - c->respLen, NULL, &c->ov);
	if (!r && GetLastError() != ERROR_IO_PENDING) {
		DWORD e = GetLastError();
		CancelThreadpoolIo(c->io);  // no notification will arrive for this I/O
		clear_pending(c);
		settle(c, 0, map_io_error(e), e);
		ctx_release(c);
		return 0;
	}
	// A deadline that fired while this I/O was being issued must still cancel it: the timer may
	// have run between marking it pending and issuing it, when there was nothing to cancel yet.
	if (c->settled) { cancel_pending(c); CancelIoEx(c->pipe, NULL); }
	return 1;
}

static VOID CALLBACK io_cb(PTP_CALLBACK_INSTANCE inst, PVOID ctx, PVOID overlapped, ULONG ioResult,
													 ULONG_PTR bytes, PTP_IO io) {
	(void)inst; (void)overlapped; (void)io;
	Ctx* c = (Ctx*)ctx;
	clear_pending(c);
	if (c->settled || ioResult != NO_ERROR) {
		if (ioResult != NO_ERROR) settle(c, 0, map_io_error(ioResult), ioResult);
	} else if (c->phase == PH_WRITE) {
		c->reqDone += (DWORD)bytes;
		if (c->reqDone < c->reqLen) submit_io(c);
		else { c->phase = PH_READ; submit_io(c); }
	} else {
		DWORD before = c->respLen;
		c->respLen += (DWORD)bytes;
		if (bytes == 0) settle(c, 0, "EPIPE", 0);
		else {
			char* nl = memchr(c->resp + before, '\n', c->respLen - before);
			if (nl) {
				c->respLen = (DWORD)(nl - c->resp);
				settle(c, 1, NULL, 0);
			} else if (c->respLen >= RESPONSE_CAP) {
				settle(c, 0, "EMSGSIZE", 0);
			} else {
				submit_io(c);
			}
		}
	}
	// Settled by anyone (us, a failed resubmit, or the deadline): the deadline has nothing left to do.
	if (c->settled) disarm_timer(c);
	ctx_release(c);  // this completion's reference
}

static VOID CALLBACK timer_cb(PTP_CALLBACK_INSTANCE inst, PVOID ctx, PTP_TIMER timer) {
	(void)inst; (void)timer;
	Ctx* c = (Ctx*)ctx;
	settle(c, 0, "ETIMEDOUT", 0);
	cancel_pending(c);
	if (InterlockedExchange(&c->timerRefHeld, 0)) ctx_release(c);
}

static VOID CALLBACK connect_cb(PTP_CALLBACK_INSTANCE inst, PVOID ctx) {
	(void)inst;
	Ctx* c = (Ctx*)ctx;
	HANDLE h = INVALID_HANDLE_VALUE;
	for (;;) {
		if (c->settled) goto done;
		ULONGLONG now = GetTickCount64();
		if (now >= c->deadline) { settle(c, 0, "ETIMEDOUT", 0); goto done; }
		DWORD remaining = (DWORD)(c->deadline - now);
		if (!WaitNamedPipeW(c->name, remaining)) {
			DWORD e = GetLastError();
			if (e == ERROR_FILE_NOT_FOUND) settle(c, 0, "ENOENT", e);
			else if (e == ERROR_SEM_TIMEOUT) settle(c, 0, "ETIMEDOUT", e);
			else settle(c, 0, "EWIN32_CONNECT", e);
			goto done;
		}
		// SQOS identification: whoever serves this name may identify this client, never act as it.
		// The Node (libuv) receiver never impersonates, so it loses nothing.
		h = CreateFileW(c->name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING,
										FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, NULL);
		if (h != INVALID_HANDLE_VALUE) break;
		DWORD e = GetLastError();
		if (e == ERROR_PIPE_BUSY) continue;
		settle(c, 0, e == ERROR_FILE_NOT_FOUND ? "ENOENT" : (e == ERROR_ACCESS_DENIED ? "EACCES" : "EWIN32_CONNECT"), e);
		goto done;
	}
	c->pipe = h;
	{
		// Owner validation on THIS handle, before the first byte.
		const char* code = NULL;
		PSID expected = expected_owner(&code);
		if (!expected) { settle(c, 0, code, 0); goto done; }
		PSID owner = NULL;
		PSECURITY_DESCRIPTOR sd = NULL;
		DWORD r = GetSecurityInfo(h, SE_KERNEL_OBJECT, OWNER_SECURITY_INFORMATION, &owner, NULL, NULL, NULL, &sd);
		BOOL match = (r == ERROR_SUCCESS) && owner && EqualSid(owner, expected);
		if (sd) LocalFree(sd);
		LocalFree(expected);
		if (r != ERROR_SUCCESS) { settle(c, 0, "EWIN32_OWNER", r); goto done; }
		if (!match) { settle(c, 0, "EPERM", 0); goto done; }
	}
	{
		ULONG pid = 0;
		if (GetNamedPipeServerProcessId(h, &pid)) c->serverPid = pid;
	}
	if (c->probe) { settle(c, 1, NULL, 0); goto done; }
	c->io = CreateThreadpoolIo(h, io_cb, c, NULL);
	if (!c->io) { settle(c, 0, "EWIN32_IO", GetLastError()); goto done; }
	if (c->settled) goto done;
	c->phase = PH_WRITE;
	submit_io(c);
done:
	if (c->settled) disarm_timer(c);
	ctx_release(c);  // the connect worker's reference
}

static napi_value start_call(napi_env env, napi_callback_info info, int probe) {
	size_t argc = 3;
	napi_value argv[3];
	napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
	napi_value promise;
	napi_deferred deferred;
	napi_create_promise(env, &deferred, &promise);
	size_t need = probe ? 2 : 3;
	if (argc < need) {
		napi_reject_deferred(env, deferred, make_error(env, "EINVAL", 0, "missing arguments"));
		return promise;
	}
	if (g_cancelledIncomplete >= DEGRADED_LIMIT) {
		napi_reject_deferred(env, deferred, make_error(env, "ENTWURF_WIN32_IO_DEGRADED", 0,
																									 "pipe transport degraded: cancelled I/O not completed"));
		return promise;
	}
	if (InterlockedIncrement(&g_live) > LIVE_LIMIT) {
		InterlockedDecrement(&g_live);
		napi_reject_deferred(env, deferred, make_error(env, "ENTWURF_WIN32_IO_BUSY", 0, "too many pipe calls in flight"));
		return promise;
	}
	Ctx* c = (Ctx*)calloc(1, sizeof(Ctx));
	if (!c) {
		InterlockedDecrement(&g_live);
		napi_reject_deferred(env, deferred, make_error(env, "ENOMEM", 0, "out of memory"));
		return promise;
	}
	c->probe = probe;
	c->deferred = deferred;
	c->pipe = INVALID_HANDLE_VALUE;
	c->refs = 1;  // setup reference, released at the end of this function
	c->name = get_wstring(env, argv[0]);
	uint32_t timeoutMs = 0;
	napi_get_value_uint32(env, argv[probe ? 1 : 2], &timeoutMs);
	const char* bad = NULL;
	if (!c->name) bad = "EINVAL";
	if (!probe && !bad) {
		size_t len = 0;
		napi_get_value_string_utf8(env, argv[1], NULL, 0, &len);
		if (len + 1 > REQUEST_CAP) bad = "E2BIG";
		else {
			c->req = (char*)malloc(len + 2);
			c->resp = (char*)malloc(RESPONSE_CAP);
			if (!c->req || !c->resp) bad = "ENOMEM";
			else {
				napi_get_value_string_utf8(env, argv[1], c->req, len + 1, &len);
				c->req[len] = '\n';
				c->reqLen = (DWORD)(len + 1);
			}
		}
	}
	if (bad) {
		napi_reject_deferred(env, deferred, make_error(env, bad, 0, "invalid pipe call"));
		ctx_release(c);
		return promise;
	}
	napi_value resource;
	napi_create_string_utf8(env, "entwurf-win32-pipe", NAPI_AUTO_LENGTH, &resource);
	if (napi_create_threadsafe_function(env, NULL, NULL, resource, 0, 1, NULL, NULL, NULL, call_js, &c->tsfn) != napi_ok) {
		napi_reject_deferred(env, deferred, make_error(env, "EWIN32_TSFN", 0, "threadsafe function failed"));
		ctx_release(c);
		return promise;
	}
	// The threadsafe function stays referenced until settle() releases it, so a short-lived
	// caller's event loop stays alive exactly until its pipe call settles.
	c->deadline = GetTickCount64() + timeoutMs;
	c->timer = CreateThreadpoolTimer(timer_cb, c, NULL);
	if (c->timer) {
		InterlockedIncrement(&c->refs);
		c->timerRefHeld = 1;
		ULARGE_INTEGER due;
		due.QuadPart = (ULONGLONG)(-((LONGLONG)timeoutMs * 10000));  // relative, 100 ns units
		FILETIME ft;
		ft.dwLowDateTime = due.LowPart;
		ft.dwHighDateTime = due.HighPart;
		SetThreadpoolTimer(c->timer, &ft, 0, 0);
	}
	InterlockedIncrement(&c->refs);  // connect worker reference
	if (!c->timer || !TrySubmitThreadpoolCallback(connect_cb, c, NULL)) {
		ctx_release(c);  // the connect reference that will never run
		settle(c, 0, "EWIN32_SUBMIT", GetLastError());
		disarm_timer(c);
	}
	ctx_release(c);  // setup reference
	return promise;
}

static napi_value PipeRpc(napi_env env, napi_callback_info info) { return start_call(env, info, 0); }
static napi_value PipeProbe(napi_env env, napi_callback_info info) { return start_call(env, info, 1); }

static napi_value IoStats(napi_env env, napi_callback_info info) {
	(void)info;
	napi_value o, live, cancelled;
	napi_create_object(env, &o);
	napi_create_int32(env, (int32_t)g_live, &live);
	napi_create_int32(env, (int32_t)g_cancelledIncomplete, &cancelled);
	napi_set_named_property(env, o, "live", live);
	napi_set_named_property(env, o, "cancelledIncomplete", cancelled);
	return o;
}

static napi_value Init(napi_env env, napi_value exports) {
	napi_property_descriptor props[] = {
		{"readNoFollow", NULL, ReadNoFollow, NULL, NULL, NULL, napi_default, NULL},
		{"pipeRpc", NULL, PipeRpc, NULL, NULL, NULL, napi_default, NULL},
		{"pipeProbe", NULL, PipeProbe, NULL, NULL, NULL, napi_default, NULL},
		{"ioStats", NULL, IoStats, NULL, NULL, NULL, napi_default, NULL},
	};
	napi_define_properties(env, exports, sizeof props / sizeof props[0], props);
	return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
