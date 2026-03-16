bot.onText(/\/shadow$/, async (msg) => {
  bot.sendMessage(msg.chat.id, "Example: /shadow 628xxx");
});

// helper mention HTML (lebih akurat dari @username)
function escapeHtml(text = "") {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mentionUserHTML(msg) {
  if (!msg?.from?.id) return "User";

  const id = msg.from.id;

  // Prioritas tampil @username kalau ada
  let displayName = msg.from.username
    ? `@${msg.from.username}`
    : msg.from.first_name || "User";

  displayName = escapeHtml(displayName);

  return `<a href="tg://user?id=${id}">${displayName}</a>`;
}

bot.onText(/\/shadow (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;
  const userId = msg.from.id;

  const date = getCurrentDate();
  const targetNumber = match[1];
  const isPremium = await premium(senderId);
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
  const target = `${formattedNumber}@s.whatsapp.net`;

  let cooldown = checkCooldown(userId);

  // **Hilangkan cooldown**
  cooldown = 0;

  const chatType = msg.chat.type;
  const username = msg.from.username ? `@${msg.from.username}` : "Tidak ada username";

  if (isGroupOnly() && chatType === "private") {
    return bot.sendMessage(chatId, "Bot ini hanya bisa digunakan di grup.");
  }

  if (!isCmdActive("/shadow")) {
    return bot.sendMessage(chatId, "Fitur ini belum di nyalakan oleh owner.");
  }

  const groupAllowed = chatType !== "private" && isGroupAllowed(chatId);

  if (!isPremium && !groupAllowed) {
    return bot.sendMessage(
      chatId,
      "Fitur ini hanya untuk:\n• User Premium\nATAU\n• Group yang telah diizinkan owner."
    );
  }

  if (!BOT_ACTIVE) {
    return bot.sendMessage(chatId, "BOT DIMATIKAN OLEH @raraa_imuppp");
  }

  if (blacklistedCommands.includes("/fc")) {
    return bot.sendMessage(chatId, "⛔ Command ini dilarang!");
  }

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addsender 628xx"
      );
    }

    const safeText = (t = "") => String(t).replace(/```/g, "''`");

    const safeUser = escV2(username);
    const safeNumber = escV2(formattedNumber);
    const safeDate = escV2(date);

    const messageText = `
\`\`\`
╭───「 Bebas Spam Delay 」───
⌗ By            : ${safeUser}
𝓲 Target        : ${safeNumber}
ⓘ Dispatch Type : Shadow Attack Action
⊘ Status        : Succes Terkirim ꪜ
✗ Date          : ${safeDate}
╰────────────────
\`\`\`
`;

  
    await bot.sendMessage(chatId, messageText, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▷ Cek Target", url: `https://wa.me/${formattedNumber}` }],
        ],
      },
    });

await raraaimupp(target);
      
  } catch (error) {
    console.error(error);
    return bot.sendMessage(chatId, `Gagal: ${error.message}`);
  }
});
