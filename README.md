# entwurf

> *Der Entwurf* — Heidegger's "projective throw." The thrower of the project is thrown in his own throw.

**Telegram bridge for [pi](https://github.com/badlogic/pi-mono) coding agent.** Talk to your agent from your phone.

Part of the [German trilogy](https://github.com/junghan0611/agent-config#the--config-ecosystem):

| Name | Heidegger | Tense | Role |
|------|-----------|-------|------|
| **[geworfen](https://github.com/junghan0611/geworfen)** | Thrownness | Past — already thrown | Raw existence data, exposed to the world |
| **[andenken](https://github.com/junghan0611/andenken)** | Recollective thinking | Past→Present — retrieving | Semantic memory — search and connect |
| **entwurf** | Projective throw | Present→Future — projecting | Presence — remote agent access via Telegram |

## Install

```bash
# As pi package (recommended)
pi install /path/to/entwurf

# Or from GitHub
pi install git:github.com/junghan0611/entwurf
```

## Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Add to `~/.env.local`:
   ```
   PI_TELEGRAM_BOT_TOKEN=your-bot-token
   PI_TELEGRAM_CHAT_ID=your-chat-id
   ```
3. Start pi with `--telegram` flag:
   ```bash
   pi --session-control --telegram
   ```

## How It Works

```
Phone (Telegram DM) → grammy → pi.sendUserMessage() → Agent
Agent → agent_end → bot.api.sendMessage() → Phone
```

- One bot token = one polling session (Telegram API constraint)
- `--telegram` flag = opt-in (only 분신/entwurf session gets the bridge)
- `drop_pending_updates: true` on restart
- 409 Conflict auto-retry with backoff (1s → 15s)

## Build

```bash
npm install
npm run build
```

## License

MIT

---

> *"How can we account for this freedom? We cannot. It is simply a fact, not caused or grounded, but the condition of all causation and grounding."* — Heidegger
