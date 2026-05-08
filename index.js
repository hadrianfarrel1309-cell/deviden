import 'dotenv/config';
import nodemailer from 'nodemailer';
import yahooFinance from 'yahoo-finance2';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { RSI, SMA } from 'technicalindicators';

dayjs.extend(utc);
dayjs.extend(timezone);

const CONFIG = {
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  symbols: [
    { symbol: 'BBCA.JK', name: 'Bank Central Asia / BCA' },
    { symbol: 'BBRI.JK', name: 'Bank Rakyat Indonesia / BRI' }
  ],
  takeProfitPercent: Number(process.env.TAKE_PROFIT_PERCENT || 5),
  stopLossPercent: Number(process.env.STOP_LOSS_PERCENT || -3),
  watchDropPercent: Number(process.env.WATCH_DROP_PERCENT || -2),
  rsiBuyLevel: Number(process.env.RSI_BUY_LEVEL || 35),
  rsiSellLevel: Number(process.env.RSI_SELL_LEVEL || 70)
};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`ENV ${name} belum diisi`);
  return value;
}

function rupiah(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value));
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const sign = Number(value) > 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(2)}%`;
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function getStockData(stock) {
  const now = new Date();
  const start = dayjs(now).subtract(90, 'day').toDate();

  const [quote, historical] = await Promise.all([
    yahooFinance.quote(stock.symbol),
    yahooFinance.historical(stock.symbol, {
      period1: start,
      period2: now,
      interval: '1d'
    })
  ]);

  const closes = historical
    .map(item => Number(item.close))
    .filter(value => Number.isFinite(value));

  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const sma20Values = SMA.calculate({ values: closes, period: 20 });
  const sma50Values = SMA.calculate({ values: closes, period: 50 });

  const price = Number(quote.regularMarketPrice ?? closes.at(-1));
  const previousClose = Number(quote.regularMarketPreviousClose ?? closes.at(-2));
  const changePercent = Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0
    ? ((price - previousClose) / previousClose) * 100
    : Number(quote.regularMarketChangePercent || 0);

  const rsi = rsiValues.at(-1) ?? null;
  const sma20 = sma20Values.at(-1) ?? null;
  const sma50 = sma50Values.at(-1) ?? null;
  const dayHigh = Number(quote.regularMarketDayHigh || 0);
  const dayLow = Number(quote.regularMarketDayLow || 0);
  const volume = Number(quote.regularMarketVolume || 0);

  const signal = buildSignal({ price, changePercent, rsi, sma20, sma50 });

  return {
    ...stock,
    price,
    previousClose,
    changePercent,
    rsi,
    sma20,
    sma50,
    dayHigh,
    dayLow,
    volume,
    signal,
    marketTime: quote.regularMarketTime || null
  };
}

function buildSignal({ price, changePercent, rsi, sma20, sma50 }) {
  const reasons = [];
  let label = 'HOLD / PANTAU';
  let emoji = '🟡';

  if (Number.isFinite(changePercent) && changePercent <= CONFIG.watchDropPercent && rsi !== null && rsi <= CONFIG.rsiBuyLevel) {
    label = 'AREA CICIL / BUY WATCH';
    emoji = '🟢';
    reasons.push(`turun ${pct(changePercent)} dan RSI ${rsi.toFixed(1)} mulai rendah`);
  } else if (rsi !== null && rsi >= CONFIG.rsiSellLevel) {
    label = 'WASPADA TAKE PROFIT';
    emoji = '🟠';
    reasons.push(`RSI ${rsi.toFixed(1)} sudah tinggi/overbought`);
  } else if (sma20 && sma50 && price > sma20 && sma20 > sma50) {
    label = 'HOLD / TREND MASIH KUAT';
    emoji = '🔵';
    reasons.push('harga di atas SMA20 dan SMA20 di atas SMA50');
  } else if (sma20 && price < sma20 && Number.isFinite(changePercent) && changePercent < 0) {
    label = 'HATI-HATI / JANGAN FOMO';
    emoji = '🔴';
    reasons.push('harga di bawah SMA20 dan sedang melemah');
  }

  if (reasons.length === 0) reasons.push('belum ada sinyal kuat, lebih aman pantau dulu');

  return { label, emoji, reasons };
}

async function getNews() {
  const queries = ['BBCA.JK', 'BBRI.JK'];
  const allNews = [];

  for (const query of queries) {
    try {
      const result = await yahooFinance.search(query, { newsCount: 3, quotesCount: 0 });
      const news = result.news || [];
      for (const item of news) {
        allNews.push({
          title: item.title,
          publisher: item.publisher,
          link: item.link,
          related: query.replace('.JK', '')
        });
      }
    } catch (err) {
      console.warn(`Gagal ambil berita ${query}:`, err.message);
    }
  }

  const seen = new Set();
  return allNews.filter(item => {
    const key = item.link || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function buildEmailHtml(stocks, news) {
  const generatedAt = dayjs().tz(CONFIG.timezone).format('DD MMMM YYYY HH:mm');

  const rows = stocks.map(stock => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #eee;">
        <b>${escapeHtml(stock.symbol)}</b><br />
        <span style="color:#555;">${escapeHtml(stock.name)}</span>
      </td>
      <td style="padding:12px;border-bottom:1px solid #eee;">${rupiah(stock.price)}</td>
      <td style="padding:12px;border-bottom:1px solid #eee;color:${stock.changePercent >= 0 ? '#087f23' : '#c62828'};">
        ${pct(stock.changePercent)}
      </td>
      <td style="padding:12px;border-bottom:1px solid #eee;">${stock.rsi ? stock.rsi.toFixed(1) : '-'}</td>
      <td style="padding:12px;border-bottom:1px solid #eee;">
        ${stock.signal.emoji} <b>${escapeHtml(stock.signal.label)}</b><br />
        <span style="color:#555;">${escapeHtml(stock.signal.reasons.join(', '))}</span>
      </td>
    </tr>
  `).join('');

  const newsHtml = news.length
    ? news.map(item => `
      <li style="margin-bottom:10px;">
        <b>[${escapeHtml(item.related)}]</b> ${escapeHtml(item.title || 'Tanpa judul')}
        ${item.publisher ? `<br /><span style="color:#666;">${escapeHtml(item.publisher)}</span>` : ''}
        ${item.link ? `<br /><a href="${escapeHtml(item.link)}">Baca berita</a>` : ''}
      </li>
    `).join('')
    : '<li>Berita belum tersedia dari sumber data saat ini.</li>';

  return `
  <div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#222;">
    <h2>📈 Update Saham BBCA & BBRI</h2>
    <p>Dikirim otomatis pada <b>${generatedAt}</b> (${escapeHtml(CONFIG.timezone)}).</p>

    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;">
      <thead>
        <tr style="background:#f7f7f7;text-align:left;">
          <th style="padding:12px;">Saham</th>
          <th style="padding:12px;">Harga</th>
          <th style="padding:12px;">Harian</th>
          <th style="padding:12px;">RSI</th>
          <th style="padding:12px;">Sinyal</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <h3>📰 Berita Terkait</h3>
    <ul>${newsHtml}</ul>

    <h3>⚙️ Aturan Sinyal Bot</h3>
    <ul>
      <li><b>Area cicil:</b> saham turun minimal ${CONFIG.watchDropPercent}% dan RSI di bawah/sama dengan ${CONFIG.rsiBuyLevel}.</li>
      <li><b>Waspada take profit:</b> RSI di atas/sama dengan ${CONFIG.rsiSellLevel}.</li>
      <li><b>Hold trend kuat:</b> harga di atas SMA20 dan SMA20 di atas SMA50.</li>
    </ul>

    <p style="font-size:12px;color:#777;margin-top:24px;">
      Disclaimer: Email ini hanya alat bantu pantauan berbasis data dan indikator sederhana. Bukan nasihat keuangan, bukan ajakan beli/jual, dan tidak menjamin profit. Tetap cek ulang kondisi market, laporan keuangan, serta risiko pribadi sebelum transaksi.
    </p>
  </div>`;
}

