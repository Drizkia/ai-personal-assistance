# AI Personal Assistance | Wolly Assistant System

Personal AI Assistant berbasis Google Apps Script yang terhubung dengan WhatsApp (Fonnte), Gemini AI, dan Google Calendar.
Wolly Nexus dirancang sebagai sistem asisten pribadi yang dapat memahami pesan, mengelola jadwal, serta mengeksekusi perintah otomatis melalui function calling dan ter-integrasi dengan Learn Leaguage Model (LLM) sebagai pengolah sistem.

## ⚙️ Features
- 📅 Manajemen Google Calendar (create, list, delete event)
- 🤖 AI response menggunakan Gemini 2.5 Flash Lite
- 💬 Integrasi WhatsApp via Fonnte webhook
- ⏰ Deteksi dan pencarian slot waktu kosong otomatis
- 🔔 Reminder event langsung ke WhatsApp
- 🧠 Function calling (tool-based execution)
- 👤 Mode akses Owner vs Guest (restricted data exposure)
- 🛡️ Anti-loop protection untuk mencegah bot spam infinite

## 🧠 How It Works

Wolly bekerja sebagai pipeline otomatis:
WhatsApp Message -> Fonnete Webhook (Google Apps Script) -> LLM (Prompt + System Instruction) -> Function Calling -> Tool Execution (Google Calendar) -> LLM (Output) -> Fonnete Weebhook (Ke WhatsApp)

Alur ini berjalan stateless (tidak menyimpan memory chat).

## 🧩 System Architecture

[WhatsApp User] -> [Fonnete API] -> [Google Apps Script Webhook] -> [LLM] -> Function DIspatcher -> [Google Calendar API/Tools] -> [WhatsApp Reply]

## 🛠️ Tech Stack

- Google Apps Script (Serverless backend)
- Google Calendar API
- Gemini AI (Function Calling)
- Fonnte WhatsApp API
- JavaScript (ES5 runtime environment)

## 🔐 Configuration
Isi variabel berikut di `CONFIG`:

```js
const CONFIG = {
  GEMINI_API_KEY: "",
  FONNTE_TOKEN: "",
  CALENDAR_UTAMA: "",
  CALENDAR_TAMBAHAN: "",
  SENDER_PRIBADI: ""
};
```

## 🧠 Available Tools
### 📅 list_events
Mengambil semua agenda pada tanggal tertentu dari kalender utama & tambahan.

### ➕ add_event
Menambahkan event baru ke Google Calendar dengan:
- title
- startTime
- endTime
- location (opsional)
- color label

### ❌ delete_events
Menghapus event berdasarkan:
- keyword judul
- tanggal

### 🕒 find_free_slots
Mencari slot kosong lebih dari 30 menit dalam 1 hari

## 🔁 AI Behavior Rules
### Wolly dikontrol dengan system instruction ketat:
- Tidak boleh basa-basi (tidak ada “baik, saya cek dulu”)
- Harus langsung output final answer
- Wajib pakai tool jika konteks membutuhkan data kalender
### Mode Owner:
- Bisa akses detail agenda
### Mode Guest:
- Tidak boleh expose detail event (hanya status sibuk/tidak)

## 🚀 Deployment
1. Setup Google Apps Script
- Buat project baru
- Paste seluruh source code
2. Enable Services
- Google Calendar API
- UrlFetchApp (default Apps Script)
3. Deploy Web App
- Deploy → Web App
- Access: Anyone
4. Setup Fonnte Webhook
- Set URL webhook ke endpoint Apps Script (```doPost```)

## 📌 Example Flow
### User:
jadwal aku besok apa?

### System:
- AI memanggil list_events(date)
- Calendar di-query
- Response diformat
- Hasil dikirim ke WhatsApp

## ⚠️ Notes
- Sistem ini tidak memiliki persistent memory
- Semua konteks bersifat real-time
- Ketergantungan tinggi pada:
  - Gemini API quota
  - Google Apps Script execution limit
  - Fonnte webhook stability

## 🧪 Future Improvements
- 🧠 Memory layer (short-term context storage)
- 📊 Logging database (Google Sheets / Firestore)
- 🎙️ Voice note processing
- 📱 Multi-user role system
- 🖥️ Admin dashboard monitoring
- 🔁 Retry system untuk API failure handling
- ⚡ Performance caching untuk calendar queries

## Author
Dimas Rizki
Building personal AI system because scheduling life manually is overrated and emotionally exhausting.
