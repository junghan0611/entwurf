/**
 * entwurf — 텔레그램 브릿지 extension (MVP v0.1)
 *
 * 하나의 세션, 두 개의 인터페이스 (TUI + 텔레그램).
 * 폰에서 텔레그램 DM으로 pi 세션에 접근한다.
 *
 * 메시지 흐름:
 *   텔레그램 DM → grammy → pi.sendUserMessage() → 에이전트
 *   에이전트 → agent_end → bot.api.sendMessage() → 텔레그램
 *
 * 환경변수 (~/.env.local):
 *   PI_TELEGRAM_BOT_TOKEN — 봇 토큰 (필수)
 *   PI_TELEGRAM_CHAT_ID   — 허용된 chat_id (필수)
 *
 * 참고:
 *   - Claude Code telegram plugin (server.ts:815-860)의 polling 패턴 채택
 *   - grammy 기본 에러 핸들러는 bot.stop() + rethrow → bot.catch() 필수
 *   - grammy는 pi-coding-agent/node_modules에 설치 필요
 *
 * Ref: [[denote:20260324T153323][entwurf 텔레그램 브릿지 설계]]
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "fs";
import * as https from "https";
import * as path from "path";

/**
 * Load env var from ~/.env.local directly.
 * Cannot rely on env-loader extension — session_start race condition.
 * Ref: andenken/index.ts loadEnvKey()
 */
function loadEnvVar(key: string): string {
  const fromEnv = process.env[key];
  if (fromEnv) return fromEnv;
  try {
    const envPath = path.join(process.env.HOME ?? "", ".env.local");
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const stripped = line.trim().replace(/^export\s+/, "");
      const re = new RegExp(`^${key}=["']?([^"'\\s]+)["']?`);
      const match = stripped.match(re);
      if (match) return match[1];
    }
  } catch { /* file not found */ }
  return "";
}

// ============================================================================
// Helpers
// ============================================================================

/** 텔레그램 메시지 최대 4096자 → 분할 */
function chunkMessage(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.3) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.3) cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.3) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}

/** assistant 메시지에서 텍스트 추출 */
function extractAssistantText(messages: Array<{ role: string; content: unknown }>): string {
  const assistantMsgs = messages.filter((m) => m.role === "assistant");
  const last = assistantMsgs[assistantMsgs.length - 1];
  if (!last) return "";
  const content = last.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type: string; text?: string }) => b.type === "text" && b.text)
      .map((b: { text: string }) => b.text)
      .join("\n\n");
  }
  return "";
}

