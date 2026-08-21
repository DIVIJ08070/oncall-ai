# Momo — on-page mascot guide

A self-contained mascot ("desktop pet") that lives on Motion Arcade: it roams the page, runs a
**first-visit guided tour**, and **chats** to help visitors — answering questions about the games.

## What's here (pure static, no build step)
- `momo-bot.js` — the whole mascot engine, bundled into one file (ported from the Momo browser
  extension; ~210 KB minified). Include it with `<script src="/momo-bot/momo-bot.js" defer></script>`.
- `characters/adventuregirl/` — the character's sprite frames + manifest. **Art is CC0** (public
  domain) from OpenGameArt — free to use/redistribute, no attribution required.

## How the AI works
The chat calls **`/api/chat`** (see `../api/chat.js`), a serverless function that talks to the
**xAI Grok API server-side**. The API key is **never** in this bundle or the page — it's a Vercel
environment variable.

### Setup (one-time)
In **Vercel → Project → Settings → Environment Variables**, add:
- `XAI_API_KEY` = your xAI Grok key (`xai-...`)  — all environments, then **redeploy**.

Optional env: `XAI_MODEL` (default `grok-4.5`). Without the key, the mascot still roams and runs the
tour; only the AI chat is disabled (it degrades gracefully).

> Note: every visitor chat spends your Grok credits, so `api/chat.js` includes a soft per-IP
> rate-limit and caps message/history length.

## Controlling the mascot from the page (optional)
The bundle exposes `window.MomoBot`:
- `MomoBot.ready(cb)` / `MomoBot.readyPromise` — fires when the mascot is mounted
- `MomoBot.say(text, ms?)` — show a speech bubble
- `MomoBot.jumpTo(selectorOrElement)` — leap the mascot onto an element
- `MomoBot.tour([{ selector?, text, ms? }])` — run a custom guided tour

The Motion Arcade home-page tour auto-runs once per visitor (tracked via `localStorage['momo:tourDone']`).

## Privacy
When a visitor uses chat, the page text they're asking about is sent to `/api/chat` → Grok.
Nothing else leaves the browser; the mascot itself makes no network calls except to `/api/chat`.

## Rebuilding
The bundle is built from the Momo extension repo (`web-embed/`, `npm run build:embed`). To change the
character or engine, rebuild there and copy the output here.
