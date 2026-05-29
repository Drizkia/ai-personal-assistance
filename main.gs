const CONFIG = {
  GEMINI_API_KEY: "<API KEY>",
  FONNTE_TOKEN: "<Fonnete Token>",
  CALENDAR_UTAMA: "<Email Google Calendar 1>",
  CALENDAR_TAMBAHAN: "<Email Google Calendar 2>",
  SENDER_PRIBADI: "<Number WhatsApp Main>"
};

/**
 * Webhook entry point for Fonnte
 */
function doPost(e) {
  let sender = ""; // Pindahkan ke luar agar bisa diakses di catch
  try {
    if (!e || !e.postData || !e.postData.contents) return;
    
    const contents = JSON.parse(e.postData.contents);
    
    // Log pesan masuk (cek di Executions Google Script)
    console.log("Pesan dari " + contents.sender + ": " + contents.message);

    // Anti loop SUPER KETAT
    const isFromMe = contents.is_me || contents.isMe || contents.self || (contents.type === "out") || false;
    if (isFromMe) {
      console.log("Abaikan: Pesan dari bot sendiri.");
      return;
    }
    
    sender = contents.sender || (contents.data && contents.data.sender) || contents.from || "";
    const userMessage = (contents.message || (contents.data && contents.data.message) || "");
    
    if (!userMessage || !sender) return;

    const isOwner = (sender === CONFIG.SENDER_PRIBADI); 
    
    // 1. Initial AI Call (Stateless - Tanpa Memory)
    let aiResponse = callGemini(userMessage, null, null, isOwner);
    
    if (!aiResponse.candidates || aiResponse.candidates.length === 0) {
      return; // Diam saja kalau gagal
    }

    // 2. Process function calling
    for (let i = 0; i < 3; i++) {
      const candidate = aiResponse.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts[0].functionCall) {
        const functionCall = candidate.content.parts[0].functionCall;
        const result = executeTool(functionCall.name, functionCall.args);
        
        aiResponse = callGemini(userMessage, {
          role: "function",
          name: functionCall.name,
          result: result
        }, candidate.content.parts, isOwner);
        
        if (!aiResponse.candidates || aiResponse.candidates.length === 0) break;
      } else {
        break;
      }
    }

    // 3. Langsung kirim jawaban akhir
    if (aiResponse.candidates && aiResponse.candidates[0].content && aiResponse.candidates[0].content.parts[0].text) {
      kirimWA(sender, aiResponse.candidates[0].content.parts[0].text);
    }

  } catch (err) {
    console.error("ERROR: " + err.message);
    if (sender) {
      const errorMsg = err.message.toLowerCase();
      if (errorMsg.includes("quota") || errorMsg.includes("limit") || errorMsg.includes("429")) {
        kirimWA(sender, "⚠️ *Wolly Quota Limit:* Jatah harian AI kamu habis atau terlalu cepat chat-nya. \n\n*Detail:* " + err.message);
      } else {
        kirimWA(sender, "🔴 *Wolly Error:* " + err.message);
      }
    }
  }
}

