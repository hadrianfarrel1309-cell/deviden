import Parser from "rss-parser";
import express from "express";
import fs from "fs";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TIMEZONE = process.env.TIMEZONE || "Asia/Jakarta";

const sentReminders = new Set();
const parser = new Parser();
const sentDividendLinks = new Set();

function loadDividends() {
  return JSON.parse(fs.readFileSync("./dividends.json", "utf-8"));
}

function nowText() {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());
}

function todayJakartaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;

  return `${y}-${m}-${d}`;
}

function daysBetween(today, target) {
  if (!target) return null;

  const a = new Date(`${today}T00:00:00+07:00`);
  const b = new Date(`${target}T00:00:00+07:00`);

  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function formatDate(date) {
  if (!date) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T00:00:00+07:00`));
}

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("ENV Telegram belum lengkap");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Telegram gagal: ${JSON.stringify(data)}`);
  }
}

function dividendMessage(item, status = "Info dividen") {
  return `💰 ${status} ${item.symbol}

${item.name}

Dividen: ${item.dividend || "-"} / saham
Cum Date: ${formatDate(item.cumDate)}
Ex Date: ${formatDate(item.exDate)}
Tanggal Pencatatan: ${formatDate(item.recordingDate)}
Tanggal Pembayaran: ${formatDate(item.paymentDate)}

Catatan:
Kalau mau dapat dividen, saham harus sudah dimiliki sebelum Ex Date.

⏰ ${nowText()}`;
}

async function sendStartupMessage() {
  const data = loadDividends();

  for (const item of data) {
    await sendTelegram(dividendMessage(item, "BOT DIVIDEN AKTIF"));
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function checkDividendReminder() {
  const today = todayJakartaDate();
  const data = loadDividends();

  for (const item of data) {
    if (!item.cumDate) continue;

    const cumDiff = daysBetween(today, item.cumDate);
    const exDiff = daysBetween(today, item.exDate);
    const payDiff = daysBetween(today, item.paymentDate);

    const reminders = [
      { key: "H-7 Cum Date", diff: 7 },
      { key: "H-3 Cum Date", diff: 3 },
      { key: "H-1 Cum Date", diff: 1 },
      { key: "Hari H Cum Date", diff: 0 }
    ];

    for (const r of reminders) {
      if (cumDiff === r.diff) {
        const unique = `${item.symbol}-${item.cumDate}-${r.key}`;

        if (sentReminders.has(unique)) continue;
        sentReminders.add(unique);

        await sendTelegram(dividendMessage(item, r.key));
      }
    }

    if (exDiff === 0) {
      const unique = `${item.symbol}-${item.exDate}-EXDATE`;

      if (!sentReminders.has(unique)) {
        sentReminders.add(unique);
        await sendTelegram(dividendMessage(item, "HARI INI EX DATE"));
      }
    }

    if (payDiff === 0) {
      const unique = `${item.symbol}-${item.paymentDate}-PAYMENT`;

      if (!sentReminders.has(unique)) {
        sentReminders.add(unique);
        await sendTelegram(dividendMessage(item, "HARI INI PAYMENT DATE"));
      }
    }
  }
}

function dividendNewsSources() {
  return [
    "https://www.cnbcindonesia.com/market/rss"
  ];
}

function marketInfluencers() {
  return [
    {
      name: "theblock",
      rss: "https://www.theblock.co/rss.xml"
    },
    {
      name: "decrypt",
      rss: "https://decrypt.co/feed"
    },
    {
      name: "bitcoinmagazine",
      rss: "https://bitcoinmagazine.com/.rss/full/"
    }
  ];
}

function extractDividendInfo(title = "") {
  const text = title.toLowerCase();

  const valid =
    text.includes("dividen") ||
    text.includes("cum date") ||
    text.includes("ex date");

  if (!valid) return null;

  let symbol = "SAHAM";

  if (text.includes("bbca") || text.includes("bca")) {
    symbol = "BBCA";
  }

  if (text.includes("bbri") || text.includes("bri")) {
    symbol = "BBRI";
  }

  return {
    symbol
  };
}

function detectSentiment(text = "") {
  const t = text.toLowerCase();

  const bullishWords = [
    "bullish",
    "buy",
    "rebound",
    "breakout",
    "naik",
    "menguat",
    "all time high"
  ];

  const bearishWords = [
    "bearish",
    "sell",
    "dump",
    "crash",
    "turun",
    "melemah",
    "koreksi"
  ];

  let bullish = 0;
  let bearish = 0;

  bullishWords.forEach((w) => {
    if (t.includes(w)) bullish++;
  });

  bearishWords.forEach((w) => {
    if (t.includes(w)) bearish++;
  });

  if (bullish > bearish) return "BULLISH 📈";
  if (bearish > bullish) return "BEARISH 📉";

  return "NEUTRAL";
}

function detectAsset(text = "") {
  const t = text.toLowerCase();

  if (t.includes("bbca") || t.includes("bca")) {
    return "BBCA";
  }

  if (t.includes("bbri") || t.includes("bri")) {
    return "BBRI";
  }

  if (t.includes("bitcoin") || t.includes("btc")) {
    return "BITCOIN";
  }

  return null;
}

async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const html = await res.text();

    const $ = cheerio.load(html);

    return $("body").text();
  } catch (err) {
    console.log(`Gagal fetch artikel: ${err.message}`);
    return "";
  }
}

