# GemQ Telegraf Bot

This project starts a small Express server and (optionally) a Telegraf-based Telegram bot.

Features:
- Express health endpoint at `/health`
- Telegraf bot that responds to `/start` and `/help` and echoes text messages

Setup
1. Copy `.env.example` to `.env` and set `BOT_TOKEN` to your Telegram bot token.

   cp .env.example .env
   # edit .env and put your token

2. Install dependencies:

   npm install

3. Start the app:

   npm start

Notes
- If `BOT_TOKEN` is not set the HTTP server will still run and the bot will be disabled.
- The bot uses long polling by default (no webhook). For production behind a URL you can switch to webhooks; this example keeps polling for simplicity.

License: MIT
# GemQ_bot
# GemQ_bot