function callGemini(prompt, functionResult = null, previousParts = null, isOwner = true) {
  // Balik ke gemini-2.5-flash-lite (Sudah terbukti punya jatah 20 RPM di akun kamu)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  
  const now = new Date();
  const timeContext = `Waktu sekarang: ${Utilities.formatDate(now, "Asia/Jakarta", "EEEE, dd MMMM yyyy HH:mm")} WIB.`;

  const systemInstruction = `Kamu adalah Wolly, asisten AI pribadi milik Dimas Rizki.
  
  TUGAS UTAMA: Mengelola Google Calendar Dimas Rizki.
  
  ATURAN SANGAT KETAT:
  1. JANGAN PERNAH memberikan respon basa-basi seperti "oke", "tunggu sebentar", atau "saya cek dulu". 
  2. Kamu harus LANGSUNG memberikan hasil akhir setelah menggunakan alat (tools).
  3. Jika ditanya jadwal, WAJIB gunakan 'list_events' terlebih dahulu sebelum menjawab.
  4. Gunakan format DAFTAR yang lega dan terstruktur. Gunakan garis pemisah (---) antar agenda agar tidak menumpuk.
  
  IDENTITAS:
  ${isOwner ? '- Kamu bicara dengan DIMAS RIZKI. Gunakan bahasa akrab.' : '- Kamu bicara dengan TAMU. JANGAN beri detail judul agenda, cukup bilang Dimas sedang sibuk/tidak.'}
  
  ${timeContext}`;

  let contents = [];
  
  if (functionResult && previousParts) {
    // Jika ini respon dari tool, urutannya: user (pertanyaan) -> model (panggil fungsi) -> function (hasil fungsi)
    contents.push({ role: "user", parts: [{ text: prompt }] });
    contents.push({ role: "model", parts: previousParts });
    contents.push({
      role: "function",
      parts: [{
        functionResponse: {
          name: functionResult.name,
          response: { content: functionResult.result }
        }
      }]
    });
  } else {
    // Jika chat baru: user (pertanyaan)
    contents.push({ role: "user", parts: [{ text: prompt }] });
  }

  const payload = {
    contents: contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    tools: [{
      functionDeclarations: [
        {
          name: "list_events",
          description: "Melihat daftar agenda/jadwal pada tanggal tertentu.",
          parameters: {
            type: "OBJECT",
            properties: {
              date: { type: "STRING", description: "Tanggal yang ingin dicek (format YYYY-MM-DD)." }
            },
            required: ["date"]
          }
        },
        {
          name: "add_event",
          description: "Menambahkan jadwal atau agenda baru ke kalender.",
          parameters: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Judul agenda." },
              startTime: { type: "STRING", description: "Waktu mulai (ISO 8601, format YYYY-MM-DDTHH:mm:ssZ)." },
              endTime: { type: "STRING", description: "Waktu selesai (ISO 8601, format YYYY-MM-DDTHH:mm:ssZ)." },
              location: { type: "STRING", description: "Lokasi acara (opsional)." },
              color: { type: "STRING", description: "Warna label (merah, pink, kuning, hijau, tosca, biru, abu)." }
            },
            required: ["title", "startTime", "endTime"]
          }
        },
        {
          name: "delete_events",
          description: "Menghapus satu atau lebih agenda berdasarkan kata kunci judul atau waktu.",
          parameters: {
            type: "OBJECT",
            properties: {
              keyword: { type: "STRING", description: "Kata kunci nama agenda yang ingin dihapus." },
              date: { type: "STRING", description: "Tanggal agenda tersebut (format YYYY-MM-DD)." }
            },
            required: ["date"]
          }
        },
        {
          name: "find_free_slots",
          description: "Mencari waktu kosong (lebih dari 30 menit) pada hari tertentu.",
          parameters: {
            type: "OBJECT",
            properties: {
              date: { type: "STRING", description: "Tanggal yang ingin dicek (format YYYY-MM-DD)." }
            },
            required: ["date"]
          }
        }
      ]
    }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const resText = response.getContentText();
  const resJson = JSON.parse(resText);
  
  // Jika ada error dari Google, lemparkan ke catch
  if (resJson.error) {
    throw new Error(resJson.error.message);
  }
  
  return resJson;
}

/**
 * Dispatcher for AI Tool calls
 */
function executeTool(name, args) {
  switch (name) {
    case "list_events":
      return toolListEvents(args.date);
    case "add_event":
      return toolAddEvent(args.title, args.startTime, args.endTime, args.location, args.color);
    case "delete_events":
      return toolDeleteEvents(args.date, args.keyword);
    case "find_free_slots":
      return toolFindFreeSlots(args.date);
    default:
      return "Fungsi tidak ditemukan.";
  }
}

// --- CALENDAR TOOL IMPLEMENTATIONS ---

function toolListEvents(dateStr) {
  const date = new Date(dateStr);
  const calendarUtama = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const calendarTambahan = CalendarApp.getCalendarById(CONFIG.CALENDAR_TAMBAHAN);
  
  let events = [];
  if (calendarUtama) events = events.concat(calendarUtama.getEventsForDay(date));
  if (calendarTambahan) events = events.concat(calendarTambahan.getEventsForDay(date));
  
  // Deduplication based on Event ID or Title+Time
  const uniqueEvents = Array.from(new Map(events.map(e => [e.getId(), e])).values());
  
  uniqueEvents.sort((a, b) => a.getStartTime() - b.getStartTime());
  
  if (uniqueEvents.length === 0) return "Tidak ada agenda untuk tanggal tersebut.";
  
  return uniqueEvents.map((e, i) => {
    const start = Utilities.formatDate(e.getStartTime(), "Asia/Jakarta", "HH:mm");
    const end = Utilities.formatDate(e.getEndTime(), "Asia/Jakarta", "HH:mm");
    const loc = e.getLocation() ? `\n📍 ${e.getLocation()}` : "";
    return `--- \n⏰ *${start} - ${end}*\n📝 ${e.getTitle()}${loc}`;
  }).join("\n\n") + "\n\n---";
}

