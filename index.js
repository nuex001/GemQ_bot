require("dotenv").config();
const express = require("express");
const { Telegraf } = require("telegraf");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");
const mongoose = require("mongoose");
const { ProjectModel } = require("./models/Schema");
const { GoogleGenAI } = require("@google/genai");
const {
  escapeHtml,
  generateCode,
  generateUniqueCode,
  convertHtml,
} = require("./utils/utils");
let dbURL = process.env.DBURL;

// initializing port
const PORT = process.env.PORT || 5000;
const BOT_TOKEN = process.env.BOT_TOKEN;
let BOT_USERNAME = "GemQ";
const MAX_LENGTH = 4096;
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const app = express();

app.get("/health", (req, res) => res.send("ok"));

let bot;
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);

  // Simple in-memory session per chat to track the flow
  const sessions = new Map();

  function setSession(chatId, data) {
    sessions.set(String(chatId), {
      ...(sessions.get(String(chatId)) || {}),
      ...data,
    });
  }

  function clearSession(chatId) {
    sessions.delete(String(chatId));
  }

  async function getUrlFromId(fileId) {
    // This fetches the file_path and joins it with your token automatically
    const link = await bot.telegram.getFileLink(fileId);

    // link is a URL object, use .href to get the string
    return link.href;
  }

  async function generateAiContent({ msg, file_id }) {
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const fileUrl = await getUrlFromId(file_id);
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              fileData: {
                mimeType: "application/pdf",
                fileUri: fileUrl,
              },
            },
            `
      ${msg}
      Avoid special characters that might break Telegram markdown parsing.
      `,
          ],
          config: {
            thinkingLevel: "medium",
          },
        });
        return response.text;
      } catch (error) {
        if (error.status === 503 || error.message.includes("overloaded")) {
          const waitTime = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
          console.log(
            `⚠️ Model overloaded. Retrying in ${waitTime}ms... (Attempt ${attempt + 1})`,
          );
          await new Promise((res) => setTimeout(res, waitTime));
        } else {
          throw error;
        }
      }
    }

    throw new Error("Gemini is too busy right now, bro.");
  }

  // /start command: begin a clean flow to capture project name and a PDF file
  bot.start(async (ctx) => {
    const name =
      ctx.from && (ctx.from.first_name || ctx.from.username)
        ? ctx.from.first_name || ctx.from.username
        : "there";
    // start fresh
    clearSession(ctx.chat.id);
    setSession(ctx.chat.id, { step: "awaiting_project_name" });

    // send a friendly, professional prompt for project name
    await ctx.replyWithHTML(
      `<b>Thanks for choosing our service, ${escapeHtml(name)}.</b>\n\nI'm here to help you add your project quickly and keep files organized for your team.\n\nPlease send the <b>project name</b> to get started.`,
    );
  });

  bot.command("cancel", (ctx) => {
    clearSession(ctx.chat.id);
    return ctx.reply("Canceled. If you want to start again send /start");
  });

  bot.command("portfolio", async (ctx) => {
    try {
      const userId = ctx.from.id;

      // Find the user in the database
      const user = await ProjectModel.findOne({ userId: userId });

      if (!user) {
        return ctx.reply(
          "❌ You haven't started yet! Send a message to get registered.",
        );
      }

      // Helper function to escape special characters for MarkdownV2
      const escapeMarkdown = (text) => {
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
      };

      const username = user.username || ctx.from.username || "Unknown";
      const tokens = user.tokens || 0;

      // Determine status with color emoji
      const statusEmoji =
        tokens > 50 ? "🟢" : tokens > 20 ? "🟡" : tokens > 0 ? "🟠" : "🔴";
      const statusMessage =
        tokens > 50
          ? "Excellent! You're fully stocked 🔥"
          : tokens > 20
            ? "Good balance, keep creating! ✨"
            : tokens > 0
              ? "Running low, consider topping up soon ⚡"
              : "Out of credits! Use /topup to continue 🚀";

      // Build message with enhanced formatting
      const message = `
╔═══════════════════════════╗
║     💼 *YOUR PORTFOLIO*     ║
╚═══════════════════════════╝

👤 *User Information*
   ├─ Username: @${escapeMarkdown(username)}
   └─ User ID: \`${userId}\`

🎟️ *Token Balance*
   ├─ Available: *${tokens}* tokens
   └─ Status: ${statusEmoji} ${escapeMarkdown(statusMessage)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Quick Actions*
   • /topup \\- Add more tokens
   • /help \\- View all commands
   • /start \\- Restart your session
    `.trim();

      await ctx.replyWithMarkdownV2(message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔄 Top Up", callback_data: "topup" },
              { text: "📊 Stats", callback_data: "stats" },
            ],
            [{ text: "❓ Help", callback_data: "help" }],
          ],
        },
      });
    } catch (error) {
      console.error("Portfolio Error:", error);

      // More specific error handling with helpful messages
      if (error.message?.includes("parse")) {
        ctx.reply(
          "❌ Error formatting your portfolio. Please try again.\n\n" +
            "If this persists, contact support.",
        );
      } else if (
        error.message?.includes("database") ||
        error.message?.includes("find")
      ) {
        ctx.reply(
          "❌ Database connection issue. Please try again in a moment.",
        );
      } else {
        ctx.reply(
          "❌ Failed to fetch your portfolio. Please try again later.\n\n" +
            "Error: " +
            (error.message || "Unknown error"),
        );
      }
    }
  });

  const PLANS = [
    { label: "📦 Lite", tokens: "2k", price: 150, callback: "buy_2k" },
    { label: "🚀 Pro", tokens: "10k", price: 500, callback: "buy_10k" },
    { label: "🐋 Whale", tokens: "50k", price: 2000, callback: "buy_50k" },
  ];

  const TOPUP_MENU = `
╔═════════════════════════════╗
║   🔥 <b>REFILL YOUR TOKENS, BRO</b>   ║
╚═════════════════════════════╝
 Choose a plan that fits your energy:
`;

  bot.command("topup", async (ctx) => {
    await ctx.reply(TOPUP_MENU, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: PLANS.map((plan) => [
          {
            text: `${plan.label} (${plan.tokens} tokens) - ${plan.price} ⭐️`,
            callback_data: plan.callback,
          },
        ]),
      },
    });
  });

  // Function to generate the invoice parameters
  const getInvoice = (title, tokens, stars) => ({
    title: title,
    description: `Refill your balance with ${tokens} tokens.`,
    payload: `refill_${tokens}`,
    provider_token: "", // Empty for Telegram Stars
    currency: "XTR",
    prices: [{ label: "Token Pack", amount: stars }], // 1 star = 1 unit
  });

  bot.action("buy_2k", (ctx) =>
    ctx.replyWithInvoice(getInvoice("Lite Plan", 2000, 150)),
  );
  bot.action("buy_10k", (ctx) =>
    ctx.replyWithInvoice(getInvoice("Pro Plan", 10000, 500)),
  );
  bot.action("buy_50k", (ctx) =>
    ctx.replyWithInvoice(getInvoice("Whale Plan", 50000, 2000)),
  );

  // Telegram checks if server is up
  bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));
  // Payment success
  bot.on("successful_payment", async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    let amountToAdd = 0;

    if (payload === "refill_2000") amountToAdd = 2000;
    else if (payload === "refill_10000") amountToAdd = 10000;
    else if (payload === "refill_50000") amountToAdd = 50000;

    if (amountToAdd === 0) {
      return ctx.reply("⚠️ Unknown plan — contact support.");
    }

    await ProjectModel.updateOne(
      { userId: ctx.from.id },
      { $inc: { tokens: amountToAdd } },
    );

    ctx.reply(`✅ Boom! +${amountToAdd} tokens added. Let's cook! 🔥`);
  });

  // handle document uploads (expecting PDF)
  bot.on("document", async (ctx) => {
    const chatId = String(ctx.chat.id);
    const session = sessions.get(chatId);
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    if (!session || session.step !== "awaiting_pdf") {
      return ctx.reply("I was not expecting a file. Send /start to begin.");
    }

    const doc = ctx.message.document;
    const fileName = doc.file_name || `file_${Date.now()}`;
    const lower = (fileName || "").toLowerCase();
    const isPdf =
      (doc.mime_type && doc.mime_type === "application/pdf") ||
      lower.endsWith(".pdf");
    if (!isPdf) {
      return ctx.reply("Please send a PDF file (with .pdf extension).");
    }
    // Check the 20MB Bot API Download Limit
    const fileSizeMB = doc.file_size / (1024 * 1024);
    if (fileSizeMB > 20) {
      return ctx.reply(
        `⚠️ This PDF is too chunky (${fileSizeMB.toFixed(1)}MB). Please send a file under 20MB.`,
      );
    }

    try {
      await ctx.reply("Uploading your PDF — please wait...");

      const uniqueCode = await generateUniqueCode();
      console.log(uniqueCode);

      await ProjectModel.findOneAndUpdate(
        { userId: userId }, // find by these fields
        {
          $set: {
            file_id: doc.file_id,
            username: username,
            code: uniqueCode.toString(),
          },
        },
        { upsert: true, new: true }, // create if not found, return updated doc
      );

      const parts = [];
      parts.push("<b>Project successfully added ✅</b>");
      parts.push("<b>Share this project with your team</b>");

      if (BOT_USERNAME) {
        parts.push(`1. Add @${escapeHtml(BOT_USERNAME)} to your group chat`);
        parts.push("2. Make sure to promote it to admin for full access");
        parts.push(
          `3. Mention @${escapeHtml(BOT_USERNAME)} in a message or reply to any message to activate the bot`,
        );
      } else {
        parts.push("1. Add the bot to your group chat");
        parts.push(
          "2. Mention the bot in a message or reply to any message to activate it",
        );
      }

      parts.push(
        "\n<i>Tip:</i> For secure project uploads, start a private chat with the bot and use /start.",
      );

      await ctx.replyWithHTML(parts.join("\n"));

      clearSession(chatId);
    } catch (err) {
      console.error("File download failed", err);
      return ctx.reply("Sorry, failed to save the file. Please try again.");
    }
  });

  // initialize bot: fetch bot username, add group/mention handlers, then launch
  (async () => {
    try {
      const me = await bot.telegram.getMe();
      BOT_USERNAME = me && me.username ? me.username : null;
      console.log(
        "Bot ready as",
        BOT_USERNAME ? `@${BOT_USERNAME}` : "(username unknown)",
      );

      // respond when mentioned in groups (or when replying and bot is mentioned)
      // ✅ SINGLE unified message handler
      bot.on("message", async (ctx) => {
        try {
          const chatType = ctx.chat.type;
          const isPrivate = chatType === "private";
          const isGroup = ["group", "supergroup"].includes(chatType);
          const text = ctx.message?.text?.trim();

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 🔹 PRIVATE CHAT: Handle session-based flow
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isPrivate && text) {
            const chatId = String(ctx.chat.id);
            const session = sessions.get(chatId);

            if (!session) {
              return ctx.reply("Send /start to begin adding a project.");
            }

            if (session.step === "awaiting_project_name") {
              setSession(chatId, { projectName: text, step: "awaiting_pdf" });
              return ctx.reply(
                `Project name noted: ${text}\nNow please send the project file as a PDF document.`,
              );
            }

            // If session exists but we're not expecting text
            return ctx.reply(
              "I am waiting for a PDF file. Please send the project PDF or use /cancel to abort.",
            );
          }

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // 🔹 GROUP CHAT: Handle mentions
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (isGroup && text) {
            const msg = ctx.message;
            const entities = msg.entities || [];

            // Check if bot is mentioned
            let isMentioned = false;
            if (BOT_USERNAME) {
              isMentioned = entities.some((e) => {
                if (e.type === "mention") {
                  const mention = text.slice(e.offset, e.offset + e.length);
                  return (
                    mention.toLowerCase() === `@${BOT_USERNAME.toLowerCase()}`
                  );
                }
                if (e.type === "text_mention") {
                  return (
                    e.user?.username?.toLowerCase() ===
                    BOT_USERNAME.toLowerCase()
                  );
                }
                return false;
              });

              if (
                !isMentioned &&
                text.toLowerCase().includes(`@${BOT_USERNAME.toLowerCase()}`)
              ) {
                isMentioned = true;
              }
            }

            if (!isMentioned) return;

            // If it's a reply to another message, show that message's content
            if (msg.reply_to_message) {
              const orig = msg.reply_to_message;
              let content = orig.text || orig.caption;

              if (!content) {
                return ctx.reply("No text found in the referenced message.");
              }

              const project = await ProjectModel.findOne({
                chatId: ctx.chat.id,
              });
              if (!project) {
                const message = await ctx.reply(
                  "This chat is not linked to any project. Please set up your project first.",
                );

                setTimeout(() => {
                  ctx.deleteMessage(message.message_id);
                }, 5000);
                return;
              }

              // 3. Restriction Check
              if (project.tokens < 5) {
                return ctx.reply(
                  "❌ Out of gas, bro. chargeup to keep chatting.",
                );
              }

              const cleanText = content
                .replace(new RegExp(`@${BOT_USERNAME}`, "gi"), "")
                .trim();

              const aiResponse = await generateAiContent({
                msg: cleanText,
                file_id: project.file_id,
              });

              if (aiResponse.length <= MAX_LENGTH) {
                ctx.reply(convertHtml(aiResponse), {
                  reply_to_message_id: msg.message_id,
                  parse_mode: "HTML",
                });
              } else {
                // Split into chunks
                const chunks =
                  aiResponse.match(new RegExp(`.{1,${MAX_LENGTH}}`, "g")) || [];
                for (const chunk of chunks) {
                  await ctx.reply(convertHtml(chunk), {
                    parse_mode: "HTML",
                  });
                }
              }
              // await ProjectModel.findOneAndUpdate(
              //   { chatId: ctx.chat.id },
              //   { $inc: { tokens: -5 } },
              // );
              return;
            }

            const project = await ProjectModel.findOne({ chatId: ctx.chat.id });

            if (!project) {
              const message = await ctx.reply(
                "This chat is not linked to any project. Please set up your project first.",
              );

              setTimeout(() => {
                ctx.deleteMessage(message.message_id);
              }, 5000);
              return;
            }
            // 3. Restriction Check
            if (project.tokens < 5) {
              return ctx.reply(
                "❌ Out of gas, bro. chargeup to keep chatting.",
              );
            }

            // If it's just a tag (not a reply), respond to the current message
            // Remove the bot mention from the text for cleaner response
            const cleanText = text
              .replace(new RegExp(`@${BOT_USERNAME}`, "gi"), "")
              .trim();

            if (cleanText) {
              const aiResponse = await generateAiContent({
                msg: cleanText,
                file_id: project.file_id,
              });
              if (aiResponse.length <= MAX_LENGTH) {
                ctx.reply(convertHtml(aiResponse), {
                  reply_to_message_id: msg.message_id,
                  parse_mode: "HTML",
                });
              } else {
                // Split into chunks
                const chunks =
                  aiResponse.match(new RegExp(`.{1,${MAX_LENGTH}}`, "g")) || [];
                for (const chunk of chunks) {
                  await ctx.reply(convertHtml(chunk), {
                    parse_mode: "HTML",
                  });
                }
              }
            } else {
              // Just tagged with no other text
              ctx.reply("You called me! How can I help?", {
                reply_to_message_id: msg.message_id,
              });
            }
            // await ProjectModel.findOneAndUpdate(
            //   { chatId: ctx.chat.id },
            //   { $inc: { tokens: -5 } },
            // );

            return;
          }
        } catch (e) {
          console.error("Error handling message", e);
        }
      });

      // Welcome message when bot is added to a group (keeps it short and professional)
      bot.on("my_chat_member", async (ctx) => {
        try {
          const newStatus =
            ctx.update.my_chat_member.new_chat_member &&
            ctx.update.my_chat_member.new_chat_member.status;
          if (newStatus === "member" || newStatus === "administrator") {
            const chatId = ctx.chat.id;
            const addedByUserId = ctx.update.my_chat_member.from.id;

            // 🔍 Find project that belongs to this user
            const project = await ProjectModel.findOneAndUpdate(
              { userId: addedByUserId },
              { chatId: chatId },
              { new: true },
            );

            if (project) {
              // console.log("Project updated with group ID:", project._id);
            } else {
              console.log("No project found for this user");
            }

            const welcome = [];
            welcome.push("<b>Hello! 👋</b>");
            welcome.push("");
            welcome.push(
              "'I'm Gemq, your automated support assistant. I'm here to help answer your questions instantly, anytime.'",
            );
            welcome.push("");
            welcome.push("<b>How to get help:</b>");
            if (BOT_USERNAME) {
              welcome.push(
                `• Mention me with @${escapeHtml(BOT_USERNAME)} followed by your question`,
              );
              welcome.push(
                `• Reply to any message and mention @${escapeHtml(BOT_USERNAME)} for context-aware help`,
              );
            } else {
              welcome.push(
                "• Mention me in your message followed by your question",
              );
              welcome.push(
                "• Reply to any message and mention me for context-aware help",
              );
            }
            welcome.push("• Send me a direct message for private support");
            welcome.push("");
            welcome.push(
              "'I'm available 24/7 to assist you. Feel free to ask me anything! 💬'",
            );

            await ctx.reply(welcome.join("\n"), { parse_mode: "HTML" });
          }
        } catch (e) {
          console.error("Error in my_chat_member handler", e);
        }
      });

      await bot.launch({ dropPendingUpdates: true });
      console.log("Telegraf bot launched (polling)");
    } catch (err) {
      console.error("Failed to init bot", err);
      // try to launch anyway
      try {
        await bot.launch({ dropPendingUpdates: true });
      } catch (e) {
        console.error("Failed to launch bot", e);
      }
    }
  })();

  bot.help((ctx) =>
    ctx.reply(
      "Flow:\n/start - start upload flow\n/cancel - cancel current flow",
    ),
  );

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
} else {
  console.log(
    "BOT_TOKEN not set. Bot will not start. Add BOT_TOKEN to .env to enable the bot.",
  );
}

// connecting the db
mongoose
  .connect(dbURL)
  .then((result) => {
    app.listen(PORT);
    console.log("Connected Successfully");
  })
  .catch((err) => {
    console.log(err);
  });
