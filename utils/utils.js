const { ProjectModel } = require("../models/Schema");

// helper to escape text for Telegram HTML formatting
function escapeHtml(text) {
  if (!text && text !== 0) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function convertHtml(text) {
  if (!text && text !== 0) return "";
  return (
    text
      .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
      .replace(/^\* /gm, "• ")
      .replace(/&/g, "&amp;") // Escape HTML reserved chars
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Re-enable our <b> tags we just created
      .replace(/&lt;b&gt;/g, "<b>")
      .replace(/&lt;\/b&gt;/g, "</b>")
  );
}

//
function generateCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}

async function generateUniqueCode(field = "code", length = 6) {
  let code;
  let exists = true;

  while (exists) {
    code = generateCode(length);
    exists = await ProjectModel.exists({ [field]: code });
  }

  return code;
}

module.exports = {
  escapeHtml,
  generateCode,
  generateUniqueCode,
  convertHtml,
};