function parseDividendDetail(text = "") {
  const clean = text.replace(/\s+/g, " ");

  const dividend =
    clean.match(/Rp\s?[\d.,]+/i)?.[0] || "-";

  const dateMatches =
    clean.match(/\d{1,2}\s(?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)\s\d{4}/gi) || [];

  return {
    dividend,
    cumDate: dateMatches[0] || "-",
    exDate: dateMatches[1] || "-",
    recordingDate: dateMatches[2] || "-",
    paymentDate: dateMatches[3] || "-"
  };
}

async function checkDividendNews() {
  console.log(`[${nowText()}] Cek berita dividen...`);

  for (const source of dividendNewsSources()) {
    try {
      const feed = await parser.parseURL(source);
      const items = feed.items || [];

      for (const item of items.slice(0, 10)) {
        const title = item.title || "";
        const link = item.link || "";

        if (!title || !link) continue;

        if (sentDividendLinks.has(link)) continue;

        const info = extractDividendInfo(title);

        if (!info) continue;

        sentDividendLinks.add(link);

  const articleText = await fetchArticleText(link);

const detail = parseDividendDetail(articleText);

const message = `💰 UPDATE DIVIDEN ${info.symbol}

Dividen: ${detail.dividend} / saham
Cum Date: ${detail.cumDate}
Ex Date: ${detail.exDate}
Tanggal Pencatatan: ${detail.recordingDate}
Tanggal Pembayaran: ${detail.paymentDate}

Sumber:
${link}

⏰ ${nowText()}`;
        await sendTelegram(message);

        console.log(`Dividen terkirim: ${title}`);

        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      console.log(`Gagal cek dividen RSS: ${err.message}`);
    }
  }
}

async function checkMarketSentiment() {
  console.log(`[${nowText()}] Cek market sentiment...`);

  for (const source of marketInfluencers()) {
    try {
      const feed = await parser.parseURL(source.rss);

      const items = feed.items || [];

      for (const item of items.slice(0, 5)) {
        const title = item.title || "";
        const link = item.link || "";

        if (!title || !link) continue;

        if (sentDividendLinks.has(link)) continue;

        const asset = detectAsset(title);

        if (!asset) continue;

        sentDividendLinks.add(link);

        const sentiment = detectSentiment(title);

        const message = `📊 MARKET SENTIMENT

Asset: ${asset}
Sumber: ${source.name}

${title}

Sentimen: ${sentiment}

Link:
${link}

⏰ ${nowText()}`;

        await sendTelegram(message);

        console.log(`Sentiment terkirim: ${title}`);

        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (err) {
      console.log(`Gagal cek sentiment: ${err.message}`);
    }
  }
}

app.get("/", (req, res) => {
  res.send("Dividend Alert Bot aktif");
});

app.get("/test", async (req, res) => {
  try {
    await sendTelegram(`✅ Test Dividend Bot\n⏰ ${nowText()}`);

    res.send("Test dividen terkirim");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/keepalive", (req, res) => {
  console.log(`[${nowText()}] Keep alive ping`);
  res.send("OK");
});

function keepAliveLog() {
  console.log(`[${nowText()}] Bot masih hidup`);
}

app.get("/test-sentiment", async (req, res) => {
  try {
    await checkMarketSentiment();
    res.send("Test sentiment selesai, cek Telegram / Render log");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, async () => {
  console.log(`Dividend bot jalan di port ${PORT}`);

  if (process.argv.includes("test")) {
    await sendTelegram(`✅ Test Dividend Bot\n⏰ ${nowText()}`);
    process.exit(0);
  }

  await checkDividendReminder();
  await checkDividendNews();
  await checkMarketSentiment();
  
  setInterval(checkDividendReminder, 24 * 60 * 60 * 1000);

  // cek berita dividen tiap 24 jam
  setInterval(checkDividendNews, 24 * 60 * 60 * 1000);
  
// cek sentiment tiap 30 menit
setInterval(checkMarketSentiment, 30 * 60 * 1000);
  // log tiap 3 jam
  keepAliveLog();
  setInterval(keepAliveLog, 3 * 60 * 60 * 1000);
});
