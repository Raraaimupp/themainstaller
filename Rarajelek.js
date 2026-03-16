// ----- ( UTILITY: HITUNG SENDER TERHUBUNG / TIDAK ) -----
function getSenderCounts() {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return { total: 0, connected: 0, disconnected: 0 };

    const folders = fs.readdirSync(SESSIONS_DIR).filter((name) => {
      const fullPath = path.join(SESSIONS_DIR, name);
      return fs.statSync(fullPath).isDirectory() && name.startsWith("device");
    });

    let connected = 0;
    let disconnected = 0;

    folders.forEach((folder) => {
      const number = folder.replace("device", "").trim();
      // sessions adalah Map yang kamu gunakan untuk menyimpan socket aktif
      const isOnline = sessions.has(number);
      if (isOnline) connected++;
      else disconnected++;
    });

    return {
      total: folders.length,
      connected,
      disconnected,
    };
  } catch (err) {
    console.error("Error getSenderCounts:", err);
    return { total: 0, connected: 0, disconnected: 0 };
  }
}

function getAnyActiveWhatsApp() {
  if (!sessions || sessions.size === 0) return null;
  return [...sessions.keys()][0]; // ambil WA pertama yang aktif
}
function saveUserNumber(userId, botNumber) {
  const dir = path.join(SESSIONS_DIR, `id${userId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, "number.json"),
    JSON.stringify({ botNumber }, null, 2)
  );
}

function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}

async function initializeWhatsAppConnections() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      console.log("Tidak ada file SESSIONS_FILE, tidak ada sesi yang dimuat.");
      return;
    }

    let activeNumbers;
    try {
      activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
    } catch (e) {
      console.error("Gagal membaca SESSIONS_FILE. File mungkin korup.", e);
      return;
    }

    if (!Array.isArray(activeNumbers) || activeNumbers.length === 0) {
      console.log("Tidak ada sesi aktif di SESSIONS_FILE.");
      return;
    }

    console.log(`Ditemukan ${activeNumbers.length} sesi WhatsApp aktif`);
    const failedNumbers = new Set();

    for (const botNumber of activeNumbers) {
      try {
        console.log(`Mencoba menghubungkan WhatsApp: ${botNumber}`);
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        sock = makeWASocket({
          auth: state,
          printQRInTerminal: false,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        sock.ev.on("creds.update", saveCreds);

        await new Promise((resolve) => {
          sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
              console.log(`✅ Bot ${botNumber} terhubung!`);
              sessions.set(botNumber, sock);
              setupAutoReconnect(botNumber, sock, sessionDir);
              resolve();
            } else if (connection === "close") {
              const isLoggedOut =
                lastDisconnect?.error?.output?.statusCode ===
                DisconnectReason.loggedOut;

              if (isLoggedOut) {
                console.error(
                  `🔴 Gagal terhubung ke sesi ${botNumber}. Nomor tidak aktif/logout.`
                );
                failedNumbers.add(botNumber);

                try {
                  fs.rmSync(sessionDir, { recursive: true, force: true });
                  console.log(`Membersihkan direktori sesi ${botNumber}`);
                } catch (e) {
                  console.error(`Gagal membersihkan direktori ${botNumber}:`, e);
                }
                resolve();
              }
            }
          });
        });
      } catch (error) {
        console.error(
          `Error tak terduga saat memproses ${botNumber}:`,
          error
        );
        failedNumbers.add(botNumber);
      }
    }

    if (failedNumbers.size > 0) {
      console.log(
        `Membersihkan ${failedNumbers.size} sesi yang gagal dari ${SESSIONS_FILE}...`
      );
      const validNumbers = activeNumbers.filter(
        (num) => !failedNumbers.has(num)
      );
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(validNumbers, null, 2));
      console.log("File SESSIONS_FILE telah diperbarui.");
    }

    console.log("Inisialisasi semua sesi selesai.");
  } catch (error) {
    console.error("Error besar di initializeWhatsAppConnections:", error);
  }
}

async function setupAutoReconnect(botNumber, sock, sessionDir) {
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log(chalk.green(`🟢 [${botNumber}] Connected (ACTIVE)`));
      reconnectAttempts.delete(botNumber); // reset reconnect
      sessions.set(botNumber, sock);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      console.log(chalk.red(`🔴 [${botNumber}] Connection closed (code: ${statusCode})`));

      if (statusCode === DisconnectReason.loggedOut) {
        console.log(chalk.red(`❌ [${botNumber}] Logged OUT → deleting session.`));
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        
        if (fs.existsSync(SESSIONS_FILE)) {
          const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE));
          const filtered = saved.filter(n => n !== botNumber);
          fs.writeFileSync(SESSIONS_FILE, JSON.stringify(filtered, null, 2));
          console.log(chalk.red(`🧹 [${botNumber}] Removed from active_sessions.json`));
        }
        return;
      }

      if (!reconnectAttempts.get(botNumber)) {
        reconnectAttempts.set(botNumber, 1);
        console.log(chalk.yellow(`🟡 [${botNumber}] Trying to reconnect in 5 seconds...`));
        setTimeout(() => reconnectWhatsApp(botNumber), 5000);
      }
    }
  });
}

async function reconnectWhatsApp(botNumber) {
  const sessionDir = createSessionDir(botNumber);

  console.log(chalk.blue(`🔵 [${botNumber}] Reconnecting sender...`));

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
      auth: state,
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      defaultQueryTimeoutMs: undefined,
    });

    sock.ev.on("creds.update", saveCreds);

    setupAutoReconnect(botNumber, sock, sessionDir);

  } catch (err) {
    console.log(chalk.red(`❗ [${botNumber}] Reconnect error: ${err.message}`));
  }
}
async function connectToWhatsApp(botNumber, chatId) {
  let statusMessage = await bot
    .sendMessage(
      chatId,
      `\`\`\`
ⓘ 𝘗𝘳𝘰𝘴𝘦𝘴 𝘗𝘢𝘪𝘳𝘪𝘯𝘨 𝘕𝘰𝘮𝘰𝘳 ${botNumber}.....\`\`\`
`,
      { parse_mode: "Markdown" }
    )
    .then((msg) => msg.message_id);

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;

      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await bot.editMessageText(
          `\`\`\`︎
ⓘ 𝘗𝘳𝘰𝘴𝘦𝘴 𝘗𝘢𝘪𝘳𝘪𝘯𝘨 𝘕𝘰𝘮𝘰𝘳 ${botNumber}.....
\`\`\``,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        await connectToWhatsApp(botNumber, chatId);
      } else {
        await bot.editMessageText(
          `\`\`\`
ⓘ 𝘎𝘢𝘨𝘢𝘭 𝘔𝘦𝘭𝘢𝘬𝘶𝘬𝘢𝘯 𝘗𝘢𝘪𝘳𝘪𝘯𝘨 𝘒𝘦 𝘕𝘰𝘮𝘰𝘳 ${botNumber}.....\`\`\`
`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      saveActiveSessions(botNumber);
      saveUserNumber(chatId, botNumber);
      await bot.editMessageText(
        `\`\`\`︎
ⓘ 𝘗𝘢𝘪𝘳𝘪𝘯𝘨 𝘒𝘦 𝘕𝘰𝘮𝘰𝘳 ${botNumber}..... 𝘚𝘶𝘤𝘤𝘦𝘴\`\`\`
`,
        {
          chat_id: chatId,
          message_id: statusMessage,
          parse_mode: "Markdown",
        }
      );
      // sock.newsletterFollow("120363400362472743@newsletter");
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber);
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;

          await bot.editMessageText(
            `
\`\`\`︎ⓘ𝘚𝘶𝘬𝘴𝘦𝘴 𝘗𝘳𝘰𝘴𝘦𝘴 𝘗𝘢𝘪𝘳𝘪𝘯𝘨\`\`\`
𝘠𝘰𝘶𝘳 𝘊𝘰𝘥𝘦 : ${formattedCode}`,
            {
              chat_id: chatId,
              message_id: statusMessage,
              parse_mode: "Markdown",
            }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await bot.editMessageText(
          `\`\`\`
ⓘ𝘎𝘢𝘨𝘢𝘭 𝘔𝘦𝘭𝘢𝘬𝘶𝘬𝘢𝘯 𝘗𝘢𝘪𝘳𝘪𝘯𝘨 𝘒𝘦 𝘕𝘰𝘮𝘰𝘳 ${botNumber}.....\`\`\``,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}