function toolAddEvent(title, startISO, endISO, location, colorName) {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const start = new Date(startISO);
  const end = new Date(endISO);
  
  const event = calendar.createEvent(title, start, end);
  if (location) event.setLocation(location);
  
  const warnaMap = {
    "merah": CalendarApp.EventColor.RED,
    "pink": CalendarApp.EventColor.PINK,
    "kuning": CalendarApp.EventColor.YELLOW,
    "hijau": CalendarApp.EventColor.GREEN,
    "tosca": CalendarApp.EventColor.TEAL,
    "biru": CalendarApp.EventColor.BLUE,
    "abu": CalendarApp.EventColor.GRAY
  };
  if (colorName && warnaMap[colorName.toLowerCase()]) {
    event.setColor(warnaMap[colorName.toLowerCase()]);
  }
  
  event.addPopupReminder(30);
  
  // Notif ke nomor pribadi Dimas
  const msgNotif = `🔔 *Jadwal Baru*\n📌 ${title}\n⏰ ${Utilities.formatDate(start, "Asia/Jakarta", "HH:mm")} - ${Utilities.formatDate(end, "Asia/Jakarta", "HH:mm")}\n📅 ${Utilities.formatDate(start, "Asia/Jakarta", "dd MMM yyyy")}`;
  kirimWA(CONFIG.SENDER_PRIBADI, msgNotif);
  
  return `Sukses mencatat "${title}" pada ${Utilities.formatDate(start, "Asia/Jakarta", "dd MMM yyyy")} jam ${Utilities.formatDate(start, "Asia/Jakarta", "HH:mm")}.`;
}

function toolDeleteEvents(dateStr, keyword) {
  const date = new Date(dateStr);
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const events = calendar.getEventsForDay(date);
  
  let deletedCount = 0;
  let names = [];
  
  events.forEach(e => {
    if (!keyword || e.getTitle().toLowerCase().includes(keyword.toLowerCase())) {
      names.push(e.getTitle());
      e.deleteEvent();
      deletedCount++;
    }
  });
  
  if (deletedCount === 0) return "Tidak ditemukan agenda yang cocok untuk dihapus.";
  return `Berhasil menghapus ${deletedCount} agenda: ${names.join(", ")}`;
}

function toolFindFreeSlots(dateStr) {
  const date = new Date(dateStr);
  const calendarUtama = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
  const calendarTambahan = CalendarApp.getCalendarById(CONFIG.CALENDAR_TAMBAHAN);
  
  let events = [];
  if (calendarUtama) events = events.concat(calendarUtama.getEventsForDay(date));
  if (calendarTambahan) events = events.concat(calendarTambahan.getEventsForDay(date));
  
  events.sort((a, b) => a.getStartTime() - b.getStartTime());
  
  let pointer = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  let freeSlots = [];
  
  events.forEach(e => {
    if (e.getStartTime() > pointer) {
      const diff = (e.getStartTime() - pointer) / (1000 * 60);
      if (diff >= 30) {
        freeSlots.push(`${Utilities.formatDate(pointer, "Asia/Jakarta", "HH:mm")} - ${Utilities.formatDate(e.getStartTime(), "Asia/Jakarta", "HH:mm")} (${diff} menit)`);
      }
    }
    if (e.getEndTime() > pointer) pointer = e.getEndTime();
  });
  
  if (endOfDay > pointer) {
    const diff = (endOfDay - pointer) / (1000 * 60);
    if (diff >= 30) {
      freeSlots.push(`${Utilities.formatDate(pointer, "Asia/Jakarta", "HH:mm")} - 23:59 (${Math.floor(diff)} menit)`);
    }
  }
  
  return freeSlots.length > 0 ? "Slot kosong:\n" + freeSlots.join("\n") : "Tidak ada slot kosong lebih dari 30 menit.";
}

/**
 * Send WhatsApp via Fonnte
 */
function kirimWA(target, message) {
  UrlFetchApp.fetch("https://api.fonnte.com/send", {
    "method": "post",
    "headers": { "Authorization": CONFIG.FONNTE_TOKEN },
    "payload": { "target": target, "message": message }
  });
}

/**
 * GET: Cek event untuk ESP32 (Mochi Backend)
 */
function doGet(e) {
  const action = e.parameter.action;
  if (action === "cekMochi") {
    const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_UTAMA);
    const now = new Date();
    const satuJamLagi = new Date(now.getTime() + (60 * 60 * 1000));
    const events = calendar.getEvents(now, satuJamLagi);
    if (events.length > 0) {
      return ContentService.createTextOutput("ADA|" + events[0].getTitle())
            .setMimeType(ContentService.MimeType.TEXT);
    } else {
      return ContentService.createTextOutput("KOSONG")
            .setMimeType(ContentService.MimeType.TEXT);
    }
  }
  return ContentService.createTextOutput("Mochi Backend is Active!");
}

