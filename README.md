# Bot Email Saham BBCA & BBRI

Bot Node.js untuk kirim update otomatis saham BBCA.JK dan BBRI.JK ke email.

## Fitur

- Ambil harga BBCA dan BBRI dari Yahoo Finance.
- Hitung perubahan harian, RSI 14, SMA20, SMA50.
- Kirim sinyal sederhana: area cicil, hold, waspada take profit, hati-hati.
- Ambil berita terkait BBCA dan BBRI.
- Siap jalan di Render Cron Job.

> Disclaimer: Bot ini hanya alat bantu pantauan, bukan nasihat keuangan dan bukan jaminan profit.

## ENV yang dibutuhkan

Buat ENV di Render:

```env
EMAIL_USER=yourgmail@gmail.com
EMAIL_PASS=app_password_gmail_16_digit
RECEIVER_EMAIL=emailtujuan@gmail.com
EMAIL_FROM_NAME=Bot Saham BBCA BBRI
TIMEZONE=Asia/Jakarta
```

Opsional:

```env
TAKE_PROFIT_PERCENT=5
STOP_LOSS_PERCENT=-3
WATCH_DROP_PERCENT=-2
RSI_BUY_LEVEL=35
RSI_SELL_LEVEL=70
```

## Cara test lokal

```bash
npm install
cp .env.example .env
npm run test-email
npm start
```

## Cara upload GitHub

```bash
git init
git add .
git commit -m "initial stock email bot"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```

## Cara deploy di Render

### Opsi paling gampang: Blueprint

1. Masuk ke Render.
2. Pilih **New +**.
3. Pilih **Blueprint**.
4. Connect repository GitHub yang berisi project ini.
5. Render akan membaca file `render.yaml`.
6. Isi ENV yang masih kosong:
   - `EMAIL_USER`
   - `EMAIL_PASS`
   - `RECEIVER_EMAIL`
7. Deploy.

### Opsi manual: Cron Job

Buat dua Cron Job:

**Cron pagi**
- Name: `bca-bri-email-stock-bot-pagi`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Schedule: `0 8 * * 1-5`

**Cron sore**
- Name: `bca-bri-email-stock-bot-sore`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Schedule: `15 16 * * 1-5`

Cron memakai waktu UTC di banyak platform. Kalau jadwal terasa beda, ubah schedule sesuai timezone akun/Render.

## Gmail App Password

Jangan pakai password Gmail utama. Pakai App Password:

1. Aktifkan 2-Step Verification di akun Google.
2. Buka Security.
3. Cari App Passwords.
4. Buat App Password untuk Mail.
5. Copy 16 digit password itu ke ENV `EMAIL_PASS`.

## Catatan sinyal

Rule default:

- `AREA CICIL / BUY WATCH`: turun minimal -2% dan RSI <= 35.
- `WASPADA TAKE PROFIT`: RSI >= 70.
- `HOLD / TREND MASIH KUAT`: harga > SMA20 dan SMA20 > SMA50.
- `HATI-HATI / JANGAN FOMO`: harga < SMA20 dan harian merah.