function buildEmailText(stocks, news) {
  const generatedAt = dayjs().tz(CONFIG.timezone).format('DD MMMM YYYY HH:mm');
  const stockText = stocks.map(stock => [
    `${stock.symbol} - ${stock.name}`,
    `Harga: ${rupiah(stock.price)}`,
    `Harian: ${pct(stock.changePercent)}`,
    `RSI: ${stock.rsi ? stock.rsi.toFixed(1) : '-'}`,
    `Sinyal: ${stock.signal.emoji} ${stock.signal.label}`,
    `Alasan: ${stock.signal.reasons.join(', ')}`
  ].join('\n')).join('\n\n');

  const newsText = news.length
    ? news.map(item => `- [${item.related}] ${item.title} (${item.publisher || '-'}) ${item.link || ''}`).join('\n')
    : '- Berita belum tersedia.';

  return `Update Saham BBCA & BBRI\n${generatedAt}\n\n${stockText}\n\nBerita:\n${newsText}\n\nDisclaimer: Ini alat bantu pantauan, bukan nasihat keuangan.`;
}

async function sendEmail({ subject, html, text }) {
  const emailUser = requiredEnv('EMAIL_USER');
  const emailPass = requiredEnv('EMAIL_PASS');
  const receiverEmail = requiredEnv('RECEIVER_EMAIL');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailUser,
      pass: emailPass
    }
  });

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Bot Saham BBCA BBRI'}" <${emailUser}>`,
    to: receiverEmail,
    subject,
    html,
    text
  });
}

async function main() {
  console.log('Mulai cek saham...');

  if (process.argv.includes('--test-email')) {
    await sendEmail({
      subject: 'Tes Bot Saham Berhasil',
      html: '<h2>✅ Bot email saham aktif</h2><p>Kalau email ini masuk, konfigurasi Gmail sudah benar.</p>',
      text: 'Bot email saham aktif. Kalau email ini masuk, konfigurasi Gmail sudah benar.'
    });
    console.log('Email tes terkirim.');
    return;
  }

  const [stocks, news] = await Promise.all([
    Promise.all(CONFIG.symbols.map(getStockData)),
    getNews()
  ]);

  const today = dayjs().tz(CONFIG.timezone).format('DD MMM YYYY');
  const subject = `Update Saham BBCA & BBRI - ${today}`;
  const html = buildEmailHtml(stocks, news);
  const text = buildEmailText(stocks, news);

  await sendEmail({ subject, html, text });
  console.log('Email update saham terkirim.');
}

main().catch(err => {
  console.error('Bot gagal jalan:', err);
  process.exit(1);
});
