const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname));

app.post("/api/send", async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      return res.status(500).json({
        ok: false,
        error: "Render Environment Variables সেট করা হয়নি।"
      });
    }

    const { number, amount, service, message } = req.body || {};

    if (!/^01[3-9]\d{8}$/.test(String(number || ""))) {
      return res.status(400).json({ ok: false, error: "সঠিক মোবাইল নাম্বার দিন।" });
    }

    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ ok: false, error: "সঠিক Amount দিন।" });
    }

    if (!String(service || "").trim() || !String(message || "").trim()) {
      return res.status(400).json({ ok: false, error: "অসম্পূর্ণ তথ্য।" });
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          parse_mode: "HTML",
          text: message
        })
      }
    );

    const result = await telegramResponse.json();

    if (!telegramResponse.ok || !result.ok) {
      throw new Error(result.description || "Telegram send failed");
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: error.message || "Server error"
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Infinity Telecom running on port ${PORT}`);
});