const log = (msg: string) => process.stderr.write(`[telegram] ${msg}\n`);

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
  let bot: any = null;
  let activeChatId: number | null = null;
  let isConnected = false;
  let messageCount = 0;
  let startTime = 0;
  let savedCtx: any = null;  // UI ctx를 extension 스코프에 보관

  // --- 봇 시작 (session_start에서 호출) ---
  async function startBot(botToken: string, allowedChatId: number, ctx?: any) {
    if (isConnected) return;

    const { Bot } = await import("grammy");

    // ★ IPv6 ETIMEDOUT 방지: NixOS 등 듀얼스택 환경에서 IPv6가 라우팅 안 되면
    // grammy(node-fetch)가 IPv6로 시도 → 타임아웃. IPv4 강제로 해결.
    // Ref: api.telegram.org는 IPv4/IPv6 듀얼스택, NixOS thinkpad는 IPv6 불안정
    const agent = new https.Agent({ keepAlive: true, family: 4 });
    bot = new Bot(botToken, {
      client: {
        baseFetchConfig: { agent, compress: true },
      },
    });

    // ★ 핵심: grammy 기본 에러 핸들러는 bot.stop() + rethrow.
    // 이걸 오버라이드하지 않으면 핸들러 에러 시 polling 영구 중단.
    // Ref: Claude Code telegram plugin server.ts:817-821
    bot.catch((err: any) => {
      log(`handler error (polling continues): ${err.error ?? err.message ?? err}`);
    });

    // --- 메시지 수신 핸들러 ---
    bot.on("message:text", async (tgCtx: any) => {
      const chatId = tgCtx.chat.id;
      const text = tgCtx.message.text;

      // 접근 제어
      if (allowedChatId && chatId !== allowedChatId) {
        await tgCtx.reply("⛔ 접근이 거부되었습니다.");
        return;
      }

      activeChatId = chatId;
      messageCount++;

      // /로 시작하는 메시지 차단 (pi 커맨드 주입 방지)
      if (text.startsWith("/")) {
        await tgCtx.reply("ℹ️ 슬래시 커맨드는 지원하지 않습니다.");
        return;
      }

      log(`injecting: "${text.slice(0, 50)}"`);
      // 설계: 항상 deliverAs: "followUp"이 안전
      pi.sendUserMessage(text, { deliverAs: "followUp" });
    });

    // --- polling 시작 (IIFE + 409 retry) ---
    // Ref: Claude Code telegram plugin server.ts:828-860
    void (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          await bot.start({
            drop_pending_updates: true,
            onStart: (info: any) => {
              isConnected = true;
              startTime = Date.now();
              log(`✅ polling as @${info.username}`);
              const uiCtx = ctx || savedCtx;
              if (uiCtx?.hasUI) {
                uiCtx.ui.setStatus("telegram", `✈`);
              }
            },
          });
          return; // bot.stop() 호출 시 여기로 도달
        } catch (err: any) {
          if (err?.error_code === 409) {
            const delay = Math.min(1000 * attempt, 15000);
            // TUI 방해하지 않도록 상태바에만 표시
            const uiCtx = ctx || savedCtx;
            if (uiCtx?.hasUI) {
              uiCtx.ui.setStatus("telegram", `✈⏳`);
            }
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          if (err?.message === "Aborted delay") return; // bot.stop() 중 정상 종료
          log(`polling failed: ${err}`);
          return;
        }
      }
    })();
  }

  // --- 플래그: --telegram 으로 opt-in ---
  pi.registerFlag("telegram", {
    description: "Enable Telegram bridge (DM ↔ pi session)",
    type: "boolean",
  });

  // --- 이벤트: 세션 시작 ---
  pi.on("session_start", async (_event, ctx) => {
    // --telegram 플래그가 있을 때만 시작 (분신 세션 전용)
    if (pi.getFlag("telegram") !== true) return;

    savedCtx = ctx;  // ctx 보관

    // env-loader와 session_start race condition 회피 — 직접 ~/.env.local 읽기
    const botToken = loadEnvVar("PI_TELEGRAM_BOT_TOKEN") || loadEnvVar("TELEGRAM_BOT_TOKEN");
    const allowedChatId = parseInt(loadEnvVar("PI_TELEGRAM_CHAT_ID") || loadEnvVar("TELEGRAM_CHAT_ID") || "0", 10);

    if (!botToken) {
      log("no PI_TELEGRAM_BOT_TOKEN in process.env or ~/.env.local — skipping");
      return;
    }
    log(`token: ${botToken.slice(0, 10)}... chatId: ${allowedChatId}`);

    try {
      await startBot(botToken, allowedChatId, ctx);
    } catch (err) {
      log(`startBot failed: ${err}`);
    }
  });

  // --- 이벤트: agent_end → 텔레그램으로 응답 ---
  pi.on("agent_end", async (event) => {
    if (!bot || !activeChatId) return;

    const text = extractAssistantText(event.messages as Array<{ role: string; content: unknown }>);
    if (!text) return;

    const chunks = chunkMessage(text);
    for (const chunk of chunks) {
      try {
        await bot.api.sendMessage(activeChatId, chunk);
      } catch (err) {
        log(`send failed: ${err}`);
      }
    }
  });

  // --- 이벤트: 세션 종료 ---
  pi.on("session_shutdown", async () => {
    if (bot && activeChatId) {
      try {
        await bot.api.sendMessage(activeChatId, "🔴 pi 세션 종료");
      } catch { /* ignore */ }
    }
    if (bot) {
      try { bot.stop(); } catch { /* ignore */ }
    }
    isConnected = false;
    bot = null;
  });

  // --- /telegram 커맨드 ---
  pi.registerCommand("telegram", {
    description: "Telegram bridge status — /telegram [start|stop]",
    handler: async (args, ctx) => {
      if (args?.trim() === "stop") {
        if (bot) { try { bot.stop(); } catch {} }
        isConnected = false;
        bot = null;
        ctx.ui.notify("📱 Telegram bridge stopped.", "info");
        ctx.ui.setStatus("telegram", undefined);
        return;
      }

      const elapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
      ctx.ui.notify(
        [
          `📱 Telegram Bridge`,
          `Status: ${isConnected ? "🟢 connected" : "🔴 disconnected"}`,
          `Chat ID: ${activeChatId ?? "(waiting for first message)"}`,
          `Messages: ${messageCount}`,
          `Uptime: ${elapsed}s`,
        ].join("\n"),
        "info",
      );
    },
  });
}
