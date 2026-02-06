# GemQ — Telegram AI Project Assistant (Judge Brief)

This document is written for judges and technical reviewers evaluating the GemQ project. It explains the purpose, architecture, features, setup steps, testing instructions, security considerations, known issues, and suggested improvements.

---

## Project overview

GemQ is a Telegram bot + small Express service that helps teams store PDF project documents and get AI-assistant responses (context-aware) by mentioning the bot in group chats or replying to messages. Key user flows:

- Private flow (/start): user sends /start → provides a project name → uploads a PDF → the project is recorded (unique code generated) and the user receives sharing instructions.
- Group flow: add the bot to a group; when a user mentions the bot or replies to a message with a mention, the bot queries the uploaded project PDF via Google GenAI and replies with content derived from the PDF and the provided message.

Primary goals: rapid prototyping of a document-backed, bot-driven AI assistant; clear private setup and group usage; basic token-based usage limits.

---

## Quick facts

- Language: Node.js (CommonJS + some ES modules in schema)
- Frameworks & libs: Telegraf (Telegram), Express, Mongoose (MongoDB), @google/genai (Gemini), dotenv
- DB: MongoDB (via Mongoose)
- Storage: currently stores Telegram `file_id` (the bot retrieves a file URL on-demand using Telegram API). An `uploads/` directory exists but files are not saved there in the current flow.

---

## Files of interest

- `index.js` — main server + Telegraf bot code; contains most logic (start flow, handlers, group mention handling, AI integration).
- `models/Schema.js` — Mongoose schema for projects (fields: `userId`, `username`, `file_id`, `code`, `chatId`, `tokens`, `role`).
- `.env.example` — environment variables template.
- `package.json` — dependencies & start scripts.
- `PDF` - https://github.com/nuex001/GemQ_bot/blob/main/FlowSync_Project_Documentation.pdf

---

## Environment variables (required/optional)

- `BOT_TOKEN` — Telegram bot token (required to enable bot behavior)
- `DBURL` — MongoDB connection string (required)
- `GEMINI_API_KEY` — Google GenAI API key (optional for AI features; without it AI responses will fail)
- `PORT` — Express port (default 5000)

Make sure these are set in `.env` (copy `.env.example`).

---

## Setup & run (local)

1. Install:

```bash
cd /path/to/GemQ
cp .env.example .env
# Edit .env: set BOT_TOKEN, DBURL, GEMINI_API_KEY (optional)
npm install
```

2. Start the app:

```bash
npm start
# or for development with auto-reload:
npm run dev
```

3. Health check (service should be available even without BOT_TOKEN):

```bash
curl http://localhost:5000/health
# returns: ok
```

4. Telegram testing flow (manual):
- Open a private chat with the bot: send `/start` → send a project name → send the project as a PDF document.
- Observe the bot replies and that a `project` document is created in MongoDB (see `models/Schema.js`).
- Add bot to a group. Invite the same group (or use an existing project owner) and test: mention the bot with `@BotUsername` and a question or reply to a message while mentioning it to get contextual answers drawn from the project PDF.

---

## How the flows work (detailed)

1. /start (private chat):
   - Clears any in-memory session and sets session state `awaiting_project_name`.
   - Prompts user for a project name.
   - After receiving the project name, it sets session `awaiting_pdf` and tells the user to send a PDF.
   - When a PDF document is received (doc type or file with `.pdf` extension), the bot:
     - Generates a unique project code (alphanumeric).
     - Creates a `ProjectModel` record with `userId`, `username`, `file_id`, `code` and default `tokens` (500).
     - Replies with a professional confirmation and sharing instructions that explain how to link the project to a group.

2. Group usage:
   - When the bot is added to a group it captures `my_chat_member` events and maps `userId` → `chatId` for the project owner to the group.
   - When the bot is mentioned or mentioned in a reply, the bot loads the project's `file_id` and calls the Google GenAI model with the file URL (obtained from `bot.telegram.getFileLink(fileId)`) plus the user message to generate an answer.
   - Replies are sent in chunks if they exceed Telegram's maximum message length.
   - A token check ensures restricted usage (project must have enough `tokens` to continue; code currently checks for thresholds like `< 5`).

---

## Database schema (quick)

`models/Schema.js` defines `project` with fields:
- `userId` (Number, required, unique)
- `username` (String)
- `file_id` (String) — Telegram file id
- `code` (String, unique) — sharing code
- `chatId` (String, unique) — group chat id when linked
- `tokens` (Number) — defaults to 500
- `role` (String) — defaults to "user"

---

## Security & privacy notes

- PDF contents are not persisted locally by default; the bot stores the Telegram `file_id` and obtains a temporary file URL when needed via `bot.telegram.getFileLink`.
- The app uses in-memory sessions (a `Map`) for the private setup flow — this is ephemeral and not resilient across restarts or multiple instances. For production, move sessions to Redis or DB-backed session store.
- The Google GenAI call receives the file URL and user prompt. Ensure your `GEMINI_API_KEY` is kept secret and access to logs is controlled.
- Tokens are stored per-project in MongoDB; no payment or top-up flow is implemented in the current code.

---


Thank you for reviewing GemQ — keep it clean and focused on UX and robust input handling.
# GemQ_bot
# GemQ_bot
# GemQ_bot
# GemQ_bot
